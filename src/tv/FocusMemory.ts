type FocusKey = string;

const focusMemory = new Map<string, FocusKey>();
const focusRefs = new Map<string, Map<FocusKey, any>>();

export const FocusMemory = {
  set(screen: string, key: FocusKey) {
    if (screen && key) {
      focusMemory.set(screen, key);
    }
  },

  get(screen: string): string | undefined {
    return focusMemory.get(screen);
  },

  register(screen: string, key: FocusKey, ref: any) {
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
