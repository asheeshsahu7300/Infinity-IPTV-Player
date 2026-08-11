// src/services/requestManager.ts
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { CACHE_REJECT } from "./cacheManager";
import { NetworkActivity } from "./networkActivity";

interface PendingRequest<T> {
  promise: Promise<T>;
  timestamp: number;
}

class RequestManager {
  private pendingRequests = new Map<string, PendingRequest<any>>();
  private requestQueue: Array<() => Promise<any>> = [];
  private isProcessing = false;
  private maxConcurrent = 5;
  private activeRequests = 0;

  /**
   * Deduplicated request with built-in cache-awareness
   * ✅ Respects CACHE_REJECT
   * ✅ Auto-expires pending dedupe
   */
  async request<T>(
    key: string,
    executor: () => Promise<T>,
    ttl: number = 30_000
  ): Promise<T> {
    const now = Date.now();

    // 🔁 Check for active duplicate
    const pending = this.pendingRequests.get(key);
    if (pending && now - pending.timestamp < ttl) {
      return pending.promise;
    }

    // 🚀 Execute with cleanup.
    // Every deduplicated portal request funnels through here — portalApi,
    // xtreamApi and m3uApi all call it — so raising the shared in-flight counter
    // at this one point is what lets screens render a loading state instead of an
    // empty one while a fetch they did not start is still running. Deduped
    // callers that reuse a pending promise above deliberately do not re-count.
    NetworkActivity.begin();
    const promise = executor()
      .then((result) => {
        // 🛑 Skip cache if result is CACHE_REJECT
        if (result === CACHE_REJECT) {
          throw new Error(`Request rejected for cache key: ${key}`);
        }
        return result;
      })
      .finally(() => {
        NetworkActivity.end();
        // Auto-cleanup after TTL
        setTimeout(() => {
          if (this.pendingRequests.get(key)?.timestamp === now) {
            this.pendingRequests.delete(key);
          }
        }, ttl);
      });

    this.pendingRequests.set(key, { promise, timestamp: now });
    return promise;
  }

  /**
   * Priority-aware request queue
   * ✅ Concurrency-controlled
   * ✅ Backpressure-safe
   */
  async queueRequest<T>(
    executor: () => Promise<T>,
    priority: "high" | "normal" | "low" = "normal"
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task = async () => {
        try {
          this.activeRequests++;
          const result = await executor();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.activeRequests--;
          this.processQueue();
        }
      };

      // Enqueue by priority
      if (priority === "high") {
        this.requestQueue.unshift(task);
      } else if (priority === "low") {
        this.requestQueue.push(task);
      } else {
        // Insert in middle for "normal"
        const mid = Math.floor(this.requestQueue.length / 2);
        this.requestQueue.splice(mid, 0, task);
      }

      this.processQueue();
    });
  }

  /**
   * Smart retry logic with network-aware backoff
   * ✅ Skips retry on 4xx (client errors)
   * ✅ Aggressive retry on 5xx/network errors
   * ✅ Exponential backoff with jitter
   */
  async axiosWithRetry<T>(
    config: AxiosRequestConfig,
    retries: number = 3,
    baseDelay: number = 1_000
  ): Promise<AxiosResponse<T>> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await axios({
          timeout: 15_000,
          ...config,
        });

        // 🎯 Success: return immediately
        return response;
      } catch (error: any) {
        lastError = error;

        // 🔌 Network-level errors (retry always)
        const isNetworkError =
          !error.response ||
          error.code === "ECONNABORTED" ||
          error.code === "ENOTFOUND" ||
          error.message.includes("timeout") ||
          error.message.includes("network");

        // 🚫 Client errors (4xx) – never retry, EXCEPT for 419 (Page Expired) and 429 (Too Many Requests)
        if (
          error.response?.status &&
          error.response.status >= 400 &&
          error.response.status < 500 &&
          error.response.status !== 419 &&
          error.response.status !== 429
        ) {
          throw error;
        }

        // ✅ Retry only on 5xx, network issues, or specific 4xx (419, 429)
        const shouldRetry =
          attempt < retries &&
          (isNetworkError ||
            (error.response?.status &&
              (error.response.status >= 500 ||
                error.response.status === 419 ||
                error.response.status === 429)));

        if (!shouldRetry) break;

        // ⏳ Exponential backoff with jitter (prevents thundering herd)
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 100;
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    throw lastError;
  }

  /**
   * Concurrency controller
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.activeRequests >= this.maxConcurrent) return;
    if (this.requestQueue.length === 0) return;

    this.isProcessing = true;
    const task = this.requestQueue.shift()!;

    try {
      await task();
    } catch {
      // Errors handled in task itself
    } finally {
      this.isProcessing = false;
      if (this.requestQueue.length > 0) {
        this.processQueue(); // Chain next
      }
    }
  }

  /**
   * Cleanup utilities
   */
  clear(): void {
    this.pendingRequests.clear();
    this.requestQueue = [];
    this.activeRequests = 0;
  }

  clearByKey(keyPrefix: string): void {
    // Clear dedupe cache for a portal
    for (const key of this.pendingRequests.keys()) {
      if (key.includes(keyPrefix)) {
        this.pendingRequests.delete(key);
      }
    }
  }

  getStats() {
    return {
      pending: this.pendingRequests.size,
      queued: this.requestQueue.length,
      active: this.activeRequests,
      maxConcurrent: this.maxConcurrent,
    };
  }

  // ✅ New: Set concurrency limit dynamically
  setMaxConcurrent(limit: number) {
    this.maxConcurrent = Math.max(1, Math.min(20, limit));
  }
}

export const requestManager = new RequestManager();
