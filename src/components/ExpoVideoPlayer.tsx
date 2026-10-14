import React, { useEffect, useRef, useImperativeHandle, forwardRef, useCallback, useMemo } from "react";
import { StyleSheet, View, ViewStyle, StyleProp, Platform, findNodeHandle } from "react-native";
import {
  VideoView,
  useVideoPlayer,
  VideoSource,
  AudioTrack,
  SubtitleTrack,
  VideoTrack,
  VideoContentFit,
} from "expo-video";
import { BufferTuning, isPlayableStreamUrl } from "../services/stbEnvironment";

function checkNativeHlsSupport(): boolean {
  if (Platform.OS !== "web" || typeof document === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  try {
    // Only Apple Safari natively supports HLS at the OS level without extensions or MSE.
    // Chromium/Edge/Firefox on Windows/Linux do not support IPTV HLS/TS streams natively.
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    if (!isSafari) {
      return false;
    }
    const video = document.createElement("video");
    return video.canPlayType("application/vnd.apple.mpegurl") !== "";
  } catch {
    return false;
  }
}

/**
 * Normalizes stream URLs for web playback.
 * On Web, browsers cannot decode raw MPEG-TS (.ts) streams natively.
 * Xtream Codes servers provide the same stream as .m3u8, so we convert .ts to .m3u8 on web.
 */
function normalizeStreamUrlForWeb(url: string | null | undefined): string {
  if (!url || Platform.OS !== "web") return url || "";
  if (/\/live\/[^/]+\/[^/]+\/\d+\.ts(\?.*)?$/i.test(url)) {
    return url.replace(/\.ts(\?.*)?$/i, (match, query) => `.m3u8${query || ""}`);
  }
  return url;
}

export interface NormalizedTrackOption {
  id: string | number;
  index: number;
  name?: string;
  title?: string;
  language?: string;
  width?: number;
  height?: number;
  bitrate?: number;
  subtitle?: string;
  isSupported?: boolean;
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
  isPlaying?: () => boolean;
  getAudioTracks?: () => NormalizedTrackOption[];
  getSubtitleTracks?: () => NormalizedTrackOption[];
  getVideoTracks?: () => NormalizedTrackOption[];
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
  onError?: (error: any, audioTracks?: NormalizedTrackOption[]) => void;
}

/**
 * Normalizes AudioTrack from expo-video into the format expected by TrackSelectionModal
 */
function normalizeAudioTracks(tracks: AudioTrack[]): NormalizedTrackOption[] {
  return (tracks || []).map((t, idx) => {
    const label = t.label || (t as any).name || (t.language ? t.language.toUpperCase() : `Audio ${idx + 1}`);
    const mime = (t as any).mimeType || (t as any).raw?.sampleMimeType || "";
    return {
      id: t.id ?? idx,
      index: idx,
      title: label,
      name: label,
      language: t.language || "",
      mimeType: mime,
      isSupported: (t as any).isSupported !== false,
      format: {
        sampleMimeType: mime,
      },
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
 * Normalizes AudioTrack from hls.js into NormalizedTrackOption
 */
function normalizeHlsAudioTracks(tracks: any[]): NormalizedTrackOption[] {
  return (tracks || []).map((t, idx) => {
    const lang = t.lang || t.language || "";
    const label = t.name || (lang ? lang.toUpperCase() : `Audio ${idx + 1}`);
    return {
      id: t.id ?? idx,
      index: idx,
      title: label,
      name: label,
      language: lang,
      isSupported: true,
      raw: t,
    };
  });
}

/**
 * Normalizes SubtitleTrack from hls.js into NormalizedTrackOption
 */
function normalizeHlsSubtitleTracks(tracks: any[]): NormalizedTrackOption[] {
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
    const lang = t.lang || t.language || "";
    const label = t.name || (lang ? lang.toUpperCase() : `Subtitle ${idx + 1}`);
    result.push({
      id: t.id ?? idx,
      index: idx,
      title: label,
      name: label,
      language: lang,
      raw: t,
    });
  });

  return result;
}

/**
 * Normalizes video levels from hls.js into NormalizedTrackOption
 */
function normalizeHlsLevels(levels: any[]): NormalizedTrackOption[] {
  return (levels || []).map((lvl, idx) => {
    const h = lvl.height;
    const w = lvl.width;
    let label = lvl.name || "Auto";
    if (h && w) {
      if (h >= 2160 || w >= 3840) label = "4K UHD";
      else if (h >= 1440) label = "2K QHD";
      else if (h >= 1080) label = "1080p FHD";
      else if (h >= 720) label = "720p HD";
      else if (h >= 480) label = "480p SD";
      else label = `${h}p`;
    } else if (h) {
      label = `${h}p`;
    }

    return {
      id: idx,
      index: idx,
      title: label,
      name: label,
      width: w,
      height: h,
      bitrate: lvl.bitrate,
      raw: lvl,
    };
  });
}

/**
 * Normalizes native DOM HTMLMediaElement audio tracks (Safari / webOS)
 */
function normalizeDomAudioTracks(audioTrackList: any): NormalizedTrackOption[] {
  if (!audioTrackList) return [];
  const tracks: NormalizedTrackOption[] = [];
  try {
    for (let i = 0; i < audioTrackList.length; i++) {
      const t = audioTrackList[i];
      const label = t.label || (t.language ? t.language.toUpperCase() : `Audio ${i + 1}`);
      tracks.push({
        id: t.id || i,
        index: i,
        title: label,
        name: label,
        language: t.language || "",
        isSupported: true,
        raw: t,
      });
    }
  } catch {}
  return tracks;
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

  let minBufferSec = 0.8;
  let forwardBufferSec = 30.0;

  if (profile === "instant") {
    // Instant zap: start playback as soon as 0.5s (live) or 0.8s (VOD) is buffered,
    // while maintaining deep 20s-30s forward buffer to avoid starvation.
    minBufferSec = isLive ? 0.5 : 0.8;
    forwardBufferSec = isLive
      ? Math.max(20.0, baseCacheSec * 3)
      : Math.max(30.0, baseCacheSec * 4);
  } else if (profile === "smooth") {
    // Smooth: higher start cushion for jittery/weak Wi-Fi
    minBufferSec = isLive ? 2.0 : 2.5;
    forwardBufferSec = isLive
      ? Math.max(45.0, baseCacheSec * 5)
      : Math.max(60.0, baseCacheSec * 6);
  } else {
    // Balanced (default): fast <1s start (0.8s live, 1.2s VOD) with deep 30s-50s forward buffer
    minBufferSec = isLive ? 0.8 : 1.2;
    forwardBufferSec = isLive
      ? Math.max(30.0, baseCacheSec * 4)
      : Math.max(50.0, baseCacheSec * 5);
  }

  if (is4K) {
    minBufferSec += 0.5;
    forwardBufferSec = Math.max(forwardBufferSec, isLive ? 40.0 : 60.0);
  }

  return {
    preferredForwardBufferDuration: Math.round(forwardBufferSec * 10) / 10,
    minBufferForPlayback: Math.round(minBufferSec * 10) / 10,
    maxBufferBytes: 0,
    prioritizeTimeOverSizeThreshold: true,
    waitsToMinimizeStalling: true,
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
    const containerRef = useRef<View>(null);
    const hlsRef = useRef<any>(null);
    const videoElRef = useRef<HTMLVideoElement | null>(null);

    const isNativeHlsSupported = useMemo(() => checkNativeHlsSupport(), []);
    const isHls = Boolean(
      streamUrl && (
        streamUrl.includes(".m3u8") ||
        streamUrl.includes("m3u8") ||
        isLive
      )
    );

    const effectiveHeaders = useMemo(() => {
      return {
        "User-Agent": "okhttp/3.12.1",
        ...(headers || {}),
      };
    }, [headers]);

    // Web & webOS HLS fallback attachment (only for HLS streams)
    useEffect(() => {
      if (Platform.OS !== "web" || !streamUrl || !isPlayableStreamUrl(streamUrl) || !isHls || isNativeHlsSupported) return;

      const containerEl = containerRef.current as any;
      if (!containerEl) return;
      const domNode: HTMLElement | null =
        typeof containerEl.querySelector === "function"
          ? containerEl
          : containerEl.getDOMNode?.() || (Platform.OS !== "web" ? (findNodeHandle(containerEl) as any) : null);

      const videoEl = domNode?.querySelector?.("video") as HTMLVideoElement | null;
      if (!videoEl) return;
      videoElRef.current = videoEl;

      let hlsInstance: any = null;
      try {
        const HlsModule = require("hls.js");
        const HlsClass = HlsModule.default || HlsModule;
        if (HlsClass && HlsClass.isSupported && HlsClass.isSupported()) {
          hlsInstance = new HlsClass({
            enableWorker: true,
            lowLatencyMode: isLive,
            backBufferLength: isLive ? 10 : 30,
            xhrSetup: (xhr: XMLHttpRequest) => {
              if (effectiveHeaders) {
                for (const [k, v] of Object.entries(effectiveHeaders)) {
                  try {
                    xhr.setRequestHeader(k, v);
                  } catch (e) {
                    // Browser might throw error for restricted headers like User-Agent
                  }
                }
              }
            },
          });
          hlsRef.current = hlsInstance;
          const normalized = normalizeStreamUrlForWeb(streamUrl);
          hlsInstance.loadSource(normalized);
          hlsInstance.attachMedia(videoEl);

          const emitHlsTracks = (isInitial: boolean) => {
            let aTracks = normalizeHlsAudioTracks(hlsInstance.audioTracks || []);
            if (aTracks.length === 0 && (videoEl as any)?.audioTracks?.length) {
              aTracks = normalizeDomAudioTracks((videoEl as any).audioTracks);
            }
            const sTracks = normalizeHlsSubtitleTracks(hlsInstance.subtitleTracks || []);
            const vTracks = normalizeHlsLevels(hlsInstance.levels || []);

            const activeIdx = hlsInstance.audioTrack;
            const currentAudio = (activeIdx >= 0 && aTracks[activeIdx]) ? aTracks[activeIdx] : aTracks[0];

            if (isInitial) {
              const durationMs = Math.round((videoEl.duration || 0) * 1000);
              onLoad?.({
                duration: durationMs,
                audioTracks: aTracks,
                textTracks: sTracks,
                videoTracks: vTracks,
                naturalSize: vTracks[0]?.width && vTracks[0]?.height ? { width: vTracks[0].width, height: vTracks[0].height } : undefined,
                currentAudioTrack: currentAudio,
              });
            } else {
              onTracksChange?.({
                audioTracks: aTracks,
                textTracks: sTracks,
                videoTracks: vTracks,
                currentAudioTrack: currentAudio,
              });
            }
          };

          hlsInstance.on(HlsClass.Events.MANIFEST_PARSED, () => {
            if (isFirstLoadRef.current) {
              isFirstLoadRef.current = false;
              emitHlsTracks(true);
            } else {
              emitHlsTracks(false);
            }
            if (!paused && autoPlay) {
              videoEl.play().catch(() => {});
            }
          });

          hlsInstance.on(HlsClass.Events.AUDIO_TRACKS_UPDATED, () => {
            emitHlsTracks(false);
          });

          hlsInstance.on(HlsClass.Events.AUDIO_TRACK_SWITCHED, () => {
            emitHlsTracks(false);
          });

          hlsInstance.on(HlsClass.Events.SUBTITLE_TRACKS_UPDATED, () => {
            emitHlsTracks(false);
          });

          const onLoadedMetadata = () => {
            if ((videoEl as any)?.audioTracks?.length) {
              emitHlsTracks(false);
            }
          };
          videoEl.addEventListener("loadedmetadata", onLoadedMetadata);

          hlsInstance.on(HlsClass.Events.ERROR, (_: any, data: any) => {
            if (data.fatal) {
              switch (data.type) {
                case HlsClass.ErrorTypes.NETWORK_ERROR:
                  if (data.response?.code === 401 || data.response?.code === 403) {
                    console.warn(`[webOS HLS] Stream rejected with HTTP ${data.response?.code}`);
                    onError?.(new Error(`Stream authorization error (HTTP ${data.response?.code})`));
                    break;
                  }
                  console.warn("[webOS HLS] Network error, recovering...", data.details);
                  hlsInstance.startLoad();
                  break;
                case HlsClass.ErrorTypes.MEDIA_ERROR:
                  console.warn("[webOS HLS] Media error, recovering...", data.details);
                  hlsInstance.recoverMediaError();
                  break;
                default:
                  console.warn("[webOS HLS] Fatal stream error:", data);
                  onError?.(new Error(`HLS fatal error: ${data.details}`));
                  break;
              }
            }
          });
        }
      } catch (err) {
        console.warn("[webOS HLS] Error attaching HLS.js:", err);
      }

      return () => {
        if (hlsInstance) {
          try {
            hlsInstance.destroy();
          } catch {}
          if (hlsRef.current === hlsInstance) {
            hlsRef.current = null;
          }
        }
      };
    }, [streamUrl, isLive, onLoad, onTracksChange, onError, paused, autoPlay, isNativeHlsSupported, effectiveHeaders]);

    /**
     * The `paused` prop, readable from the event listeners.
     */
    const pausedRef = useRef(paused);

    /** Set by `playToEnd`; distinguishes "finished" from "stopped dead". */
    const endedRef = useRef(false);

    // Build referentially stable VideoSource object
    const source = useMemo<VideoSource | null>(() => {
      if (!streamUrl || !isPlayableStreamUrl(streamUrl)) {
        return null;
      }

      // In desktop browsers without native HLS support (Chrome/Edge/Firefox), passing
      // an HLS stream URL to <video src="..."> causes MEDIA_ELEMENT_ERROR: Format error.
      // We pass null to VideoView only for HLS so native browser doesn't try to decode it,
      // and Hls.js attaches MediaSource cleanly instead. Direct VOD files (MP4, MKV) are passed directly.
      if (Platform.OS === "web" && isHls && !isNativeHlsSupported) {
        return null;
      }

      const normalized = normalizeStreamUrlForWeb(streamUrl);
      if (!normalized || !isPlayableStreamUrl(normalized)) {
        return null;
      }

      return {
        uri: Platform.OS === "web" ? normalized : streamUrl,
        headers: effectiveHeaders,
      };
    }, [streamUrl, effectiveHeaders, isHls, isNativeHlsSupported]);

    // Initialize the native player with tuned buffer options
    const player = useVideoPlayer(source as any, (p) => {
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

      if (autoPlay && !paused && (!Platform.OS || Platform.OS !== "web" || isNativeHlsSupported)) {
        try {
          p.play();
        } catch {}
      }
    });

    const lastBufferOptionsRef = useRef<string>("");

    // Dynamic buffer tuning when profile, network cache, or stream type change
    useEffect(() => {
      if (!player) return;
      try {
        const newOpts = calculateExpoBufferOptions({
          networkCacheMs,
          bufferTuning,
          isLive,
          is4K,
        });
        const serialized = JSON.stringify(newOpts);
        if (lastBufferOptionsRef.current !== serialized) {
          lastBufferOptionsRef.current = serialized;
          player.bufferOptions = newOpts;
        }
      } catch {}
    }, [player, networkCacheMs, bufferTuning, isLive, is4K]);

    // Synchronize play / pause state
    useEffect(() => {
      pausedRef.current = paused;
      if (Platform.OS === "web" && !isNativeHlsSupported && videoElRef.current) {
        if (paused) {
          videoElRef.current.pause();
        } else {
          videoElRef.current.play().catch(() => {});
        }
        return;
      }
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
    }, [player, paused, isNativeHlsSupported]);

    // Synchronize playback speed
    useEffect(() => {
      if (Platform.OS === "web" && !isNativeHlsSupported && videoElRef.current) {
        videoElRef.current.playbackRate = rate;
      }
      if (!player) return;
      try {
        player.playbackRate = rate;
      } catch {}
    }, [player, rate, isNativeHlsSupported]);

    // Synchronize volume
    useEffect(() => {
      const normVol = volume > 1 ? volume / 100 : volume;
      if (Platform.OS === "web" && !isNativeHlsSupported && videoElRef.current) {
        videoElRef.current.volume = normVol;
      }
      if (!player) return;
      try {
        player.volume = normVol;
      } catch {}
    }, [player, volume, isNativeHlsSupported]);

    // When streamUrl or headers change, replace the media source asynchronously
    useEffect(() => {
      if (currentUrlRef.current !== streamUrl && streamUrl) {
        currentUrlRef.current = streamUrl;
        isFirstLoadRef.current = true;
        if (Platform.OS === "web" && isHls && !isNativeHlsSupported) {
          // Handled by HLS attachment effect
          return;
        }
        if (!player) return;
        try {
          const normalized = normalizeStreamUrlForWeb(streamUrl);
          player.replaceAsync({
            uri: Platform.OS === "web" ? normalized : streamUrl,
            headers: effectiveHeaders,
          });
          if (!paused && autoPlay) {
            player.play();
          }
        } catch (e) {
          console.warn("[ExpoVideoPlayer] replaceAsync error:", e);
        }
      }
    }, [player, streamUrl, effectiveHeaders, paused, autoPlay, isNativeHlsSupported, isHls]);

    // Track selection helper methods
    const applyAudioTrack = useCallback(
      (trackIdOrIndex: string | number | undefined) => {
        if (trackIdOrIndex === undefined) return;

        // Web & webOS HLS.js
        if (Platform.OS === "web" && !isNativeHlsSupported && hlsRef.current) {
          const hls = hlsRef.current;
          if (trackIdOrIndex === -1 || trackIdOrIndex === "-1" || trackIdOrIndex === null) {
            hls.audioTrack = -1;
            return;
          }
          if (hls.audioTracks && hls.audioTracks.length > 0) {
            const numIdx = Number(trackIdOrIndex);
            if (!isNaN(numIdx) && numIdx >= 0 && numIdx < hls.audioTracks.length) {
              hls.audioTrack = numIdx;
              return;
            }
            const matchIdx = hls.audioTracks.findIndex(
              (t: any) => String(t.id) === String(trackIdOrIndex)
            );
            if (matchIdx >= 0) {
              hls.audioTrack = matchIdx;
              return;
            }
          }
        }

        // Web DOM HTMLMediaElement audio tracks (Safari / webOS native video)
        if (Platform.OS === "web" && videoElRef.current && (videoElRef.current as any).audioTracks) {
          const domTracks = (videoElRef.current as any).audioTracks;
          for (let i = 0; i < domTracks.length; i++) {
            domTracks[i].enabled = (i === Number(trackIdOrIndex) || String(domTracks[i].id) === String(trackIdOrIndex));
          }
        }

        if (!player) return;
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
      [player, isNativeHlsSupported]
    );

    const applySubtitleTrack = useCallback(
      (trackIdOrIndex: string | number | undefined) => {
        // Web & webOS HLS.js
        if (Platform.OS === "web" && !isNativeHlsSupported && hlsRef.current) {
          const hls = hlsRef.current;
          if (trackIdOrIndex === undefined || trackIdOrIndex === -1 || trackIdOrIndex === "-1" || trackIdOrIndex === null) {
            hls.subtitleTrack = -1;
            return;
          }
          if (hls.subtitleTracks && hls.subtitleTracks.length > 0) {
            const numIdx = Number(trackIdOrIndex);
            if (!isNaN(numIdx) && numIdx >= 0 && numIdx < hls.subtitleTracks.length) {
              hls.subtitleTrack = numIdx;
              return;
            }
            const matchIdx = hls.subtitleTracks.findIndex(
              (t: any) => String(t.id) === String(trackIdOrIndex)
            );
            if (matchIdx >= 0) {
              hls.subtitleTrack = matchIdx;
              return;
            }
          }
        }

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
      [player, isNativeHlsSupported]
    );

    const applyVideoTrack = useCallback(
      (trackIdOrIndex: string | number | undefined) => {
        // Web & webOS HLS.js
        if (Platform.OS === "web" && !isNativeHlsSupported && hlsRef.current) {
          const hls = hlsRef.current;
          if (trackIdOrIndex === undefined || trackIdOrIndex === -1 || trackIdOrIndex === "-1") {
            hls.currentLevel = -1; // Auto bitrate
            return;
          }
          const numIdx = Number(trackIdOrIndex);
          if (!isNaN(numIdx) && numIdx >= 0 && hls.levels && numIdx < hls.levels.length) {
            hls.currentLevel = numIdx;
            return;
          }
        }

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
      [player, streamUrl, headers, isNativeHlsSupported]
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
          endedRef.current = false;
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
          // If running on web, suppress native expo-video error since Hls.js manages playback
          if (Platform.OS === "web") {
            const msg = String(error?.message || "");
            if ((isHls && !isNativeHlsSupported) || msg.includes("MEDIA_ELEMENT_ERROR") || msg.includes("Format error")) {
              return;
            }
          }
          onBuffering?.(false);
          const aTracks = normalizeAudioTracks(player.availableAudioTracks || []);
          onError?.(error || new Error("Playback error"), aTracks);
        } else if (status === "idle" && isLive && !isFirstLoadRef.current) {
          // If Live TV reaches idle state after having started, the stream dropped/ended
          if (!endedRef.current) {
            endedRef.current = true;
            onEnd?.();
          }
        }
      });

      /**
       * `playingChange(false)` does NOT mean the viewer paused.
       *
       * expo-video reports `playing` as "actively rendering", so it drops to
       * false for a user pause, for a rebuffer, and for a dropped connection
       * alike. Forwarding all three as `onPaused` was the whole reason a
       * dropped stream never came back: the screen turns that into
       * `setIsPlaying(false)`, which it feeds straight back in as
       * `paused={true}`, so the effect above calls `player.pause()` and a
       * transient stall latches into a real, permanent pause. The freeze
       * watchdog is gated on the same flag, so it stopped looking at the exact
       * moment it was needed.
       *
       * `pausedRef` is the arbiter, and it is reliable in the direction that
       * matters: a deliberate pause always sets the prop *before* the native
       * call that makes the player stop, so by the time this event arrives the
       * ref is already true. Anything else is involuntary, and involuntary is
       * reported as buffering — which is what a stall is, and which the stall
       * watchdog already knows how to escalate into a reconnect.
       */
      const subPlaying = player.addListener("playingChange", ({ isPlaying }: any) => {
        if (isPlaying) {
          endedRef.current = false;
          onPlaying?.();
          onBuffering?.(false);
          return;
        }
        if (pausedRef.current) {
          onPaused?.();
        } else if (!endedRef.current) {
          onBuffering?.(true);
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
        // Recorded before the handler runs: the `playingChange(false)` that
        // follows the end of a file is not a stall, and must not be escalated
        // into a reconnect.
        if (!endedRef.current) {
          endedRef.current = true;
          onEnd?.();
        }
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
          if (Platform.OS === "web" && !isNativeHlsSupported && videoElRef.current) {
            videoElRef.current.play().catch(() => {});
          } else {
            try {
              player.play();
            } catch {}
          }
        },
        pause: () => {
          if (Platform.OS === "web" && !isNativeHlsSupported && videoElRef.current) {
            videoElRef.current.pause();
          } else {
            try {
              player.pause();
            } catch {}
          }
        },
        seekTo: (positionMs: number) => {
          const seconds = Math.max(0, positionMs / 1000);
          if (Platform.OS === "web" && !isNativeHlsSupported && videoElRef.current) {
            videoElRef.current.currentTime = seconds;
            if (!pausedRef.current && videoElRef.current.paused) {
              videoElRef.current.play().catch(() => {});
            }
          } else {
            try {
              player.currentTime = seconds;
              if (!pausedRef.current && !player.playing) {
                player.play();
              }
            } catch {}
          }
        },
        seekBy: (deltaSeconds: number) => {
          if (Platform.OS === "web" && !isNativeHlsSupported && videoElRef.current) {
            videoElRef.current.currentTime += deltaSeconds;
          } else {
            try {
              player.seekBy(deltaSeconds);
            } catch {}
          }
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
          isFirstLoadRef.current = true;
          const normalized = normalizeStreamUrlForWeb(streamUrl);
          if (Platform.OS === "web" && isHls && !isNativeHlsSupported) {
            if (hlsRef.current) {
              hlsRef.current.loadSource(normalized);
              hlsRef.current.startLoad();
            }
            return;
          }
          if (!player) return;
          try {
            await player.replaceAsync({
              uri: Platform.OS === "web" ? normalized : streamUrl,
              headers: effectiveHeaders,
            });
            if (!paused && autoPlay) {
              player.play();
            }
          } catch (err) {
            console.warn("[ExpoVideoPlayer] reloadSource error:", err);
          }
        },
        getPlayer: () => player,
        isPlaying: () => {
          if (Platform.OS === "web" && !isNativeHlsSupported && videoElRef.current) {
            return !videoElRef.current.paused;
          }
          try {
            return !!player?.playing;
          } catch {
            return false;
          }
        },
        getAudioTracks: () => {
          if (Platform.OS === "web" && !isNativeHlsSupported) {
            if (hlsRef.current?.audioTracks?.length) {
              return normalizeHlsAudioTracks(hlsRef.current.audioTracks);
            }
            const domTracks = (videoElRef.current as any)?.audioTracks;
            if (domTracks?.length) {
              return normalizeDomAudioTracks(domTracks);
            }
          }
          return normalizeAudioTracks(player.availableAudioTracks || []);
        },
        getSubtitleTracks: () => {
          if (Platform.OS === "web" && !isNativeHlsSupported) {
            if (hlsRef.current?.subtitleTracks?.length) {
              return normalizeHlsSubtitleTracks(hlsRef.current.subtitleTracks);
            }
          }
          return normalizeSubtitleTracks(player.availableSubtitleTracks || []);
        },
        getVideoTracks: () => {
          if (Platform.OS === "web" && !isNativeHlsSupported) {
            if (hlsRef.current?.levels?.length) {
              return normalizeHlsLevels(hlsRef.current.levels);
            }
          }
          return normalizeVideoTracks(player.availableVideoTracks || []);
        },
      }),
      [player, streamUrl, headers, paused, autoPlay, applyAudioTrack, applySubtitleTrack, applyVideoTrack, isNativeHlsSupported]
    );

    return (
      <View ref={containerRef} style={[styles.container, style]}>
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
