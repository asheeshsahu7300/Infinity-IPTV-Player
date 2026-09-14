import React, { useEffect, useRef, useImperativeHandle, forwardRef, useCallback, useMemo } from "react";
import { StyleSheet, View, ViewStyle, StyleProp, Platform } from "react-native";
import {
  VideoView,
  useVideoPlayer,
  VideoSource,
  AudioTrack,
  SubtitleTrack,
  VideoTrack,
  VideoContentFit,
} from "expo-video";
import { BufferProfile, BufferTuning } from "../services/stbEnvironment";

export interface NormalizedTrackOption {
  id: string | number;
  index: number;
  name?: string;
  title?: string;
  language?: string;
  width?: number;
  height?: number;
  bitrate?: number;
  raw?: any;
}

export interface ExpoVideoPlayerRef {
  play: () => void;
  pause: () => void;
  seekTo: (positionMs: number) => void;
  seekBy: (deltaSeconds: number) => void;
  selectAudioTrack: (trackIdOrIndex: string | number | undefined) => void;
  selectSubtitleTrack: (trackIdOrIndex: string | number | undefined) => void;
  selectVideoTrack: (trackIdOrIndex: string | number | undefined) => void;
  reloadSource: () => Promise<void>;
  getPlayer: () => any;
}

export interface ExpoVideoPlayerProps {
  streamUrl: string;
  headers?: Record<string, string>;
  style?: StyleProp<ViewStyle>;
  contentFit?: VideoContentFit;
  rate?: number;
  volume?: number; // 0..1 or 0..100
  paused?: boolean;
  autoPlay?: boolean;
  isLive?: boolean;
  is4K?: boolean;
  networkCacheMs?: number;
  bufferTuning?: BufferTuning;
  selectedAudioTrack?: string | number | undefined;
  selectedSubtitleTrack?: string | number | undefined;
  selectedVideoTrack?: string | number | undefined;
  staysActiveInBackground?: boolean;
  onLoad?: (data: {
    duration: number;
    audioTracks: NormalizedTrackOption[];
    textTracks: NormalizedTrackOption[];
    videoTracks: NormalizedTrackOption[];
    naturalSize?: { width: number; height: number };
    currentAudioTrack?: NormalizedTrackOption;
  }) => void;
  onTracksChange?: (data: {
    audioTracks: NormalizedTrackOption[];
    textTracks: NormalizedTrackOption[];
    videoTracks: NormalizedTrackOption[];
    currentAudioTrack?: NormalizedTrackOption;
  }) => void;
  onProgress?: (currentTimeMs: number, durationMs: number) => void;
  onBuffering?: (isBuffering: boolean) => void;
  onPlaying?: () => void;
  onPaused?: () => void;
  onEnd?: () => void;
  onError?: (error: any) => void;
}

/**
 * Normalizes AudioTrack from expo-video into the format expected by TrackSelectionModal
 */
function normalizeAudioTracks(tracks: AudioTrack[]): NormalizedTrackOption[] {
  return (tracks || []).map((t, idx) => {
    const label = t.label || (t as any).name || (t.language ? t.language.toUpperCase() : `Audio ${idx + 1}`);
    return {
      id: t.id ?? idx,
      index: idx,
      title: label,
      name: label,
      language: t.language || "",
      raw: t,
    };
  });
}

/**
 * Normalizes SubtitleTrack from expo-video into the format expected by TrackSelectionModal
 */
function normalizeSubtitleTracks(tracks: SubtitleTrack[]): NormalizedTrackOption[] {
  const result: NormalizedTrackOption[] = [
    {
      id: -1,
      index: -1,
      title: "Disable Subtitles",
      name: "Disable Subtitles",
      language: "",
    },
  ];

  (tracks || []).forEach((t, idx) => {
    const label = t.label || (t as any).name || (t.language ? t.language.toUpperCase() : `Subtitle ${idx + 1}`);
    result.push({
      id: t.id ?? idx,
      index: idx,
      title: label,
      name: label,
      language: t.language || "",
      raw: t,
    });
  });

  return result;
}

/**
 * Normalizes VideoTrack from expo-video into the format expected by TrackSelectionModal
 */
