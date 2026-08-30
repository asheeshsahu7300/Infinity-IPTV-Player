// ─────────────────────────────────────────────────────────────────────────────
// PlayerScreen — merged implementation
//
//   • Playback engine, network-adaptive buffering, stall detection, silent
//     retry/backoff, live reconnect loop, and TV focus/scrub UX all come from
//     the "advanced" VLC-only version.
//   • The VLC-availability check + expo-av fallback path (for builds/devices
//     without the native VLC module) comes from the original dual-player
//     version, so the screen still works when VLC isn't present — it just
//     loses the extra IPTV-hardening features in that case.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Platform,
  ActivityIndicator,
  StatusBar,
  GestureResponderEvent,
  PanResponder,
  ScrollView,
  BackHandler,
  findNodeHandle,
  Animated,
  AppState,
  AppStateStatus,
  UIManager,
  useTVEventHandler,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { PlayerAspectRatio, VLCPlayer } from "react-native-vlc-media-player";
import { Video, ResizeMode, AVPlaybackStatus } from "expo-av";
import * as ScreenOrientation from "expo-screen-orientation";
import * as Brightness from "expo-brightness";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { safeStorage } from "../src/services/safeStorage";
import { LinearGradient } from "expo-linear-gradient";
import { useKeepAwake } from "expo-keep-awake";
import { StreamManager } from "../src/services/StreamManager";
import { PlaybackState } from "../src/services/PlaybackState";
import { usePortalStore } from "../src/store/portalStore";
import { isTV } from "../src/utils/tvUtils";
import { THEME, ps, pw, ph } from "../src/theme/tokens";
import { Focusable, FocusGroup, Overlay, useDPad, DPAD_PRIORITY } from "../src/tv";
import NetInfo from "@react-native-community/netinfo";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// ─── VLC availability check (native module may be absent, e.g. Expo Go) ──────
const isVLCSupported = () => {
  if (Platform.OS === "web") return false;
  try {
    if (UIManager.getViewManagerConfig) {
      return !!UIManager.getViewManagerConfig("RCTVLCPlayer");
    }
    return !!(UIManager as any).RCTVLCPlayer;
  } catch {
    return false;
  }
};

// ─── Types ────────────────────────────────────────────────────────────────────
type AspectRatioType = "16:9" | "4:3" | "fit" | "fill";
type NetworkQuality = "fast" | "medium" | "slow" | "unknown";

const ASPECT_RATIOS: { key: AspectRatioType; label: string; resize: PlayerAspectRatio }[] = [
  { key: "16:9", label: "16:9", resize: "16:9" },
  { key: "4:3", label: "4:3", resize: "4:3" },
  { key: "fit", label: "Fit", resize: "21:9" },
];

function getExpoResizeMode(key: AspectRatioType): ResizeMode {
  if (key === "fit") return ResizeMode.CONTAIN;
  if (key === "fill") return ResizeMode.COVER;
  return ResizeMode.STRETCH;
}

// ─── Network quality helpers ──────────────────────────────────────────────────
function detectNetworkQuality(type: string | null, effectiveType?: string | null): NetworkQuality {
  const t = (effectiveType || type || "").toLowerCase();
  if (t === "wifi" || t === "5g" || t === "ethernet") return "fast";
  if (t === "4g" || t === "lte") return "medium";
  if (t === "3g" || t === "2g" || t === "edge" || t === "cdma") return "slow";
  return "unknown";
}

/**
 * Adaptive buffer size (ms) tuned per network quality and content type.
 * 4K streams get 1.5× more buffer — decode latency on MediaCodec is higher.
 * Only meaningful for the VLC path; expo-av has no equivalent knob.
 */
function calcNetworkCacheMs(quality: NetworkQuality, isLive: boolean, is4K: boolean): number {
  let base: number;
  switch (quality) {
    case "fast": base = isLive ? 800 : 500; break;
    case "medium": base = isLive ? 1500 : 1000; break;
    case "slow": base = isLive ? 3000 : 2000; break;
    default: base = isLive ? 1000 : 600; break;
  }
  return is4K ? Math.round(base * 1.3) : base;
}

function getQualityLabel(quality: NetworkQuality, is4K: boolean): string {
  if (is4K) return "4K";
  switch (quality) {
    case "fast": return "HD";
    case "medium": return "SD";
    case "slow": return "LOW";
    default: return "LIVE";
  }
}

// ─── Animated scrubber dot ────────────────────────────────────────────────────
const AnimatedScrubber = React.memo(
  ({ focused, progressPercent }: { focused: boolean; progressPercent: number }) => {
    const scale = useRef(new Animated.Value(focused ? 1 : 0.01)).current;
    useEffect(() => {
      Animated.spring(scale, {
        toValue: focused ? 1 : 0.01,
        useNativeDriver: true,
        friction: 7,
        tension: 60,
      }).start();
    }, [focused, scale]);
    return (
      <Animated.View
        style={[S.scrubber, { left: `${progressPercent}%`, transform: [{ scale }] }]}
      />
    );
  }
);
AnimatedScrubber.displayName = "AnimatedScrubber";

// ─── Shimmer bar — shown instead of static buffer fill while buffering ────────
const ShimmerBar = React.memo(() => {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);
  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [-SCREEN_WIDTH, SCREEN_WIDTH],
  });
  return (
    <View style={S.shimmerContainer} pointerEvents="none">
      <Animated.View style={[S.shimmerBar, { transform: [{ translateX }] }]} />
    </View>
  );
});
ShimmerBar.displayName = "ShimmerBar";

