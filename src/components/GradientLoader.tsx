import React, { useRef, useEffect } from "react";
import { View, Animated, Easing, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import { THEME, ps } from "../theme/tokens";

interface GradientLoaderProps {
  size?: number;
  ringWidth?: number;
}

export default function GradientLoader({
  size = 40,
  ringWidth = 4,
}: GradientLoaderProps) {
  const spinValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
  }, []);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <View style={{ width: size, height: size }}>
      <MaskedView
        style={StyleSheet.absoluteFill}
        maskElement={
          <View style={styles.maskContainer}>
            <View
              style={[
                styles.maskRing,
                {
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  borderWidth: ringWidth,
                },
              ]}
            />
          </View>
        }
      >
        <Animated.View
          style={[StyleSheet.absoluteFill, { transform: [{ rotate: spin }] }]}
        >
          <LinearGradient
            colors={[THEME.colors.secondary, THEME.colors.primary, "transparent"]}
            start={{ x: 0, y: 1 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </MaskedView>
    </View>
  );
}

const styles = StyleSheet.create({
  maskContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  maskRing: {
    borderColor: "white",
  },
});
