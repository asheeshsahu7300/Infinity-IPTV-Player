// ─────────────────────────────────────────────────────────────────────────────
// safeStorage — key/value storage that survives its backend being unavailable.
//
// MMKV is the fast path and what this normally runs on. Since react-native-mmkv
// v4 it is built on Nitro modules, which means it needs native code compiled
// into the app: a JS-only update that adds or upgrades MMKV will throw on a
// binary that predates it, with "The native NitroModules Turbo/Native-Module
// could not be found".
//
// That throw happens while `react-native-mmkv` is being *imported*, not when
// its factory is called — so a static `import` of it cannot be guarded. It took
// the whole app down at boot, because the store imports this module and every
// screen imports the store. Hence the `require` below: a lazy load is the only
// kind this file can actually catch.
//
// When MMKV is unavailable the fallback is AsyncStorage rather than a Map. Both
// keep the app running, but AsyncStorage keeps the data too — it needs no new
// architecture, it is already what portals are stored in, so it is known to
// work on any binary that can run this bundle at all. An in-memory fallback
// looks fine for one session and quietly loses every portal, PIN and resume
// point on restart, which is a worse failure than the crash it replaces.
// ─────────────────────────────────────────────────────────────────────────────
import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";

/** The subset of MMKV this module uses. Sync, as MMKV is. */
interface SyncBackend {
  set: (key: string, value: string) => void;
  getString: (key: string) => string | undefined;
  remove: (key: string) => void;
  getAllKeys: () => string[];
  clearAll: () => void;
  contains: (key: string) => boolean;
}

/** The uniform shape the public API is written against. */
interface Backend {
  name: "mmkv" | "async-storage";
  /** True when writes outlive the process. Both backends persist. */
  persistent: boolean;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  multiGet(keys: string[]): Promise<readonly [string, string | null][]>;
  multiSet(pairs: [string, string][]): Promise<void>;
  multiRemove(keys: string[]): Promise<void>;
  allKeys(): Promise<string[]>;
  clearAll(): Promise<void>;
}

function mmkvBackend(instance: SyncBackend): Backend {
  return {
    name: "mmkv",
    persistent: true,
    async get(key) {
      const value = instance.getString(key);
      return value !== undefined ? value : null;
    },
    async set(key, value) {
      instance.set(key, value);
    },
    async remove(key) {
      instance.remove(key);
    },
    async multiGet(keys) {
      return keys.map((key) => {
        const value = instance.getString(key);
        return [key, value !== undefined ? value : null] as [string, string | null];
      });
    },
    async multiSet(pairs) {
      for (const [key, value] of pairs) instance.set(key, value);
    },
    async multiRemove(keys) {
      for (const key of keys) instance.remove(key);
    },
    async allKeys() {
      return instance.getAllKeys();
    },
    async clearAll() {
      instance.clearAll();
    },
  };
}

function asyncStorageBackend(): Backend {
  return {
    name: "async-storage",
    persistent: true,
    get: (key) => ReactNativeAsyncStorage.getItem(key),
    set: (key, value) => ReactNativeAsyncStorage.setItem(key, value),
    remove: (key) => ReactNativeAsyncStorage.removeItem(key),
    multiGet: (keys) => ReactNativeAsyncStorage.multiGet(keys),
    multiSet: (pairs) => ReactNativeAsyncStorage.multiSet(pairs),
    multiRemove: (keys) => ReactNativeAsyncStorage.multiRemove(keys),
    // AsyncStorage hands back a readonly array; the callers here expect a
    // plain one they can filter.
    allKeys: async () => Array.from(await ReactNativeAsyncStorage.getAllKeys()),
    clearAll: () => ReactNativeAsyncStorage.clear(),
  };
}

function selectBackend(): Backend {
  try {
    // Deliberately a `require`, not an `import` — see the note at the top.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createMMKV } = require("react-native-mmkv");
    return mmkvBackend(createMMKV() as SyncBackend);
  } catch (err: any) {
    console.warn(
      "[SafeStorage] MMKV is unavailable — falling back to AsyncStorage. " +
      "Data still persists, but writes are slower. On a device this almost " +
      "always means the installed app was built before react-native-mmkv v4 " +
      "and its Nitro native module: rebuild the native app to restore it. " +
      `Reason: ${err?.message || err}`
    );
    return asyncStorageBackend();
  }
}

const backend = selectBackend();

/** Which store is in use, for diagnostics such as the System Info screen. */
export const storageBackend = backend.name;
export const isStoragePersistent = backend.persistent;

export const safeStorage = {
  async setItem(key: string, value: string): Promise<boolean> {
    try {
      await backend.set(key, value);
      return true;
    } catch (err: any) {
      console.warn(`[SafeStorage] Failed to set ${key}:`, err?.message || err);
      return false;
    }
  },

  async getItem(key: string): Promise<string | null> {
    try {
      return await backend.get(key);
    } catch (err: any) {
      console.warn(`[SafeStorage] Failed to get ${key}:`, err?.message || err);
      return null;
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      await backend.remove(key);
    } catch (err: any) {
      console.warn(`[SafeStorage] Failed to remove ${key}:`, err?.message || err);
    }
  },

  async multiRemove(keys: string[]): Promise<void> {
    try {
      await backend.multiRemove(keys);
    } catch (err: any) {
      console.warn(`[SafeStorage] Failed multiRemove:`, err?.message || err);
    }
  },

  async multiSet(pairs: [string, string][]): Promise<void> {
    try {
      await backend.multiSet(pairs);
    } catch (err: any) {
      console.warn(`[SafeStorage] Failed multiSet:`, err?.message || err);
    }
  },

  async multiGet(keys: string[]): Promise<readonly [string, string | null][]> {
    try {
      return await backend.multiGet(keys);
    } catch (err: any) {
      console.warn(`[SafeStorage] Failed multiGet:`, err?.message || err);
      return keys.map((key) => [key, null]);
    }
  },

  async getAllKeys(): Promise<string[]> {
    try {
      return await backend.allKeys();
    } catch (err: any) {
      console.warn(`[SafeStorage] Failed getAllKeys:`, err?.message || err);
      return [];
    }
  },

  async clear(): Promise<void> {
    try {
      await backend.clearAll();
    } catch (err: any) {
      console.warn(`[SafeStorage] Failed clear:`, err?.message || err);
    }
  },

  async clearAll(): Promise<void> {
    try {
      await backend.clearAll();
    } catch (err: any) {
      console.warn(`[SafeStorage] Failed clearAll:`, err?.message || err);
    }
  },

  async handleSqliteFull(): Promise<void> {
    console.warn(`⚠️ [SafeStorage] Cleaning up cache/EPG keys in ${backend.name}...`);
    try {
      const keys = await backend.allKeys();
      const keysToRemove = keys.filter(
        (k) => k.startsWith("cache:") || k.includes(":epg")
      );
      if (keysToRemove.length > 0) {
        await backend.multiRemove(keysToRemove);
        console.warn(`🧹 [SafeStorage] Evicted ${keysToRemove.length} cache/EPG keys.`);
      }
    } catch (e) {
      console.warn("Failed during cache cleanup:", e);
    }
  },
};

export const AsyncStorage = safeStorage;
export default safeStorage;
