// src/services/AppBootManager.ts
// Centralized boot orchestration - hydration-before-render

import AsyncStorage from "@react-native-async-storage/async-storage";
import { safeStorage } from "./safeStorage";
import { usePortalStore, Portal } from "../store/portalStore";

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
            // 1. Read core metadata in parallel (Fast: < 30ms)
            const [portalsData, activePortalId, favoritesData] = await Promise.all([
                safeStorage.getItem("portals"),
                safeStorage.getItem("activePortalId"),
                safeStorage.getItem("favorites"),
            ]);

            const portals: Portal[] = portalsData ? JSON.parse(portalsData) : [];

            let activePortal: Portal | null = null;
            if (activePortalId) {
                activePortal = portals.find((p) => p.id === activePortalId) || null;
            }

            const store = usePortalStore.getState();
            usePortalStore.setState({ portals });

            if (favoritesData) {
                try {
                    const fav = JSON.parse(favoritesData);
                    usePortalStore.setState({ favorites: fav });
                } catch {}
            }

            if (activePortal) {
                usePortalStore.setState({
                    activePortal,
                    categories: activePortal.categories || [],
                });

                // MARK HYDRATED IMMEDIATELY so app UI renders instantly (< 50ms)
                usePortalStore.setState({ isHydrated: true });

                // Asynchronously load content data in background without freezing UI
                setTimeout(() => {
                    this.loadPortalDataFromStorage(activePortal!).catch(console.warn);
                }, 50);

            } else {
                usePortalStore.setState({ isHydrated: true });
            }

            this.isInitialized = true;

            return {
                isReady: true,
                hasActivePortal: !!activePortal,
                activePortal,
                error: null,
            };
        } catch (error: any) {
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
     * Load portal-scoped data in background without blocking initial app render
     */
    private async loadPortalDataFromStorage(portal: Portal): Promise<void> {
        try {
            const store = usePortalStore.getState();
            await store.loadPortalData(portal.id);

            const currentState = usePortalStore.getState();
            const hasData =
                currentState.categories.length > 0 ||
                currentState.channels.length > 0 ||
                currentState.vodItems.length > 0 ||
                currentState.series.length > 0;

            if (!hasData) {
                const { portalApi } = await import("./portalApi");
                await portalApi.warmPortalData(portal);
                await safeStorage.setItem(`portal:${portal.id}:lastSync`, Date.now().toString());
            } else {
                this.triggerBackgroundSync(portal).catch(console.warn);
            }
        } catch (e) {
            console.warn("Failed to load portal data from storage:", e);
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
                return;
            }

            // Import portalApi dynamically to avoid circular deps
            const { portalApi } = await import("./portalApi");

            // Warm portal data (this fetches and caches all content)
            await portalApi.warmPortalData(portal);

            // Update last sync time
            await AsyncStorage.setItem(lastSyncKey, now.toString());
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
