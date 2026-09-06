import React from 'react';
import { Text as RNText, TextProps as RNTextProps, StyleSheet } from 'react-native';

export function Text(props: RNTextProps) {
  const { style, ...rest } = props;
  const flatStyle = StyleSheet.flatten(style || {});
  
  let fontFamily = 'Inter_400Regular';
  
  if (flatStyle.fontWeight) {
    // Intentionally ignoring fontWeight to prevent bold text across the app
  }

  // If a specific fontFamily is already passed (like monospace), respect it
  if (flatStyle.fontFamily && flatStyle.fontFamily !== 'Inter') {
      fontFamily = flatStyle.fontFamily;
  }

  // We explicitly remove fontWeight so Android doesn't try to synthesize bold on top of the bold font
  const customStyle = { fontFamily, fontWeight: undefined };

  return <RNText {...rest} style={[style, customStyle as any]} />;
}
