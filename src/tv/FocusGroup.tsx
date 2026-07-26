import React from "react";
import { StyleProp, TVFocusGuideView, ViewStyle } from "react-native";

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
  autoFocus = false,
  trapUp,
  trapDown,
  trapLeft,
  trapRight,
  destinations,
}: FocusGroupProps) {
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