// ─────────────────────────────────────────────────────────────────────────────
// Main Player Screen
// ─────────────────────────────────────────────────────────────────────────────
export default function PlayerScreen() {
  useKeepAwake();

  const params = useLocalSearchParams<{
    url: string;
    title: string;
    type: string;
    contentId?: string;
    cmd?: string;
    drmScheme?: string;
    drmLicenseUrl?: string;
  }>();
  const insets = useSafeAreaInsets();
  const activePortal = usePortalStore((s) => s.activePortal);

  const isLive = params.type === "live";
  const is4K =
    typeof params.title === "string" &&
    (params.title.toUpperCase().includes("4K") || params.title.toUpperCase().includes("UHD"));

  // Decided once per mount: VLC gives us all the IPTV-hardening below; when
  // it's unavailable (e.g. Expo Go, web) we fall back to expo-av so playback
  // still works, just without the adaptive-buffer/stall/reconnect features.
  const [usingVLC] = useState(() => isVLCSupported());

  // ── Network quality (drives adaptive buffering on the VLC path) ───────────
  const [networkQuality, setNetworkQuality] = useState<NetworkQuality>("unknown");
  const [networkCacheMs, setNetworkCacheMs] = useState(() =>
    calcNetworkCacheMs("unknown", isLive, is4K)
  );
  const [isNetworkLost, setIsNetworkLost] = useState(false);
  const networkCacheMsRef = useRef(networkCacheMs);

  // ── Core playback state ───────────────────────────────────────────────────
  const [streamUrl, setStreamUrl] = useState(params.url || "");
  const [seekBarNode, setSeekBarNode] = useState<number | undefined>(undefined);
  const [dummyLeftNode, setDummyLeftNode] = useState<number | undefined>(undefined);
  const [dummyRightNode, setDummyRightNode] = useState<number | undefined>(undefined);
  const [actionsRowNode, setActionsRowNode] = useState<number | undefined>(undefined);
  const seekBarRef = useRef<any>(null);
  const dummyLeftRef = useRef<any>(null);
  const dummyRightRef = useRef<any>(null);
  const [showControls, setShowControls] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isRetrying, setIsRetrying] = useState(false);
  const [autoPlay, setAutoPlay] = useState(true);
  const [aspectRatioIndex, setAspectRatioIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isSeekable, setIsSeekable] = useState(!isLive);
  const [isLocked, setIsLocked] = useState(false);
  const [vlcSeekTarget, setVlcSeekTarget] = useState<number | undefined>(undefined);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [liveReconnectMode, setLiveReconnectMode] = useState(false);

  // ── Enhanced state ────────────────────────────────────────────────────────
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [showAudioModal, setShowAudioModal] = useState(false);
  const [showSubtitleModal, setShowSubtitleModal] = useState(false);
  const [seekBarFocused, setSeekBarFocused] = useState(false);
  const [visualFocus, setVisualFocus] = useState(false);
  const [videoTracks, setVideoTracks] = useState<any[]>([]);
  const [selectedVideoTrack, setSelectedVideoTrack] = useState<number | undefined>(undefined);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [audioTracks, setAudioTracks] = useState<any[]>([]);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState<number | undefined>(undefined);
  const [textTracks, setTextTracks] = useState<any[]>([]);
  const [selectedTextTrack, setSelectedTextTrack] = useState<number | undefined>(undefined);
  const [seekIndicator, setSeekIndicator] = useState<string | null>(null);
  const [volumeIndicator, setVolumeIndicator] = useState<number | null>(null);
  const [brightnessIndicator, setBrightnessIndicator] = useState<number | null>(null);
  const [currentVolume, setCurrentVolume] = useState(100);

  // ── Retry configuration ───────────────────────────────────────────────────
  const BUFFERING_UI_DEBOUNCE_MS = 600;
  const MAX_RETRIES_LIVE = 5;
  const MAX_RETRIES_VOD = 3;
  const maxRetries = isLive ? MAX_RETRIES_LIVE : MAX_RETRIES_VOD;

  // ── Refs ──────────────────────────────────────────────────────────────────
  const mountedRef = useRef(true);
  const vlcPlayerRef = useRef<any>(null);
  const expoVideoRef = useRef<Video>(null);
  const progressViewRef = useRef<any>(null);
  const actionsRowRef = useRef<any>(null);
  const controlsTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bufferingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stablePlaybackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveReconnectIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapTime = useRef(0);
  const initialTouch = useRef({ x: 0, y: 0, val: 0, bright: 0 });
  const lastProgressTimeRef = useRef(Date.now());
  const lastProgressPositionRef = useRef(0);
  const bufferingStartedRef = useRef<number | null>(null);
  const lastProgressStateUpdateTime = useRef(0);
  const lastPositionSaveTime = useRef(0);
  const lastAccumulateTime = useRef(0);

  const isSeeking = useRef(false);
  const isScrubbing = useRef(false);
  const isAdjustingVolume = useRef(false);
  const isAdjustingBrightness = useRef(false);
  const isRetryingRef = useRef(false);
  const brightnessPermissionRequestInProgress = useRef(false);

  const targetSeekPosition = useRef<number | null>(null);
  const vlcSeekTargetRef = useRef<number | null>(null);
  const accumulatedDelta = useRef(0);
  const hasSetInitialPosition = useRef(false);
  const savedResumePosition = useRef(0);
  const retryCount = useRef(0);
  const brightnessRef = useRef(0.5);
  const volumeRef = useRef(100);

  // Ref mirrors (stable captures for timers/effects without stale closures)
  const isPlayingRef = useRef(isPlaying);
  const showControlsRef = useRef(showControls);
  const isLockedRef = useRef(isLocked);
  const showVideoModalRef = useRef(showVideoModal);
  const showAudioModalRef = useRef(showAudioModal);
  const showSubtitleModalRef = useRef(showSubtitleModal);
  const seekBarFocusedRef = useRef(seekBarFocused);
  const isFullscreenRef = useRef(isFullscreen);
  const positionRef = useRef(position);
  const durationRef = useRef(duration);
  const isSeekableRef = useRef(isSeekable);
  const dummyLeftFocusedRef = useRef(false);
  const dummyRightFocusedRef = useRef(false);
  const isNavRowFocusedRef = useRef(false);
  const accumulateSeekRef = useRef<(delta: number, isProgressive?: boolean) => void>(() => { });
  const handleTapRef = useRef<(x: number) => void>(() => { });
  const handleSilentRetryRef = useRef<() => void>(() => { });

  // ── Ref sync effects ──────────────────────────────────────────────────────
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { showControlsRef.current = showControls; }, [showControls]);
  useEffect(() => { isLockedRef.current = isLocked; }, [isLocked]);
  useEffect(() => { showAudioModalRef.current = showAudioModal; }, [showAudioModal]);
  useEffect(() => { showSubtitleModalRef.current = showSubtitleModal; }, [showSubtitleModal]);
  useEffect(() => { seekBarFocusedRef.current = seekBarFocused; }, [seekBarFocused]);
  useEffect(() => { isFullscreenRef.current = isFullscreen; }, [isFullscreen]);
  useEffect(() => { positionRef.current = position; }, [position]);
  useEffect(() => { durationRef.current = duration; }, [duration]);
  useEffect(() => { isSeekableRef.current = isSeekable; }, [isSeekable]);
  useEffect(() => { setIsSeekable(!isLive); }, [isLive]);
  useEffect(() => {
    networkCacheMsRef.current = networkCacheMs;
  }, [networkCacheMs]);

  // ── Unmount cleanup ───────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      safeStorage.removeItem("resume_player_state").catch(() => { });
      if (stablePlaybackTimerRef.current) clearTimeout(stablePlaybackTimerRef.current);
      if (liveReconnectIntervalRef.current) clearInterval(liveReconnectIntervalRef.current);
    };
  }, []);

  // ── Network quality monitoring ─────────────────────────────────────────────
  useEffect(() => {
    const applyNetworkState = (type: string | null, effectiveType?: string | null, connected?: boolean | null) => {
      const lost = connected === false;
      setIsNetworkLost(lost);
      if (!lost) {
        const quality = detectNetworkQuality(type, effectiveType);
        const cacheMs = calcNetworkCacheMs(quality, isLive, is4K);
        networkCacheMsRef.current = cacheMs;
        setNetworkQuality(quality);
        setNetworkCacheMs(cacheMs);
        // Refresh stall clock when network restores — player will resume fetching
        if (mountedRef.current) lastProgressTimeRef.current = Date.now();
      }
    };

    NetInfo.fetch().then((s) => {
      applyNetworkState(s.type, (s.details as any)?.cellularGeneration, s.isConnected);
    });

    const unsub = NetInfo.addEventListener((s) => {
      applyNetworkState(s.type, (s.details as any)?.cellularGeneration, s.isConnected);
    });
    return () => unsub();
  }, [isLive, is4K]);

  // ── Progress handler (shared by VLC onProgress and expo-av status updates) ─
  const handleNormalizedProgress = useCallback(
    (positionMs: number, durationMs: number) => {
      if (isSeeking.current) return;
      positionRef.current = positionMs;
      durationRef.current = durationMs;

      const now = Date.now();
      if (now - lastProgressStateUpdateTime.current >= 1000) {
        setPosition(positionMs);
        if (durationMs > 0) setDuration(durationMs);
        lastProgressStateUpdateTime.current = now;
      }

      if (params.contentId && params.type !== "live" && now - lastPositionSaveTime.current > 10000) {
        lastPositionSaveTime.current = now;
        StreamManager.savePlaybackPosition(params.contentId, positionMs, durationMs);
      }
    },
    [params.contentId, params.type]
  );

  // ── Shared buffering handler (debounced UI flag, used by both players) ────
  const handleBufferingChange = useCallback((buffering: boolean) => {
    if (buffering) {
      if (bufferingStartedRef.current === null) bufferingStartedRef.current = Date.now();
      if (!bufferingTimeoutRef.current) {
        bufferingTimeoutRef.current = setTimeout(() => {
          if (mountedRef.current) setIsBuffering(true);
          bufferingTimeoutRef.current = null;
        }, BUFFERING_UI_DEBOUNCE_MS);
      }
    } else {
      if (bufferingTimeoutRef.current) {
        clearTimeout(bufferingTimeoutRef.current);
        bufferingTimeoutRef.current = null;
      }
      bufferingStartedRef.current = null;
      setIsBuffering(false);
      setIsLoading(false);
      // Advance stall clock — player is actively receiving data again
      lastProgressTimeRef.current = Date.now();
    }
  }, []);

  // ── Controls auto-hide ────────────────────────────────────────────────────
  const resetControlsTimeout = useCallback(() => {
    if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
    controlsTimeout.current = setTimeout(() => {
      if (
        isPlayingRef.current &&
        !isLockedRef.current &&
        !showVideoModalRef.current &&
        !showAudioModalRef.current &&
        !showSubtitleModalRef.current
      ) {
        setShowControls(false);
      }
    }, 5000);
  }, []);

  // ── stopLiveReconnectLoop (declared early — referenced by handleLoadCommon) ─
  const stopLiveReconnectLoop = useCallback(() => {
    if (liveReconnectIntervalRef.current) {
      clearInterval(liveReconnectIntervalRef.current);
      liveReconnectIntervalRef.current = null;
    }
    setLiveReconnectMode(false);
  }, []);

  // ── Unified seek — branches to VLC's fraction-based seek prop or expo-av's
  //    setPositionAsync, but drives the same position/controls state either way
  const performSeek = useCallback(
    (positionMs: number) => {
      if (!durationRef.current || durationRef.current <= 0) return;
      const clamped = Math.max(0, Math.min(positionMs, durationRef.current));
      isSeeking.current = true;
      lastProgressTimeRef.current = Date.now();
      setPosition(clamped);

      if (usingVLC) {
        const fraction = clamped / durationRef.current;
        setVlcSeekTarget((prev) => {
          const final = prev === fraction ? fraction + 1e-10 : fraction;
          vlcSeekTargetRef.current = final;
          return final;
        });
      } else if (expoVideoRef.current) {
        expoVideoRef.current.setPositionAsync(clamped).catch((e) => {
          console.error("Seek error:", e);
        });
        // expo-av has no reliable "seek settled" callback via props — clear
        // the seeking flag on a short timer so progress updates resume.
        if (seekTimeout.current) clearTimeout(seekTimeout.current);
        seekTimeout.current = setTimeout(() => { isSeeking.current = false; }, 600);
      }

      resetControlsTimeout();
    },
    [resetControlsTimeout, usingVLC]
  );

  // ── Shared "load complete" handler for both players ───────────────────────
  const handleLoadCommon = useCallback(
    (durationMs: number) => {
      setIsLoading(false);
      setIsBuffering(false);
      setPlaybackFailed(false);
      stopLiveReconnectLoop();

      if (durationMs > 0) { durationRef.current = durationMs; setDuration(durationMs); }

      if (!hasSetInitialPosition.current && savedResumePosition.current > 0 && params.type !== "live" && durationMs > 0) {
        hasSetInitialPosition.current = true;
        performSeek(savedResumePosition.current);
      }
    },
    [params.type, performSeek, stopLiveReconnectLoop]
  );

  // ── Focus helpers ─────────────────────────────────────────────────────────
  const navRowFocusHandlers = {
    onFocus: () => { isNavRowFocusedRef.current = true; resetControlsTimeout(); },
    onBlur: () => { isNavRowFocusedRef.current = false; },
  };

  const handleSeekFocus = useCallback(() => {
    if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current);
    setSeekBarFocused(true);
    setVisualFocus(true);
    resetControlsTimeout();
  }, [resetControlsTimeout]);

  const handleSeekBlur = useCallback(() => {
    if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current);
    focusTimeoutRef.current = setTimeout(() => {
      setSeekBarFocused(false);
      setVisualFocus(false);
    }, 150);
  }, []);

  // ── TV focus node attachment ──────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    if (showControls) {
      const attachNodes = () => {
        if (!mounted) return;
        const seek = seekBarRef.current ? findNodeHandle(seekBarRef.current) : null;
        const left = dummyLeftRef.current ? findNodeHandle(dummyLeftRef.current) : null;
        const right = dummyRightRef.current ? findNodeHandle(dummyRightRef.current) : null;
        const row = actionsRowRef.current ? findNodeHandle(actionsRowRef.current) : null;
        if (seek && left && right && row) {
          setSeekBarNode(seek);
          setDummyLeftNode(left);
          setDummyRightNode(right);
          setActionsRowNode(row);
        } else if (isTV) {
          requestAnimationFrame(attachNodes);
        }
      };
      showVideoModalRef.current = showVideoModal;
      showAudioModalRef.current = showAudioModal;
      showSubtitleModalRef.current = showSubtitleModal;
      attachNodes();
    }
    return () => { mounted = false; };
  }, [showControls, showVideoModal, showAudioModal, showSubtitleModal]);

  useEffect(() => {
    if (showVideoModal || showAudioModal || showSubtitleModal) {
      if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
    } else {
      resetControlsTimeout();
    }
  }, [showVideoModal, showAudioModal, showSubtitleModal, resetControlsTimeout]);

  // ── Orientation + brightness ──────────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS === "web") return;
    ScreenOrientation.unlockAsync().catch(() => {});
    if (!isTV) {
      Brightness.getBrightnessAsync()
        .then((b) => {
          if (!isNaN(b)) brightnessRef.current = b;
        })
        .catch(() => {});

      const reqPerm = async () => {
        if (brightnessPermissionRequestInProgress.current) return;
        try {
          brightnessPermissionRequestInProgress.current = true;
          const perm = await Brightness.getPermissionsAsync().catch(() => null);
          if (perm && !perm.granted && perm.canAskAgain) {
            await Brightness.requestPermissionsAsync().catch(() => {});
          }
        } catch {
          // Ignore permission request error
        } finally {
          brightnessPermissionRequestInProgress.current = false;
        }
      };
      reqPerm();
    }
    return () => {
      if (!isTV) {
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
        Brightness.restoreSystemBrightnessAsync().catch(() => {});
      }
      if (params.contentId && positionRef.current > 0 && durationRef.current > 0) {
        StreamManager.savePlaybackPosition(params.contentId, positionRef.current, durationRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Back handler ──────────────────────────────────────────────────────────
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (isFullscreenRef.current) {
        setIsFullscreen(false);
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        return true;
      }
      if (showControlsRef.current) {
        setShowControls(false);
        if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
        return true;
      }
      StreamManager.savePlaybackPosition(
        params.contentId as string,
        positionRef.current,
        durationRef.current
      );
      return false;
    });
    return () => sub.remove();
  }, [params.contentId]);

  // ── Load settings + resume position ──────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const settings = await safeStorage.getItem("app_settings");
        if (settings) {
          const parsed = JSON.parse(settings);
          if (typeof parsed.autoPlay === "boolean") {
            setAutoPlay(parsed.autoPlay);
            setIsPlaying(parsed.autoPlay);
          }
        }
        if (params.contentId && params.type !== "live") {
          const saved = await StreamManager.getPlaybackPosition(params.contentId);
          if (saved && saved.position > 0 && saved.duration - saved.position > 5000) {
            savedResumePosition.current = saved.position;
            // If duration is already known, apply resume seek immediately
            if (!hasSetInitialPosition.current && durationRef.current > 0) {
              hasSetInitialPosition.current = true;
              performSeek(saved.position);
            }
          }
        }
      } catch (e) {
        console.error("Failed to load settings:", e);
      }
    };
    load();
  }, [params.contentId, params.type, performSeek]);

  // ── Pan responder (swipe gestures) ────────────────────────────────────────
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) =>
        !isLockedRef.current && (Math.abs(g.dx) > 10 || Math.abs(g.dy) > 10),
      onPanResponderGrant: (evt) => {
        initialTouch.current = {
          x: evt.nativeEvent.pageX,
          y: evt.nativeEvent.pageY,
          val: volumeRef.current,
          bright: brightnessRef.current,
        };
        resetControlsTimeout();
      },
      onPanResponderMove: (_, g) => {
        if (isLockedRef.current) return;
        const { dx, dy } = g;
        if (!isScrubbing.current && !isAdjustingVolume.current && !isAdjustingBrightness.current) {
          if (Math.abs(dx) > Math.abs(dy) && isSeekableRef.current && durationRef.current > 0) {
            isScrubbing.current = true;
          } else if (Math.abs(dy) > Math.abs(dx)) {
            if (initialTouch.current.x > SCREEN_WIDTH / 2) isAdjustingVolume.current = true;
            else isAdjustingBrightness.current = true;
          }
        }
        if (isAdjustingVolume.current || isAdjustingBrightness.current) {
          const delta = -dy / 250;
          if (isAdjustingVolume.current) {
            const newVol = Math.min(100, Math.max(0, initialTouch.current.val + delta * 100));
            volumeRef.current = newVol;
            setCurrentVolume(newVol);
            setVolumeIndicator(newVol);
          } else {
            const newBright = Math.min(1, Math.max(0, initialTouch.current.bright + delta));
            brightnessRef.current = newBright;
            setBrightnessIndicator(newBright);
            Brightness.setBrightnessAsync(newBright).catch(() => {});
          }
        } else if (isScrubbing.current) {
          const amt = Math.round(dx / 10) * 1000;
          setSeekIndicator(`${amt > 0 ? "+" : ""}${amt / 1000}s`);
        }
      },
      onPanResponderRelease: (_, g) => {
        setVolumeIndicator(null);
        setBrightnessIndicator(null);
        if (isScrubbing.current) {
          const amt = Math.round(g.dx / 10) * 1000;
          accumulateSeekRef.current(amt);
        } else {
          setSeekIndicator(null);
        }
        isScrubbing.current = false;
        isAdjustingVolume.current = false;
        isAdjustingBrightness.current = false;
        if (Math.abs(g.dx) < 10 && Math.abs(g.dy) < 10) handleTapRef.current(g.x0);
      },
      onPanResponderTerminate: () => {
        setVolumeIndicator(null);
        setBrightnessIndicator(null);
        setSeekIndicator(null);
        isScrubbing.current = false;
        isAdjustingVolume.current = false;
        isAdjustingBrightness.current = false;
      },
    })
  ).current;

  // ── Action handlers ───────────────────────────────────────────────────────
  const cycleAspectRatio = useCallback(() => {
    if (isLockedRef.current) return;
    setAspectRatioIndex((p) => (p + 1) % ASPECT_RATIOS.length);
    resetControlsTimeout();
  }, [resetControlsTimeout]);

  const togglePlay = useCallback(() => {
    if (isLockedRef.current) return;
    setIsPlaying((p) => !p);
    resetControlsTimeout();
  }, [resetControlsTimeout]);

  const seek = useCallback(
    (delta: number) => {
      if (isLockedRef.current || duration <= 0 || !isSeekable) return;
      try {
        performSeek(Math.max(0, Math.min(position + delta, duration)));
      } catch (e) {
        console.error("Seek error:", e);
        isSeeking.current = false;
      }
    },
    [duration, isSeekable, position, performSeek]
  );

  const handleTap = useCallback(
    (x: number) => {
      const now = Date.now();
      if (now - lastTapTime.current < 300) {
        if (tapTimeout.current) clearTimeout(tapTimeout.current);
        if (isLockedRef.current) return;
        if (isSeekableRef.current && params.type !== "live") {
          const isRight = x > SCREEN_WIDTH / 2;
          seek(isRight ? 10000 : -10000);
          setSeekIndicator(isRight ? "+10s" : "-10s");
          setTimeout(() => setSeekIndicator(null), 500);
        }
      } else {
        tapTimeout.current = setTimeout(() => {
          setShowControls((p) => {
            const next = !p;
            if (next) resetControlsTimeout();
            return next;
          });
        }, 300);
      }
      lastTapTime.current = now;
    },
    [params.type, seek, resetControlsTimeout]
  );
  useEffect(() => { handleTapRef.current = handleTap; }, [handleTap]);

  const accumulateSeek = useCallback(
    (delta: number, isProgressive = false) => {
      if (isLockedRef.current || duration <= 0 || !isSeekable || params.type === "live") return;
      const now = Date.now();
      if (now - lastAccumulateTime.current < 50) return;
      lastAccumulateTime.current = now;

      if (targetSeekPosition.current === null) {
        targetSeekPosition.current = position;
        accumulatedDelta.current = 0;
      }

      if (isProgressive) {
        const steps = [0, 60000, 120000, 300000, 600000];
        if (delta > 0) {
          if (accumulatedDelta.current >= 0) {
            const next = steps.find((s) => s > accumulatedDelta.current);
            accumulatedDelta.current = next !== undefined ? next : accumulatedDelta.current + 600000;
          } else {
            const abs = Math.abs(accumulatedDelta.current);
            accumulatedDelta.current = -([...steps].reverse().find((s) => s < abs) || 0);
          }
        } else {
          if (accumulatedDelta.current <= 0) {
            const abs = Math.abs(accumulatedDelta.current);
            const next = steps.find((s) => s > abs);
            accumulatedDelta.current = -(next !== undefined ? next : abs + 600000);
          } else {
            accumulatedDelta.current = [...steps].reverse().find((s) => s < accumulatedDelta.current) || 0;
          }
        }
      } else {
        accumulatedDelta.current += delta;
      }

      targetSeekPosition.current = Math.max(0, Math.min(position + accumulatedDelta.current, duration));
      setPosition(targetSeekPosition.current);

      const sign = accumulatedDelta.current > 0 ? "+" : "";
      const absMs = Math.abs(accumulatedDelta.current);
      const displayStr =
        absMs >= 60000
          ? `${Math.floor(absMs / 60000)}m${(absMs % 60000) > 0 ? ` ${(absMs % 60000) / 1000}s` : ""}`
          : `${absMs / 1000}s`;
      setSeekIndicator(`${sign}${displayStr}`);

      if (seekTimeout.current) clearTimeout(seekTimeout.current);
      isSeeking.current = true;

      seekTimeout.current = setTimeout(() => {
        if (!mountedRef.current) return;
        try {
          if (targetSeekPosition.current !== null) {
            performSeek(targetSeekPosition.current);
            setSeekIndicator(null);
          }
        } catch (e) {
          console.error("Seek error:", e);
        } finally {
          targetSeekPosition.current = null;
          accumulatedDelta.current = 0;
          if (dummyLeftFocusedRef.current || dummyRightFocusedRef.current) {
            seekBarRef.current?.focus();
          }
        }
      }, 800);

      resetControlsTimeout();
    },
    [duration, isSeekable, position, resetControlsTimeout, params.type, performSeek]
  );
  useEffect(() => { accumulateSeekRef.current = accumulateSeek; }, [accumulateSeek]);

  // ── D-pad (TV remote / navigation buttons) ──────────────────────────────
  useDPad(
    {
      onPlayPause: () => {
        if (isLockedRef.current) return;
        if (!showControlsRef.current) {
          setShowControls(true);
          resetControlsTimeout();
        } else {
          togglePlay();
          resetControlsTimeout();
        }
      },
      onFastForward: () => {
        if (isLockedRef.current) return;
        setShowControls(true);
        resetControlsTimeout();
        if (showControlsRef.current && !isLive) {
          seek(180000);
        }
      },
      onRewind: () => {
        if (isLockedRef.current) return;
        setShowControls(true);
        resetControlsTimeout();
        if (showControlsRef.current && !isLive) {
          seek(-180000);
        }
      },
      onLeft: () => {
        if (isLockedRef.current) return;
        if (!showControlsRef.current) {
          setShowControls(true);
          resetControlsTimeout();
        } else if (!isLive && !isNavRowFocusedRef.current) {
          accumulateSeek(-10000, true);
          resetControlsTimeout();
        }
      },
      onRight: () => {
        if (isLockedRef.current) return;
        if (!showControlsRef.current) {
          setShowControls(true);
          resetControlsTimeout();
        } else if (!isLive && !isNavRowFocusedRef.current) {
          accumulateSeek(10000, true);
          resetControlsTimeout();
        }
      },
      onSelect: () => {
        if (isLockedRef.current) return;
        if (!showControlsRef.current) {
          setShowControls(true);
          resetControlsTimeout();
        }
      },
      onUp: () => {
        setShowControls(true);
        resetControlsTimeout();
      },
      onDown: () => {
        setShowControls(true);
        resetControlsTimeout();
      },
      onMenu: () => {
        setShowControls(true);
        resetControlsTimeout();
      },
      onPageUp: () => {
        setShowControls(true);
        resetControlsTimeout();
      },
      onPageDown: () => {
        setShowControls(true);
        resetControlsTimeout();
      },
      onAny: () => {
        if (!showControlsRef.current) {
          setShowControls(true);
          resetControlsTimeout();
        }
      },
    },
    {
      enabled: !showAudioModal && !showSubtitleModal && !showVideoModal,
      priority: DPAD_PRIORITY.PLAYER,
    }
  );

  // ── Native TV remote event listener (guarantees controls wake up on any remote event) ──
  useTVEventHandler((evt: any) => {
    if (!evt || !evt.eventType || evt.eventType === "focus" || evt.eventType === "blur") return;
    const action = evt?.eventKeyAction;
    if (action === 1 || action === "1" || action === "up") return;
    if (showAudioModalRef.current || showSubtitleModalRef.current || showVideoModalRef.current) return;

    if (!showControlsRef.current) {
      setShowControls(true);
      resetControlsTimeout();
    } else {
      resetControlsTimeout();
    }
  });

  const cyclePlaybackSpeed = () => {
    if (isLockedRef.current) return;
    const speeds = [1.0, 1.25, 1.5, 1.75, 2.0, 0.5, 0.75];
    const next = speeds[(speeds.indexOf(playbackSpeed) + 1) % speeds.length];
    setPlaybackSpeed(next);
    if (usingVLC) {
      // VLCPlayer uses a dynamic `rate` prop — state update propagates on its own.
    } else {
      expoVideoRef.current?.setRateAsync(next, true).catch(() => { });
    }
    setSeekIndicator(`${next.toFixed(2)}x Speed`);
    setTimeout(() => setSeekIndicator(null), 1000);
    resetControlsTimeout();
  };

  const handleProgressPress = (e: GestureResponderEvent) => {
    if (isLockedRef.current || isTV) return;
    progressViewRef.current?.measure((_x: any, _y: any, width: any, _h: any, pageX: any) => {
      const frac = Math.max(0, Math.min(1, (e.nativeEvent.pageX - pageX) / width));
      seek(frac * duration - position);
    });
  };

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0)
      return `${h}:${(m % 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
    return `${m}:${(s % 60).toString().padStart(2, "0")}`;
  };

  // ── Silent retry with exponential backoff (works for either player: it
  //    just fetches a fresh URL from StreamManager and lets the mounted
  //    player pick it up via its `key`/`source` change) ─────────────────────
  const handleSilentRetry = useCallback(async () => {
    if (isRetryingRef.current) return;

    if (retryCount.current >= maxRetries || !activePortal || !params.cmd) {
      setIsLoading(false);
      setIsBuffering(false);
      if (bufferingTimeoutRef.current) {
        clearTimeout(bufferingTimeoutRef.current);
        bufferingTimeoutRef.current = null;
      }

      // Live streams: enter a 15 s silent reconnect loop instead of hard failure
      if (isLive && activePortal && params.cmd && !liveReconnectIntervalRef.current) {
        setLiveReconnectMode(true);
        liveReconnectIntervalRef.current = setInterval(() => {
          if (!mountedRef.current) return;
          retryCount.current = 0;
          isRetryingRef.current = false;
          handleSilentRetryRef.current();
        }, 15000);
      } else if (!isLive) {
        setPlaybackFailed(true);
      }
      return;
    }

    isRetryingRef.current = true;
    retryCount.current += 1;
    setIsRetrying(true);

    // Exponential backoff: 500 ms, 1 s, 2 s, 4 s, 8 s … capped at 30 s
    const backoffMs = Math.min(500 * Math.pow(2, retryCount.current - 1), 30000);

    try {
      // If network is gone, wait up to 30 s for reconnect before giving up this attempt
      const netState = await NetInfo.fetch();
      if (!netState.isConnected) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 30000);
          const unsub = NetInfo.addEventListener((s) => {
            if (s.isConnected) { clearTimeout(timeout); unsub(); resolve(); }
          });
        });
      }

      await new Promise((r) => setTimeout(r, backoffMs));

      const result = await StreamManager.retryStream(
        { id: params.contentId || "", name: params.title || "", streamUrl: params.cmd },
        activePortal,
        params.type === "live" ? "itv" : "vod",
        retryCount.current - 1
      );

      if (result.success && result.url) {
        // Full state reset — clean slate for the new URL
        isSeeking.current = false;
        vlcSeekTargetRef.current = null;
        targetSeekPosition.current = null;
        bufferingStartedRef.current = null;
        lastProgressTimeRef.current = Date.now();
        lastProgressPositionRef.current = positionRef.current;

        if (!isLive) {
          hasSetInitialPosition.current = false;
          savedResumePosition.current = positionRef.current;
        }

        setVlcSeekTarget(undefined);
        setIsBuffering(false);
        setIsLoading(true);
        setStreamUrl(result.url);
        stopLiveReconnectLoop();
      } else {
        setIsLoading(false);
      }
    } catch (e) {
      console.error("[Player] Retry failed:", e);
      setIsLoading(false);
    } finally {
      setIsRetrying(false);
      isRetryingRef.current = false;
    }
  }, [activePortal, params, isLive, maxRetries, stopLiveReconnectLoop]);

  useEffect(() => { handleSilentRetryRef.current = handleSilentRetry; }, [handleSilentRetry]);

  // ── expo-av status handler (fallback path) ────────────────────────────────
  const onExpoStatusUpdate = useCallback(
    (status: AVPlaybackStatus) => {
      if (!status.isLoaded) {
        if (status.error && !isRetryingRef.current) handleSilentRetryRef.current();
        return;
      }
      setPlaybackFailed(false);
      handleBufferingChange(status.isBuffering);
      if (status.durationMillis) { durationRef.current = status.durationMillis; setDuration(status.durationMillis); }
      if (status.positionMillis !== undefined && !isSeeking.current) {
        handleNormalizedProgress(status.positionMillis, status.durationMillis || durationRef.current);
      }
      if (status.didJustFinish) {
        setIsPlaying(false);
        if (params.contentId) {
          StreamManager.savePlaybackPosition(params.contentId, 0, status.durationMillis || durationRef.current);
        }
      }
    },
    [handleBufferingChange, handleNormalizedProgress, params.contentId]
  );



  // ── App state (background / foreground) ──────────────────────────────────
  const prevAppStateRef = useRef<AppStateStatus>("active");
  useEffect(() => {
    PlaybackState.setActive(true);
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state !== "active") {
        setIsPlaying(false);
      } else if (prevAppStateRef.current !== "active") {
        savedResumePosition.current = positionRef.current;
        hasSetInitialPosition.current = false;
        retryCount.current = 0;
        isRetryingRef.current = false;
        stopLiveReconnectLoop();
        setIsLoading(true);
        handleSilentRetryRef.current();
      }
      prevAppStateRef.current = state;
    });
    return () => { PlaybackState.setActive(false); sub.remove(); };
  }, [stopLiveReconnectLoop]);

  // ── Derived values ────────────────────────────────────────────────────────
  const progressPercent = isLive
    ? 0
    : duration > 0
      ? Math.min(100, Math.max(0, (position / duration) * 100))
      : 0;

  const normalizeVlcTracks = (tracks: any[]): any[] => {
    if (!Array.isArray(tracks)) return [];
    return tracks.map((t, i) => ({
      id: t.id ?? t.index ?? i,
      index: i,
      name: t.name ?? t.title ?? t.language ?? `Track ${i + 1}`,
      language: t.language,
    }));
  };

  // ── Build VLC initOptions — IPTV / 4K hardened & Instant Start ───────────
  const buildVlcInitOptions = (): string[] => {
    const cache = networkCacheMs;
    const rtspCache = Math.round(cache * 0.75);
    return [
      // ── Instant start & low-latency buffering ──────────────────────────
      `--network-caching=${cache}`,       // Primary HTTP/HLS buffer
      `--live-caching=${cache}`,          // Live stream buffer
      `--file-caching=${isLive ? cache : Math.min(cache, 500)}`, // Local / VOD cache
      `--sout-mux-caching=${cache}`,      // Muxer output cache

      // ── Clock — zero jitter latency ───────────────────────────────────
      `--clock-jitter=0`,
      `--clock-synchro=0`,

      // ── RTSP / RTP ────────────────────────────────────────────────────
      `--rtsp-tcp`,                       // TCP is more reliable than UDP on lossy links
      `--rtsp-caching=${rtspCache}`,
      `--rtp-max-misorder=100`,           // Tolerate 100-packet misordering (common on 3G)

      // ── Fast probing & HTTP streaming ─────────────────────────────────
      `--http-reconnect`,                 // Auto-reconnect dropped HTTP connections
      `--http-continuous`,                // Keep TCP connection alive between HLS segments
      `--http-user-agent=Lavf/58.76.100`, // VLC/FFmpeg-compatible UA — accepted by all IPTV providers
      `--no-sub-autodetect-file`,         // Skip filesystem search for subtitles to start instantly

      // ── Hardware decode chain: MediaCodec → libavcodec ────────────────
      `--codec=mediacodec,avcodec`,
      `--avcodec-hw=any`,                 // CRITICAL for 4K streams (hardware decoding)
      `--avcodec-threads=0`,              // Let VLC auto-detect thread count
      `--avcodec-fast`,                   // Allow fast (non-reference) decode — critical for 4K realtime

      // ── TS / HLS demux ────────────────────────────────────────────────
      `--ts-seek-percent`,                // %-based seeking in TS (faster than byte-seeking)
      `--no-ts-trust-pcr`,                // Don't trust PCR timestamps (wrong on many IPTV TS feeds)

      // ── Audio ─────────────────────────────────────────────────────────
      `--audio-time-stretch`,             // Compensate audio drift during buffering/reconnect

      // ── Frame handling ────────────────────────────────────────────────
      `--drop-late-frames`,               // Drop frames that arrive past their PTS
      `--skip-frames`,                    // Allow frame-skipping under heavy load

      // ── General & OSD bypass for instant frame render ─────────────────
      `--no-video-title-show`,            // No VLC title overlay
      `--no-stats`,                       // Disable internal statistics (saves CPU)
      `--demux-filter=none`,              // Bypass demux filters

      // ── Seek mode per content type ────────────────────────────────────
      ...(isLive
        ? [`--no-input-fast-seek`]        // Fast-seek breaks HLS live-edge positioning
        : [`--input-fast-seek`]),         // Fast-seek improves VOD scrubbing responsiveness
    ];
  };

  const qualityLabel = getQualityLabel(networkQuality, is4K);
  const isShowingHardFailure = playbackFailed && !isLive;

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <View style={S.container} {...panResponder.panHandlers}>
      <StatusBar hidden />

      {/* ── Player: VLC when the native module is available (full IPTV
             hardening below), expo-av otherwise as a compatibility fallback ── */}
      {usingVLC ? (
        // @ts-ignore
        <VLCPlayer
          key={`vlc-${streamUrl}`}
          ref={vlcPlayerRef}
          style={S.video}
          source={({
            uri: streamUrl,
            headers: {
              "User-Agent": "Lavf/58.76.100",
              "Accept": "*/*",
              "Connection": "keep-alive",
              "Icy-MetaData": "1",
            },
            initOptions: buildVlcInitOptions(),
          }) as any}
          seek={vlcSeekTarget}
          paused={!isPlaying}
          rate={playbackSpeed}
          volume={currentVolume}
          videoAspectRatio={ASPECT_RATIOS[aspectRatioIndex].resize}
          // @ts-ignore — videoTrack/audioTrack/textTrack exist at runtime but missing from VLC lib types
          videoTrack={selectedVideoTrack}
          audioTrack={selectedAudioTrack}
          textTrack={selectedTextTrack}
          onLoad={(e: any) => {
            const durationMs = normalizeVlcTime(e.duration);
            handleLoadCommon(durationMs);
            if (e.videoTracks) setVideoTracks(normalizeVlcTracks(e.videoTracks));
            if (e.audioTracks) setAudioTracks(normalizeVlcTracks(e.audioTracks));
            if (e.textTracks) setTextTracks(normalizeVlcTracks(e.textTracks));
          }}
          onPlaying={() => {
            setIsLoading(false);
            setIsBuffering(false);
            setPlaybackFailed(false);
            stopLiveReconnectLoop();
            lastProgressTimeRef.current = Date.now();
            lastProgressPositionRef.current = positionRef.current;
            bufferingStartedRef.current = null;

            if (stablePlaybackTimerRef.current) clearTimeout(stablePlaybackTimerRef.current);
            stablePlaybackTimerRef.current = setTimeout(() => {
              // Reset retry count after 20 s of stable playback
              if (mountedRef.current && isPlayingRef.current) retryCount.current = 0;
              stablePlaybackTimerRef.current = null;
            }, 20000);
          }}
          onProgress={(e: any) => {
            const currentMs = normalizeVlcTime(e.currentTime);
            const durationMs = normalizeVlcTime(e.duration);

            if (durationMs > 0) { durationRef.current = durationMs; setDuration(durationMs); }

            if (isSeeking.current) {
              const target = vlcSeekTargetRef.current;
              if (target !== null && durationMs > 0) {
                if (Math.abs(currentMs / durationMs - target) < 0.02) {
                  isSeeking.current = false;
                  vlcSeekTargetRef.current = null;
                }
              }
              return;
            }

            if (currentMs !== lastProgressPositionRef.current) {
              lastProgressPositionRef.current = currentMs;
              lastProgressTimeRef.current = Date.now();
              bufferingStartedRef.current = null;
              setIsBuffering(false);
            }

            handleNormalizedProgress(currentMs, durationMs);
            setIsLoading(false);
          }}
          onBuffering={(e: any) => {
            const buffering = typeof e?.isBuffering === "boolean" ? e.isBuffering : true;
            handleBufferingChange(buffering);
          }}
          onStopped={() => {
            // VLC fires onStopped when the stream terminates unexpectedly
            if (!mountedRef.current || isRetryingRef.current) return;
            if (isPlayingRef.current && !playbackFailed) {
              console.log("[VLC] onStopped — triggering reconnect");
              handleSilentRetryRef.current();
            }
          }}
          onEnd={() => {
            setIsPlaying(false);
            if (params.contentId) StreamManager.savePlaybackPosition(params.contentId, 0, durationRef.current);
          }}
          onError={(e: any) => {
            console.warn("[VLC] onError", e);
            if (!isRetryingRef.current) handleSilentRetry();
          }}
        />
      ) : (
        <Video
          key={`expo-${streamUrl}`}
          ref={expoVideoRef}
          style={S.video}
          source={{ uri: streamUrl }}
          shouldPlay={autoPlay && isPlaying}
          rate={playbackSpeed}
          resizeMode={getExpoResizeMode(ASPECT_RATIOS[aspectRatioIndex].key)}
          onPlaybackStatusUpdate={onExpoStatusUpdate}
          onLoad={(s) => s.isLoaded && handleLoadCommon(s.durationMillis || 0)}
        />
      )}

      {/* TV: invisible focusable overlay to catch OK press when controls are hidden */}
      {!showControls && (
        <Focusable
          hasTVPreferredFocus
          style={StyleSheet.absoluteFill}
          ringOnFocus={false}
          onPress={() => { setShowControls(true); resetControlsTimeout(); }}
        />
      )}

      {/* ── Network lost overlay ─────────────────────────────────────────── */}
      {isNetworkLost && (
        <View style={S.loadingOverlay} pointerEvents="none">
          <Ionicons name="wifi-outline" size={52} color="rgba(255,255,255,0.45)" />
          <Text style={S.loadingText}>No network connection</Text>
          <Text style={[S.loadingText, { fontSize: ps(0.85), opacity: 0.5, marginTop: 2 }]}>
            Waiting to reconnect…
          </Text>
        </View>
      )}

      {/* ── VOD hard failure ─────────────────────────────────────────────── */}
      {isShowingHardFailure && !isNetworkLost && (
        <View style={S.loadingOverlay}>
          <Ionicons name="warning-outline" size={44} color="rgba(255,255,255,0.7)" />
          <Text style={S.loadingText}>Stream unavailable</Text>
          <Focusable
            ringOnFocus={false}
            hasTVPreferredFocus
            style={S.retryBtn}
            onPress={() => {
              retryCount.current = 0;
              isRetryingRef.current = false;
              setPlaybackFailed(false);
              setIsLoading(true);
              handleSilentRetry();
            }}
          >
            <Text style={S.retryBtnText}>RETRY</Text>
          </Focusable>
        </View>
      )}

      {/* ── Loading / buffering overlay ──────────────────────────────────── */}
      {(isLoading || isRetrying || isBuffering) && !isShowingHardFailure && !isNetworkLost && (
        <View style={S.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={THEME.colors.primary} />
          <Text style={S.loadingText}>
            {isRetrying
              ? `Reconnecting… (${retryCount.current}/${maxRetries})`
              : liveReconnectMode
                ? "Reconnecting to stream…"
                : "Buffering…"}
          </Text>
          {networkQuality === "slow" && (
            <Text style={[S.loadingText, { fontSize: ps(0.8), opacity: 0.45, marginTop: 2 }]}>
              Slow network — enlarged buffer active
            </Text>
          )}
        </View>
      )}

      {/* ── Volume indicator ─────────────────────────────────────────────── */}
      {volumeIndicator !== null && (
        <View style={S.centerIndicator} pointerEvents="none">
          <Ionicons name="volume-high" size={40} color="#fff" />
          <Text style={S.indicatorText}>{Math.round(volumeIndicator)}%</Text>
          <View style={S.barContainer}>
            <View style={[S.barFill, { width: `${volumeIndicator}%` }]} />
          </View>
        </View>
      )}

      {/* ── Brightness indicator ─────────────────────────────────────────── */}
      {brightnessIndicator !== null && (
        <View style={S.centerIndicator} pointerEvents="none">
          <Ionicons name="sunny" size={40} color="#fff" />
          <Text style={S.indicatorText}>{Math.round(brightnessIndicator * 100)}%</Text>
          <View style={S.barContainer}>
            <View style={[S.barFill, { width: `${brightnessIndicator * 100}%` }]} />
          </View>
        </View>
      )}

      {/* ── Seek / speed indicator ───────────────────────────────────────── */}
      {seekIndicator !== null && (
        <View style={S.seekIndicatorOverlay} pointerEvents="none">
          <View style={S.seekIndicatorBox}>
            <MaterialCommunityIcons
              name={
                seekIndicator.includes("x")
                  ? "speedometer"
                  : seekIndicator.startsWith("+")
                    ? "fast-forward"
                    : "rewind"
              }
              size={ps(2.5)}
              color="#fff"
            />
            <Text style={S.seekIndicatorText}>{seekIndicator}</Text>
          </View>
        </View>
      )}

      {/* ── Controls overlay ─────────────────────────────────────────────── */}
      {showControls && (
        <FocusGroup style={S.controlsOverlay}>
          <LinearGradient colors={["rgba(0,0,0,0.78)", "transparent"]} style={S.topGradient} pointerEvents="none" />

          {/* Header */}
          <View style={[S.header, { paddingTop: insets.top + (isTV ? ph(2) : ph(1)) }]}>
            <View style={S.headerLeft}>
              <View style={S.headerInfo}>
                <Text style={S.mainTitle} numberOfLines={1}>{params.title || "Unknown Content"}</Text>
                <Text style={S.subTitle} />
              </View>
            </View>
          </View>

          {/* Center play / seek buttons */}
          {!isLocked && (
            <View style={S.centerRow}>
              {!isLive && (
                <Focusable
                  ringOnFocus={false}
                  focusStyle={S.skipBtnFocused}
                  style={S.skipBtn}
                  onPress={() => seek(-10000)}
                  {...navRowFocusHandlers}
                >
                  <Ionicons name="play-back" size={ps(1.8)} color="#fff" />
                </Focusable>
              )}
              <View style={S.playBtnContainer}>
                <Focusable hasTVPreferredFocus ringOnFocus={false} focusStyle={S.mainPlayBtnFocused} style={S.mainPlayBtn} onPress={togglePlay} {...navRowFocusHandlers}>
                  <Ionicons name={isPlaying ? "pause" : "play"} size={ps(2.8)} color="#fff" />
                </Focusable>
              </View>
              {!isLive && (
                <Focusable
                  ringOnFocus={false}
                  focusStyle={S.skipBtnFocused}
                  style={S.skipBtn}
                  onPress={() => seek(10000)}
                  {...navRowFocusHandlers}
                >
                  <Ionicons name="play-forward" size={ps(1.8)} color="#fff" />
                </Focusable>
              )}
            </View>
          )}

          <LinearGradient colors={["transparent", "rgba(0,0,0,0.88)"]} style={S.bottomGradient} pointerEvents="none" />

          {/* Bottom controls */}
          <View style={[S.bottomOverlay, { paddingBottom: insets.bottom + ph(2) }]}>
            <View style={S.glassControls}>

              {/* Live reconnect banner */}
              {isLive && liveReconnectMode && (
                <View style={S.liveReconnectBanner}>
                  <ActivityIndicator size="small" color="#ffcc00" style={{ marginRight: 8 }} />
                  <Text style={S.liveReconnectText}>Reconnecting to live stream…</Text>
                </View>
              )}

              {/* Progress bar — VOD only */}
              {(!isLocked || isTV) && !isLive && duration > 0 && (
                <View style={S.progressSection}>
                  <View style={S.timeRow}>
                    <Text style={S.timeText}>
                      {formatTime(position)}
                      {duration > 0 && <Text style={{ color: "rgba(255,255,255,0.4)" }}> / {formatTime(duration)}</Text>}
                    </Text>
                    {duration > position && (
                      <Text style={[S.timeText, { opacity: 0.5 }]}>-{formatTime(duration - position)}</Text>
                    )}
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    {isTV && (
                      <Focusable
                        ref={dummyLeftRef}
                        ringOnFocus={false}
                        nextFocusRight={seekBarNode}
                        nextFocusUp={seekBarNode}
                        nextFocusDown={seekBarNode}
                        nextFocusLeft={seekBarNode}
                        style={{ width: 1, height: 1, backgroundColor: "transparent", position: "absolute", left: 0 }}
                        onPress={togglePlay}
                        onFocus={() => {
                          if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current);
                          dummyLeftFocusedRef.current = true;
                          setVisualFocus(true);
                          accumulateSeek(-10000, true);
                          seekBarRef.current?.focus();
                        }}
                        onBlur={() => { dummyLeftFocusedRef.current = false; handleSeekBlur(); }}
                      />
                    )}
                    <Focusable
                      ref={seekBarRef}
                      ringOnFocus={false}
                      style={[S.progressBarWrapper, { flex: 1 }]}
                      nextFocusLeft={dummyLeftNode}
                      nextFocusRight={dummyRightNode}
                      nextFocusDown={actionsRowNode}
                      onFocus={handleSeekFocus}
                      onBlur={handleSeekBlur}
                      onPress={togglePlay}
                    >
                      {() => {
                        const effFocused = isTV
                          ? visualFocus || dummyLeftFocusedRef.current || dummyRightFocusedRef.current
                          : true;
                        return (
                          <View style={S.progressBarInner}>
                            <View ref={progressViewRef} style={[S.progressRail, effFocused && S.progressRailFocused]} onTouchEnd={handleProgressPress}>
                              {isBuffering && <ShimmerBar />}
                              <View style={[S.progressFill, { width: `${progressPercent}%` }]} />
                              <AnimatedScrubber focused={effFocused} progressPercent={progressPercent} />
                            </View>
                          </View>
                        );
                      }}
                    </Focusable>
                    {isTV && (
                      <Focusable
                        ref={dummyRightRef}
                        ringOnFocus={false}
                        nextFocusLeft={seekBarNode}
                        nextFocusUp={seekBarNode}
                        nextFocusDown={seekBarNode}
                        nextFocusRight={seekBarNode}
                        style={{ width: 1, height: 1, backgroundColor: "transparent", position: "absolute", right: 0 }}
                        onPress={togglePlay}
                        onFocus={() => {
                          if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current);
                          dummyRightFocusedRef.current = true;
                          setVisualFocus(true);
                          accumulateSeek(10000, true);
                          seekBarRef.current?.focus();
                        }}
                        onBlur={() => { dummyRightFocusedRef.current = false; handleSeekBlur(); }}
                      />
                    )}
                  </View>
                </View>
              )}

              {/* Actions row */}
              <FocusGroup ref={actionsRowRef} style={S.actionsRow}>
                {(!isLocked || isTV) && (
                  <View style={S.actionsRight}>
                    {isLive && (
                      <View style={S.liveBadgeRow}>
                        <View style={[S.liveDot, liveReconnectMode && { backgroundColor: "#ffcc00" }]} />
                        <Text style={S.liveText}>{liveReconnectMode ? "RECONNECTING" : "LIVE"}</Text>
                      </View>
                    )}
                    <View style={[S.qualityBadge, networkQuality === "slow" && S.qualityBadgeSlow]}>
                      <Text style={S.qualityBadgeText}>{qualityLabel}</Text>
                    </View>
                    {!isLive && (
                      <Focusable ringOnFocus={false} focusStyle={S.iconChipFocused} style={S.settingBtn} onPress={cyclePlaybackSpeed} {...navRowFocusHandlers}>
                        <MaterialCommunityIcons name="play-speed" size={ps(2.0)} color="white" />
                      </Focusable>
                    )}
                    {usingVLC && !isLive && videoTracks.length > 1 && (
                      <Focusable ringOnFocus={false} focusStyle={S.iconChipFocused} style={S.settingBtn} onPress={() => { if (isLockedRef.current) return; setShowVideoModal(true); }} {...navRowFocusHandlers}>
                        <Ionicons name="settings-outline" size={ps(2.0)} color="white" />
                      </Focusable>
                    )}
                    {!isLive && (
                      <Focusable ringOnFocus={false} focusStyle={S.iconChipFocused} style={S.settingBtn} onPress={() => { if (isLockedRef.current) return; setShowSubtitleModal(true); }} {...navRowFocusHandlers}>
                        <MaterialCommunityIcons name="subtitles-outline" size={ps(2.0)} color="white" />
                      </Focusable>
                    )}
                    <Focusable ringOnFocus={false} focusStyle={S.iconChipFocused} style={S.settingBtn} onPress={() => { if (isLockedRef.current) return; setShowAudioModal(true); }} {...navRowFocusHandlers}>
                      <Ionicons name="musical-notes-outline" size={ps(2.0)} color="white" />
                    </Focusable>
                    <Focusable ringOnFocus={false} focusStyle={S.iconChipFocused} style={S.settingBtn} onPress={cycleAspectRatio} {...navRowFocusHandlers}>
                      <MaterialCommunityIcons name="aspect-ratio" size={ps(2.0)} color="white" />
                    </Focusable>
                  </View>
                )}
              </FocusGroup>
            </View>
          </View>
        </FocusGroup>
      )}

      {/* ── Track selection modals ───────────────────────────────────────── */}
      {usingVLC && (
        <TrackSelectionModal
          visible={showVideoModal} title="Video Quality" icon="aperture" isVideo
          options={videoTracks} selected={selectedVideoTrack}
          onSelect={(id: number | undefined) => { setSelectedVideoTrack(id); setShowVideoModal(false); }}
          onClose={() => setShowVideoModal(false)}
        />
      )}
      <TrackSelectionModal
        visible={showAudioModal} title="Audio Track" icon="musical-notes"
        options={audioTracks} selected={selectedAudioTrack}
        onSelect={(id: number) => { setSelectedAudioTrack(id); setShowAudioModal(false); }}
        onClose={() => setShowAudioModal(false)}
      />
      <TrackSelectionModal
        visible={showSubtitleModal} title="Subtitles" icon="text" isSubtitle
        options={textTracks} selected={selectedTextTrack}
        onSelect={(id: number) => { setSelectedTextTrack(id); setShowSubtitleModal(false); }}
        onClose={() => setShowSubtitleModal(false)}
      />
    </View>
  );
}

// ─── normalizeVlcTime (module-level for VLC callbacks) ───────────────────────
function normalizeVlcTime(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// ─── Track Selection Modal ────────────────────────────────────────────────────
function TrackSelectionModal({
  visible, title, icon, options, selected, onSelect, onClose,
  isSubtitle = false, isVideo = false,
}: any) {
  return (
    <Overlay visible={visible} onClose={onClose} contentStyle={S.modalContent}>
      <View style={S.modalHeader}>
        <LinearGradient colors={["#FFFFFF", "#E5E5E5"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={S.modalIconBg}>
          <Ionicons name={(icon as any) || "settings"} size={20} color="#000000" />
        </LinearGradient>
        <Text style={S.modalTitle}>{title}</Text>
        <Text style={S.modalSubtitle}>
          {options.length === 0 ? "No tracks available" : `${options.length} track${options.length !== 1 ? "s" : ""} available`}
        </Text>
      </View>

      <View style={S.modalDivider} />

      <ScrollView style={S.modalScroll} showsVerticalScrollIndicator={false}>
        {isVideo && (
          <Focusable
            ringOnFocus={false}
            hasTVPreferredFocus={isVideo && selected === undefined}
            style={[S.modalOption, selected === undefined && S.modalOptionSelected]}
            focusStyle={S.modalOptionFocused}
            onPress={() => onSelect(undefined)}
          >
            {(focused: boolean) => (
              <View style={S.modalOptionInner}>
                <View style={S.modalOptionLeft}>
                  <View style={[S.trackIndexBadge, selected === undefined && S.trackIndexBadgeActive]}>
                    <Ionicons name="aperture" size={14} color={selected === undefined ? "#000" : "rgba(255,255,255,0.5)"} />
                  </View>
                  <Text style={[S.modalOptionText, selected === undefined && S.modalOptionTextSelected, focused && S.modalOptionTextFocused]}>
                    Auto (Recommended)
                  </Text>
                </View>
                {selected === undefined && <View style={S.checkBadge}><Ionicons name="checkmark" size={14} color="#000" /></View>}
              </View>
            )}
          </Focusable>
        )}

        {options.length === 0 ? (
          <View style={S.emptyState}>
            <Ionicons name="alert-circle-outline" size={32} color="rgba(255,255,255,0.2)" />
            <Text style={S.emptyText}>No tracks found</Text>
          </View>
        ) : (
          options.map((track: any, index: number) => {
            const id = typeof track === "object" ? (track.id ?? track.index ?? index) : index;
            const isSelected = selected !== undefined && selected === id;
            const trackName = typeof track === "object"
              ? (track.title || track.language || track.name || `Track ${index + 1}`)
              : track;
            return (
              <Focusable
                key={index}
                hasTVPreferredFocus={index === 0}
                ringOnFocus={false}
                style={[S.modalOption, isSelected && S.modalOptionSelected]}
                focusStyle={S.modalOptionFocused}
                onPress={() => onSelect(id, index)}
              >
                {(focused: boolean) => (
                  <View style={S.modalOptionInner}>
                    <View style={S.modalOptionLeft}>
                      <View style={[S.trackIndexBadge, isSelected && S.trackIndexBadgeActive]}>
                        <Text style={[S.trackIndexText, isSelected && S.trackIndexTextActive]}>{index + 1}</Text>
                      </View>
                      <Text style={[S.modalOptionText, isSelected && S.modalOptionTextSelected, focused && S.modalOptionTextFocused]} numberOfLines={2}>
                        {trackName}
                      </Text>
                    </View>
                    {isSelected && <View style={S.checkBadge}><Ionicons name="checkmark" size={14} color="#000" /></View>}
                  </View>
                )}
              </Focusable>
            );
          })
        )}

        {isSubtitle && (
          <Focusable
            ringOnFocus={false}
            hasTVPreferredFocus={isSubtitle && options.length === 0}
            style={[S.modalOption, selected === -1 && S.modalOptionSelected]}
            focusStyle={S.modalOptionFocused}
            onPress={() => onSelect(-1)}
          >
            {(focused: boolean) => (
              <View style={S.modalOptionInner}>
                <View style={S.modalOptionLeft}>
                  <View style={[S.trackIndexBadge, selected === -1 && S.trackIndexBadgeActive]}>
                    <Ionicons name="close" size={14} color={selected === -1 ? "#000" : "rgba(255,255,255,0.5)"} />
                  </View>
                  <Text style={[S.modalOptionText, selected === -1 && S.modalOptionTextSelected, focused && S.modalOptionTextFocused]}>
                    Disable Subtitles
                  </Text>
                </View>
                {selected === -1 && <View style={S.checkBadge}><Ionicons name="checkmark" size={14} color="#000" /></View>}
              </View>
            )}
          </Focusable>
        )}
      </ScrollView>

      <View style={S.modalDivider} />

      <Focusable
        ringOnFocus={false}
        hasTVPreferredFocus={options.length === 0 && !isSubtitle}
        style={S.modalCloseBtn}
        focusStyle={S.modalCloseBtnFocused}
        onPress={onClose}
      >
        <Text style={S.modalCloseBtnText}>CLOSE</Text>
      </Focusable>
    </Overlay>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  video: { ...StyleSheet.absoluteFillObject },

  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.82)",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
  },
  loadingText: {
    color: "#fff",
    marginTop: 10,
    fontSize: ps(1.1),
    fontWeight: "600",
    fontFamily: THEME.fonts.medium,
    textAlign: "center",
    paddingHorizontal: 24,
  },

  centerIndicator: {
    position: "absolute",
    top: "50%",
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
    padding: 25,
    borderRadius: 20,
    alignItems: "center",
    marginTop: -60,
  },
  indicatorText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
    fontFamily: THEME.fonts.bold,
    marginTop: 10,
  },
  barContainer: {
    height: 4,
    width: 100,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 2,
    marginTop: 15,
  },
  barFill: { height: "100%", backgroundColor: THEME.colors.primary, borderRadius: 2 },

  retryBtn: {
    marginTop: 20,
    paddingHorizontal: 32,
    paddingVertical: 13,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  retryBtnText: {
    color: "#fff",
    fontSize: ps(1),
    fontWeight: "800",
    fontFamily: THEME.fonts.bold,
    letterSpacing: 2,
  },

  // Shimmer buffering animation on progress rail
  shimmerContainer: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  shimmerBar: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: "40%",
    backgroundColor: "rgba(255,255,255,0.18)",
  },

  // Seek / speed indicator
  seekIndicatorOverlay: {
    position: "absolute",
    top: "40%",
    alignSelf: "center",
    zIndex: 100,
  },
  seekIndicatorBox: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.75)",
    paddingHorizontal: 28,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  seekIndicatorText: {
    color: "#fff",
    fontSize: ps(1.6),
    fontWeight: "900",
    fontFamily: THEME.fonts.bold,
    marginTop: 4,
    letterSpacing: 1,
  },

  controlsOverlay: { ...StyleSheet.absoluteFillObject },
  topGradient: { position: "absolute", top: 0, left: 0, right: 0, height: "30%" },
  bottomGradient: { position: "absolute", bottom: 0, left: 0, right: 0, height: "45%" },

  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: pw(5),
    alignItems: "flex-start",
    zIndex: 10,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 20, flex: 1 },
  headerInfo: { gap: 4, flex: 1 },
  mainTitle: {
    color: "#fff",
    fontSize: ps(1.8),
    fontWeight: "900",
    fontFamily: THEME.fonts.bold,
    letterSpacing: -0.5,
  },
  subTitle: {
    color: "rgba(255,255,255,0.6)",
    fontSize: ps(0.9),
    fontWeight: "600",
    fontFamily: THEME.fonts.medium,
  },
  qualityBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  qualityBadgeSlow: {
    opacity: 0.7,
  },
  qualityBadgeText: {
    color: "#fff",
    fontSize: ps(1.3),
    fontWeight: "900",
    fontFamily: THEME.fonts.bold,
    letterSpacing: 1,
    opacity: 0.9,
  },

  centerRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: pw(4),
  },
  skipBtn: {
    width: ps(3.5),
    height: ps(3.5),
    borderRadius: ps(1.75),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  skipBtnFocused: {
    transform: [{ scale: 1.18 }],
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  playBtnContainer: { alignItems: "center", justifyContent: "center" },
  mainPlayBtn: {
    width: ps(4.8),
    height: ps(4.8),
    borderRadius: ps(2.4),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  mainPlayBtnFocused: {
    transform: [{ scale: 1.18 }],
    backgroundColor: "rgba(255,255,255,0.15)",
  },

  bottomOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: pw(5),
    zIndex: 10,
  },
  glassControls: {
    paddingVertical: 4,
  },

  // Live reconnect banner
  liveReconnectBanner: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  liveReconnectText: {
    color: "#ffcc00",
    fontSize: ps(0.8),
    fontWeight: "700",
    fontFamily: THEME.fonts.medium,
  },

  progressSection: { gap: 4, marginBottom: 4 },
  timeRow: { flexDirection: "row", justifyContent: "space-between" },
  timeText: {
    color: "#fff",
    fontSize: ps(0.8),
    fontWeight: "700",
    fontFamily: THEME.fonts.bold,
  },
  progressBarWrapper: {
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "transparent",
  },
  progressBarInner: { height: 28, justifyContent: "center" },
  progressRail: {
    height: 6,
    width: "100%",
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 3,
    overflow: "hidden",
  },
  progressRailFocused: { height: 6, borderRadius: 3 },
  progressFill: {
    height: "100%",
    borderRadius: 3,
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  scrubber: {
    position: "absolute",
    top: "50%",
    marginTop: -12,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "white",
    marginLeft: -12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 4,
  },

  liveBadgeRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#ff2d55" },
  liveText: {
    color: "#fff",
    fontSize: ps(0.85),
    fontWeight: "900",
    fontFamily: THEME.fonts.bold,
    letterSpacing: 1,
  },

  actionsRow: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center" },
  iconChip: { padding: 6, borderRadius: 6, borderWidth: 1, borderColor: "transparent" },
  iconChipFocused: { borderColor: "#fff", backgroundColor: "rgba(255,255,255,0.25)", transform: [{ scale: 1.1 }] },
  actionsRight: { flexDirection: "row", alignItems: "center", gap: 14 },
  settingBtn: {
    width: ps(3.6),
    height: ps(3.6),
    borderRadius: ps(1.8),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "transparent",
  },

  // ── Modal ──────────────────────────────────────────────────────────────────
  modalContent: {
    backgroundColor: "rgba(15, 15, 15, 0.95)",
    width: isTV ? "40%" : "75%",
    maxWidth: 380,
    maxHeight: "80%",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  modalHeader: { alignItems: "center", paddingTop: 20, paddingBottom: 12, paddingHorizontal: 20 },
  modalIconBg: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  modalTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    fontFamily: THEME.fonts.bold,
    letterSpacing: -0.5,
    textAlign: "center",
  },
  modalSubtitle: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 11,
    fontWeight: "600",
    fontFamily: THEME.fonts.medium,
    marginTop: 4,
    textAlign: "center",
  },
  modalDivider: { height: 1, backgroundColor: "rgba(255,255,255,0.06)", marginHorizontal: 20 },
  modalScroll: { paddingHorizontal: 16, paddingVertical: 12 },
  emptyState: { alignItems: "center", paddingVertical: 20, gap: 12 },
  emptyText: {
    color: "rgba(255,255,255,0.3)",
    fontSize: 13,
    fontWeight: "600",
    fontFamily: THEME.fonts.medium,
  },
  modalOption: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  modalOptionSelected: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderColor: "rgba(255,255,255,0.3)",
  },
  modalOptionFocused: { borderColor: "#fff", backgroundColor: "rgba(255,255,255,0.15)" },
  modalOptionInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flex: 1,
  },
  modalOptionLeft: { flexDirection: "row", alignItems: "center", gap: 14, flex: 1 },
  trackIndexBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  trackIndexBadgeActive: { backgroundColor: "#fff" },
  trackIndexText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 10,
    fontWeight: "900",
    fontFamily: THEME.fonts.bold,
  },
  trackIndexTextActive: { color: "#000" },
  modalOptionText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
    fontFamily: THEME.fonts.bold,
    flex: 1,
  },
  modalOptionTextSelected: { color: THEME.colors.primary, fontFamily: THEME.fonts.bold },
  modalOptionTextFocused: { color: "#fff", fontFamily: THEME.fonts.bold },
  checkBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  modalCloseBtn: {
    alignItems: "center",
    paddingVertical: 10,
    marginHorizontal: 16,
    marginVertical: 6,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "transparent",
  },
  modalCloseBtnFocused: { borderColor: "#fff", backgroundColor: "rgba(255,255,255,0.12)" },
  modalCloseBtnText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    fontWeight: "700",
    fontFamily: THEME.fonts.bold,
    letterSpacing: 2,
  },

  // Unused legacy slots (kept to avoid import errors from other files referencing S)
  backBtn: {
    width: ps(3.5),
    height: ps(3.5),
    borderRadius: 25,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  vSeparator: { width: 1, height: 12, backgroundColor: "rgba(255,255,255,0.2)" },
  seekHint: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  seekHintText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: ps(0.7),
    fontWeight: "600",
    fontFamily: THEME.fonts.medium,
  },
  actionLabelBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  actionLabel: { color: "#fff", fontSize: ps(0.75), fontWeight: "900", fontFamily: THEME.fonts.bold },
});