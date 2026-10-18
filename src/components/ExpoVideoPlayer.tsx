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
import { BufferTuning, isPlayableStreamUrl } from "../services/stbEnvironment";
import { setupWebOSVideoSource, isWebOS, activateWebOSAudioTracks, convertSrtToVtt } from "../utils/webosUtils";

/**
 * Checks for native browser HLS support without MSE (only Apple Safari / iOS WebKit).
 * LG webOS TV and Chromium-based browsers use Media Source Extensions (MSE) with MPEGTS.js, HLS.js, or Shaka Player.
 */
function checkNativeHlsSupport(): boolean {
  if (Platform.OS !== "web" || typeof document === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  try {
    const ua = navigator.userAgent || "";
    const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
    const video = document.createElement("video");
    const canPlay = video.canPlayType("application/vnd.apple.mpegurl");
    if (isSafari && canPlay !== "") {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

const FORBIDDEN_XHR_HEADERS = new Set([
  "accept-charset",
  "accept-encoding",
  "access-control-request-headers",
  "access-control-request-method",
  "connection",
  "content-length",
  "cookie",
  "cookie2",
  "date",
  "dnt",
  "expect",
  "host",
  "keep-alive",
  "origin",
  "referer",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "user-agent",
  "via",
]);

// Install safe MediaSource addSourceBuffer guard for web/webOS browsers
if (typeof window !== "undefined" && typeof (window as any).MediaSource !== "undefined" && !(window as any).__mseGuardInstalled) {
  (window as any).__mseGuardInstalled = true;
  const MS = (window as any).MediaSource;
  const origAddSourceBuffer = MS.prototype.addSourceBuffer;
  MS.prototype.addSourceBuffer = function(type: string) {
    try {
      return origAddSourceBuffer.call(this, type);
    } catch (err: any) {
      if (type.includes("audio") && (type.includes("ac-3") || type.includes("ec-3") || (MS.isTypeSupported && !MS.isTypeSupported(type)))) {
        console.warn("[MediaSource Guard] Intercepted unsupported audio codec in addSourceBuffer:", type);
        if (typeof (window as any).__onUnsupportedMseCodec === "function") {
          setTimeout(() => {
            try { (window as any).__onUnsupportedMseCodec(type); } catch {}
          }, 20);
        }
        const dummy: any = {
          updating: false,
          buffered: { length: 0, start: () => 0, end: () => 0 },
          appendBuffer: function() {
            this.updating = true;
            setTimeout(() => {
              this.updating = false;
              if (this.onupdateend) this.onupdateend();
              if (typeof this.dispatchEvent === "function") this.dispatchEvent(new Event("updateend"));
            }, 5);
          },
          remove: function() {},
          abort: function() {},
          addEventListener: function(evt: string, fn: any) {
            this["on" + evt] = fn;
          },
          removeEventListener: function() {},
          dispatchEvent: function(e: any) {
            if (this["on" + e.type]) this["on" + e.type](e);
          }
        };
        return dummy as SourceBuffer;
      }
      throw err;
    }
  };
  const origRemoveSourceBuffer = MS.prototype.removeSourceBuffer;
  MS.prototype.removeSourceBuffer = function(sb: any) {
    try {
      return origRemoveSourceBuffer.call(this, sb);
    } catch {
      // Ignored for dummy non-native source buffers
    }
  };
}

/**
 * Preserves the stream URL for web playback.
 * We no longer blindly rewrite .ts to .m3u8 because Xtream Codes servers often
 * bind tokens specifically to MPEG-TS (.ts) streams and return 401 Unauthorized for .m3u8.
 * mpegts.js handles raw .ts streams via MSE natively.
 */
function normalizeStreamUrlForWeb(url: string | null | undefined): string {
  return (url || "").trim();
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
  mimeType?: string;
  format?: {
    sampleMimeType?: string;
  };
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
 * Normalizes variant audio tracks from Shaka Player
 */
function normalizeShakaAudioTracks(tracks: any[]): NormalizedTrackOption[] {
  const seen = new Set<string>();
  const result: NormalizedTrackOption[] = [];
  (tracks || []).forEach((t, idx) => {
    if (!t.audioCodec && !t.language && !t.label) return;
    const key = `${t.language || ""}_${t.audioCodec || ""}_${t.channelsCount || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    const lang = t.language || "";
    const label = t.label || (lang ? lang.toUpperCase() : `Audio ${result.length + 1}`);
    result.push({
      id: t.id ?? idx,
      index: idx,
      title: label,
      name: label,
      language: lang,
      isSupported: true,
      raw: t,
    });
  });
  return result;
}

/**
 * Normalizes text tracks from Shaka Player
 */
function normalizeShakaTextTracks(tracks: any[]): NormalizedTrackOption[] {
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
    const lang = t.language || "";
    const label = t.label || (lang ? lang.toUpperCase() : `Subtitle ${idx + 1}`);
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
 * Normalizes video tracks from Shaka Player
 */
function normalizeShakaVideoTracks(tracks: any[]): NormalizedTrackOption[] {
  const seen = new Set<number>();
  const result: NormalizedTrackOption[] = [];
  (tracks || []).forEach((t, idx) => {
    const h = t.height;
    const w = t.width;
    if (!h && !w) return;
    if (seen.has(h)) return;
    seen.add(h);
    let label = "Auto";
    if (h >= 2160 || w >= 3840) label = "4K UHD";
    else if (h >= 1440) label = "2K QHD";
    else if (h >= 1080) label = "1080p FHD";
    else if (h >= 720) label = "720p HD";
    else if (h >= 480) label = "480p SD";
    else label = `${h}p`;

    result.push({
      id: t.id ?? idx,
      index: idx,
      title: label,
      name: label,
      width: w,
      height: h,
      bitrate: t.bandwidth,
      raw: t,
    });
  });
  return result.sort((a, b) => (b.height || 0) - (a.height || 0));
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
      const lower = label.toLowerCase();
      let mime = "audio/mp4a-latm";
      if (lower.includes("eac3") || lower.includes("ec-3") || lower.includes("dolby digital plus")) {
        mime = "audio/eac3";
      } else if (lower.includes("ac3") || lower.includes("ac-3") || lower.includes("dolby")) {
        mime = "audio/ac3";
      } else if (lower.includes("dts")) {
        mime = "audio/vnd.dts";
      } else if (lower.includes("mp3") || lower.includes("mpeg")) {
        mime = "audio/mpeg";
      } else if (lower.includes("opus")) {
        mime = "audio/opus";
      }
      tracks.push({
        id: t.id ?? i,
        index: i,
        title: label,
        name: label,
        language: t.language || "",
        mimeType: mime,
        format: {
          sampleMimeType: mime,
        },
        isSupported: true,
        raw: t,
      });
    }
  } catch {}
  return tracks;
}

/**
 * Normalizes native DOM TextTrackList into NormalizedTrackOption
 */
function normalizeDomTextTracks(textTrackList: any): NormalizedTrackOption[] {
  const result: NormalizedTrackOption[] = [
    {
      id: -1,
      index: -1,
      title: "Disable Subtitles",
      name: "Disable Subtitles",
      language: "",
    },
  ];
  if (!textTrackList) return result;
  try {
    for (let i = 0; i < textTrackList.length; i++) {
      const t = textTrackList[i];
      const label = t.label || (t.language ? t.language.toUpperCase() : `Subtitle ${i + 1}`);
      result.push({
        id: i,
        index: i,
        title: label,
        name: label,
        language: t.language || "",
        raw: t,
      });
    }
  } catch {}
  return result;
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
    minBufferSec = isLive ? 0.5 : 0.8;
    forwardBufferSec = isLive
      ? Math.max(20.0, baseCacheSec * 3)
      : Math.max(30.0, baseCacheSec * 4);
  } else if (profile === "smooth") {
    minBufferSec = isLive ? 2.0 : 2.5;
    forwardBufferSec = isLive
      ? Math.max(45.0, baseCacheSec * 5)
      : Math.max(60.0, baseCacheSec * 6);
  } else {
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
    const mpegtsRef = useRef<any>(null);
    const hlsRef = useRef<any>(null);
    const shakaRef = useRef<any>(null);
    const videoElRef = useRef<HTMLVideoElement | null>(null);
    const activeEngineRef = useRef<"mpegts" | "hls" | "shaka" | "native" | "none">("none");

    const isNativeHlsSupported = useMemo(() => checkNativeHlsSupport(), []);

    const effectiveHeaders = useMemo(() => {
      return {
        "User-Agent": "okhttp/3.12.1",
        "Accept": "*/*",
        "Range": "bytes=0-",
        "Connection": "keep-alive",
        "Icy-MetaData": "1",
        ...(headers || {}),
      };
    }, [headers]);

    /**
     * The `paused` prop, readable from the event listeners.
     */
    const pausedRef = useRef(paused);

    /** Set by `playToEnd`; distinguishes "finished" from "stopped dead". */
    const endedRef = useRef(false);

    // Build referentially stable VideoSource object for native expo-video
    const source = useMemo<VideoSource | null>(() => {
      if (!streamUrl || !isPlayableStreamUrl(streamUrl)) {
        return null;
      }
      if (Platform.OS === "web") {
        return null;
      }
      return {
        uri: streamUrl,
        headers: effectiveHeaders,
      };
    }, [streamUrl, effectiveHeaders]);

    // Initialize the native player with tuned buffer options
    const player = useVideoPlayer(source as any, (p) => {
      p.loop = false;
      p.timeUpdateEventInterval = 0.25;
      p.playbackRate = rate;
      p.volume = volume > 1 ? volume / 100 : volume;
      p.audioMixingMode = "auto";

      if (staysActiveInBackground) {
        try {
          p.staysActiveInBackground = true;
        } catch {}
      }

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
      if (Platform.OS === "web") {
        if (paused) {
          if (activeEngineRef.current === "mpegts" && mpegtsRef.current) {
            try { mpegtsRef.current.pause(); } catch {}
          }
          videoElRef.current?.pause();
        } else {
          if (activeEngineRef.current === "mpegts" && mpegtsRef.current) {
            try { mpegtsRef.current.play(); } catch {}
          }
          videoElRef.current?.play().catch(() => {});
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
    }, [player, paused]);

    // Synchronize playback speed
    useEffect(() => {
      if (Platform.OS === "web" && videoElRef.current) {
        videoElRef.current.playbackRate = rate;
        return;
      }
      if (!player) return;
      try {
        player.playbackRate = rate;
      } catch {}
    }, [player, rate]);

    // Synchronize volume
    useEffect(() => {
      const normVol = volume > 1 ? volume / 100 : volume;
      if (Platform.OS === "web" && videoElRef.current) {
        videoElRef.current.volume = normVol;
        return;
      }
      if (!player) return;
      try {
        player.volume = normVol;
      } catch {}
    }, [player, volume]);

    // Track selection helper methods
    const applyAudioTrack = useCallback(
      (trackIdOrIndex: string | number | undefined) => {
        if (trackIdOrIndex === undefined) return;

        // Web HLS.js
        if (Platform.OS === "web" && activeEngineRef.current === "hls" && hlsRef.current) {
          const hls = hlsRef.current;
          if (trackIdOrIndex === -1 || trackIdOrIndex === "-1" || trackIdOrIndex === "default") {
            hls.audioTrack = 0;
            return;
          }
          if (hls.audioTracks && hls.audioTracks.length > 0) {
            const numIdx = Number(trackIdOrIndex);
            if (!isNaN(numIdx) && numIdx >= 0 && numIdx < hls.audioTracks.length) {
              hls.audioTrack = numIdx;
              return;
            }
            const matchIdx = hls.audioTracks.findIndex(
              (t: any) => String(t.id) === String(trackIdOrIndex) || String(t.name) === String(trackIdOrIndex)
            );
            if (matchIdx >= 0) {
              hls.audioTrack = matchIdx;
              return;
            }
          }
        }

        // Web Shaka Player
        if (Platform.OS === "web" && activeEngineRef.current === "shaka" && shakaRef.current) {
          const shakaPlayer = shakaRef.current;
          const variants = shakaPlayer.getVariantTracks?.() || [];
          const match = variants.find(
            (t: any) => String(t.id) === String(trackIdOrIndex) || t.language === String(trackIdOrIndex)
          );
          if (match) {
            shakaPlayer.selectVariantTrack(match, true);
            return;
          }
        }

        // Web DOM HTMLMediaElement audio tracks (Safari / webOS native video)
        if (Platform.OS === "web" && videoElRef.current) {
          const isDisable = trackIdOrIndex === -1 || trackIdOrIndex === "-1" || trackIdOrIndex === null;
          if ((videoElRef.current as any).audioTracks) {
            const domTracks = (videoElRef.current as any).audioTracks;
            for (let i = 0; i < domTracks.length; i++) {
              const shouldEnable = !isDisable && (
                i === Number(trackIdOrIndex) ||
                String(domTracks[i].id) === String(trackIdOrIndex) ||
                domTracks[i].language === String(trackIdOrIndex) ||
                (trackIdOrIndex === "default" && i === 0)
              );
              domTracks[i].enabled = shouldEnable;
            }
          }
          if (isDisable) {
            videoElRef.current.muted = true;
          } else if (videoElRef.current.muted && !pausedRef.current) {
            videoElRef.current.muted = false;
          }
        }

        // Web mpegts.js mute toggle on disable
        if (Platform.OS === "web" && activeEngineRef.current === "mpegts" && videoElRef.current) {
          if (trackIdOrIndex === -1 || trackIdOrIndex === "-1") {
            videoElRef.current.muted = true;
          } else if (videoElRef.current.muted && !pausedRef.current) {
            videoElRef.current.muted = false;
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
      [player]
    );

    const applySubtitleTrack = useCallback(
      (trackIdOrIndex: string | number | undefined) => {
        // Web DOM text tracks
        if (Platform.OS === "web" && videoElRef.current?.textTracks) {
          const tracks = videoElRef.current.textTracks;
          const isDisable = trackIdOrIndex === undefined || trackIdOrIndex === -1 || trackIdOrIndex === "-1" || trackIdOrIndex === null;
          for (let i = 0; i < tracks.length; i++) {
            const shouldShow = !isDisable && (
              i === Number(trackIdOrIndex) ||
              String((tracks[i] as any).id) === String(trackIdOrIndex) ||
              tracks[i].language === String(trackIdOrIndex)
            );
            tracks[i].mode = shouldShow ? "showing" : "disabled";
          }
        }
        // Web HLS.js
        if (Platform.OS === "web" && activeEngineRef.current === "hls" && hlsRef.current) {
          const hls = hlsRef.current;
          if (trackIdOrIndex === undefined || trackIdOrIndex === -1 || trackIdOrIndex === "-1" || trackIdOrIndex === null) {
            hls.subtitleTrack = -1;
            if (videoElRef.current?.textTracks) {
              for (let i = 0; i < videoElRef.current.textTracks.length; i++) {
                videoElRef.current.textTracks[i].mode = "disabled";
              }
            }
            return;
          }
          if (hls.subtitleTracks && hls.subtitleTracks.length > 0) {
            const numIdx = Number(trackIdOrIndex);
            if (!isNaN(numIdx) && numIdx >= 0 && numIdx < hls.subtitleTracks.length) {
              hls.subtitleTrack = numIdx;
              if (videoElRef.current?.textTracks) {
                for (let i = 0; i < videoElRef.current.textTracks.length; i++) {
                  videoElRef.current.textTracks[i].mode = (i === numIdx ? "showing" : "disabled");
                }
              }
              return;
            }
            const matchIdx = hls.subtitleTracks.findIndex(
              (t: any) => String(t.id) === String(trackIdOrIndex) || String(t.name) === String(trackIdOrIndex)
            );
            if (matchIdx >= 0) {
              hls.subtitleTrack = matchIdx;
              if (videoElRef.current?.textTracks) {
                for (let i = 0; i < videoElRef.current.textTracks.length; i++) {
                  videoElRef.current.textTracks[i].mode = (i === matchIdx ? "showing" : "disabled");
                }
              }
              return;
            }
          }
        }

        // Web Shaka Player
        if (Platform.OS === "web" && activeEngineRef.current === "shaka" && shakaRef.current) {
          const shakaPlayer = shakaRef.current;
          if (trackIdOrIndex === undefined || trackIdOrIndex === -1 || trackIdOrIndex === "-1" || trackIdOrIndex === null) {
            shakaPlayer.setTextTrackVisibility(false);
            return;
          }
          shakaPlayer.setTextTrackVisibility(true);
          const textTracks = shakaPlayer.getTextTracks?.() || [];
          const match = textTracks.find(
            (t: any) => String(t.id) === String(trackIdOrIndex) || t.language === String(trackIdOrIndex)
          );
          if (match) {
            shakaPlayer.selectTextTrack(match);
            return;
          }
        }

        // Web DOM text tracks
        if (Platform.OS === "web" && videoElRef.current?.textTracks) {
          const tracks = videoElRef.current.textTracks;
          for (let i = 0; i < tracks.length; i++) {
            tracks[i].mode = (i === Number(trackIdOrIndex) ? "showing" : "disabled");
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
      [player]
    );

    const applyVideoTrack = useCallback(
      (trackIdOrIndex: string | number | undefined) => {
        // Web HLS.js
        if (Platform.OS === "web" && activeEngineRef.current === "hls" && hlsRef.current) {
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

        // Web Shaka Player
        if (Platform.OS === "web" && activeEngineRef.current === "shaka" && shakaRef.current) {
          const shakaPlayer = shakaRef.current;
          if (trackIdOrIndex === undefined || trackIdOrIndex === -1 || trackIdOrIndex === "-1") {
            shakaPlayer.configure({ abr: { enabled: true } });
            return;
          }
          shakaPlayer.configure({ abr: { enabled: false } });
          const variants = shakaPlayer.getVariantTracks?.() || [];
          const match = variants.find(
            (t: any) => String(t.id) === String(trackIdOrIndex) || t.height === Number(trackIdOrIndex)
          );
          if (match) {
            shakaPlayer.selectVariantTrack(match, true);
            return;
          }
        }

        if (!player) return;
        const available = player.availableVideoTracks || [];
        videoTracksRef.current = available;
        if (trackIdOrIndex === undefined) {
          return;
        }
        const match = available.find(
          (t, idx) => t.id === String(trackIdOrIndex) || idx === Number(trackIdOrIndex)
        );
        const matchUrl = (match as any)?.url;
        if (match && matchUrl && matchUrl !== streamUrl) {
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

    const onLoadRef = useRef(onLoad);
    onLoadRef.current = onLoad;
    const onTracksChangeRef = useRef(onTracksChange);
    onTracksChangeRef.current = onTracksChange;
    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;
    const onBufferingRef = useRef(onBuffering);
    onBufferingRef.current = onBuffering;
    const onPlayingRef = useRef(onPlaying);
    onPlayingRef.current = onPlaying;
    const onPausedRef = useRef(onPaused);
    onPausedRef.current = onPaused;
    const onEndRef = useRef(onEnd);
    onEndRef.current = onEnd;
    const onProgressRef = useRef(onProgress);
    onProgressRef.current = onProgress;
    const headersRef = useRef(effectiveHeaders);
    headersRef.current = effectiveHeaders;
    const autoPlayRef = useRef(autoPlay);
    autoPlayRef.current = autoPlay;

    // Web & webOS TV Media Engine (Unified mpegts.js + HLS.js + Shaka Player + Native hardware fallback)
    useEffect(() => {
      if (Platform.OS !== "web" || !streamUrl || !isPlayableStreamUrl(streamUrl)) return;

      let isCancelled = false;
      let mpegtsInstance: any = null;
      let hlsInstance: any = null;
      let shakaInstance: any = null;
      let animFrameId: any = null;
      let boundVideoEl: HTMLVideoElement | null = null;
      let stallTimer: any = null;
      const normalized = normalizeStreamUrlForWeb(streamUrl);
      const isTsStream = /\.ts(\?.*)?$/i.test(normalized) || (isLive && !/\.m3u8(\?.*)?$/i.test(normalized));
      const isHlsStream = /\.m3u8(\?.*)?$/i.test(normalized);
      const isDashStream = /\.mpd(\?.*)?$/i.test(normalized);

      // Event listener functions for HTMLVideoElement
      const onTimeUpdate = () => {
        if (!boundVideoEl) return;
        const currentMs = Math.round((boundVideoEl.currentTime || 0) * 1000);
        const durationMs = Math.round((boundVideoEl.duration || 0) * 1000);
        lastProgressEmitTime.current = Date.now();
        onProgressRef.current?.(currentMs, durationMs);
        if (boundVideoEl.currentTime > 0) {
          onBufferingRef.current?.(false);
        }
      };

      const onPlayingHandler = () => {
        if (stallTimer) clearTimeout(stallTimer);
        onBufferingRef.current?.(false);
        onPlayingRef.current?.();
      };

      const onCanPlayHandler = () => {
        onBufferingRef.current?.(false);
        onPlayingRef.current?.();
        if (!pausedRef.current && autoPlayRef.current && boundVideoEl?.paused) {
          boundVideoEl.play().catch(() => {});
        }
      };

      const onLoadedDataHandler = () => {
        onBufferingRef.current?.(false);
        onPlayingRef.current?.();
        if (!pausedRef.current && autoPlayRef.current && boundVideoEl?.paused) {
          boundVideoEl.play().catch(() => {});
        }
      };

      const onWaitingHandler = () => {
        onBufferingRef.current?.(true);
      };

      const onPauseHandler = () => {
        if (!pausedRef.current) {
          if (autoPlayRef.current && boundVideoEl) {
            boundVideoEl.play().catch(() => {});
          }
          return;
        }
        onPausedRef.current?.();
      };

      const onEndedHandler = () => {
        endedRef.current = true;
        onEndRef.current?.();
      };

      const onErrorHandler = () => {
        if (!boundVideoEl) return;
        const err = boundVideoEl.error;
        if (err) {
          console.warn("[Web Video] Element error code:", err.code, err.message);
          // If native pipeline failed on MPEG-TS and mpegts hasn't been tried, attempt mpegts fallback
          if (activeEngineRef.current === "native" && isTsStream && !mpegtsInstance) {
            console.log("[Web Video] Native pipeline encountered error on TS; attempting mpegts fallback...");
            const ok = initMpegtsEngine(boundVideoEl, normalized);
            if (ok) return;
          }
          onErrorRef.current?.(new Error(err.message || `Media playback error (code ${err.code})`));
        }
      };

      const fallbackToNativeSource = () => {
        if (!boundVideoEl || isCancelled) return;
        activeEngineRef.current = "native";
        console.log("[webOS Video] Using native webOS media pipeline for:", normalized);
        setupWebOSVideoSource(boundVideoEl, normalized, isLive, undefined, effectiveHeaders);

        const onNativeLoaded = () => {
          if (boundVideoEl) {
            activateWebOSAudioTracks(boundVideoEl);
          }
          if (isFirstLoadRef.current) {
            isFirstLoadRef.current = false;
            const durationMs = Math.round((boundVideoEl?.duration || 0) * 1000);
            const domAudio = (boundVideoEl as any)?.audioTracks ? normalizeDomAudioTracks((boundVideoEl as any).audioTracks) : [];
            const domText = boundVideoEl?.textTracks ? normalizeDomTextTracks(boundVideoEl.textTracks) : [];
            onLoadRef.current?.({
              duration: durationMs,
              audioTracks: domAudio,
              textTracks: domText,
              videoTracks: [],
              naturalSize: boundVideoEl?.videoWidth && boundVideoEl?.videoHeight
                ? { width: boundVideoEl.videoWidth, height: boundVideoEl.videoHeight }
                : undefined,
              currentAudioTrack: domAudio[0],
            });
          }
          if (!pausedRef.current && autoPlayRef.current) {
            boundVideoEl?.play().catch(() => {});
          }
          onPlayingRef.current?.();
        };

        boundVideoEl.addEventListener("loadedmetadata", onNativeLoaded, { once: true });
        boundVideoEl.addEventListener("canplay", onNativeLoaded, { once: true });

        const firstSource = boundVideoEl.querySelector("source");
        if (firstSource) {
          firstSource.addEventListener("error", () => {
            console.warn("[webOS Video] Native source element failed to load; attempting mpegts fallback...");
            if (isTsStream && !mpegtsInstance && boundVideoEl) {
              initMpegtsEngine(boundVideoEl, normalized);
            }
          }, { once: true });
        }
      };

      const initHlsEngine = (videoEl: HTMLVideoElement, url: string): boolean => {
        try {
          const HlsModule = require("hls.js");
          const HlsClass = HlsModule.default || HlsModule;
          if (HlsClass && HlsClass.isSupported && HlsClass.isSupported()) {
            console.log("[Web Video] Initializing Hls.js for URL:", url);
            hlsInstance = new HlsClass({
              enableWorker: true,
              lowLatencyMode: isLive,
              backBufferLength: isLive ? 15 : 60,
              maxBufferLength: isLive ? 25 : 60,
              maxMaxBufferLength: isLive ? 40 : 120,
              maxBufferSize: 60 * 1000 * 1000,
              enableWebVTT: true,
              enableCEA708Captions: true,
              renderTextTracksNatively: true,
              xhrSetup: (xhr: XMLHttpRequest) => {
                const hdrs = headersRef.current;
                if (hdrs) {
                  for (const [k, v] of Object.entries(hdrs)) {
                    if (FORBIDDEN_XHR_HEADERS.has(k.toLowerCase())) continue;
                    try {
                      xhr.setRequestHeader(k, v);
                    } catch (e) {}
                  }
                }
              },
            });
            hlsRef.current = hlsInstance;
            activeEngineRef.current = "hls";
            hlsInstance.loadSource(url);
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
                onLoadRef.current?.({
                  duration: durationMs,
                  audioTracks: aTracks,
                  textTracks: sTracks,
                  videoTracks: vTracks,
                  naturalSize: vTracks[0]?.width && vTracks[0]?.height ? { width: vTracks[0].width, height: vTracks[0].height } : undefined,
                  currentAudioTrack: currentAudio,
                });
              } else {
                onTracksChangeRef.current?.({
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
              if (!pausedRef.current && autoPlayRef.current) {
                videoEl.play().catch(() => {});
              }
            });

            hlsInstance.on(HlsClass.Events.AUDIO_TRACKS_UPDATED, () => emitHlsTracks(false));
            hlsInstance.on(HlsClass.Events.AUDIO_TRACK_SWITCHED, () => emitHlsTracks(false));
            hlsInstance.on(HlsClass.Events.SUBTITLE_TRACKS_UPDATED, () => emitHlsTracks(false));
            hlsInstance.on(HlsClass.Events.LEVEL_SWITCHED, () => emitHlsTracks(false));

            let manifestRetryCount = 0;
            hlsInstance.on(HlsClass.Events.ERROR, async (_: any, data: any) => {
              if (data.fatal) {
                switch (data.type) {
                  case HlsClass.ErrorTypes.NETWORK_ERROR:
                    if (data.response?.code === 401 || data.response?.code === 403) {
                      onErrorRef.current?.(new Error(`Stream authorization error (HTTP ${data.response?.code})`));
                      break;
                    }
                    if (data.details === "manifestLoadError") {
                      manifestRetryCount++;
                      if (manifestRetryCount > 2) {
                        console.warn("[webOS HLS] Manifest load failed repeatedly, attempting fallback...");
                        try { hlsInstance.destroy(); } catch {}
                        hlsRef.current = null;
                        fallbackToNativeSource();
                        break;
                      }
                    }
                    hlsInstance.startLoad();
                    break;
                  case HlsClass.ErrorTypes.MEDIA_ERROR:
                    console.warn("[webOS HLS] Media error, recovering...", data.details);
                    hlsInstance.recoverMediaError();
                    break;
                  default:
                    console.warn("[webOS HLS] Fatal stream error, attempting engine switch:", data);
                    try { hlsInstance.destroy(); } catch {}
                    hlsRef.current = null;
                    fallbackToNativeSource();
                    break;
                }
              }
            });
            return true;
          }
        } catch (hlsErr) {
          console.warn("[webOS Video] Hls.js initialization error:", hlsErr);
        }
        return false;
      };

      const initShakaEngine = async (videoEl: HTMLVideoElement) => {
        try {
          const shaka = require("shaka-player");
          shaka.polyfill.installAll();
          if (shaka.Player && shaka.Player.isBrowserSupported()) {
            const player = new shaka.Player(videoEl);
            shakaInstance = player;
            shakaRef.current = player;
            activeEngineRef.current = "shaka";

            player.configure({
              streaming: {
                rebufferingGoal: isLive ? 3 : 6,
                bufferingGoal: isLive ? 15 : 30,
                stallEnabled: true,
                lowLatencyMode: isLive,
              },
              manifest: {
                retryParameters: { maxAttempts: 3, timeout: 10000 },
              },
            });

            player.addEventListener("error", (event: any) => {
              console.warn("[Shaka Player Error]", event.detail);
              if (event.detail?.code === 7000 || event.detail?.code === 7002) {
                fallbackToNativeSource();
              }
            });

            await player.load(normalized);
            if (isCancelled) return true;

            const emitShakaTracks = (isInitial: boolean) => {
              const variants = player.getVariantTracks() || [];
              const textTracks = player.getTextTracks() || [];
              const aTracks = normalizeShakaAudioTracks(variants);
              const sTracks = normalizeShakaTextTracks(textTracks);
              const vTracks = normalizeShakaVideoTracks(variants);
              const currentVariant = variants.find((t: any) => t.active);
              const currentAudio = aTracks.find((t: any) => t.raw?.id === currentVariant?.id) || aTracks[0];

              if (isInitial) {
                const durationMs = Math.round((videoEl.duration || 0) * 1000);
                onLoadRef.current?.({
                  duration: durationMs,
                  audioTracks: aTracks,
                  textTracks: sTracks,
                  videoTracks: vTracks,
                  naturalSize: vTracks[0]?.width && vTracks[0]?.height ? { width: vTracks[0].width, height: vTracks[0].height } : undefined,
                  currentAudioTrack: currentAudio,
                });
              } else {
                onTracksChangeRef.current?.({
                  audioTracks: aTracks,
                  textTracks: sTracks,
                  videoTracks: vTracks,
                  currentAudioTrack: currentAudio,
                });
              }
            };

            emitShakaTracks(true);

            if (!pausedRef.current && autoPlayRef.current) {
              videoEl.play().catch(() => {});
            }
            return true;
          }
        } catch (shakaErr) {
          console.warn("[Shaka Player] Initialization error:", shakaErr);
        }
        return false;
      };

      const initMpegtsEngine = (videoEl: HTMLVideoElement, url: string): boolean => {
        try {
          const mpegts = require("mpegts.js");
          const mpegtsClass = mpegts.default || mpegts;
          if (mpegtsClass && mpegtsClass.isSupported && mpegtsClass.isSupported()) {
            console.log("[Web Video] Initializing mpegts.js for MPEG-TS stream:", url);
            const mpegtsPlayer = mpegtsClass.createPlayer(
              {
                type: "mpegts",
                isLive: isLive,
                url: url,
                cors: false,
              },
              {
                enableWorker: true,
                enableStashBuffer: true,
                stashInitialSize: 384 * 1024,
                liveBufferLatencyChasing: false,
                autoCleanupSourceBuffer: true,
                autoCleanupMaxBackwardDuration: 15,
                autoCleanupMinBackwardDuration: 8,
                fixAudioTimestampGap: true,
                lazyLoad: false,
                headers: headersRef.current,
              }
            );
            mpegtsInstance = mpegtsPlayer;
            mpegtsRef.current = mpegtsPlayer;
            activeEngineRef.current = "mpegts";

            mpegtsPlayer.attachMediaElement(videoEl);
            mpegtsPlayer.load();

            mpegtsPlayer.on(mpegtsClass.Events.MEDIA_INFO, (info: any) => {
              console.log("[mpegts.js] Media info received:", info);
              const aTracks: NormalizedTrackOption[] = [
                {
                  id: 0,
                  index: 0,
                  title: info.audioCodec ? `${String(info.audioCodec).toUpperCase()} Audio` : "Default Audio",
                  name: info.audioCodec ? `${String(info.audioCodec).toUpperCase()} Audio` : "Default Audio",
                  language: "und",
                  isSupported: true,
                  raw: info,
                },
              ];
              const vTracks: NormalizedTrackOption[] = [];
              if (info.width && info.height) {
                let label = `${info.height}p`;
                if (info.height >= 2160 || info.width >= 3840) label = "4K UHD";
                else if (info.height >= 1440) label = "2K QHD";
                else if (info.height >= 1080) label = "1080p FHD";
                else if (info.height >= 720) label = "720p HD";
                else if (info.height >= 480) label = "480p SD";
                vTracks.push({
                  id: 0,
                  index: 0,
                  title: label,
                  name: label,
                  width: info.width,
                  height: info.height,
                  bitrate: info.videoBitrate,
                  raw: info,
                });
              }

              if (isFirstLoadRef.current) {
                isFirstLoadRef.current = false;
                onLoadRef.current?.({
                  duration: Math.round((videoEl.duration || 0) * 1000),
                  audioTracks: aTracks,
                  textTracks: [],
                  videoTracks: vTracks,
                  naturalSize: info.width && info.height ? { width: info.width, height: info.height } : undefined,
                  currentAudioTrack: aTracks[0],
                });
              } else {
                onTracksChangeRef.current?.({
                  audioTracks: aTracks,
                  textTracks: [],
                  videoTracks: vTracks,
                  currentAudioTrack: aTracks[0],
                });
              }
            });

            let mpegtsRetryCount = 0;
            mpegtsPlayer.on(mpegtsClass.Events.ERROR, (errorType: string, errorDetail: string, errorInfo: any) => {
              console.warn("[mpegts.js] Error:", errorType, errorDetail, errorInfo);
              const statusCode = errorInfo?.code || errorInfo?.statusCode;
              if (statusCode === 401 || statusCode === 403 || statusCode === 404) {
                try { mpegtsPlayer.unload(); } catch {}
                onErrorRef.current?.(new Error(`Stream HTTP ${statusCode} (Stream offline or unauthorized)`));
                return;
              }
              if (errorType === mpegtsClass.ErrorTypes.NETWORK_ERROR) {
                if (mpegtsRetryCount < 2) {
                  mpegtsRetryCount++;
                  console.log(`[mpegts.js] Transient network error, retry attempt ${mpegtsRetryCount}...`);
                  setTimeout(() => {
                    try {
                      mpegtsPlayer.unload();
                      mpegtsPlayer.load();
                    } catch {
                      fallbackToNativeSource();
                    }
                  }, 1500);
                } else {
                  fallbackToNativeSource();
                }
              } else {
                onErrorRef.current?.(new Error(`Playback engine error: ${errorDetail || errorType}`));
              }
            });

            (window as any).__onUnsupportedMseCodec = (codecType: string) => {
              console.log("[Web Video] Unsupported MSE audio codec (" + codecType + "), switching to native webOS pipeline...");
              try {
                mpegtsPlayer.unload();
                mpegtsPlayer.detachMediaElement();
                mpegtsPlayer.destroy();
              } catch {}
              if (mpegtsRef.current === mpegtsPlayer) {
                mpegtsRef.current = null;
              }
              fallbackToNativeSource();
            };

            if (!pausedRef.current && autoPlayRef.current) {
              mpegtsPlayer.play();
            }
            return true;
          }
        } catch (mpegtsErr) {
          console.warn("[Web Video] mpegts.js failed to initialize:", mpegtsErr);
        }
        return false;
      };

      const initWebPlayer = async () => {
        if (isCancelled) return;
        const videoEl = videoElRef.current;
        if (!videoEl) {
          animFrameId = requestAnimationFrame(initWebPlayer);
          return;
        }
        boundVideoEl = videoEl;

        // Attach standard HTML5 media event listeners
        videoEl.addEventListener("timeupdate", onTimeUpdate);
        videoEl.addEventListener("playing", onPlayingHandler);
        videoEl.addEventListener("canplay", onCanPlayHandler);
        videoEl.addEventListener("loadeddata", onLoadedDataHandler);
        videoEl.addEventListener("waiting", onWaitingHandler);
        videoEl.addEventListener("pause", onPauseHandler);
        videoEl.addEventListener("ended", onEndedHandler);
        videoEl.addEventListener("error", onErrorHandler);

        // Autoplay kickstart watchdog for webOS TV
        stallTimer = setTimeout(() => {
          if (!isCancelled && boundVideoEl && boundVideoEl.paused && !pausedRef.current && autoPlayRef.current) {
            console.log("[Web Video Watchdog] Kickstarting playback...");
            boundVideoEl.play().catch((playErr) => {
              console.warn("[Web Video Watchdog] Playback attempt error:", playErr);
            });
          }
        }, 2500);

        const isWebOSTV = isWebOS();

        // Engine Path 1: MPEG-TS streams (.ts or live stream URLs)
        // If native hardware video/mp2t is genuinely supported (physical webOS TV):
        // use native webOS hardware pipeline.
        // In webOS Simulator, desktop browsers, or when native mp2t is not supported by Blink:
        // use mpegts.js (MSE).
        if (isTsStream) {
          const nativeMp2tSupported = typeof videoEl.canPlayType === "function" && (
            videoEl.canPlayType("video/mp2t") !== "" ||
            videoEl.canPlayType("video/mp2t; codecs=\"avc1.42E01E\"") !== ""
          );

          if (isWebOSTV && nativeMp2tSupported) {
            console.log("[webOS Video] Utilizing native webOS hardware pipeline for MPEG-TS stream:", normalized);
            fallbackToNativeSource();
            return;
          }

          const mpegtsOk = initMpegtsEngine(videoEl, normalized);
          if (mpegtsOk) return;
        }

        // Engine Path 2: Hls.js for HLS streams (.m3u8)
        if (isHlsStream) {
          const hlsOk = initHlsEngine(videoEl, normalized);
          if (hlsOk) return;
        }

        // Engine Path 3: Shaka Player for DASH (.mpd), progressive MP4/WebM, or VOD
        if (isDashStream || (!isTsStream && !isHlsStream)) {
          const shakaOk = await initShakaEngine(videoEl);
          if (shakaOk) return;
        }

        // Engine Path 4: Fallback native webOS video source
        fallbackToNativeSource();
      };

      initWebPlayer();

      return () => {
        isCancelled = true;
        if (animFrameId) {
          cancelAnimationFrame(animFrameId);
        }
        if (stallTimer) {
          clearTimeout(stallTimer);
        }
        if (boundVideoEl) {
          boundVideoEl.removeEventListener("timeupdate", onTimeUpdate);
          boundVideoEl.removeEventListener("playing", onPlayingHandler);
          boundVideoEl.removeEventListener("canplay", onCanPlayHandler);
          boundVideoEl.removeEventListener("loadeddata", onLoadedDataHandler);
          boundVideoEl.removeEventListener("waiting", onWaitingHandler);
          boundVideoEl.removeEventListener("pause", onPauseHandler);
          boundVideoEl.removeEventListener("ended", onEndedHandler);
          boundVideoEl.removeEventListener("error", onErrorHandler);
        }
        if (mpegtsInstance) {
          try {
            mpegtsInstance.unload();
            mpegtsInstance.detachMediaElement();
            mpegtsInstance.destroy();
          } catch {}
          if (mpegtsRef.current === mpegtsInstance) {
            mpegtsRef.current = null;
          }
        }
        if (typeof window !== "undefined") {
          (window as any).__onUnsupportedMseCodec = null;
        }
        if (hlsInstance) {
          try {
            hlsInstance.destroy();
          } catch {}
          if (hlsRef.current === hlsInstance) {
            hlsRef.current = null;
          }
        }
        if (shakaInstance) {
          try {
            shakaInstance.destroy();
          } catch {}
          if (shakaRef.current === shakaInstance) {
            shakaRef.current = null;
          }
        }
        activeEngineRef.current = "none";
      };
    }, [streamUrl, isLive]);

    // Independent web/webOS play/pause controller without tearing down media pipeline
    useEffect(() => {
      if (Platform.OS !== "web") return;
      const v = videoElRef.current;
      if (!v) return;
      if (paused) {
        if (!v.paused) v.pause();
      } else {
        if (v.paused) v.play().catch(() => {});
      }
    }, [paused]);

    // When streamUrl changes, reset load state
    useEffect(() => {
      if (currentUrlRef.current !== streamUrl && streamUrl) {
        currentUrlRef.current = streamUrl;
        isFirstLoadRef.current = true;
        if (Platform.OS === "web") {
          return;
        }
        if (!player) return;
        try {
          player.replaceAsync({
            uri: streamUrl,
            headers: effectiveHeaders,
          });
          if (!paused && autoPlay) {
            player.play();
          }
        } catch (e) {
          console.warn("[ExpoVideoPlayer] replaceAsync error:", e);
        }
      }
    }, [player, streamUrl, effectiveHeaders, paused, autoPlay]);

    // Native player event subscriptions (Android / iOS)
    useEffect(() => {
      if (!player || Platform.OS === "web") return;

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
          onBuffering?.(false);
          const aTracks = normalizeAudioTracks(player.availableAudioTracks || []);
          onError?.(error || new Error("Playback error"), aTracks);
        } else if (status === "idle" && isLive && !isFirstLoadRef.current) {
          if (!endedRef.current) {
            endedRef.current = true;
            onEnd?.();
          }
        }
      });

      const subPlaying = player.addListener("playingChange", ({ isPlaying }: { isPlaying: boolean }) => {
        if (isPlaying) {
          onBuffering?.(false);
          onPlaying?.();
        } else {
          onPaused?.();
        }
      });

      const subTime = player.addListener(
        "timeUpdate",
        ({ currentTime: currentSeconds }: { currentTime: number }) => {
          const now = Date.now();
          if (now - lastProgressEmitTime.current < 200) return;
          lastProgressEmitTime.current = now;

          const currentMs = Math.round(currentSeconds * 1000);
          const durSec = player.duration || 0;
          const durationMs = Math.round(durSec * 1000);
          onProgress?.(currentMs, durationMs);
        }
      );

      const subTracks = (player as any).addListener("tracksChange", ({ tracks }: any) => {
        const aTracks = normalizeAudioTracks(tracks?.audioTracks || player.availableAudioTracks || []);
        const sTracks = normalizeSubtitleTracks(tracks?.subtitleTracks || player.availableSubtitleTracks || []);
        const vTracks = normalizeVideoTracks(tracks?.videoTracks || player.availableVideoTracks || []);
        audioTracksRef.current = tracks?.audioTracks || player.availableAudioTracks || [];
        subtitleTracksRef.current = tracks?.subtitleTracks || player.availableSubtitleTracks || [];
        videoTracksRef.current = tracks?.videoTracks || player.availableVideoTracks || [];

        onTracksChange?.({
          audioTracks: aTracks,
          textTracks: sTracks,
          videoTracks: vTracks,
        });
      });

      const subEnd = player.addListener("playToEnd", () => {
        endedRef.current = true;
        onEnd?.();
      });

      return () => {
        subStatus?.remove();
        subPlaying?.remove();
        subTime?.remove();
        subTracks?.remove();
        subEnd?.remove();
      };
    }, [player, isLive, onLoad, onTracksChange, onProgress, onBuffering, onPlaying, onPaused, onEnd, onError]);

    // Expose ref methods
    useImperativeHandle(
      ref,
      () => ({
        play: () => {
          if (Platform.OS === "web") {
            if (activeEngineRef.current === "mpegts" && mpegtsRef.current) {
              try { mpegtsRef.current.play(); } catch {}
            }
            videoElRef.current?.play().catch(() => {});
          } else {
            try {
              player.play();
            } catch {}
          }
        },
        pause: () => {
          if (Platform.OS === "web") {
            if (activeEngineRef.current === "mpegts" && mpegtsRef.current) {
              try { mpegtsRef.current.pause(); } catch {}
            }
            videoElRef.current?.pause();
          } else {
            try {
              player.pause();
            } catch {}
          }
        },
        seekTo: (positionMs: number) => {
          const seconds = Math.max(0, positionMs / 1000);
          if (Platform.OS === "web") {
            if (activeEngineRef.current === "mpegts" && mpegtsRef.current) {
              try { mpegtsRef.current.currentTime = seconds; } catch {}
            }
            if (videoElRef.current) {
              videoElRef.current.currentTime = seconds;
              if (!pausedRef.current && videoElRef.current.paused) {
                videoElRef.current.play().catch(() => {});
              }
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
          if (Platform.OS === "web") {
            if (videoElRef.current) {
              videoElRef.current.currentTime += deltaSeconds;
            }
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
          if (Platform.OS === "web") {
            if (activeEngineRef.current === "mpegts" && mpegtsRef.current) {
              try {
                mpegtsRef.current.unload();
                mpegtsRef.current.load();
                mpegtsRef.current.play();
              } catch {}
            } else if (activeEngineRef.current === "hls" && hlsRef.current) {
              hlsRef.current.loadSource(normalized);
              hlsRef.current.startLoad();
            } else if (activeEngineRef.current === "shaka" && shakaRef.current) {
              try {
                await shakaRef.current.load(normalized);
              } catch {}
            } else if (videoElRef.current) {
              setupWebOSVideoSource(videoElRef.current, normalized, isLive);
            }
            return;
          }
          if (!player) return;
          try {
            await player.replaceAsync({
              uri: streamUrl,
              headers: effectiveHeaders,
            });
            if (!paused && autoPlay) {
              player.play();
            }
          } catch (err) {
            console.warn("[ExpoVideoPlayer] reloadSource error:", err);
          }
        },
        getPlayer: () => (Platform.OS === "web" ? (mpegtsRef.current || shakaRef.current || hlsRef.current || videoElRef.current) : player),
        isPlaying: () => {
          if (Platform.OS === "web" && videoElRef.current) {
            return !videoElRef.current.paused;
          }
          try {
            return !!player?.playing;
          } catch {
            return false;
          }
        },
        getAudioTracks: () => {
          if (Platform.OS === "web") {
            if (activeEngineRef.current === "hls" && hlsRef.current?.audioTracks?.length) {
              return normalizeHlsAudioTracks(hlsRef.current.audioTracks);
            }
            if (activeEngineRef.current === "shaka" && shakaRef.current) {
              return normalizeShakaAudioTracks(shakaRef.current.getVariantTracks?.() || []);
            }
            const domTracks = (videoElRef.current as any)?.audioTracks;
            if (domTracks?.length) {
              return normalizeDomAudioTracks(domTracks);
            }
          }
          return normalizeAudioTracks(player.availableAudioTracks || []);
        },
        getSubtitleTracks: () => {
          if (Platform.OS === "web") {
            if (activeEngineRef.current === "hls" && hlsRef.current?.subtitleTracks?.length) {
              return normalizeHlsSubtitleTracks(hlsRef.current.subtitleTracks);
            }
            if (activeEngineRef.current === "shaka" && shakaRef.current) {
              return normalizeShakaTextTracks(shakaRef.current.getTextTracks?.() || []);
            }
            if (videoElRef.current?.textTracks?.length) {
              return normalizeDomTextTracks(videoElRef.current.textTracks);
            }
          }
          return normalizeSubtitleTracks(player.availableSubtitleTracks || []);
        },
        getVideoTracks: () => {
          if (Platform.OS === "web") {
            if (activeEngineRef.current === "hls" && hlsRef.current?.levels?.length) {
              return normalizeHlsLevels(hlsRef.current.levels);
            }
            if (activeEngineRef.current === "shaka" && shakaRef.current) {
              return normalizeShakaVideoTracks(shakaRef.current.getVariantTracks?.() || []);
            }
          }
          return normalizeVideoTracks(player.availableVideoTracks || []);
        },
      }),
      [player, streamUrl, effectiveHeaders, paused, autoPlay, applyAudioTrack, applySubtitleTrack, applyVideoTrack, isLive]
    );

    return (
      <View ref={containerRef} style={[styles.container, style]}>
        {Platform.OS === "web" ? (
          <video
            ref={videoElRef}
            style={{
              width: "100%",
              height: "100%",
              objectFit: contentFit === "cover" ? "cover" : contentFit === "fill" ? "fill" : "contain",
              backgroundColor: "#000000",
              outline: "none",
              transform: "translateZ(0)",
              willChange: "transform",
            }}
            playsInline
            autoPlay={autoPlay}
          />
        ) : (
          <VideoView
            style={StyleSheet.absoluteFill}
            player={player}
            contentFit={contentFit}
            nativeControls={false}
            allowsPictureInPicture={true}
            surfaceType={Platform.OS === "android" ? "surfaceView" : undefined}
          />
        )}
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
