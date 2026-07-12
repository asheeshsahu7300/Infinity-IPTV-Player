import React from "react";
import {
  BackHandler,
  StyleProp,
  StyleSheet,
  TouchableOpacity,
  View,
  ViewStyle,
  Animated,
} from "react-native";
import { useDPad } from "./useDPad";
import { FocusGroup } from "./FocusGroup";

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

  const opacity = React.useRef(new Animated.Value(0)).current;
  const [render, setRender] = React.useState(visible);

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
    <Animated.View style={[styles.backdrop, style, { opacity }]} pointerEvents="auto">
        <TouchableOpacity 
          style={StyleSheet.absoluteFillObject} 
          activeOpacity={1} 
          focusable={false}
          onPress={() => {
            if (closeOnBack) onClose?.();
          }}
          tvParallaxProperties={{ enabled: false }}
        />
        <FocusGroup 
          style={[styles.content, contentStyle]}
          autoFocus={true}
          trapUp={trapFocus}
          trapDown={trapFocus}
          trapLeft={trapFocus}
          trapRight={trapFocus}
        >
          {children}
        </FocusGroup>
    </Animated.View>
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
