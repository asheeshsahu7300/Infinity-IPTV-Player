// ─────────────────────────────────────────────────────────────────────────────
// PlayerScreen — Expo IPTV Player (Media3 / AVPlayer)
//
//   • High performance native playback engine with network-adaptive buffering,
//     stall detection, silent retry/backoff, live reconnect loop,
//     and TV focus/scrub UX.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { View, StyleSheet, Dimensions, Platform, ActivityIndicator, StatusBar, ScrollView, BackHandler, findNodeHandle, Animated, AppState, AppStateStatus, UIManager } from 'react-native';
import { useLocalSearchParams } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import { isPhone } from "../src/utils/phoneUtils";
import { ExpoVideoPlayer, ExpoVideoPlayerRef } from "../src/components/ExpoVideoPlayer";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { safeStorage } from "../src/services/safeStorage";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { useKeepAwake } from "expo-keep-awake";
import { StreamManager } from "../src/services/StreamManager";
import { PlaybackState } from "../src/services/PlaybackState";
import { usePortalStore, Channel } from "../src/store/portalStore";
import { THEME, ps, pw, ph } from "../src/theme/tokens";
import { Focusable, FocusGroup, Overlay, useDPad, DPAD_PRIORITY, useStbKeys, STB_PRIORITY } from "../src/tv";
import NetInfo from "@react-native-community/netinfo";
import { epgService } from "../src/services/epgService";
import { buildImageUrl, portalApi, streamHeaders, getLastMeasuredEdgeRtt } from "../src/services/portalApi";
import { getLastSpeedTestResult } from "../src/services/speedTest";
import { parentalControl } from "../src/services/parentalControl";
import { stbEnvironment, BufferTuning, applySameHostStreamProxy } from "../src/services/stbEnvironment";
import { liveChannelSession, buildChannelNumbers, withChannelNumbers } from "../src/services/liveChannelSession";
import { playbackQueue, QueueItem } from "../src/services/playbackQueue";
import { resumeIndex } from "../src/services/resumeIndex";
import { safeBack } from "../src/services/safeNavigation";
import { useNowNext } from "../src/hooks/useNowNext";
import { useChannelTuner } from "../src/hooks/useChannelTuner";
import ChannelInfoBar from "../src/components/ChannelInfoBar";
import ChannelZapList from "../src/components/ChannelZapList";
import MediaInfoBar from "../src/components/MediaInfoBar";
import QueueList from "../src/components/QueueList";
import UpNextCard from "../src/components/UpNextCard";
import { ChannelTunerReadout } from "../src/components/ChannelTunerOverlay";
import PinPrompt from "../src/components/PinPrompt";
import { AlertCircle, Check, ChevronDown, ChevronUp, Film, Gauge, Info, List, Monitor, Music, Settings, SkipBack, SkipForward, StepBack, StepForward, Subtitles, TriangleAlert, Wifi, X } from 'lucide-react-native';
import { DynamicIcon } from '../src/components/DynamicIcon';
import { Text } from '../src/components/Text';


/**
 * The long edge of the display, feeding the shimmer sweep below.
 *
 * The long edge and not `window.width`, because this module evaluates once and
 * the player is the one screen that changes orientation under itself: on a
 * phone it locks landscape on mount (see the effect in `PlayerScreen`), so a
 * width captured in portrait would leave the sweep stopping short of the edge
 * for the whole session. Both orientations share a long edge.
 */
const SCREEN_WIDTH = (() => {
  const d = Dimensions.get("window");
  return Math.max(d.width, d.height);
})();


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

const ASPECT_RATIOS: { key: AspectRatioType; label: string; contentFit: "contain" | "cover" | "fill" }[] = [
  { key: "fit", label: "Fit", contentFit: "contain" },
  { key: "16:9", label: "16:9", contentFit: "fill" },
  { key: "4:3", label: "4:3", contentFit: "fill" },
];

// ─── Network quality helpers ──────────────────────────────────────────────────
function detectNetworkQuality(
  type: string | null,
  effectiveType?: string | null,
  measuredRttMs?: number | null,
  measuredMbps?: number | null
): NetworkQuality {
  // 1. Measured throughput from speedTest.ts (highest reliability)
  if (typeof measuredMbps === "number" && measuredMbps > 0) {
    if (measuredMbps < 6) return "slow";
    if (measuredMbps < 16) return "medium";
    return "fast";
  }

  // 2. Real-time RTT measured from stream URL resolution probe
  if (typeof measuredRttMs === "number" && measuredRttMs > 0) {
    if (measuredRttMs > 400) return "slow";     // High latency / congested edge node
    if (measuredRttMs > 180) return "medium";   // Moderate latency
    return "fast";                              // Responsive local edge (< 180ms)
  }

  // 3. Fallback to connection type: Wi-Fi is conservatively rated "medium" instead of blindly "fast"
  const t = (effectiveType || type || "").toLowerCase();
  if (t === "ethernet") return "fast";
  if (t === "wifi" || t === "5g") return "medium";
  if (t === "4g" || t === "lte") return "medium";
  if (t === "3g" || t === "2g" || t === "edge" || t === "cdma") return "slow";
  return "medium";
}

/**
 * Adaptive buffer size (ms) tuned per network quality and content type.
 * 4K streams get 1.5× more buffer — decode latency on MediaCodec is higher.
 */
function matches4KKeywords(text?: string | null): boolean {
  if (!text || typeof text !== "string") return false;
  return /\b(4k|uhd|2160p?|ultra\s*hd|hdr10\+?|hevc\s*4k)\b/i.test(text);
}

/**
 * Calculates adaptive network cache minimums based on stream type, 4K resolution,
 * and measured line latency/jitter. High-bitrate 4K streams (HEVC/UHD) require
 * deeper cache floors to absorb burst variance without decoder starvation.
 */
