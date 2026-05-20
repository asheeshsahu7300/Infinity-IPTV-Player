import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

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
// STORE INTERFACE
// ---------------------------------------

interface PortalState {
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

  loadPortals: () => Promise<void>;
  restoreActivePortal: () => Promise<Portal | null>;
  validatePortalAuth: (portal: Portal) => Promise<boolean>;
  addPortal: (portal: Portal) => Promise<void>;
  updatePortal: (id: string, portal: Partial<Portal>) => Promise<void>;
  deletePortal: (id: string) => Promise<void>;
  setActivePortal: (portal: Portal | null) => Promise<void>;

  setChannels: (channels: Channel[]) => Promise<void>;
  setVodItems: (items: VODItem[]) => Promise<void>;
  setSeries: (series: Series[]) => Promise<void>;
  setCategories: (categories: Category[]) => Promise<void>;
  setEpgData: (data: EPGProgram[]) => Promise<void>;

  loadPortalData: (portalId: string) => Promise<void>;

  toggleFavorite: (
    type: "channels" | "vod" | "series",
    id: string
  ) => Promise<void>;

  loadFavorites: () => Promise<void>;

  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  clearPortalData: () => void;
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
      await get().loadPortals();

      const activeId = await AsyncStorage.getItem("activePortalId");
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
    set({ activePortal: portal });
    if (portal) {
      // Persist the full portal data including tokens
      await AsyncStorage.setItem("activePortalId", portal.id);

      // Update the portal in the portals list to ensure tokens are saved
      const portals = get().portals.map((p) =>
        p.id === portal.id ? portal : p
      );
      await AsyncStorage.setItem("portals", JSON.stringify(portals));
      set({ portals });
    } else {
      await AsyncStorage.removeItem("activePortalId");
    }
  },

  // ---------------------------------------
  // TV DATA SETTERS (with AsyncStorage persistence)
  // ---------------------------------------
  setChannels: async (channels) => {
    set({ channels });
    const activePortal = get().activePortal;
    if (activePortal) {
      await AsyncStorage.setItem(`portal:${activePortal.id}:channels`, JSON.stringify(channels)).catch(console.warn);
    }
  },
  setVodItems: async (items) => {
    set({ vodItems: items });
    const activePortal = get().activePortal;
    if (activePortal) {
      await AsyncStorage.setItem(`portal:${activePortal.id}:vod`, JSON.stringify(items)).catch(console.warn);
    }
  },
  setSeries: async (series) => {
    set({ series });
    const activePortal = get().activePortal;
    if (activePortal) {
      await AsyncStorage.setItem(`portal:${activePortal.id}:series`, JSON.stringify(series)).catch(console.warn);
    }
  },
  setCategories: async (categories) => {
    set({ categories });
    const activePortal = get().activePortal;
    if (activePortal) {
      // 1. Store in active portal configuration (permanent)
      const updatedPortal = { ...activePortal, categories };
      set({ activePortal: updatedPortal });

      // 2. Update in portals list (permanent)
      const portals = get().portals.map(p => p.id === updatedPortal.id ? updatedPortal : p);
      set({ portals });
      await AsyncStorage.setItem("portals", JSON.stringify(portals));

      // 3. Also keep separate for legacy/direct loading if needed
      await AsyncStorage.setItem(`portal:${activePortal.id}:categories`, JSON.stringify(categories)).catch(console.warn);
    }
  },
  setEpgData: async (data) => {
    set({ epgData: data });
    const activePortal = get().activePortal;
    if (activePortal) {
      await AsyncStorage.setItem(`portal:${activePortal.id}:epg`, JSON.stringify(data)).catch(console.warn);
    }
  },

  // Load portal data from AsyncStorage
  loadPortalData: async (portalId) => {
    try {
      const [channels, vodItems, series, categories, epgData] = await Promise.all([
        AsyncStorage.getItem(`portal:${portalId}:channels`),
        AsyncStorage.getItem(`portal:${portalId}:vod`),
        AsyncStorage.getItem(`portal:${portalId}:series`),
        AsyncStorage.getItem(`portal:${portalId}:categories`),
        AsyncStorage.getItem(`portal:${portalId}:epg`),
      ]);

      if (channels) set({ channels: JSON.parse(channels) });
      if (vodItems) set({ vodItems: JSON.parse(vodItems) });
      if (series) set({ series: JSON.parse(series) });
      if (categories) set({ categories: JSON.parse(categories) });
      if (epgData) set({ epgData: JSON.parse(epgData) });
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

    await AsyncStorage.setItem("favorites", JSON.stringify(fav));
    set({ favorites: fav });
  },

  loadFavorites: async () => {
    try {
      const data = await AsyncStorage.getItem("favorites");
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
}));
