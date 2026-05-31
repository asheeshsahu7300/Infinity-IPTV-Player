// cacheManager.ts (fully fixed)
import AsyncStorage from "@react-native-async-storage/async-storage";
import pako from "pako";

export const CACHE_TTL = {
  AUTH: 55 * 60 * 1000,
  CATEGORIES: 24 * 60 * 60 * 1000,
  CHANNELS: 12 * 60 * 60 * 1000,
  VOD: 6 * 60 * 60 * 1000,
  SERIES: 6 * 60 * 60 * 1000,
  SERIES_INFO: 12 * 60 * 60 * 1000,
  STREAM_URL: 5 * 60 * 1000,
  EPG: 30 * 60 * 1000,
  SEARCH_INDEX: 24 * 60 * 60 * 1000,
};

// Symbol used to signal that cache should be rejected
export const CACHE_REJECT = Symbol("CACHE_REJECT");

function uint8ToBase64(u8: Uint8Array): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let i = 0; i < u8.length; i += 3) {
    const a = u8[i];
    const b = i + 1 < u8.length ? u8[i + 1] : 0;
    const c = i + 2 < u8.length ? u8[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    result += chars[(triple >> 18) & 0x3f];
    result += chars[(triple >> 12) & 0x3f];
    result += i + 1 < u8.length ? chars[(triple >> 6) & 0x3f] : "=";
    result += i + 2 < u8.length ? chars[triple & 0x3f] : "=";
  }
  return result;
}

function base64ToUint8(b64: string): Uint8Array {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const cleaned = b64.replace(/[^A-Za-z0-9+/=]/g, "");
  const len = cleaned.length;
  const placeholderChars = cleaned.endsWith("==")
    ? 2
    : cleaned.endsWith("=")
      ? 1
      : 0;
  const outputLen = (len * 3) / 4 - placeholderChars;
  const u8 = new Uint8Array(outputLen | 0);
  let outIndex = 0;

  for (let i = 0; i < len; i += 4) {
    const c1 = chars.indexOf(cleaned.charAt(i));
    const c2 = chars.indexOf(cleaned.charAt(i + 1));
    const c3 = chars.indexOf(cleaned.charAt(i + 2));
    const c4 = chars.indexOf(cleaned.charAt(i + 3));

    const triple = (c1 << 18) | (c2 << 12) | ((c3 & 63) << 6) | (c4 & 63);

    if (outIndex < u8.length) u8[outIndex++] = (triple >> 16) & 0xff;
    if (outIndex < u8.length) u8[outIndex++] = (triple >> 8) & 0xff;
    if (outIndex < u8.length) u8[outIndex++] = triple & 0xff;
  }
  return u8;
}

interface CacheEntry<T> {
  data: T;
  expiry: number;
  timestamp: number;
  size: number;
}

interface LRUNode<T> {
  key: string;
  value: CacheEntry<T>;
  prev: LRUNode<T> | null;
  next: LRUNode<T> | null;
}

class MemoryCache {
  private cache = new Map<string, LRUNode<any>>();
  private head: LRUNode<any> | null = null;
  private tail: LRUNode<any> | null = null;
  private maxSize: number;
  private currentSize: number = 0;

  constructor(maxSizeMB: number = 50) {
    this.maxSize = maxSizeMB * 1024 * 1024;
  }

  private estimateSize(data: any): number {
    try {
      const str = JSON.stringify(data);
      return new Blob([str]).size; // accurate byte size
    } catch {
      return 1024; // fallback
    }
  }

  set<T>(key: string, data: T, ttl: number): void {
    const expiry = Date.now() + ttl;
    const size = this.estimateSize(data);
    const entry: CacheEntry<T> = { data, expiry, timestamp: Date.now(), size };

    if (this.cache.has(key)) {
      this.remove(key);
    }

    while (this.currentSize + size > this.maxSize && this.tail) {
      this.evictLRU();
    }

    const node: LRUNode<T> = { key, value: entry, prev: null, next: null };
    this.cache.set(key, node);
    this.addToHead(node);
    this.currentSize += size;
  }

  get<T>(key: string): T | null {
    const node = this.cache.get(key);
    if (!node) return null;

    if (node.value.expiry < Date.now()) {
      this.remove(key);
      return null;
    }

    this.moveToHead(node);
    return node.value.data as T;
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  remove(key: string): void {
    const node = this.cache.get(key);
    if (!node) return;

    this.removeNode(node);
    this.cache.delete(key);
    this.currentSize -= node.value.size;
  }

  clear(): void {
    this.cache.clear();
    this.head = null;
    this.tail = null;
    this.currentSize = 0;
  }

  clearExpired(): void {
    const now = Date.now();
    const toRemove: string[] = [];
    this.cache.forEach((node, key) => {
      if (node.value.expiry < now) toRemove.push(key);
    });
    toRemove.forEach((key) => this.remove(key));
  }

  removeByPrefix(prefix: string): void {
    const toRemove: string[] = [];
    this.cache.forEach((_, key) => {
      if (key.startsWith(prefix)) toRemove.push(key);
    });
    toRemove.forEach((key) => this.remove(key));
  }

  private addToHead(node: LRUNode<any>): void {
    node.next = this.head;
    node.prev = null;
    if (this.head) this.head.prev = node;
    this.head = node;
    if (!this.tail) this.tail = node;
  }

  private removeNode(node: LRUNode<any>): void {
    if (node.prev) node.prev.next = node.next;
    else this.head = node.next;

    if (node.next) node.next.prev = node.prev;
    else this.tail = node.prev;
  }

  private moveToHead(node: LRUNode<any>): void {
    this.removeNode(node);
    this.addToHead(node);
  }

  private evictLRU(): void {
    if (!this.tail) return;
    this.remove(this.tail.key);
  }

  getStats() {
    return {
      size: this.cache.size,
      currentSize: this.currentSize,
      maxSize: this.maxSize,
    };
  }
}

class DiskCache {
  private prefix = "cache:";