function normalizeVideoTracks(tracks: VideoTrack[]): NormalizedTrackOption[] {
  return (tracks || []).map((t, idx) => {
    const h = t.size?.height;
    const w = t.size?.width;
    let label = "Auto";
    if (h && w) {
      if (h >= 2160 || w >= 3840) label = "4K UHD";
      else if (h >= 1440) label = "2K QHD";
      else if (h >= 1080) label = "1080p FHD";
      else if (h >= 720) label = "720p HD";
      else if (h >= 480) label = "480p SD";
      else label = `${h}p`;
    }

    return {
      id: t.id ?? idx,
      index: idx,
      title: label,
      name: label,
      width: w,
      height: h,
      bitrate: t.bitrate ?? (t as any).averageBitrate ?? (t as any).peakBitrate ?? undefined,
      raw: t,
    };
  });
}

/**
 * The four combinations of stream type and resolution that need genuinely
 * different buffer budgets. They are not one axis with a multiplier on it:
 * live trades depth against how far behind the broadcast it sits, on-demand
 * has no such cost, and 4K changes the *bitrate* rather than the duration, so
 * it moves the memory ceiling far more than it moves the time budget.
 */
type ContentClass = "live" | "live4k" | "vod" | "vod4k";

const contentClassFor = (isLive?: boolean, is4K?: boolean): ContentClass =>
  isLive ? (is4K ? "live4k" : "live") : is4K ? "vod4k" : "vod";

const MB = 1024 * 1024;

/**
 * How far ahead the loader fills, in seconds — ExoPlayer's high-water mark.
 *
 * This is the main lever against stuttering and it used to be far too shallow:
 * balanced live resolved to a 5s ceiling, and balanced 4K live to 9.8s, so a
 * two-second dip on the line drained the buffer outright. Depth here costs
 * almost nothing that a viewer perceives, because *starting* playback is gated
 * by START_BUFFER_SEC below, not by this — a channel still tunes in about a
 * second while the loader keeps working well ahead of the playhead.
 *
 * What depth does cost on live is latency behind the broadcast, which is why
 * live sits lower than on-demand. 4K is deeper than HD in time terms only
 * where the decoder needs it; the real 4K protection is the byte ceiling.
 */
const TARGET_BUFFER_SEC: Record<BufferProfile, Record<ContentClass, number>> = {
  instant: { live: 6, live4k: 8, vod: 10, vod4k: 12 },
  balanced: { live: 12, live4k: 16, vod: 24, vod4k: 20 },
  smooth: { live: 20, live4k: 24, vod: 40, vod4k: 28 },
};

/**
 * How much must be buffered before playback STARTS, in seconds.
 *
 * Deliberately small and deliberately independent of the depth above: this is
 * the number a viewer actually feels, as the delay between pressing a channel
 * number and seeing a picture. 4K asks for a little more because one 4K GOP is
 * a lot of bytes and starting mid-GOP shows as a stutter on the first second.
 */
const START_BUFFER_SEC: Record<BufferProfile, Record<ContentClass, number>> = {
  instant: { live: 0.8, live4k: 1.2, vod: 1.0, vod4k: 1.5 },
  balanced: { live: 1.5, live4k: 2.0, vod: 2.0, vod4k: 2.5 },
  smooth: { live: 2.5, live4k: 3.0, vod: 3.0, vod4k: 3.5 },
};

/** Ceiling on the adaptive lift, so a boosted cache cannot run away. */
const MAX_TARGET_BUFFER_SEC: Record<ContentClass, number> = {
  live: 30,
  live4k: 30,
  vod: 60,
  vod4k: 32,
};

/**
 * Memory ceiling for the sample queues.
 *
 * Previously 0, meaning "let ExoPlayer decide", which resolves to roughly
 * 140MB for a muxed stream and left the time budget as the only bound. That is
 * survivable at 6 Mbps and is not at 40: a 4K target of 20s would be ~100MB of
 * Java heap on a box that may only have 256MB with `largeHeap` on.
 *
 * This works as a ceiling rather than a target because
 * `prioritizeTimeOverSizeThreshold` stays true: below the low-water mark the
 * load control ignores bytes entirely, so a high-bitrate stream still fills to
 * its minimum and can never starve — the cap only stops it running on past
 * that toward the full time budget. The practical effect is that bitrate, not
 * a guess, decides where a 4K buffer actually settles.
 */
