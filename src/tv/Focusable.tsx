import React, { useCallback, useImperativeHandle, useRef, useState } from "react";
import {
  StyleProp,
  StyleSheet,
  TouchableOpacity,
  TVEventHandler,
  View,
  ViewStyle,
} from "react-native";

import { FocusMemory } from "./FocusMemory";

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
  screenKey?: string;
  focusKey?: string;
}

const SELECT_DEDUPE_MS = 250;

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
    screenKey,
    focusKey,
  },
  ref
) {
  const [focused, setFocused] = useState(false);
  const focusedRef = useRef(false);
  const lastFireRef = useRef(0);
  const internalRef = useRef<View>(null);

  useImperativeHandle(ref, () => internalRef.current as View);

  React.useEffect(() => {
    if (!screenKey || !focusKey) return;
    FocusMemory.register(screenKey, focusKey, internalRef);
    return () => {
      FocusMemory.unregister(screenKey, focusKey);
    };
  }, [screenKey, focusKey]);

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
    if (screenKey && focusKey) {
      FocusMemory.set(screenKey, focusKey);
    }
    onFocus?.();
  }, [screenKey, focusKey, onFocus]);

  const handleBlur = useCallback(() => {
    focusedRef.current = false;
    setFocused(false);
    onBlur?.();
  }, [onBlur]);

  React.useEffect(() => {
    if (!focused) return;

    let subscription: any;
    let tvEventHandler: any;

    const handler = (evt: any) => {
      const type = evt?.eventType;
      if (type !== "select" && type !== "dpad_center" && type !== "center") return;
      const action = evt?.eventKeyAction;
      if (action != null && action !== 0 && action !== "0" && action !== "down") return;
      fire();
    };

    if (typeof TVEventHandler === "function") {
      tvEventHandler = new (TVEventHandler as any)();
      tvEventHandler.enable(undefined, (_cmp: any, evt: any) => handler(evt));
    } else if (TVEventHandler && typeof (TVEventHandler as any).addListener === "function") {
      subscription = (TVEventHandler as any).addListener(handler);
    }

    return () => {
      if (tvEventHandler && typeof tvEventHandler.disable === "function") tvEventHandler.disable();
      if (subscription && typeof subscription.remove === "function") subscription.remove();
    };
  }, [focused, fire]);

  const child = typeof children === "function" ? children(focused) : children;

  return (
    <TouchableOpacity
      ref={internalRef as any}
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
