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
      }, 100);
    });
    return () => {
      sub.remove();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {/* Base Dark background */}
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#08080a' }]} />
      
      {/* Dynamic blurred image layer */}
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
          blurRadius={20}
          transition={300}
        />
      ) : null}
      
      {/* Dark tint gradient overlay for text readability */}
      <LinearGradient
        colors={["rgba(8,8,10,0.55)", "#08080a"]}
        style={StyleSheet.absoluteFillObject}
      />
      
      <LinearGradient
        colors={["transparent", "#08080a"]}
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