const MAX_BUFFER_BYTES: Record<ContentClass, number> = {
  live: 32 * MB,
  live4k: 96 * MB,
  vod: 48 * MB,
  vod4k: 96 * MB,
};

/**
 * Derives native ExoPlayer buffer parameters from the viewer's buffer profile,
 * the stream class, and the adaptive network cache.
 *
 * `networkCacheMs` is the adaptive input: it already carries the network-quality
 * floor and the stall boost that `player.tsx` raises after repeated stalls, so
 * it can only ever deepen the buffer past the profile's baseline, never shrink
 * it below.
 */
export function calculateExpoBufferOptions({
  networkCacheMs,
  bufferTuning,
  isLive,
  is4K,
}: {
  networkCacheMs?: number;
  bufferTuning?: BufferTuning;
  isLive?: boolean;
  is4K?: boolean;
}) {
  const profile = bufferTuning?.profile || "balanced";
  const kind = contentClassFor(isLive, is4K);

  const baseCacheSec =
    networkCacheMs && networkCacheMs > 0 ? networkCacheMs / 1000 : isLive ? 3.0 : 4.0;

  // The measured line and the stall boost lift the floor; the profile sets it.
  const adaptiveSec = baseCacheSec * (isLive ? 2.0 : 2.5);
  const forwardBufferSec = Math.min(
    MAX_TARGET_BUFFER_SEC[kind],
    Math.max(TARGET_BUFFER_SEC[profile][kind], adaptiveSec)
  );

  const startBufferSec = START_BUFFER_SEC[profile][kind];

  return {
    preferredForwardBufferDuration: Math.round(forwardBufferSec * 10) / 10,
    minBufferForPlayback: Math.round(startBufferSec * 10) / 10,
    maxBufferBytes: MAX_BUFFER_BYTES[kind],
    prioritizeTimeOverSizeThreshold: true,
  };
}

