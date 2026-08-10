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
  AppState,
  AppStateStatus,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import Video, { ResizeMode, SelectedTrackType, TextTrackType, DRMType } from 'react-native-video';
import { VLCPlayer } from 'react-native-vlc-media-player';
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
import { Focusable, FocusGroup, Overlay, useDPad } from "../src/tv";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

type AspectRatioType = "16:9" | "4:3" | "fit" | "fill";

const ASPECT_RATIOS: {
  key: AspectRatioType;
  label: string;
  resize: ResizeMode;
}[] = [
    { key: "fit", label: "Fit", resize: ResizeMode.CONTAIN },
    { key: "fill", label: "Fill", resize: ResizeMode.COVER },
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
    drmScheme?: string;
    drmLicenseUrl?: string;
  }>();
  const insets = useSafeAreaInsets();
  const activePortal = usePortalStore((s) => s.activePortal);

  const isLive = params.type === "live";
  const is4K = typeof params.title === 'string' && (params.title.toUpperCase().includes('4K') || params.title.toUpperCase().includes('UHD'));

  const shouldUseVlc = React.useMemo(() => {
    if (!params.cmd) return is4K;
    const url = params.cmd.toLowerCase();
    return is4K || url.includes(".ts") || url.includes("mpegts") || url.startsWith("rtsp://");
  }, [params.cmd, is4K]);

  // Update isSeekable based on content type
  useEffect(() => {
    setIsSeekable(!isLive);
  }, [isLive]);

  // Handle AppState (backgrounding the app) and PlaybackState
  useEffect(() => {
    PlaybackState.setActive(true);
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state !== "active") {
        // Must pause the player when the app goes into the background
        // Otherwise Android destroys the SurfaceView and VLC crashes natively.
        setIsPlaying(false);
      }
    });
    return () => {
      PlaybackState.setActive(false);
      sub.remove();
    };
  }, []);
  // Core player state
  const [streamUrl, setStreamUrl] = useState(params.url || "");
  const [seekBarNode, setSeekBarNode] = useState<number | undefined>(undefined);
  const [dummyLeftNode, setDummyLeftNode] = useState<number | undefined>(undefined);
  const [dummyRightNode, setDummyRightNode] = useState<number | undefined>(undefined);
  const [actionsRowNode, setActionsRowNode] = useState<number | undefined>(undefined);
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
  const [vlcSeekTarget, setVlcSeekTarget] = useState<number | undefined>(undefined);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Enhanced features state
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [showAudioModal, setShowAudioModal] = useState(false);
  const [showSubtitleModal, setShowSubtitleModal] = useState(false);
  const [focusedControl, setFocusedControl] = useState<string | null>(null);
  const [seekBarFocused, setSeekBarFocused] = useState(false);
  const [visualFocus, setVisualFocus] = useState(false);
  const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);


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
  const [vlcPosition, setVlcPosition] = useState(0);

  const hasSetInitialPosition = useRef(false);
  const lockBtnRef = useRef<any>(null);
  const savedResumePosition = useRef(0);
  const retryCount = useRef(0);
  const maxRetries = 3;

  const controlsTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressViewRef = useRef<View>(null);
  const actionsRowRef = useRef<any>(null);
  const playerRef = useRef<any>(null);
  const vlcPlayerRef = useRef<any>(null);
  const lastPositionSaveTime = useRef(0);

  const isSeeking = useRef(false);
  const seekTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetSeekPosition = useRef<number | null>(null);
  const vlcSeekTargetRef = useRef<number | null>(null);
  const brightnessPermissionRequestInProgress = useRef(false);

  const lastTapTime = useRef(0);
  const tapTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialTouch = useRef({ x: 0, y: 0, val: 0, bright: 0 });

  const [currentVolume, setCurrentVolume] = useState(100);
  const brightnessRef = useRef(0.5);
  const volumeRef = useRef(100);

  const isPlayingRef = useRef(isPlaying);
  const showControlsRef = useRef(showControls);
  const isLockedRef = useRef(isLocked);
  const showVideoModalRef = useRef(showVideoModal);
  const showAudioModalRef = useRef(showAudioModal);
  const showSubtitleModalRef = useRef(showSubtitleModal);
  const seekBarFocusedRef = useRef(seekBarFocused);

  const dummyLeftFocusedRef = useRef(false);
  const dummyRightFocusedRef = useRef(false);
  // True whenever focus sits on ANY button that owns its own Left/Right
  // navigation (settings row, center play/skip row, or the rewind/ff chips)
  // — excluded from the global seek fallback below so pressing Left/Right
  // there navigates between sibling buttons instead of ALSO seeking.
  const isNavRowFocusedRef = useRef(false);
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

  const normalizeVlcTime = (value: unknown) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return n;
  };

  const handleNormalizedProgress = useCallback(
    (positionMs: number, durationMs: number) => {
      if (isSeeking.current) return;
      positionRef.current = positionMs;
      durationRef.current = durationMs;
      setPosition(positionMs);
      if (durationMs > 0) setDuration(durationMs);
      if (params.contentId && params.type !== "live" && Date.now() - lastPositionSaveTime.current > 10000) {
        lastPositionSaveTime.current = Date.now();
        StreamManager.savePlaybackPosition(params.contentId, positionMs, durationMs);
      }
    },
    [params.contentId, params.type]
  );

  const resetControlsTimeout = useCallback(() => {
    if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
    controlsTimeout.current = setTimeout(() => {
      if (isPlayingRef.current && !isLockedRef.current && !showVideoModalRef.current && !showAudioModalRef.current && !showSubtitleModalRef.current) {
        setShowControls(false);
      }
    }, 5000);
  }, []);

  const requestVlcSeek = useCallback((positionMs: number) => {
    if (!durationRef.current || durationRef.current <= 0) return;
    const clamped = Math.max(0, Math.min(positionMs, durationRef.current));
    let fraction = clamped / durationRef.current;
    
    // Ensure the prop always changes so React Native bridges it
    setVlcSeekTarget((prev) => {
      const finalFraction = prev === fraction ? fraction + 1e-10 : fraction;
      vlcSeekTargetRef.current = finalFraction;
      return finalFraction;
    });

    isSeeking.current = true;
    setPosition(clamped);
    resetControlsTimeout();
  }, [resetControlsTimeout]);

  // Reusable handlers to mark/unmark "this button owns Left/Right navigation".
  // Spread onto every Focusable in a horizontally-arranged row.
  const navRowFocusHandlers = {
    onFocus: () => {
      isNavRowFocusedRef.current = true;
      resetControlsTimeout();
    },
    onBlur: () => {
      isNavRowFocusedRef.current = false;
    },
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

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      // If the user intentionally backs out of the player normally, clear any stale external resume marker
      safeStorage.removeItem('resume_player_state').catch(() => { });
    };
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
  }, [showVideoModal, showAudioModal, showSubtitleModal]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    ScreenOrientation.unlockAsync();
    Brightness.getBrightnessAsync().then(b => {
      if (!isNaN(b)) brightnessRef.current = b;
    });

    const requestBrightnessPermission = async () => {
      if (brightnessPermissionRequestInProgress.current) return;
      try {
        brightnessPermissionRequestInProgress.current = true;
        await Brightness.requestPermissionsAsync();
      } catch (err) {
        console.warn("Brightness permission failed", err);
      } finally {
        brightnessPermissionRequestInProgress.current = false;
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
          if (typeof parsed.autoPlay === "boolean") {
            setAutoPlay(parsed.autoPlay);
            setIsPlaying(parsed.autoPlay);
          }
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
      } finally {
        setSettingsLoaded(true);
      }
    };
    loadSettingsAndResume();
  }, [params.contentId, params.type]);

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
        } else {
          setSeekIndicator(null); // Ensure indicator clears if we somehow got stuck
        }
        isScrubbing.current = false;
        isAdjustingVolume.current = false;
        isAdjustingBrightness.current = false;
        if (Math.abs(gestureState.dx) < 10 && Math.abs(gestureState.dy) < 10) handleTapRef.current(gestureState.x0);
      },
      onPanResponderTerminate: (_, gestureState) => {
        setVolumeIndicator(null);
        setBrightnessIndicator(null);
        setSeekIndicator(null);
        isScrubbing.current = false;
        isAdjustingVolume.current = false;
        isAdjustingBrightness.current = false;
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
        let newPos = Math.max(0, Math.min(position + delta, duration));
        if (shouldUseVlc) {
          requestVlcSeek(newPos);
        } else {
          isSeeking.current = true;
          if (seekTimeout.current) clearTimeout(seekTimeout.current);
          setPosition(newPos);
          if (playerRef.current) playerRef.current.seek(newPos / 1000);
          seekTimeout.current = setTimeout(() => { isSeeking.current = false; }, 1000);
          resetControlsTimeout();
        }
      } catch (e) {
        console.error("Seek error:", e);
        isSeeking.current = false;
      }
    }
  }, [duration, isSeekable, position, resetControlsTimeout, shouldUseVlc, requestVlcSeek]);

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

  const lastAccumulateTime = useRef(0);
  const accumulateSeek = useCallback((delta: number) => {
    if (isLockedRef.current) return;
    if (duration <= 0 || !isSeekable || params.type === "live") return;
    const now = Date.now();
    if (now - lastAccumulateTime.current < 50) return;
    lastAccumulateTime.current = now;

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
          if (shouldUseVlc) {
             requestVlcSeek(finalPos);
             setSeekIndicator(null);
          } else {
            if (playerRef.current) playerRef.current.seek(finalPos / 1000);
            seekTimeout.current = setTimeout(() => {
              if (mountedRef.current) {
                isSeeking.current = false;
                setSeekIndicator(null);
              }
            }, 1000);
          }
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
        } else if (!isLive && !isNavRowFocusedRef.current) {
          if (seekBarFocusedRef.current || dummyLeftFocusedRef.current || dummyRightFocusedRef.current) {
            accumulateSeek(-10000);
          } else {
            seek(-10000);
          }
        }
        resetControlsTimeout();
      },
      onRight: () => {
        if (isLockedRef.current) return;
        if (!showControlsRef.current) {
          if (!isLive) seek(10000);
          setShowControls(true);
        } else if (!isLive && !isNavRowFocusedRef.current) {
          if (seekBarFocusedRef.current || dummyLeftFocusedRef.current || dummyRightFocusedRef.current) {
            accumulateSeek(10000);
          } else {
            seek(10000);
          }
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

    // react-native-video rate is a prop, automatically propagates via state

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
    if (retryCount.current >= maxRetries || !activePortal || !params.cmd) {
      setIsLoading(false);
      return;
    }
    retryCount.current += 1;
    setIsRetrying(true);
    try {
      const result = await StreamManager.retryStream({ id: params.contentId || "", name: params.title || "", streamUrl: params.cmd }, activePortal, params.type === "live" ? "itv" : "vod", retryCount.current - 1);
      if (result.success && result.url) { 
        setStreamUrl(result.url); 
        hasSetInitialPosition.current = false;
        savedResumePosition.current = positionRef.current;
        setVlcSeekTarget(undefined);
        vlcSeekTargetRef.current = null;
        isSeeking.current = false;
        targetSeekPosition.current = null;
        setIsLoading(true); 
      } else {
        setIsLoading(false);
      }
    } catch (e) { 
      console.error("Retry failed", e); 
      setIsLoading(false);
    }
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
        if (playerRef.current) playerRef.current.seek(savedResumePosition.current / 1000);
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

    if (params.contentId && params.type !== "live" && Date.now() - lastPositionSaveTime.current > 10000) {
      lastPositionSaveTime.current = Date.now();
      StreamManager.savePlaybackPosition(params.contentId, cur, data.duration || duration);
    }
  };
  const progressPercent = isLive ? 0 : (duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0);

  const normalizeVlcTracks = (tracks: any[]) => {
    if (!tracks || !Array.isArray(tracks)) return [];
    return tracks.map((track, index) => ({
      id: track.id ?? track.index ?? index,
      index,
      name: track.name ?? track.title ?? track.language ?? `Track ${index + 1}`,
      language: track.language,
    }));
  };

  // Ensure the native module is actually present
  const isRCTVideoAvailable = (() => {
    try {
      if (UIManager.getViewManagerConfig) {
        return UIManager.getViewManagerConfig('RCTVideo') != null;
      }
      return (UIManager as any).RCTVideo != null;
    } catch (e) {
      return false;
    }
  })();

  if (!settingsLoaded) {
    return (
      <View style={S.container}>
        <View style={S.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={THEME.colors.primary} />
        </View>
      </View>
    );
  }

  if (!shouldUseVlc && !isRCTVideoAvailable) {
    return (
      <View style={{ flex: 1, backgroundColor: 'black', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <MaterialCommunityIcons name="alert-circle" size={48} color="white" style={{ marginBottom: 16 }} />
        <Text style={{ color: 'white', fontSize: 18, textAlign: 'center', fontWeight: 'bold', marginBottom: 8 }}>
          react-native-video is not supported in Expo Go
        </Text>
        <Text style={{ color: 'white', fontSize: 14, textAlign: 'center', opacity: 0.8 }}>
          Because you are running the app in Expo Go, the native video module is missing. The player has safely fallen back to an empty view, but it cannot play videos.
          {'\n\n'}
          Please build a custom Development Build (npx expo run:android or run:ios).
        </Text>
      </View>
    );
  }

  return (
    <View style={S.container} {...panResponder.panHandlers}>
      <StatusBar hidden />
      {shouldUseVlc ? (
        <VLCPlayer
          key={`vlc-${streamUrl}`}
          ref={vlcPlayerRef}
          style={S.video}
          source={{ uri: streamUrl }}
          seek={vlcSeekTarget}
          paused={!isPlaying}
          rate={playbackSpeed}
          volume={currentVolume}
          resizeMode={ASPECT_RATIOS[aspectRatioIndex].resize as any}
          audioTrack={selectedAudioTrack}
          textTrack={selectedTextTrack}
          onLoad={(e: any) => {
            const durationMs = normalizeVlcTime(e.duration);
            setIsLoading(false);
            setIsBuffering(false);

            if (durationMs > 0) {
              durationRef.current = durationMs;
              setDuration(durationMs);
            }

            if (e.videoTracks) setVideoTracks(normalizeVlcTracks(e.videoTracks));
            if (e.audioTracks) setAudioTracks(normalizeVlcTracks(e.audioTracks));
            if (e.textTracks) setTextTracks(normalizeVlcTracks(e.textTracks));
            
            if (!hasSetInitialPosition.current && savedResumePosition.current > 0 && params.type !== "live" && durationMs > 0) {
              hasSetInitialPosition.current = true;
              requestVlcSeek(savedResumePosition.current);
            }
          }}
          onPlaying={() => {
            setIsLoading(false);
            setIsBuffering(false);
          }}
          onProgress={(e: any) => {
            const currentMs = normalizeVlcTime(e.currentTime);
            const durationMs = normalizeVlcTime(e.duration);

            if (durationMs > 0) {
              durationRef.current = durationMs;
              setDuration(durationMs);
            }

            if (isSeeking.current) {
              const target = vlcSeekTargetRef.current;
              if (target !== null && durationMs > 0) {
                const currentFraction = currentMs / durationMs;
                if (Math.abs(currentFraction - target) < 0.02) {
                  isSeeking.current = false;
                  vlcSeekTargetRef.current = null;
                  // We explicitly DO NOT clear vlcSeekTarget to undefined here.
                  // React Native's @ReactProp bridges undefined as 0.0f for floats,
                  // which would inadvertently trigger a seek back to the start.
                }
              }
              return;
            }

            handleNormalizedProgress(currentMs, durationMs);
            setIsLoading(false);
          }}
          onBuffering={(e: any) => {
            const buffering = typeof e?.isBuffering === "boolean" ? e.isBuffering : true;
            setIsBuffering(buffering);
            if (!buffering) setIsLoading(false);
          }}
          onEnd={() => {
            setIsPlaying(false);
            if (params.contentId) StreamManager.savePlaybackPosition(params.contentId, 0, durationRef.current);
          }}
          onError={handleSilentRetry}
        />
      ) : (
        <Video
          key={`video-${streamUrl}`}
          ref={playerRef}
          style={S.video}
          source={{
            uri: streamUrl,
            // DRM support for ClearKey
            ...(params.drmLicenseUrl && params.drmScheme ? {
              drm: {
                type: params.drmScheme as DRMType,
                licenseServer: params.drmLicenseUrl,
              }
            } : {}),
            ...(!shouldUseVlc ? {
              bufferConfig: {
                minBufferMs: 60000,
                maxBufferMs: 60000,
                bufferForPlaybackMs: isLive ? 500 : 2500,
                bufferForPlaybackAfterRebufferMs: isLive ? 1000 : 5000,
              }
            } : {})
          }}
          controls={false}
          paused={!isPlaying}
          rate={playbackSpeed}
          volume={currentVolume / 100}
          resizeMode={ASPECT_RATIOS[aspectRatioIndex].resize}
          // @ts-ignore - pictureInPicture is supported on some platforms natively but missing in standard types
          pictureInPicture={true}
          selectedVideoTrack={selectedVideoTrack !== undefined ? { type: 'index' as any, value: selectedVideoTrack } : undefined}
          selectedAudioTrack={selectedAudioTrack !== undefined ? { type: SelectedTrackType.INDEX, value: selectedAudioTrack } : undefined}
          selectedTextTrack={selectedTextTrack !== undefined ? { type: 'index' as any, value: selectedTextTrack } : undefined}
          onLoad={(data) => {
            setIsLoading(false);
            if (data.videoTracks) {
              const formattedVideoTracks = data.videoTracks.map((t: any, i: number) => {
                const res = t.height ? `${t.width}x${t.height}` : `Quality ${i + 1}`;
                const bit = t.bitrate && t.bitrate > 0 ? ` (${(t.bitrate / 1000000).toFixed(1)} Mbps)` : '';
                return { id: i, name: res + bit };
              });
              setVideoTracks(formattedVideoTracks);
            }
            if (data.audioTracks) setAudioTracks(data.audioTracks);
            if (data.textTracks) setTextTracks(data.textTracks);
            const durMs = (data.duration || 0) * 1000;
            if (durMs > 0) setDuration(durMs);

            if (!hasSetInitialPosition.current && savedResumePosition.current > 0 && params.type !== "live" && durMs > 0) {
              hasSetInitialPosition.current = true;
              setTimeout(() => {
                if (playerRef.current) playerRef.current.seek(savedResumePosition.current / 1000);
              }, 300);
            }
          }}
          onReadyForDisplay={() => setIsLoading(false)}
          onProgress={(data) => {
            setIsLoading(false); // Failsafe: if we get progress, it's definitely loaded
            let curMs = (data.currentTime || 0) * 1000;
            let durMs = (data.seekableDuration || 0) * 1000;
            handleNormalizedProgress(curMs, durMs);
          }}
          onBuffer={({ isBuffering }) => {
            setIsBuffering(isBuffering);
            if (!isBuffering) setIsLoading(false);
          }}
          onEnd={() => {
            setIsPlaying(false);
            if (params.contentId) StreamManager.savePlaybackPosition(params.contentId, 0, durationRef.current);
          }}
          onError={handleSilentRetry}
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
                <Text style={S.subTitle}></Text>
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
                  {...navRowFocusHandlers}
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
                  {...navRowFocusHandlers}
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
                  {...navRowFocusHandlers}
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
                        ringOnFocus={false}
                        nextFocusRight={seekBarNode}
                        nextFocusUp={seekBarNode}
                        nextFocusDown={seekBarNode}
                        nextFocusLeft={seekBarNode}
                        style={{ width: 1, height: 1, backgroundColor: 'transparent', position: 'absolute', left: 0 }}
                        onPress={togglePlay}
                        onFocus={() => {
                          if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current);
                          dummyLeftFocusedRef.current = true;
                          setVisualFocus(true);
                          accumulateSeek(-10000);
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
                        ringOnFocus={false}
                        nextFocusLeft={seekBarNode}
                        nextFocusUp={seekBarNode}
                        nextFocusDown={seekBarNode}
                        nextFocusRight={seekBarNode}
                        style={{ width: 1, height: 1, backgroundColor: 'transparent', position: 'absolute', right: 0 }}
                        onPress={togglePlay}
                        onFocus={() => {
                          if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current);
                          dummyRightFocusedRef.current = true;
                          setVisualFocus(true);
                          accumulateSeek(10000);
                          seekBarRef.current?.focus();
                        }}
                        onBlur={() => { dummyRightFocusedRef.current = false; handleSeekBlur(); }}
                      />
                    )}
                  </View>
                </View>
              )}
              <FocusGroup ref={actionsRowRef} style={S.actionsRow}>
                {(!isLocked || isTV) && (
                  <View style={S.actionsLeft}>
                    {!isLive && (
                      <>
                        <Focusable
                          ringOnFocus={false}
                          focusStyle={S.iconChipFocused}
                          style={S.iconChip}
                          onPress={() => seek(-10000)}
                          {...navRowFocusHandlers}
                        >
                          <MaterialCommunityIcons name="rewind-10" size={ps(1.6)} color="white" />
                        </Focusable>
                        <Focusable
                          ringOnFocus={false}
                          focusStyle={S.iconChipFocused}
                          style={S.iconChip}
                          onPress={() => seek(60000)}
                          {...navRowFocusHandlers}
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
                        {...navRowFocusHandlers}
                      >
                        <Ionicons name="speedometer-outline" size={ps(1.4)} color="white" />
                        <Text style={S.settingLabel}>{playbackSpeed.toFixed(2)}x</Text>
                      </Focusable>
                      <Focusable
                        ringOnFocus={false}
                        focusStyle={S.iconChipFocused}
                        style={S.settingBtn}
                        onPress={() => { if (isLockedRef.current) return; setShowSubtitleModal(true); }}
                        {...navRowFocusHandlers}
                      >
                        <Ionicons name="text-outline" size={ps(1.4)} color="white" />
                        <Text style={S.settingLabel}>SUBTITLES</Text>
                      </Focusable>
                      <Focusable
                        ringOnFocus={false}
                        focusStyle={S.iconChipFocused}
                        style={S.settingBtn}
                        onPress={() => { if (isLockedRef.current) return; setShowAudioModal(true); }}
                        {...navRowFocusHandlers}
                      >
                        <Ionicons name="musical-notes-outline" size={ps(1.4)} color="white" />
                        <Text style={S.settingLabel}>AUDIO</Text>
                      </Focusable>
                      {!is4K && (
                        <Focusable
                          ringOnFocus={false}
                          focusStyle={S.iconChipFocused}
                          style={S.settingBtn}
                          onPress={() => { if (isLockedRef.current) return; setShowVideoModal(true); }}
                          {...navRowFocusHandlers}
                        >
                          <Ionicons name="aperture-outline" size={ps(1.4)} color="white" />
                          <Text style={S.settingLabel}>QUALITY</Text>
                        </Focusable>
                      )}
                      <Focusable
                        ringOnFocus={false}
                        focusStyle={S.iconChipFocused}
                        style={S.settingBtn}
                        onPress={cycleAspectRatio}
                        {...navRowFocusHandlers}
                      >
                        <Ionicons name="expand" size={ps(1.4)} color="white" />
                        <Text style={S.settingLabel}>ASPECT</Text>
                      </Focusable>
                    </>
                  )}
                </View>
              </FocusGroup>
            </View>
          </View>
        </FocusGroup>
      )}

      <TrackSelectionModal visible={showVideoModal} title="Video Quality" icon="aperture" isVideo options={videoTracks} selected={selectedVideoTrack} onSelect={(id: number | undefined) => { setSelectedVideoTrack(id); setShowVideoModal(false); }} onClose={() => setShowVideoModal(false)} />
      <TrackSelectionModal visible={showAudioModal} title="Audio Track" icon="musical-notes" options={audioTracks} selected={selectedAudioTrack} onSelect={(id: number) => { setSelectedAudioTrack(id); setShowAudioModal(false); }} onClose={() => setShowAudioModal(false)} />
      <TrackSelectionModal visible={showSubtitleModal} title="Subtitles" icon="text" isSubtitle options={textTracks} selected={selectedTextTrack} onSelect={(id: number) => { setSelectedTextTrack(id); setShowSubtitleModal(false); }} onClose={() => setShowSubtitleModal(false)} />
    </View>
  );
}

function TrackSelectionModal({ visible, title, icon, options, selected, onSelect, onClose, isSubtitle = false, isVideo = false }: any) {
  return (
    <Overlay visible={visible} onClose={onClose} contentStyle={S.modalContent}>
      {/* Modal header */}
      <View style={S.modalHeader}>
        <LinearGradient
          colors={["#FFFFFF", "#E5E5E5"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={S.modalIconBg}
        >
          <Ionicons name={icon || "settings"} size={ps(2)} color="#000000" />
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
                    <Ionicons name="aperture" size={ps(1)} color={selected === undefined ? "#fff" : "rgba(255,255,255,0.5)"} />
                  </View>
                  <Text
                    style={[
                      S.modalOptionText,
                      selected === undefined && S.modalOptionTextSelected,
                      focused && S.modalOptionTextFocused,
                    ]}
                  >
                    Auto (Recommended)
                  </Text>
                </View>
                {selected === undefined && (
                  <View style={S.checkBadge}>
                    <Ionicons name="checkmark" size={ps(1.4)} color="#fff" />
                  </View>
                )}
              </View>
            )}
          </Focusable>
        )}
        {options.length === 0 ? (
          <View style={S.emptyState}>
            <Ionicons name="alert-circle-outline" size={ps(3)} color="rgba(255,255,255,0.2)" />
            <Text style={S.emptyText}>No tracks found</Text>
          </View>
        ) :
          options.map((track: any, index: number) => {
            const id = typeof track === 'object' ? (track.index ?? track.id ?? index) : index;
            const isSelected = selected !== undefined && selected === id;
            const trackName = typeof track === 'object' ? (track.title || track.language || track.name || `Track ${index + 1}`) : track;
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
  mainPlayBtn: { width: ps(4.8), height: ps(4.8), borderRadius: ps(2.4), overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", backgroundColor: "rgba(0,0,0,0.5)" },
  mainPlayBtnFocused: { borderColor: "#fff", transform: [{ scale: 1.08 }], backgroundColor: "rgba(255,255,255,0.1)" },
  mainPlayGradient: { flex: 1, width: "100%", height: "100%", borderRadius: ps(2.4), alignItems: "center", justifyContent: "center" },
  skipBtn: {
    width: ps(4.2),
    height: ps(4.2),
    borderRadius: ps(2.1),
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: "rgba(0,0,0,0.5)",
    overflow: "hidden",
  },
  skipInner: { flex: 1, width: "100%", height: "100%", borderRadius: ps(2.1), alignItems: "center", justifyContent: "center", gap: 1 },
  skipLabel: { color: "rgba(255,255,255,0.7)", fontSize: ps(0.65), fontWeight: "800", fontFamily: THEME.fonts.bold },
  controlFocused: { borderColor: "#fff", transform: [{ scale: 1.08 }], backgroundColor: "rgba(255,255,255,0.1)" },
  bottomOverlay: { position: "absolute", bottom: 0, left: 0, right: 0, paddingHorizontal: pw(5), zIndex: 10 },
  glassControls: { backgroundColor: "rgba(25,25,30,0.85)", borderRadius: 16, paddingVertical: 8, paddingHorizontal: 16, borderWidth: 1, borderColor: "rgba(15, 15, 15, 0.02)" },
  progressSection: { gap: 4, marginBottom: 4 },
  timeRow: { flexDirection: "row", justifyContent: "space-between" },
  timeText: { color: "#fff", fontSize: ps(0.8), fontWeight: "700", fontFamily: THEME.fonts.bold },

  // Progress bar — focusable on TV
  progressBarWrapper: {
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
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
  settingBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: "transparent" },
  settingLabel: { color: "rgba(255,255,255,0.7)", fontSize: ps(0.9), fontWeight: "900", fontFamily: THEME.fonts.bold },

  // ─── Premium Modal Styles ─────────────────────────────────────────────
  modalContent: {
    backgroundColor: "rgba(15, 15, 15, 0.1)",
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
    fontWeight: "700",
    fontFamily: THEME.fonts.bold,
    letterSpacing: -0.5,
    textAlign: "center",
  },
  modalSubtitle: {
    color: "rgba(255,255,255,0.4)",
    fontSize: ps(1.3),
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
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  modalOptionSelected: {
    backgroundColor: "rgba(255,27,138,0.12)",
    borderColor: "rgba(255, 27, 27, 0.3)",
  },
  modalOptionFocused: {
    borderColor: "#fff",
    backgroundColor: "rgba(255,255,255,0.15)",
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
    backgroundColor: "#ff2d55",
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
    fontWeight: "600",
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
    backgroundColor: "#ff2d55",
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
    borderWidth: 1,
    borderColor: "transparent",
  },
  modalCloseBtnFocused: {
    borderColor: "#fff",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  modalCloseBtnText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: ps(1.2),
    fontWeight: "700",
    fontFamily: THEME.fonts.bold,
    letterSpacing: 2,
  },
});
