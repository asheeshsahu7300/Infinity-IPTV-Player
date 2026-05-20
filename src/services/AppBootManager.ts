// src/services/AppBootManager.ts
// Centralized boot orchestration - hydration-before-render

import AsyncStorage from "@react-native-async-storage/async-storage";
import { usePortalStore, Portal } from "../store/portalStore";
import { cacheManager } from "./cacheManager";

export interface BootResult {
    isReady: boolean;
    hasActivePortal: boolean;
    activePortal: Portal | null;
    error: string | null;
}

class AppBootManagerClass {
    private isInitialized = false;
    private bootPromise: Promise<BootResult> | null = null;

    /**
     * Initialize the app - hydrate store from AsyncStorage before any UI renders.
     * This is idempotent - calling multiple times returns the same promise.
     */
    async initialize(): Promise<BootResult> {
        // Return existing promise if already initializing/initialized
        if (this.bootPromise) {
            return this.bootPromise;
        }

        this.bootPromise = this._doInitialize();
        return this.bootPromise;
    }

    private async _doInitialize(): Promise<BootResult> {
        try {
            console.log("🚀 AppBootManager: Starting initialization...");

            // 1. Load all portals from AsyncStorage
            const portalsData = await AsyncStorage.getItem("portals");
            const portals: Portal[] = portalsData ? JSON.parse(portalsData) : [];

            // 2. Load active portal ID
            const activePortalId = await AsyncStorage.getItem("activePortalId");

            // 3. Find active portal
            let activePortal: Portal | null = null;
            if (activePortalId) {
                activePortal = portals.find((p) => p.id === activePortalId) || null;
            }

            // 4. Hydrate the store synchronously
            const store = usePortalStore.getState();

            // Set portals list
            usePortalStore.setState({ portals });

            if (activePortal) {
                // Set active portal
                usePortalStore.setState({ activePortal });

                // 5. Load all cached content data for this portal
                await this.loadPortalDataFromStorage(activePortal);

                // Check if we effectively loaded data
                const currentState = usePortalStore.getState();
                const hasData =
                    currentState.categories.length > 0 ||
                    currentState.channels.length > 0 ||
                    currentState.vodItems.length > 0 ||
                    currentState.series.length > 0;

                if (!hasData) {
                    console.log("⚠️ No cached data found. Fetching from network (blocking)...");
                    try {
                        const { portalApi } = await import("./portalApi");
                        await portalApi.warmPortalData(activePortal);
                        console.log("✅ Network warming complete.");
                    } catch (e) {
                        console.warn("❌ Network warming failed during boot:", e);
                    }
                } else {
                    // If we have data, we can trigger a background sync update without blocking
                    this.triggerBackgroundSync(activePortal).catch(console.warn);
                }

                // 6. Load favorites
                await store.loadFavorites();

                // 7. Mark hydration complete
                usePortalStore.setState({ isHydrated: true });

                console.log("✅ AppBootManager: Initialized with active portal:", activePortal.name);
            } else {
                // No active portal - mark hydrated anyway
                usePortalStore.setState({ isHydrated: true });
                console.log("✅ AppBootManager: Initialized without active portal");
            }

            this.isInitialized = true;

            return {
                isReady: true,
                hasActivePortal: !!activePortal,
                activePortal,
                error: null,
            };
        } catch (error: any) {
            console.error("❌ AppBootManager: Initialization failed:", error);

            // Even on error, mark as hydrated so UI can render
            usePortalStore.setState({ isHydrated: true });

            return {
                isReady: true,
                hasActivePortal: false,
                activePortal: null,
                error: error.message || "Boot failed",
            };
        }
    }

    /**
     * Load all portal-scoped data from cacheManager into the store
     * Uses portalApi.restoreCachedPortalData() which has the correct cache keys
     */
    private async loadPortalDataFromStorage(portal: Portal): Promise<void> {
        try {
            // Import portalApi dynamically to avoid circular deps
            const { portalApi } = await import("./portalApi");

            // Use portalApi's restore function which uses correct cache keys
            await portalApi.restoreCachedPortalData(portal);

            console.log("📦 Loaded cached portal data from cacheManager");
        } catch (e) {
            console.warn("Failed to load portal data from cache:", e);
        }
    }

    /**
     * Background sync - refresh portal data silently without blocking UI
     */
    private async triggerBackgroundSync(portal: Portal): Promise<void> {
        try {
            // Check last sync time
            const lastSyncKey = `portal:${portal.id}:lastSync`;
            const lastSyncStr = await AsyncStorage.getItem(lastSyncKey);
            const lastSync = lastSyncStr ? parseInt(lastSyncStr, 10) : 0;
            const now = Date.now();

            // Only sync if last sync was more than 30 minutes ago
            const SYNC_INTERVAL = 30 * 60 * 1000; // 30 minutes
            if (now - lastSync < SYNC_INTERVAL) {
                console.log("⏭️ Skipping background sync - recently synced");
                return;
            }

            console.log("🔄 Starting background sync...");

            // Import portalApi dynamically to avoid circular deps
            const { portalApi } = await import("./portalApi");

            // Warm portal data (this fetches and caches all content)
            await portalApi.warmPortalData(portal);

            // Update last sync time
            await AsyncStorage.setItem(lastSyncKey, now.toString());

            console.log("✅ Background sync complete");
        } catch (e) {
            console.warn("Background sync failed (non-fatal):", e);
        }
    }

    /**
     * Force a full refresh of portal data
     */
    async forceRefresh(portal: Portal): Promise<void> {
        // Clear last sync time to force refresh
        await AsyncStorage.removeItem(`portal:${portal.id}:lastSync`);
        await this.triggerBackgroundSync(portal);
    }

    /**
     * Reset the boot manager (for logout/portal switch)
     */
    reset(): void {
        this.isInitialized = false;
        this.bootPromise = null;
    }

    get initialized(): boolean {
        return this.isInitialized;
    }
}

export const AppBootManager = new AppBootManagerClass();
