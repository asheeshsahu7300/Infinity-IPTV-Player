import { DynamicIcon } from './DynamicIcon';
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import * as P from '../theme/palette';
import { RADIUS } from '../theme/materials';
import { phoneDp, THEME } from '../theme/tokens';
import { GlassBar } from './GlassSurface';
import { Text } from './Text';

/**
 * The shared navigation bar.
 *
 * Now a `chrome` material rather than the opaque `#111827` slab it was — that
 * colour and its `#2a2a4a` rule were the last two values in the app from a
 * palette nothing else used, and a solid bar over a cinematic backdrop was the
 * one piece of chrome that visibly cut the screen in half.
 *
 * `chrome` and not `regular` because this bar is pinned over content that
 * scrolls beneath it: it has to stay legible with arbitrary artwork passing
 * under, which is exactly the distinction the thicker material exists for.
 */

interface HeaderProps {
  title: string;
  showBack?: boolean;
  rightAction?: {
    icon: string;
    onPress: () => void;
  };
}

export default function Header({ title, showBack = false, rightAction }: HeaderProps) {
  const insets = useSafeAreaInsets();

  return (
    <GlassBar edge="bottom" style={{ paddingTop: insets.top }}>
      <View style={styles.content}>
        <View style={styles.placeholder} />

        <Text style={styles.title} numberOfLines={1}>{title}</Text>

        {rightAction ? (
          <TouchableOpacity
            onPress={rightAction.onPress}
            style={styles.rightButton}
            accessibilityRole="button"
          >
            <DynamicIcon name={rightAction.icon} size={phoneDp(24)} color={P.label} />
          </TouchableOpacity>
        ) : (
          <View style={styles.placeholder} />
        )}
      </View>
    </GlassBar>
  );
}

const styles = StyleSheet.create({
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  backButton: {
    padding: 8,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontFamily: THEME.fonts.semibold,
    color: P.label,
    textAlign: 'center',
    // Apple sets navigation titles tight. At this size the default tracking
    // reads loose against the tighter body copy elsewhere in the app.
    letterSpacing: -0.4,
  },
  rightButton: {
    padding: 8,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.full,
  },
  placeholder: {
    width: 44,
    height: 44,
  },
});
