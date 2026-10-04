import React, { useEffect, useRef, useImperativeHandle, forwardRef, useCallback, useMemo } from "react";
import { StyleSheet, View, ViewStyle, StyleProp } from "react-native";
import {
  NativeInfinityMediaPlayerView,
  AudioTelemetry,
  NvcTelemetry,
} from "infinity-media-player";
import { BufferTuning } from "../services/stbEnvironment";

export type VideoContentFit = "contain" | "cover" | "fill";

export interface NormalizedTrackOption {
  id: string | number;
  index: number;
  name?: string;
  title?: string;
  language?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  bitrate?: number;
  isSupported?: boolean;
  format?: {
    sampleMimeType?: string;
  };
  raw?: any;
}

export interface InfinityVideoPlayerRef {
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
  getAudioTelemetry?: () => AudioTelemetry | null;
  getNvcTelemetry?: () => NvcTelemetry | null;
}

export type ExpoVideoPlayerRef = InfinityVideoPlayerRef;

export interface InfinityVideoPlayerProps {
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
  audioOutputMode?: "auto" | "stereo" | "multichannel" | "passthrough";
  enableNvcConcealment?: boolean;
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
  onAudioTelemetry?: (telemetry: AudioTelemetry) => void;
  onNvcTelemetry?: (telemetry: NvcTelemetry) => void;
  onLiveRecovered?: () => void;
}

export type ExpoVideoPlayerProps = InfinityVideoPlayerProps;

/**
 * Normalizes AudioTrack from infinity-media-player into format expected by TrackSelectionModal
 */
export function normalizeAudioTracks(tracks: any[]): NormalizedTrackOption[] {
  return (tracks || []).map((t, idx) => {
    const label = t.title || t.name || t.label || (t.language ? t.language.toUpperCase() : `Audio ${idx + 1}`);
    const mime = t.mimeType || t.codec || "";
    return {
      id: t.id ?? idx,
      index: idx,
      title: label,
      name: label,
      language: t.language || "",
      mimeType: mime,
      isSupported: true,
      format: {
        sampleMimeType: mime,
      },
      raw: t,
    };
  });
}

/**
 * Normalizes SubtitleTrack from infinity-media-player into format expected by TrackSelectionModal
 */
