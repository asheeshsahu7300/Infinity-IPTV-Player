import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { safeStorage } from "../services/safeStorage";
import {
  loadSlot,
  saveSlot,
  clearSlot,
  PortalSlot,
  PORTAL_SLOTS,
} from "../services/portalPersistence";

// ---------------------------------------
// PORTAL MODEL
// ---------------------------------------

export type PortalType = "m3u" | "xtream" | "mag";

export interface PortalConfig {
  url: string;

  // Xtream
  username?: string;
  password?: string;

  // MAG/Stalker
  mac?: string;
  token?: string;
  expiry?: number;
  serverInfo?: any;
}

export interface Portal {
  id: string;
  name: string;
  type: PortalType;
  config: PortalConfig;
  categories?: Category[];
}

// ---------------------------------------
// TV MODELS
// ---------------------------------------

export interface Channel {
  id: string;
  name: string;
  logo?: string;
  category?: string;
  categoryId?: string;
  streamUrl?: string;
  epgId?: string;
}

export interface VODItem {
  id: string;
  name: string;
  logo?: string;
  category?: string;
  categoryId?: string;
  streamUrl?: string;
  description?: string;
  year?: string;
  rating?: string;
  duration?: string;
}

export interface Series {
  id: string;
  name: string;
  logo?: string;
  category?: string;
  categoryId?: string;
  description?: string;
  year?: string;
  rating?: string;
  seasons?: Season[];
}

export interface Season {
  id: string;
  name: string;
  seasonNumber: number;
  cmd?: string;
  episodes: Episode[];
  description?: string;
  year?: string;
  rating?: any;
}

export interface Episode {
  id: string;
  name: string;
  episodeNum: number;
  seasonNum: number;
  cmd?: string;
  streamUrl?: string;
  description?: string;
  duration?: string;
}

export interface Category {
  id: string;
  name: string;
  type: "live" | "vod" | "series";
}

export interface EPGProgram {
  id: string;
  channelId: string;
  title: string;
  description?: string;
  start: number;
  end: number;
}

// ---------------------------------------
// MERGE UTILITY — used by background sync to avoid
// collapsing paginated data back to page 1
// ---------------------------------------
function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  if (!existing.length) return incoming;
  if (!incoming.length) return existing;
  const map = new Map(existing.map(i => [i.id, i]));
  for (const item of incoming) map.set(item.id, item);
  return Array.from(map.values());
}

// ---------------------------------------
// WRITE-BEHIND PERSISTENCE
// ---------------------------------------
// Content lists are large, so they are written off the interaction path: a
// setter updates memory synchronously and schedules the disk write. Without
// this the app has no cache at all and every cold start blocks on the network.

const PERSIST_DELAY = 1200;
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

function schedulePersist<T>(portalId: string | undefined, slot: PortalSlot, items: T[]) {
  if (!portalId || !items || items.length === 0) return;
  const key = `${portalId}:${slot}`;
  const existing = persistTimers.get(key);
  if (existing) clearTimeout(existing);
  persistTimers.set(
    key,
    setTimeout(() => {
      persistTimers.delete(key);
      saveSlot(portalId, slot, items).catch(console.warn);
    }, PERSIST_DELAY)
  );
}

/** Drop queued writes for a portal so a cache clear cannot be undone by one. */
function cancelPendingPersists(portalId: string) {
  for (const [key, timer] of persistTimers) {
    if (key.startsWith(`${portalId}:`)) {
      clearTimeout(timer);
      persistTimers.delete(key);
    }
  }
}

// ---------------------------------------
// STORE INTERFACE
// ---------------------------------------

export interface PortalState {
  portals: Portal[];
  activePortal: Portal | null;
  channels: Channel[];
  vodItems: VODItem[];
  series: Series[];
  categories: Category[];
  favorites: {
    channels: string[];
    vod: string[];
    series: string[];
  };
  epgData: EPGProgram[];
  isLoading: boolean;
  error: string | null;

  // Hydration state for boot flow
  isHydrated: boolean;
  lastSyncTime: number;

