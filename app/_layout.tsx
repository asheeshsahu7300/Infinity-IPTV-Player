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
  View,
  Text,
  TextInput,
  BackHandler,
  Platform,
  TVEventHandler,
  Dimensions,
  Animated,
  Image as RNImage,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";

import ErrorBoundary from "../src/components/ErrorBoundary";
import { usePortalStore } from "../src/store/portalStore";
import { ThemeProvider } from "../src/context/ThemeContext";
import { AppBootManager } from "../src/services/AppBootManager";
import { isTV } from "../src/utils/tvUtils";
import { THEME, ps, ph, pw } from "../src/theme/tokens";

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
            source={isTV ? require("../assets/images/TV.png") : require("../assets/images/icon.png")}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </Animated.View>
      </Animated.View>
    </LinearGradient>
  );
}

import { TenorSans_400Regular } from "@expo-google-fonts/tenor-sans";

import { FocusableRegistry } from "../src/tv/FocusableRegistry";

function TVDebugListener() {
  React.useEffect(() => {
    if (Platform.OS !== "android" && Platform.OS !== "ios") return;
    let subscription: any;
    let tvEventHandler: any;

    const handler = (event: any) => {
      const type = event?.eventType;
      const isSelect = type === "select" || type === "dpad_center" || type === "center";
      const isDown = event?.eventKeyAction === 0 || event?.eventKeyAction == null;
      if (isSelect && isDown && event?.tag) {
        FocusableRegistry.press(event.tag);
      }
    };

    if (typeof TVEventHandler === "function") {
      tvEventHandler = new (TVEventHandler as any)();
      tvEventHandler.enable(null, (_cmp: any, event: any) => handler(event));
    } else if (TVEventHandler && typeof (TVEventHandler as any).addListener === "function") {
      subscription = (TVEventHandler as any).addListener(handler);
    }

    return () => {
      if (tvEventHandler && typeof tvEventHandler.disable === "function") tvEventHandler.disable();
      if (subscription && typeof subscription.remove === "function") subscription.remove();
    };
  }, []);

  return null;
}

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);
  const isHydrated = usePortalStore((s) => s.isHydrated);

  // Load premium Google TV fonts
  const [fontsLoaded] = useFonts({
    "Tenor Sans": TenorSans_400Regular,
  });

  // Boot the app via AppBootManager
  useEffect(() => {
    AppBootManager.initialize()
      .then(() => {
        setIsReady(true);
      })
      .catch((e) => {
        console.error("Boot failed:", e);
        setIsReady(true);
      });
  }, []);

  // Handle auto-refresh every 30 minutes
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isHydrated && isReady) {
      interval = setInterval(async () => {
        const portal = usePortalStore.getState().activePortal;
        if (portal) {
          try {
            const { portalApi } = await import("../src/services/portalApi");
            await portalApi.warmPortalData(portal);
            console.log("✅ Auto-refresh complete");
          } catch (e) {
            console.warn("Auto-refresh failed:", e);
          }
        }
      }, 30 * 60 * 1000); // 30 minutes
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isHydrated, isReady]);

  // Handle app resume - refresh token if needed
  useEffect(() => {
    const handleAppStateChange = async (state: AppStateStatus) => {
      if (state === "active" && isHydrated) {
        try {
          const portal = usePortalStore.getState().activePortal;
          if (portal) {
            const { portalApi } = await import("../src/services/portalApi");
            await portalApi.warmPortalData(portal);
          }
        } catch (e) {
          console.warn("Resume refresh failed (non-fatal):", e);
        }
      }
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);
    return () => subscription.remove();
  }, [isHydrated]);

  // Global TV back-button handler for Android TV remote
  useEffect(() => {
    if (!isTV) return;
    const backHandler = BackHandler.addEventListener("hardwareBackPress", () => {
      return false;
    });
    return () => backHandler.remove();
  }, []);

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
            <TVDebugListener />
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: "#08080a" },
                animation: isTV ? "none" : "slide_from_right",
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
              <Stack.Screen name="epg" />
              <Stack.Screen name="favorites" />
              <Stack.Screen name="search" />
              <Stack.Screen name="settings" />
            </Stack>
          </GestureHandlerRootView>
        </SafeAreaProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000000" },
  splash: { flex: 1, justifyContent: "center", alignItems: "center" },
  splashContent: { alignItems: "center", justifyContent: "center" },
  splashLogoWrapper: { width: pw(25), height: pw(25), borderRadius: pw(5), overflow: "hidden", marginBottom: ph(3) },
  splashLogoTVWrapper: { width: pw(35), height: pw(35), borderRadius: pw(4), overflow: "hidden", marginBottom: ph(2) },
  logoImage: { width: "100%", height: "100%", borderRadius: pw(4) },
  splashTextGroup: { alignItems: "center", marginBottom: ph(2), justifyContent: "flex-end" },
  splashTitle: { color: "#ffffff", fontSize: ps(2.5), fontWeight: "400", letterSpacing: pw(0.8) },
  splashTitleTV: { fontSize: ps(3.5), letterSpacing: pw(1.2) },
  tagline: { color: THEME.colors.primary, fontSize: ps(1), fontWeight: "600", letterSpacing: pw(0.4), marginTop: ph(1), opacity: 0.9 },
  taglineTV: { fontSize: ps(1.4), letterSpacing: pw(0.6), marginTop: ph(1.5) },
  loaderGroup: { alignItems: "center", position: "absolute", bottom: ph(8) },
  splashSubtext: { color: "rgba(255,255,255,0.4)", fontSize: ps(0.8), fontWeight: "400", marginTop: ph(2), letterSpacing: pw(0.1) },
  splashSubtextTV: { fontSize: ps(1), marginTop: ph(2.5) },
});
