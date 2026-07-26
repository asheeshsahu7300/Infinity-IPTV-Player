import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  findNodeHandle,
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from "react-native";

import { FocusableRegistry } from "./FocusableRegistry";
import { FocusMemory } from "./FocusMemory";
import { useIsFocusTrapped, InsideOverlayContext, NextFocusTags } from "./FocusTrapContext";

export interface FocusableProps {
  children?: React.ReactNode | ((focused: boolean) => React.ReactNode);

  onPress?: () => void;
  onLongPress?: () => void;

  onFocus?: () => void;
  onBlur?: () => void;

  disabled?: boolean;

  style?: StyleProp<ViewStyle>;
  focusStyle?: StyleProp<ViewStyle>;
  ringOnFocus?: boolean;

  hasTVPreferredFocus?: boolean;

  nextFocusUp?: number;
  nextFocusDown?: number;
  nextFocusLeft?: number;
  nextFocusRight?: number;

  screenKey?: string;
  focusKey?: string;

  testID?: string;
}

export const lastFocusedRef: React.MutableRefObject<View | null> = { current: null };

export const Focusable = forwardRef<View, FocusableProps>(
  function Focusable(
    {
      children,
      onPress,
      onLongPress,
      onFocus,
      onBlur,
      disabled = false,
      style,
      focusStyle,
      ringOnFocus = true,
      hasTVPreferredFocus = false,
      nextFocusUp,
      nextFocusDown,
      nextFocusLeft,
      nextFocusRight,
      screenKey,
      focusKey,
      testID,
    },
    forwardedRef
  ) {
    const nativeRef = useRef<View>(null);
    const [focused, setFocused] = useState(false);
    const isFocusTrapped = useIsFocusTrapped();
    const isDisabled = disabled || isFocusTrapped;

    // Overlay focus controller for locking navigation inside modal
    const overlayController = React.useContext(InsideOverlayContext);
    const idRef = useRef(`focusable-${Math.random().toString(36).substring(2, 9)}`);
    const [overlayNextFocus, setOverlayNextFocus] = useState<NextFocusTags>({});

    useImperativeHandle(
      forwardedRef,
      () => nativeRef.current as View,
      []
    );

    // Register with overlay focus controller if inside an overlay
    React.useEffect(() => {
      if (!overlayController) return;
      return overlayController.registerItem(idRef.current, nativeRef as React.RefObject<View>);
    }, [overlayController]);

    // Subscribe to overlay controller updates to recalculate nextFocus tags
    React.useEffect(() => {
      if (!overlayController) return;
      const updateTags = () => {
        const tags = overlayController.getNextFocus(idRef.current);
        setOverlayNextFocus(tags);
      };
      updateTags();
      return overlayController.subscribe(updateTags);
    }, [overlayController]);

    React.useEffect(() => {
      if (!screenKey || !focusKey) return;

      FocusMemory.register?.(
        screenKey,
        focusKey,
        nativeRef
      );

      return () => {
        FocusMemory.unregister?.(
          screenKey,
          focusKey
        );
      };
    }, [screenKey, focusKey]);

    // Auto-focus on mount if this item hasTVPreferredFocus and is active
    React.useEffect(() => {
      if (hasTVPreferredFocus && !isDisabled) {
        const timer = setTimeout(() => {
          nativeRef.current?.focus?.();
        }, 50);
        return () => clearTimeout(timer);
      }
    }, [hasTVPreferredFocus, isDisabled]);

    const handleFocus = useCallback(() => {
      setFocused(true);
      lastFocusedRef.current = nativeRef.current;

      if (screenKey && focusKey) {
        FocusMemory.set(screenKey, focusKey);
      }

      onFocus?.();
    }, [screenKey, focusKey, onFocus]);

    const handleBlur = useCallback(() => {
      setFocused(false);
      onBlur?.();
    }, [onBlur]);

    const handlePress = useCallback(() => {
      onPress?.();
    }, [onPress]);

    React.useEffect(() => {
      if (!focused || disabled || !onPress) return;
      const tag = findNodeHandle(nativeRef.current);
      if (!tag) return;
      FocusableRegistry.register(tag, handlePress);
      return () => {
        FocusableRegistry.unregister(tag);
      };
    }, [focused, disabled, onPress, handlePress]);

    const content =
      typeof children === "function"
        ? children(focused)
        : children;

    // Effective next focus props: explicit props take precedence over overlay auto-tags
    const effUp = nextFocusUp ?? overlayNextFocus.nextFocusUp;
    const effDown = nextFocusDown ?? overlayNextFocus.nextFocusDown;
    const effLeft = nextFocusLeft ?? overlayNextFocus.nextFocusLeft;
    const effRight = nextFocusRight ?? overlayNextFocus.nextFocusRight;

    return (
      <Pressable
        ref={nativeRef}
        testID={testID}
        disabled={isDisabled}
        focusable={!isDisabled}
        accessible
        accessibilityRole="button"
        hasTVPreferredFocus={!isFocusTrapped && hasTVPreferredFocus}
        nextFocusUp={effUp}
        nextFocusDown={effDown}
        nextFocusLeft={effLeft}
        nextFocusRight={effRight}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onPress={isDisabled ? undefined : handlePress}
        onLongPress={onLongPress}
        style={({ pressed }) => [
          style,
          focused && ringOnFocus && styles.focused,
          focused && focusStyle,
          pressed && styles.pressed,
        ]}
      >
        {content}
      </Pressable>
    );
  }
);

const styles = StyleSheet.create({
  focused: {
    borderWidth: 3,
    borderColor: "#fff",
  },

  pressed: {
    opacity: 0.7,
  },
});

export default Focusable;
