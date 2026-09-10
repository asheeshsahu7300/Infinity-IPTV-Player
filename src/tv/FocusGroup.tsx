import React from "react";
import { StyleProp, View, ViewStyle } from "react-native";
import * as ReactNative from "react-native";

/**
 * `TVFocusGuideView` is missing from react-native's TypeScript surface —
 * `types/index.d.ts` does not declare it, though `index.js` defines it as a
 * getter — so importing it by name is a compile error even though it resolves
 * at runtime. Read it off the namespace instead, and fall back to `View` if a
 * given build really does lack it. See the matching note in `Overlay.tsx`.
 */
const TVFocusGuideView: React.ComponentType<any> =
  (ReactNative as unknown as { TVFocusGuideView?: React.ComponentType<any> })
    .TVFocusGuideView ?? View;

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
export const FocusGroup = React.forwardRef<View, FocusGroupProps>(
  function FocusGroup(
    {
      children,
      style,
      autoFocus = false,
      trapUp,
      trapDown,
      trapLeft,
      trapRight,
      destinations,
    },
    ref
  ) {
    return (
      <TVFocusGuideView
        ref={ref as any}
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
);

export default FocusGroup;