function calcNetworkCacheMs(quality: NetworkQuality, isLive: boolean, is4K: boolean): number {
  if (is4K) {
    if (isLive) {
      switch (quality) {
        case "fast": return 5000;
        case "medium": return 7000;
        case "slow": return 10000;
        default: return 7000;
      }
    } else {
      switch (quality) {
        case "fast": return 4000;
        case "medium": return 6000;
        case "slow": return 8000;
        default: return 6000;
      }
    }
  }

  if (isLive) {
    switch (quality) {
      case "fast": return 2500; // 2.5s for clean zapping with jitter headroom
      case "medium": return 4000; // 4.0s normal IPTV baseline
      case "slow": return 6000; // 6.0s fluctuating line
      default: return 4000;
    }
  } else {
    // Smooth start for VOD / Series on-demand playback
    switch (quality) {
      case "fast": return 2000;
      case "medium": return 3000;
      case "slow": return 5000;
      default: return 3000;
    }
  }
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
  // Cap at 10s to keep latency manageable while absorbing extreme jitter
  return Math.min(10000, Math.round(Math.max(preference, floor) * boost));
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
    const scale = useRef(new Animated.Value(focused ? 1.35 : 1)).current;
    useEffect(() => {
      Animated.spring(scale, {
        toValue: focused ? 1.35 : 1,
        useNativeDriver: true,
        friction: 7,
        tension: 60,
      }).start();
    }, [focused, scale]);
    return (
      <Animated.View
        pointerEvents="none"
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

  /**
   * The player is landscape on a phone, and hands portrait back on the way out.
   *
   * Phones are pinned portrait for the whole app — natively, in
   * `MainActivity.pinHandsetToPortrait`, so the layout's module-load snapshot
   * is portrait — and this screen is the deliberate exception: video is
   * landscape, and a 16:9 frame in a 393dp-wide viewport is a third of the
   * screen with black either side.
   *
   * Restoring on unmount rather than calling `unlockAsync` is the part worth
   * being careful about. Unlocking would leave the handset free to rotate back
   * into a browse screen that is sized for portrait and does not reflow, so the
   * *next* screen would be the one that looks broken — with nothing on it to
   * suggest the player had caused it.
   *
   * Only phones. A TV has no orientation to set, and a tablet is unlocked by
   * `app/_layout` on purpose: it is wide enough either way up, and taking that
   * away here would silently narrow a tablet to landscape from the first video
   * onwards.
   */
  useEffect(() => {
    if (!isPhone) return;
    ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.LANDSCAPE
    ).catch(() => {});
    return () => {
      ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT_UP
      ).catch(() => {});
    };
  }, []);

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


  // ── Core playback state ───────────────────────────────────────────────────
  const [streamUrl, setStreamUrl] = useState(() =>
    applySameHostStreamProxy(params.url || "", activePortal, params.cmd)
  );

  useEffect(() => {
    if (params.url) {
      const nextUrl = applySameHostStreamProxy(params.url, activePortal, params.cmd);
      setStreamUrl((prev) => {
        if (prev !== nextUrl) {
          setIsLoading(true);
          setHasStartedPlaying(false);
          hasStartedPlayingRef.current = false;
          return nextUrl;
        }
        return prev;
      });
    }
  }, [params.url, params.cmd, activePortal]);
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
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isSeekable, setIsSeekable] = useState(!isLive);
  const [isLocked, setIsLocked] = useState(false);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [liveReconnectMode, setLiveReconnectMode] = useState(false);

  // ── Enhanced state ────────────────────────────────────────────────────────
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [showAudioModal, setShowAudioModal] = useState(false);
  const [showSubtitleModal, setShowSubtitleModal] = useState(false);
  const [seekBarFocused, setSeekBarFocused] = useState(false);
  const [visualFocus, setVisualFocus] = useState(false);
  const [videoTracks, setVideoTracks] = useState<any[]>([]);
  const [selectedVideoTrack, setSelectedVideoTrack] = useState<string | number | undefined>(undefined);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [audioTracks, setAudioTracks] = useState<any[]>([]);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState<string | number | undefined>(undefined);
  const [textTracks, setTextTracks] = useState<any[]>([]);
  const [selectedTextTrack, setSelectedTextTrack] = useState<string | number | undefined>(undefined);
  const [seekIndicator, setSeekIndicator] = useState<string | null>(null);
  const [currentVolume] = useState(100);

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

  // ── 4K stream detection & adaptive network quality ────────────────────────
  const is4K =
    isDetected4K ||
    matches4KKeywords(params.title) ||
    matches4KKeywords(liveChannel?.name) ||
    matches4KKeywords(queueItem?.title) ||
    matches4KKeywords(queueItem?.videoQuality) ||
    matches4KKeywords(params.cmd) ||
    matches4KKeywords(params.url) ||
    matches4KKeywords(streamUrl);

  const [networkQuality, setNetworkQuality] = useState<NetworkQuality>("unknown");
  const [networkCacheMs, setNetworkCacheMs] = useState(() =>
    calcNetworkCacheMs("unknown", isLive, is4K)
  );
  const [isNetworkLost, setIsNetworkLost] = useState(false);
  const networkCacheMsRef = useRef(networkCacheMs);
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
  const stallCountRef = useRef(0);
  const recoveryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isNetworkLostRef = useRef(false);
  /** Live values for the channel being watched; a zap replaces both. */
  const activeCmdRef = useRef<string>(params.cmd || params.url || "");
  const activeContentIdRef = useRef<string>(params.contentId || "");
  const zapInFlightRef = useRef(false);

  // ── Retry configuration ───────────────────────────────────────────────────
  const BUFFERING_UI_DEBOUNCE_MS = 600;

  /** One arrow press seek increment. */
  const ARROW_SEEK_MS = 10000;
  /**
   * How long to gather arrow presses before seeking.
   *
   * Over a network stream each seek costs a re-buffer, so a burst is coalesced
   * into one jump: five presses move 50s and re-buffer once, not five
   * times. Short enough that a single press still lands immediately, long
   * enough to swallow the key-repeat of a held button.
   */
  const ARROW_SEEK_COMMIT_MS = 250;
  const MAX_RETRIES_LIVE = 5;
  const MAX_RETRIES_VOD = 3;
  const maxRetries = isLive ? MAX_RETRIES_LIVE : MAX_RETRIES_VOD;

  // ── Refs ──────────────────────────────────────────────────────────────────
  const mountedRef = useRef(true);
  const playerRef = useRef<ExpoVideoPlayerRef>(null);
  const actionsRowRef = useRef<any>(null);
  const controlsTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bufferingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stablePlaybackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveReconnectIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastProgressTimeRef = useRef(Date.now());
  const lastProgressPositionRef = useRef(0);
  const bufferingStartedRef = useRef<number | null>(null);
  /** Mirror of `isBuffering`, readable from the progress tick. */
  const isBufferingRef = useRef(false);
  const lastProgressStateUpdateTime = useRef(0);
  const lastPositionSaveTime = useRef(0);
  const lastAccumulateTime = useRef(0);

  const isSeeking = useRef(false);
  const isRetryingRef = useRef(false);
  const lastErrorTimeRef = useRef(0);
  const hasStartedPlayingRef = useRef(false);

  const targetSeekPosition = useRef<number | null>(null);
  const seekTargetRef = useRef<number | null>(null);
  const seekCommitTimeRef = useRef(0);
  const seekSettlingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseSeekPositionRef = useRef<number | null>(null);
  const accumulatedDelta = useRef(0);
  const hasSetInitialPosition = useRef(false);
  const savedResumePosition = useRef(0);
  const retryCount = useRef(0);

  // Ref mirrors (stable captures for timers/effects without stale closures)
  const isPlayingRef = useRef(isPlaying);
  const isLoadingRef = useRef(isLoading);
  const showControlsRef = useRef(showControls);
  const isLockedRef = useRef(isLocked);
  const showVideoModalRef = useRef(showVideoModal);
  const showAudioModalRef = useRef(showAudioModal);
  const showSubtitleModalRef = useRef(showSubtitleModal);
  const seekBarFocusedRef = useRef(seekBarFocused);
  const showZapListRef = useRef(false);

  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);
  const showBannerRef = useRef(false);
  const positionRef = useRef(position);
  const durationRef = useRef(duration);
  const isSeekableRef = useRef(isSeekable);
  const dummyLeftFocusedRef = useRef(false);
  const dummyRightFocusedRef = useRef(false);
  const isNavRowFocusedRef = useRef(false);
  const accumulateSeekRef = useRef<(delta: number, commitAfterMs?: number) => void>(() => { });
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
      const activeP = usePortalStore.getState().activePortal;
      if (alive) setBufferTuning(stbEnvironment.getBufferTuning(activeP));
    });
    parentalControl.load();
    const unsubscribe = stbEnvironment.subscribe(() => {
      const activeP = usePortalStore.getState().activePortal;
      if (alive) setBufferTuning(stbEnvironment.getBufferTuning(activeP));
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [activePortal?.id]);


  // ── Unmount cleanup ───────────────────────────────────────────────────────
  useEffect(() => {
    const player = playerRef.current;
    return () => {
      mountedRef.current = false;
      try {
        player?.pause();
      } catch { }
      safeStorage.removeItem("resume_player_state").catch(() => { });
      if (recoveryTimeoutRef.current) clearTimeout(recoveryTimeoutRef.current);
      if (stablePlaybackTimerRef.current) clearTimeout(stablePlaybackTimerRef.current);
      if (liveReconnectIntervalRef.current) clearInterval(liveReconnectIntervalRef.current);
      if (seekSettlingTimeoutRef.current) clearTimeout(seekSettlingTimeoutRef.current);
      if (seekTimeout.current) clearTimeout(seekTimeout.current);
    };
  }, []);

  // ── Network quality monitoring ─────────────────────────────────────────────
  const wasLostRef = useRef(false);
  useEffect(() => {
    const applyNetworkState = (type: string | null, effectiveType?: string | null, connected?: boolean | null) => {
      const lost = connected === false;
      isNetworkLostRef.current = lost;
      setIsNetworkLost(lost);
      if (!lost) {
        const edgeRtt = getLastMeasuredEdgeRtt();
        const speed = getLastSpeedTestResult();
        const quality = detectNetworkQuality(type, effectiveType, edgeRtt, speed?.mbps);
        const cacheMs = calcNetworkCacheMs(quality, isLive, is4K);
        networkCacheMsRef.current = cacheMs;
        setNetworkQuality(quality);
        setNetworkCacheMs(cacheMs);
        // Refresh stall clock when network restores — player will resume fetching
        if (mountedRef.current) lastProgressTimeRef.current = Date.now();

        // Immediately trigger playback recovery if network was lost while playing
        if (wasLostRef.current && isPlayingRef.current && !isRetryingRef.current) {
          retryCount.current = 0;
          handleSilentRetryRef.current();
        }
      }
      wasLostRef.current = lost;
    };

    NetInfo.fetch().then((s) => {
      applyNetworkState(s.type, (s.details as any)?.cellularGeneration, s.isConnected);
    });

    const unsub = NetInfo.addEventListener((s) => {
      applyNetworkState(s.type, (s.details as any)?.cellularGeneration, s.isConnected);
    });
    return () => unsub();
  }, [isLive, is4K]);

  // ── Progress handler for video onProgress ──────────────────────────────────
  const handleNormalizedProgress = useCallback(
    (positionMs: number, durationMs: number) => {
      if (isSeeking.current) {
        const timeSinceCommit = Date.now() - seekCommitTimeRef.current;
        const target = seekTargetRef.current;
        const hasReachedTarget =
          target !== null && Math.abs(positionMs - target) < 3000;

        if (hasReachedTarget || timeSinceCommit > 1000) {
          isSeeking.current = false;
          seekTargetRef.current = null;
          if (seekSettlingTimeoutRef.current) {
            clearTimeout(seekSettlingTimeoutRef.current);
            seekSettlingTimeoutRef.current = null;
          }
          setPosition(positionMs);
          lastProgressStateUpdateTime.current = Date.now();
        } else {
          // Stale progress event emitted before seek took effect; ignore it
          return;
        }
      }

      if (positionMs > positionRef.current) {
        // If player self-recovered before grace period expired, disarm the pending reconnect
        if (recoveryTimeoutRef.current) {
          clearTimeout(recoveryTimeoutRef.current);
          recoveryTimeoutRef.current = null;
        }
        if (bufferingTimeoutRef.current) {
          clearTimeout(bufferingTimeoutRef.current);
          bufferingTimeoutRef.current = null;
        }
        bufferingStartedRef.current = null;
        // Guarded on the ref: this runs four times a second, and setting
        // state unconditionally would re-render the player on every tick.
        if (isBufferingRef.current) setIsBuffering(false);

        // Track 30s of uninterrupted stable playback to decay the buffer boost
        if (!stablePlaybackTimerRef.current) {
          stablePlaybackTimerRef.current = setTimeout(() => {
            if (stallCountRef.current > 0) {
              stallCountRef.current = Math.max(0, stallCountRef.current - 1);
              bufferBoostRef.current = Math.max(1.0, 1.0 + stallCountRef.current * 0.4);
              console.log(`[Player] Line stabilized. Stall count decayed to ${stallCountRef.current}, boost: ${bufferBoostRef.current.toFixed(1)}x`);
            }
            stablePlaybackTimerRef.current = null;
          }, 30000);
        }
      }

      positionRef.current = positionMs;
      durationRef.current = durationMs;

      const now = Date.now();
      const updateInterval = showControlsRef.current ? 250 : 1000;
      if (now - lastProgressStateUpdateTime.current >= updateInterval) {
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

  useEffect(() => {
    isBufferingRef.current = isBuffering;
  }, [isBuffering]);

  // ── Shared buffering handler (debounced UI flag, used by both players) ────
  const handleBufferingChange = useCallback((buffering: boolean) => {
    if (isLive) {
      if (bufferingTimeoutRef.current) {
        clearTimeout(bufferingTimeoutRef.current);
        bufferingTimeoutRef.current = null;
      }
      setIsBuffering(false);
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
    }
  }, [isLive]);



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

  // ── Unified seek ──────────────────────────────────────────────────────────
  const performSeek = useCallback(
    (positionMs: number) => {
      if (!durationRef.current || durationRef.current <= 0) return;
      const clamped = Math.max(0, Math.min(positionMs, durationRef.current));
      isSeeking.current = true;
      seekTargetRef.current = clamped;
      seekCommitTimeRef.current = Date.now();
      lastProgressTimeRef.current = Date.now();
      lastProgressPositionRef.current = clamped;
      lastProgressStateUpdateTime.current = Date.now();
      positionRef.current = clamped;
      setPosition(clamped);

      if (seekSettlingTimeoutRef.current) {
        clearTimeout(seekSettlingTimeoutRef.current);
      }
      seekSettlingTimeoutRef.current = setTimeout(() => {
        isSeeking.current = false;
        seekTargetRef.current = null;
        seekSettlingTimeoutRef.current = null;
      }, 1200);

      playerRef.current?.seekTo(clamped);

      resetControlsTimeout();
    },
    [resetControlsTimeout]
  );

  // ── Shared "load complete" handler for VLC player ────────────────────────
  const handleLoadCommon = useCallback(
    (durationMs: number) => {
      setIsLoading(false);
      setIsBuffering(false);
      setPlaybackFailed(false);
      stopLiveReconnectLoop();
      if (!hasStartedPlayingRef.current) {
        hasStartedPlayingRef.current = true;
        setHasStartedPlaying(true);
      }

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
        } else {
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

  // ── Save position on unmount ──────────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS === "web") return;
    return () => {
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
      return safeBack();
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
        const currentPos = positionRef.current > 0 ? positionRef.current : position;
        const totalDur = durationRef.current > 0 ? durationRef.current : duration;
        performSeek(Math.max(0, Math.min(currentPos + delta, totalDur)));
      } catch (e) {
        console.error("Seek error:", e);
        isSeeking.current = false;
        seekTargetRef.current = null;
      }
    },
    [duration, isSeekable, position, performSeek]
  );

  /**
   * Touch scrubbing for the progress bar.
   *
   * The bar had none. Its `Focusable` maps `onPress` to `togglePlay`, and
   * seeking came entirely from the D-pad — the two 1x1 dummy focusables either
   * side of it translate left/right into `accumulateSeek`. On a remote that is
   * the whole interaction; on a phone it meant the bar could be tapped but not
   * moved, and the tap played instead of seeking.
   *
   * Position is set on every move so the thumb tracks the finger, but the
   * player is only told once, on release — `performSeek` mid-drag would fire a
   * seek per frame at whatever the finger was passing over.
   */
  const railWidthRef = useRef(0);
  const scrubFromX = useCallback(
    (x: number, commit: boolean) => {
      const width = railWidthRef.current;
      if (!width || isLockedRef.current || duration <= 0 || !isSeekable) return;
      const target = Math.max(0, Math.min(x / width, 1)) * duration;
      isSeeking.current = true;
      positionRef.current = target;
      setPosition(target);
      if (commit) {
        try {
          performSeek(target);
        } catch (e) {
          console.error("Scrub seek error:", e);
          isSeeking.current = false;
          seekTargetRef.current = null;
        }
      }
    },
    [duration, isSeekable, performSeek]
  );

  /**
   * Claims the touch for the bar itself, so the tap reaches this instead of the
   * `Focusable` wrapping it — whose press is `togglePlay`. Phone only; a remote
   * has no responder to grant and the TV path must keep its `onPress`.
   */
  const scrubResponder = useMemo(
    () =>
      isPhone
        ? {
            onStartShouldSetResponder: () => true,
            onMoveShouldSetResponder: () => true,
            onResponderTerminationRequest: () => false,
            onResponderGrant: (e: any) => scrubFromX(e.nativeEvent.locationX, false),
            onResponderMove: (e: any) => scrubFromX(e.nativeEvent.locationX, false),
            onResponderRelease: (e: any) => scrubFromX(e.nativeEvent.locationX, true),
          }
        : null,
    [scrubFromX]
  );

  /**
   * Moves the seek target by `delta` and commits once the presses stop.
   *
   * There used to be an `isProgressive` mode that **ignored `delta`** and
   * walked a 1m/2m/5m/10m ladder instead. Every arrow-key caller passed it,
   * so a single left press jumped a minute however clearly the call site
   * said 10 seconds. Nothing wants that ladder — fast-forward and rewind
   * use seek() directly — so it is gone and the delta is honoured.
   */
  const accumulateSeek = useCallback(
    (delta: number, commitAfterMs = 800) => {
      if (isLockedRef.current || duration <= 0 || !isSeekable || params.type === "live") return;
      const now = Date.now();
      if (now - lastAccumulateTime.current < 50) return;
      lastAccumulateTime.current = now;

      if (baseSeekPositionRef.current === null) {
        baseSeekPositionRef.current = positionRef.current > 0 ? positionRef.current : position;
        accumulatedDelta.current = 0;
      }

      accumulatedDelta.current += delta;

      const dur = durationRef.current > 0 ? durationRef.current : duration;
      const target = Math.max(0, Math.min(baseSeekPositionRef.current + accumulatedDelta.current, dur));
      targetSeekPosition.current = target;
      positionRef.current = target;
      setPosition(target);

      // Both directions get a sign. Backwards used to get none, so a left
      // press read "10s" — indistinguishable from a forward jump at a glance,
      // which is the one thing this indicator exists to tell you.
      const sign = accumulatedDelta.current < 0 ? "-" : "+";
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
          isSeeking.current = false;
          seekTargetRef.current = null;
        } finally {
          baseSeekPositionRef.current = null;
          targetSeekPosition.current = null;
          accumulatedDelta.current = 0;
          if (dummyLeftFocusedRef.current || dummyRightFocusedRef.current) {
            seekBarRef.current?.focus();
          }
        }
      }, commitAfterMs);

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
      // Left and right are the 10-second jumps, as on VLC.
      //
      // They seek on the *first* press whether the transport bar is up or
      // not. Previously a press with the controls hidden only woke the bar,
      // so skipping back took two presses — one to reveal something the
      // viewer had not asked for, one to actually move.
      //
      // The one exception is the button row: while that has focus, left and
      // right are how you get between the buttons.
      onLeft: () => {
        if (isLockedRef.current) return;
        if (showControlsRef.current && isNavRowFocusedRef.current) return;
        if (!isLive) accumulateSeek(-ARROW_SEEK_MS, ARROW_SEEK_COMMIT_MS);
        setShowControls(true);
        resetControlsTimeout();
      },
      onRight: () => {
        if (isLockedRef.current) return;
        if (showControlsRef.current && isNavRowFocusedRef.current) return;
        if (!isLive) accumulateSeek(ARROW_SEEK_MS, ARROW_SEEK_COMMIT_MS);
        setShowControls(true);
        resetControlsTimeout();
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
        }
        resetControlsTimeout();
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

  const cyclePlaybackSpeed = () => {
    if (isLockedRef.current) return;
    const speeds = [1.0, 1.25, 1.5, 1.75, 2.0, 0.5, 0.75];
    const next = speeds[(speeds.indexOf(playbackSpeed) + 1) % speeds.length];
    setPlaybackSpeed(next);
    // VLCPlayer uses dynamic `rate` prop — state update propagates on its own
    setSeekIndicator(`${next.toFixed(2)}x Speed`);
    setTimeout(() => setSeekIndicator(null), 1000);
    resetControlsTimeout();
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
    stallCountRef.current += 1;
    setIsRetrying(true);

    // Deepen adaptive buffer with each stall/retry attempt (1.0x -> 1.4x -> 1.8x -> 2.2x -> capped at 3.0x)
    bufferBoostRef.current = Math.min(3.0, 1.0 + stallCountRef.current * 0.4);

    // Exponential backoff: 500 ms, 1 s, 2 s, 4 s, 8 s … capped at 30 s
    const backoffMs = Math.min(500 * Math.pow(2, retryCount.current - 1), 30000);

    try {
      // If network is gone, wait up to 30 s for reconnect before giving up this attempt
      const netState = await NetInfo.fetch();
      if (!mountedRef.current) return;
      if (!netState.isConnected) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 30000);
          const unsub = NetInfo.addEventListener((s) => {
            if (s.isConnected) { clearTimeout(timeout); unsub(); resolve(); }
          });
        });
      }
      if (!mountedRef.current) return;

      await new Promise((r) => setTimeout(r, backoffMs));
      if (!mountedRef.current) return;

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
      if (!mountedRef.current) return;

      if (result.success && result.url) {
        // Full state reset — clean slate for the new URL
        isSeeking.current = false;
        seekTargetRef.current = null;
        baseSeekPositionRef.current = null;
        if (seekSettlingTimeoutRef.current) {
          clearTimeout(seekSettlingTimeoutRef.current);
          seekSettlingTimeoutRef.current = null;
        }
        targetSeekPosition.current = null;
        bufferingStartedRef.current = null;
        lastProgressTimeRef.current = Date.now();
        hasStartedPlayingRef.current = false;
        setHasStartedPlaying(false);
        upNextArmedRef.current = false;

        if (!isLive) {
          hasSetInitialPosition.current = false;
          savedResumePosition.current = positionRef.current;
        }

        setIsBuffering(false);
        setIsLoading(true);
        setBufferGeneration((prev) => prev + 1);
        setStreamUrl(applySameHostStreamProxy(result.url, activePortal, activeCmdRef.current));
        stopLiveReconnectLoop();
      } else {
        if (mountedRef.current) setIsLoading(false);
      }
    } catch (e) {
      console.error("[Player] Retry failed:", e);
      if (mountedRef.current) setIsLoading(false);
    } finally {
      isRetryingRef.current = false;
      if (mountedRef.current) {
        setIsRetrying(false);
      }
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
      bufferBoostRef.current = 1;
      stallCountRef.current = 0;
      if (recoveryTimeoutRef.current) {
        clearTimeout(recoveryTimeoutRef.current);
        recoveryTimeoutRef.current = null;
      }
      if (stablePlaybackTimerRef.current) {
        clearTimeout(stablePlaybackTimerRef.current);
        stablePlaybackTimerRef.current = null;
      }
      hasStartedPlayingRef.current = false;
      setHasStartedPlaying(false);
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

      // Recalculate network quality using the newly measured edge RTT from the channel's URL resolution
      const edgeRtt = getLastMeasuredEdgeRtt();
      const speed = getLastSpeedTestResult();
      const currentNet = await NetInfo.fetch().catch(() => null);
      const measuredQuality = detectNetworkQuality(
        currentNet?.type || null,
        (currentNet?.details as any)?.cellularGeneration,
        edgeRtt,
        speed?.mbps
      );
      setNetworkQuality(measuredQuality);
      networkCacheMsRef.current = calcNetworkCacheMs(measuredQuality, isLive, is4K);

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
      bufferBoostRef.current = 1;
      hasStartedPlayingRef.current = false;
      setHasStartedPlaying(false);
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




  // ── App state (background / foreground) ──────────────────────────────────
  const prevAppStateRef = useRef<AppStateStatus>("active");
  const wasPlayingBeforeBackgroundRef = useRef(false);

  useEffect(() => {
    PlaybackState.setActive(true);
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state !== "active") {
        wasPlayingBeforeBackgroundRef.current = isPlayingRef.current;
        setIsPlaying(false);
      } else if (prevAppStateRef.current !== "active") {
        // Only reconnect and resume if stream was actively playing before backgrounding
        if (wasPlayingBeforeBackgroundRef.current) {
          savedResumePosition.current = positionRef.current;
          hasSetInitialPosition.current = false;
          retryCount.current = 0;
          isRetryingRef.current = false;
          stopLiveReconnectLoop();
          setIsLoading(true);
          setIsPlaying(true);
          handleSilentRetryRef.current();
        }
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

  const qualityLabel = getQualityLabel(networkQuality, is4K);
  const isShowingHardFailure = playbackFailed && !isLive;
  const isVodLoading =
    !isLive &&
    (!hasStartedPlaying || (isLoading && position === 0)) &&
    !isShowingHardFailure &&
    !isNetworkLost;

  // ── Predictive Player Recovery Watchdog ───────────────────────────────────
  const schedulePlayerRecovery = useCallback((reason: string) => {
    if (!mountedRef.current || isRetryingRef.current || playbackFailed) return;
    if (recoveryTimeoutRef.current) return; // Recovery timer already running

    const stallTimeout = bufferTuningRef.current?.stallTimeoutMs || 15000;
    const gracePeriodMs = Math.max(8000, Math.min(stallTimeout, 15000));
    console.log(`[Player] ${reason} — granting ${gracePeriodMs}ms grace period for self-recovery`);

    recoveryTimeoutRef.current = setTimeout(() => {
      recoveryTimeoutRef.current = null;
      if (!mountedRef.current || isRetryingRef.current || playbackFailed) return;

      console.log(`[Player] Grace period expired after ${reason}. Triggering silent retry`);
      handleSilentRetryRef.current();
    }, gracePeriodMs);
  }, [playbackFailed]);

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
              // The stream's own resolution and audio language, from the queue
              // item — what the provider says this episode *is*. Distinct from
              // `qualityLabel` below, which is the measured network tier and
              // says nothing about the file, so both are worth showing.
              ...(queueItem?.videoQuality
                ? [{ label: queueItem.videoQuality, tone: "muted" as const }]
                : []),
              ...(queueItem?.audioLanguage
                ? [{ label: queueItem.audioLanguage, tone: "muted" as const }]
                : []),
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
    <View style={S.container}>
      {/* ── Player: Expo Video Player (Media3 / AVPlayer) ── */}
      {streamUrl && /^(https?|rtsp|mms):\/\//i.test(streamUrl) ? (
        <ExpoVideoPlayer
          key={`expo-${streamUrl}-${bufferGeneration}`}
          ref={playerRef}
          style={S.video}
          streamUrl={streamUrl}
          headers={streamHeaders(streamUrl, activePortal)}
          contentFit={ASPECT_RATIOS[aspectRatioIndex]?.contentFit || "contain"}
          rate={playbackSpeed}
          volume={currentVolume}
          paused={!isPlaying}
          autoPlay={autoPlay}
          selectedAudioTrack={selectedAudioTrack}
          selectedSubtitleTrack={selectedTextTrack}
          selectedVideoTrack={selectedVideoTrack}
          onLoad={({ duration: durationMs, audioTracks: aTracks, textTracks: sTracks, videoTracks: vTracks }) => {
            if (isBufferingRef.current) {
              isBufferingRef.current = false;
              setIsBuffering(false);
            }
            if (isLoadingRef.current) {
              isLoadingRef.current = false;
              setIsLoading(false);
            }
            if (!hasStartedPlayingRef.current) {
              hasStartedPlayingRef.current = true;
              setHasStartedPlaying(true);
            }
            retryCount.current = 0;
            handleLoadCommon(durationMs);
            if (vTracks && vTracks.length > 0) {
              setVideoTracks(vTracks);
              const has4kTrack = vTracks.some(
                (t: any) => (t.width && t.width >= 3840) || (t.height && t.height >= 2160)
              );
              if (has4kTrack && !isDetected4K) {
                setIsDetected4K(true);
              }
            }
            if (aTracks && aTracks.length > 0) {
              setAudioTracks(aTracks);
            }
            if (sTracks && sTracks.length > 0) {
              setTextTracks(sTracks);
            }
          }}
          onPlaying={() => {
            if (recoveryTimeoutRef.current) {
              clearTimeout(recoveryTimeoutRef.current);
              recoveryTimeoutRef.current = null;
            }
            if (!hasStartedPlayingRef.current) {
              hasStartedPlayingRef.current = true;
              setHasStartedPlaying(true);
            }
            if (!isPlayingRef.current) {
              setIsPlaying(true);
            }
            if (isLoadingRef.current) {
              isLoadingRef.current = false;
              setIsLoading(false);
            }
            if (isBufferingRef.current) {
              isBufferingRef.current = false;
              setIsBuffering(false);
            }
            setPlaybackFailed(false);
            stopLiveReconnectLoop();
            lastProgressTimeRef.current = Date.now();
            lastProgressPositionRef.current = positionRef.current;
            bufferingStartedRef.current = null;

            if (stablePlaybackTimerRef.current) clearTimeout(stablePlaybackTimerRef.current);
            stablePlaybackTimerRef.current = setTimeout(() => {
              if (mountedRef.current && isPlayingRef.current) retryCount.current = 0;
              stablePlaybackTimerRef.current = null;
            }, 20000);
          }}
          onProgress={(currentMs, durationMs) => {
            if (recoveryTimeoutRef.current) {
              clearTimeout(recoveryTimeoutRef.current);
              recoveryTimeoutRef.current = null;
            }
            if (currentMs > 0) {
              if (!hasStartedPlayingRef.current) {
                hasStartedPlayingRef.current = true;
                setHasStartedPlaying(true);
              }
              if (isLoadingRef.current) {
                isLoadingRef.current = false;
                setIsLoading(false);
              }
              if (isBufferingRef.current) {
                isBufferingRef.current = false;
                setIsBuffering(false);
              }
            }

            if (durationMs > 0 && Math.abs(durationRef.current - durationMs) > 1000) {
              durationRef.current = durationMs;
              setDuration(durationMs);
            }

            if (currentMs !== lastProgressPositionRef.current) {
              lastProgressPositionRef.current = currentMs;
              lastProgressTimeRef.current = Date.now();
              bufferingStartedRef.current = null;
              if (isBufferingRef.current) {
                isBufferingRef.current = false;
                setIsBuffering(false);
              }
            }

            handleNormalizedProgress(currentMs, durationMs);
          }}
          onBuffering={(buffering) => {
            handleBufferingChange(buffering);
          }}
          onPaused={() => {
            if (isPlayingRef.current) {
              setIsPlaying(false);
            }
          }}
          onEnd={() => {
            setIsPlaying(false);
            handleReachedEndRef.current();
          }}
          onError={(e) => {
            console.warn("[ExpoVideo] onError", e);
            const now = Date.now();
            if (now - lastErrorTimeRef.current < 2500) return;
            lastErrorTimeRef.current = now;
            if (!isRetryingRef.current && !playbackFailed) {
              schedulePlayerRecovery("onError");
            }
          }}
        />
      ) : null}

      {/* TV: invisible focusable overlay to catch OK press when controls are hidden or during initial loading */}
      {(!showControls || isVodLoading) && !showQueueList && !showZapList && !upNext && !pinTarget && (
        <Focusable
          hasTVPreferredFocus={isVodLoading}
          style={StyleSheet.absoluteFill}
          ringOnFocus={false}
          onPress={() => {
            if (!isVodLoading) {
              setShowControls(true);
              resetControlsTimeout();
            }
          }}
        />
      )}

      {/* ── Network lost overlay ─────────────────────────────────────────── */}
      {isNetworkLost && (
        <View style={S.loadingOverlay} pointerEvents="none">
          <Wifi size={52} color="rgba(255,255,255,0.45)" />
          <Text style={S.loadingText}>No network connection</Text>
          <Text style={[S.loadingText, { fontSize: ps(0.85), opacity: 0.5, marginTop: 2 }]}>
            Waiting to reconnect…
          </Text>
        </View>
      )}

      {/* ── VOD hard failure ─────────────────────────────────────────────── */}
      {isShowingHardFailure && !isNetworkLost && (
        <View style={S.loadingOverlay}>
          <TriangleAlert size={44} color="rgba(255,255,255,0.7)" />
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
      {isVodLoading && (
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
                <Film size={ps(3)} color="rgba(255,255,255,0.45)" />
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
                {/* "small", and no style box.
                    On Android an ActivityIndicator draws at a fixed intrinsic
                    size for its `size` — "large" is around 48dp — and ignores
                    width and height in its style. The box here claimed ps(1.0),
                    about 20dp on a 1080p panel, so the spinner drew nearly
                    30dp wider than the space reserved for it and sat on top of
                    the label. The row's `gap` measured the box too, not the
                    circle, which is why the text ended up under it rather than
                    beside it.
                    "small" is ~20dp, which is the line height of the label it
                    sits next to. Sizing is left to the component so the two can
                    never disagree again. */}
                <ActivityIndicator size="small" color="#ffffff" />
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
            <ActivityIndicator size="small" color="#FFFFFF" />
            <Text style={S.midstreamBufferingText}>
              {isRetrying ? `Reconnecting (${retryCount.current})…` : "Buffering…"}
            </Text>
          </View>
        </View>
      )}

      {/* ── Seek / speed indicator ───────────────────────────────────────── */}
      {seekIndicator !== null && (
        <View style={S.seekIndicatorOverlay} pointerEvents="none">
          <View style={S.seekIndicatorBox}>
            <View style={S.seekIconBadge}>
              <DynamicIcon
                name={
                  seekIndicator.includes("x")
                    ? "speedometer-outline"
                    : seekIndicator.startsWith("+")
                      ? "play-forward"
                      : "play-back"
                }
                size={ps(2.2)}
                color="#FFFFFF"
              />
            </View>
            <Text style={S.seekIndicatorText}>{seekIndicator}</Text>
          </View>
        </View>
      )}

      {/* ── Controls overlay ─────────────────────────────────────────────── */}
      {showControls && !upNext && !isVodLoading && (
        <FocusGroup style={S.controlsOverlay}>
          {/* Center play / seek buttons */}
          {!isLocked && (
            <View
              style={[
                S.centerRow,
                seekIndicator !== null && { opacity: 0 },
              ]}
              pointerEvents={seekIndicator !== null ? "none" : "auto"}
            >
              {!isLive && (
                <Focusable
                  ringOnFocus={false}
                  focusStyle={S.skipBtnFocused}
                  style={S.skipBtn}
                  onPress={() => seek(-10000)}
                  {...navRowFocusHandlers}
                >
                  {(focused: boolean) => (
                    <SkipBack size={ps(2.2)} color={focused ? "#000000" : "#FFFFFF"} />
                  )}
                </Focusable>
              )}
              <View style={S.playBtnContainer}>
                <Focusable
                  hasTVPreferredFocus
                  ringOnFocus={false}
                  focusStyle={S.mainPlayBtnFocused}
                  style={S.mainPlayBtn}
                  onPress={togglePlay}
                  {...navRowFocusHandlers}
                >
                  {(focused: boolean) => (
                    <DynamicIcon name={isPlaying ? "pause" : "play"} size={ps(3.2)} color={focused ? "#000000" : "#FFFFFF"} />
                  )}
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
                  {(focused: boolean) => (
                    <SkipForward size={ps(2.2)} color={focused ? "#000000" : "#FFFFFF"} />
                  )}
                </Focusable>
              )}
            </View>
          )}

          <LinearGradient colors={["transparent", "rgba(0,0,0,0.88)"]} style={S.bottomGradient} pointerEvents="none" />

          {/* Bottom controls */}
          {/* `box-none`: the panel itself must not take touches, or it steals
              every tap aimed at the transport buttons centred behind it. Its
              children still receive their own. */}
          <View
            style={[S.bottomOverlay, { paddingBottom: insets.bottom + ph(2) }]}
            pointerEvents={isPhone ? "box-none" : "auto"}
          >
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
                  <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 8 }} />
                  <Text style={S.liveReconnectText}>Reconnecting to live stream…</Text>
                </View>
              )}

              {/* Progress bar — VOD only */}
              {!isLive && duration > 0 && (
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
                        accumulateSeek(-ARROW_SEEK_MS, ARROW_SEEK_COMMIT_MS);
                        seekBarRef.current?.focus();
                      }}
                      onBlur={() => { dummyLeftFocusedRef.current = false; handleSeekBlur(); }}
                    />
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
                        const effFocused =
                          visualFocus || dummyLeftFocusedRef.current || dummyRightFocusedRef.current;
                        return (
                          <View
                            style={S.progressBarInner}
                            onLayout={(e) => { railWidthRef.current = e.nativeEvent.layout.width; }}
                            {...(scrubResponder ?? {})}
                          >
                            <View style={[S.progressRail, effFocused && S.progressRailFocused]}>
                              {isBuffering && <ShimmerBar />}
                              <View style={[S.progressFill, { width: `${progressPercent}%` }]} />
                            </View>
                            <AnimatedScrubber focused={effFocused} progressPercent={progressPercent} />
                          </View>
                        );
                      }}
                    </Focusable>
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
                        accumulateSeek(ARROW_SEEK_MS, ARROW_SEEK_COMMIT_MS);
                        seekBarRef.current?.focus();
                      }}
                      onBlur={() => { dummyRightFocusedRef.current = false; handleSeekBlur(); }}
                    />
                  </View>
                </View>
              )}

              {/* Actions row */}
              <FocusGroup ref={actionsRowRef} style={S.actionsRow}>
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
                        {(focused: boolean) => (
                          <List size={ps(2.4)} color={focused ? "#000000" : "#FFFFFF"} />
                        )}
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
                            {(focused: boolean) => (
                              <StepBack size={ps(2.4)} color={focused ? "#000000" : "#FFFFFF"} />
                            )}
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
                            {(focused: boolean) => (
                              <StepForward size={ps(2.4)} color={focused ? "#000000" : "#FFFFFF"} />
                            )}
                          </Focusable>
                        </>
                      )}
                    </>
                  )}
                  {isLive && canZap && (
                    <>
                      <Focusable ringOnFocus={false} focusStyle={S.iconChipFocused} style={S.settingBtn} onPress={() => { setShowZapList(true); }} accessibilityLabel="Channel list" {...navRowFocusHandlers}>
                        {(focused: boolean) => (
                          <List size={ps(2.4)} color={focused ? "#000000" : "#FFFFFF"} />
                        )}
                      </Focusable>
                      <Focusable ringOnFocus={false} focusStyle={S.iconChipFocused} style={S.settingBtn} onPress={() => zapBy(1)} accessibilityLabel="Channel up" {...navRowFocusHandlers}>
                        {(focused: boolean) => (
                          <ChevronUp size={ps(2.4)} color={focused ? "#000000" : "#FFFFFF"} />
                        )}
                      </Focusable>
                      <Focusable ringOnFocus={false} focusStyle={S.iconChipFocused} style={S.settingBtn} onPress={() => zapBy(-1)} accessibilityLabel="Channel down" {...navRowFocusHandlers}>
                        {(focused: boolean) => (
                          <ChevronDown size={ps(2.4)} color={focused ? "#000000" : "#FFFFFF"} />
                        )}
                      </Focusable>
                      <Focusable ringOnFocus={false} focusStyle={S.iconChipFocused} style={S.settingBtn} onPress={() => flashBanner()} accessibilityLabel="Channel info" {...navRowFocusHandlers}>
                        {(focused: boolean) => (
                          <Info size={ps(2.4)} color={focused ? "#000000" : "#FFFFFF"} />
                        )}
                      </Focusable>
                    </>
                  )}
                  {!isLive && (
                    <Focusable ringOnFocus={false} focusStyle={S.iconChipFocused} style={S.settingBtn} onPress={cyclePlaybackSpeed} {...navRowFocusHandlers}>
                      {(focused: boolean) => (
                        <Gauge size={ps(2.4)} color={focused ? "#000000" : "#FFFFFF"} />
                      )}
                    </Focusable>
                  )}
                  {!isLive && videoTracks.length > 1 && (
                    <Focusable ringOnFocus={false} focusStyle={S.iconChipFocused} style={S.settingBtn} onPress={() => { if (isLockedRef.current) return; setShowVideoModal(true); }} {...navRowFocusHandlers}>
                      {(focused: boolean) => (
                        <Settings size={ps(2.4)} color={focused ? "#000000" : "#FFFFFF"} />
                      )}
                    </Focusable>
                  )}
                  {!isLive && (
                    <Focusable ringOnFocus={false} focusStyle={S.iconChipFocused} style={S.settingBtn} onPress={() => { if (isLockedRef.current) return; setShowSubtitleModal(true); }} {...navRowFocusHandlers}>
                      {(focused: boolean) => (
                        <Subtitles size={ps(2.4)} color={focused ? "#000000" : "#FFFFFF"} />
                      )}
                    </Focusable>
                  )}
                  <Focusable ringOnFocus={false} focusStyle={S.iconChipFocused} style={S.settingBtn} onPress={() => { if (isLockedRef.current) return; setShowAudioModal(true); }} {...navRowFocusHandlers}>
                    {(focused: boolean) => (
                      <Music size={ps(2.4)} color={focused ? "#000000" : "#FFFFFF"} />
                    )}
                  </Focusable>
                  <Focusable ringOnFocus={false} focusStyle={S.iconChipFocused} style={S.settingBtn} onPress={cycleAspectRatio} {...navRowFocusHandlers}>
                    {(focused: boolean) => (
                      <Monitor size={ps(2.4)} color={focused ? "#000000" : "#FFFFFF"} />
                    )}
                  </Focusable>
                </View>
              </FocusGroup>
            </View>
          </View>
        </FocusGroup>
      )}

      {/* ── Track selection modals ───────────────────────────────────────── */}
      <TrackSelectionModal
        visible={showVideoModal} title="Video Quality" icon="aperture" isVideo
        options={videoTracks} selected={selectedVideoTrack}
        onSelect={(id: number | undefined) => {
          setSelectedVideoTrack(id);
          playerRef.current?.selectVideoTrack(id);
          setShowVideoModal(false);
        }}
        onClose={() => setShowVideoModal(false)}
      />
      <TrackSelectionModal
        visible={showAudioModal} title="Audio Track" icon="musical-notes"
        options={audioTracks} selected={selectedAudioTrack}
        onSelect={(id: any) => {
          setSelectedAudioTrack(id);
          playerRef.current?.selectAudioTrack(id);
          setShowAudioModal(false);
        }}
        onClose={() => setShowAudioModal(false)}
      />
      <TrackSelectionModal
        visible={showSubtitleModal} title="Subtitles" icon="text" isSubtitle
        options={textTracks} selected={selectedTextTrack}
        onSelect={(id: any) => {
          setSelectedTextTrack(id);
          playerRef.current?.selectSubtitleTrack(id);
          setShowSubtitleModal(false);
        }}
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


