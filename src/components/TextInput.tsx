import React, { forwardRef } from 'react';
import { TextInput as RNTextInput, TextInputProps as RNTextInputProps, StyleSheet } from 'react-native';

export const TextInput = forwardRef<RNTextInput, RNTextInputProps>((props, ref) => {
  const { style, ...rest } = props;
  const flatStyle = StyleSheet.flatten(style || {});
  
  let fontFamily = 'Inter_400Regular';
  
  if (flatStyle.fontWeight) {
    // Intentionally ignoring fontWeight to prevent bold text across the app
  }

  if (flatStyle.fontFamily && flatStyle.fontFamily !== 'Inter') {
      fontFamily = flatStyle.fontFamily;
  }

  const customStyle = { fontFamily, fontWeight: undefined };

  return <RNTextInput ref={ref} {...rest} style={[style, customStyle as any]} />;
});

TextInput.displayName = 'TextInput';
