// src/services/AppBootManager.ts
// Centralized boot orchestration - hydration-before-render

import { safeStorage } from "./safeStorage";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { usePortalStore, Portal, PortalState } from "../store/portalStore";

export interface BootResult {
    isReady: boolean;
    hasActivePortal: boolean;
    activePortal: Portal | null;
    error: string | null;
}

/** Minimum gap between background portal refreshes. */
export const SYNC_INTERVAL = 30 * 60 * 1000;

class AppBootManagerClass {
    private isInitialized = false;
    private bootPromise: Promise<BootResult> | null = null;
    private syncPromises = new Map<string, Promise<void>>();

    /**
     * Initialize the app - hydrate store from MMKV storage before any UI renders.
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
                AsyncStorage.getItem("portals"),
                AsyncStorage.getItem("activePortalId"),
                safeStorage.getItem("favorites"),
            ]);

            const portals: Portal[] = portalsData ? JSON.parse(portalsData) : [];

            let activePortal: Portal | null = null;
            if (activePortalId) {
                activePortal = portals.find((p) => p.id === activePortalId) || null;
            }

            let favorites: PortalState["favorites"] | null = null;
            if (favoritesData) {
                try {
                    favorites = JSON.parse(favoritesData);
                } catch { }
            }

            // One commit for the whole hydration. Separate setState calls meant
            // the first screen rendered two or three times before boot finished.
            usePortalStore.setState({
                portals,
                ...(favorites ? { favorites } : {}),
                ...(activePortal
                    ? { activePortal, categories: activePortal.categories || [] }
                    : {}),
                isHydrated: true,
            });

            if (activePortal) {
                // Read the content cache immediately — no setTimeout. The old
                // 50ms delay let the first screen mount against empty lists and
                // then swap data in underneath it, which showed up as a flash of
                // "0 items" and reset the grid's focus.
                this.loadPortalDataFromStorage(activePortal).catch(console.warn);
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
            const hasContent =
                currentState.channels.length > 0 ||
                currentState.vodItems.length > 0 ||
                currentState.series.length > 0;

            // With content on screen the refresh is optional, so it goes through
            // the 30-minute gate. With nothing to show it is the only way to get
            // content, so it runs now and bypasses the gate.
            await this.triggerBackgroundSync(portal, !hasContent);
        } catch (e) {
            console.warn("Failed to load portal data from storage:", e);
        }
    }

    /**
     * Background sync - refresh portal data silently without blocking UI.
     * `force` skips the interval gate (used when there is no cached content).
     */
    async triggerBackgroundSync(portal: Portal, force = false): Promise<void> {
        const lastSyncKey = `portal:${portal.id}:lastSync`;

        // A single in-flight sync per portal. Boot, app-resume and the 30-minute
        // timer can all fire within the same second; letting each start its own
        // MAG handshake was a large part of the slow, stuttery startup.
        const existing = this.syncPromises.get(portal.id);
        if (existing) return existing;

        const run = (async () => {
            try {
                if (!force) {
                    const lastSyncStr = await AsyncStorage.getItem(lastSyncKey);
                    const lastSync = lastSyncStr ? parseInt(lastSyncStr, 10) : 0;
                    if (Date.now() - lastSync < SYNC_INTERVAL) return;
                }

                // Import portalApi dynamically to avoid circular deps
                const { portalApi } = await import("./portalApi");
                await portalApi.warmPortalData(portal);

                await AsyncStorage.setItem(lastSyncKey, Date.now().toString());
            } catch (e) {
                console.warn("Background sync failed (non-fatal):", e);
            } finally {
                this.syncPromises.delete(portal.id);
            }
        })();

        this.syncPromises.set(portal.id, run);
        return run;
    }

    /**
     * Force a full refresh of portal data
     */
    async forceRefresh(portal: Portal): Promise<void> {
        await AsyncStorage.removeItem(`portal:${portal.id}:lastSync`);
        await this.triggerBackgroundSync(portal, true);
    }

    /**
     * Reset the boot manager (for logout/portal switch)
     */
    reset(): void {
        this.isInitialized = false;
        this.bootPromise = null;
        this.syncPromises.clear();
    }

    get initialized(): boolean {
        return this.isInitialized;
    }
}

export const AppBootManager = new AppBootManagerClass();