  // TV Overscan Setting
  overscanPadding: number;

  loadPortals: () => Promise<void>;
  restoreActivePortal: () => Promise<Portal | null>;
  validatePortalAuth: (portal: Portal) => Promise<boolean>;
  addPortal: (portal: Portal) => Promise<void>;
  updatePortal: (id: string, portal: Partial<Portal>) => Promise<void>;
  deletePortal: (id: string) => Promise<void>;
  setActivePortal: (portal: Portal | null) => Promise<void>;
  persistPortalConfig: (portal: Portal) => Promise<void>;

  setChannels: (channels: Channel[], targetPortalId?: string) => Promise<void>;
  setVodItems: (items: VODItem[], targetPortalId?: string) => Promise<void>;
  setSeries: (series: Series[], targetPortalId?: string) => Promise<void>;
  setCategories: (categories: Category[], targetPortalId?: string) => Promise<void>;
  setEpgData: (data: EPGProgram[], targetPortalId?: string) => Promise<void>;

  // Merge setters — add incoming items by id without removing existing ones.
  // Used by background sync to avoid collapsing paginated data.
  mergeChannels: (channels: Channel[], targetPortalId?: string) => Promise<void>;
  mergeVodItems: (items: VODItem[], targetPortalId?: string) => Promise<void>;
  mergeSeries: (series: Series[], targetPortalId?: string) => Promise<void>;

  loadPortalData: (portalId: string) => Promise<void>;

  toggleFavorite: (
    type: "channels" | "vod" | "series",
    id: string
  ) => Promise<void>;

  loadFavorites: () => Promise<void>;

  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  clearPortalData: () => void;
  clearPersistedPortalData: (portalId?: string) => Promise<void>;

  setOverscanPadding: (pad: number) => Promise<void>;
}

// ---------------------------------------
// STORE IMPLEMENTATION
// ---------------------------------------

