import React from "react";
import {
  BackHandler,
  Pressable,
  StyleProp,
  StyleSheet,
  TVFocusGuideView,
  View,
  ViewStyle,
} from "react-native";
import { isTV } from "../utils/tvUtils";
import { useDPad } from "./useDPad";

export interface OverlayProps {
  visible: boolean;
  onClose?: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  trapFocus?: boolean;
  closeOnBack?: boolean;
  position?: "center" | "bottom";
}

/**
 * Drop-in replacement for `Modal` on TV. Renders an absolutely-positioned
 * overlay inside the same React tree (no native dialog), so the focus engine
 * traverses correctly and `hasTVPreferredFocus` works on the first action.
 */
export function Overlay({
  visible,
  onClose,
  children,
  style,
  contentStyle,
  trapFocus = true,
  closeOnBack = true,
  position = "center",
}: OverlayProps) {
  React.useEffect(() => {
    if (!visible || !closeOnBack) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose?.();
      return true;
    });
    return () => sub.remove();
  }, [visible, closeOnBack, onClose]);

  useDPad(
    {
      onMenu: () => onClose?.(),
    },
    visible
  );

  if (!visible) return null;

  return (
    <View style={[styles.backdrop, position === "bottom" && styles.backdropBottom, style]} pointerEvents="auto">
      {/* Touch devices: tapping the dimmed area outside the content closes the
          overlay. Sits behind the content (rendered first), so taps on the
          content itself never reach it. Skipped on TV — there's no pointer and
          a focusable backdrop would steal focus from the action buttons. */}
      {!isTV && onClose && (
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      )}
      <TVFocusGuideView
        autoFocus
        trapFocusUp={trapFocus}
        trapFocusDown={trapFocus}
        trapFocusLeft={trapFocus}
        trapFocusRight={trapFocus}
        style={[
          styles.content,
          position === "bottom" && styles.contentBottom,
          contentStyle
        ]}
      >
        {children}
      </TVFocusGuideView>
    </View>
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
  backdropBottom: {
    justifyContent: "flex-end",
    paddingBottom: 0,
  },
  content: {
    maxWidth: "92%",
    maxHeight: "92%",
  },
  contentBottom: {
    maxWidth: "100%",
    width: "100%",
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
});

export default Overlay;
