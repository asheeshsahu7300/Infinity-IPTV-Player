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
import { useDPad, DPAD_PRIORITY } from "./useDPad";
import {
  InsideOverlayContext,
  FocusTrap,
  useOverlayFocusController,
  OverlayAxis,
} from "./FocusTrapContext";
import { lastFocusedRef } from "./Focusable";
import { useReducedMotion } from "./useReducedMotion";

export interface OverlayProps {
  visible: boolean;
  onClose?: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  trapFocus?: boolean;
  closeOnBack?: boolean;
  /** Layout direction of the overlay's focusable actions. Default "vertical". */
  axis?: OverlayAxis;
}

/**
 * Drop-in replacement for `Modal` on TV. Renders an absolutely-positioned
 * overlay inside the same React tree (no native dialog), so the focus engine
 * traverses correctly and `hasTVPreferredFocus` works on the first action.
 *
 * Containment is enforced three ways:
 *  - the surrounding `TVFocusGuideView` traps directional focus natively;
 *  - `OverlayFocusController` chains the overlay's items with `nextFocus*`;
 *  - `FocusTrap` marks background `Focusable`s non-focusable (observable, so
 *    memoised rows actually re-render when an overlay opens).
 *
 * While open it also takes top priority on the remote event bus, so screens
 * underneath stop receiving D-pad input.
 */
export function Overlay({
  visible,
  onClose,
  children,
  style,
  contentStyle,
  trapFocus = true,
  closeOnBack = true,
  axis = "vertical",
}: OverlayProps) {
  const previousFocusedRef = React.useRef<View | null>(null);
  const opacity = React.useRef(new Animated.Value(0)).current;
  const [render, setRender] = React.useState(visible);
  const overlayController = useOverlayFocusController(axis);
  const reduceMotion = useReducedMotion();

  // Hardware back button handler
  React.useEffect(() => {
    if (!visible || !closeOnBack) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose?.();
      return true;
    });
    return () => sub.remove();
  }, [visible, closeOnBack, onClose]);

  // Remote menu button handler — highest priority while open.
  useDPad(
    {
      onMenu: () => onClose?.(),
    },
    { enabled: visible, priority: DPAD_PRIORITY.OVERLAY }
  );

  // Focus trap registration + saving the background element we came from.
  React.useEffect(() => {
    if (!visible) return;

    previousFocusedRef.current = lastFocusedRef.current;

    if (trapFocus) {
      FocusTrap.register();
    }

    return () => {
      if (trapFocus) {
        FocusTrap.unregister();
      }
    };
  }, [visible, trapFocus]);

  // Visibility animation. Focus is handed back only once the overlay has
  // actually left the tree — restoring while the focus guide is still mounted
  // just bounces focus straight back into the closing overlay.
  React.useEffect(() => {
    const duration = reduceMotion ? 0 : 200;

    if (visible) {
      setRender(true);
      Animated.timing(opacity, {
        toValue: 1,
        duration,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(opacity, {
      toValue: 0,
      duration,
      useNativeDriver: true,
    }).start(() => {
      setRender(false);
      const prev = previousFocusedRef.current;
      previousFocusedRef.current = null;
      if (prev) {
        requestAnimationFrame(() => {
          (prev as any)?.focus?.();
        });
      }
    });
  }, [visible, opacity, reduceMotion]);

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
