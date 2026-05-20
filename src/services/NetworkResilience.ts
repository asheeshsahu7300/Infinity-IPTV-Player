// src/services/NetworkResilience.ts
// Network state management with auto-recovery

import NetInfo, { NetInfoState, NetInfoSubscription } from "@react-native-community/netinfo";
import { AppState, AppStateStatus } from "react-native";

export interface RetryOptions {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    shouldRetry?: (error: any, attempt: number) => boolean;
}

interface QueuedRequest {
    id: string;
    executor: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (error: any) => void;
    options?: RetryOptions;
}

type NetworkChangeCallback = (isConnected: boolean) => void;

class NetworkResilienceClass {
    private isConnected = true;
    private listeners: Set<NetworkChangeCallback> = new Set();
    private netInfoSubscription: NetInfoSubscription | null = null;
    private appStateSubscription: any = null;
    private offlineQueue: QueuedRequest[] = [];
    private isProcessingQueue = false;

    constructor() {
        this.initialize();
    }

    /**
     * Initialize network monitoring
     */
    private initialize(): void {
        // Subscribe to network state changes
        this.netInfoSubscription = NetInfo.addEventListener((state: NetInfoState) => {
            const wasConnected = this.isConnected;
            this.isConnected = state.isConnected ?? false;

            // Notify listeners
            if (wasConnected !== this.isConnected) {
                console.log(`📡 Network: ${this.isConnected ? "Connected" : "Disconnected"}`);
                this.listeners.forEach((callback) => callback(this.isConnected));

                // Process offline queue when back online
                if (this.isConnected && this.offlineQueue.length > 0) {
                    this.processOfflineQueue();
                }
            }
        });

        // Also refresh on app resume
        this.appStateSubscription = AppState.addEventListener("change", (state: AppStateStatus) => {
            if (state === "active") {
                NetInfo.fetch().then((netState) => {
                    this.isConnected = netState.isConnected ?? false;
                });
            }
        });
    }

    /**
     * Subscribe to network changes
     */
    onNetworkChange(callback: NetworkChangeCallback): () => void {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    /**
     * Get current connection status
     */
    get connected(): boolean {
        return this.isConnected;
    }

    /**
     * Execute a function with automatic retry on failure
     */
    async withRetry<T>(
        fn: () => Promise<T>,
        options: RetryOptions = {}
    ): Promise<T> {
        const {
            maxRetries = 3,
            baseDelayMs = 1000,
            maxDelayMs = 10000,
            shouldRetry = () => true,
        } = options;

        let lastError: any;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error: any) {
                lastError = error;

                // Check if we should retry
                const isNetworkError = this.isNetworkError(error);
                const canRetry = attempt < maxRetries && (isNetworkError || shouldRetry(error, attempt));

                if (!canRetry) {
                    throw error;
                }

                // If offline, wait for connection
                if (!this.isConnected) {
                    console.log("⏳ Waiting for network connection...");
                    await this.waitForConnection(30000); // 30s timeout
                }

                // Exponential backoff with jitter
                const delay = Math.min(
                    baseDelayMs * Math.pow(2, attempt) + Math.random() * 500,
                    maxDelayMs
                );

                console.log(`🔄 Retry attempt ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms`);
                await this.sleep(delay);
            }
        }

        throw lastError;
    }

    /**
     * Queue a request to be executed when back online
     */
    queueForRetry<T>(
        id: string,
        executor: () => Promise<T>,
        options?: RetryOptions
    ): Promise<T> {
        return new Promise((resolve, reject) => {
            // If already online, execute immediately
            if (this.isConnected) {
                this.withRetry(executor, options).then(resolve).catch(reject);
                return;
            }

            // Queue for later
            this.offlineQueue.push({
                id,
                executor,
                resolve,
                reject,
                options,
            });

            console.log(`📥 Queued request: ${id} (${this.offlineQueue.length} in queue)`);
        });
    }

    /**
     * Process queued offline requests
     */
    private async processOfflineQueue(): Promise<void> {
        if (this.isProcessingQueue || this.offlineQueue.length === 0) return;

        this.isProcessingQueue = true;
        console.log(`📤 Processing ${this.offlineQueue.length} queued requests...`);

        while (this.offlineQueue.length > 0 && this.isConnected) {
            const request = this.offlineQueue.shift()!;

            try {
                const result = await this.withRetry(request.executor, request.options);
                request.resolve(result);
            } catch (error) {
                request.reject(error);
            }
        }

        this.isProcessingQueue = false;
        console.log("✅ Offline queue processed");
    }

    /**
     * Wait for network connection with timeout
     */
    private waitForConnection(timeoutMs: number): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.isConnected) {
                resolve();
                return;
            }

            const timeout = setTimeout(() => {
                unsubscribe();
                reject(new Error("Network connection timeout"));
            }, timeoutMs);

            const unsubscribe = this.onNetworkChange((connected) => {
                if (connected) {
                    clearTimeout(timeout);
                    unsubscribe();
                    resolve();
                }
            });
        });
    }

    /**
     * Check if an error is network-related
     */
    private isNetworkError(error: any): boolean {
        if (!error) return false;

        const message = error.message?.toLowerCase() || "";
        const code = error.code?.toLowerCase() || "";

        return (
            !error.response || // No response = network issue
            code === "econnaborted" ||
            code === "enotfound" ||
            code === "enetunreach" ||
            message.includes("network") ||
            message.includes("timeout") ||
            message.includes("connection")
        );
    }

    /**
     * Utility sleep function
     */
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Cleanup subscriptions
     */
    destroy(): void {
        this.netInfoSubscription?.();
        this.appStateSubscription?.remove();
        this.listeners.clear();
        this.offlineQueue = [];
    }
}

export const NetworkResilience = new NetworkResilienceClass();
