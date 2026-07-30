import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from "react-native";

import { FocusMemory } from "./FocusMemory";
import { useIsFocusTrapped, InsideOverlayContext, NextFocusTags } from "./FocusTrapContext";
import { useDPad, DPAD_PRIORITY } from "./useDPad";

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

  /** Enables focus memory for this item. Both keys are required. */
  screenKey?: string;
  focusKey?: string;

  /** Spoken by the screen reader. Always set this on icon-only controls. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: "button" | "link" | "menuitem" | "tab" | "checkbox" | "radio" | "switch" | "imagebutton";
  /** Reflected into `accessibilityState.selected`. */
  selected?: boolean;

  testID?: string;
}

let globalLastPressTime = 0;

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
      accessibilityLabel,
      accessibilityHint,
      accessibilityRole = "button",
      selected,
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

      FocusMemory.register(screenKey, focusKey, nativeRef);

      return () => {
        FocusMemory.unregister(screenKey, focusKey);
      };
    }, [screenKey, focusKey]);

    // Auto-focus on mount if this item hasTVPreferredFocus and is active
    React.useEffect(() => {
      if (hasTVPreferredFocus && !isDisabled) {
        focusTimeRef.current = Date.now();
        const timer = setTimeout(() => {
          nativeRef.current?.focus?.();
        }, 50);
        return () => clearTimeout(timer);
      }
    }, [hasTVPreferredFocus, isDisabled]);

    const isInsideOverlay = Boolean(overlayController);
    const lastPressTimeRef = useRef(0);
    const focusTimeRef = useRef(0);

    const handleFocus = useCallback(() => {
      setFocused(true);
      focusTimeRef.current = Date.now();
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
      if (isDisabled) return;
      const now = Date.now();
      // Global press lock: ignore any press across all components if another press occurred within 350ms
      if (now - globalLastPressTime < 350) return;
      // Block accidental press bleed-through when focus was acquired very recently (< 250ms)
      // (e.g. when category or search selection auto-focuses the first grid item)
      if (now - focusTimeRef.current < 250) return;
      if (now - lastPressTimeRef.current < 200) return;
      globalLastPressTime = now;
      lastPressTimeRef.current = now;
      onPress?.();
    }, [onPress, isDisabled]);

    useDPad(
      {
        onSelect: handlePress,
      },
      {
        enabled: focused && !isDisabled && Boolean(onPress),
        priority: isInsideOverlay ? DPAD_PRIORITY.OVERLAY + 10 : DPAD_PRIORITY.SCREEN,
      }
    );

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
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: isDisabled, selected }}
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
          // Reserve the ring's border box up front so gaining focus recolours
          // it instead of resizing the element and reflowing the row.
          ringOnFocus && styles.ringReserved,
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
  ringReserved: {
    borderWidth: 3,
    borderColor: "transparent",
  },

  focused: {
    borderColor: "#fff",
  },

  pressed: {
    opacity: 0.7,
  },
});

export default Focusable;
