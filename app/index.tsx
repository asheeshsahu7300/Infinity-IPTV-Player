import React, { useEffect, useRef } from "react";
import { View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePortalStore } from "../src/store/portalStore";
import { DeepLink } from "../src/services/DeepLink";
import LoadingOverlay from "../src/components/LoadingOverlay";
import { AppBootManager } from "../src/services/AppBootManager";

export default function IndexScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const activePortal = usePortalStore((s) => s.activePortal);
  const isHydrated = usePortalStore((s) => s.isHydrated);
  const redirectedRef = useRef(false);

  useEffect(() => {
    AppBootManager.initialize();
  }, []);

  useEffect(() => {
    if (!isHydrated || redirectedRef.current) return;
    redirectedRef.current = true;

    if (activePortal && DeepLink.hasPending) {
      const target = DeepLink.consume();
      if (target) {
        router.replace({ pathname: target.pathname as any, params: target.params });
        return;
      }
    }

    if (activePortal) {
      router.replace("/dashboard");
    } else {
      router.replace("/portals");
    }
  }, [isHydrated, activePortal, router]);

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
    backgroundColor: "transparent",
  },
});
