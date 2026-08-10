import React, { useEffect, useState, useRef } from "react";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import {
  StyleSheet,
  AppState,
  AppStateStatus,
  Platform,
  Animated,
  Image as RNImage,
  View,
} from "react-native";
import * as Linking from "expo-linking";
import { LinearGradient } from "expo-linear-gradient";
import { TenorSans_400Regular } from "@expo-google-fonts/tenor-sans";
import { Audio } from "expo-av";

import ErrorBoundary from "../src/components/ErrorBoundary";
import { usePortalStore } from "../src/store/portalStore";
import { ThemeProvider } from "../src/context/ThemeContext";
import { AppBootManager, SYNC_INTERVAL } from "../src/services/AppBootManager";
import { DeepLink } from "../src/services/DeepLink";
import { PlaybackState } from "../src/services/PlaybackState";
import { isTV } from "../src/utils/tvUtils";
import { THEME, ps, ph, pw } from "../src/theme/tokens";
import { safeStorage } from "../src/services/safeStorage";

// Inject CSS for Web to guarantee the font loads exactly as requested
if (Platform.OS === "web" && typeof document !== "undefined" && !document.getElementById("tenor-sans-font")) {
  const style = document.createElement("style");
  style.id = "tenor-sans-font";
  style.textContent = `@import url('https://fonts.googleapis.com/css2?family=Tenor+Sans&display=swap');`;
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
          style={[
            isTV ? styles.splashLogoTVWrapper : styles.splashLogoWrapper,
            { transform: [{ scale: pulseAnim }] }
          ]}
        >
          <RNImage
            source={isTV ? require("../assets/images/TV.png") : require("../assets/images/TV.png")}
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

  // Load premium Google TV fonts
  const [fontsLoaded] = useFonts({
    "Tenor Sans": TenorSans_400Regular,
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

    const bootProcess = DeepLink.capture()
      .catch(() => { })
      .then(() => AppBootManager.initialize());

    Promise.all([bootProcess, soundDelay])
      .then(() => {
        setIsReady(true);
      })
      .catch((e) => {
        console.error("Boot failed:", e);
        setIsReady(true);
      });
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
            <GestureHandlerRootView style={styles.container}>
              <SplashScreen />
            </GestureHandlerRootView>
          </SafeAreaProvider>
        </ThemeProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <SafeAreaProvider>
          <GestureHandlerRootView style={styles.container}>
            <RNImage
              source={{ uri: "https://freerangestock.com/sample/137550/video-streaming--streaming-media--live-streaming.jpg" }}
              style={StyleSheet.absoluteFillObject}
              resizeMode="cover"
              blurRadius={12}

            />
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(8, 8, 10, 0.85)" }]} />
            <View style={{ flex: 1, padding: overscanPadding }}>
              <StatusBar style="light" />
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: "transparent" },
                  animation: isTV ? "none" : "slide_from_right",
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
                <Stack.Screen name="live-tv" />
                <Stack.Screen name="vod" />
                <Stack.Screen name="series" />
                <Stack.Screen name="series-details" />
                <Stack.Screen name="player" options={{ animation: "fade" }} />
                <Stack.Screen name="search" />
                <Stack.Screen name="settings" />
              </Stack>
            </View>
          </GestureHandlerRootView>
        </SafeAreaProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#08080a" },
  splash: { flex: 1, justifyContent: "center", alignItems: "center" },
  splashContent: { alignItems: "center", justifyContent: "center" },
  splashLogoWrapper: { width: pw(30), height: pw(30), marginBottom: ph(3) },
  splashLogoTVWrapper: { width: pw(40), height: ph(20), marginBottom: ph(2) },
  logoImage: { width: "100%", height: "100%" },
  splashTextGroup: { alignItems: "center", marginBottom: ph(2), justifyContent: "flex-end" },
  splashTitle: { color: "#ffffff", fontSize: ps(2.5), fontWeight: "400", letterSpacing: pw(0.8) },
  splashTitleTV: { fontSize: ps(3.5), letterSpacing: pw(1.2) },
  tagline: { color: THEME.colors.primary, fontSize: ps(1), fontWeight: "600", letterSpacing: pw(0.4), marginTop: ph(1), opacity: 0.9 },
  taglineTV: { fontSize: ps(1.4), letterSpacing: pw(0.6), marginTop: ph(1.5) },
  loaderGroup: { alignItems: "center", position: "absolute", bottom: ph(8) },
  splashSubtext: { color: "rgba(255,255,255,0.4)", fontSize: ps(0.8), fontWeight: "400", marginTop: ph(2), letterSpacing: pw(0.1) },
  splashSubtextTV: { fontSize: ps(1), marginTop: ph(2.5) },
});
