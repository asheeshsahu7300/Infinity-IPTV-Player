import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';

import * as P from '../theme/palette';
import { RADIUS } from '../theme/materials';
import { ph, ps, THEME } from '../theme/tokens';
import GradientLoader from './GradientLoader';
import { GlassSurface } from './GlassSurface';
import { Text } from './Text';

/**
 * The blocking loading overlay.
 *
 * A `thick` glass panel over a scrim, which is how Apple presents a modal
 * progress indicator: the screen behind recedes but stays visible, so the
 * viewer keeps their place rather than being dropped onto a black screen and
 * returned to a different one.
 *
 * It used to be a `LinearGradient` box doing an impression of the same thing —
 * a two-stop white wash plus a border, with no blur, no sheen falloff and a
 * `BlurView` imported but never rendered.
 */

interface LoadingOverlayProps {
  message?: string;
  pointerEvents?: 'box-none' | 'none' | 'box-only' | 'auto';
  style?: ViewStyle;
}

export default function LoadingOverlay({
  message = 'Loading…',
  pointerEvents,
  style
}: LoadingOverlayProps) {
  return (
    <View
      style={[styles.container, style]}
      pointerEvents={pointerEvents}
      accessibilityRole="progressbar"
      accessibilityLabel={message}
    >
      <GlassSurface material="thick" radius={RADIUS.sheet} shadow="sheet" style={styles.box}>
        <GradientLoader size={40} ringWidth={4} />
        {message ? <Text style={styles.text}>{message}</Text> : null}
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: P.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  box: {
    padding: ps(2),
    minWidth: ps(12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: P.secondaryLabel,
    fontSize: ps(1),
    fontFamily: THEME.fonts.medium,
    marginTop: ph(2),
    letterSpacing: 0.2,
  },
});