// ─── Track Selection Modal ────────────────────────────────────────────────────
function TrackSelectionModal({
  visible, title, icon, options, selected, onSelect, onClose,
  isSubtitle = false, isVideo = false,
}: any) {
  // Separate valid media tracks from disable options
  const mediaTracks = (options || []).filter((track: any) => {
    if (typeof track === "string") return !track.toLowerCase().includes("disable");
    if (typeof track === "object" && track !== null) {
      const rawName = track.title || track.name || track.language || "";
      return track.id !== -1 && track.index !== -1 && !rawName.toLowerCase().includes("disable");
    }
    return true;
  });

  const disableTrack = (options || []).find((track: any) => {
    if (typeof track === "string") return track.toLowerCase().includes("disable");
    if (typeof track === "object" && track !== null) {
      const rawName = track.title || track.name || track.language || "";
      return track.id === -1 || track.index === -1 || rawName.toLowerCase().includes("disable");
    }
    return false;
  });

  const hasSelectedTrack = mediaTracks.some((track: any, idx: number) => {
    const id = typeof track === "object" ? (track.id ?? track.index ?? idx) : idx;
    return selected !== undefined && (selected === id || String(selected) === String(id));
  });

  const totalAvailable = mediaTracks.length + (isVideo ? 1 : 0);

  const getTrackDisplay = (track: any, index: number) => {
    const isObj = typeof track === "object" && track !== null;
    const rawTitle = isObj ? (track.title || track.name || track.language) : String(track);

    if (isVideo && isObj) {
      if (track.height || track.width) {
        const h = track.height;
        const w = track.width;
        let label = `${h}p`;
        if (h >= 2160 || w >= 3840) label = "4K UHD";
        else if (h >= 1440) label = "2K QHD";
        else if (h >= 1080) label = "1080p FHD";
        else if (h >= 720) label = "720p HD";
        else if (h >= 480) label = "480p SD";
        return {
          title: label,
          subtitle: w && h ? `${w} × ${h}` : rawTitle,
        };
      }
    }

    if (isObj && track.language) {
      return {
        title: rawTitle || `Track ${index + 1}`,
        subtitle: track.language.toUpperCase(),
      };
    }

    return {
      title: rawTitle || `Track ${index + 1}`,
      subtitle: undefined,
    };
  };

  return (
    <Overlay visible={visible} onClose={onClose} contentStyle={S.modalContent}>
      <View style={S.modalHeader}>
        <View style={S.modalIconBg}>
          <DynamicIcon name={(icon as any) || "settings-outline"} size={ps(1.9)} color="#FFFFFF" />
        </View>
        <Text style={S.modalTitle}>{title}</Text>
        <View style={S.modalSubtitleBadge}>
          <Text style={S.modalSubtitleText}>
            {totalAvailable === 0
              ? "No tracks available"
              : `${totalAvailable} track${totalAvailable !== 1 ? "s" : ""} available`}
          </Text>
        </View>
      </View>

      <ScrollView style={S.modalScroll} showsVerticalScrollIndicator={false}>
        {isVideo && (
          <Focusable
            ringOnFocus={false}
            hasTVPreferredFocus={selected === undefined || !hasSelectedTrack}
            style={[S.modalOption, selected === undefined && S.modalOptionSelected]}
            focusStyle={S.modalOptionFocused}
            onPress={() => onSelect(undefined)}
          >
            {(focused: boolean) => {
              const isSelected = selected === undefined;
              return (
                <View style={S.modalOptionInner}>
                  <View style={S.modalOptionLeft}>
                    <View style={[S.trackIndexBadge, focused ? S.trackIndexBadgeFocused : isSelected && S.trackIndexBadgeActive]}>
                      <DynamicIcon
                        name="sparkles-outline"
                        size={ps(1.1)}
                        color={focused ? "#FFFFFF" : isSelected ? "#FFFFFF" : "rgba(255,255,255,0.7)"}
                      />
                    </View>
                    <View style={S.trackTitleCol}>
                      <Text style={[S.modalOptionText, isSelected && S.modalOptionTextSelected, focused && S.modalOptionTextFocused]}>
                        Auto (Recommended)
                      </Text>
                      <Text style={[S.modalOptionSubtext, focused && S.modalOptionSubtextFocused]}>
                        Adapts automatically to network & screen
                      </Text>
                    </View>
                  </View>
                  {isSelected && (
                    <View style={[S.checkBadge, focused && S.checkBadgeFocused]}>
                      <Check size={ps(1.1)} color={focused ? "#FFFFFF" : "#000000"} />
                    </View>
                  )}
                </View>
              );
            }}
          </Focusable>
        )}

        {mediaTracks.length === 0 && !isVideo ? (
          <View style={S.emptyState}>
            <AlertCircle size={32} color="rgba(255,255,255,0.2)" />
            <Text style={S.emptyText}>No tracks found</Text>
          </View>
        ) : (
          mediaTracks.map((track: any, index: number) => {
            const id = typeof track === "object" ? (track.id ?? track.index ?? index) : index;
            const isSelected = selected !== undefined && (selected === id || String(selected) === String(id));
            const display = getTrackDisplay(track, index);
            const preferThisFocus = isVideo
              ? isSelected
              : (hasSelectedTrack ? isSelected : index === 0);

            return (
              <Focusable
                key={index}
                hasTVPreferredFocus={preferThisFocus}
                ringOnFocus={false}
                style={[S.modalOption, isSelected && S.modalOptionSelected]}
                focusStyle={S.modalOptionFocused}
                onPress={() => onSelect(id, index)}
              >
                {(focused: boolean) => (
                  <View style={S.modalOptionInner}>
                    <View style={S.modalOptionLeft}>
                      <View style={[S.trackIndexBadge, focused ? S.trackIndexBadgeFocused : isSelected && S.trackIndexBadgeActive]}>
                        <Text style={[S.trackIndexText, focused ? S.trackIndexTextFocused : isSelected && S.trackIndexTextActive]}>
                          {index + 1}
                        </Text>
                      </View>
                      <View style={S.trackTitleCol}>
                        <Text style={[S.modalOptionText, isSelected && S.modalOptionTextSelected, focused && S.modalOptionTextFocused]} numberOfLines={1}>
                          {display.title}
                        </Text>
                        {display.subtitle ? (
                          <Text style={[S.modalOptionSubtext, focused && S.modalOptionSubtextFocused]} numberOfLines={1}>
                            {display.subtitle}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                    {isSelected && (
                      <View style={[S.checkBadge, focused && S.checkBadgeFocused]}>
                        <Check size={ps(1.1)} color={focused ? "#FFFFFF" : "#000000"} />
                      </View>
                    )}
                  </View>
                )}
              </Focusable>
            );
          })
        )}

        {(isSubtitle || disableTrack) && (
          <Focusable
            ringOnFocus={false}
            hasTVPreferredFocus={selected === -1 || String(selected) === "-1" || (options.length === 0 && !hasSelectedTrack)}
            style={[S.modalOption, (selected === -1 || String(selected) === "-1" || selected === undefined) && S.modalOptionSelected]}
            focusStyle={S.modalOptionFocused}
            onPress={() => onSelect(-1)}
          >
            {(focused: boolean) => {
              const isSelected = selected === -1 || String(selected) === "-1" || selected === undefined;
              return (
                <View style={S.modalOptionInner}>
                  <View style={S.modalOptionLeft}>
                    <View style={[S.trackIndexBadge, focused ? S.trackIndexBadgeFocused : isSelected && S.trackIndexBadgeActive]}>
                      <DynamicIcon
                        name="close-circle-outline"
                        size={ps(1.2)}
                        color={focused ? "#FFFFFF" : isSelected ? "#FFFFFF" : "rgba(255,255,255,0.7)"}
                      />
                    </View>
                    <View style={S.trackTitleCol}>
                      <Text style={[S.modalOptionText, isSelected && S.modalOptionTextSelected, focused && S.modalOptionTextFocused]}>
                        {isSubtitle ? "Disable Subtitles" : "Disable Video"}
                      </Text>
                      <Text style={[S.modalOptionSubtext, focused && S.modalOptionSubtextFocused]}>
                        Turn off track
                      </Text>
                    </View>
                  </View>
                  {isSelected && (
                    <View style={[S.checkBadge, focused && S.checkBadgeFocused]}>
                      <Check size={ps(1.1)} color={focused ? "#FFFFFF" : "#000000"} />
                    </View>
                  )}
                </View>
              );
            }}
          </Focusable>
        )}
      </ScrollView>

      <Focusable
        ringOnFocus={false}
        hasTVPreferredFocus={options.length === 0 && !isSubtitle}
        style={S.modalCloseBtn}
        focusStyle={S.modalCloseBtnFocused}
        onPress={onClose}
      >
        {(focused: boolean) => (
          <View style={S.modalCloseInner}>
            {/* Dark on the phone's white fill, or it is invisible. */}
            <X size={isPhone ? 13 : ps(1.2)} color={isPhone || focused ? "#000000" : "#FFFFFF"} />
            <Text style={[S.modalCloseBtnText, focused && S.modalCloseBtnTextFocused]}>
              CLOSE
            </Text>
          </View>
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
  // Scaled up: this is the only thing on screen while a stream connects, so
  // there is no competition for the space and nothing gained by keeping it
  // small. The poster keeps its 2:3 ratio.
  vodLoadingCard: {
    flexDirection: "row",
    alignItems: "center",
    width: ps(35),
    maxWidth: "88%",
    paddingHorizontal: ps(1.8),
    paddingVertical: ps(1.5),
    borderRadius: ps(1.2),
    backgroundColor: "#000000",
    gap: ps(1.5),
    elevation: 20,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.8,
    shadowRadius: 18,
  },
  vodPosterWrapper: {
    width: ps(6.6),
    height: ps(9.9),
    borderRadius: ps(0.7),
    overflow: "hidden",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  vodPosterImage: {
    width: "100%",
    height: "100%",
  },
  vodPosterFallback: {
    width: ps(6.6),
    height: ps(9.9),
    borderRadius: ps(0.7),
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  vodMetaBlock: {
    flex: 1,
    gap: ps(0.3),
  },
  vodBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    paddingHorizontal: ps(0.6),
    paddingVertical: ps(0.22),
    borderRadius: ps(0.4),
    marginBottom: ps(0.2),
  },
  vodBadgeText: {
    color: "#ffffff",
    fontSize: ps(0.85),
    fontWeight: "800",
    letterSpacing: 1,
  },
  // No fontFamily on any of these: Tenor Sans has no bold cut, so pairing it
  // with weight 600/800 makes Android synthesise one — smeared, doubled
  // glyphs. Enlarging the card only makes that more visible. See the note on
  // THEME.fonts in src/theme/tokens.ts.
  vodLoadingTitle: {
    color: "#ffffff",
    fontSize: ps(1.55),
    fontWeight: "800",
    lineHeight: ps(1.95),
  },
  vodLoadingSubtitle: {
    color: "rgba(255, 255, 255, 0.7)",
    fontSize: ps(1.05),
    fontWeight: "600",
  },
  vodSpinnerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: ps(0.8),
    marginTop: ps(0.9),
  },
  vodLoadingStatus: {
    color: "rgba(255, 255, 255, 0.8)",
    fontSize: ps(1.05),
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  midstreamBufferingOverlay: {
    position: "absolute",
    top: "34%",
    alignSelf: "center",
    zIndex: 55,
  },
  midstreamBufferingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: ps(0.8),
    backgroundColor: "rgba(14, 15, 20, 0.88)",
    paddingHorizontal: ps(1.6),
    paddingVertical: ps(0.8),
    borderRadius: 100,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.22)",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
  },
  midstreamBufferingText: {
    color: "#ffffff",
    fontSize: ps(1.0),
    fontWeight: "700",
    letterSpacing: 0.3,
  },

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
    top: "38%",
    alignSelf: "center",
    zIndex: 100,
  },
  seekIndicatorBox: {
    alignItems: "center",
    backgroundColor: "rgba(14, 15, 20, 0.95)",
    paddingHorizontal: ps(3.2),
    paddingVertical: ps(1.6),
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.22)",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
    elevation: 20,
    minWidth: ps(14),
    gap: ps(0.6),
  },
  seekIconBadge: {
    width: ps(3.8),
    height: ps(3.8),
    borderRadius: ps(1.9),
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  seekIndicatorText: {
    color: "#FFFFFF",
    fontSize: ps(1.6),
    fontWeight: "900",
    letterSpacing: 0.8,
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
    // Lifts the buttons off the panel on a phone. Landscape leaves 393dp of
    // height, and the panel takes the lower ~170 of it, so a true centre would
    // put them on top of the title. This keeps them close to the middle while
    // clearing it.
    paddingBottom: isPhone ? 56 : 0,
  },
  skipBtn: {
    width: ps(4.0),
    height: ps(4.0),
    borderRadius: ps(2.0),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  skipBtnFocused: {
    transform: [{ scale: 1.18 }],
    backgroundColor: "#F5F5F5",
    elevation: 12,
    shadowOpacity: 0.8,
  },
  playBtnContainer: { alignItems: "center", justifyContent: "center" },
  mainPlayBtn: {
    width: ps(5.6),
    height: ps(5.6),
    borderRadius: ps(2.8),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
  },
  mainPlayBtnFocused: {
    transform: [{ scale: 1.18 }],
    backgroundColor: "#F5F5F5",
    elevation: 16,
    shadowOpacity: 0.9,
  },

  /*
   * In the flow on a phone, floating above it everywhere else.
   *
   * Absolute + `zIndex: 10` puts this panel *over* `centerRow`, which is
   * `flex: 1` and therefore the full height of the overlay. On a TV's 540dp
   * that is harmless — the panel is nowhere near the vertically centred
   * transport buttons. The player is landscape on a phone, so the viewport is
   * only 393dp tall and the panel reaches well past the middle: it covered the
   * play / prev / next buttons, which is why they could not be tapped, and drew
   * the title across them.
   *
   * It stays absolute on a phone too, so the transport buttons keep the centre
   * of the screen — dropping it into the column pushed them into the band above
   * the panel, which read as stuck near the top. Instead the panel is made to
   * stop swallowing what is behind it (`pointerEvents="box-none"` at the call
   * site, plus the banner is already `none`), and the banner is compacted below
   * so the title no longer runs across the buttons.
   */
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
    color: "#FFFFFF",
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
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "transparent",
  },
  progressBarInner: {
    // Taller on a phone: this view is the scrub target, and the rail it draws
    // is only ps(0.7) — about 7dp — which is nothing to land a thumb on.
    height: isPhone ? 30 : ps(2.4),
    justifyContent: "center",
  },
  progressRail: {
    height: ps(0.7),
    width: "100%",
    backgroundColor: "rgba(255, 255, 255, 0.22)",
    borderRadius: ps(0.35),
    overflow: "hidden",
  },
  progressRailFocused: {
    height: ps(0.85),
    borderRadius: ps(0.42),
    backgroundColor: "rgba(255, 255, 255, 0.32)",
  },
  progressFill: {
    height: "100%",
    borderRadius: ps(0.35),
    overflow: "hidden",
    backgroundColor: "#F5F5F5",
  },
  scrubber: {
    position: "absolute",
    top: "50%",
    width: ps(1.4),
    height: ps(1.4),
    marginTop: -ps(0.7),
    marginLeft: -ps(0.7),
    borderRadius: ps(0.7),
    backgroundColor: "#F5F5F5",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.8,
    shadowRadius: 5,
    elevation: 8,
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.9)",
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
  iconChipFocused: {
    borderColor: "#FFFFFF",
    backgroundColor: "#F5F5F5",
    transform: [{ scale: 1.15 }],
    elevation: 8,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
  },
  actionsRight: { flexDirection: "row", alignItems: "center", gap: 14 },
  settingBtn: {
    width: ps(4.0),
    height: ps(4.0),
    borderRadius: ps(2.0),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
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
    backgroundColor: "rgba(14, 15, 20, 0.96)",
    width: "42%",
    maxWidth: ps(36),
    maxHeight: "85%",
    borderRadius: 20,
    borderWidth: isPhone ? 0 : 1.5,
    borderColor: "rgba(255, 255, 255, 0.16)",
    overflow: "hidden",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.9,
    shadowRadius: 30,
    elevation: 25,
  },
  modalHeader: {
    alignItems: "center",
    paddingTop: ph(2.6),
    paddingBottom: ph(1.6),
    paddingHorizontal: pw(2.5),
    // The header rule goes with the rest of the sheet's borders on a phone.
    borderBottomWidth: isPhone ? 0 : 1,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
  },
  modalIconBg: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    width: ps(3.8),
    height: ps(3.8),
    borderRadius: ps(1.9),
    borderWidth: isPhone ? 0 : 1,
    borderColor: "rgba(255, 255, 255, 0.18)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: ph(1.0),
  },
  modalTitle: {
    color: "#FFFFFF",
    fontSize: ps(1.6),
    fontWeight: "900",
    letterSpacing: 0.5,
    textAlign: "center",
  },
  modalSubtitleBadge: {
    marginTop: ph(0.6),
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    paddingHorizontal: ps(1.0),
    paddingVertical: ps(0.3),
    borderRadius: 100,
    borderWidth: isPhone ? 0 : 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
  },
  modalSubtitleText: {
    color: "rgba(255, 255, 255, 0.6)",
    fontSize: ps(0.85),
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  modalDivider: { height: 0, backgroundColor: "transparent" },
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
    borderRadius: 14,
    paddingVertical: ph(1.2),
    paddingHorizontal: pw(1.4),
    marginBottom: ph(0.6),
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderWidth: isPhone ? 0 : 1.5,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  modalOptionSelected: {
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderColor: "rgba(255, 255, 255, 0.32)",
  },
  modalOptionFocused: {
    backgroundColor: "#F5F5F5",
    borderColor: "#FFFFFF",
    transform: [{ scale: 1.02 }],
    elevation: 8,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  modalOptionInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flex: 1,
  },
  modalOptionLeft: { flexDirection: "row", alignItems: "center", gap: pw(1.2), flex: 1 },
  trackTitleCol: { flex: 1, gap: 2 },
  modalOptionSubtext: {
    color: "rgba(255, 255, 255, 0.45)",
    fontSize: ps(0.85),
    fontWeight: "600",
  },
  modalOptionSubtextFocused: {
    color: "rgba(0, 0, 0, 0.6)",
    fontWeight: "700",
  },
  trackIndexBadge: {
    width: ps(2.4),
    height: ps(2.4),
    borderRadius: ps(1.2),
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  trackIndexBadgeActive: {
    backgroundColor: "rgba(255, 255, 255, 0.22)",
  },
  trackIndexBadgeFocused: {
    backgroundColor: "#000000",
  },
  trackIndexText: {
    color: "rgba(255, 255, 255, 0.6)",
    fontSize: ps(0.9),
    fontWeight: "900",
  },
  trackIndexTextActive: {
    color: "#FFFFFF",
  },
  trackIndexTextFocused: {
    color: "#FFFFFF",
  },
  modalOptionText: {
    color: "#FFFFFF",
    fontSize: ps(1.15),
    fontWeight: "700",
    flex: 1,
  },
  modalOptionTextSelected: {
    color: "#FFFFFF",
    fontWeight: "800",
  },
  modalOptionTextFocused: {
    color: "#000000",
    fontWeight: "800",
  },
  checkBadge: {
    width: ps(1.8),
    height: ps(1.8),
    borderRadius: ps(0.9),
    backgroundColor: "#F5F5F5",
    alignItems: "center",
    justifyContent: "center",
  },
  checkBadgeFocused: {
    backgroundColor: "#000000",
  },
  /*
   * Solid on a phone, and tall enough to hit.
   *
   * The 0.08 fill and the hairline are a *resting* state: on a remote the
   * button turns white the moment it takes focus, which is how you see it. A
   * phone focuses nothing, so it stayed a faint chip on a dark sheet — and
   * removing the border left it fainter still. `ph(1.3)` is 5dp of padding
   * here too, against 7 on the box, so it was a sliver.
   */
  modalCloseBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: isPhone ? 9 : ph(1.3),
    marginHorizontal: isPhone ? 18 : pw(1.6),
    marginTop: ph(0.6),
    marginBottom: isPhone ? 10 : ph(1.4),
    borderRadius: 14,
    backgroundColor: isPhone ? "#F5F5F5" : "rgba(255, 255, 255, 0.08)",
    borderWidth: isPhone ? 0 : 1.5,
    borderColor: "rgba(255, 255, 255, 0.14)",
  },
  modalCloseBtnFocused: {
    backgroundColor: "#F5F5F5",
    borderColor: "#FFFFFF",
    transform: [{ scale: 1.02 }],
    elevation: 8,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  modalCloseInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: ps(0.6),
  },
  modalCloseBtnText: {
    color: isPhone ? "#000000" : "#FFFFFF",
    fontSize: isPhone ? 12 : ps(1.0),
    fontWeight: "900",
    letterSpacing: 2,
  },
  modalCloseBtnTextFocused: {
    color: "#000000",
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
  },
  actionLabelBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  actionLabel: { color: "#fff", fontSize: ps(0.75), fontWeight: "900" },
});