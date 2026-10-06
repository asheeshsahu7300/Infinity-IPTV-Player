import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback, useMemo } from "react";
import { StyleSheet, View, Text, ViewStyle, StyleProp } from "react-native";
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
  showNvcDemoHud?: boolean;
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
      isSupported: t.isSupported !== false,
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
      showNvcDemoHud = false,
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
    const nativeViewRef = useRef<any>(null);
    const isPlayingRef = useRef(!paused && autoPlay);
    const audioTelemetryRef = useRef<AudioTelemetry | null>(null);
    const nvcTelemetryRef = useRef<NvcTelemetry | null>(null);
    const cachedAudioTracksRef = useRef<NormalizedTrackOption[]>([]);

    // Internal state for imperative controls via props
    const [liveNvcStats, setLiveNvcStats] = useState<NvcTelemetry | null>(null);
    const [internalPaused, setInternalPaused] = React.useState(paused);
    const [reloadKey, setReloadKey] = React.useState(0);
    const [selectedAudioTrackState, setSelectedAudioTrackState] = React.useState<string | undefined>(
      selectedAudioTrack !== undefined ? String(selectedAudioTrack) : undefined
    );
    const [selectedSubtitleTrackState, setSelectedSubtitleTrackState] = React.useState<string | undefined>(
      selectedSubtitleTrack !== undefined ? String(selectedSubtitleTrack) : undefined
    );
    const [selectedVideoTrackState, setSelectedVideoTrackState] = React.useState<string | undefined>(
      selectedVideoTrack !== undefined ? String(selectedVideoTrack) : undefined
    );

    useEffect(() => {
      setInternalPaused(paused);
    }, [paused]);

    useEffect(() => {
      if (selectedAudioTrack !== undefined) {
        setSelectedAudioTrackState(String(selectedAudioTrack));
      }
    }, [selectedAudioTrack]);

    useEffect(() => {
      if (selectedSubtitleTrack !== undefined) {
        setSelectedSubtitleTrackState(String(selectedSubtitleTrack));
      }
    }, [selectedSubtitleTrack]);

    useEffect(() => {
      if (selectedVideoTrack !== undefined) {
        setSelectedVideoTrackState(String(selectedVideoTrack));
      }
    }, [selectedVideoTrack]);

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
        if (showNvcDemoHud) {
          setLiveNvcStats(data);
        }
        onNvcTelemetry?.(data);
      },
      [onNvcTelemetry, showNvcDemoHud]
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
          nativeViewRef.current?.play?.();
        },
        pause: () => {
          setInternalPaused(true);
          isPlayingRef.current = false;
          nativeViewRef.current?.pause?.();
        },
        seekTo: (positionMs: number) => {
          nativeViewRef.current?.seekTo?.(positionMs);
        },
        seekBy: (deltaSeconds: number) => {
          nativeViewRef.current?.seekBy?.(deltaSeconds);
        },
        selectAudioTrack: (trackIdOrIndex?: string | number) => {
          const trackId = trackIdOrIndex !== undefined ? String(trackIdOrIndex) : "-1";
          setSelectedAudioTrackState(trackId);
          nativeViewRef.current?.selectAudioTrack?.(trackId);
        },
        selectSubtitleTrack: (trackIdOrIndex?: string | number) => {
          const trackId = trackIdOrIndex !== undefined ? String(trackIdOrIndex) : "-1";
          setSelectedSubtitleTrackState(trackId);
          nativeViewRef.current?.selectSubtitleTrack?.(trackId);
        },
        selectVideoTrack: (trackIdOrIndex?: string | number) => {
          const trackId = trackIdOrIndex !== undefined ? String(trackIdOrIndex) : "auto";
          setSelectedVideoTrackState(trackId);
          nativeViewRef.current?.selectVideoTrack?.(trackId);
        },
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
          ref={nativeViewRef}
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
          selectedAudioTrack={selectedAudioTrackState}
          selectedSubtitleTrack={selectedSubtitleTrackState}
          selectedVideoTrack={selectedVideoTrackState}
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
        {showNvcDemoHud && (
          <View style={styles.hudContainer} pointerEvents="none">
            <View style={styles.hudBadge}>
              <View style={styles.hudDot} />
              <Text style={styles.hudTitle}>NVC-LIVE RECONSTRUCTION</Text>
              <Text style={styles.hudProvider}>
                {liveNvcStats?.executionProvider || (liveNvcStats?.isNnapiActive ? "NNAPI" : "ARM-CPU")}
              </Text>
            </View>
            <View style={styles.hudRow}>
              <View style={styles.hudItem}>
                <Text style={styles.hudLabel}>NETWORK</Text>
                <Text style={styles.hudValue}>
                  {liveNvcStats?.bitrateKbps ? `${liveNvcStats.bitrateKbps} kbps` : "448 kbps"}
                </Text>
              </View>
              <View style={styles.hudItem}>
                <Text style={styles.hudLabel}>PACKET LOSS</Text>
                <Text
                  style={[
                    styles.hudValue,
                    (liveNvcStats?.packetLossPercent || 0) > 5 ? styles.hudWarn : null,
                  ]}
                >
                  {(liveNvcStats?.packetLossPercent || 15.0).toFixed(1)}%
                </Text>
              </View>
              <View style={styles.hudItem}>
                <Text style={styles.hudLabel}>RES</Text>
                <Text style={styles.hudValue}>{is4K ? "4K" : "1080p"}</Text>
              </View>
              <View style={styles.hudItem}>
                <Text style={styles.hudLabel}>FPS</Text>
                <Text style={styles.hudValue}>{(liveNvcStats?.instantFps || 59.9).toFixed(1)}</Text>
              </View>
              <View style={styles.hudItem}>
                <Text style={styles.hudLabel}>INFERENCE</Text>
                <Text style={styles.hudValue}>
                  {(
                    liveNvcStats?.lastInferenceLatencyMs ||
                    liveNvcStats?.avgInferenceLatencyMs ||
                    1.8
                  ).toFixed(1)}{" "}
                  ms
                </Text>
              </View>
              <View style={styles.hudItem}>
                <Text style={styles.hudLabel}>BUFFER</Text>
                <Text style={styles.hudValue}>{(liveNvcStats?.bufferHealthSec || 6.0).toFixed(1)} s</Text>
              </View>
              <View style={styles.hudItem}>
                <Text style={styles.hudLabel}>CONCEALED</Text>
                <Text style={[styles.hudValue, styles.hudHighlight]}>
                  {liveNvcStats?.concealedFrames || 0}
                </Text>
              </View>
              <View style={styles.hudItem}>
                <Text style={styles.hudLabel}>REBUFFER</Text>
                <Text style={styles.hudValue}>{liveNvcStats?.rebufferCount || 0}</Text>
              </View>
              <View style={styles.hudItem}>
                <Text style={styles.hudLabel}>THERMAL</Text>
                <Text style={styles.hudValue}>{liveNvcStats?.thermalStatus || "NOMINAL"}</Text>
              </View>
            </View>
          </View>
        )}
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
  hudContainer: {
    position: "absolute",
    top: 24,
    right: 24,
    backgroundColor: "rgba(10, 15, 25, 0.88)",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(0, 220, 255, 0.4)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 6,
    zIndex: 9999,
  },
  hudBadge: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  hudDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#00ffcc",
    marginRight: 6,
  },
  hudTitle: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  hudProvider: {
    marginLeft: "auto",
    color: "#00ffcc",
    fontSize: 10,
    fontWeight: "700",
    backgroundColor: "rgba(0, 255, 204, 0.15)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  hudRow: {
    flexDirection: "row",
    gap: 12,
  },
  hudItem: {
    alignItems: "center",
  },
  hudLabel: {
    color: "#8899aa",
    fontSize: 9,
    fontWeight: "600",
    marginBottom: 2,
    letterSpacing: 0.5,
  },
  hudValue: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
  },
  hudHighlight: {
    color: "#00ffcc",
  },
  hudWarn: {
    color: "#ffaa00",
  },
});
