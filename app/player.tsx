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
import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
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
import { Image } from "expo-image";
import { useKeepAwake } from "expo-keep-awake";
import { StreamManager } from "../src/services/StreamManager";
import { PlaybackState } from "../src/services/PlaybackState";
import { usePortalStore, Channel } from "../src/store/portalStore";
import { isTV } from "../src/utils/tvUtils";
import { THEME, ps, pw, ph } from "../src/theme/tokens";
import { Focusable, FocusGroup, Overlay, useDPad, DPAD_PRIORITY, useStbKeys, STB_PRIORITY } from "../src/tv";
import NetInfo from "@react-native-community/netinfo";
import { epgService } from "../src/services/epgService";
import { buildImageUrl } from "../src/services/portalApi";
import { parentalControl } from "../src/services/parentalControl";
import { stbEnvironment, BufferTuning, applySameHostStreamProxy } from "../src/services/stbEnvironment";
import { liveChannelSession, buildChannelNumbers, withChannelNumbers } from "../src/services/liveChannelSession";
import { playbackQueue, QueueItem } from "../src/services/playbackQueue";
import { resumeIndex } from "../src/services/resumeIndex";
import { useNowNext } from "../src/hooks/useNowNext";
import { useChannelTuner } from "../src/hooks/useChannelTuner";
import ChannelInfoBar from "../src/components/ChannelInfoBar";
import ChannelZapList from "../src/components/ChannelZapList";
import MediaInfoBar from "../src/components/MediaInfoBar";
import QueueList from "../src/components/QueueList";
import UpNextCard from "../src/components/UpNextCard";
import { ChannelTunerReadout } from "../src/components/ChannelTunerOverlay";
import PinPrompt from "../src/components/PinPrompt";

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

/**
 * Within this much of the duration, a stream that stops has finished rather
 * than stalled. Two seconds covers the rounding between a container's declared
 * duration and the last frame VLC actually reports.
 */
const END_OF_MEDIA_MS = 2000;

/**
 * How long before the end the "up next" card appears.
 *
 * Two minutes, which is roughly where a closing scene gives way to credits, and
 * is what every streaming service settled on. Offering it only once playback
 * has actually stopped is too late: by then the viewer has already reached for
 * the remote or given up.
 *
 * It only affects when the card is *shown* — the countdown inside it still has
 * to elapse, and cancelling leaves the current episode playing to its end.
 */
const UP_NEXT_LEAD_MS = 2 * 60 * 1000;

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
    case "fast": base = isLive ? 1200 : 600; break;
    case "medium": base = isLive ? 1800 : 1000; break;
    case "slow": base = isLive ? 2500 : 1500; break;
    default: base = isLive ? 1500 : 800; break;
  }
  return is4K ? Math.round(base * 1.25) : base;
}

/**
 * The cache VLC is actually given, in ms.
 *
 * Three inputs, in priority order:
 *
 *   • the buffer profile the viewer chose — their stated preference for
 *     zap speed over resilience;
 *   • the network floor — "Instant" cannot be honoured on a 3G connection, so
 *     a poor line raises the minimum whatever the setting says;
 *   • the stall boost — after repeated stalls the player deepens its own
 *     buffer, because a viewer watching it stutter did not get the trade they
 *     asked for. This is the part that makes playback settle down on a bad
 *     line instead of stuttering indefinitely.
 */
function resolveCacheMs(
  tuning: BufferTuning,
  quality: NetworkQuality,
  isLive: boolean,
  is4K: boolean,
  boost: number
): number {
  const preference = isLive ? tuning.liveCacheMs : tuning.vodCacheMs;
  const floor = calcNetworkCacheMs(quality, isLive, is4K);
  return Math.round(Math.max(preference, floor) * boost);
}

/**
 * The quality chip's text, or null when there is nothing honest to put in it.
 *
 * This used to fall back to "LIVE" for unknown quality, which was wrong twice
 * over: "LIVE" describes the stream type, not its quality, so the chip claimed
 * to have measured something it had not — and on a live channel it collided
 * with the actual LIVE indicator, producing two badges labelled "LIVE" (and the
 * duplicate-key warning that exposed it). An unmeasured line gets no chip.
 */