export const ExpoVideoPlayer = forwardRef<ExpoVideoPlayerRef, ExpoVideoPlayerProps>(
  (
    {
      streamUrl,
      headers,
      style,
      contentFit = "contain",
      rate = 1.0,
      volume = 1.0,
      paused = false,
      autoPlay = true,
      isLive = false,
      is4K = false,
      networkCacheMs,
      bufferTuning,
      selectedAudioTrack,
      selectedSubtitleTrack,
      selectedVideoTrack,
      staysActiveInBackground = false,
      onLoad,
      onTracksChange,
      onProgress,
      onBuffering,
      onPlaying,
      onPaused,
      onEnd,
      onError,
    },
    ref
  ) => {
    const isFirstLoadRef = useRef(true);
    const audioTracksRef = useRef<AudioTrack[]>([]);
    const subtitleTracksRef = useRef<SubtitleTrack[]>([]);
    const videoTracksRef = useRef<VideoTrack[]>([]);
    const currentUrlRef = useRef(streamUrl);
    const lastProgressEmitTime = useRef(0);

    // Build referentially stable VideoSource object
    const source = useMemo<VideoSource>(
      () => ({
        uri: streamUrl,
        headers: headers,
      }),
      [streamUrl, headers]
    );

    // Initialize the native player with tuned buffer options
    const player = useVideoPlayer(source, (p) => {
      p.loop = false;
      p.timeUpdateEventInterval = 0.25; // 250ms for smooth progress bar updates
      p.playbackRate = rate;
      p.volume = volume > 1 ? volume / 100 : volume;
      p.audioMixingMode = "auto";

      if (staysActiveInBackground) {
        try {
          p.staysActiveInBackground = true;
        } catch {}
      }

      // Tune buffer dynamically based on profile, network cache, and resolution
      try {
        p.bufferOptions = calculateExpoBufferOptions({
          networkCacheMs,
          bufferTuning,
          isLive,
          is4K,
        });
      } catch (e) {
        console.warn("[ExpoVideoPlayer] Error setting bufferOptions:", e);
      }

      if (autoPlay && !paused) {
        try {
          p.play();
        } catch {}
      }
    });

    // Dynamic buffer tuning when profile, network cache, or stream type change
    useEffect(() => {
      if (!player) return;
      try {
        player.bufferOptions = calculateExpoBufferOptions({
          networkCacheMs,
          bufferTuning,
          isLive,
          is4K,
        });
      } catch {}
    }, [player, networkCacheMs, bufferTuning, isLive, is4K]);

    // Synchronize play / pause state
    useEffect(() => {
      if (!player) return;
      try {
        if (paused) {
          if (player.playing) player.pause();
        } else {
          if (!player.playing) player.play();
        }
      } catch (err) {
        console.warn("[ExpoVideoPlayer] Error updating playback state:", err);
      }
    }, [player, paused]);

    // Synchronize playback speed
    useEffect(() => {
      if (!player) return;
      try {
        player.playbackRate = rate;
      } catch {}
    }, [player, rate]);

    // Synchronize volume
    useEffect(() => {
      if (!player) return;
      try {
        player.volume = volume > 1 ? volume / 100 : volume;
      } catch {}
    }, [player, volume]);

    // When streamUrl or headers change, replace the media source asynchronously
    useEffect(() => {
      if (!player) return;
      if (currentUrlRef.current !== streamUrl && streamUrl) {
        currentUrlRef.current = streamUrl;
        isFirstLoadRef.current = true;
        try {
          player.replaceAsync({
            uri: streamUrl,
            headers: headers,
          });
          if (!paused && autoPlay) {
            player.play();
          }
        } catch (e) {
          console.warn("[ExpoVideoPlayer] replaceAsync error:", e);
        }
      }
    }, [player, streamUrl, headers, paused, autoPlay]);

    // Track selection helper methods
    const applyAudioTrack = useCallback(
      (trackIdOrIndex: string | number | undefined) => {
        if (!player || trackIdOrIndex === undefined) return;
        if (trackIdOrIndex === -1 || trackIdOrIndex === "-1" || trackIdOrIndex === null) {
          try {
            player.audioTrack = null;
          } catch {}
          return;
        }
        const available = player.availableAudioTracks || [];
        audioTracksRef.current = available;
        const match = available.find(
          (t, idx) =>
            t.id === String(trackIdOrIndex) ||
            idx === Number(trackIdOrIndex) ||
            String(idx) === String(trackIdOrIndex)
        );
        if (match) {
          try {
            player.audioTrack = match;
          } catch (err) {
            console.warn("[ExpoVideoPlayer] Error setting audio track:", err);
          }
        }
      },
      [player]
    );

    const applySubtitleTrack = useCallback(
      (trackIdOrIndex: string | number | undefined) => {
        if (!player) return;
        if (trackIdOrIndex === undefined || trackIdOrIndex === -1 || trackIdOrIndex === "-1") {
          try {
            player.subtitleTrack = null;
          } catch {}
          return;
        }
        const available = player.availableSubtitleTracks || [];
        subtitleTracksRef.current = available;
        const match = available.find(
          (t, idx) => t.id === String(trackIdOrIndex) || idx === Number(trackIdOrIndex)
        );
        if (match) {
          try {
            player.subtitleTrack = match;
          } catch (err) {
            console.warn("[ExpoVideoPlayer] Error setting subtitle track:", err);
          }
        } else {
          try {
            player.subtitleTrack = null;
          } catch {}
        }
      },
      [player]
    );

    const applyVideoTrack = useCallback(
      (trackIdOrIndex: string | number | undefined) => {
        if (!player) return;
        const available = player.availableVideoTracks || [];
        videoTracksRef.current = available;
        if (trackIdOrIndex === undefined) {
          // Auto bitrate mode
          return;
        }
        const match = available.find(
          (t, idx) => t.id === String(trackIdOrIndex) || idx === Number(trackIdOrIndex)
        );
        const matchUrl = (match as any)?.url;
        if (match && matchUrl && matchUrl !== streamUrl) {
          // HLS variant stream URL switch
          try {
            player.replaceAsync({
              uri: matchUrl,
              headers: headers,
            });
          } catch (err) {
            console.warn("[ExpoVideoPlayer] Error switching video track variant URL:", err);
          }
        }
      },
      [player, streamUrl, headers]
    );

    // Sync selected tracks when props change
    useEffect(() => {
      if (selectedAudioTrack !== undefined) {
        applyAudioTrack(selectedAudioTrack);
      }
    }, [selectedAudioTrack, applyAudioTrack]);

    useEffect(() => {
      applySubtitleTrack(selectedSubtitleTrack);
    }, [selectedSubtitleTrack, applySubtitleTrack]);

    useEffect(() => {
      applyVideoTrack(selectedVideoTrack);
    }, [selectedVideoTrack, applyVideoTrack]);

    // Event Subscriptions
    useEffect(() => {
      if (!player) return;

      const subStatus = player.addListener("statusChange", ({ status, error }: any) => {
        if (status === "loading") {
          onBuffering?.(true);
        } else if (status === "readyToPlay") {
          onBuffering?.(false);
          if (isFirstLoadRef.current) {
            isFirstLoadRef.current = false;
            const durationMs = Math.round((player.duration || 0) * 1000);
            const aTracks = normalizeAudioTracks(player.availableAudioTracks || []);
            const sTracks = normalizeSubtitleTracks(player.availableSubtitleTracks || []);
            const vTracks = normalizeVideoTracks(player.availableVideoTracks || []);
            audioTracksRef.current = player.availableAudioTracks || [];
            subtitleTracksRef.current = player.availableSubtitleTracks || [];
            videoTracksRef.current = player.availableVideoTracks || [];

            onLoad?.({
              duration: durationMs,
              audioTracks: aTracks,
              textTracks: sTracks,
              videoTracks: vTracks,
              naturalSize: undefined,
            });
          }
        } else if (status === "error") {
          onBuffering?.(false);
          onError?.(error || new Error("Playback error"));
        } else if (status === "idle" && isLive && !isFirstLoadRef.current) {
          // If Live TV reaches idle state after having started, the stream dropped/ended
          onEnd?.();
        }
      });

      const subPlaying = player.addListener("playingChange", ({ isPlaying }: any) => {
        if (isPlaying) {
          onPlaying?.();
          onBuffering?.(false);
        } else {
          onPaused?.();
        }
      });

      const subTime = player.addListener("timeUpdate", ({ currentTime }: any) => {
        lastProgressEmitTime.current = Date.now();
        const currentMs = Math.round((currentTime || 0) * 1000);
        const durationMs = Math.round((player.duration || 0) * 1000);
        onProgress?.(currentMs, durationMs);
      });

      // Fallback heartbeat: only emits onProgress if native timeUpdate has not fired
      // for >1000ms while player is playing (e.g. frozen live MPEG-TS clock)
      const heartbeatTimer = setInterval(() => {
        try {
          if (player.playing && Date.now() - lastProgressEmitTime.current > 1000) {
            lastProgressEmitTime.current = Date.now();
            const currentMs = Math.round((player.currentTime || 0) * 1000);
            const durationMs = Math.round((player.duration || 0) * 1000);
            onProgress?.(currentMs, durationMs);
          }
        } catch {}
      }, 500);

      const subSourceLoad = player.addListener("sourceLoad", () => {
        if (isFirstLoadRef.current) {
          isFirstLoadRef.current = false;
          const durationMs = Math.round((player.duration || 0) * 1000);
          const aTracks = normalizeAudioTracks(player.availableAudioTracks || []);
          const sTracks = normalizeSubtitleTracks(player.availableSubtitleTracks || []);
          const vTracks = normalizeVideoTracks(player.availableVideoTracks || []);
          audioTracksRef.current = player.availableAudioTracks || [];
          subtitleTracksRef.current = player.availableSubtitleTracks || [];
          videoTracksRef.current = player.availableVideoTracks || [];

          onLoad?.({
            duration: durationMs,
            audioTracks: aTracks,
            textTracks: sTracks,
            videoTracks: vTracks,
          });
        }
      });

      const subAudioTracks = player.addListener("availableAudioTracksChange", ({ availableAudioTracks }: any) => {
        audioTracksRef.current = availableAudioTracks || [];
        const aTracks = normalizeAudioTracks(availableAudioTracks || []);
        const sTracks = normalizeSubtitleTracks(player.availableSubtitleTracks || []);
        const vTracks = normalizeVideoTracks(player.availableVideoTracks || []);
        const currentAudio = availableAudioTracks && player.audioTrack ? normalizeAudioTracks([player.audioTrack])[0] : undefined;

        onTracksChange?.({
          audioTracks: aTracks,
          textTracks: sTracks,
          videoTracks: vTracks,
          currentAudioTrack: currentAudio,
        });
      });

      const subSubtitleTracks = player.addListener("availableSubtitleTracksChange", ({ availableSubtitleTracks }: any) => {
        subtitleTracksRef.current = availableSubtitleTracks || [];
        onTracksChange?.({
          audioTracks: normalizeAudioTracks(player.availableAudioTracks || []),
          textTracks: normalizeSubtitleTracks(availableSubtitleTracks || []),
          videoTracks: normalizeVideoTracks(player.availableVideoTracks || []),
        });
      });

      const subVideoTracks = player.addListener("videoTrackChange", () => {
        const available = player.availableVideoTracks || [];
        videoTracksRef.current = available;
        onTracksChange?.({
          audioTracks: normalizeAudioTracks(player.availableAudioTracks || []),
          textTracks: normalizeSubtitleTracks(player.availableSubtitleTracks || []),
          videoTracks: normalizeVideoTracks(available),
        });
      });

      const subEnd = player.addListener("playToEnd", () => {
        onEnd?.();
      });

      return () => {
        clearInterval(heartbeatTimer);
        subStatus.remove();
        subPlaying.remove();
        subTime.remove();
        subSourceLoad.remove();
        subAudioTracks.remove();
        subSubtitleTracks.remove();
        subVideoTracks.remove();
        subEnd.remove();
      };
    }, [player, onBuffering, onLoad, onTracksChange, onError, onPlaying, onPaused, onProgress, onEnd]);

    // Imperative Handle
    useImperativeHandle(
      ref,
      () => ({
        play: () => {
          try {
            player.play();
          } catch {}
        },
        pause: () => {
          try {
            player.pause();
          } catch {}
        },
        seekTo: (positionMs: number) => {
          try {
            player.currentTime = Math.max(0, positionMs / 1000);
          } catch {}
        },
        seekBy: (deltaSeconds: number) => {
          try {
            player.seekBy(deltaSeconds);
          } catch {}
        },
        selectAudioTrack: (trackIdOrIndex) => {
          applyAudioTrack(trackIdOrIndex);
        },
        selectSubtitleTrack: (trackIdOrIndex) => {
          applySubtitleTrack(trackIdOrIndex);
        },
        selectVideoTrack: (trackIdOrIndex) => {
          applyVideoTrack(trackIdOrIndex);
        },
        reloadSource: async () => {
          if (!player) return;
          isFirstLoadRef.current = true;
          try {
            await player.replaceAsync({
              uri: streamUrl,
              headers: headers,
            });
            if (!paused && autoPlay) {
              player.play();
            }
          } catch (err) {
            console.warn("[ExpoVideoPlayer] reloadSource error:", err);
          }
        },
        getPlayer: () => player,
      }),
      [player, streamUrl, headers, paused, autoPlay, applyAudioTrack, applySubtitleTrack, applyVideoTrack]
    );

    return (
      <View style={[styles.container, style]}>
        <VideoView
          style={StyleSheet.absoluteFill}
          player={player}
          contentFit={contentFit}
          nativeControls={false}
          allowsPictureInPicture={true}
          surfaceType={Platform.OS === "android" ? "surfaceView" : undefined}
        />
      </View>
    );
  }
);

ExpoVideoPlayer.displayName = "ExpoVideoPlayer";

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#000000",
    overflow: "hidden",
  },
});
