import React, { RefObject } from "react";
import { findNodeHandle } from "react-native";

type FocusKey = string;

const focusMemory = new Map<string, FocusKey>();
const focusRefs = new Map<string, Map<FocusKey, RefObject<any>>>();

/**
 * Incremented on every focus event anywhere in the app. Programmatic focus is
 * always asynchronous (a settle timeout, a retry loop), so by the time it fires
 * the user may have moved on. Comparing the epoch captured at request time
 * against the current one turns "focus this" into "focus this *unless the user
 * already moved*", which is the difference between restoring focus and stealing
 * it back out from under someone.
 */
let focusEpoch = 0;

let lastActiveScreen: string | null = null;

export const FocusMemory = {
  get focusEpoch() {
    return focusEpoch;
  },

  noteFocusEvent() {
    focusEpoch++;
  },

  register(screen: string, key: FocusKey, ref: RefObject<any>) {
    if (!screen || !key || !ref) return;
    if (!focusRefs.has(screen)) {
      focusRefs.set(screen, new Map());
    }
    focusRefs.get(screen)!.set(key, ref);
  },

  unregister(screen: string, key: FocusKey) {
    if (screen && key) {
      focusRefs.get(screen)?.delete(key);
    }
  },

  set(screen: string, key: FocusKey) {
    if (screen && key) {
      focusMemory.set(screen, key);
      lastActiveScreen = screen;
    }
  },

  getLastActiveScreen(): string | null {
    return lastActiveScreen;
  },

  get(screen: string): string | undefined {
    return focusMemory.get(screen);
  },

  getRef(screen: string, key: FocusKey): RefObject<any> | undefined {
    return focusRefs.get(screen)?.get(key);
  },

  getNativeHandle(screen: string, key: FocusKey): number | undefined {
    const ref = this.getRef(screen, key);
    if (!ref?.current) return undefined;
    return (findNodeHandle(ref.current) as number | undefined) ?? undefined;
  },

  /**
   * Focus the last-focused item of `screen`.
   *
   * Reports success only when a mounted node was actually focused — a
   * registered-but-unmounted ref counts as a miss, otherwise `restoreWithRetry`
   * gives up on the first attempt without having focused anything.
   */
  restore(screen: string): boolean {
    const key = focusMemory.get(screen);
    if (!key) return false;

    const node = focusRefs.get(screen)?.get(key)?.current;
    if (!node || typeof node.focus !== "function") return false;

    node.focus();
    return true;
  },

  /**
   * Retries `restore` while the target mounts.
   *
   * The retry window is ~300ms, long enough for a user to press a direction key,
   * and a restore landing after that reads as focus jumping backwards on its own.
   * So once focus has demonstrably moved, stop trying.
   *
   * The first couple of attempts ignore that rule. On screen entry the native
   * focus engine focuses *something* immediately, and restoring over that is the
   * entire purpose of this function — bailing on it would mean focus memory never
   * worked at all. 2 × 60ms is well under human key-press latency, so the grace
   * window cannot swallow a real input.
   */
  async restoreWithRetry(screen: string, attempts = 5, intervalMs = 60): Promise<boolean> {
    const GRACE_ATTEMPTS = 2;
    const startEpoch = focusEpoch;
    for (let i = 0; i < attempts; i++) {
      if (i >= GRACE_ATTEMPTS && focusEpoch !== startEpoch) {
        return true; // user took over — treat as handled
      }
      if (this.restore(screen)) return true;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return false;
  },

  /** Drop the remembered position but keep the registered refs. */
  forget(screen: string) {
    focusMemory.delete(screen);
  },

  clear(screen: string) {
    focusMemory.delete(screen);
    focusRefs.delete(screen);
  },

  clearAll() {
    focusMemory.clear();
    focusRefs.clear();
  },
};

/** How long `autoFocusFirst` stays raised — enough for the target cell to mount
 *  and for Focusable's 50ms settle to fire. */
const AUTO_FOCUS_PULSE_MS = 400;

export interface FocusRestoreOptions {
  /**
   * Whether a `token` change may hand focus to the first item.
   *
   * Set this to `false` for a list driven by a category sidebar. When the token
   * changes there, the user is still *in* the sidebar and almost always wants to
   * keep browsing categories — pulling focus into the freshly loaded grid takes
   * the remote out of their hands and forces them to navigate back left.
   *
   * Entering the screen still focuses the grid; only token changes are exempt.
   */
  autoFocusOnTokenChange?: boolean;
}

/**
 * Raises a one-shot flag the first time `ready` becomes true, for handing a
 * screen's initial focus to a specific element.
 *
 * A pulse, not a latch, for the same reason as `useFocusRestore`: a permanently
 * raised `hasTVPreferredFocus` gets re-claimed every time its element remounts,
 * dragging focus back from wherever the user has since navigated.
 */
export function useInitialFocusPulse(ready: boolean): boolean {
  // Seeded from `ready`, not `false`. When the target already exists on the first
  // render, `hasTVPreferredFocus` has to be part of the *initial* commit — the
  // native focus engine reads the tree as the screen appears, well before any
  // effect runs. Raising the flag one render late means the engine has already
  // focused whatever came first in the tree.
  const [pulsing, setPulsing] = React.useState(ready);
  const startedRef = React.useRef(false);

  React.useEffect(() => {
    if (!ready || startedRef.current) return;
    startedRef.current = true;
    setPulsing(true);
    const timer = setTimeout(() => setPulsing(false), AUTO_FOCUS_PULSE_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  return pulsing;
}

/**
 * Restores the last-focused item of a screen once its content is ready.
 *
 * Returns `true` when there was nothing to restore, which the caller should
 * use to give `hasTVPreferredFocus` to its first item. This is state, not a
 * ref, so flipping it actually re-renders the list.
 *
 * The return value is a *pulse*, not a latch: it goes true, the first item takes
 * focus, and it goes back to false. Leaving it latched meant the first cell
 * carried `hasTVPreferredFocus` for the whole life of the screen, so every time
 * a virtualised list remounted that cell it grabbed focus back from wherever the
 * user had navigated to.
 *
 * `token` scopes the memory — pass the current category/tab so switching it
 * re-runs the restore instead of holding focus on an item that is gone.
 */
export function useFocusRestore(
  screenKey: string,
  ready: boolean,
  token: string | number = "",
  options: FocusRestoreOptions = {}
): boolean {
  const { autoFocusOnTokenChange = true } = options;

  const [autoFocusFirst, setAutoFocusFirst] = React.useState(false);
  const lastTokenRef = React.useRef<string | number | null>(null);
  const pulseTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Distinguishes entering the screen from switching token within it.
  const isFirstActivationRef = React.useRef(true);

  const pulse = React.useCallback(() => {
    setAutoFocusFirst(true);
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = setTimeout(() => setAutoFocusFirst(false), AUTO_FOCUS_PULSE_MS);
  }, []);

  React.useEffect(
    () => () => {
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    },
    []
  );

  React.useEffect(() => {
    if (!ready) return;
    if (lastTokenRef.current === token) return;
    lastTokenRef.current = token;

    const isFirstActivation = isFirstActivationRef.current;
    isFirstActivationRef.current = false;

    // A token change the caller has opted out of: leave focus exactly where the
    // user put it. For a category sidebar that means they stay on the category
    // they just selected and can keep moving through the list.
    if (!isFirstActivation && !autoFocusOnTokenChange) return;

    // Nothing remembered (first visit, or the category just changed): focus the
    // first item straight away rather than burning the retry window first.
    if (!FocusMemory.get(screenKey)) {
      pulse();
      return;
    }

    let cancelled = false;
    FocusMemory.restoreWithRetry(screenKey).then((restored) => {
      if (!cancelled && !restored) pulse();
    });

    return () => {
      cancelled = true;
    };
  }, [ready, screenKey, token, pulse, autoFocusOnTokenChange]);

  return autoFocusFirst;
}

export default FocusMemory;
