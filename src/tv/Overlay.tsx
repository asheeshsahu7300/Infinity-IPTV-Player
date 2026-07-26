import React from "react";
import {
  BackHandler,
  StyleProp,
  StyleSheet,
  Pressable,
  View,
  ViewStyle,
  Animated,
  TVFocusGuideView,
} from "react-native";
import { useDPad } from "./useDPad";
import {
  InsideOverlayContext,
  FocusTrap,
  useOverlayFocusController,
} from "./FocusTrapContext";
import { lastFocusedRef } from "./Focusable";

export interface OverlayProps {
  visible: boolean;
  onClose?: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  trapFocus?: boolean;
  closeOnBack?: boolean;
}

/**
 * Drop-in replacement for `Modal` on TV. Renders an absolutely-positioned
 * overlay inside the same React tree (no native dialog), so the focus engine
 * traverses correctly and `hasTVPreferredFocus` works on the first action.
 *
 * Focus trapping is enforced at both the native OS level via `OverlayFocusController`
 * (which assigns native `nextFocus*` tags locking focus to modal buttons) and at the
 * React component level via `FocusTrapContext` (which disables background elements).
 */
export function Overlay({
  visible,
  onClose,
  children,
  style,
  contentStyle,
  trapFocus = true,
  closeOnBack = true,
}: OverlayProps) {
  const previousFocusedRef = React.useRef<View | null>(null);
  const opacity = React.useRef(new Animated.Value(0)).current;
  const [render, setRender] = React.useState(visible);
  const overlayController = useOverlayFocusController();

  // Hardware back button handler
  React.useEffect(() => {
    if (!visible || !closeOnBack) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose?.();
      return true;
    });
    return () => sub.remove();
  }, [visible, closeOnBack, onClose]);

  // Remote menu button handler
  useDPad(
    {
      onMenu: () => onClose?.(),
    },
    visible
  );

  // Focus trap registration & focus save/restore
  React.useEffect(() => {
    if (!visible) return;

    // Save currently focused background element before opening
    previousFocusedRef.current = lastFocusedRef.current;

    if (trapFocus) {
      FocusTrap.register();
    }

    return () => {
      if (trapFocus) {
        FocusTrap.unregister();
      }
      // Restore focus to background element when modal closes
      const prev = previousFocusedRef.current;
      if (prev) {
        setTimeout(() => {
          (prev as any)?.focus?.();
        }, 50);
      }
    };
  }, [visible, trapFocus]);

  // Visibility fade animation
  React.useEffect(() => {
    if (visible) {
      setRender(true);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        setRender(false);
      });
    }
  }, [visible, opacity]);

  if (!render) return null;

  return (
    <TVFocusGuideView
      style={StyleSheet.absoluteFillObject}
      autoFocus
      trapFocusUp={trapFocus}
      trapFocusDown={trapFocus}
      trapFocusLeft={trapFocus}
      trapFocusRight={trapFocus}
    >
      <Animated.View style={[styles.backdrop, style, { opacity }]} pointerEvents="auto">
        <Pressable
          style={StyleSheet.absoluteFillObject}
          focusable={false}
          accessible={false}
          importantForAccessibility="no"
          onPress={() => {
            if (closeOnBack) onClose?.();
          }}
        />
        <InsideOverlayContext.Provider value={overlayController}>
          <View style={[styles.content, contentStyle]}>
            {children}
          </View>
        </InsideOverlayContext.Provider>
      </Animated.View>
    </TVFocusGuideView>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
    elevation: 30,
  },
  content: {
    maxWidth: "92%",
    maxHeight: "92%",
  },
});

export default Overlay;


