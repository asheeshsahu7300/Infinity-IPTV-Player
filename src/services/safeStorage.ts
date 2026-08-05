import { MMKV } from "react-native-mmkv";
import { Platform } from "react-native";

let storage: MMKV | null = null;
const fallbackStorage = new Map<string, string>();

try {
  // Expo Go on iOS/Android does not support native JSI modules like MMKV.
  // We initialize MMKV only in native builds and fallback to a memory map in Expo Go.
  storage = new MMKV();
} catch (error) {
  console.warn("MMKV initialization failed. Falling back to memory storage.", error);
}

export const safeStorage = {
  setItem: async (key: string, value: string): Promise<void> => {
    if (storage) {
      storage.set(key, value);
    } else {
      fallbackStorage.set(key, value);
    }
  },
  getItem: async (key: string): Promise<string | null> => {
    if (storage) {
      return storage.getString(key) ?? null;
    } else {
      return fallbackStorage.get(key) ?? null;
    }
  },
  removeItem: async (key: string): Promise<void> => {
    if (storage) {
      storage.delete(key);
    } else {
      fallbackStorage.delete(key);
    }
  },
  getAllKeys: async (): Promise<readonly string[]> => {
    if (storage) {
      return storage.getAllKeys();
    } else {
      return Array.from(fallbackStorage.keys());
    }
  },
  multiRemove: async (keys: string[]): Promise<void> => {
    if (storage) {
      keys.forEach((k) => storage!.delete(k));
    } else {
      keys.forEach((k) => fallbackStorage.delete(k));
    }
  },
};
