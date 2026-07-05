import React from "react";
import { View, ActivityIndicator } from "react-native";
import { THEME } from "../theme/tokens";

interface GradientLoaderProps {
  size?: number;
  ringWidth?: number; // Kept for prop compatibility, though ActivityIndicator handles its own thickness
}

export default function GradientLoader({
  size = 40,
}: GradientLoaderProps) {
  return (
    <View style={{ width: size, height: size, justifyContent: "center", alignItems: "center" }}>
      <ActivityIndicator 
        size={size} 
        color={THEME.colors.primary} 
      />
    </View>
  );
}
