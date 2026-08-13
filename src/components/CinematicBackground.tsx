import React, { useState, useEffect } from 'react';
import { View, StyleSheet, DeviceEventEmitter } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';

// This file sits two levels down, so the project-root assets folder is `../../`
// from here — not the `../` that screens in app/ use.
import fallbackBackground from '../../assets/images/cinematic-fallback.jpeg';

/**
 * A remote URL, or the module id `require()` returns for a bundled asset —
 * expo-image accepts both forms directly.
 */
export type CinematicSource = string | number | null;

export interface CinematicBackgroundProps {
  /** Remote URL or a `require()`d local image. */
  uri?: CinematicSource;
}

export const CINEMATIC_EVENT = "UPDATE_CINEMATIC_BACKGROUND";


export const CinematicBackground = React.memo(function CinematicBackground({ uri: initialUri }: CinematicBackgroundProps) {
  const [uri, setUri] = useState<CinematicSource | undefined>(initialUri);
  const [customBlur, setCustomBlur] = useState<number | undefined>(undefined);

  useEffect(() => {
    setUri(initialUri);
  }, [initialUri]);

  useEffect(() => {
    let timeoutId: any = null;
    const sub = DeviceEventEmitter.addListener(CINEMATIC_EVENT, (payload: any) => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        if (payload && typeof payload === 'object') {
          setUri(payload.uri);
          setCustomBlur(payload.blurRadius);
        } else {
          setUri(payload);
          setCustomBlur(undefined);
        }
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

      {/* Dynamic blurred image layer. A local asset arrives as a module id, so
          the source is passed straight through rather than wrapped in { uri }. */}
      <Image
        source={uri || fallbackBackground}
        style={StyleSheet.absoluteFillObject}
        contentFit="cover"
        // The fallback is decorative, so it is blurred hard; real artwork keeps
        // whatever blur the caller asked for.
        blurRadius={uri ? (customBlur !== undefined ? customBlur :0) : 20}
        transition={200}
      />

      {/* Heavy Blue/Black Gradient Overlay to match TV image */}
      <LinearGradient
        colors={["rgba(15, 15, 15, 0.45)", "rgba(3, 3, 3, 0.8)", "#000000"]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Left blue glow (matching the TV edges) */}
      <LinearGradient
        colors={["rgba(0, 0, 0, 0.4)", "transparent"]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 0.4, y: 0.5 }}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Right blue glow (matching the TV edges) */}
      <LinearGradient
        colors={["rgba(0, 0, 0, 0.3)", "transparent"]}
        start={{ x: 1, y: 0.5 }}
        end={{ x: 0.6, y: 0.5 }}
        style={StyleSheet.absoluteFillObject}
      />
    </View>
  );
});

// Helper function to update background without re-rendering parent
export const updateCinematicBackground = (uri: CinematicSource, blurRadius?: number) => {
  DeviceEventEmitter.emit(CINEMATIC_EVENT, { uri, blurRadius });
};
