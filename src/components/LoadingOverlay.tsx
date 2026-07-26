import React from 'react';
import { View, ActivityIndicator, Text, StyleSheet, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { THEME, ps, ph, pw } from '../theme/tokens';
import { LinearGradient } from 'expo-linear-gradient';
import GradientLoader from './GradientLoader';

interface LoadingOverlayProps {
  message?: string;
  pointerEvents?: 'box-none' | 'none' | 'box-only' | 'auto';
  style?: ViewStyle;
}

export default function LoadingOverlay({
  message = 'Loading...',
  pointerEvents,
  style
}: LoadingOverlayProps) {
  return (
    <View style={[styles.container, style]} pointerEvents={pointerEvents}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.4)' }]} />
      <LinearGradient
        colors={['rgba(255,255,255,0.05)', 'rgba(255,255,255,0.02)']}
        style={styles.box}
      >
        <GradientLoader size={40} ringWidth={4} />
        {message && <Text style={styles.text}>{message}</Text>}
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  box: {
    padding: ps(2),
    borderRadius: 24,
    minWidth: ps(12),
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  text: {
    color: '#fff',
    fontSize: ps(1),
    fontWeight: '700',
    marginTop: ph(2),
    opacity: 0.8,
    letterSpacing: 0.5,
  },
});