export const usePortalStore = create<PortalState>((set, get) => ({
  portals: [],
  activePortal: null,

  channels: [],
  vodItems: [],
  series: [],
  categories: [],
  epgData: [],

  favorites: {
    channels: [],
    vod: [],
    series: [],
  },

  isLoading: false,
  error: null,
  
  overscanPadding: 0,
  setOverscanPadding: async (pad) => {
    set({ overscanPadding: pad });
    // In a real app we'd save to AsyncStorage here too
  },

  // Hydration state
  isHydrated: false,
  lastSyncTime: 0,

  // ---------------------------------------
  // LOAD SAVED PORTALS
  // ---------------------------------------
  loadPortals: async () => {
    try {
      const data = await AsyncStorage.getItem("portals");
      if (data) {
        const portals: Portal[] = JSON.parse(data);
        set({ portals });
      }
    } catch (err) {
      console.error("Failed to load portals:", err);
    }
  },

  // ---------------------------------------
  // VALIDATE PORTAL AUTH
  // ---------------------------------------
  validatePortalAuth: async (portal) => {
    try {
      // Check if portal has required config
      if (portal.type === "mag") {
        // MAG/Stalker: Just check if token exists (no expiry check)
        return !!(portal.config.token && portal.config.url && portal.config.mac);
      }

      if (portal.type === "xtream") {
        return !!(
          portal.config.username &&
          portal.config.password &&
          portal.config.url
        );
      }

      if (portal.type === "m3u") {
        return !!portal.config.url;
      }

      return false;
    } catch (err) {
      console.error("Failed to validate portal auth:", err);
      return false;
    }
  },

  // ---------------------------------------
  // RESTORE ACTIVE PORTAL
  // ---------------------------------------
  restoreActivePortal: async () => {
    try {
      // First, ensure portals are loaded
      const portalsJson = await AsyncStorage.getItem("portals");
      const activeId = await AsyncStorage.getItem("activePortalId");
      const overscanStr = await AsyncStorage.getItem("overscanPadding");
      
      if (overscanStr) {
        set({ overscanPadding: parseInt(overscanStr, 10) });
      }

      if (portalsJson) {
        const portals: Portal[] = JSON.parse(portalsJson);
        set({ portals });
      }

      if (!activeId) {
        return null;
      }

      const portal = get().portals.find((p) => p.id === activeId);
      if (!portal) {
        // Portal was deleted, clear active portal
        await AsyncStorage.removeItem("activePortalId");
        set({ activePortal: null });
        return null;
      }

      // Validate portal has required config
      const isValid = await get().validatePortalAuth(portal);
      if (!isValid) {
        // Invalid config, clear active portal
        await AsyncStorage.removeItem("activePortalId");
        set({ activePortal: null });
        return null;
      }

      // Portal is valid, restore it (auto-activate)
      set({ activePortal: portal });

      // Load all content data from storage for this portal
      await get().loadPortalData(portal.id);

      // Restore cached data from cacheManager (for fresh data on resume)
      try {
        const { portalApi } = await import("../services/portalApi");
        await portalApi.restoreCachedPortalData(portal);
      } catch (e) {
        console.warn("Failed to restore cached portal data:", e);
      }

      return portal;
    } catch (err) {
      console.error("Failed to restore active portal:", err);
      // On error, clear active portal to be safe
      await AsyncStorage.removeItem("activePortalId");
      set({ activePortal: null });
      return null;
    }
  },

  // ---------------------------------------
  // ADD PORTAL (Now expects full Portal object)
  // ---------------------------------------
  addPortal: async (portal) => {
    const portals = [...get().portals, portal];
    await AsyncStorage.setItem("portals", JSON.stringify(portals));
    set({ portals });
  },

  // ---------------------------------------
  // UPDATE PORTAL
  // ---------------------------------------
  updatePortal: async (id, updates) => {
    const portals = get().portals.map((p) =>
      p.id === id ? { ...p, ...updates } : p
    );

    await AsyncStorage.setItem("portals", JSON.stringify(portals));
    set({ portals });

    if (get().activePortal?.id === id) {
      set({ activePortal: portals.find((p) => p.id === id) || null });
    }
  },

  // ---------------------------------------
  // DELETE PORTAL
  // ---------------------------------------
  deletePortal: async (id) => {
    const portalToDelete = get().portals.find((p) => p.id === id);
    if (portalToDelete) {
      try {
        const { portalApi } = await import("../services/portalApi");
        await portalApi.deletePortalData(portalToDelete);
      } catch (e) {
        console.warn("Failed to cleanup portal data:", e);
      }
    }

    const portals = get().portals.filter((p) => p.id !== id);

    await AsyncStorage.setItem("portals", JSON.stringify(portals));
    set({ portals });

    if (get().activePortal?.id === id) {
      set({ activePortal: null });
      await AsyncStorage.removeItem("activePortalId");
      // Clear current store data
      get().clearPortalData();
    }
  },

  // ---------------------------------------
  // SET ACTIVE PORTAL
  // ---------------------------------------
  setActivePortal: async (portal) => {
    if (!portal) {
      set({
        activePortal: null,
        channels: [],
        vodItems: [],
        series: [],
        categories: [],
        epgData: [],
      });
      await AsyncStorage.removeItem("activePortalId");
      return;
    }

    // Swap portal and wipe the previous one's content in a single commit —
    // separate `set` calls made every subscriber render twice and briefly
    // showed the new portal alongside the old portal's channels.
    // Categories ride along on the portal object, so the sidebar has content
    // before any storage read completes.
    set({
      activePortal: portal,
      channels: [],
      vodItems: [],
      series: [],
      categories: portal.categories || [],
      epgData: [],
    });

    const portals = get().portals.map((p) => (p.id === portal.id ? portal : p));
    set({ portals });

    // Storage writes and the cache read are off the critical path; the UI is
    // already rendering the new portal.
    Promise.all([
      AsyncStorage.setItem("activePortalId", portal.id),
      AsyncStorage.setItem("portals", JSON.stringify(portals)),
    ]).catch(console.warn);

    await get().loadPortalData(portal.id);
  },

  // ---------------------------------------
  // PERSIST PORTAL CONFIG (token refresh)
  // ---------------------------------------
  // Saves a refreshed token/expiry without touching content.
  //
  // Token refreshes ran through `setActivePortal`, which clears channels, VOD,
  // series and categories — so every re-handshake (and MAG portals re-handshake
  // constantly) blanked the whole library out from under whatever screen was
  // open. Switching portals should wipe content; refreshing a token should not.
  persistPortalConfig: async (portal) => {
    const portals = get().portals.map((p) =>
      p.id === portal.id ? { ...p, config: portal.config } : p
    );
    const isActive = get().activePortal?.id === portal.id;

    set({
      portals,
      ...(isActive
        ? { activePortal: { ...get().activePortal!, config: portal.config } }
        : {}),
    });

    await AsyncStorage.setItem("portals", JSON.stringify(portals));
  },

  // ---------------------------------------
  // TV DATA SETTERS
  // ---------------------------------------
  // In-memory update is synchronous; the disk write is scheduled behind it.
  // `targetPortalId` is enforced, not decorative — a background refresh for the
  // portal the user just switched away from must not land in the active one.
  setChannels: async (channels, targetPortalId) => {
    if (!channels || channels.length === 0) return;
    const activeId = get().activePortal?.id;
    const portalId = targetPortalId || activeId;
    if (targetPortalId && activeId && targetPortalId !== activeId) return;
    set({ channels });
    schedulePersist(portalId, "channels", channels);
  },
  setVodItems: async (items, targetPortalId) => {
    if (!items || items.length === 0) return;
    const activeId = get().activePortal?.id;
    const portalId = targetPortalId || activeId;
    if (targetPortalId && activeId && targetPortalId !== activeId) return;
    set({ vodItems: items });
    schedulePersist(portalId, "vod", items);
  },
  setSeries: async (series, targetPortalId) => {
    if (!series || series.length === 0) return;
    const activeId = get().activePortal?.id;
    const portalId = targetPortalId || activeId;
    if (targetPortalId && activeId && targetPortalId !== activeId) return;
    set({ series });
    schedulePersist(portalId, "series", series);
  },
  setCategories: async (categories, targetPortalId) => {
    const activePortal = get().activePortal;
    const portalId = targetPortalId || activePortal?.id;
    if (categories && categories.length > 0) {
      const currentCategories = get().categories;
      const isSame =
        currentCategories.length === categories.length &&
        currentCategories.every((c, i) => c.id === categories[i]?.id && c.name === categories[i]?.name);
      if (isSame) return;

      if (!targetPortalId || targetPortalId === activePortal?.id) {
        set({ categories });
      }
      if (activePortal && activePortal.id === portalId) {
        const updatedPortal = { ...activePortal, categories };
        const portals = get().portals.map(p => p.id === updatedPortal.id ? updatedPortal : p);
        // One `set` — three in a row meant three renders of every subscriber.
        set({ activePortal: updatedPortal, portals });
        AsyncStorage.setItem("portals", JSON.stringify(portals)).catch(console.warn);
      }
      schedulePersist(portalId, "categories", categories);
    }
  },
  setEpgData: async (data, targetPortalId) => {
    if (!data || data.length === 0) return;
    const activeId = get().activePortal?.id;
    if (targetPortalId && activeId && targetPortalId !== activeId) return;
    // EPG is deliberately memory-only: it is the largest payload and expires
    // within the hour, so persisting it burns the storage budget for nothing.
    set({ epgData: data });
  },

  // ---------------------------------------
  // MERGE SETTERS — in-memory sync
  // ---------------------------------------
  mergeChannels: async (channels, targetPortalId) => {
    if (!channels || channels.length === 0) return;
    const activeId = get().activePortal?.id;
    if (targetPortalId && activeId && targetPortalId !== activeId) return;
    const existing = get().channels;
    const merged = mergeById(existing, channels);
    if (merged.length !== existing.length) {
      set({ channels: merged });
      schedulePersist(targetPortalId || activeId, "channels", merged);
    }
  },
  mergeVodItems: async (items, targetPortalId) => {
    if (!items || items.length === 0) return;
    const activeId = get().activePortal?.id;
    if (targetPortalId && activeId && targetPortalId !== activeId) return;
    const existing = get().vodItems;
    const merged = mergeById(existing, items);
    if (merged.length !== existing.length) {
      set({ vodItems: merged });
      schedulePersist(targetPortalId || activeId, "vod", merged);
    }
  },
  mergeSeries: async (series, targetPortalId) => {
    if (!series || series.length === 0) return;
    const activeId = get().activePortal?.id;
    if (targetPortalId && activeId && targetPortalId !== activeId) return;
    const existing = get().series;
    const merged = mergeById(existing, series);
    if (merged.length !== existing.length) {
      set({ series: merged });
      schedulePersist(targetPortalId || activeId, "series", merged);
    }
  },

  // Load portal data from MMKV storage.
  //
  // Strictly additive: a slot is only written when the cache actually held
  // something for it, and only when that beats what is already in memory.
  // Blanking a slot here is what made screens flash to zero items — this runs
  // during boot and on every portal switch, so a cache miss must be a no-op,
  // not a wipe.
  loadPortalData: async (portalId) => {
    if (!portalId) return;
    try {
      const [cachedChannels, cachedVod, cachedSeries, cachedCats] = await Promise.all([
        loadSlot<Channel>(portalId, "channels"),
        loadSlot<VODItem>(portalId, "vod"),
        loadSlot<Series>(portalId, "series"),
        loadSlot<Category>(portalId, "categories"),
      ]);

      // A portal switch mid-read must not drop the new portal's data.
      if (get().activePortal?.id !== portalId) return;

      const current = get();
      const next: Partial<PortalState> = {};

      if (cachedChannels && cachedChannels.length > current.channels.length) {
        next.channels = cachedChannels;
      }
      if (cachedVod && cachedVod.length > current.vodItems.length) {
        next.vodItems = cachedVod;
      }
      if (cachedSeries && cachedSeries.length > current.series.length) {
        next.series = cachedSeries;
      }
      if (cachedCats && cachedCats.length > current.categories.length) {
        next.categories = cachedCats;
      }

      if (Object.keys(next).length > 0) set(next);
    } catch (err) {
      console.warn("Failed to load portal data from storage:", err);
    }
  },

  // ---------------------------------------
  // FAVORITES
  // ---------------------------------------
  toggleFavorite: async (type, id) => {
    const fav = { ...get().favorites };
    const exists = fav[type].includes(id);

    fav[type] = exists ? fav[type].filter((x) => x !== id) : [...fav[type], id];

    await safeStorage.setItem("favorites", JSON.stringify(fav));
    set({ favorites: fav });
  },

  loadFavorites: async () => {
    try {
      const data = await safeStorage.getItem("favorites");
      if (data) {
        set({ favorites: JSON.parse(data) });
      }
    } catch (err) {
      console.error("Failed to load favorites:", err);
    }
  },

  // ---------------------------------------
  // UI HELPERS
  // ---------------------------------------
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),

  clearPortalData: () =>
    set({
      channels: [],
      vodItems: [],
      series: [],
      categories: [],
      epgData: [],
    }),

  // Clears memory *and* the on-disk cache. Without the disk half, "Clear Cache"
  // only emptied the current session and everything reappeared on next launch.
  clearPersistedPortalData: async (portalId) => {
    const id = portalId || get().activePortal?.id;
    if (!id) {
      get().clearPortalData();
      return;
    }

    cancelPendingPersists(id);
    get().clearPortalData();

    await Promise.all(PORTAL_SLOTS.map((slot) => clearSlot(id, slot)));
    // Drop the sync gate so the next load refetches instead of waiting 30 min.
    await AsyncStorage.removeItem(`portal:${id}:lastSync`);
  },
}));

