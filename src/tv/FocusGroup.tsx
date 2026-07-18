import React from "react";
import { StyleProp, TVFocusGuideView, ViewStyle, View } from "react-native";
import { isTV } from "../utils/tvUtils";

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

/**
 * Thin wrapper around TVFocusGuideView. Use to:
 *  - Auto-focus the first focusable child on mount (`autoFocus`)
 *  - Trap focus inside a region (`trapUp/Down/Left/Right`)
 *  - Redirect focus from a region to specific refs (`destinations`)
 */
export function FocusGroup({
  children,
  style,
  autoFocus,
  trapUp,
  trapDown,
  trapLeft,
  trapRight,
  destinations,
}: FocusGroupProps) {
  if (!isTV) {
    return <View style={style}>{children}</View>;
  }

  return (
    <TVFocusGuideView
      style={style}
      autoFocus={autoFocus}
      trapFocusUp={trapUp}
      trapFocusDown={trapDown}
      trapFocusLeft={trapLeft}
      trapFocusRight={trapRight}
      destinations={destinations}
    >
      {children}
    </TVFocusGuideView>
  );
}

export default FocusGroup;
