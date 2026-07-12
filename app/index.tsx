import React from "react";
import { View, StyleSheet } from "react-native";
import { Redirect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePortalStore } from "../src/store/portalStore";
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

  // Once hydrated, natively redirect to the correct screen
  if (activePortal) {
    return <Redirect href="/dashboard" />;
  } else {
    return <Redirect href="/portals" />;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
});
