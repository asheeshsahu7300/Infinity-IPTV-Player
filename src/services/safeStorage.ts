import { MMKV } from "react-native-mmkv";

let mmkvInstance: {
  set: (key: string, value: string | number | boolean) => void;
  getString: (key: string) => string | undefined;
  delete: (key: string) => void;
  getAllKeys: () => string[];
  clearAll: () => void;
  contains: (key: string) => boolean;
};

try {
  mmkvInstance = new MMKV();
} catch (err) {
  console.warn(
    "[SafeStorage] MMKV native module not available, falling back to in-memory store for web/testing:",
    err
  );
  const memoryStore = new Map<string, string>();
  mmkvInstance = {
    set: (key: string, value: string | number | boolean) => {
      memoryStore.set(key, String(value));
    },
    getString: (key: string) => memoryStore.get(key),
    delete: (key: string) => {
      memoryStore.delete(key);
    },
    getAllKeys: () => Array.from(memoryStore.keys()),
    clearAll: () => {
      memoryStore.clear();
    },
    contains: (key: string) => memoryStore.has(key),
  };
}

export const mmkv = mmkvInstance;
export const storage = mmkvInstance;

export const safeStorage = {
  async setItem(key: string, value: string): Promise<boolean> {
    try {
      mmkv.set(key, value);
      return true;
    } catch (err: any) {
      console.warn(`[SafeStorage] Failed to set ${key}:`, err?.message || err);
      return false;
    }
  },

  async getItem(key: string): Promise<string | null> {
    try {
      const val = mmkv.getString(key);
      return val !== undefined ? val : null;
    } catch (err: any) {
      console.warn(`[SafeStorage] Failed to get ${key}:`, err?.message || err);
      return null;
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      mmkv.delete(key);
    } catch (err: any) {
      console.warn(`[SafeStorage] Failed to remove ${key}:`, err?.message || err);
    }
  },

  async multiRemove(keys: string[]): Promise<void> {
    try {
      for (const key of keys) {
        mmkv.delete(key);
      }
    } catch (err: any) {
      console.warn(`[SafeStorage] Failed multiRemove:`, err?.message || err);
    }
  },

  async multiSet(pairs: [string, string][]): Promise<void> {
    try {
      for (const [key, value] of pairs) {
        mmkv.set(key, value);
      }
    } catch (err: any) {
      console.warn(`[SafeStorage] Failed multiSet:`, err?.message || err);
    }
  },

  async multiGet(keys: string[]): Promise<readonly [string, string | null][]> {
    try {
      return keys.map((key) => {
        const val = mmkv.getString(key);
        return [key, val !== undefined ? val : null] as [string, string | null];
      });
    } catch (err: any) {
      console.warn(`[SafeStorage] Failed multiGet:`, err?.message || err);
      return keys.map((key) => [key, null]);
    }
  },

  async getAllKeys(): Promise<string[]> {
    try {
      return mmkv.getAllKeys();
    } catch (err: any) {
      console.warn(`[SafeStorage] Failed getAllKeys:`, err?.message || err);
      return [];
    }
  },

  async clear(): Promise<void> {
    try {
      mmkv.clearAll();
    } catch (err: any) {
      console.warn(`[SafeStorage] Failed clear:`, err?.message || err);
    }
  },

  async clearAll(): Promise<void> {
    try {
      mmkv.clearAll();
    } catch (err: any) {
      console.warn(`[SafeStorage] Failed clearAll:`, err?.message || err);
    }
  },

  async handleSqliteFull(): Promise<void> {
    console.warn("⚠️ [SafeStorage] Cleaning up cache/EPG keys in MMKV...");
    try {
      const keys = mmkv.getAllKeys();
      const cacheKeys = keys.filter((k) => k.startsWith("cache:"));
      const epgKeys = keys.filter((k) => k.includes(":epg"));

      const keysToRemove = [...cacheKeys, ...epgKeys];
      if (keysToRemove.length > 0) {
        for (const k of keysToRemove) {
          mmkv.delete(k);
        }
        console.warn(`🧹 [SafeStorage] Evicted ${keysToRemove.length} cache/EPG keys.`);
      }
    } catch (e) {
      console.warn("Failed during cache cleanup:", e);
    }
  },
};

export const AsyncStorage = safeStorage;
export default safeStorage;
