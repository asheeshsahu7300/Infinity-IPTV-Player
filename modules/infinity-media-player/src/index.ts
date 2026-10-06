import { requireNativeViewManager, requireNativeModule } from 'expo-modules-core';
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { ViewProps, StyleProp, ViewStyle, findNodeHandle, UIManager } from 'react-native';

export interface InfinityAudioTrack {
  id: string;
  title: string;
  name: string;
  language?: string;
  mimeType?: string;
  codec?: string;
  channelCount?: number;
  sampleRate?: number;
  bitrate?: number;
  isDefault?: boolean;
  isForced?: boolean;
  isSelected?: boolean;
}

export interface InfinitySubtitleTrack {
  id: string;
  title: string;
  name: string;
  language?: string;
  mimeType?: string;
  isClosedCaption?: boolean;
  isForced?: boolean;
  isDefault?: boolean;
  isSelected?: boolean;
}

export interface InfinityVideoTrack {
  id: string;
  title: string;
  name: string;
  width?: number;
  height?: number;
  bitrate?: number;
  codec?: string;
  isSelected?: boolean;
}

export interface AudioTelemetry {
  codec: string;
  sampleRate: number;
  channels: number;
  outputMode: string;
  decoderName: string;
  underruns: number;
  acdbErrorCount: number;
}

export interface NvcTelemetry {
  isAvailable?: boolean;
  isNnapiActive?: boolean;
  instantFps?: number;
  avgFps?: number;
  bitrateKbps?: number;
  avgInferenceLatencyMs?: number;
  lastInferenceLatencyMs?: number;
  latencyP50Ms?: number;
  latencyP95Ms?: number;
  concealedFrames?: number;
  composedFrames?: number;
  failedFrames?: number;
  droppedFrames?: number;
  missedDeadlines?: number;
  activeFrames?: number;
  executionProvider?: string;
  cpuUsagePercent?: number;
  ramUsageMb?: number;
  thermalStatus?: string;
  batteryLevel?: number;
  bufferHealthSec?: number;
  packetLossPercent?: number;
  rebufferCount?: number;
}

export interface InfinityMediaPlayerNativeProps extends ViewProps {
  ref?: any;
  style?: StyleProp<ViewStyle>;
  source?: {
    uri: string;
    headers?: Record<string, string>;
    isLive?: boolean;
  };
  paused?: boolean;
  rate?: number;
  volume?: number;
  contentFit?: 'contain' | 'cover' | 'fill';
  audioOutputMode?: 'auto' | 'stereo' | 'multichannel' | 'passthrough';
  enableNvcConcealment?: boolean;
  bufferOptions?: {
    minBufferMs?: number;
    maxBufferMs?: number;
    bufferForPlaybackMs?: number;
    bufferForPlaybackAfterRebufferMs?: number;
  };
  selectedAudioTrack?: string;
  selectedSubtitleTrack?: string;
  selectedVideoTrack?: string;
  onLoad?: (event: { nativeEvent: any }) => void;
  onTracksChange?: (event: { nativeEvent: any }) => void;
  onProgress?: (event: { nativeEvent: { currentTimeMs: number; durationMs: number } }) => void;
  onBuffering?: (event: { nativeEvent: { isBuffering: boolean } }) => void;
  onPlaying?: (event: { nativeEvent: any }) => void;
  onPaused?: (event: { nativeEvent: any }) => void;
  onEnd?: (event: { nativeEvent: any }) => void;
  onError?: (event: { nativeEvent: { message: string; audioTracks?: any[] } }) => void;
  onAudioTelemetry?: (event: { nativeEvent: AudioTelemetry }) => void;
  onNvcTelemetry?: (event: { nativeEvent: NvcTelemetry }) => void;
  onLiveRecovered?: (event: { nativeEvent: any }) => void;
}

export const NativeInfinityMediaPlayerView: React.ComponentType<any> =
  requireNativeViewManager('InfinityMediaPlayer');

let NativeInfinityMediaPlayerModule: any = null;
try {
  NativeInfinityMediaPlayerModule = requireNativeModule('InfinityMediaPlayer');
} catch {}

export { NativeInfinityMediaPlayerModule };
