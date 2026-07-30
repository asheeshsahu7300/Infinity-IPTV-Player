import AsyncStorage from "@react-native-async-storage/async-storage";

export const safeStorage = {
  async setItem(key: string, value: string): Promise<boolean> {
    try {
      await AsyncStorage.setItem(key, value);
      return true;
    } catch (err: any) {
      console.warn(`[SafeStorage] Failed to set ${key}:`, err?.message || err);

      const isDiskFull =
        err?.code === 13 ||
        err?.message?.includes("SQLITE_FULL") ||
        err?.message?.includes("database or disk is full") ||
        err?.name === "QuotaExceededError";

      if (isDiskFull) {
        await this.handleSqliteFull();
        // Retry once if payload is under 1.5MB after clearing expired cache
        if (value.length < 1.5 * 1024 * 1024) {
          try {
            await AsyncStorage.setItem(key, value);
            return true;
          } catch {
            // Ignore secondary failure
          }
        }
      }
      return false;
    }
  },

  async getItem(key: string): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(key);
    } catch (err: any) {
      console.warn(`[SafeStorage] Failed to get ${key}:`, err?.message || err);
      return null;
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch (err: any) {
      console.warn(`[SafeStorage] Failed to remove ${key}:`, err?.message || err);
    }
  },

  async multiRemove(keys: string[]): Promise<void> {
    try {
      if (keys.length > 0) {
        await AsyncStorage.multiRemove(keys);
      }
    } catch (err: any) {
      console.warn(`[SafeStorage] Failed multiRemove:`, err?.message || err);
    }
  },

  async handleSqliteFull(): Promise<void> {
    console.warn("⚠️ [SafeStorage] Cleaning up storage to resolve SQLITE_FULL...");
    try {
      const keys = await AsyncStorage.getAllKeys();

      // 1. Evict disk cache keys (cache:*)
      const cacheKeys = keys.filter((k) => k.startsWith("cache:"));
      
      // 2. Evict EPG cache keys (portal:*:epg) which are very large
      const epgKeys = keys.filter((k) => k.includes(":epg"));

      const keysToRemove = [...cacheKeys, ...epgKeys];
      if (keysToRemove.length > 0) {
        await AsyncStorage.multiRemove(keysToRemove).catch(() => {});
        console.warn(`🧹 [SafeStorage] Evicted ${keysToRemove.length} cache/EPG keys.`);
      }
    } catch (e) {
      console.warn("Failed during SQLITE_FULL cleanup:", e);
    }
  },
};

export default safeStorage;
