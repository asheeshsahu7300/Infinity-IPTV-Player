import React from "react";
import { StyleProp, ViewStyle, View } from "react-native";

export interface FocusGroupProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  autoFocus?: boolean;
  trapUp?: boolean;
  trapDown?: boolean;
  trapLeft?: boolean;
  trapRight?: boolean;
  destinations?: any[];
}

export function FocusGroup({
  children,
  style,
}: FocusGroupProps) {
  return <View style={style}>{children}</View>;
}

export default FocusGroup;
