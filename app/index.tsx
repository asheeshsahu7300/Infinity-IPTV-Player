import React, { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import { useRouter, useRootNavigationState } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePortalStore } from "../src/store/portalStore";
import LoadingOverlay from "../src/components/LoadingOverlay";

export default function IndexScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const navigationState = useRootNavigationState();
  
  // Use hydrated store state directly - AppBootManager already restored everything
  const activePortal = usePortalStore((s) => s.activePortal);
  const isHydrated = usePortalStore((s) => s.isHydrated);

  useEffect(() => {
    // Wait for navigation to be ready AND store to be hydrated
    if (!navigationState?.key || !isHydrated) return;

    // Navigate based on hydrated state - no async calls needed
    if (activePortal) {
      router.replace("/dashboard");
    } else {
      router.replace("/portals");
    }
  }, [navigationState?.key, isHydrated, activePortal]);

  // Show loading while initializing
  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top,
          justifyContent: "center",
          alignItems: "center",
        },
      ]}
    >
      <LoadingOverlay message="Loading..." />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
});
