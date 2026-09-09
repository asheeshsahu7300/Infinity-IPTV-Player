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
  findNodeHandle,
} from "react-native";

import { FocusMemory } from "./FocusMemory";
import { useIsFocusTrapped, InsideOverlayContext, NextFocusTags } from "./FocusTrapContext";
import { useDPad, DPAD_PRIORITY } from "./useDPad";
import { remoteFocusEnabled } from "../utils/tabletUtils";

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

  /** Pins focus to this element when pressing directional D-pad keys */
  trapFocusUp?: boolean;
  trapFocusDown?: boolean;
  trapFocusLeft?: boolean;
  trapFocusRight?: boolean;

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
      trapFocusUp = false,
      trapFocusDown = false,
      trapFocusLeft = false,
      trapFocusRight = false,
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
    // Mirror of `focused` readable from timers without stale-closure risk.
    const focusedRef = useRef(false);
    /**
     * Focus as the UI should *show* it.
     *
     * A tablet has no remote, so it must never paint a focus ring, apply a
     * `focusStyle`, or hand `true` to a `children(focused)` render prop — a
     * highlighted tile there is a selection the viewer never made. Gating this
     * one derived value covers the ring, the call-site focus styles and the
     * `useDPad` subscription below at once, because all three read it.
     */
    const showFocus = remoteFocusEnabled && focused;

    const isFocusTrapped = useIsFocusTrapped();
    const isDisabled = disabled;

    /**
     * Out of the focus graph: explicitly disabled, or in the background behind
     * an open overlay.
     *
     * The trap was only ever half-connected. `isFocusTrapped` was used for the
     * restore pulse and to keep background focus out of FocusMemory, but never
     * reached `focusable`, so every row behind an overlay stayed a live focus
     * target and Android's focus search walked straight into it — one D-pad
     * press out of a dialog and you were driving the settings list behind it,
     * with the dialog still on screen and nothing in it focused. Overlay's own
     * docblock claims this containment ("FocusTrap marks background Focusables
     * non-focusable"); this is the line that makes that true.
     *
     * `handleFocus` guarding its bookkeeping with `!isFocusTrapped` is the
     * fossil of the same bug: it defended against background items receiving
     * focus instead of stopping them from being focusable.
     *
     * Items *inside* an overlay are never inert — useIsFocusTrapped returns
     * false for anything under InsideOverlayContext.
     */
    const isInert = disabled || isFocusTrapped;

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

    // Auto-focus on mount if this item hasTVPreferredFocus and is active.
    //
    // Strictly one grab per mounted instance. `hasTVPreferredFocus` is usually
    // derived from state that stays true for the life of a screen (see
    // useFocusRestore), so without this guard every remount of the first cell —
    // FlatList windowing, removeClippedSubviews, or any prop flip that
    // retriggers the effect — yanked focus back to the top of the grid while the
    // user was somewhere else entirely. That is the focus-jumping.
    const didAutoFocusRef = useRef(false);
    React.useEffect(() => {
      if (!remoteFocusEnabled) return;
      if (!hasTVPreferredFocus || isInert) return;
      if (didAutoFocusRef.current) return;
      didAutoFocusRef.current = true;

      const epochAtRequest = FocusMemory.focusEpoch;
      focusTimeRef.current = Date.now();
      if (!focusedRef.current && FocusMemory.focusEpoch === epochAtRequest) {
        nativeRef.current?.focus?.();
      }
    }, [hasTVPreferredFocus, isInert]);

    // Automatic focus restore pulse when overlay/modal closes
    const wasTrappedRef = useRef(false);
    const [restorePulse, setRestorePulse] = useState(false);

    React.useEffect(() => {
      if (!remoteFocusEnabled) return;
      if (isFocusTrapped) {
        wasTrappedRef.current = true;
      } else if (wasTrappedRef.current) {
        wasTrappedRef.current = false;
        const lastScreen = FocusMemory.getLastActiveScreen();
        const isLastFocusedByMemory = Boolean(
          screenKey &&
          focusKey &&
          lastScreen === screenKey &&
          FocusMemory.get(screenKey) === focusKey
        );
        const isLastFocusedByRef = Boolean(
          lastFocusedRef.current &&
          lastFocusedRef.current === nativeRef.current
        );
        if (isLastFocusedByRef || isLastFocusedByMemory) {
          setRestorePulse(true);
          const timer = setTimeout(() => setRestorePulse(false), 400);
          return () => clearTimeout(timer);
        }
      }
    }, [isFocusTrapped, screenKey, focusKey]);

    const hasDirectionalTraps = trapFocusUp || trapFocusDown || trapFocusLeft || trapFocusRight;
    const [selfTag, setSelfTag] = useState<number | undefined>(undefined);

    const updateSelfTag = useCallback(() => {
      if (nativeRef.current) {
        const tag = findNodeHandle(nativeRef.current);
        if (tag && tag !== selfTag) {
          setSelfTag(tag);
        }
      }
    }, [selfTag]);

    React.useEffect(() => {
      if (hasDirectionalTraps) {
        updateSelfTag();
      }
    });

    const isInsideOverlay = Boolean(overlayController);
    const lastPressTimeRef = useRef(0);
    const focusTimeRef = useRef(0);

    const handleFocus = useCallback(() => {
      setFocused(true);
      focusedRef.current = true;
      focusTimeRef.current = Date.now();
      if (hasDirectionalTraps) {
        updateSelfTag();
      }
      if (!isInsideOverlay && !isFocusTrapped) {
        lastFocusedRef.current = nativeRef.current;
      }
      // Bumping the epoch tells any pending programmatic focus request that the
      // focus has moved on and it should abandon its attempt.
      FocusMemory.noteFocusEvent();

      if (!isInsideOverlay && !isFocusTrapped && screenKey && focusKey) {
        FocusMemory.set(screenKey, focusKey);
      }

      onFocus?.();
    }, [hasDirectionalTraps, updateSelfTag, isInsideOverlay, isFocusTrapped, screenKey, focusKey, onFocus]);

    const handleBlur = useCallback(() => {
      setFocused(false);
      focusedRef.current = false;
      onBlur?.();
    }, [onBlur]);

    const handlePress = useCallback(() => {
      if (isInert) return;
      const now = Date.now();
      /**
       * The first two guards are remote-only.
       *
       * `globalLastPressTime` is a lock shared by every Focusable in the app:
       * after any press, all the others ignore presses for 350ms. That defends
       * against a remote's OK key double-firing (ACTION_DOWN then ACTION_UP),
       * which touch never does -- and under touch it is felt directly as lag,
       * because tapping one tile deadens every other tile for a third of a
       * second. The focus-bleed guard likewise defends against auto-focus
       * landing a stray press, and auto-focus does not run without a remote.
       *
       * The per-component guard stays on both: a fast double-tap really can
       * activate one target twice, and 200ms on a single target is not felt.
       */
      if (remoteFocusEnabled) {
        if (now - globalLastPressTime < 350) return;
        if (now - focusTimeRef.current < 250) return;
      }
      if (now - lastPressTimeRef.current < 200) return;
      globalLastPressTime = now;
      lastPressTimeRef.current = now;

      // Lock this component as the last focused component right when pressed
      if (!isInsideOverlay) {
        lastFocusedRef.current = nativeRef.current;
        if (screenKey && focusKey) {
          FocusMemory.set(screenKey, focusKey);
        }
      }

      onPress?.();
    }, [isInert, isInsideOverlay, screenKey, focusKey, onPress]);

    /**
     * Long OK, from the remote.
     *
     * `onLongPress` was already handed to the Pressable below, but that only
     * listens to the touch responder — a remote never drives it, so long press
     * worked on a phone and did nothing at all on a box.
     *
     * The bridge does report it. With `enableKeyDownEvents` false (the
     * default), holding OK past ~300ms dispatches "longSelect" twice: once on
     * a repeated ACTION_DOWN, then again on ACTION_UP. Two things make that
     * safe to wire straight through:
     *
     *  - `isKeyPress` pairs the DOWN with the UP, so the handler runs once.
     *  - while the long press is active, ReactAndroidHWInputDeviceHelper takes
     *    the KEY_EVENTS_LONG_PRESS_ACTIONS branch and never reaches
     *    KEY_EVENTS_ACTIONS — so a long press emits **no** "select" at all,
     *    and cannot also fire onPress.
     */
    const handleLongPress = useCallback(() => {
      if (isInert || !onLongPress) return;
      const now = Date.now();
      // Shares the global press lock with handlePress, so a remote that does
      // report both cannot land a press and a long press on one hold. Skipped
      // under touch for the reason given there, and because Pressable raises
      // either onPress or onLongPress for a gesture, never both.
      if (remoteFocusEnabled && now - globalLastPressTime < 350) return;
      globalLastPressTime = now;
      lastPressTimeRef.current = now;
      onLongPress();
    }, [isInert, onLongPress]);

    useDPad(
      {
        onSelect: handlePress,
        onLongSelect: handleLongPress,
        onUp: trapFocusUp ? () => {
          nativeRef.current?.focus?.();
        } : undefined,
        onDown: trapFocusDown ? () => {
          nativeRef.current?.focus?.();
        } : undefined,
        onLeft: trapFocusLeft ? () => {
          nativeRef.current?.focus?.();
        } : undefined,
        onRight: trapFocusRight ? () => {
          nativeRef.current?.focus?.();
        } : undefined,
      },
      {
        // Either handler is reason enough to listen: a tile that only offers a
        // long press (favourite, context menu) would otherwise never be heard.
        enabled: showFocus && !isInert && Boolean(onPress || onLongPress || hasDirectionalTraps),
        priority: isInsideOverlay ? DPAD_PRIORITY.OVERLAY + 10 : (hasDirectionalTraps ? DPAD_PRIORITY.SCREEN + 2 : DPAD_PRIORITY.SCREEN),
      }
    );

    const content =
      typeof children === "function"
        ? children(showFocus)
        : children;

    const resolvedSelfTag = selfTag ?? (nativeRef.current ? (findNodeHandle(nativeRef.current) ?? undefined) : undefined);

    // Effective next focus props: explicit props take precedence over overlay auto-tags and directional traps
    const effUp = nextFocusUp ?? (trapFocusUp ? resolvedSelfTag : overlayNextFocus.nextFocusUp);
    const effDown = nextFocusDown ?? (trapFocusDown ? resolvedSelfTag : overlayNextFocus.nextFocusDown);
    const effLeft = nextFocusLeft ?? (trapFocusLeft ? resolvedSelfTag : overlayNextFocus.nextFocusLeft);
    const effRight = nextFocusRight ?? (trapFocusRight ? resolvedSelfTag : overlayNextFocus.nextFocusRight);

    return (
      <Pressable
        ref={nativeRef}
        testID={testID}
        disabled={isInert}
        /**
         * Always the plain inert check -- never gated on `remoteFocusEnabled`.
         *
         * `focusable={false}` is not just a focus hint. ReactViewManager's
         * setFocusable does `setOnClickListener(null)` and `isClickable = false`
         * on the false branch, and RN-tvos delivers Pressability's press through
         * onClick -- so switching it off on tablets severed touch, press and
         * (with focus-driven scrolling also off) scrolling, all at once.
         *
         * Suppressing the focus *visuals* is `showFocus`'s job alone; the native
         * focusability must stay as it is on the box.
         */
        focusable={!isInert}
        accessible
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: isDisabled, selected }}
        hasTVPreferredFocus={remoteFocusEnabled && (hasTVPreferredFocus || restorePulse)}
        nextFocusUp={effUp}
        nextFocusDown={effDown}
        nextFocusLeft={effLeft}
        nextFocusRight={effRight}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onPress={isInert ? undefined : handlePress}
        onLongPress={onLongPress}
        style={({ pressed }) => [
          // Reserve the ring's border box up front so gaining focus recolours
          // it instead of resizing the element and reflowing the row.
          ringOnFocus && styles.ringReserved,
          style,
          showFocus && ringOnFocus && styles.focused,
          showFocus && focusStyle,
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
