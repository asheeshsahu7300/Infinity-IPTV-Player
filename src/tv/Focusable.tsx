import React from "react";
import {
  StyleProp,
  StyleSheet,
  Pressable,
  ViewStyle,
  View
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
  scaleOnFocus?: number;
  ringOnFocus?: boolean;
  testID?: string;
  nextFocusUp?: number;
  nextFocusDown?: number;
  nextFocusLeft?: number;
  nextFocusRight?: number;
}

export const Focusable = React.forwardRef<View, FocusableProps>(function Focusable(
  {
    children,
    onPress,
    onLongPress,
    disabled = false,
    style,
    focusStyle,
    ringOnFocus = true,
    testID,
  },
  ref
) {
  return (
    <Pressable
      ref={ref as any}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        style,
        pressed && ringOnFocus && styles.ring,
        pressed && focusStyle,
      ]}
    >
      {({ pressed }) =>
        typeof children === "function" ? children(pressed) : children
      }
    </Pressable>
  );
});

const styles = StyleSheet.create({
  ring: {
    borderWidth: 3,
    borderColor: "#ffffff",
  },
});

export default Focusable;
