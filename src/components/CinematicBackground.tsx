import React, { useState, useEffect } from 'react';
import { View, StyleSheet, DeviceEventEmitter } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';

// This file sits two levels down, so the project-root assets folder is `../../`
// from here — not the `../` that screens in app/ use.
import fallbackBackground from '../../assets/images/cinematic-fallback.png';

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


export const CinematicBackground = React.memo(function CinematicBackground({ uri: _uri }: CinematicBackgroundProps = {}) {
  return (
    <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#000000' }]} pointerEvents="none" />
  );
});

// Helper function retained for API compatibility
export const updateCinematicBackground = (_uri?: CinematicSource, _blurRadius?: number) => {};
