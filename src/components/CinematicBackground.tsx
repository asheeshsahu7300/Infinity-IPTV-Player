import React, { useState, useEffect } from 'react';
import { View, StyleSheet, DeviceEventEmitter } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';

export interface CinematicBackgroundProps {
  uri?: string | null;
}

export const CINEMATIC_EVENT = "UPDATE_CINEMATIC_BACKGROUND";

export const CinematicBackground = React.memo(function CinematicBackground({ uri: initialUri }: CinematicBackgroundProps) {
  const [uri, setUri] = useState(initialUri);

  useEffect(() => {
    setUri(initialUri);
  }, [initialUri]);

  useEffect(() => {
    let timeoutId: any = null;
    const sub = DeviceEventEmitter.addListener(CINEMATIC_EVENT, (newUri: string | null) => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setUri(newUri);
      }, 250);
    });
    return () => {
      sub.remove();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {/* Base Dark background - removed to show global cinematic background */}
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'transparent' }]} />
      
      {/* Dynamic blurred image layer */}
      <Image
        source={{ uri: uri || "https://freerangestock.com/sample/137550/video-streaming--streaming-media--live-streaming.jpg" }}
        style={StyleSheet.absoluteFillObject}
        contentFit="cover"
        blurRadius={uri ? 12 : 60}
        transition={200}
      />
      
      {/* Dark tint for text readability.
          One layer, and it never reaches full opacity. This used to be two
          stacked full-screen gradients that both ended at solid #08080a, and
          they compounded: (1-a1)(1-a2) left the artwork 11% visible at half
          height, 4% at 70%, and 0% below that. The image was technically
          full-bleed but looked like it stopped two-thirds of the way down.
          Ending at 0.78 keeps it faintly present all the way to the bottom
          edge while still darkening enough to read text over. */}
      <LinearGradient
        colors={["rgba(8,8,10,0.45)", "rgba(8,8,10,0.78)"]}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Top-Right Glow */}
      <LinearGradient
        colors={["#2a0845", "transparent"]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0.5, y: 0.5 }}
        style={{ position: "absolute", top: 0, right: 0, width: "100%", height: "100%", opacity: 0.3 }}
      />
      
      {/* Bottom-Left Glow */}
      <LinearGradient
        colors={["#6441a5", "transparent"]}
        start={{ x: 0, y: 1 }}
        end={{ x: 0.3, y: 0.7 }}
        style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: "100%", opacity: 0.15 }}
      />
    </View>
  );
});

// Helper function to update background without re-rendering parent
export const updateCinematicBackground = (uri: string | null) => {
  DeviceEventEmitter.emit(CINEMATIC_EVENT, uri);
};
