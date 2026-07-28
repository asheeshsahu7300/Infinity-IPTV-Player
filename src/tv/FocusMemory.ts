import React, { RefObject } from "react";
import { findNodeHandle } from "react-native";

type FocusKey = string;

const focusMemory = new Map<string, FocusKey>();
const focusRefs = new Map<string, Map<FocusKey, RefObject<any>>>();

export const FocusMemory = {
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
    }
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

  async restoreWithRetry(screen: string, attempts = 5, intervalMs = 60): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
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

/**
 * Restores the last-focused item of a screen once its content is ready.
 *
 * Returns `true` when there was nothing to restore, which the caller should
 * use to give `hasTVPreferredFocus` to its first item. This is state, not a
 * ref, so flipping it actually re-renders the list.
 *
 * `token` scopes the memory — pass the current category/tab so switching it
 * re-runs the restore instead of holding focus on an item that is gone.
 */
export function useFocusRestore(
  screenKey: string,
  ready: boolean,
  token: string | number = ""
): boolean {
  const [autoFocusFirst, setAutoFocusFirst] = React.useState(false);
  const lastTokenRef = React.useRef<string | number | null>(null);

  React.useEffect(() => {
    if (!ready) return;
    if (lastTokenRef.current === token) return;
    lastTokenRef.current = token;

    // Nothing remembered (first visit, or the category just changed): focus the
    // first item straight away rather than burning the retry window first.
    if (!FocusMemory.get(screenKey)) {
      setAutoFocusFirst(true);
      return;
    }

    setAutoFocusFirst(false);

    let cancelled = false;
    FocusMemory.restoreWithRetry(screenKey).then((restored) => {
      if (!cancelled && !restored) setAutoFocusFirst(true);
    });

    return () => {
      cancelled = true;
    };
  }, [ready, screenKey, token]);

  return autoFocusFirst;
}

export default FocusMemory;
