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
  ActivityIndicator,
  Text,
  TextInput,
  BackHandler,
  Platform,
  Dimensions,
  Animated,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";

import ErrorBoundary from "../src/components/ErrorBoundary";
import GradientLoader from "../src/components/GradientLoader";
import { usePortalStore } from "../src/store/portalStore";
import { ThemeProvider } from "../src/context/ThemeContext";
import { AppBootManager } from "../src/services/AppBootManager";
import { isTV } from "../src/utils/tvUtils";
import { CinematicBackground } from "../src/components/CinematicBackground";
import { THEME, ps, ph, pw , fw } from '../src/theme/tokens';

// ─────────────────────────────────────────────────────────────────────────────
// Google TV Typography Monkey-Patch (Global Font Family Enforcer)
// ─────────────────────────────────────────────────────────────────────────────
// This overrides the default Text rendering behavior across all React Native views,
// dynamically mapping styles to correct weight variants of "Google Sans".
// This ensures 100% typography consistency in all pages, third-party libraries,
// and default system controls.
// ─────────────────────────────────────────────────────────────────────────────
// @ts-ignore
const oldTextRender = Text.render;
if (oldTextRender) {
  // @ts-ignore
  Text.render = function (...args) {
    const origin = oldTextRender.apply(this, args);
    const customStyle = origin.props.style;

    let fontFamily = "GoogleSans-Regular";
    if (customStyle) {
      const flattened = StyleSheet.flatten(customStyle);
      if (flattened && flattened.fontWeight) {
        const fw = flattened.fontWeight.toString();
        if (fw === "bold" || fw === "700" || fw === "800" || fw === "900") {
          fontFamily = "GoogleSans-Bold";
        } else if (fw === "500" || fw === "600" || fw === "medium") {
          fontFamily = "GoogleSans-Medium";
        }
      }
    }

    return React.cloneElement(origin, {
      style: [{ fontFamily }, customStyle],
    });
  };
}

// Ensure TextInput also defaults to the regular Google Sans variant
// @ts-ignore
if (TextInput.defaultProps == null) {
  // @ts-ignore
  TextInput.defaultProps = {};
}
// @ts-ignore
TextInput.defaultProps.style = { fontFamily: "GoogleSans-Regular" };

// Modern Cinematic Splash Screen Component
function SplashScreen() {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Fade in
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 800,
      useNativeDriver: true,
    }).start();

    // Pulse loop
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.06, duration: 2000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <View style={styles.splash}>
      <CinematicBackground />
      <LinearGradient
        colors={["rgba(0,0,0,0.4)", "rgba(0, 0, 0, 1)"]}
        style={StyleSheet.absoluteFill}
      />

      <Animated.View style={[styles.splashContent, { opacity: fadeAnim }]}>
        <Animated.View
          style={[
            isTV ? styles.splashLogoTVWrapper : styles.splashLogoWrapper,
            { transform: [{ scale: pulseAnim }] },
          ]}
        >

          <Image
            source={require("../assets/images/icon.png")}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </Animated.View>

        <View style={styles.splashTextGroup}>
          <Text style={[styles.splashTitle, isTV && styles.splashTitleTV]}>
            IPTV HUB
          </Text>
          <Text style={[styles.tagline, isTV && styles.taglineTV]}>
            PREMIUM STREAMING EXPERIENCE
          </Text>
        </View>
      </Animated.View>


    </View>
  );
}

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);
  const isHydrated = usePortalStore((s) => s.isHydrated);

  // Load premium Google TV fonts
  const [fontsLoaded] = useFonts({
    "GoogleSans-Regular": require("../assets/fonts/GoogleSans-Regular.ttf"),
    "GoogleSans-Medium": require("../assets/fonts/GoogleSans-Medium.ttf"),
    "GoogleSans-Bold": require("../assets/fonts/GoogleSans-Bold.ttf"),
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
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: "#000000" },
                animation: isTV ? "fade" : "slide_from_right",
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
  splash: { flex: 1, backgroundColor: "#000000", justifyContent: "center", alignItems: "center" },
  splashContent: { alignItems: "center", justifyContent: "center" },
  splashLogoWrapper: { width: pw(18), height: pw(18), borderRadius: pw(4), overflow: "hidden", marginBottom: ph(4) },
  splashLogoTVWrapper: { width: pw(12), height: pw(12), borderRadius: pw(3), overflow: "hidden", marginBottom: ph(5) },
  logoImage: { width: "120%", height: "120%", borderRadius: pw(3) },
  splashTextGroup: { alignItems: "center", marginBottom: ph(2), justifyContent: "flex-end" },
  splashTitle: { color: "#ffffff", fontSize: ps(1.6), fontWeight: fw("500"), letterSpacing: pw(0.2) },
  splashTitleTV: { fontSize: ps(2.2), letterSpacing: pw(0.5) },
  tagline: { color: THEME.colors.primary, fontSize: ps(0.7), fontWeight: fw("800"), letterSpacing: pw(0.3), marginTop: ph(1), opacity: 0.8 },
  taglineTV: { fontSize: ps(1), letterSpacing: pw(0.5), marginTop: ph(1.5) },
  loaderGroup: { alignItems: "center", position: "absolute", bottom: ph(8) },
  splashSubtext: { color: "rgba(255,255,255,0.4)", fontSize: ps(0.8), fontWeight: fw("400"), marginTop: ph(2), letterSpacing: pw(0.1) },
  splashSubtextTV: { fontSize: ps(1), marginTop: ph(2.5) },
});