  async set<T>(key: string, data: T, ttl: number): Promise<void> {
    try {
      const entry: CacheEntry<T> = {
        data,
        expiry: Date.now() + ttl,
        timestamp: Date.now(),
        size: 0,
      };
      const serialized = JSON.stringify(entry);
      const storageKey = this.prefix + key;

      if (serialized.length > 10000) {
        const compressed = pako.gzip(serialized);
        const b64 = uint8ToBase64(compressed);
        await AsyncStorage.setItem(storageKey, `gz:${b64}`);
      } else {
        await AsyncStorage.setItem(storageKey, `raw:${serialized}`);
      }
    } catch (e) {
      console.warn("DiskCache set failed:", e);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const storageKey = this.prefix + key;
      const value = await AsyncStorage.getItem(storageKey);
      if (!value) return null;

      let json: string;
      if (value.startsWith("gz:")) {
        const b64 = value.slice(3);
        const u8 = base64ToUint8(b64);
        json = pako.ungzip(u8, { to: "string" });
      } else if (value.startsWith("raw:")) {
        json = value.slice(4);
      } else {
        json = value;
      }

      const entry = JSON.parse(json) as CacheEntry<T>;
      if (entry.expiry < Date.now()) {
        await this.remove(key);
        return null;
      }
      return entry.data;
    } catch (e) {
      console.warn("DiskCache get failed:", e);
      return null;
    }
  }

  async has(key: string): Promise<boolean> {
    return !!(await this.get(key));
  }

  async remove(key: string): Promise<void> {
    await AsyncStorage.removeItem(this.prefix + key).catch(console.warn);
  }

  async clear(): Promise<void> {
    const keys = await AsyncStorage.getAllKeys();
    const toRemove = keys.filter((k) => k.startsWith(this.prefix));
    await AsyncStorage.multiRemove(toRemove).catch(console.warn);
  }

  async clearExpired(): Promise<void> {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter((k) => k.startsWith(this.prefix));
    for (const key of cacheKeys) {
      await this.get(key.replace(this.prefix, "")); // get removes expired
    }
  }

  async removeByPrefix(prefix: string): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const targetPrefix = this.prefix + prefix;
      const toRemove = keys.filter((k) => k.startsWith(targetPrefix));
      if (toRemove.length > 0) {
        await AsyncStorage.multiRemove(toRemove);
      }
    } catch (e) {
      console.warn("DiskCache removeByPrefix failed:", e);
    }
  }
}

class CacheManager {
  private memoryCache = new MemoryCache(50);
  private diskCache = new DiskCache();
  private warmingKeys = new Set<string>();

  async set<T>(key: string, data: T, ttl: number): Promise<void> {
    this.memoryCache.set(key, data, ttl);
    await this.diskCache.set(key, data, ttl);
  }

  async get<T>(key: string): Promise<T | null> {
    const mem = this.memoryCache.get<T>(key);
    if (mem !== null) return mem;

    const disk = await this.diskCache.get<T>(key);
    if (disk !== null) {
      this.memoryCache.set(key, disk, CACHE_TTL.CHANNELS); // default TTL
      return disk;
    }
    return null;
  }

  async has(key: string): Promise<boolean> {
    return this.memoryCache.has(key) || (await this.diskCache.has(key));
  }

  async remove(key: string): Promise<void> {
    this.memoryCache.remove(key);
    await this.diskCache.remove(key);
  }

  async clearAll(): Promise<void> {
    this.memoryCache.clear();
    await this.diskCache.clear();
  }

  async clearExpired(): Promise<void> {
    this.memoryCache.clearExpired();
    await this.diskCache.clearExpired();
  }

  clearPortal(portalId: string): void {
    // Deprecated in favor of removeByPrefix with specific patterns
    this.removeByPrefix(portalId);
  }

  async removeByPrefix(prefix: string): Promise<void> {
    this.memoryCache.removeByPrefix(prefix);
    await this.diskCache.removeByPrefix(prefix);
  }

  async warm<T>(
    key: string,
    loader: () => Promise<T>,
    ttl: number
  ): Promise<T> {
    if (this.warmingKeys.has(key)) {
      await new Promise((r) => setTimeout(r, 200));
      const cached = await this.get<T>(key);
      if (cached !== null) return cached;
    }

    this.warmingKeys.add(key);
    try {
      const data = await loader();
      await this.set(key, data, ttl);
      return data;
    } catch (e) {
      console.warn("Warm failed:", e);
      throw e;
    } finally {
      this.warmingKeys.delete(key);
    }
  }

  getStats() {
    return {
      memory: this.memoryCache.getStats(),
      warming: this.warmingKeys.size,
    };
  }
}

export const cacheManager = new CacheManager();