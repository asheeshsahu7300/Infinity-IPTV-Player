import React from "react";
import {
  BackHandler,
  StyleProp,
  StyleSheet,
  TouchableOpacity,
  Modal,
  View,
  ViewStyle,
} from "react-native";
import { useDPad } from "./useDPad";

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

  return (
    <Modal
      visible={visible}
      transparent={true}
      onRequestClose={() => {
        if (closeOnBack) onClose?.();
      }}
      animationType="fade"
    >
      <View style={[styles.backdrop, style]} pointerEvents="auto">
        <TouchableOpacity 
          style={StyleSheet.absoluteFillObject} 
          activeOpacity={1} 
          onPress={() => {
            if (closeOnBack) onClose?.();
          }}
          tvParallaxProperties={{ enabled: false }}
        />
        <View style={[styles.content, contentStyle]}>
          {children}
        </View>
      </View>
    </Modal>
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
