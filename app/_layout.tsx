import React, { useEffect, useState, useRef } from "react";
import { Stack, useRouter, useNavigationContainerRef } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  StyleSheet,
  AppState,
  AppStateStatus,
  Platform,
  Animated,
  Image as RNImage,
  View,
  BackHandler,
  StatusBar as RNStatusBar,
} from "react-native";
import * as Linking from "expo-linking";
import * as ScreenOrientation from "expo-screen-orientation";
import { LinearGradient } from "expo-linear-gradient";
import { 
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  Inter_900Black 
} from "@expo-google-fonts/inter";
import { Audio } from "expo-av";

import ErrorBoundary from "../src/components/ErrorBoundary";
import { usePortalStore } from "../src/store/portalStore";
import { ThemeProvider } from "../src/context/ThemeContext";
import { AppBootManager, SYNC_INTERVAL } from "../src/services/AppBootManager";
import { stbEnvironment } from "../src/services/stbEnvironment";
import { parentalControl } from "../src/services/parentalControl";
import { DeepLink } from "../src/services/DeepLink";
import { PlaybackState } from "../src/services/PlaybackState";
import { ph, pw } from "../src/theme/tokens";
import { safeStorage } from "../src/services/safeStorage";
import { setSafeNavigationRef, safeBack } from "../src/services/safeNavigation";

// Inject CSS for Web to guarantee the font loads exactly as requested
if (Platform.OS === "web" && typeof document !== "undefined" && !document.getElementById("inter-font")) {
  const style = document.createElement("style");
  style.id = "inter-font";
  style.textContent = `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');`;
  document.head.append(style);
}

