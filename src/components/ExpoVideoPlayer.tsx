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
import { BufferTuning } from "../services/stbEnvironment";

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
 * Derives native ExoPlayer / AVPlayer buffer parameters from user buffer profiles
 * and adaptive network measurements, with proper milliseconds -> seconds conversion.
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
  const baseCacheSec = (networkCacheMs && networkCacheMs > 0)
    ? networkCacheMs / 1000
    : (isLive ? 3.0 : 4.0);

  let minBufferSec = 1.5;
  let forwardBufferSec = 8.0;

  if (profile === "instant") {
    // Instant zap: start playback as soon as 0.8s (live) or 1.0s (VOD) is buffered
    minBufferSec = isLive ? 0.8 : 1.0;
    forwardBufferSec = isLive
      ? Math.max(2.0, baseCacheSec)
      : Math.max(4.0, baseCacheSec * 1.5);
  } else if (profile === "smooth") {
    // Smooth: deep buffer to absorb high jitter / weak Wi-Fi
    minBufferSec = isLive ? 2.5 : 3.0;
    forwardBufferSec = isLive
      ? Math.max(10.0, baseCacheSec * 2.0)
      : Math.max(18.0, baseCacheSec * 2.5);
  } else {
    // Balanced (default)
    minBufferSec = isLive ? 1.5 : 2.0;
    forwardBufferSec = isLive
      ? Math.max(5.0, baseCacheSec * 1.5)
      : Math.max(10.0, baseCacheSec * 2.0);
  }

  if (is4K) {
    minBufferSec += 0.5;
    forwardBufferSec = Math.round(forwardBufferSec * 1.3 * 10) / 10;
  }

  return {
    preferredForwardBufferDuration: Math.round(forwardBufferSec * 10) / 10,
    minBufferForPlayback: Math.round(minBufferSec * 10) / 10,
    maxBufferBytes: 0,
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
