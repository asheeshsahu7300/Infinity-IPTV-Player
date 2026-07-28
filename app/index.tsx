import React from "react";
import { View, StyleSheet } from "react-native";
import { Redirect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePortalStore } from "../src/store/portalStore";
import { DeepLink } from "../src/services/DeepLink";
import LoadingOverlay from "../src/components/LoadingOverlay";

export default function IndexScreen() {
  const insets = useSafeAreaInsets();

  // Use hydrated store state directly - AppBootManager already restored everything
  const activePortal = usePortalStore((s) => s.activePortal);
  const isHydrated = usePortalStore((s) => s.isHydrated);

  // Show loading while AppBootManager is hydrating the store
  if (!isHydrated) {
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

  // A link the app was launched with wins over the default landing screen —
  // but only once we have a portal, otherwise there is nothing to resolve it
  // against. Held links survive onboarding and replay on the next pass.
  if (activePortal && DeepLink.hasPending) {
    const target = DeepLink.consume();
    if (target) {
      return <Redirect href={{ pathname: target.pathname as any, params: target.params }} />;
    }
  }

  if (activePortal) {
    return <Redirect href="/dashboard" />;
  }

  return <Redirect href="/portals" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
});
