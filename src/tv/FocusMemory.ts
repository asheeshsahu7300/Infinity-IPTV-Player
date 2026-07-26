import { RefObject } from "react";
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

  restore(screen: string): boolean {
    const key = focusMemory.get(screen);
    if (!key) return false;

    const ref = focusRefs.get(screen)?.get(key);
    if (!ref) return false;

    requestAnimationFrame(() => {
      ref.current?.focus?.();
    });

    return true;
  },

  async restoreWithRetry(screen: string, attempts = 5): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
      const restored = this.restore(screen);
      if (restored) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
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

export default FocusMemory;
