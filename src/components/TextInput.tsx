import React, { forwardRef, useEffect, useId, useImperativeHandle, useRef } from 'react';
import {
  TextInput as RNTextInput,
  TextInputProps as RNTextInputProps,
  StyleSheet,
  Platform,
} from 'react-native';
import { WebSpatialNavigation } from '../tv/webSpatialNavigation';
import { useIsFocusTrapped, InsideOverlayContext } from '../tv/FocusTrapContext';

export interface TextInputCustomProps extends Omit<RNTextInputProps, 'nextFocusUp' | 'nextFocusDown' | 'nextFocusLeft' | 'nextFocusRight'> {
  /** Optional next focus overrides for TV spatial navigation */
  nextFocusUp?: number | string | null;
  nextFocusDown?: number | string | null;
  nextFocusLeft?: number | string | null;
  nextFocusRight?: number | string | null;
}

export const TextInput = forwardRef<RNTextInput, TextInputCustomProps>((props, ref) => {
  const {
    style,
    onFocus,
    onBlur,
    nextFocusUp,
    nextFocusDown,
    nextFocusLeft,
    nextFocusRight,
    ...rest
  } = props;
  const flatStyle = StyleSheet.flatten(style || {});
  const localRef = useRef<any>(null);
  const reactId = useId();
  const inputId = useRef(`textinput-${reactId}`);

  // Forward imperative ref
  useImperativeHandle(ref, () => localRef.current);

  const isFocusTrapped = useIsFocusTrapped();
  const overlayController = React.useContext(InsideOverlayContext);
  const isInert = isFocusTrapped && !overlayController;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = localRef.current;
    if (!el) return;

    const domNode =
      el instanceof HTMLElement
        ? el
        : el.getDOMNode?.() || (typeof el.focus === 'function' ? el : null);

    if (domNode && domNode instanceof HTMLElement) {
      domNode.setAttribute('data-focusable', 'true');
      return WebSpatialNavigation.register({
        id: inputId.current,
        element: domNode,
        nextFocusUp: nextFocusUp ?? undefined,
        nextFocusDown: nextFocusDown ?? undefined,
        nextFocusLeft: nextFocusLeft ?? undefined,
        nextFocusRight: nextFocusRight ?? undefined,
        isInert,
      });
    }
  }, [isInert, nextFocusUp, nextFocusDown, nextFocusLeft, nextFocusRight]);

  let fontFamily = 'Inter_400Regular';

  if (flatStyle.fontFamily && flatStyle.fontFamily !== 'Inter') {
    fontFamily = flatStyle.fontFamily;
  }

  const customStyle: any = { fontFamily, fontWeight: undefined };
  if (Platform.OS === 'web') {
    customStyle.outlineStyle = 'none';
  }

  return (
    <RNTextInput
      ref={localRef}
      {...rest}
      onFocus={(e) => {
        if (Platform.OS === 'web') {
          WebSpatialNavigation.setActive(inputId.current);
        }
        onFocus?.(e);
      }}
      onBlur={onBlur}
      style={[style, customStyle]}
    />
  );
});

TextInput.displayName = 'TextInput';
