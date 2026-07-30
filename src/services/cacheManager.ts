// cacheManager.ts (fully fixed)
import AsyncStorage from "@react-native-async-storage/async-storage";
import { safeStorage } from "./safeStorage";
import pako from "pako";

export const CACHE_TTL = {
  AUTH: 55 * 60 * 1000,
  XTREAM_AUTH: 5 * 60 * 1000,
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

  // Note: base64 padding characters ('=') resolve to index -1, which bitwise shifts
  // to garbage values. However, outputLen is calculated to exclude padding bytes,
  // so outIndex bounds checking ensures these garbage bits are never written to u8.
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
      // RN-safe UTF-8 byte length estimation (avoids engine-inconsistent Blob polyfills)
      return encodeURIComponent(str).replace(/%[89AB][0-9A-F]/gi, "2").length;
    } catch {
      return 1024; // fallback
    }
  }

  set<T>(key: string, data: T, ttl: number): void {
    const expiry = Date.now() + ttl;
    const size = this.estimateSize(data);

    // Skip storing single items larger than max RAM size in memory cache (diskCache handles them)
    if (size > this.maxSize) return;

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
  async set<T>(_key: string, _data: T, _ttl: number): Promise<void> {
    // Disk caching disabled per user request
    return;
  }

  async get<T>(_key: string): Promise<T | null> {
    return null;
  }

  async getRaw<T>(_key: string): Promise<CacheEntry<T> | null> {
    return null;
  }

  async has(_key: string): Promise<boolean> {
    return false;
  }

  async remove(_key: string): Promise<void> {}

  async clear(): Promise<void> {}

  async clearExpired(): Promise<void> {}

  async removeByPrefix(_prefix: string): Promise<void> {}
}

class CacheManager {
  private memoryCache = new MemoryCache(50);
  private diskCache = new DiskCache();
  private warmingPromises = new Map<string, Promise<any>>();

  async set<T>(key: string, data: T, ttl: number): Promise<void> {
    this.memoryCache.set(key, data, ttl);
    await this.diskCache.set(key, data, ttl);
  }

  async get<T>(key: string): Promise<T | null> {
    const mem = this.memoryCache.get<T>(key);
    if (mem !== null) return mem;

    const disk = await this.diskCache.getRaw<T>(key);
    if (disk !== null) {
      // Preserve remaining TTL from the disk entry so memory expiry matches disk expiry
      const remainingTtl = Math.max(0, disk.expiry - Date.now());
      if (remainingTtl > 0) {
        this.memoryCache.set(key, disk.data, remainingTtl);
        return disk.data;
      }
      // Entry expired — clean it up
      await this.diskCache.remove(key);
      return null;
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
    if (this.warmingPromises.has(key)) {
      return this.warmingPromises.get(key)!;
    }

    const promise = (async () => {
      try {
        const data = await loader();
        await this.set(key, data, ttl);
        return data;
      } catch (e) {
        console.warn("Warm failed:", e);
        throw e;
      } finally {
        this.warmingPromises.delete(key);
      }
    })();

    this.warmingPromises.set(key, promise);
    return promise;
  }

  getStats() {
    return {
      memory: this.memoryCache.getStats(),
      warming: this.warmingPromises.size,
    };
  }
}

export const cacheManager = new CacheManager();