export function normalizeSubtitleTracks(tracks: any[]): NormalizedTrackOption[] {
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
    const label = t.title || t.name || t.label || (t.language ? t.language.toUpperCase() : `Subtitle ${idx + 1}`);
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
 * Normalizes VideoTrack from infinity-media-player into format expected by TrackSelectionModal
 */
export function normalizeVideoTracks(tracks: any[]): NormalizedTrackOption[] {
  return (tracks || []).map((t, idx) => {
    const h = t.height;
    const w = t.width;
    let label = t.title || "Auto";
    if (!t.title && h && w) {
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
      bitrate: t.bitrate,
      raw: t,
    };
  });
}

/**
 * Derives native InfinityPlayer buffer parameters from user buffer profiles
 * and adaptive network measurements (in milliseconds).
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
  const baseCacheMs = networkCacheMs && networkCacheMs > 0 ? networkCacheMs : (isLive ? 3000 : 4000);

  let playbackStartMs = 1200;
  let rebufferMs = 2500;
  let minBufferMs = 12000;
  let maxBufferMs = 15000;

  if (profile === "instant") {
    // Instant zap: start playback as soon as 500ms (live) or 800ms (VOD) is buffered
    playbackStartMs = isLive ? 500 : 800;
    rebufferMs = isLive ? 1500 : 2000;
    minBufferMs = isLive ? 8000 : 12000;
    maxBufferMs = isLive ? 12000 : 20000;
  } else if (profile === "smooth") {
    // Smooth: higher start cushion for jittery/weak Wi-Fi
    playbackStartMs = isLive ? 2000 : 2500;
    rebufferMs = isLive ? 3000 : 3500;
    minBufferMs = isLive ? 15000 : 20000;
    maxBufferMs = isLive ? 20000 : 30000;
  } else {
    // Balanced (default): fast <1s start with solid buffer hysteresis
    playbackStartMs = isLive ? 800 : 1200;
    rebufferMs = 2500;
    minBufferMs = 12000;
    maxBufferMs = 15000;
  }

  if (is4K) {
    playbackStartMs += 500;
    minBufferMs = Math.max(minBufferMs, 15000);
    maxBufferMs = Math.max(maxBufferMs, 25000);
  }

  return {
    bufferForPlaybackMs: playbackStartMs,
    bufferForPlaybackAfterRebufferMs: rebufferMs,
    minBufferMs,
    maxBufferMs,
  };
}

export const InfinityVideoPlayer = forwardRef<InfinityVideoPlayerRef, InfinityVideoPlayerProps>(
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
      audioOutputMode = "auto",
      enableNvcConcealment = true,
      selectedAudioTrack,
      selectedSubtitleTrack,
      selectedVideoTrack,
      onLoad,
      onTracksChange,
      onProgress,
      onBuffering,
      onPlaying,
      onPaused,
      onEnd,
      onError,
      onAudioTelemetry,
      onNvcTelemetry,
      onLiveRecovered,
    },
    ref
  ) => {
    const isPlayingRef = useRef(!paused && autoPlay);
    const audioTelemetryRef = useRef<AudioTelemetry | null>(null);
    const nvcTelemetryRef = useRef<NvcTelemetry | null>(null);
    const cachedAudioTracksRef = useRef<NormalizedTrackOption[]>([]);

    // Internal state for imperative controls via props
    const [internalPaused, setInternalPaused] = React.useState(paused);
    const [reloadKey, setReloadKey] = React.useState(0);

    useEffect(() => {
      setInternalPaused(paused);
    }, [paused]);

    // Calculate buffer options dynamically
    const bufferOptions = useMemo(
      () =>
        calculateExpoBufferOptions({
          networkCacheMs,
          bufferTuning,
          isLive,
          is4K,
        }),
      [networkCacheMs, bufferTuning, isLive, is4K]
    );

    const sourceProp = useMemo(
      () => ({
        uri: streamUrl,
        headers,
        isLive,
      }),
      [streamUrl, headers, isLive]
    );

    // Event handlers
    const handleLoad = useCallback(
      (e: any) => {
        const data = e.nativeEvent || {};
        const duration = Math.round(data.duration || 0);
        const aTracks = normalizeAudioTracks(data.audioTracks || []);
        const sTracks = normalizeSubtitleTracks(data.subtitleTracks || data.textTracks || []);
        const vTracks = normalizeVideoTracks(data.videoTracks || []);
        const currentAudio = data.currentAudioTrack
          ? normalizeAudioTracks([data.currentAudioTrack])[0]
          : undefined;

        cachedAudioTracksRef.current = aTracks;

        onLoad?.({
          duration,
          audioTracks: aTracks,
          textTracks: sTracks,
          videoTracks: vTracks,
          currentAudioTrack: currentAudio,
        });
      },
      [onLoad]
    );

    const handleTracksChange = useCallback(
      (e: any) => {
        const data = e.nativeEvent || {};
        const aTracks = normalizeAudioTracks(data.audioTracks || []);
        const sTracks = normalizeSubtitleTracks(data.subtitleTracks || data.textTracks || []);
        const vTracks = normalizeVideoTracks(data.videoTracks || []);
        const currentAudio = data.currentAudioTrack
          ? normalizeAudioTracks([data.currentAudioTrack])[0]
          : undefined;

        cachedAudioTracksRef.current = aTracks;

        onTracksChange?.({
          audioTracks: aTracks,
          textTracks: sTracks,
          videoTracks: vTracks,
          currentAudioTrack: currentAudio,
        });
      },
      [onTracksChange]
    );

    const handleProgress = useCallback(
      (e: any) => {
        const data = e.nativeEvent || {};
        onProgress?.(data.currentTimeMs || 0, data.durationMs || 0);
      },
      [onProgress]
    );

    const handleBuffering = useCallback(
      (e: any) => {
        const isBuf = !!e.nativeEvent?.isBuffering;
        onBuffering?.(isBuf);
      },
      [onBuffering]
    );

    const handlePlaying = useCallback(() => {
      isPlayingRef.current = true;
      onPlaying?.();
    }, [onPlaying]);

    const handlePaused = useCallback(() => {
      isPlayingRef.current = false;
      onPaused?.();
    }, [onPaused]);

    const handleEnd = useCallback(() => {
      isPlayingRef.current = false;
      onEnd?.();
    }, [onEnd]);

    const handleError = useCallback(
      (e: any) => {
        const data = e.nativeEvent || {};
        const aTracks = normalizeAudioTracks(data.audioTracks || cachedAudioTracksRef.current);
        onError?.(new Error(data.message || "Playback error"), aTracks);
      },
      [onError]
    );

    const handleAudioTelemetry = useCallback(
      (e: any) => {
        const data = e.nativeEvent as AudioTelemetry;
        audioTelemetryRef.current = data;
        onAudioTelemetry?.(data);
      },
      [onAudioTelemetry]
    );

    const handleNvcTelemetry = useCallback(
      (e: any) => {
        const data = e.nativeEvent as NvcTelemetry;
        nvcTelemetryRef.current = data;
        onNvcTelemetry?.(data);
      },
      [onNvcTelemetry]
    );

    const handleLiveRecovered = useCallback(() => {
      onLiveRecovered?.();
    }, [onLiveRecovered]);

    // Imperative ref implementation
    useImperativeHandle(
      ref,
      () => ({
        play: () => {
          setInternalPaused(false);
          isPlayingRef.current = true;
        },
        pause: () => {
          setInternalPaused(true);
          isPlayingRef.current = false;
        },
        seekTo: (_positionMs: number) => {
          // Seeking is handled natively or via position updates
        },
        seekBy: (_deltaSeconds: number) => {},
        selectAudioTrack: (_trackIdOrIndex) => {},
        selectSubtitleTrack: (_trackIdOrIndex) => {},
        selectVideoTrack: (_trackIdOrIndex) => {},
        reloadSource: async () => {
          setReloadKey((k) => k + 1);
        },
        getPlayer: () => null,
        isPlaying: () => isPlayingRef.current,
        getAudioTracks: () => cachedAudioTracksRef.current,
        getAudioTelemetry: () => audioTelemetryRef.current,
        getNvcTelemetry: () => nvcTelemetryRef.current,
      }),
      []
    );

    return (
      <View style={[styles.container, style]}>
        <NativeInfinityMediaPlayerView
          key={`infinity-view-${reloadKey}`}
          style={StyleSheet.absoluteFill}
          source={sourceProp}
          paused={internalPaused}
          rate={rate}
          volume={volume > 1 ? volume / 100 : volume}
          contentFit={contentFit}
          audioOutputMode={audioOutputMode}
          enableNvcConcealment={enableNvcConcealment}
          bufferOptions={bufferOptions}
          selectedAudioTrack={selectedAudioTrack !== undefined ? String(selectedAudioTrack) : undefined}
          selectedSubtitleTrack={selectedSubtitleTrack !== undefined ? String(selectedSubtitleTrack) : undefined}
          selectedVideoTrack={selectedVideoTrack !== undefined ? String(selectedVideoTrack) : undefined}
          onLoad={handleLoad}
          onTracksChange={handleTracksChange}
          onProgress={handleProgress}
          onBuffering={handleBuffering}
          onPlaying={handlePlaying}
          onPaused={handlePaused}
          onEnd={handleEnd}
          onError={handleError}
          onAudioTelemetry={handleAudioTelemetry}
          onNvcTelemetry={handleNvcTelemetry}
          onLiveRecovered={handleLiveRecovered}
        />
      </View>
    );
  }
);

InfinityVideoPlayer.displayName = "InfinityVideoPlayer";

// Backward-compatible alias for existing imports
export const ExpoVideoPlayer = InfinityVideoPlayer;

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#000000",
    overflow: "hidden",
  },
});
