import React from "react";
import {
  BackHandler,
  Platform,
  StyleProp,
  StyleSheet,
  Pressable,
  View,
  ViewStyle,
  Animated,
  findNodeHandle,
} from "react-native";
import * as ReactNative from "react-native";
import { useDPad, DPAD_PRIORITY } from "./useDPad";
import {
  InsideOverlayContext,
  FocusTrap,
  useOverlayFocusController,
  OverlayAxis,
} from "./FocusTrapContext";
import { lastFocusedRef } from "./Focusable";
import { useReducedMotion } from "./useReducedMotion";
import { FocusMemory } from "./FocusMemory";

/**
 * The overlay's outermost node.
 *
 * `TVFocusGuideView` traps D-pad movement inside the dialog. It is a
 * remote-focus construct: on a phone or tablet there is no D-pad, so it
 * contributes nothing but a wrapper.
 *
 * It is also **not in react-native's TypeScript surface** — `types/index.d.ts`
 * does not declare it, while `index.js` does define it as a getter — so a
 * named `import { TVFocusGuideView } from "react-native"` is a type error, and
 * on a build where that getter is absent it silently yields `undefined`.
 * Rendering `undefined` is what killed every dialog in the app with "Element
 * type is invalid", blamed on `Overlay` because `Overlay` is what rendered it.
 *
 * Reading it off the namespace keeps the compiler honest about the fact that
 * this member is not guaranteed, and the `?? View` makes the absence
 * survivable instead of fatal. Off TV it is not consulted at all.
 */
const TVFocusGuideView = (
  ReactNative as unknown as { TVFocusGuideView?: React.ComponentType<any> }
).TVFocusGuideView;

const FocusGuide: React.ComponentType<any> = Platform.isTV
  ? TVFocusGuideView ?? View
  : View;

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
  const previousScreenKey = React.useRef<string | null>(null);
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

  // Focus trap registration + saving the background element and screen we came from.
  React.useEffect(() => {
    if (!visible) return;

    previousFocusedRef.current = lastFocusedRef.current;
    previousScreenKey.current = FocusMemory.getLastActiveScreen();

    if (trapFocus) {
      FocusTrap.register();
    }

    return () => {
      if (trapFocus) {
        FocusTrap.unregister();
      }
    };
  }, [visible, trapFocus]);

  const restorePreviousFocusWithRetry = React.useCallback(() => {
    const startEpoch = FocusMemory.focusEpoch;
    const targetRef = previousFocusedRef.current;
    const targetScreen = previousScreenKey.current || FocusMemory.getLastActiveScreen();

    let attempts = 0;
    const maxAttempts = 10;

    const tryRestore = () => {
      // If focus epoch already moved (meaning an element gained focus), stop retrying!
      if (FocusMemory.focusEpoch !== startEpoch) {
        return true;
      }

      // 1. Try focusing the direct native view ref of the tile
      if (targetRef && typeof (targetRef as any).focus === "function") {
        try {
          (targetRef as any).focus();
          if (FocusMemory.focusEpoch !== startEpoch) return true;
        } catch {
          // ignore
        }
      }

      // 2. Fall back to FocusMemory for the active screen
      if (targetScreen) {
        if (FocusMemory.restore(targetScreen)) {
          if (FocusMemory.focusEpoch !== startEpoch) return true;
        }
      }

      return false;
    };

    // Attempt immediately
    if (tryRestore()) return;

    // Retry every 35ms while native view focusability settles
    const timer = setInterval(() => {
      attempts++;
      if (tryRestore() || attempts >= maxAttempts) {
        clearInterval(timer);
      }
    }, 35);
  }, []);

  // Visibility animation + focus restoration retry loop on close.
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

    // Immediately trigger focus restoration retry loop when modal starts closing.
    restorePreviousFocusWithRetry();

    Animated.timing(opacity, {
      toValue: 0,
      duration,
      useNativeDriver: true,
    }).start(() => {
      setRender(false);
      previousFocusedRef.current = null;
      previousScreenKey.current = null;
    });
  }, [visible, opacity, reduceMotion, restorePreviousFocusWithRetry]);

  if (!render) return null;

  return (
    <FocusGuide
      style={styles.root}
      {...(Platform.isTV
        ? {
            trapFocusUp: trapFocus && visible,
            trapFocusDown: trapFocus && visible,
            trapFocusLeft: trapFocus && visible,
            trapFocusRight: trapFocus && visible,
          }
        : null)}
    >
      <Animated.View style={[styles.backdrop, style, { opacity }]} pointerEvents={visible ? "auto" : "none"}>
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
    </FocusGuide>
  );
}

const styles = StyleSheet.create({
  /**
   * The stacking order has to live on the *outermost* node, not the backdrop.
   *
   * It used to sit on the backdrop, which is this view's only child, so it
   * ranked against no siblings and did nothing, while this view competed with
   * the screen's content at elevation 0. On Android elevation outranks
   * declaration order, and Fabric flattens layout-only wrappers away, so an
   * elevated card several levels deep inside a screen ends up a direct sibling
   * of this overlay. A portal card at elevation 8 therefore drew *above* the
   * dialog, and because that card is near-transparent glass
   * (rgba(255,255,255,0.03)) carrying opaque white text, the dialog showed
   * through it while the card's own name and buttons landed on top of the
   * dialog's message. It read as a see-through dialog, but nothing was
   * transparent that should not have been: it was painted in the wrong order.
   *
   * 30 clears the highest elevation used anywhere in the app (20). zIndex
   * covers iOS and web, where elevation means nothing.
   */
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 30,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    maxWidth: "92%",
    maxHeight: "92%",
  },
});

export default Overlay;