function getQualityLabel(quality: NetworkQuality, is4K: boolean): string | null {
  if (is4K) return "4K";
  switch (quality) {
    case "fast": return "HD";
    case "medium": return "SD";
    case "slow": return "LOW";
    default: return null;
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
    logo?: string;
    drmScheme?: string;
    drmLicenseUrl?: string;
  }>();
  const insets = useSafeAreaInsets();
  const activePortal = usePortalStore((s) => s.activePortal);

  const [isDetected4K, setIsDetected4K] = useState(false);
  const isLive = params.type === "live";
  const is4K =
    isDetected4K ||
    (typeof params.title === "string" &&
      (params.title.toUpperCase().includes("4K") || params.title.toUpperCase().includes("UHD")));

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
  const [streamUrl, setStreamUrl] = useState(() =>
    applySameHostStreamProxy(params.url || "", activePortal, params.cmd)
  );
  const [seekBarNode, setSeekBarNode] = useState<number | undefined>(undefined);
  const [dummyLeftNode, setDummyLeftNode] = useState<number | undefined>(undefined);
  const [dummyRightNode, setDummyRightNode] = useState<number | undefined>(undefined);
  const [actionsRowNode, setActionsRowNode] = useState<number | undefined>(undefined);
  const seekBarRef = useRef<any>(null);
  const dummyLeftRef = useRef<any>(null);
  const dummyRightRef = useRef<any>(null);
  const [showControls, setShowControls] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [hasStartedPlaying, setHasStartedPlaying] = useState(false);
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

  // ── Set-top-box layer ─────────────────────────────────────────────────────
  /**
   * Whether the zap session belongs to the channel this screen was opened with.
   *
   * The session outlives the player, so a live stream opened from Search or a
   * deep link would otherwise adopt whatever list Live TV left behind. Decided
   * once at mount: a zap replaces the tuned channel, so re-checking later would
   * only ever agree with itself.
   */
  const [hasZapSession] = useState(() =>
    hasZapSessionInitial(params.type, params.contentId) || params.type === "live"
  );
  /** The tuned channel, when Live TV handed a zap list over. */
  const [liveChannel, setLiveChannel] = useState<Channel | null>(() => {
    if (hasZapSessionInitial(params.type, params.contentId)) {
      return liveChannelSession.channel;
    }
    if (params.type === "live") {
      const storeChannels = usePortalStore.getState().channels;
      if (params.contentId && storeChannels.length > 0) {
        const found = storeChannels.find((c) => String(c.id) === String(params.contentId));
        if (found) {
          const allNumbered = withChannelNumbers(storeChannels, buildChannelNumbers(storeChannels));
          const idx = Math.max(0, allNumbered.findIndex((c) => String(c.id) === String(params.contentId)));
          liveChannelSession.start(allNumbered, idx, "Live TV", usePortalStore.getState().activePortal?.id || "", allNumbered);
          return allNumbered[idx];
        }
      }
      return {
        id: params.contentId || "live_stream",
        name: params.title || "Live Channel",
        streamUrl: params.url || "",
        logo: params.logo || undefined,
      } as Channel;
    }
    return null;
  });
  const [zapIndex, setZapIndex] = useState(() =>
    hasZapSessionInitial(params.type, params.contentId) ? liveChannelSession.current?.index ?? 0 : 0
  );
  const [showBanner, setShowBanner] = useState(params.type === "live");
  const [showZapList, setShowZapList] = useState(false);

  // ── On-demand queue ───────────────────────────────────────────────────────
  const queueHasItems = !isLive && !!playbackQueue.current && playbackQueue.size > 0;
  /** Whether the queue belongs to what this screen was opened with. */
  const [hasQueue, setHasQueue] = useState(() => hasQueueInitial(params.type, params.contentId) || queueHasItems);
  const [queueItem, setQueueItem] = useState<QueueItem | null>(() =>
    (hasQueueInitial(params.type, params.contentId) || queueHasItems) ? playbackQueue.item : null
  );
  const [queueIndex, setQueueIndex] = useState(() =>
    (hasQueueInitial(params.type, params.contentId) || queueHasItems) ? playbackQueue.index : 0
  );
  /** The end-of-episode card. Null when nothing is queued behind this one. */
  const [upNext, setUpNext] = useState<QueueItem | null>(null);
  /**
   * Offered once per title when there is somewhere worth resuming to. The
   * player used to seek straight there, which is the right default but leaves
   * no way to start over.
   */
  const [resumeOffer, setResumeOffer] = useState<{ position: number } | null>(null);
  const [showQueueList, setShowQueueList] = useState(false);
  const rawPoster = queueItem?.poster || params.logo || (params as any).poster;
  const vodPoster = useMemo(() => {
    if (!rawPoster) return "";
    const base = (activePortal?.config?.url || "").replace(/\/$/, "");
    return buildImageUrl(base, rawPoster);
  }, [rawPoster, activePortal]);
  const vodTitle = queueItem?.title || params.title || "Playing";
  const vodSubtitle = queueItem?.subtitle || (!isLive ? (queueItem?.kind === "episode" ? "Episode" : "Movie") : undefined);
  const [pinTarget, setPinTarget] = useState<Channel | null>(null);
  /** Bumped to force VLC to remount when the buffer depth changes. */
  const [bufferGeneration, setBufferGeneration] = useState(0);
  const [bufferTuning, setBufferTuning] = useState<BufferTuning>(() => stbEnvironment.buffer);

  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bufferTuningRef = useRef(bufferTuning);
  bufferTuningRef.current = bufferTuning;
  /**
   * Multiplier applied to the cache after repeated stalls. Steps 1 → 2 → 3 and
   * never comes back down within a session: a line that stalled three times is
   * not one to keep probing with a shallow buffer.
   */
  const bufferBoostRef = useRef(1);
  const isNetworkLostRef = useRef(false);
  /** Live values for the channel being watched; a zap replaces both. */
  const activeCmdRef = useRef<string>(params.cmd || params.url || "");
  const activeContentIdRef = useRef<string>(params.contentId || "");
  const zapInFlightRef = useRef(false);

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
  const lastVlcErrorTimeRef = useRef(0);
  const hasStartedPlayingRef = useRef(false);
  /**
   * Set the first time the reported position actually moves.
   *
   * The VLC binding polls `getTime()` on a 250 ms timer rather than reporting
   * time-changed events, so a frozen stream keeps delivering progress with an
   * unchanging clock — which is exactly what makes position-freeze the right
   * stall signal. The flipside is a stream whose clock never leaves zero: for
   * that one, freeze detection would reconnect every few seconds forever. The
   * watchdog waits for this flag so it only ever judges a clock it has seen
   * running.
   */
  const hasObservedProgressRef = useRef(false);
  const stallCountRef = useRef(0);
  const stallWindowStartRef = useRef(Date.now());
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
  const showZapListRef = useRef(false);
  const showBannerRef = useRef(false);
  const positionRef = useRef(position);
  const durationRef = useRef(duration);
  const isSeekableRef = useRef(isSeekable);
  const dummyLeftFocusedRef = useRef(false);
  const dummyRightFocusedRef = useRef(false);
  const isNavRowFocusedRef = useRef(false);
  const accumulateSeekRef = useRef<(delta: number, isProgressive?: boolean) => void>(() => { });
  const handleTapRef = useRef<(x: number) => void>(() => { });
  const handleSilentRetryRef = useRef<() => void>(() => { });
  // The zap helpers are defined further down but the D-pad handlers above need
  // them, so they are reached through refs. Assigned where they are defined.
  const zapByRef = useRef<(delta: number) => void>(() => { });
  const flashBannerRef = useRef<() => void>(() => { });
  const canZapRef = useRef(false);
  const playQueueItemRef = useRef<(item: QueueItem, index: number) => void>(() => { });
  const stepQueueRef = useRef<(delta: number) => void>(() => { });
  const handleReachedEndRef = useRef<() => void>(() => { });
  const hasQueueRef = useRef(false);
  const showQueueListRef = useRef(false);
  /** Set once the up-next card has been offered for the current title. */
  const upNextArmedRef = useRef(false);

  // ── Ref sync effects ──────────────────────────────────────────────────────
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { showControlsRef.current = showControls; }, [showControls]);
  useEffect(() => { isLockedRef.current = isLocked; }, [isLocked]);
  useEffect(() => { showAudioModalRef.current = showAudioModal; }, [showAudioModal]);
  useEffect(() => { showSubtitleModalRef.current = showSubtitleModal; }, [showSubtitleModal]);
  useEffect(() => { seekBarFocusedRef.current = seekBarFocused; }, [seekBarFocused]);
  useEffect(() => { isFullscreenRef.current = isFullscreen; }, [isFullscreen]);
  useEffect(() => { showZapListRef.current = showZapList; }, [showZapList]);
  useEffect(() => { showQueueListRef.current = showQueueList; }, [showQueueList]);
  useEffect(() => { showBannerRef.current = showBanner; }, [showBanner]);
  useEffect(() => { positionRef.current = position; }, [position]);
  useEffect(() => { durationRef.current = duration; }, [duration]);
  useEffect(() => { isSeekableRef.current = isSeekable; }, [isSeekable]);
  useEffect(() => { setIsSeekable(!isLive); }, [isLive]);
  useEffect(() => {
    networkCacheMsRef.current = networkCacheMs;
  }, [networkCacheMs]);

  // The box's own settings drive the buffer depth and the banner timeout, so
  // they are loaded before the first VLC mount rather than read lazily.
  useEffect(() => {
    let alive = true;
    stbEnvironment.load().then(() => {
      if (alive) setBufferTuning(stbEnvironment.buffer);
    });
    parentalControl.load();
    const unsubscribe = stbEnvironment.subscribe(() => {
      if (alive) setBufferTuning(stbEnvironment.buffer);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

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
      isNetworkLostRef.current = lost;
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

      // Offer the next episode while the current one is still playing.
      const hasValidQueue = !isLive && (hasQueueRef.current || (!!playbackQueue.current && playbackQueue.size > 0));
      const remainingMs = durationMs - positionMs;
      const shouldTriggerLead =
        durationMs > 20000 &&
        (remainingMs <= 45000 || (durationMs > UP_NEXT_LEAD_MS && remainingMs <= UP_NEXT_LEAD_MS));

      if (
        !isLive &&
        !upNextArmedRef.current &&
        shouldTriggerLead &&
        hasValidQueue &&
        playbackQueue.hasNext
      ) {
        upNextArmedRef.current = true;
        const next = playbackQueue.current?.items[playbackQueue.index + 1];
        if (next) setUpNext(next);
      }

      const contentId = activeContentIdRef.current || params.contentId;
      if (contentId && params.type !== "live" && now - lastPositionSaveTime.current > 10000) {
        lastPositionSaveTime.current = now;
        StreamManager.savePlaybackPosition(contentId, positionMs, durationMs);
        // Mirrored so a grid the viewer backs out to shows the bar where they
        // actually left off, not where it was when that screen mounted.
        resumeIndex.note(contentId, positionMs, durationMs);
      }
    },
    [params.contentId, params.type]
  );

  // ── Shared buffering handler (debounced UI flag, used by both players) ────
  const handleBufferingChange = useCallback((buffering: boolean) => {
    if (isLive) {
      if (bufferingTimeoutRef.current) {
        clearTimeout(bufferingTimeoutRef.current);
        bufferingTimeoutRef.current = null;
      }
      setIsBuffering(false);
      lastProgressTimeRef.current = Date.now();
      return;
    }
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

  // ── Stall watchdog ────────────────────────────────────────────────────────
  //
  // The single biggest cause of "it just froze" on an IPTV box. VLC does not
  // reliably report a dead socket: onError and onStopped cover a stream that
  // ends, but a provider that quietly stops sending data leaves the player
  // sitting on a full decoder with no callback of any kind. Progress simply
  // stops advancing, and without something watching for that the picture is
  // frozen until the viewer presses a button.
  //
  // Both stall clocks were already being kept up to date — every progress
  // event, every buffering change, every reconnect touches lastProgressTimeRef
  // — but nothing ever read them. This is the reader.
  useEffect(() => {
    const interval = setInterval(() => {
      if (!mountedRef.current) return;
      // Paused, seeking, already reconnecting, or offline: not a stall, and
      // firing a reconnect in any of those states makes things worse.
      if (!isPlayingRef.current || isSeeking.current) return;
      if (isRetryingRef.current || isNetworkLostRef.current) return;
      if (!hasStartedPlayingRef.current || !hasObservedProgressRef.current) return;

      const since = Date.now() - lastProgressTimeRef.current;
      // The timeout has to clear the buffer depth, or the watchdog fires while
      // the player is legitimately filling a deep cache after a zap.
      if (since < bufferTuningRef.current.stallTimeoutMs) return;

      // Reset the clock first: the reconnect is asynchronous and this must not
      // fire again on the next tick while it is still in flight.
      lastProgressTimeRef.current = Date.now();

      // A film or episode sitting still at its own end has not stalled — it has
      // finished. Plenty of IPTV VOD streams never emit a clean end-of-media
      // event and simply stop delivering, so without this the watchdog would
      // reconnect at the end of every episode and restart it, which is also
      // exactly what stopped auto-advance from ever being reached.
      if (!isLive && durationRef.current > 0) {
        const remaining = durationRef.current - positionRef.current;
        if (remaining <= END_OF_MEDIA_MS) {
          console.log("[Player] stopped at the end — treating as finished");
          setIsPlaying(false);
          handleReachedEndRef.current();
          return;
        }
      }

      const now = Date.now();
      if (now - stallWindowStartRef.current > 60000) {
        stallWindowStartRef.current = now;
        stallCountRef.current = 0;
      }
      stallCountRef.current += 1;

      // Three stalls in a minute means the current buffer is not deep enough
      // for this line. Deepen it and remount, rather than reconnecting into
      // the same conditions over and over.
      if (stallCountRef.current >= 3 && bufferBoostRef.current < 3) {
        bufferBoostRef.current += 1;
        stallCountRef.current = 0;
        console.log(`[Player] repeated stalls — raising buffer to ${bufferBoostRef.current}x`);
        setBufferGeneration((g) => g + 1);
        return;
      }

      console.log(`[Player] no progress for ${since}ms — reconnecting`);
      handleSilentRetryRef.current();
    }, 1000);

    return () => clearInterval(interval);
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
    ScreenOrientation.unlockAsync().catch(() => { });
    if (!isTV) {
      Brightness.getBrightnessAsync()
        .then((b) => {
          if (!isNaN(b)) brightnessRef.current = b;
        })
        .catch(() => { });

      const reqPerm = async () => {
        if (brightnessPermissionRequestInProgress.current) return;
        try {
          brightnessPermissionRequestInProgress.current = true;
          const perm = await Brightness.getPermissionsAsync().catch(() => null);
          if (perm && !perm.granted && perm.canAskAgain) {
            await Brightness.requestPermissionsAsync().catch(() => { });
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
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => { });
        Brightness.restoreSystemBrightnessAsync().catch(() => { });
      }
      // The tuned/queued id, not the launch id: after stepping to episode three
      // this would otherwise write episode three's position over episode one's.
      const watchingId = activeContentIdRef.current || params.contentId;
      if (watchingId && positionRef.current > 0 && durationRef.current > 0) {
        StreamManager.savePlaybackPosition(watchingId, positionRef.current, durationRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Back handler ──────────────────────────────────────────────────────────
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      // The channel list and the tuner are the top layer, so BACK dismisses
      // them before it does anything to playback.
      if (showZapListRef.current) {
        setShowZapList(false);
        return true;
      }
      if (showQueueListRef.current) {
        setShowQueueList(false);
        return true;
      }
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
        activeContentIdRef.current || (params.contentId as string),
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
            // Ask rather than jump. The seek still happens by default — the
            // card times out into it — but "start over" stops being impossible.
            setResumeOffer({ position: saved.position });
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
            Brightness.setBrightnessAsync(newBright).catch(() => { });
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
        // With the controls down, up/down are the channel keys — the mapping
        // every set-top remote uses when no transport bar is showing.
        if (isLive && !showControlsRef.current && canZapRef.current) {
          zapByRef.current(1);
          return;
        }
        setShowControls(true);
        resetControlsTimeout();
      },
      onDown: () => {
        if (isLive && !showControlsRef.current && canZapRef.current) {
          zapByRef.current(-1);
          return;
        }
        setShowControls(true);
        resetControlsTimeout();
      },
      // INFO arrives on this path, not through useStbKeys — see the note at
      // the top of stbKeys.ts. Toggling rather than only showing, because a
      // banner you cannot dismiss with the key that raised it is a trap.
      onInfo: () => {
        if (showBannerRef.current) setShowBanner(false);
        else flashBannerRef.current();
      },
      // Media next/previous are the only channel-ish keys the stock React
      // Native bridge forwards, so they double as CH+/CH- on live and as
      // next/previous episode on demand.
      onNext: () => {
        if (isLive) zapByRef.current(1);
        else stepQueueRef.current(1);
      },
      onPrevious: () => {
        if (isLive) zapByRef.current(-1);
        else stepQueueRef.current(-1);
      },
      onMenu: () => {
        setShowControls(true);
        resetControlsTimeout();
      },
      onPageUp: () => {
        if (isLive && canZapRef.current) {
          zapByRef.current(1);
          return;
        }
        setShowControls(true);
        resetControlsTimeout();
      },
      onPageDown: () => {
        if (isLive && canZapRef.current) {
          zapByRef.current(-1);
          return;
        }
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
      // The up-next card is included: while it counts down its cancel button
      // holds focus, and a stray D-pad press waking the transport controls
      // would take that focus away at the worst possible moment.
      enabled:
        !showAudioModal && !showSubtitleModal && !showVideoModal &&
        !showZapList && !showQueueList && !upNext && !pinTarget,
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

    if (retryCount.current >= maxRetries || !activePortal || !activeCmdRef.current) {
      setIsLoading(false);
      setIsBuffering(false);
      if (bufferingTimeoutRef.current) {
        clearTimeout(bufferingTimeoutRef.current);
        bufferingTimeoutRef.current = null;
      }

      // Live streams: enter a 15 s silent reconnect loop instead of hard failure
      if (isLive && activePortal && activeCmdRef.current && !liveReconnectIntervalRef.current) {
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
        {
          id: activeContentIdRef.current,
          name: liveChannelRef.current?.name || params.title || "",
          // After a zap this is the *tuned* channel's command, not the one the
          // screen was opened with — reconnecting to the launch channel would
          // silently drop the viewer back where they started.
          streamUrl: activeCmdRef.current,
        },
        activePortal,
        params.type === "live" ? "itv" : "vod",
        retryCount.current - 1,
        playbackQueue.item?.episodeNum
      );

      if (result.success && result.url) {
        // Full state reset — clean slate for the new URL
        isSeeking.current = false;
        vlcSeekTargetRef.current = null;
        targetSeekPosition.current = null;
        bufferingStartedRef.current = null;
        lastProgressTimeRef.current = Date.now();
        lastProgressPositionRef.current = positionRef.current;
        // The new URL is a new clock — the watchdog has to see it move before
        // it is allowed to judge it again.
        hasObservedProgressRef.current = false;
        hasStartedPlayingRef.current = false;
        setHasStartedPlaying(false);
        upNextArmedRef.current = false;

        if (!isLive) {
          hasSetInitialPosition.current = false;
          savedResumePosition.current = positionRef.current;
        }

        setVlcSeekTarget(undefined);
        setIsBuffering(false);
        setIsLoading(true);
        setStreamUrl(applySameHostStreamProxy(result.url, activePortal, activeCmdRef.current));
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

  // ─────────────────────────────────────────────────────────────────────────
  // Zapping — changing channel without leaving the video
  // ─────────────────────────────────────────────────────────────────────────
  const liveChannelRef = useRef<Channel | null>(liveChannel);
  liveChannelRef.current = liveChannel;

  /** Shows the channel banner and starts its auto-hide timer. */
  const flashBanner = useCallback(() => {
    setShowBanner(true);
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    const seconds = stbEnvironment.snapshot.infoBarSeconds || 5;
    bannerTimerRef.current = setTimeout(() => setShowBanner(false), seconds * 1000);
  }, []);

  useEffect(() => () => {
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
  }, []);

  /**
   * Tunes to a channel from the session list.
   *
   * Everything that identifies the old stream is replaced in one go — the URL,
   * the retry command, the saved-position id — because a half-updated player
   * reconnects to the previous channel the first time the new one hiccups.
   */
  const tuneToChannel = useCallback(async (channel: Channel, index: number) => {
    if (!channel?.streamUrl || zapInFlightRef.current) return;

    // The lock is checked here rather than at each caller, so CH+, the number
    // pad and the channel list all go through the same gate.
    if (parentalControl.isChannelLocked(channel)) {
      setPinTarget(channel);
      return;
    }

    zapInFlightRef.current = true;
    try {
      setLiveChannel(channel);
      setZapIndex(index);
      liveChannelSession.tuneToId(String(channel.id));

      // Flash banner immediately so info bar appears with zero delay upon tuning
      flashBanner();

      // A zap starts a fresh connection, so the retry ladder and the stall
      // clock both start over — carrying the previous channel's failure count
      // would make the new channel give up early.
      retryCount.current = 0;
      isRetryingRef.current = false;
      stallCountRef.current = 0;
      hasStartedPlayingRef.current = false;
      setHasStartedPlaying(false);
      hasObservedProgressRef.current = false;
      upNextArmedRef.current = false;
      lastProgressPositionRef.current = 0;
      lastProgressTimeRef.current = Date.now();
      stopLiveReconnectLoop();
      setPlaybackFailed(false);
      setIsLoading(true);
      setIsPlaying(true);

      activeCmdRef.current = channel.streamUrl;
      activeContentIdRef.current = String(channel.id);

      let url = channel.streamUrl;
      if (activePortal?.type === "mag") {
        const result = await StreamManager.getStreamUrl(channel, activePortal, "itv");
        if (result.success && result.url) url = result.url;
      }
      if (!mountedRef.current) return;

      setStreamUrl(applySameHostStreamProxy(url, activePortal, channel.streamUrl));
      flashBanner();

      if (activePortal) {
        liveChannelSession.rememberLastChannel(channel, activePortal.id).catch(() => { });
        epgService.ensureChannel(activePortal, channel).catch(() => { });
      }
    } finally {
      zapInFlightRef.current = false;
    }
  }, [activePortal, flashBanner, stopLiveReconnectLoop]);

  /** True when zapping is available: a live stream, with a list to walk. */
  const canZap = hasZapSession && liveChannelSession.canZap;

  /** CH+ / CH- — one channel along the list Live TV handed over. */
  const zapBy = useCallback((delta: number) => {
    if (!isLive || !canZapRef.current) return;
    const next = liveChannelSession.step(delta);
    const session = liveChannelSession.current;
    if (next && session) tuneToChannel(next, session.index);
  }, [isLive, tuneToChannel]);

  canZapRef.current = canZap;

  zapByRef.current = zapBy;
  flashBannerRef.current = flashBanner;

  /** The numeric tuner's target. Resolves across active session and all portal channels. */
  const tuneToNumber = useCallback((num: number) => {
    const found = liveChannelSession.findByNumber(num);
    if (!found) {
      // Nothing on that number. Say so rather than silently doing nothing.
      setSeekIndicator(`Channel ${num} not found`);
      setTimeout(() => setSeekIndicator(null), 1500);
      return;
    }

    let targetIndex = found.index;
    if (found.isFromAll) {
      targetIndex = liveChannelSession.adoptChannel(found.channel);
    }
    tuneToChannel(found.channel, targetIndex);
  }, [tuneToChannel]);

  const tunerMaxDigits = useMemo(() => {
    let widest = 1;
    const session = hasZapSession ? liveChannelSession.current : null;
    const pool = session?.allChannels && session.allChannels.length > 0
      ? session.allChannels
      : (session?.channels ?? usePortalStore.getState().channels);
    for (const c of pool) {
      if (c.num) widest = Math.max(widest, String(c.num).length);
    }
    return Math.min(5, Math.max(widest, 3));
  }, [liveChannel, hasZapSession]);

  const tuner = useChannelTuner({
    onCommit: tuneToNumber,
    hasPrefix: useCallback((prefix: number) => liveChannelSession.hasNumberPrefix(prefix), []),
    maxDigits: tunerMaxDigits,
    enabled: isLive && hasZapSession && !pinTarget,
  });

  // ─────────────────────────────────────────────────────────────────────────
  // On-demand queue — episode to episode without leaving the video
  // ─────────────────────────────────────────────────────────────────────────
  hasQueueRef.current = hasQueue;

  /**
   * Plays a queued item.
   *
   * The on-demand twin of `tuneToChannel`, and it has the same rule: every
   * identity the player holds is replaced together. The resume id in particular
   * — get that wrong and episode four's position is written over episode
   * three's the first time the progress timer fires.
   */
  const playQueueItem = useCallback(async (item: QueueItem, index: number) => {
    if (!item?.streamUrl || zapInFlightRef.current) return;

    zapInFlightRef.current = true;
    try {
      setUpNext(null);
      setResumeOffer(null);
      setQueueItem(item);
      setQueueIndex(index);
      playbackQueue.jumpTo(index);

      retryCount.current = 0;
      isRetryingRef.current = false;
      stallCountRef.current = 0;
      hasStartedPlayingRef.current = false;
      setHasStartedPlaying(false);
      hasObservedProgressRef.current = false;
      upNextArmedRef.current = false;
      lastProgressPositionRef.current = 0;
      lastProgressTimeRef.current = Date.now();
      stopLiveReconnectLoop();
      setPlaybackFailed(false);
      setIsLoading(true);
      setIsPlaying(true);
      setPosition(0);
      setDuration(0);
      durationRef.current = 0;
      positionRef.current = 0;

      activeCmdRef.current = item.streamUrl;
      activeContentIdRef.current = item.id;

      // A new title has its own resume point, and its own right to be sought
      // to once the duration is known.
      hasSetInitialPosition.current = false;
      const saved = await StreamManager.getPlaybackPosition(item.id);
      savedResumePosition.current =
        saved && saved.position > 0 && saved.duration - saved.position > 5000 ? saved.position : 0;
      // Stepping back to a half-watched episode gets the same offer arriving at
      // one does — it resumes, and says so, and can be started over.
      if (savedResumePosition.current > 0) {
        setResumeOffer({ position: savedResumePosition.current });
      }

      let url = item.streamUrl;
      if (activePortal?.type === "mag") {
        const result = await StreamManager.getStreamUrl(
          { id: item.id, name: item.title, streamUrl: item.streamUrl } as any,
          activePortal,
          "vod",
          item.episodeNum
        );
        if (result.success && result.url) {
          url = result.url;
        } else {
          console.warn("[playQueueItem] Stream resolution failed for", item.title, result.error);
          setIsLoading(false);
          setPlaybackFailed(true);
          return;
        }
      }
      if (!mountedRef.current) return;

      const finalUrl = applySameHostStreamProxy(url, activePortal, item.streamUrl);
      if (!finalUrl || !/^(https?|rtsp|mms):\/\//i.test(finalUrl)) {
        console.warn("[playQueueItem] Invalid final stream URL:", finalUrl);
        setIsLoading(false);
        setPlaybackFailed(true);
        return;
      }

      setStreamUrl(finalUrl);
      flashBanner();
    } finally {
      zapInFlightRef.current = false;
    }
  }, [activePortal, flashBanner, stopLiveReconnectLoop]);

  playQueueItemRef.current = playQueueItem;

  /** Next/previous episode. Stops at the ends — a season is not a ring. */
  const stepQueue = useCallback((delta: number) => {
    if (!hasQueueRef.current) return;
    const next = playbackQueue.step(delta);
    if (next) playQueueItemRef.current(next, playbackQueue.index);
  }, []);

  stepQueueRef.current = stepQueue;

  /**
   * What happens when a title runs out.
   *
   * Clearing the resume point first matters: a finished episode that keeps its
   * position resumes into its own credits next time, and the grid keeps drawing
   * a nearly-full progress bar over something already watched.
   */
  const handleReachedEnd = useCallback(() => {
    const finishedId = activeContentIdRef.current || params.contentId;
    if (finishedId) {
      StreamManager.clearPlaybackPosition(finishedId).catch(() => { });
      // Noted as complete rather than forgotten, so the grid can mark it
      // watched instead of showing it as never started.
      resumeIndex.note(finishedId, durationRef.current, durationRef.current);
    }

    const hasValidQueue = !isLive && (hasQueueRef.current || (!!playbackQueue.current && playbackQueue.size > 0));
    if (!hasValidQueue || !playbackQueue.hasNext) return;

    // Normally the card is already up — the progress handler offers it near the end.
    if (upNextArmedRef.current) return;
    upNextArmedRef.current = true;

    // Offered, not forced: the card counts down visibly and its cancel button
    // takes the focus, so nothing starts without the viewer being able to stop it.
    const next = playbackQueue.current?.items[playbackQueue.index + 1];
    if (next) setUpNext(next);
  }, [params.contentId]);

  handleReachedEndRef.current = handleReachedEnd;

  const hasValidQueue = !isLive && (hasQueue || (!!playbackQueue.current && playbackQueue.size > 0));
  const canStepQueue = hasValidQueue && playbackQueue.size > 0;
  const hasPrevEpisode = hasValidQueue && playbackQueue.hasPrevious;
  const hasNextEpisode = hasValidQueue && playbackQueue.hasNext;

  /**
   * Percentage jump.
   *
   * On a set-top box the number keys mean something different once you are in a
   * recording rather than on a channel: "3" is thirty per cent of the way in,
   * not channel three. Reusing the same keys for both is the convention, and
   * the readout above makes clear which one is in effect.
   */
  const jumpToPercent = useCallback((digit: number) => {
    if (durationRef.current <= 0 || !isSeekableRef.current) return;
    const target = Math.round((digit / 10) * durationRef.current);
    performSeek(target);
    setSeekIndicator(`${digit * 10}%`);
    setTimeout(() => setSeekIndicator(null), 900);
  }, [performSeek]);

  const tunerName = useMemo(() => {
    if (!tuner.entry) return null;
    const targetNum = Number(tuner.entry);
    const found = liveChannelSession.findByNumber(targetNum);
    return found?.channel?.name ?? null;
  }, [tuner.entry]);

  // The guide for whatever is tuned. Passing the portal opts this channel into
  // an on-demand fetch, so a channel the bulk guide missed still fills in.
  const liveNowNext = useNowNext(isLive ? liveChannel : null, activePortal);

  // ── Set-top keys: number pad, CH+/CH-, INFO, GUIDE ───────────────────────
  useStbKeys(
    {
      // Live: dial a channel. On demand: jump to that percentage of the title.
      // Straight off the remote. There is no on-screen number pad by design —
      // react-native-tvos delivers these keys itself (see stbKeys.ts), so the
      // remote *is* the keypad, and the readout is the only UI it needs.
      onDigit: (digit) => (isLive ? tuner.pushDigit(digit) : jumpToPercent(digit)),
      onChannelUp: () => (isLive ? zapBy(1) : stepQueue(1)),
      onChannelDown: () => (isLive ? zapBy(-1) : stepQueue(-1)),
      onGuide: () =>
        isLive ? setShowZapList((v) => !v) : canStepQueue && setShowQueueList((v) => !v),
    },
    {
      enabled: !showZapList && !showQueueList && !pinTarget,
      priority: STB_PRIORITY.PLAYER,
    }
  );



  // Show the banner on arrival, the way a box does when it tunes or starts a
  // recording. Both kinds get it; only the contents differ.
  useEffect(() => {
    if (stbEnvironment.snapshot.autoInfoBar) flashBanner();
    resumeIndex.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      if (status.isPlaying && (status.positionMillis || 0) > 0) {
        hasStartedPlayingRef.current = true;
        setHasStartedPlaying(true);
        setIsLoading(false);
      }
      if (status.didJustFinish) {
        setIsPlaying(false);
        handleReachedEndRef.current();
      }
    },
    [handleBufferingChange, handleNormalizedProgress]
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

  /**
   * VLC start-up options.
   *
   * The cache line is the one that decides whether this feels like a set-top
   * box. It used to be pinned at 300–600 ms in the name of instant start, and
   * that is exactly what produces the stutter this is meant to fix: at 300 ms a
   * single late segment on an IPTV relay is a visible freeze. The depth now
   * comes from the viewer's buffer profile, floored by the measured network
   * quality and multiplied by the stall boost, so a clean line still zaps
   * instantly and a bad one settles down instead of stuttering indefinitely.
   */
  const buildVlcInitOptions = (): string[] => {
    const cache = resolveCacheMs(
      bufferTuningRef.current,
      networkQuality,
      isLive,
      is4K,
      bufferBoostRef.current
    );
    const hardwareDecode = stbEnvironment.snapshot.hardwareAcceleration !== false;
    // Dropping the deblocking filter buys decode latency at the cost of visible
    // artefacts, which is a trade only the "Instant" profile actually asked for.
    const instantProfile = stbEnvironment.snapshot.bufferProfile === "instant";

    return [
      `--network-caching=${cache}`,
      `--live-caching=${cache}`,
      `--file-caching=${isLive ? cache : Math.round(cache * 0.75)}`,
      `--sout-mux-caching=${cache}`,

      // Instant connection & DNS
      "--ipv4",                           // Immediate IPv4 resolution
      "--http-reconnect",                 // Reconnect without tearing the input down
      "--http-continuous",                // Keep-alive TCP pipeline
      "--http-user-agent=okhttp/3.12.1",
      "--rtsp-tcp",
      "--no-sub-autodetect-file",         // Skip local sub scanning for a faster start

      // Decode
      ...(hardwareDecode
        ? ["--codec=mediacodec,avcodec", "--avcodec-hw=any"]
        : ["--codec=avcodec", "--avcodec-hw=none"]),
      "--avcodec-fast",
      "--avcodec-threads=0",
      ...(instantProfile ? ["--avcodec-skiploopfilter=4"] : []),

      // Frame & audio sync
      "--audio-time-stretch",
      "--drop-late-frames",
      "--skip-frames",
      "--no-stats",
      "--no-video-title-show",

      // Live vs VOD seek options
      ...(isLive
        ? [
            "--clock-jitter=0",
            "--clock-synchro=0",
            "--no-input-fast-seek",
            "--no-ts-trust-pcr",
          ]
        : [
            "--input-fast-seek",
          ]),
    ];
  };

  const qualityLabel = getQualityLabel(networkQuality, is4K);
  const isShowingHardFailure = playbackFailed && !isLive;

  /**
   * The channel/title banner, built once and mounted in one of two places.
   *
   * While the transport controls are up it goes inside them, so the two are one
   * panel; with the controls down it gets its own bottom-anchored host. Same
   * node either way, so the two paths cannot drift apart.
   *
   * It is visible whenever the controls are, regardless of its own auto-hide
   * timer: the banner is the top half of that panel, and letting the timer
   * expire underneath a visible control row would leave the panel looking
   * decapitated. The timer still governs the case it was written for — a
   * banner shown on its own by a zap or an INFO press.
   */
  const bannerVisible = (showBanner || showControls) && !showZapList && !showQueueList;

  /**
   * Builds the banner in one of two dresses from one definition.
   *
   * `inline` is the version that sits inside the transport-control panel as its
   * top half: it drops its own edge padding and scrim so it inherits the
   * panel's, which is what lines the two up on both margins instead of leaving
   * them as separately-inset bands. The standalone version keeps both, because
   * with the controls down there is no host to inherit from.
   */
  const buildBanner = (inline: boolean) => !bannerVisible
    ? null
    : isLive && liveChannel
      ? (
        <ChannelInfoBar
          channel={liveChannel}
          nowNext={liveNowNext}
          variant={inline ? "inline" : "player"}
          badges={[
            { label: liveReconnectMode ? "RECONNECTING" : "LIVE", tone: liveReconnectMode ? "warn" : "live" },
            ...(qualityLabel ? [{ label: qualityLabel, tone: "muted" as const }] : []),
          ]}
          hint={
            canZap
              ? `CH ${zapIndex + 1} of ${liveChannelSession.size}  ·  UP/DOWN to change channel`
              : undefined
          }
        />
      )
      : !isLive && queueItem
        ? (
          <MediaInfoBar
            item={queueItem}
            position={position}
            duration={duration}
            queuePosition={hasQueue ? { index: queueIndex, total: playbackQueue.size } : undefined}
            badges={[
              ...(qualityLabel ? [{ label: qualityLabel, tone: "muted" as const }] : []),
              ...(playbackSpeed !== 1 ? [{ label: `${playbackSpeed}x`, tone: "warn" as const }] : []),
            ]}
            nextTitle={
              canStepQueue && playbackQueue.hasNext
                ? playbackQueue.current?.items[queueIndex + 1]?.title
                : null
            }
            hint={canStepQueue ? "CH +/- for the next episode  ·  0-9 to jump" : undefined}
            inline={inline}
          />
        )
        : null;

  const bannerNode = buildBanner(false);
  const inlineBannerNode = buildBanner(true);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <View style={S.container} {...panResponder.panHandlers}>
      <StatusBar hidden />

      {/* ── Player: VLC when the native module is available, expo-av otherwise ── */}
      {usingVLC && streamUrl && /^(https?|rtsp|mms):\/\//i.test(streamUrl) ? (
        // @ts-ignore
        <VLCPlayer
          // The buffer generation is part of the identity on purpose: initOptions
          // are only read at construction, so deepening the cache after repeated
          // stalls has no effect until the view is rebuilt.
          key={`vlc-${streamUrl}-${bufferGeneration}`}
          ref={vlcPlayerRef}
          style={S.video}
          source={({
            uri: streamUrl,
            headers: {
              "User-Agent": "okhttp/3.12.1",
              "Accept": "*/*",
              "Connection": "keep-alive",
              ...(activePortal?.config?.url
                ? { Referer: `${String(activePortal.config.url).replace(/\/$/, "")}/c/index.html` }
                : {}),
            },
            initOptions: buildVlcInitOptions(),
          }) as any}
          seek={!isLive ? vlcSeekTarget : undefined}
          autoplay={autoPlay}
          paused={!isPlaying}
          rate={playbackSpeed}
          volume={currentVolume}
          videoAspectRatio={ASPECT_RATIOS[aspectRatioIndex].resize}
          audioTrack={selectedAudioTrack}
          textTrack={selectedTextTrack}
          onLoad={(e: any) => {
            setIsBuffering(false);
            retryCount.current = 0;
            const durationMs = normalizeVlcTime(e.duration);
            handleLoadCommon(durationMs);
            if (e.videoTracks) {
              const tracks = normalizeVlcTracks(e.videoTracks);
              setVideoTracks(tracks);
              const has4kTrack = e.videoTracks.some(
                (t: any) => (t.width && t.width >= 3840) || (t.height && t.height >= 2160)
              );
              if (has4kTrack) setIsDetected4K(true);
            }
            if (e.audioTracks) setAudioTracks(normalizeVlcTracks(e.audioTracks));
            if (e.textTracks) setTextTracks(normalizeVlcTracks(e.textTracks));
          }}
          onPlaying={() => {
            hasStartedPlayingRef.current = true;
            setHasStartedPlaying(true);
            setIsPlaying(true);
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

            if (currentMs > 0) {
              hasStartedPlayingRef.current = true;
              setHasStartedPlaying(true);
              setIsLoading(false);
              setIsBuffering(false);
            }

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
              if (currentMs > 0) hasObservedProgressRef.current = true;
              bufferingStartedRef.current = null;
              setIsBuffering(false);
            }

            handleNormalizedProgress(currentMs, durationMs);
            setIsLoading(false);
          }}
          onBuffering={(e: any) => {
            const buffering =
              typeof e?.isBuffering === "boolean"
                ? e.isBuffering
                : typeof e?.buffering === "number"
                  ? e.buffering < 100
                  : typeof e?.bufferRate === "number"
                    ? e.bufferRate < 100
                    : false;
            handleBufferingChange(buffering);
          }}
          onStopped={() => {
            // VLC fires onStopped when the stream terminates unexpectedly
            if (!mountedRef.current || isRetryingRef.current) return;
            if (hasStartedPlayingRef.current && isPlayingRef.current && !playbackFailed) {
              console.log("[VLC] onStopped — triggering reconnect");
              handleSilentRetryRef.current();
            }
          }}
          onEnd={() => {
            setIsPlaying(false);
            handleReachedEndRef.current();
          }}
          onError={(e: any) => {
            console.warn("[VLC] onError", e);
            const now = Date.now();
            if (now - lastVlcErrorTimeRef.current < 2500) return; // Drop rapid repeated VLC error ticks
            lastVlcErrorTimeRef.current = now;
            if (!isRetryingRef.current && !playbackFailed) {
              handleSilentRetryRef.current();
            }
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
      {!showControls && !showQueueList && !showZapList && (
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

      {/* ── Initial loading state for VOD & Series ────────────────────────── */}
      {!isLive && (!hasStartedPlaying || (isLoading && position === 0)) && !isShowingHardFailure && !isNetworkLost && (
        <View style={S.vodLoadingOverlay} pointerEvents="none">
          {vodPoster ? (
            <Image
              source={{ uri: vodPoster }}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
              blurRadius={35}
            />
          ) : null}
          <View style={S.vodLoadingBackdropDim} />

          <View style={S.vodLoadingCard}>
            {vodPoster ? (
              <View style={S.vodPosterWrapper}>
                <Image
                  source={{ uri: vodPoster }}
                  style={S.vodPosterImage}
                  contentFit="cover"
                />
              </View>
            ) : (
              <View style={S.vodPosterFallback}>
                <Ionicons name="film-outline" size={36} color="rgba(255,255,255,0.45)" />
              </View>
            )}

            <View style={S.vodMetaBlock}>
              <View style={S.vodBadge}>
                <Text style={S.vodBadgeText}>
                  {vodSubtitle?.toLowerCase().includes("season") || vodSubtitle?.toLowerCase().includes("episode")
                    ? "SERIES"
                    : "MOVIE"}
                </Text>
              </View>

              <Text style={S.vodLoadingTitle} numberOfLines={2}>
                {vodTitle}
              </Text>
              {vodSubtitle ? (
                <Text style={S.vodLoadingSubtitle} numberOfLines={1}>
                  {vodSubtitle}
                </Text>
              ) : null}

              <View style={S.vodSpinnerRow}>
                <ActivityIndicator size="small" color="#ffffff" style={S.vodSpinner} />
                <Text style={S.vodLoadingStatus}>
                  {isRetrying
                    ? `Connecting… (${retryCount.current}/${maxRetries})`
                    : isBuffering
                      ? "Buffering stream…"
                      : "Loading video…"}
                </Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* ── Initial loading for Live TV — suppressed for instant channel tuning ── */}

      {/* ── Mid-stream buffering indicator (compact center pill) ─────────── */}
      {!isLive && hasStartedPlaying && (isBuffering || isRetrying) && !isShowingHardFailure && !isNetworkLost && (
        <View style={S.midstreamBufferingOverlay} pointerEvents="none">
          <View style={S.midstreamBufferingPill}>
            <ActivityIndicator size="small" color={THEME.colors.primary} />
            <Text style={S.midstreamBufferingText}>
              {isRetrying ? `Reconnecting (${retryCount.current})…` : "Buffering…"}
            </Text>
          </View>
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
          {/* No header.
              Its only content was the title, which the banner at the foot of
              this same panel already carries — along with the channel number,
              logo and what is on now. Two copies of the title at opposite ends
              of the screen is worse than one in the place that has the rest of
              the context. The top gradient went with it: it existed to make
              that title legible over the picture. */}

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
            {/* The banner is the top half of this panel rather than a separate
                island floating above it. It used to be pinned at a fixed
                distance from the bottom of the screen, which left a band of
                empty video between the two and made them read as unrelated. */}
            {bannerNode ? (
              <View pointerEvents="none">{inlineBannerNode}</View>
            ) : null}

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
                    {/* No LIVE dot or quality chip here.
                        The banner directly above already carries both as
                        badges, and it is now always visible whenever these
                        controls are — so repeating them put "LIVE  4K" on
                        screen twice, one line apart, which is what made the
                        two rows read as competing panels rather than one. */}

                    {/* Set-top controls. These duplicate remote keys that most
                        Android TV builds never deliver to JS at all, so on that
                        hardware they are the only way to zap. */}
                    {!isLive && canStepQueue && (
                      <>
                        <Focusable ringOnFocus={false} focusStyle={S.iconChipFocused} style={S.settingBtn} onPress={() => setShowQueueList(true)} accessibilityLabel="Episode list" {...navRowFocusHandlers}>
                          <Ionicons name="list-outline" size={ps(2.0)} color="white" />
                        </Focusable>
                        {playbackQueue.size > 1 && (
                          <>
                            <Focusable
                              ringOnFocus={false}
                              focusStyle={S.iconChipFocused}
                              style={[S.settingBtn, !hasPrevEpisode && { opacity: 0.35 }]}
                              disabled={!hasPrevEpisode}
                              onPress={() => stepQueue(-1)}
                              accessibilityLabel="Previous episode"
                              {...navRowFocusHandlers}
                            >
                              <Ionicons name="play-skip-back" size={ps(2.0)} color="white" />
                            </Focusable>
                            <Focusable
                              ringOnFocus={false}
                              focusStyle={S.iconChipFocused}
                              style={[S.settingBtn, !hasNextEpisode && { opacity: 0.35 }]}
                              disabled={!hasNextEpisode}
                              onPress={() => stepQueue(1)}
                              accessibilityLabel="Next episode"
                              {...navRowFocusHandlers}
                            >
                              <Ionicons name="play-skip-forward" size={ps(2.0)} color="white" />
                            </Focusable>
                          </>
                        )}
                      </>
                    )}
                    {isLive && canZap && (
                      <>
                        <Focusable ringOnFocus={false} focusStyle={S.iconChipFocused} style={S.settingBtn} onPress={() => { setShowZapList(true); }} accessibilityLabel="Channel list" {...navRowFocusHandlers}>
                          <Ionicons name="list-outline" size={ps(2.0)} color="white" />
                        </Focusable>
                        <Focusable ringOnFocus={false} focusStyle={S.iconChipFocused} style={S.settingBtn} onPress={() => zapBy(1)} accessibilityLabel="Channel up" {...navRowFocusHandlers}>
                          <Ionicons name="chevron-up" size={ps(2.0)} color="white" />
                        </Focusable>
                        <Focusable ringOnFocus={false} focusStyle={S.iconChipFocused} style={S.settingBtn} onPress={() => zapBy(-1)} accessibilityLabel="Channel down" {...navRowFocusHandlers}>
                          <Ionicons name="chevron-down" size={ps(2.0)} color="white" />
                        </Focusable>
                        <Focusable ringOnFocus={false} focusStyle={S.iconChipFocused} style={S.settingBtn} onPress={() => flashBanner()} accessibilityLabel="Channel info" {...navRowFocusHandlers}>
                          <Ionicons name="information-circle-outline" size={ps(2.0)} color="white" />
                        </Focusable>
                      </>
                    )}
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

      {/* ── Set-top banner, when the transport bar is down ───────────────── */}
      {/* With the controls up the banner is rendered inside them instead, as
          the top half of one panel — see bannerNode. This host only covers the
          other case: a banner on its own after a zap or an INFO press. */}
      {!showControls && bannerNode ? (
        <View style={[S.bannerHost, { bottom: insets.bottom }]} pointerEvents="none">
          {bannerNode}
        </View>
      ) : null}

      {/* ── Numeric tuner ─────────────────────────────────────────────────── */}
      {isLive && hasZapSession && (
        <ChannelTunerReadout entry={tuner.entry} resolvedName={tunerName} width={tunerMaxDigits} />
      )}

      {/* ── Channel list, over the running video ──────────────────────────── */}
      <ChannelZapList
        visible={showZapList && canZap}
        channels={liveChannelSession.current?.channels ?? []}
        currentIndex={zapIndex}
        categoryName={liveChannelSession.current?.categoryName}
        onSelect={(channel, index) => {
          setShowZapList(false);
          tuneToChannel(channel, index);
        }}
        onClose={() => setShowZapList(false)}
      />

      {/* ── Episode list, over the running video ─────────────────────────── */}
      <QueueList
        visible={showQueueList && canStepQueue}
        items={playbackQueue.current?.items ?? []}
        currentIndex={queueIndex}
        title={playbackQueue.current?.title}
        onSelect={(item, index) => {
          setShowQueueList(false);
          playQueueItem(item, index);
        }}
        onClose={() => setShowQueueList(false)}
      />

      {/* ── Up next ───────────────────────────────────────────────────────── */}
      <UpNextCard
        visible={!!upNext}
        item={upNext}
        onPlayNow={() => {
          const next = upNext;
          setUpNext(null);
          if (next) playQueueItem(next, queueIndex + 1);
        }}
        onCancel={() => setUpNext(null)}
      />



      {/* ── Parental lock ─────────────────────────────────────────────────── */}
      <PinPrompt
        visible={!!pinTarget}
        title="Channel Locked"
        message={pinTarget ? `Enter your PIN to watch ${pinTarget.name}.` : ""}
        onSubmit={(pin) => parentalControl.unlock(pin)}
        onCancel={() => setPinTarget(null)}
        onSuccess={() => {
          const target = pinTarget;
          setPinTarget(null);
          if (!target) return;
          const session = liveChannelSession.current;
          const at = session
            ? session.channels.findIndex((c) => String(c.id) === String(target.id))
            : -1;
          tuneToChannel(target, at >= 0 ? at : zapIndex);
        }}
      />
    </View>
  );
}

/**
 * Same check as `hasZapSession`, hoisted so the two `useState` initialisers
 * below it can use it before that state exists.
 */
function hasZapSessionInitial(type: string | undefined, contentId: string | undefined): boolean {
  if (type !== "live" || !liveChannelSession.ownsChannel(contentId)) return false;
  // A list built against a different portal points at channels that no longer
  // exist. Live TV clears the session on a portal switch, but the player must
  // not depend on having been reached through it.
  const portalId = usePortalStore.getState().activePortal?.id;
  return !portalId || liveChannelSession.current?.portalId === portalId;
}

/** The same check for the on-demand queue. */
function hasQueueInitial(type: string | undefined, contentId: string | undefined): boolean {
  if (type === "live" || !playbackQueue.ownsItem(contentId)) return false;
  const portalId = usePortalStore.getState().activePortal?.id;
  return !portalId || playbackQueue.current?.portalId === portalId;
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
        {/* A flat chip rather than a white gradient pill. The gradient was the
            brightest thing on the panel and pulled the eye to an icon that is
            only there to label the list. */}
        <View style={S.modalIconBg}>
          <Ionicons name={(icon as any) || "settings"} size={ps(1.7)} color="rgba(255,255,255,0.8)" />
        </View>
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
                  <View style={[S.trackIndexBadge, (selected === undefined || focused) && S.trackIndexBadgeActive]}>
                    <Ionicons
                      name="aperture"
                      size={ps(1.1)}
                      color={selected === undefined || focused ? "#000" : "rgba(255,255,255,0.5)"}
                    />
                  </View>
                  <Text style={[S.modalOptionText, selected === undefined && S.modalOptionTextSelected, focused && S.modalOptionTextFocused]}>
                    Auto (Recommended)
                  </Text>
                </View>
                {selected === undefined && <View style={[S.checkBadge, focused && S.checkBadgeFocused]}><Ionicons name="checkmark" size={ps(1.1)} color={focused ? "#fff" : "#000"} /></View>}
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
                      <View style={[S.trackIndexBadge, (isSelected || focused) && S.trackIndexBadgeActive]}>
                        <Text style={[S.trackIndexText, (isSelected || focused) && S.trackIndexTextActive]}>{index + 1}</Text>
                      </View>
                      <Text style={[S.modalOptionText, isSelected && S.modalOptionTextSelected, focused && S.modalOptionTextFocused]} numberOfLines={2}>
                        {trackName}
                      </Text>
                    </View>
                    {isSelected && <View style={[S.checkBadge, focused && S.checkBadgeFocused]}><Ionicons name="checkmark" size={ps(1.1)} color={focused ? "#fff" : "#000"} /></View>}
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
                  <View style={[S.trackIndexBadge, (selected === -1 || focused) && S.trackIndexBadgeActive]}>
                    <Ionicons
                      name="close"
                      size={ps(1.1)}
                      color={selected === -1 || focused ? "#000" : "rgba(255,255,255,0.5)"}
                    />
                  </View>
                  <Text style={[S.modalOptionText, selected === -1 && S.modalOptionTextSelected, focused && S.modalOptionTextFocused]}>
                    Disable Subtitles
                  </Text>
                </View>
                {selected === -1 && <View style={[S.checkBadge, focused && S.checkBadgeFocused]}><Ionicons name="checkmark" size={ps(1.1)} color={focused ? "#fff" : "#000"} /></View>}
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
        {/* Render prop, not a bare child: the focused button is solid white,
            so a 70%-white label on it would be invisible. */}
        {(focused: boolean) => (
          <Text style={[S.modalCloseBtnText, focused && S.modalCloseBtnTextFocused]}>
            CLOSE
          </Text>
        )}
      </Focusable>
    </Overlay>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  video: { ...StyleSheet.absoluteFillObject },

  bannerHost: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 40,
  },
  // Cancels bottomOverlay's horizontal padding so the banner keeps the same
  // full-bleed width — and the same gradient reaching the screen edges — that
  // it has when it renders on its own.
  bannerInControls: { marginHorizontal: -pw(5) },

  resumeHost: {
    position: "absolute",
    top: ph(10),
    alignSelf: "center",
    zIndex: 70,
  },
  resumeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(1),
    paddingHorizontal: pw(1.6),
    paddingVertical: ph(1),
    borderRadius: ps(1),
    backgroundColor: "rgba(10,11,16,0.95)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  resumeTitle: { color: "#fff", fontSize: ps(1), fontWeight: "700" },
  resumeBtnWrapper: { borderRadius: ps(0.7) },
  resumeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(0.5),
    paddingHorizontal: pw(1.2),
    paddingVertical: ph(0.7),
    borderRadius: ps(0.7),
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "transparent",
  },
  resumeBtnFocused: { backgroundColor: "#fff", borderColor: "#fff" },
  resumeBtnText: { color: "#fff", fontSize: ps(0.82), fontWeight: "900", letterSpacing: 0.8 },

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

  vodLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000000",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 50,
  },
  vodLoadingBackdropDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.90)",
  },
  vodLoadingCard: {
    flexDirection: "row",
    alignItems: "center",
    width: ps(27),
    maxWidth: "85%",
    paddingHorizontal: ps(1.2),
    paddingVertical: ps(1.0),
    borderRadius: ps(0.9),
    backgroundColor: "#000000",
    gap: ps(1.0),
    elevation: 20,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.8,
    shadowRadius: 18,
  },
  vodPosterWrapper: {
    width: ps(4.8),
    height: ps(7.2),
    borderRadius: ps(0.55),
    overflow: "hidden",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  vodPosterImage: {
    width: "100%",
    height: "100%",
  },
  vodPosterFallback: {
    width: ps(4.8),
    height: ps(7.2),
    borderRadius: ps(0.55),
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  vodMetaBlock: {
    flex: 1,
    gap: ps(0.2),
  },
  vodBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    paddingHorizontal: ps(0.45),
    paddingVertical: ps(0.16),
    borderRadius: ps(0.3),
    marginBottom: ps(0.12),
  },
  vodBadgeText: {
    color: "#ffffff",
    fontSize: ps(0.68),
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  vodLoadingTitle: {
    color: "#ffffff",
    fontSize: ps(1.18),
    fontWeight: "800",
    fontFamily: THEME.fonts.bold,
    lineHeight: ps(1.5),
  },
  vodLoadingSubtitle: {
    color: "rgba(255, 255, 255, 0.7)",
    fontSize: ps(0.85),
    fontWeight: "600",
    fontFamily: THEME.fonts.medium,
  },
  vodSpinnerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: ps(0.6),
    marginTop: ps(0.6),
  },
  vodSpinner: {
    width: ps(1.0),
    height: ps(1.0),
  },
  vodLoadingStatus: {
    color: "rgba(255, 255, 255, 0.8)",
    fontSize: ps(0.85),
    fontWeight: "600",
    fontFamily: THEME.fonts.medium,
    letterSpacing: 0.2,
  },
  midstreamBufferingOverlay: {
    position: "absolute",
    top: "50%",
    alignSelf: "center",
    marginTop: -24,
    zIndex: 55,
  },
  midstreamBufferingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: ps(0.6),
  },
  midstreamBufferingText: {
    color: "#ffffff",
    fontSize: ps(0.9),
    fontWeight: "600",
    fontFamily: THEME.fonts.medium,
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
    // No fontFamily here on purpose. Tenor Sans is a single-weight face and
    // only its 400 is loaded, so asking for it at weight 900 makes Android
    // synthesise a bold it does not have — which rendered as doubled, smeared
    // glyphs. Heavy text uses the system font, which has real weights.
    // See the note on THEME.fonts in src/theme/tokens.ts.
    marginTop: 4,
    letterSpacing: 1,
  },

  controlsOverlay: { ...StyleSheet.absoluteFillObject },
  bottomGradient: { position: "absolute", bottom: 0, left: 0, right: 0, height: "45%" },

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
  },

  progressSection: { gap: 4, marginBottom: 4 },
  timeRow: { flexDirection: "row", justifyContent: "space-between" },
  timeText: {
    color: "#fff",
    fontSize: ps(0.8),
    fontWeight: "700",
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
  // ── Track pickers ────────────────────────────────────────────────────────
  //
  // Brought in line with the rest of the player. Three things were out of
  // step and all three made it look like a different app:
  //
  //   • every size was a raw pixel value (16, 13, 12, 11), so on a TV — where
  //     everything else is sized through ps() — this was the only panel set in
  //     fine print;
  //   • a focused row was 15% white with a white text label, while every other
  //     focusable surface in the app goes solid white with black text. Focus
  //     has to look the same everywhere or it stops reading as focus;
  //   • the custom font family was paired with weights the family has no cut
  //     for. See the note on THEME.fonts in src/theme/tokens.ts.
  modalContent: {
    // The same surface as the detail sheets, so panels over video match.
    backgroundColor: "rgba(8,9,13,0.97)",
    width: isTV ? "42%" : "78%",
    maxWidth: ps(34),
    maxHeight: "82%",
    borderRadius: ps(1.4),
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
  },
  modalHeader: {
    alignItems: "center",
    paddingTop: ph(2.4),
    paddingBottom: ph(1.4),
    paddingHorizontal: pw(2),
  },
  modalIconBg: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    width: ps(3.4),
    height: ps(3.4),
    borderRadius: ps(1.7),
    alignItems: "center",
    justifyContent: "center",
    marginBottom: ph(1.2),
  },
  modalTitle: {
    color: "#fff",
    fontSize: ps(1.5),
    fontWeight: "800",
    textAlign: "center",
  },
  modalSubtitle: {
    color: "rgba(255,255,255,0.45)",
    fontSize: ps(1),
    fontWeight: "600",
    marginTop: ph(0.4),
    textAlign: "center",
  },
  modalDivider: { height: 1, backgroundColor: "rgba(255,255,255,0.07)", marginHorizontal: pw(2) },
  modalScroll: { paddingHorizontal: pw(1.6), paddingVertical: ph(1.2) },
  emptyState: { alignItems: "center", paddingVertical: ph(3), gap: ph(1.2) },
  emptyText: {
    color: "rgba(255,255,255,0.35)",
    fontSize: ps(1.1),
    fontWeight: "600",
  },
  modalOption: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: ps(0.9),
    paddingVertical: ph(1.1),
    paddingHorizontal: pw(1.4),
    marginBottom: ph(0.6),
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  modalOptionSelected: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderColor: "rgba(255,255,255,0.3)",
  },
  // Solid white, as everywhere else. Ordered after the selected style at the call
  // sites so focus wins when a row is both.
  modalOptionFocused: { borderColor: "#fff", backgroundColor: "#fff" },
  modalOptionInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flex: 1,
  },
  modalOptionLeft: { flexDirection: "row", alignItems: "center", gap: pw(1.2), flex: 1 },
  trackIndexBadge: {
    width: ps(2.2),
    height: ps(2.2),
    borderRadius: ps(1.1),
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  trackIndexBadgeActive: { backgroundColor: "#fff" },
  trackIndexText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: ps(0.85),
    fontWeight: "900",
  },
  trackIndexTextActive: { color: "#000" },
  modalOptionText: {
    color: "#fff",
    fontSize: ps(1.15),
    fontWeight: "700",
    flex: 1,
  },
  modalOptionTextSelected: { color: THEME.colors.primary },
  // Black on the white focused row — the same inversion the grids use.
  modalOptionTextFocused: { color: "#000" },
  // Inverted on a focused row, which is solid white — a white badge there is
  // an invisible container around a visible tick.
  checkBadgeFocused: { backgroundColor: "#0E0F14" },
  checkBadge: {
    width: ps(1.8),
    height: ps(1.8),
    borderRadius: ps(0.9),
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  modalCloseBtn: {
    alignItems: "center",
    paddingVertical: ph(1.3),
    marginHorizontal: pw(1.6),
    marginVertical: ph(0.8),
    borderRadius: ps(0.9),
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "transparent",
  },
  modalCloseBtnFocused: { borderColor: "#fff", backgroundColor: "#fff" },
  modalCloseBtnText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: ps(1),
    fontWeight: "900",
    letterSpacing: 2,
  },
  modalCloseBtnTextFocused: { color: "#000" },

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
  actionLabel: { color: "#fff", fontSize: ps(0.75), fontWeight: "900" },
});