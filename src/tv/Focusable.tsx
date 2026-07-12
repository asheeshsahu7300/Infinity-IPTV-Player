import React, { useCallback, useRef, useState } from "react";
import {
  StyleProp,
  StyleSheet,
  TouchableOpacity,
  TVEventHandler,
  View,
  ViewStyle,
} from "react-native";

export interface FocusableProps {
  children?: React.ReactNode | ((focused: boolean) => React.ReactNode);
  onPress?: () => void;
  onLongPress?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  hasTVPreferredFocus?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  focusStyle?: StyleProp<ViewStyle>;
  /** Kept for API compatibility; no longer used. */
  scaleOnFocus?: number;
  ringOnFocus?: boolean;
  testID?: string;
  nextFocusUp?: number;
  nextFocusDown?: number;
  nextFocusLeft?: number;
  nextFocusRight?: number;
}

const SELECT_DEDUPE_MS = 250;

/**
 * The single canonical focusable for the app.
 *
 * Why both `onPress` AND a TV `select` listener?
 *
 * Android docs: "Select button: Selects the on-screen item with focus." On
 * rn-tvos, the path that should deliver this — Pressability's `onClick` on
 * the underlying View when DPAD_CENTER fires `performClick()` — is gated by
 * a filter (`Pressability.js`: drops clicks on Android TV when
 * `event.eventType` is null) that can swallow the OK press depending on how
 * the device's focus engine emits the synthetic click. When that happens,
 * `onPress` never fires, even though the view is correctly focusable.
 *
 * To match the documented Android TV behavior reliably, we ALSO listen for
 * the `select` TV event while this Focusable holds focus. A small dedupe
 * window prevents double-fire when both paths happen to deliver.
 *
 *  - Native focus engine drives navigation (the focused TouchableOpacity).
 *  - `onPress` fires from Pressability when the click event isn't filtered.
 *  - `select` from `useTVEventHandler` fires when this view is focused.
 *  - Whichever arrives first wins; the second is dropped within
 *    `SELECT_DEDUPE_MS`.
 */
export const Focusable = React.forwardRef<View, FocusableProps>(function Focusable(
  {
    children,
    onPress,
    onLongPress,
    onFocus,
    onBlur,
    hasTVPreferredFocus = false,
    disabled = false,
    style,
    focusStyle,
    ringOnFocus = true,
    testID,
    nextFocusUp,
    nextFocusDown,
    nextFocusLeft,
    nextFocusRight,
  },
  ref
) {
  const [focused, setFocused] = useState(false);
  const focusedRef = useRef(false);
  const lastFireRef = useRef(0);

  const fire = useCallback(() => {
    if (disabled || !onPress) return;
    const now = Date.now();
    if (now - lastFireRef.current < SELECT_DEDUPE_MS) return;
    lastFireRef.current = now;
    onPress();
  }, [disabled, onPress]);

  const handleFocus = useCallback(() => {
    focusedRef.current = true;
    setFocused(true);
    onFocus?.();
  }, [onFocus]);

  const handleBlur = useCallback(() => {
    focusedRef.current = false;
    setFocused(false);
    onBlur?.();
  }, [onBlur]);

  // Fallback path: the native focus engine sends `select` here when this
  // view holds focus. We only subscribe to TV events when the view is actually
  // focused to avoid performance issues (e.g. 50 listeners for 50 Focusables).
  React.useEffect(() => {
    if (!focused) return;

    const tvEventHandler = new TVEventHandler();
    tvEventHandler.enable(undefined, (_cmp: any, evt: any) => {
      const type = evt?.eventType;
      if (type !== "select" && type !== "dpad_center" && type !== "center") return;
      const action = evt?.eventKeyAction;
      if (action != null && action !== 0 && action !== "0" && action !== "down") return;
      fire();
    });

    return () => {
      tvEventHandler.disable();
    };
  }, [focused, fire]);

  const child = typeof children === "function" ? children(focused) : children;

  return (
    <TouchableOpacity
      ref={ref as any}
      testID={testID}
      activeOpacity={1}
      accessible
      accessibilityRole="button"
      focusable={!disabled}
      {...({ isTVSelectable: !disabled } as any)}
      tvParallaxProperties={{ enabled: false }}
      hasTVPreferredFocus={hasTVPreferredFocus}
      nextFocusUp={nextFocusUp}
      nextFocusDown={nextFocusDown}
      nextFocusLeft={nextFocusLeft}
      nextFocusRight={nextFocusRight}
      onPress={disabled ? undefined : fire}
      onLongPress={disabled ? undefined : onLongPress}
      onFocus={handleFocus}
      onBlur={handleBlur}
      style={[
        style,
        focused && ringOnFocus && styles.ring,
        focused && focusStyle,
      ]}
    >
      {child}
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  ring: {
    borderWidth: 3,
    borderColor: "#ffffff",
  },
});

export default Focusable;