// Modern Cinematic Splash Screen Component
function SplashScreen() {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Fade in
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 1000,
      useNativeDriver: true,
    }).start();

    // Pulse loop
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.05, duration: 2500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 2500, useNativeDriver: true }),
      ])
    ).start();

    // Splash sound is now managed by RootLayout to ensure perfect sync
    // between the audio duration and the splash screen lifecycle.
  }, []);

  return (
    <LinearGradient colors={["#0F1014", "#000000"]} style={styles.splash}>
      <Animated.View style={[styles.splashContent, { opacity: fadeAnim }]}>
        <Animated.View
          style={[styles.splashLogoWrapper, { transform: [{ scale: pulseAnim }] }]}
        >
          <RNImage
            source={require("../assets/images/TV.png")}
            style={styles.logoImage}
          />
        </Animated.View>
      </Animated.View>
    </LinearGradient>
  );
}

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);
  const isHydrated = usePortalStore((s) => s.isHydrated);
  const overscanPadding = usePortalStore((s) => s.overscanPadding);
  const router = useRouter();
  const navigationRef = useNavigationContainerRef();

  // Keep safeNavigation reference in sync with root navigation container
  useEffect(() => {
    if (navigationRef) {
      setSafeNavigationRef(navigationRef);
    }
  }, [navigationRef]);

  /**
   * Allow tablets and phones to rotate freely between portrait and landscape.
   * Skipped on TV boxes where orientation is fixed.
   */
  useEffect(() => {
    if (Platform.isTV) return;
    ScreenOrientation.unlockAsync().catch(() => {});
  }, []);

  // Global remote hardware BackHandler:
  // Catches any unhandled back press and pops to the previous DISTINCT screen,
  // preventing navigating back to the same screen or looping through duplicate history.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      return safeBack();
    });
    return () => sub.remove();
  }, []);

  // Load premium Google TV fonts
  const [fontsLoaded] = useFonts({
    Inter: Inter_400Regular,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    Inter_900Black,
  });

  // Check for external player resume state after process death
  useEffect(() => {
    (async () => {
      try {
        const raw = await safeStorage.getItem('resume_player_state');
        if (raw) {
          const state = JSON.parse(raw);
          // guard against resuming something stale from days ago
          if (Date.now() - state.timestamp < 5 * 60 * 1000) {
            router.replace({ pathname: '/player', params: state });
          }
          await safeStorage.removeItem('resume_player_state');
        }
      } catch (e) {
        console.warn('Resume state check failed', e);
      }
    })();
  }, [router]);

  // Boot the app via AppBootManager. Capture the launch URL first so
  // app/index.tsx can replay it once the store is hydrated.
  useEffect(() => {
    const soundDelay = new Promise<void>(async (resolve) => {
      let sound: Audio.Sound | null = null;

      const finish = () => {
        resolve();
        if (sound) {
          // Unload a little after it finishes to prevent audio cutoff glitches
          setTimeout(() => {
            try {
              sound!.unloadAsync();
            } catch (e) { }
          }, 1000);
        }
      };

      // 5s max safety fallback in case audio fails to play or report completion
      let fallbackTimer = setTimeout(finish, 5000);

      try {
        const { sound: s } = await Audio.Sound.createAsync(
          require("../assets/sounds/splash.wav")
        );
        sound = s;

        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded && status.didJustFinish) {
            clearTimeout(fallbackTimer);
            finish();
          }
        });

        await sound.playAsync();
      } catch (e) {
        console.warn("Failed to play splash sound:", e);
        clearTimeout(fallbackTimer);
        finish();
      }
    });

    // Both are read synchronously all over the app — the player asks for the
    // buffer depth before its first frame, and every channel list asks whether
    // a row is locked while rendering — so they are warmed during boot rather
    // than awaited at each use site.
    const stbProcess = Promise.all([
      stbEnvironment.load().catch(() => { }),
      parentalControl.load().catch(() => { }),
    ]);

    const bootProcess = DeepLink.capture()
      .catch(() => { })
      .then(() => AppBootManager.initialize())
      .then(() => stbProcess);

    Promise.all([bootProcess, soundDelay])
      .then(() => {
        setIsReady(true);
      })
      .catch((e) => {
        console.error("Boot failed:", e);
        setIsReady(true);
      });
  }, []);

  // Ensure status bar is hidden (immersive full-screen is handled natively by MainActivity)
  useEffect(() => {
    RNStatusBar.setHidden(true, "none");
  }, []);

  // Links that arrive while the app is already running.
  useEffect(() => {
    const sub = Linking.addEventListener("url", ({ url }) => DeepLink.push(url));
    return () => sub.remove();
  }, []);

  // Periodic refresh. Skipped during playback — warming the portal pulls large
  // payloads through the JS thread and stutters video. Routed through
  // AppBootManager so it shares the 30-minute gate and the single-flight lock
  // with boot and resume instead of racing them.
  useEffect(() => {
    if (!isHydrated || !isReady) return;

    const interval = setInterval(() => {
      if (PlaybackState.isActive) return;
      const portal = usePortalStore.getState().activePortal;
      if (!portal) return;
      AppBootManager.triggerBackgroundSync(portal).catch(() => { });
    }, SYNC_INTERVAL);

    return () => clearInterval(interval);
  }, [isHydrated, isReady]);

  // Handle app resume. Also gated: every foreground used to kick off a full
  // portal refetch, so tabbing away and back re-downloaded the entire library.
  useEffect(() => {
    const handleAppStateChange = (state: AppStateStatus) => {
      if (state !== "active" || !isHydrated) return;
      // Returning from an external player must not stall playback resume.
      if (PlaybackState.isActive) return;
      const portal = usePortalStore.getState().activePortal;
      if (!portal) return;
      AppBootManager.triggerBackgroundSync(portal).catch(() => { });
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);
    return () => subscription.remove();
  }, [isHydrated]);

  if (!isReady || !isHydrated || !fontsLoaded) {
    return (
      <ErrorBoundary>
        <ThemeProvider>
          <SafeAreaProvider>
            <View style={styles.container}>
              <SplashScreen />
            </View>
          </SafeAreaProvider>
        </ThemeProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <SafeAreaProvider>
          <View style={[styles.container, { padding: overscanPadding }]}>
            <StatusBar style="light" hidden={true} />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: "transparent" },
                animation: "none",
                // Inactive screens keep their scroll/focus state but stop
                // re-rendering, so backgrounded grids don't compete with the
                // foreground screen (or the player) for the JS thread.
                freezeOnBlur: true,
              }}
              initialRouteName="index"
            >
              <Stack.Screen name="index" />
              <Stack.Screen name="portals" />
              <Stack.Screen name="add-portal" />
              <Stack.Screen name="dashboard" />
              <Stack.Screen name="live-tv" options={{ contentStyle: { backgroundColor: "#000000" } }} />
              <Stack.Screen name="vod" />
              <Stack.Screen name="series" />
              <Stack.Screen name="series-details" />
              <Stack.Screen name="player" options={{ animation: "fade" }} />
              <Stack.Screen name="search" />
              <Stack.Screen name="settings" />
              <Stack.Screen name="privacy-policy" />
              {/* Set-top-box screens. The guide has always been on disk but
                  was never registered here, so nothing could route to it. */}
              <Stack.Screen name="epg" />
              <Stack.Screen name="speed-test" />
              <Stack.Screen name="parental-control" />
              <Stack.Screen name="system-info" />
              <Stack.Screen name="categories" />
            </Stack>
          </View>
        </SafeAreaProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#08080a" },
  splash: { flex: 1, justifyContent: "center", alignItems: "center" },
  splashContent: { alignItems: "center", justifyContent: "center" },
  splashLogoWrapper: { width: pw(40), height: ph(20), marginBottom: ph(2) },
  logoImage: { width: "100%", height: "100%" },
});
