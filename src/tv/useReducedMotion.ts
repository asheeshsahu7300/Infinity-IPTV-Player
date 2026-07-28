import React from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Tracks the OS "reduce motion" accessibility setting.
 *
 * Use it to skip or shorten decorative animation. Transitions that convey
 * state (focus, selection) must still be visible — drop the movement, keep
 * the colour/scale end state.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (mounted) setReduced(value);
      })
      .catch(() => {
        /* not supported on this platform — keep motion on */
      });

    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      setReduced(value);
    });

    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return reduced;
}

export default useReducedMotion;
