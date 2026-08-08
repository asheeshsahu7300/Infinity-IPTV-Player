import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Platform,
  ActivityIndicator,
  StatusBar,
  GestureResponderEvent,
  PanResponder,
  ScrollView,
  BackHandler,
  findNodeHandle,
  UIManager,
  Animated,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
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
import { usePortalStore } from "../src/store/portalStore";
import { isTV } from "../src/utils/tvUtils";
import { THEME, ps, pw, ph } from "../src/theme/tokens";
import { Focusable, FocusGroup, Overlay, useDPad } from "../src/tv";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

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

type AspectRatioType = "16:9" | "4:3" | "fit" | "fill";

const ASPECT_RATIOS: {
  key: AspectRatioType;
  label: string;
  resize: PlayerAspectRatio;
}[] = [
    { key: "16:9", label: "16:9", resize: "16:9" },
    { key: "4:3", label: "4:3", resize: "4:3" },
    { key: "fit", label: "Fit", resize: "21:9" },
  ];

const AnimatedScrubber = React.memo(({ focused, progressPercent }: { focused: boolean, progressPercent: number }) => {
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
      style={[
        S.scrubber,
        { left: `${progressPercent}%`, transform: [{ scale }] }
      ]}
    />
  );
});

export default function PlayerScreen() {
  useKeepAwake();
  const router = useRouter();
  const params = useLocalSearchParams<{
    url: string;
    title: string;
    type: string;
    contentId?: string;
    cmd?: string;
  }>();
  const insets = useSafeAreaInsets();
  const activePortal = usePortalStore((s) => s.activePortal);

  const isLive = params.type === "live";

  // Update isSeekable based on content type
  useEffect(() => {
    setIsSeekable(!isLive);
  }, [isLive]);
  // Core player state
  const [streamUrl, setStreamUrl] = useState(params.url || "");
  const [seekBarNode, setSeekBarNode] = useState<number | undefined>(undefined);
  const [dummyLeftNode, setDummyLeftNode] = useState<number | undefined>(undefined);
  const [dummyRightNode, setDummyRightNode] = useState<number | undefined>(undefined);
  const seekBarRef = useRef<any>(null);
  const dummyLeftRef = useRef<View>(null);
  const dummyRightRef = useRef<View>(null);
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
  const [isSeekable, setIsSeekable] = useState(true);
  const [isLocked, setIsLocked] = useState(false);

  // Enhanced features state
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [showAudioModal, setShowAudioModal] = useState(false);
  const [showSubtitleModal, setShowSubtitleModal] = useState(false);
  const [focusedControl, setFocusedControl] = useState<string | null>(null);
  const [seekBarFocused, setSeekBarFocused] = useState(false);
  const [visualFocus, setVisualFocus] = useState(false);
  const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSeekFocus = useCallback(() => {
    if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current);
    setSeekBarFocused(true);
    setVisualFocus(true);
  }, []);

  const handleSeekBlur = useCallback(() => {
    if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current);
    focusTimeoutRef.current = setTimeout(() => {
      setSeekBarFocused(false);
      setVisualFocus(false);
    }, 150);
  }, []);

  const [audioTracks, setAudioTracks] = useState<any[]>([]);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState<number | undefined>(undefined);

  const [textTracks, setTextTracks] = useState<any[]>([]);
  const [selectedTextTrack, setSelectedTextTrack] = useState<number | undefined>(undefined);

  const [seekIndicator, setSeekIndicator] = useState<string | null>(null);
  const [volumeIndicator, setVolumeIndicator] = useState<number | null>(null);
  const [brightnessIndicator, setBrightnessIndicator] = useState<number | null>(null);
  const [vlcPosition, setVlcPosition] = useState(0);

  const hasSetInitialPosition = useRef(false);
  const lockBtnRef = useRef<any>(null);
  const savedResumePosition = useRef(0);
  const retryCount = useRef(0);
  const maxRetries = 3;

  const controlsTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressViewRef = useRef<View>(null);
  const vlcPlayerRef = useRef<any>(null);
  const expoVideoRef = useRef<Video>(null);
  const lastPositionSaveTime = useRef(0);

  const isSeeking = useRef(false);
  const seekTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetSeekPosition = useRef<number | null>(null);
  let brightnessPermissionRequestInProgress = false;

  const lastTapTime = useRef(0);
  const tapTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialTouch = useRef({ x: 0, y: 0, val: 0, bright: 0 });

  const [currentVolume, setCurrentVolume] = useState(100);
  const brightnessRef = useRef(0.5);
  const volumeRef = useRef(100);

  const isPlayingRef = useRef(isPlaying);
  const showControlsRef = useRef(showControls);
  const isLockedRef = useRef(isLocked);
  const showAudioModalRef = useRef(showAudioModal);
  const showSubtitleModalRef = useRef(showSubtitleModal);
  const seekBarFocusedRef = useRef(seekBarFocused);

  const dummyLeftFocusedRef = useRef(false);
  const dummyRightFocusedRef = useRef(false);
  const accumulatedDelta = useRef(0);

  const isFullscreenRef = useRef(isFullscreen);
  const positionRef = useRef(position);
  const durationRef = useRef(duration);
  const isSeekableRef = useRef(isSeekable);
  const isScrubbing = useRef(false);
  const isAdjustingVolume = useRef(false);
  const isAdjustingBrightness = useRef(false);
  const mountedRef = useRef(true);
  const accumulateSeekRef = useRef<(delta: number) => void>(() => { });
  const handleTapRef = useRef<(x: number) => void>(() => { });

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

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

  useEffect(() => {
    let mounted = true;
    if (showControls) {
      const attachNodes = () => {
        if (!mounted) return;
        const seek = seekBarRef.current ? findNodeHandle(seekBarRef.current) : null;
        const left = dummyLeftRef.current ? findNodeHandle(dummyLeftRef.current) : null;
        const right = dummyRightRef.current ? findNodeHandle(dummyRightRef.current) : null;

        if (seek && left && right) {
          setSeekBarNode(seek);
          setDummyLeftNode(left);
          setDummyRightNode(right);
        } else if (isTV) {
          requestAnimationFrame(attachNodes);
        }
      };
      attachNodes();
    }
    return () => { mounted = false; };
  }, [showControls]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    ScreenOrientation.unlockAsync();
    Brightness.getBrightnessAsync().then(b => {
      if (!isNaN(b)) brightnessRef.current = b;
    });

    const requestBrightnessPermission = async () => {
      if (brightnessPermissionRequestInProgress) return;
      try {
        brightnessPermissionRequestInProgress = true;
        await Brightness.requestPermissionsAsync();
      } catch (err) {
        console.warn("Brightness permission failed", err);
      } finally {
        brightnessPermissionRequestInProgress = false;
      }
    };
    requestBrightnessPermission();

    return () => {
      if (!isTV) {
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      }
      Brightness.restoreSystemBrightnessAsync();
      if (params.contentId && position > 0 && duration > 0) {
        StreamManager.savePlaybackPosition(params.contentId, position, duration);
      }
    };
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      // Use refs to read current state without causing effect teardown
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
      StreamManager.savePlaybackPosition(params.contentId as string, positionRef.current, durationRef.current);
      return false;
    });
    return () => sub.remove();
  }, [params.contentId]);

  useEffect(() => {
    const loadSettingsAndResume = async () => {
      try {
        const settings = await safeStorage.getItem("app_settings");
        if (settings) {
          const parsed = JSON.parse(settings);
          if (typeof parsed.autoPlay === "boolean") setAutoPlay(parsed.autoPlay);
        }

        if (params.contentId && params.type !== "live") {
          const savedPosition = await StreamManager.getPlaybackPosition(params.contentId);
          if (savedPosition && savedPosition.position > 0) {
            const remainingTime = savedPosition.duration - savedPosition.position;
            if (remainingTime > 5000) {
              savedResumePosition.current = savedPosition.position;
              setPosition(savedPosition.position);
            }
          }
        }
      } catch (e) {
        console.error("Failed to load settings:", e);
      }
    };
    loadSettingsAndResume();
  }, [params.contentId, params.type]);

  const resetControlsTimeout = useCallback(() => {
    if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
    controlsTimeout.current = setTimeout(() => {
      if (isPlayingRef.current && !isLockedRef.current) setShowControls(false);
    }, 5000);
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return !isLockedRef.current && (Math.abs(gestureState.dx) > 10 || Math.abs(gestureState.dy) > 10);
      },
      onPanResponderGrant: (evt, _) => {
        initialTouch.current = {
          x: evt.nativeEvent.pageX,
          y: evt.nativeEvent.pageY,
          val: volumeRef.current,
          bright: brightnessRef.current
        };
        resetControlsTimeout();
      },
      onPanResponderMove: (_, gestureState) => {
        if (isLockedRef.current) return;
        const { dx, dy } = gestureState;

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
            let newVol = Math.min(100, Math.max(0, initialTouch.current.val + (delta * 100)));
            volumeRef.current = newVol;
            setCurrentVolume(newVol);
            setVolumeIndicator(newVol);
          } else {
            let newBright = Math.min(1, Math.max(0, initialTouch.current.bright + delta));
            brightnessRef.current = newBright;
            setBrightnessIndicator(newBright);
            Brightness.setBrightnessAsync(newBright);
          }
        } else if (isScrubbing.current) {
          const seekAmount = Math.round(dx / 10) * 1000;
          setSeekIndicator(`${seekAmount > 0 ? "+" : ""}${seekAmount / 1000}s`);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        setVolumeIndicator(null);
        setBrightnessIndicator(null);
        if (isScrubbing.current) {
          const seekAmount = Math.round(gestureState.dx / 10) * 1000;
          accumulateSeekRef.current(seekAmount);
        }
        isScrubbing.current = false;
        isAdjustingVolume.current = false;
        isAdjustingBrightness.current = false;
        if (Math.abs(gestureState.dx) < 10 && Math.abs(gestureState.dy) < 10) handleTapRef.current(gestureState.x0);
      },
    })
  ).current;



  const cycleAspectRatio = useCallback(() => {
    if (isLockedRef.current) return;
    setAspectRatioIndex(p => (p + 1) % ASPECT_RATIOS.length);
    resetControlsTimeout();
  }, [resetControlsTimeout]);

  const togglePlay = useCallback(() => {
    if (isLockedRef.current) return;
    setIsPlaying(prev => !prev);
    resetControlsTimeout();
  }, [resetControlsTimeout]);

  const seek = useCallback(async (delta: number) => {
    if (isLockedRef.current) return;
    if (duration > 0 && isSeekable) {
      try {
        isSeeking.current = true;
        if (seekTimeout.current) clearTimeout(seekTimeout.current);
        let newPos = Math.max(0, Math.min(position + delta, duration));
        setPosition(newPos);
        if (vlcPlayerRef.current) vlcPlayerRef.current.seek(newPos / duration);
        else if (expoVideoRef.current) await expoVideoRef.current.setPositionAsync(newPos);
        seekTimeout.current = setTimeout(() => { isSeeking.current = false; }, 1000);
      } catch (e) {
        console.error("Seek error:", e);
        isSeeking.current = false;
      }
      resetControlsTimeout();
    }
  }, [duration, isSeekable, position, resetControlsTimeout]);

  const handleTap = useCallback((x: number) => {
    const now = Date.now();
    if (now - lastTapTime.current < 300) {
      if (tapTimeout.current) clearTimeout(tapTimeout.current);
      if (isLockedRef.current) { return; }
      const isRight = x > SCREEN_WIDTH / 2;
      if (isSeekableRef.current && params.type !== "live") {
        seek(isRight ? 10000 : -10000);
        setSeekIndicator(isRight ? "+10s" : "-10s");
        setTimeout(() => setSeekIndicator(null), 500);
      }
    } else {
      tapTimeout.current = setTimeout(() => {
        setShowControls(p => {
          const next = !p;
          if (next) resetControlsTimeout();
          return next;
        });
      }, 300);
    }
    lastTapTime.current = now;
  }, [params.type, seek, resetControlsTimeout]);

  useEffect(() => {
    handleTapRef.current = handleTap;
  }, [handleTap]);

  const accumulateSeek = useCallback((delta: number) => {
    if (isLockedRef.current) return;
    if (duration <= 0 || !isSeekable || params.type === "live") return;

    if (targetSeekPosition.current === null) {
      targetSeekPosition.current = position;
      accumulatedDelta.current = 0;
    }

    targetSeekPosition.current = Math.max(0, Math.min(targetSeekPosition.current + delta, duration));
    accumulatedDelta.current += delta;

    // UI Updates instantly
    setPosition(targetSeekPosition.current);
    const sign = accumulatedDelta.current > 0 ? "+" : "";
    const sec = Math.abs(accumulatedDelta.current) / 1000;
    setSeekIndicator(`${sign}${sec}s`);

    if (seekTimeout.current) clearTimeout(seekTimeout.current);
    isSeeking.current = true;

    seekTimeout.current = setTimeout(async () => {
      if (!mountedRef.current) return;
      try {
        const finalPos = targetSeekPosition.current;
        if (finalPos !== null) {
          if (vlcPlayerRef.current) vlcPlayerRef.current.seek(finalPos / duration);
          else if (expoVideoRef.current) await expoVideoRef.current.setPositionAsync(finalPos);
        }
      } catch (e) {
        console.error("Seek error:", e);
      } finally {
        isSeeking.current = false;
        targetSeekPosition.current = null;
        accumulatedDelta.current = 0;
        setSeekIndicator(null);
        if (dummyLeftFocusedRef.current || dummyRightFocusedRef.current) {
          seekBarRef.current?.focus();
        }
      }
    }, 800);

    resetControlsTimeout();
  }, [duration, isSeekable, position, resetControlsTimeout, params.type]);

  useEffect(() => {
    accumulateSeekRef.current = accumulateSeek;
  }, [accumulateSeek]);

  // D-pad handler — only fires when NO modal is open.
  // When controls are hidden, any key press shows them.
  useDPad(
    {
      onPlayPause: () => {
        if (isLockedRef.current) return;
        togglePlay();
        setShowControls(true);
        resetControlsTimeout();
      },
      onFastForward: () => {
        if (isLockedRef.current) return;
        if (!isLive) seek(180000); // 3 minutes
        setShowControls(true);
        resetControlsTimeout();
      },
      onRewind: () => {
        if (isLockedRef.current) return;
        if (!isLive) seek(-180000); // 3 minutes
        setShowControls(true);
        resetControlsTimeout();
      },
      onLeft: () => {
        if (isLockedRef.current) return;
        if (!showControlsRef.current) {
          if (!isLive) seek(-10000);
          setShowControls(true);
        } else if (seekBarFocusedRef.current || dummyLeftFocusedRef.current || dummyRightFocusedRef.current) {
          if (!isLive) accumulateSeek(-10000);
        }
        resetControlsTimeout();
      },
      onRight: () => {
        if (isLockedRef.current) return;
        if (!showControlsRef.current) {
          if (!isLive) seek(10000);
          setShowControls(true);
        } else if (seekBarFocusedRef.current || dummyLeftFocusedRef.current || dummyRightFocusedRef.current) {
          if (!isLive) accumulateSeek(10000);
        }
        resetControlsTimeout();
      },
      onSelect: () => {
        if (isLockedRef.current) return;
        if (!showControlsRef.current) {
          togglePlay();
          setShowControls(true);
          resetControlsTimeout();
        }
        // When controls are showing, let native focus engine handle select on buttons
      },
      onUp: () => {
        setShowControls(true);
        resetControlsTimeout();
      },
      onDown: () => {
        setShowControls(true);
        resetControlsTimeout();
      },
      onAny: () => {
        if (!showControlsRef.current) {
          setShowControls(true);
          resetControlsTimeout();
        }
      }
    },
    isTV && !showAudioModal && !showSubtitleModal
  );

  const cyclePlaybackSpeed = () => {
    if (isLockedRef.current) return;
    const speeds = [1.0, 1.25, 1.5, 1.75, 2.0, 0.5, 0.75];
    const nextIndex = (speeds.indexOf(playbackSpeed) + 1) % speeds.length;
    const nextSpeed = speeds[nextIndex];
    setPlaybackSpeed(nextSpeed);

    if (vlcPlayerRef.current) {
      // VLC player uses dynamic rate prop so state update will automatically propagate
    }
    if (expoVideoRef.current) {
      expoVideoRef.current.setRateAsync(nextSpeed, true);
    }

    // Show a premium VLC-like toast-style overlay indicating speed change
    setSeekIndicator(`${nextSpeed.toFixed(2)}x Speed`);
    setTimeout(() => setSeekIndicator(null), 1000);
    resetControlsTimeout();
  };

  const handleProgressPress = (e: GestureResponderEvent) => {
    if (isLockedRef.current || isTV) return;
    progressViewRef.current?.measure((_x, _y, width, _height, pageX, _pageY) => {
      const touchX = e.nativeEvent.pageX - pageX;
      const targetFraction = Math.max(0, Math.min(1, touchX / width));
      seek(targetFraction * duration - position);
    });
  };

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}:${(m % 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
    return `${m}:${(s % 60).toString().padStart(2, "0")}`;
  };

  const handleSilentRetry = useCallback(async () => {
    if (retryCount.current >= maxRetries || !activePortal || !params.cmd) return;
    retryCount.current += 1;
    setIsRetrying(true);
    try {
      const result = await StreamManager.retryStream({ id: params.contentId || "", name: params.title || "", streamUrl: params.cmd }, activePortal, params.type === "live" ? "itv" : "vod", retryCount.current - 1);
      if (result.success && result.url) { setStreamUrl(result.url); setIsLoading(true); }
    } catch (e) { console.error("Retry failed", e); }
    finally { setIsRetrying(false); }
  }, [activePortal, params]);

  const onLoad = (data: any) => {
    setIsLoading(false); retryCount.current = 0;
    if (data.audioTracks) setAudioTracks(data.audioTracks);
    if (data.textTracks) setTextTracks(data.textTracks);

    // Ensure duration is in milliseconds and valid
    let newDuration = Number(data.duration);
    if (newDuration > 0) {
      // Some players return seconds, convert to ms if it's suspiciously small compared to typical VODs
      if (newDuration < 10000 && params.type !== "live" && !String(streamUrl).includes(".m3u8")) {
        // This is a heuristic - if it's < 10s it might be seconds
        // But let's be safer: check against current position if available
      }
      setDuration(newDuration);
    }

    if (!hasSetInitialPosition.current && savedResumePosition.current > 0 && params.type !== "live" && newDuration > 0) {
      hasSetInitialPosition.current = true;
      setTimeout(() => {
        if (vlcPlayerRef.current) vlcPlayerRef.current.seek(savedResumePosition.current / newDuration);
        else if (expoVideoRef.current) expoVideoRef.current.setPositionAsync(savedResumePosition.current);
      }, 300);
    }
  };

  const onProgress = (data: any) => {
    let cur = Number(data?.currentTime);
    if (!Number.isFinite(cur) || cur < 0 || isSeeking.current) return;

    setPosition(cur);

    if (data.duration) {
      let d = Number(data.duration);
      // Only update if it's a valid positive number and potentially growing (for HLS)
      if (d > duration || (duration === 0 && d > 0)) {
        setDuration(d);
      }
    }

    if (data.position !== undefined) {
      setVlcPosition(data.position);
    }

    if (params.contentId && params.type !== "live" && Date.now() - lastPositionSaveTime.current > 10000) {
      lastPositionSaveTime.current = Date.now();
      StreamManager.savePlaybackPosition(params.contentId, cur, data.duration || duration);
    }
  };

  const onExpoStatusUpdate = (status: AVPlaybackStatus) => {
    if (!status.isLoaded) { if (status.error) handleSilentRetry(); return; }
    setIsBuffering(status.isBuffering);
    if (status.durationMillis) setDuration(status.durationMillis);
    if (status.positionMillis !== undefined) onProgress({ currentTime: status.positionMillis, duration: status.durationMillis });
    if (status.didJustFinish) { setIsPlaying(false); if (params.contentId) StreamManager.savePlaybackPosition(params.contentId, 0, status.durationMillis || duration); }
  };

  const getExpoResizeMode = () => {
    const r = ASPECT_RATIOS[aspectRatioIndex].key;
    if (r === "fit") return ResizeMode.CONTAIN;
    if (r === "fill") return ResizeMode.COVER;
    return ResizeMode.STRETCH;
  };

  // VLCPlayer source with HTTP headers and low latency network caching flags
  const vlcSource = {
    uri: streamUrl,
    hwDecoderEnabled: 1,
    hwDecoderForced: 1,
    headers: {
      "User-Agent": "okhttp/3.12.1",
      "Accept": "*/*",
      "Connection": "keep-alive",
    },
    initOptions: [
      `--network-caching=${isLive ? 60000 : 30000}`,
      `--live-caching=${isLive ? 60000 : 30000}`,
      `--file-caching=${isLive ? 60000 : 30000}`,
      `--tcp-caching=${isLive ? 60000 : 30000}`,
      "--avcodec-hw=any",
      "--avcodec-fast",
      "--avcodec-skiploopfilter=1",
      "--mediacodec-dr",
      "--http-reconnect",
      "--http-continuous",
      "--http-user-agent=okhttp/3.12.1",
      "--rtsp-tcp",
    ],
  };

  const progressPercent = isLive ? 0 : (vlcPosition > 0 ? vlcPosition * 100 : (duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0));

  return (
    <View style={S.container} {...panResponder.panHandlers}>
      <StatusBar hidden />
      {isLive && isVLCSupported() ? (
        <VLCPlayer
          ref={vlcPlayerRef} style={S.video} source={vlcSource} autoplay={autoPlay} paused={!isPlaying}
          audioTrack={selectedAudioTrack} textTrack={selectedTextTrack} volume={currentVolume} rate={playbackSpeed}
          videoAspectRatio={ASPECT_RATIOS[aspectRatioIndex].resize}
          onLoad={onLoad} onProgress={onProgress} onError={handleSilentRetry}
          onBuffering={(i: any) => setIsBuffering(i.isBuffering)}
          onPlaying={() => { setIsPlaying(true); setIsLoading(false); }}
        />
      ) : (
        <Video
          ref={expoVideoRef} style={S.video} source={{ uri: streamUrl }} shouldPlay={autoPlay && isPlaying}
          rate={playbackSpeed} resizeMode={getExpoResizeMode()} onPlaybackStatusUpdate={onExpoStatusUpdate}
          onLoad={(s) => s.isLoaded && onLoad({ duration: s.durationMillis })}
        />
      )}

      {/* Invisible focusable overlay to catch remote OK press when controls are hidden.
          This ensures the focus engine always has a target to trigger Select. */}
      {!showControls && isTV && (
        <Focusable
          hasTVPreferredFocus
          style={StyleSheet.absoluteFill}
          ringOnFocus={false}
          onPress={() => {
            setShowControls(true);
            resetControlsTimeout();
          }}
        />
      )}

      {(isLoading || isRetrying) && (
        <View style={S.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={THEME.colors.primary} />
          <Text style={S.loadingText}>{isRetrying ? "Reconnecting..." : "Loading..."}</Text>
        </View>
      )}

      {volumeIndicator !== null && (
        <View style={S.centerIndicator} pointerEvents="none">
          <Ionicons name="volume-high" size={40} color="#fff" />
          <Text style={S.indicatorText}>{Math.round(volumeIndicator)}%</Text>
          <View style={S.barContainer}><View style={[S.barFill, { width: `${volumeIndicator}%` }]} /></View>
        </View>
      )}
      {brightnessIndicator !== null && (
        <View style={S.centerIndicator} pointerEvents="none">
          <Ionicons name="sunny" size={40} color="#fff" />
          <Text style={S.indicatorText}>{Math.round(brightnessIndicator * 100)}%</Text>
          <View style={S.barContainer}><View style={[S.barFill, { width: `${brightnessIndicator * 100}%` }]} /></View>
        </View>
      )}

      {/* Seek indicator overlay */}
      {seekIndicator !== null && (
        <View style={S.seekIndicatorOverlay} pointerEvents="none">
          <View style={S.seekIndicatorBox}>
            <MaterialCommunityIcons
              name={seekIndicator.startsWith("+") ? "fast-forward" : "rewind"}
              size={ps(2.5)}
              color="#fff"
            />
            <Text style={S.seekIndicatorText}>{seekIndicator}</Text>
          </View>
        </View>
      )}

      {showControls && (
        <FocusGroup style={S.controlsOverlay}>
          {/* Top gradient */}
          <LinearGradient
            colors={["rgba(0,0,0,0.7)", "transparent"]}
            style={S.topGradient}
            pointerEvents="none"
          />

          <View style={[S.header, { paddingTop: insets.top + (isTV ? ph(2) : ph(1)) }]}>
            <View style={S.headerLeft}>
              <View style={S.headerInfo}>
                <Text style={S.mainTitle} numberOfLines={1}>{params.title || "Unknown Content"}</Text>
                <Text style={S.subTitle}>{isLive ? "LIVE STREAM" : ""}</Text>
              </View>
            </View>
            <View style={S.headerRight}></View>
          </View>

          {!isLocked && (
            <View style={S.centerRow}>
              {!isLive && (
                <Focusable
                  ringOnFocus={false}
                  focusStyle={S.controlFocused}
                  style={S.skipBtn}
                  onPress={() => seek(-10000)}
                >
                  {(focused) => (
                    <View style={S.skipInner}>
                      <Ionicons name="play-back" size={ps(1.4)} color="#fff" style={{ opacity: focused ? 1 : 0.7 }} />
                      <Text style={[S.skipLabel, focused && { color: "#fff" }]}>-10s</Text>
                    </View>
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
                >
                  <LinearGradient colors={["rgba(255,255,255,0.05)", "rgba(255,255,255,0.05)"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={S.mainPlayGradient}>
                    <Ionicons name={isPlaying ? "pause" : "play"} size={ps(2)} color="#fff" />
                  </LinearGradient>
                </Focusable>
              </View>
              {!isLive && (
                <Focusable
                  ringOnFocus={false}
                  focusStyle={S.controlFocused}
                  style={S.skipBtn}
                  onPress={() => seek(10000)}
                >
                  {(focused) => (
                    <View style={S.skipInner}>
                      <Ionicons name="play-forward" size={ps(1.4)} color="#fff" style={{ opacity: focused ? 1 : 0.7 }} />
                      <Text style={[S.skipLabel, focused && { color: "#fff" }]}>+10s</Text>
                    </View>
                  )}
                </Focusable>
              )}
            </View>
          )}

          {/* Bottom gradient */}
          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.8)"]}
            style={S.bottomGradient}
            pointerEvents="none"
          />

          <View style={[S.bottomOverlay, { paddingBottom: insets.bottom + ph(2) }]}>
            <View style={S.glassControls}>
              {(!isLocked || isTV) && !isLive && duration > 0 && (
                <View style={S.progressSection}>
                  <View style={S.timeRow}>
                    <Text style={S.timeText}>
                      {formatTime(position)}
                      {duration > 0 && (
                        <Text style={{ color: 'rgba(255,255,255,0.4)' }}> / {formatTime(duration)}</Text>
                      )}
                    </Text>
                    {duration > position && (
                      <Text style={[S.timeText, { opacity: 0.5 }]}>
                        -{formatTime(duration - position)}
                      </Text>
                    )}
                  </View>
                  {/* Seekable progress bar — focusable on TV for D-pad scrub */}
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {isTV && (
                      <Focusable
                        ref={dummyLeftRef}
                        nextFocusRight={seekBarNode}
                        style={{ width: 1, height: 1, backgroundColor: 'transparent', position: 'absolute', left: 0 }}
                        onFocus={() => {
                          dummyLeftFocusedRef.current = true;
                          setVisualFocus(true);
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
                      onFocus={handleSeekFocus}
                      onBlur={handleSeekBlur}
                      onPress={togglePlay}
                    >
                      {() => {
                        const effFocused = isTV ? (visualFocus || dummyLeftFocusedRef.current || dummyRightFocusedRef.current) : true;
                        return (
                          <View style={S.progressBarInner}>
                            <View ref={progressViewRef} style={[S.progressRail, effFocused && S.progressRailFocused]} onTouchEnd={handleProgressPress}>
                              <View style={[S.bufferBar, { width: isBuffering ? '100%' : '0%' }]} />
                              <View style={[S.progressFill, { width: `${progressPercent}%` }]} />
                              <AnimatedScrubber focused={effFocused} progressPercent={progressPercent} />
                            </View>
                          </View>
                        )
                      }}
                    </Focusable>
                    {isTV && (
                      <Focusable
                        ref={dummyRightRef}
                        nextFocusLeft={seekBarNode}
                        style={{ width: 1, height: 1, backgroundColor: 'transparent', position: 'absolute', right: 0 }}
                        onFocus={() => {
                          dummyRightFocusedRef.current = true;
                          setVisualFocus(true);
                        }}
                        onBlur={() => { dummyRightFocusedRef.current = false; handleSeekBlur(); }}
                      />
                    )}
                  </View>
                </View>
              )}
              {(!isLocked || isTV) && isLive && (
                <View style={S.liveBadgeRow}>
                  <View style={S.liveDot} />
                  <Text style={S.liveText}>LIVE</Text>
                </View>
              )}
              <View style={S.actionsRow}>
                {(!isLocked || isTV) && (
                  <View style={S.actionsLeft}>
                    {!isLive && (
                      <>
                        <Focusable
                          ringOnFocus={false}
                          focusStyle={S.iconChipFocused}
                          style={S.iconChip}
                          onPress={() => seek(-10000)}
                        >
                          <MaterialCommunityIcons name="rewind-10" size={ps(1.6)} color="white" />
                        </Focusable>
                        <Focusable
                          ringOnFocus={false}
                          focusStyle={S.iconChipFocused}
                          style={S.iconChip}
                          onPress={() => seek(60000)}
                        >
                          <MaterialCommunityIcons name="fast-forward-60" size={ps(1.6)} color="white" />
                        </Focusable>
                      </>
                    )}
                  </View>
                )}
                <View style={S.actionsRight}>

                  {(!isLocked || isTV) && (
                    <>
                      <Focusable
                        ringOnFocus={false}
                        focusStyle={S.iconChipFocused}
                        style={S.settingBtn}
                        onPress={cyclePlaybackSpeed}
                      >
                        <Ionicons name="speedometer-outline" size={ps(1.4)} color="white" />
                        <Text style={S.settingLabel}>{playbackSpeed.toFixed(2)}x</Text>
                      </Focusable>
                      <Focusable
                        ringOnFocus={false}
                        focusStyle={S.iconChipFocused}
                        style={S.settingBtn}
                        onPress={() => { if (isLockedRef.current) return; setShowSubtitleModal(true); }}
                      >
                        <Ionicons name="text-outline" size={ps(1.4)} color="white" />
                        <Text style={S.settingLabel}>SUBTITLES</Text>
                      </Focusable>
                      <Focusable
                        ringOnFocus={false}
                        focusStyle={S.iconChipFocused}
                        style={S.settingBtn}
                        onPress={() => { if (isLockedRef.current) return; setShowAudioModal(true); }}
                      >
                        <Ionicons name="musical-notes-outline" size={ps(1.4)} color="white" />
                        <Text style={S.settingLabel}>AUDIO</Text>
                      </Focusable>
                      <Focusable
                        ringOnFocus={false}
                        focusStyle={S.iconChipFocused}
                        style={S.settingBtn}
                        onPress={cycleAspectRatio}
                      >
                        <Ionicons name="expand" size={ps(1.4)} color="white" />
                        <Text style={S.settingLabel}>ASPECT</Text>
                      </Focusable>
                    </>
                  )}
                </View>
              </View>
            </View>
          </View>
        </FocusGroup>
      )}

      <TrackSelectionModal visible={showAudioModal} title="Audio Track" icon="musical-notes" options={audioTracks} selected={selectedAudioTrack} onSelect={(id: number) => { setSelectedAudioTrack(id); setShowAudioModal(false); }} onClose={() => setShowAudioModal(false)} />
      <TrackSelectionModal visible={showSubtitleModal} title="Subtitles" icon="text" isSubtitle options={textTracks} selected={selectedTextTrack} onSelect={(id: number) => { setSelectedTextTrack(id); setShowSubtitleModal(false); }} onClose={() => setShowSubtitleModal(false)} />
    </View>
  );
}

function TrackSelectionModal({ visible, title, icon, options, selected, onSelect, onClose, isSubtitle = false }: any) {
  return (
    <Overlay visible={visible} onClose={onClose} contentStyle={S.modalContent}>
      {/* Modal header */}
      <View style={S.modalHeader}>
        <LinearGradient
          colors={["#db0482", "#3305eb"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={S.modalIconBg}
        >
          <Ionicons name={icon || "settings"} size={ps(2)} color="#fff" />
        </LinearGradient>
        <Text style={S.modalTitle}>{title}</Text>
        <Text style={S.modalSubtitle}>
          {options.length === 0
            ? "No tracks available"
            : `${options.length} track${options.length !== 1 ? "s" : ""} available`}
        </Text>
      </View>

      <View style={S.modalDivider} />

      <ScrollView style={S.modalScroll} showsVerticalScrollIndicator={false}>
        {options.length === 0 ? (
          <View style={S.emptyState}>
            <Ionicons name="alert-circle-outline" size={ps(3)} color="rgba(255,255,255,0.2)" />
            <Text style={S.emptyText}>No tracks found</Text>
          </View>
        ) :
          options.map((track: any, index: number) => {
            const id = typeof track === 'object' ? track.id : index;
            const isSelected = selected === id;
            const trackName = typeof track === 'object' ? track.name || `Track ${index + 1}` : track;
            return (
              <Focusable
                key={index}
                hasTVPreferredFocus={index === 0}
                ringOnFocus={false}
                style={[S.modalOption, isSelected && S.modalOptionSelected]}
                focusStyle={S.modalOptionFocused}
                onPress={() => onSelect(id)}
              >
                {(focused: boolean) => (
                  <View style={S.modalOptionInner}>
                    <View style={S.modalOptionLeft}>
                      <View style={[S.trackIndexBadge, isSelected && S.trackIndexBadgeActive]}>
                        <Text style={[S.trackIndexText, isSelected && S.trackIndexTextActive]}>
                          {index + 1}
                        </Text>
                      </View>
                      <Text
                        style={[
                          S.modalOptionText,
                          isSelected && S.modalOptionTextSelected,
                          focused && S.modalOptionTextFocused,
                        ]}
                        numberOfLines={2}
                      >
                        {trackName}
                      </Text>
                    </View>
                    {isSelected && (
                      <View style={S.checkBadge}>
                        <Ionicons name="checkmark" size={ps(1.4)} color="#fff" />
                      </View>
                    )}
                  </View>
                )}
              </Focusable>
            );
          })}
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
                    <Ionicons name="close" size={ps(1)} color={selected === -1 ? "#fff" : "rgba(255,255,255,0.5)"} />
                  </View>
                  <Text
                    style={[
                      S.modalOptionText,
                      selected === -1 && S.modalOptionTextSelected,
                      focused && S.modalOptionTextFocused,
                    ]}
                  >
                    Disable Subtitles
                  </Text>
                </View>
                {selected === -1 && (
                  <View style={S.checkBadge}>
                    <Ionicons name="checkmark" size={ps(1.4)} color="#fff" />
                  </View>
                )}
              </View>
            )}
          </Focusable>
        )}
      </ScrollView>

      <View style={S.modalDivider} />

      {/* Close button */}
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


const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  video: { ...StyleSheet.absoluteFillObject },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.8)", justifyContent: "center", alignItems: "center" },
  loadingText: { color: "#fff", marginTop: 10, fontSize: ps(1.1), fontWeight: "600", fontFamily: THEME.fonts.medium },
  centerIndicator: { position: "absolute", top: "50%", alignSelf: "center", backgroundColor: "rgba(0,0,0,0.7)", padding: 25, borderRadius: 20, alignItems: "center", marginTop: -60 },
  indicatorText: { color: "#fff", fontSize: 18, fontWeight: "bold", fontFamily: THEME.fonts.bold, marginTop: 10 },
  barContainer: { height: 4, width: 100, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 2, marginTop: 15 },
  barFill: { height: "100%", backgroundColor: THEME.colors.primary, borderRadius: 2 },

  // Seek indicator
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
  bottomGradient: { position: "absolute", bottom: 0, left: 0, right: 0, height: "40%" },
  header: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: pw(5), alignItems: "flex-start", zIndex: 10 },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 20, flex: 1 },
  backBtn: { width: ps(3.5), height: ps(3.5), borderRadius: 25, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  headerInfo: { gap: 4, flex: 1 },
  mainTitle: { color: "#fff", fontSize: ps(1.8), fontWeight: "900", fontFamily: THEME.fonts.bold, letterSpacing: -0.5 },
  subTitle: { color: "rgba(255,255,255,0.6)", fontSize: ps(0.9), fontWeight: "600", fontFamily: THEME.fonts.medium },
  headerRight: { paddingTop: 8 },
  qualityBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.1)", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
  qualityBadgeText: { color: "#fff", fontSize: ps(0.7), fontWeight: "900", fontFamily: THEME.fonts.bold, letterSpacing: 1 },
  centerRow: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: pw(8) },
  playBtnContainer: { width: ps(6), height: ps(6), alignItems: "center", justifyContent: "center" },
  mainPlayBtn: { width: ps(4.8), height: ps(4.8), borderRadius: ps(2.4), overflow: "hidden", borderWidth: 2, borderColor: "rgba(255,255,255,0.2)", backgroundColor: "rgba(0,0,0,0.5)" },
  mainPlayBtnFocused: { borderColor: "#fff", transform: [{ scale: 1.08 }], backgroundColor: "rgba(255,255,255,0.1)" },
  mainPlayGradient: { flex: 1, width: "100%", height: "100%", borderRadius: ps(2.4), alignItems: "center", justifyContent: "center" },
  skipBtn: {
    width: ps(4.2),
    height: ps(4.2),
    borderRadius: ps(2.1),
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: "rgba(0,0,0,0.5)",
    overflow: "hidden",
  },
  skipInner: { flex: 1, width: "100%", height: "100%", borderRadius: ps(2.1), alignItems: "center", justifyContent: "center", gap: 1 },
  skipLabel: { color: "rgba(255,255,255,0.7)", fontSize: ps(0.65), fontWeight: "800", fontFamily: THEME.fonts.bold },
  controlFocused: { borderColor: "#fff", transform: [{ scale: 1.08 }], backgroundColor: "rgba(255,255,255,0.1)" },
  bottomOverlay: { position: "absolute", bottom: 0, left: 0, right: 0, paddingHorizontal: pw(5), zIndex: 10 },
  glassControls: { backgroundColor: "rgba(25,25,30,0.85)", borderRadius: 16, paddingVertical: 8, paddingHorizontal: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.05)" },
  progressSection: { gap: 4, marginBottom: 4 },
  timeRow: { flexDirection: "row", justifyContent: "space-between" },
  timeText: { color: "#fff", fontSize: ps(0.8), fontWeight: "700", fontFamily: THEME.fonts.bold },

  // Progress bar — focusable on TV
  progressBarWrapper: {
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "transparent",
  },
  progressBarInner: {
    height: 24,
    justifyContent: "center",
  },
  progressRail: { height: 4, width: "100%", backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 2, overflow: "visible" },
  progressRailFocused: { height: 4, borderRadius: 4 },
  bufferBar: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(255,255,255,0.1)" },
  progressFill: { height: "100%", borderRadius: 2, overflow: "hidden", backgroundColor: "#fff" },
  scrubber: { position: "absolute", top: "50%", marginTop: -10, width: 20, height: 20, borderRadius: 10, backgroundColor: "white", marginLeft: -10, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.4, shadowRadius: 3, elevation: 3 },
  seekHint: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  seekHintText: { color: "rgba(255,255,255,0.5)", fontSize: ps(0.7), fontWeight: "600", fontFamily: THEME.fonts.medium },

  liveBadgeRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#ff2d55" },
  liveText: { color: "#fff", fontSize: ps(0.85), fontWeight: "900", fontFamily: THEME.fonts.bold, letterSpacing: 1 },
  actionsRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  actionsLeft: { flexDirection: "row", alignItems: "center", gap: pw(1) },
  iconChip: { padding: 6, borderRadius: 6, borderWidth: 1, borderColor: "transparent" },
  iconChipFocused: { borderColor: "#fff", backgroundColor: "rgba(255,255,255,0.1)" },
  vSeparator: { width: 1, height: 12, backgroundColor: "rgba(255,255,255,0.2)" },
  actionLabelBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  actionLabel: { color: "#fff", fontSize: ps(0.75), fontWeight: "900", fontFamily: THEME.fonts.bold },
  actionsRight: { flexDirection: "row", alignItems: "center", gap: pw(1) },
  settingBtn: { alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, borderWidth: 2, borderColor: "transparent" },
  settingLabel: { color: "rgba(255,255,255,0.7)", fontSize: ps(0.9), fontWeight: "900", fontFamily: THEME.fonts.bold },

  // ─── Premium Modal Styles ─────────────────────────────────────────────
  modalContent: {
    backgroundColor: "#14141a",
    width: isTV ? "50%" : "85%",
    maxWidth: 600,
    maxHeight: "80%",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  modalHeader: {
    alignItems: "center",
    paddingTop: ps(2),
    paddingBottom: ps(1.2),
    paddingHorizontal: 20,
  },
  modalIconBg: {
    width: ps(4),
    height: ps(4),
    borderRadius: ps(2),
    alignItems: "center",
    justifyContent: "center",
    marginBottom: ps(0.8),
  },
  modalTitle: {
    color: "#fff",
    fontSize: ps(2),
    fontWeight: "900",
    fontFamily: THEME.fonts.bold,
    letterSpacing: -0.5,
    textAlign: "center",
  },
  modalSubtitle: {
    color: "rgba(255,255,255,0.4)",
    fontSize: ps(1),
    fontWeight: "600",
    fontFamily: THEME.fonts.medium,
    marginTop: 4,
    textAlign: "center",
  },
  modalDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
    marginHorizontal: 20,
  },
  modalScroll: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: ps(3),
    gap: 12,
  },
  emptyText: {
    color: "rgba(255,255,255,0.3)",
    fontSize: ps(1.2),
    fontWeight: "600",
    fontFamily: THEME.fonts.medium,
  },
  modalOption: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    paddingVertical: ps(1),
    paddingHorizontal: 16,
    marginBottom: 6,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  modalOptionSelected: {
    backgroundColor: "rgba(255,27,138,0.12)",
    borderColor: "rgba(255, 27, 27, 0.3)",
  },
  modalOptionFocused: {
    borderColor: "#fff",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  modalOptionInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flex: 1,
  },
  modalOptionLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    flex: 1,
  },
  trackIndexBadge: {
    width: ps(2.5),
    height: ps(2.5),
    borderRadius: ps(1.25),
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  trackIndexBadgeActive: {
    backgroundColor: THEME.colors.primary,
  },
  trackIndexText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: ps(1),
    fontWeight: "900",
    fontFamily: THEME.fonts.bold,
  },
  trackIndexTextActive: {
    color: "#fff",
  },
  modalOptionText: {
    color: "#fff",
    fontSize: ps(1.6),
    fontWeight: "700",
    fontFamily: THEME.fonts.bold,
    flex: 1,
  },
  modalOptionTextSelected: {
    color: THEME.colors.primary,
    fontFamily: THEME.fonts.bold,
  },
  modalOptionTextFocused: {
    color: "#fff",
    fontFamily: THEME.fonts.bold,
  },
  checkBadge: {
    width: ps(2.2),
    height: ps(2.2),
    borderRadius: ps(1.1),
    backgroundColor: THEME.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  modalCloseBtn: {
    alignItems: "center",
    paddingVertical: ps(1.2),
    marginHorizontal: 16,
    marginVertical: 12,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 2,
    borderColor: "transparent",
  },
  modalCloseBtnFocused: {
    borderColor: "#fff",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  modalCloseBtnText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: ps(1.2),
    fontWeight: "900",
    fontFamily: THEME.fonts.bold,
    letterSpacing: 2,
  },
});