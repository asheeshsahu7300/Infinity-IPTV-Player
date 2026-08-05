// portalApi.ts
import axios from "axios";
import { cacheManager, CACHE_TTL } from "./cacheManager";
import { requestManager } from "./requestManager";
import {
  Portal,
  Channel,
  VODItem,
  Series,
  Category,
  EPGProgram,
  Episode,
  Season,
} from "../store/portalStore";
// 🔑 Import store to persist refreshed token
import { usePortalStore } from "../store/portalStore";

const safe = (v: any) => (typeof v === "string" ? v : "");

// Try converting a .ts segment URL to a plausible .m3u8 playlist URL by
// generating candidates and probing them with HEAD requests. Returns the
// first candidate that responds with a 2xx and looks like an HLS playlist.
async function tryConvertToM3U8(candidateUrl: string): Promise<string | null> {
  try {
    if (!/^https?:\/\//i.test(candidateUrl)) return null;

    // If it's already m3u8, return as-is
    if (/\.m3u8(\?|$)/i.test(candidateUrl)) return candidateUrl;

    const urlObj = new URL(candidateUrl);
    const path = urlObj.pathname;

    const candidates: string[] = [];

    // 1) replace .ts => .m3u8
    candidates.push(candidateUrl.replace(/\.ts(\?|$)/i, ".m3u8$1"));

    // 2) replace last segment with index.m3u8
    const parts = path.split("/");
    parts[parts.length - 1] = "index.m3u8";
    urlObj.pathname = parts.join("/");
    candidates.push(urlObj.toString());

    // 3) append index.m3u8 in same folder
    const folder = path.replace(/\/[^/]*$/, "/");
    urlObj.pathname = folder + "index.m3u8";
    candidates.push(urlObj.toString());

    // 4) try adding .m3u8 as query param (some providers expect ?ext=m3u8)
    candidates.push(candidateUrl + (urlObj.search ? "&" : "?") + "format=m3u8");

    // Probe candidates with HEAD first, then GET small range if needed
    for (const c of candidates) {
      try {
        const head = await axios.head(c, { timeout: 5000 });
        const ct = String(head.headers["content-type"] || "").toLowerCase();
        if (head.status >= 200 && head.status < 300 && (ct.includes("mpegurl") || ct.includes("vnd.apple.mpegurl") || ct.includes("text/plain") || ct.includes("application/vnd.apple.mpegurl"))) {
          return c;
        }
      } catch (e) {
        // ignore and try next
      }

      // As a fallback try GET first 256 bytes to detect #EXTM3U
      try {
        const res = await axios.get(c, { timeout: 5000, responseType: "text", headers: { Range: "bytes=0-512" } });
        const data = String(res.data || "");
        if (/^#EXTM3U/m.test(data) || data.includes("EXTINF") || data.includes("#EXT-X-")) {
          return c;
        }
      } catch (e) {
        // ignore
      }
    }
  } catch (e) {
    // ignore
  }
  return null;
}

const rmAcceptHeader = {
  transformRequest: [
    (data: any, headers?: any) => {
      if (headers?.common) delete headers.common.Accept;
      return data;
    },
  ],
};

const formatMac = (mac: string) =>
  mac
    .replace(/[^A-Fa-f0-9]/g, "")
    .toUpperCase()
    .match(/.{2}/g)
    ?.join(":") ?? mac;

const headers = (mac: string, token?: string) => ({
  "User-Agent": "okhttp/3.12.1",
  "Accept-Encoding": "gzip",
  Cookie: `mac=${encodeURIComponent(formatMac(mac))}`,
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
  Connection: "Keep-Alive",
});


const extract = (res: any): any[] => {
  let data = res?.data?.js?.data ?? res?.data?.js ?? res?.data ?? res ?? [];

  if (Array.isArray(data)) return data;

  if (typeof data === "object" && data !== null) {
    const values = Object.values(data);
    if (values.length > 0 && values.every((v) => Array.isArray(v))) {
      return values.flat();
    }
    if (values.length > 0 && values.every((v) => typeof v === "object")) {
      return values;
    }
    return [data];
  }

  return [];
};

const pickRating = (v: any) => {
  const r =
    v?.rating_imdb ??
    v?.imdb_rating ??
    v?.rating ??
    v?.vote_average ??
    v?.rating_tmdb ??
    v?.score;
  if (r == null) return undefined;
  const s = String(r).trim();
  const lower = s.toLowerCase();
  if (
    !s ||
    lower === "n/a" ||
    lower === "na" ||
    lower === "0" ||
    lower === "0.0" ||
    lower === "0.00" ||
    lower === "null" ||
    lower === "undefined"
  ) {
    return undefined;
  }
  return s;
};

const pickYear = (v: any) => {
  const y =
    v?.year ?? v?.production_year ?? v?.release_year ?? v?.first_air_date;
  if (y == null) return undefined;
  const s = String(y).trim();
  const lower = s.toLowerCase();
  if (
    !s ||
    lower === "n/a" ||
    lower === "na" ||
    lower === "0" ||
    lower === "null" ||
    lower === "undefined"
  ) {
    return undefined;
  }
  const match = s.match(/(19|20)\d{2}/);
  return match ? match[0] : s;
};

const pickDescription = (v: any) =>
  v?.description ??
  v?.descr ??
  v?.plot ??
  v?.info ??
  v?.storyline ??
  v?.short_description;

// 🔁 Token refresh with deduplication & global state sync
const tokenRefreshMap = new Map<string, Promise<Portal>>();

const isExpired = (p: Portal) =>
  !p?.config?.token ||
  !p?.config?.expiry ||
  Number(p.config.expiry) - Date.now() < 5 * 60 * 1000;

async function refreshToken(portal: Portal, forceRefresh = false): Promise<Portal> {
  if (!isExpired(portal) && !forceRefresh) return portal;

  const mac = formatMac(portal.config.mac ?? "");
  const key = portal.id;
  const cacheKey = `portal:${key}:auth`;

  // Reuse in-flight refresh
  if (tokenRefreshMap.has(key) && !forceRefresh) {
    return tokenRefreshMap.get(key)!;
  }

  // Try cached token first
  if (!forceRefresh) {
    const cached = await cacheManager.get<any>(cacheKey);
    if (cached && cached.expiry > Date.now() + 5 * 60 * 1000) {
    const updated = {
      ...portal,
      config: { ...portal.config, ...cached },
    };
    // 🟢 Sync to global state
      usePortalStore.getState().setActivePortal(updated);
      return updated;
    }
  }

  // Start new auth flow
  const refreshPromise = portalApi
    .authenticate(portal)
    .then(async (auth) => {
      const updated = {
        ...portal,
        config: {
          ...portal.config,
          token: auth.token,
          expiry: auth.expiry,
          serverInfo: auth.serverInfo,
        },
      };

      // 🟢 CRITICAL: Persist updated portal (token!) to store & disk
      const store = usePortalStore.getState();
      store.setActivePortal(updated);

      // Cache for fast-path next time
      await cacheManager.set(
        cacheKey,
        { token: auth.token, expiry: auth.expiry, serverInfo: auth.serverInfo },
        CACHE_TTL.AUTH
      );

      // Warm portal data on first handshake: fetch and persist large lists
      // without blocking the auth flow. Only fetch if cache missing.
      try {
        // Fire-and-forget warming; errors are non-fatal
        portalApi.warmPortalData(updated).catch(() => { });
      } catch {
        // ignore
      }

      return updated;
    })
    .catch((e) => {
      tokenRefreshMap.delete(key);
      throw e;
    })
    .finally(() => {
      tokenRefreshMap.delete(key);
    });

  tokenRefreshMap.set(key, refreshPromise);
  return refreshPromise;
}

// Helper for fetching lists with zero-item retry logic
async function fetchWithRetry(
  portal: Portal,
  urlBuilder: (refreshed: Portal) => string
): Promise<any[]> {
  let refreshed = await refreshToken(portal);
  let url = urlBuilder(refreshed);

  let res = await axios.get(url, {
    ...rmAcceptHeader,
    headers: headers(refreshed.config.mac ?? "", refreshed.config.token ?? ""),
    timeout: 15000,
  });

  let rows = extract(res);

  if (rows.length === 0) {
    console.log(`[portalApi] 0 items returned for ${url}, forcing token refresh and retrying...`);
    refreshed = await refreshToken(portal, true);
    url = urlBuilder(refreshed);
    res = await axios.get(url, {
      ...rmAcceptHeader,
      headers: headers(refreshed.config.mac ?? "", refreshed.config.token ?? ""),
      timeout: 15000,
    });
    rows = extract(res);
  }

  return rows;
}

export const portalApi = {
  async authenticate(portal: Portal) {
    const base = safe(portal.config.url).replace(/\/$/, "");
    const mac = formatMac(portal.config.mac ?? "");

    const hURL = `${base}/portal.php?type=stb&action=handshake&JsHttpRequest=1-xml`;
    const handshake = await axios.get(hURL, {
      ...rmAcceptHeader,
      headers: headers(mac),
      timeout: 15000,
    });

    const token =
      handshake?.data?.js?.token ?? Math.random().toString(36).substring(2);

    const pURL = `${base}/portal.php?type=stb&action=get_profile&token=${encodeURIComponent(
      token
    )}&JsHttpRequest=1-xml`;
    const profile = await axios.get(pURL, {
      ...rmAcceptHeader,
      headers: headers(mac, token),
      timeout: 15000,
    });

    return {
      token,
      expiry: Date.now() + 3600 * 1000,
      serverInfo: profile?.data?.js ?? {},
    };
  },

  async getLiveCategories(portal: Portal): Promise<Category[]> {
    const key = portal.id;
    const cacheKey = `portal:${key}:live:categories`;

    return requestManager.request(cacheKey, async () => {
      const rows = await fetchWithRetry(portal, (refreshed) => {
        const base = safe(refreshed.config.url).replace(/\/$/, "");
        return `${base}/portal.php?type=itv&action=get_genres&JsHttpRequest=1-xml`;
      });
      const result = rows.map((c: any) => ({
        id: String(c.id ?? c.gid ?? ""),
        name: c.title ?? c.name ?? c.genre_name ?? "Unknown",
        type: "live" as const,
      }));

      await cacheManager.set(cacheKey, result, CACHE_TTL.CATEGORIES);
      return result;
    });
  },

  async getLiveChannels(
    portal: Portal,
    categoryId?: string,
    page = 1
  ): Promise<Channel[]> {
    const key = portal.id;
    const cacheKey = `portal:${key}:live:channels:${categoryId ?? "all"
      }:${page}`;

    return requestManager.request(cacheKey, async () => {
      const rows = await fetchWithRetry(portal, (refreshed) => {
        const base = safe(refreshed.config.url).replace(/\/$/, "");
        let url = `${base}/portal.php?type=itv&action=get_ordered_list&p=${page}&JsHttpRequest=1-xml`;
        if (categoryId && categoryId !== "all")
          url += `&genre=${encodeURIComponent(categoryId)}`;
        return url;
      });
      const result = rows.map((c: any) => ({
        id: String(c.id ?? c.cmd ?? ""),
        name: c.name ?? c.title ?? "Unknown",
        logo: c.logo ?? c.logo_30x30 ?? c.screenshot_uri ?? "",
        category: c.tv_genre_name ?? c.genre ?? c.category_name ?? "",
        categoryId: String(c.tv_genre_id ?? c.genre_id ?? c.category_id ?? ""),
        streamUrl: c.cmd ?? "",
        epgId: String(c.epg_id ?? ""),
      }));

      await cacheManager.set(cacheKey, result, CACHE_TTL.CHANNELS);
      return result;
    });
  },

  async getVodCategories(portal: Portal): Promise<Category[]> {
    const key = portal.id;
    const cacheKey = `portal:${key}:vod:categories`;

    return requestManager.request(cacheKey, async () => {
      const rows = await fetchWithRetry(portal, (refreshed) => {
        const base = safe(refreshed.config.url).replace(/\/$/, "");
        return `${base}/portal.php?type=vod&action=get_categories&JsHttpRequest=1-xml`;
      });
      const result = rows.map((c: any) => ({
        id: String(c.id ?? ""),
        name: c.title ?? c.name ?? "Unknown",
        type: "vod" as const,
      }));

      await cacheManager.set(cacheKey, result, CACHE_TTL.CATEGORIES);
      return result;
    });
  },

  async getVodItems(
    portal: Portal,
    categoryId?: string,
    page = 1
  ): Promise<VODItem[]> {
    const key = portal.id;
    const cacheKey = `portal:${key}:vod:items:${categoryId ?? "all"}:${page}`;

    return requestManager.request(cacheKey, async () => {
      const rows = await fetchWithRetry(portal, (refreshed) => {
        const base = safe(refreshed.config.url).replace(/\/$/, "");
        let url = `${base}/portal.php?type=vod&action=get_ordered_list&p=${page}&JsHttpRequest=1-xml`;
        if (categoryId && categoryId !== "all")
          url += `&category=${encodeURIComponent(categoryId)}`;
        return url;
      });
      const result = rows.map((v: any) => ({
        id: String(v.id ?? ""),
        name: v.name ?? v.title ?? "Unknown",
        logo: v.screenshot_uri ?? v.logo ?? v.stream_icon ?? "",
        category: v.category_name ?? v.genre ?? "",
        categoryId: String(v.category_id ?? ""),
        streamUrl: v.cmd ?? "",
        description: pickDescription(v),
        year: pickYear(v),
        rating: pickRating(v),
        duration: v.time ?? v.duration ?? "",
      }));

      await cacheManager.set(cacheKey, result, CACHE_TTL.VOD);
      return result;
    });
  },

  async getSeriesCategories(portal: Portal): Promise<Category[]> {
    const key = portal.id;
    const cacheKey = `portal:${key}:series:categories`;

    return requestManager.request(cacheKey, async () => {
      const rows = await fetchWithRetry(portal, (refreshed) => {
        const base = safe(refreshed.config.url).replace(/\/$/, "");
        return `${base}/portal.php?type=series&action=get_categories&JsHttpRequest=1-xml`;
      });
      const result = rows.map((c: any) => ({
        id: String(c.id ?? ""),
        name: c.title ?? c.name ?? "Unknown",
        type: "series" as const,
      }));

      await cacheManager.set(cacheKey, result, CACHE_TTL.CATEGORIES);
      return result;
    });
  },

  async getSeries(
    portal: Portal,
    categoryId?: string,
    page = 1
  ): Promise<Series[]> {
    const key = portal.id;
    const cacheKey = `portal:${key}:series:list:${categoryId ?? "all"}:${page}`;

    return requestManager.request(cacheKey, async () => {
      const rows = await fetchWithRetry(portal, (refreshed) => {
        const base = safe(refreshed.config.url).replace(/\/$/, "");
        let url = `${base}/portal.php?type=series&action=get_ordered_list&p=${page}&JsHttpRequest=1-xml`;
        if (categoryId && categoryId !== "all")
          url += `&category=${encodeURIComponent(categoryId)}`;
        return url;
      });
      const result = rows.map((v: any) => ({
        id: String(v.id ?? ""),
        name: v.name ?? v.title ?? "Unknown",
        logo: v.screenshot_uri ?? v.logo ?? "",
        category: v.category_name ?? v.genre ?? "",
        categoryId: String(v.category_id ?? ""),
        description: pickDescription(v),
        year: pickYear(v),
        rating: pickRating(v),
      }));

      await cacheManager.set(cacheKey, result, CACHE_TTL.SERIES);
      return result;
    });
  },

  async getSeriesInfo(portal: Portal, seriesId: string): Promise<Season[]> {
    const key = portal.id;
    const cacheKey = `portal:${key}:series:info:${seriesId}`;

    return requestManager.request(cacheKey, async () => {
      const rows = await fetchWithRetry(portal, (refreshed) => {
        const base = safe(refreshed.config.url).replace(/\/$/, "");
        return `${base}/portal.php?type=series&action=get_ordered_list&movie_id=${encodeURIComponent(
          seriesId
        )}&JsHttpRequest=1-xml`;
      });
      const seasons: Season[] = [];

      for (const s of rows) {
        const seasonNum = Number(s.season_number ?? s.season ?? 1);

        let episodes: Episode[] = [];

        if (typeof s.series === "string") {
          episodes = s.series.split(",").map((num: string) => {
            const epNum = Number(num.trim());
            return {
              id: `${seriesId}:${seasonNum}-${epNum}`,
              name: `Episode ${epNum}`,
              episodeNum: epNum,
              seasonNum,
              cmd: s.cmd,
              description: pickDescription(s),
            };
          });
        } else if (Array.isArray(s.series)) {
          episodes = s.series.map((item: any, idx: number) => {
            if (typeof item === "number" || typeof item === "string") {
              const epNum = Number(item);
              return {
                id: `${seriesId}:${seasonNum}-${epNum}`,
                name: `Episode ${epNum}`,
                episodeNum: epNum,
                seasonNum,
                cmd: s.cmd,
                description: pickDescription(s),
              };
            }
            const epNum = Number(
              item.episode_num ?? item.episode ?? item.num ?? idx + 1
            );
            return {
              id: String(item.id ?? `${seriesId}:${seasonNum}-${epNum}`),
              name: item.title ?? item.name ?? `Episode ${epNum}`,
              episodeNum: epNum,
              seasonNum,
              cmd: item.cmd ?? s.cmd,
              description: pickDescription(item) || pickDescription(s),
              duration: item.time ?? item.duration ?? undefined,
            };
          });
        }

        episodes = episodes.filter((e) => !Number.isNaN(e.episodeNum));

        seasons.push({
          id: String(s.id ?? seasonNum),
          name: s.name ?? `Season ${seasonNum}`,
          seasonNumber: seasonNum,
          cmd: s.cmd,
          episodes,
        });
      }

      await cacheManager.set(cacheKey, seasons, CACHE_TTL.SERIES_INFO);
      return seasons;
    });
  },

  async getStreamUrl(
    portal: Portal,
    cmd: string,
    type: "itv" | "vod",
    ep?: number
  ): Promise<string> {
    const refreshed = await refreshToken(portal);
    const base = safe(refreshed.config.url).replace(/\/$/, "");
    let url = `${base}/portal.php?type=${type}&action=create_link&cmd=${encodeURIComponent(
      cmd
    )}&JsHttpRequest=1-xml`;
    if (ep != null) url += `&series=${ep}`;

    try {
      const res = await axios.get(url, {
        ...rmAcceptHeader,
        headers: headers(
          refreshed.config.mac ?? "",
          refreshed.config.token ?? ""
        ),
        timeout: 30000,
      });

      let out = String(
        res?.data?.js?.cmd ??
        res?.data?.js?.url ??
        res?.data?.js?.playlist ??
        ""
      ).trim();

      // Clean ffmpeg prefix
      out = out.replace(/^ffmpeg\s+|^ffrt\d*\s+/i, "").trim();

      // Prefer first http(s) URL
      const candidates = out
        .split(/\s+|\|/)
        .map((s) => s.trim())
        .filter(Boolean);
      const httpUrl =
        candidates.find((c) => /^https?:\/\//i.test(c)) ??
        (out.startsWith("http") ? out : "");

      // Prefer HLS playlist (m3u8) when possible: if the httpUrl is a .ts
      // segment or otherwise not an m3u8, attempt to probe likely .m3u8
      // candidates and prefer the first reachable playlist.
      const finalUrl = httpUrl || out || "";
      try {
        if (finalUrl && /\.ts(\?|$)/i.test(finalUrl)) {
          const converted = await tryConvertToM3U8(finalUrl);
          if (converted) return converted;
        }
        // if returned URL already contains m3u8, prefer it
        if (finalUrl && /\.m3u8(\?|$)/i.test(finalUrl)) return finalUrl;
      } catch (e) {
        // ignore conversion errors
      }

      return finalUrl || out || "";
    } catch (e) {
      console.warn("getStreamUrl failed:", e);
      return "";
    }
  },

  async getEpg(portal: Portal): Promise<EPGProgram[]> {
    const refreshed = await refreshToken(portal);
    const base = safe(refreshed.config.url).replace(/\/$/, "");
    const url = `${base}/portal.php?type=itv&action=epg_info&JsHttpRequest=1-xml`;

    const res = await axios.get(url, {
      headers: headers(
        refreshed.config.mac ?? "",
        refreshed.config.token ?? ""
      ),
      timeout: 15000,
    });

    const js = res.data?.js ?? {};
    const out: EPGProgram[] = [];

    const toMs = (v: any): number => {
      if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
      if (typeof v === "string" && /^\d+$/.test(v)) {
        const n = Number(v);
        return n < 1e12 ? n * 1000 : n;
      }
      const parsed = Date.parse(v);
      return isNaN(parsed) ? Date.now() : parsed;
    };

    for (const [cid, list] of Object.entries(js)) {
      if (!Array.isArray(list)) continue;
      for (const p of list) {
        if (!p) continue;
        out.push({
          id: String(p.id ?? `${cid}-${p.start}`),
          channelId: cid,
          title: p.name ?? p.title ?? "",
          description: p.descr ?? p.description ?? "",
          start: toMs(p.start_timestamp ?? p.start),
          end: toMs(p.stop_timestamp ?? p.end),
        });
      }
    }
    return out;
  },

  async search(portal: Portal, q: string, type: string) {
    const rows = await fetchWithRetry(portal, (refreshed) => {
      const base = safe(refreshed.config.url).replace(/\/$/, "");
      return `${base}/portal.php?type=${type}&action=get_ordered_list&search=${encodeURIComponent(
        q
      )}&JsHttpRequest=1-xml`;
    });

    return rows;
  },

  async getLiveChannelsForSearch(portal: Portal): Promise<Channel[]> {
    const key = portal.id;
    const cacheKey = `portal:${key}:live:channels:search:all`;

    return requestManager.request(cacheKey, async () => {
      const rows = await fetchWithRetry(portal, (refreshed) => {
        const base = safe(refreshed.config.url).replace(/\/$/, "");
        return `${base}/portal.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`;
      });
      const result: Channel[] = rows.map((c: any) => ({
        id: String(c.id ?? c.cmd ?? ""),
        name: c.name ?? c.title ?? "Unknown",
        logo: c.logo ?? c.logo_30x30 ?? c.screenshot_uri ?? "",
        category: c.tv_genre_name ?? c.genre ?? c.category_name ?? "",
        categoryId: String(c.tv_genre_id ?? c.genre_id ?? c.category_id ?? ""),
        streamUrl: c.cmd ?? "",
        epgId: String(c.epg_id ?? ""),
      }));

      await cacheManager.set(cacheKey, result, CACHE_TTL.CHANNELS);
      return result;
    });
  },

  async warmPortalData(portal: Portal): Promise<void> {
    try {
      // Early bailout and handoff for non-MAG portals
      if (portal.type === "xtream" || portal.type === "m3u") {
        return this.refreshPortalData(portal);
      }

      const base = safe(portal.config.url).replace(/\/$/, "");
      const mac = portal.config.mac ?? "";
      const token = portal.config.token ?? "";
      const key = portal.id;

      // Helper to only fetch if cache missing
      const fetchIfMissing = async <T>(cacheKey: string, loader: () => Promise<T>, ttl: number, setter?: (v: T) => void) => {
        try {
          if (!(await cacheManager.has(cacheKey))) {
            const val = await loader();
            await cacheManager.set(cacheKey, val, ttl);
            if (setter) setter(val);
          }
        } catch (e) {
          // non-fatal warming error
          console.warn(`warmPortalData failed for ${cacheKey}:`, e);
        }
      };

      // Live categories
      await fetchIfMissing(
        `portal:${key}:live:categories`,
        async () => {
          const url = `${base}/portal.php?type=itv&action=get_genres&JsHttpRequest=1-xml`;
          const res = await axios.get(url, {
            ...rmAcceptHeader,
            headers: headers(mac, token),
            timeout: 15000,
          });
          const rows = extract(res);
          const result = rows.map((c: any) => ({
            id: String(c.id ?? c.gid ?? ""),
            name: c.title ?? c.name ?? c.genre_name ?? "Unknown",
            type: "live" as const,
          }));
          return result;
        },
        CACHE_TTL.CATEGORIES,
        (v) => usePortalStore.getState().setCategories(v as any)
      );

      // All live channels (for search / initial listing)
      await fetchIfMissing(
        `portal:${key}:live:channels:search:all`,
        async () => {
          const url = `${base}/portal.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`;
          const res = await axios.get(url, {
            ...rmAcceptHeader,
            headers: headers(mac, token),
            timeout: 20000,
          });
          const rows = extract(res);
          const result = rows.map((c: any) => ({
            id: String(c.id ?? c.cmd ?? ""),
            name: c.name ?? c.title ?? "Unknown",
            logo: c.logo ?? c.logo_30x30 ?? c.screenshot_uri ?? "",
            category: c.tv_genre_name ?? c.genre ?? c.category_name ?? "",
            categoryId: String(c.tv_genre_id ?? c.genre_id ?? c.category_id ?? ""),
            streamUrl: c.cmd ?? "",
            epgId: String(c.epg_id ?? ""),
          }));
          return result;
        },
        CACHE_TTL.CHANNELS,
        (v) => usePortalStore.getState().setChannels(v as any)
      );

      // VOD categories
      await fetchIfMissing(
        `portal:${key}:vod:categories`,
        async () => {
          const url = `${base}/portal.php?type=vod&action=get_categories&JsHttpRequest=1-xml`;
          const res = await axios.get(url, {
            ...rmAcceptHeader,
            headers: headers(mac, token),
            timeout: 15000,
          });
          const rows = extract(res);
          const result = rows.map((c: any) => ({
            id: String(c.id ?? ""),
            name: c.title ?? c.name ?? "Unknown",
            type: "vod" as const,
          }));
          return result;
        },
        CACHE_TTL.CATEGORIES
      );

      // VOD items (first page)
      await fetchIfMissing(
        `portal:${key}:vod:items:all:1`,
        async () => {
          const url = `${base}/portal.php?type=vod&action=get_ordered_list&p=1&JsHttpRequest=1-xml`;
          const res = await axios.get(url, {
            ...rmAcceptHeader,
            headers: headers(mac, token),
            timeout: 15000,
          });
          const rows = extract(res);
          const result = rows.map((v: any) => ({
            id: String(v.id ?? ""),
            name: v.name ?? v.title ?? "Unknown",
            logo: v.screenshot_uri ?? v.logo ?? v.stream_icon ?? "",
            category: v.category_name ?? v.genre ?? "",
            categoryId: String(v.category_id ?? ""),
            streamUrl: v.cmd ?? "",
            description: pickDescription(v),
            year: pickYear(v),
            rating: pickRating(v),
            duration: v.time ?? v.duration ?? "",
          }));
          return result;
        },
        CACHE_TTL.VOD,
        (v) => usePortalStore.getState().setVodItems(v as any)
      );

      // Series categories
      await fetchIfMissing(
        `portal:${key}:series:categories`,
        async () => {
          const url = `${base}/portal.php?type=series&action=get_categories&JsHttpRequest=1-xml`;
          const res = await axios.get(url, {
            ...rmAcceptHeader,
            headers: headers(mac, token),
            timeout: 15000,
          });
          const rows = extract(res);
          const result = rows.map((c: any) => ({
            id: String(c.id ?? ""),
            name: c.title ?? c.name ?? "Unknown",
            type: "series" as const,
          }));
          return result;
        },
        CACHE_TTL.CATEGORIES
      );

      // Series list (first page)
      await fetchIfMissing(
        `portal:${key}:series:list:all:1`,
        async () => {
          const url = `${base}/portal.php?type=series&action=get_ordered_list&p=1&JsHttpRequest=1-xml`;
          const res = await axios.get(url, {
            ...rmAcceptHeader,
            headers: headers(mac, token),
            timeout: 15000,
          });
          const rows = extract(res);
          const result = rows.map((v: any) => ({
            id: String(v.id ?? ""),
            name: v.name ?? v.title ?? "Unknown",
            logo: v.screenshot_uri ?? v.logo ?? "",
            category: v.category_name ?? v.genre ?? "",
            categoryId: String(v.category_id ?? ""),
            description: pickDescription(v),
            year: pickYear(v),
            rating: pickRating(v),
          }));
          return result;
        },
        CACHE_TTL.SERIES,
        (v) => usePortalStore.getState().setSeries(v as any)
      );

      // EPG
      await fetchIfMissing(
        `portal:${key}:epg`,
        async () => {
          const url = `${base}/portal.php?type=itv&action=epg_info&JsHttpRequest=1-xml`;
          const res = await axios.get(url, {
            headers: headers(mac, token),
            timeout: 15000,
          });
          const js = res.data?.js ?? {};
          const out: any[] = [];
          const toMs = (v: any): number => {
            if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
            if (typeof v === "string" && /^\d+$/.test(v)) {
              const n = Number(v);
              return n < 1e12 ? n * 1000 : n;
            }
            const parsed = Date.parse(v);
            return isNaN(parsed) ? Date.now() : parsed;
          };
          for (const [cid, list] of Object.entries(js)) {
            if (!Array.isArray(list)) continue;
            for (const p of list as any[]) {
              if (!p) continue;
              out.push({
                id: String(p.id ?? `${cid}-${p.start}`),
                channelId: cid,
                title: p.name ?? p.title ?? "",
                description: p.descr ?? p.description ?? "",
                start: toMs(p.start_timestamp ?? p.start),
                end: toMs(p.stop_timestamp ?? p.end),
              });
            }
          }
          return out;
        },
        CACHE_TTL.EPG,
        (v) => usePortalStore.getState().setEpgData(v as any)
      );
    } catch (e) {
      console.warn("warmPortalData top-level failure:", e);
    }
  },

  async refreshPortalData(portal: Portal): Promise<void> {
    try {
      const key = portal.id;
      const store = usePortalStore.getState();

      if (portal.type === "xtream") {
        const { XtreamApi } = await import("./xtreamApi");
        const api = new XtreamApi({
          url: portal.config.url,
          username: portal.config.username!,
          password: portal.config.password!,
        });
        const data = await api.refreshData();

        const allCategories = [
          ...(data.liveCategories || []),
          ...(data.vodCategories || []),
          ...(data.seriesCategories || []),
        ];

        await Promise.all([
          store.setCategories(allCategories),
          store.setChannels(data.liveChannels || []),
          store.setVodItems(data.vodItems || []),
          store.setSeries(data.seriesList || []),
          store.setEpgData([]), // Xtream EPG handled differently or not at all here
        ]);

        console.log("✅ Xtream portal data refreshed");
        return;
      }

      if (portal.type === "m3u") {
        const { M3UApi } = await import("./m3uApi");
        const api = new M3UApi({ url: portal.config.url, portalId: portal.id });
        const data = await api.refreshData();

        const allCategories = [
          ...(data.liveCategories || []),
          ...(data.vodCategories || []),
          ...(data.seriesCategories || []),
        ];

        await Promise.all([
          store.setCategories(allCategories),
          store.setChannels(data.liveChannels || []),
          store.setVodItems(data.vodItems || []),
          store.setSeries(data.seriesList || []),
        ]);

        console.log("✅ M3U portal data refreshed");
        return;
      }

      // ---------------------------------------
      // STALKER / MAG LOGIC
      // ---------------------------------------
      // Ensure token is fresh
      const updatedPortal = await refreshToken(portal);
      const base = safe(updatedPortal.config.url).replace(/\/$/, "");
      const mac = updatedPortal.config.mac ?? "";
      const token = updatedPortal.config.token ?? "";

      // Re-fetch live categories
      const liveCategoriesUrl = `${base}/portal.php?type=itv&action=get_genres&JsHttpRequest=1-xml`;
      const liveCategoriesRes = await axios.get(liveCategoriesUrl, {
        ...rmAcceptHeader,
        headers: headers(mac, token),
        timeout: 15000,
      });
      const liveCategoriesRows = extract(liveCategoriesRes);
      const liveCategories = liveCategoriesRows.map((c: any) => ({
        id: String(c.id ?? c.gid ?? ""),
        name: c.title ?? c.name ?? c.genre_name ?? "Unknown",
        type: "live" as const,
      }));

      // Re-fetch all live channels
      const liveChannelsUrl = `${base}/portal.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`;
      const liveChannelsRes = await axios.get(liveChannelsUrl, {
        ...rmAcceptHeader,
        headers: headers(mac, token),
        timeout: 20000,
      });
      const liveChannelsRows = extract(liveChannelsRes);
      const liveChannels: Channel[] = liveChannelsRows.map((c: any) => ({
        id: String(c.id ?? c.cmd ?? ""),
        name: c.name ?? c.title ?? "Unknown",
        logo: c.logo ?? c.logo_30x30 ?? c.screenshot_uri ?? "",
        category: c.tv_genre_name ?? c.genre ?? c.category_name ?? "",
        categoryId: String(c.tv_genre_id ?? c.genre_id ?? c.category_id ?? ""),
        streamUrl: c.cmd ?? "",
        epgId: String(c.epg_id ?? ""),
      }));
      await cacheManager.set(`portal:${key}:live:channels:search:all`, liveChannels, CACHE_TTL.CHANNELS);
      await store.setChannels(liveChannels);

      // Re-fetch VOD categories
      const vodCategoriesUrl = `${base}/portal.php?type=vod&action=get_categories&JsHttpRequest=1-xml`;
      const vodCategoriesRes = await axios.get(vodCategoriesUrl, {
        ...rmAcceptHeader,
        headers: headers(mac, token),
        timeout: 15000,
      });
      const vodCategoriesRows = extract(vodCategoriesRes);
      const vodCategories = vodCategoriesRows.map((c: any) => ({
        id: String(c.id ?? ""),
        name: c.title ?? c.name ?? "Unknown",
        type: "vod" as const,
      }));

      // Re-fetch VOD items (first page)
      const vodItemsUrl = `${base}/portal.php?type=vod&action=get_ordered_list&p=1&JsHttpRequest=1-xml`;
      const vodItemsRes = await axios.get(vodItemsUrl, {
        ...rmAcceptHeader,
        headers: headers(mac, token),
        timeout: 15000,
      });
      const vodItemsRows = extract(vodItemsRes);
      const vodItems: VODItem[] = vodItemsRows.map((v: any) => ({
        id: String(v.id ?? ""),
        name: v.name ?? v.title ?? "Unknown",
        logo: v.screenshot_uri ?? v.logo ?? v.stream_icon ?? "",
        category: v.category_name ?? v.genre ?? "",
        categoryId: String(v.category_id ?? ""),
        streamUrl: v.cmd ?? "",
        description: pickDescription(v),
        year: pickYear(v),
        rating: pickRating(v),
        duration: v.time ?? v.duration ?? "",
      }));
      await cacheManager.set(`portal:${key}:vod:items:all:1`, vodItems, CACHE_TTL.VOD);
      await store.setVodItems(vodItems);

      // Re-fetch series categories
      const seriesCategoriesUrl = `${base}/portal.php?type=series&action=get_categories&JsHttpRequest=1-xml`;
      const seriesCategoriesRes = await axios.get(seriesCategoriesUrl, {
        ...rmAcceptHeader,
        headers: headers(mac, token),
        timeout: 15000,
      });
      const seriesCategoriesRows = extract(seriesCategoriesRes);
      const seriesCategories = seriesCategoriesRows.map((c: any) => ({
        id: String(c.id ?? ""),
        name: c.title ?? c.name ?? "Unknown",
        type: "series" as const,
      }));

      // Re-fetch series list (first page)
      const seriesListUrl = `${base}/portal.php?type=series&action=get_ordered_list&p=1&JsHttpRequest=1-xml`;
      const seriesListRes = await axios.get(seriesListUrl, {
        ...rmAcceptHeader,
        headers: headers(mac, token),
        timeout: 15000,
      });
      const seriesListRows = extract(seriesListRes);
      const seriesList: Series[] = seriesListRows.map((v: any) => ({
        id: String(v.id ?? ""),
        name: v.name ?? v.title ?? "Unknown",
        logo: v.screenshot_uri ?? v.logo ?? "",
        category: v.category_name ?? v.genre ?? "",
        categoryId: String(v.category_id ?? ""),
        description: pickDescription(v),
        year: pickYear(v),
        rating: pickRating(v),
      }));

      // Fail-Safe: If everything is completely empty, it might be an auth error/HTML response
      if (
        liveChannels.length === 0 &&
        vodItems.length === 0 &&
        seriesList.length === 0
      ) {
        throw new Error("Zero items returned for all content types, aborting to prevent data wipe.");
      }

      await cacheManager.set(`portal:${key}:series:list:all:1`, seriesList, CACHE_TTL.SERIES);
      await store.setSeries(seriesList);

      // Save categories to store
      const allMagCategories = [
        ...(liveCategories || []),
        ...(vodCategories || []),
        ...(seriesCategories || []),
      ];
      await store.setCategories(allMagCategories);

      // Re-fetch EPG
      const epgUrl = `${base}/portal.php?type=itv&action=epg_info&JsHttpRequest=1-xml`;
      const epgRes = await axios.get(epgUrl, {
        headers: headers(mac, token),
        timeout: 15000,
      });
      const js = epgRes.data?.js ?? {};
      const epgPrograms: EPGProgram[] = [];
      const toMs = (v: any): number => {
        if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
        if (typeof v === "string" && /^\d+$/.test(v)) {
          const n = Number(v);
          return n < 1e12 ? n * 1000 : n;
        }
        const parsed = Date.parse(v);
        return isNaN(parsed) ? Date.now() : parsed;
      };
      for (const [cid, list] of Object.entries(js)) {
        if (!Array.isArray(list)) continue;
        for (const p of list as any[]) {
          if (!p) continue;
          epgPrograms.push({
            id: String(p.id ?? `${cid}-${p.start}`),
            channelId: cid,
            title: p.name ?? p.title ?? "",
            description: p.descr ?? p.description ?? "",
            start: toMs(p.start_timestamp ?? p.start),
            end: toMs(p.stop_timestamp ?? p.end),
          });
        }
      }
      await cacheManager.set(`portal:${key}:epg`, epgPrograms, CACHE_TTL.EPG);
      await store.setEpgData(epgPrograms);

      console.log("✅ MAG portal data refreshed and persisted");
    } catch (e) {
      console.warn("❌ refreshPortalData failed:", e);
    }
  },

  async restoreCachedPortalData(portal: Portal): Promise<void> {
    // Load all cached data from storage on app start
    try {
      const key = portal.id;
      const store = usePortalStore.getState();

      // Load portal-level data (categories are already in the portal object or direct storage)
      if (portal.categories) {
        store.setCategories(portal.categories);
      }

      // Load other cached data in parallel
      const [
        liveChannelsFull, liveChannelsPage1,
        vodItemsFull, vodItemsPage1,
        seriesListFull, seriesListPage1,
        epg
      ] = await Promise.all([
        cacheManager.get<Channel[]>(`portal:${key}:live:channels:search:all`),
        cacheManager.get<Channel[]>(`portal:${key}:live:channels:all:1`),
        cacheManager.get<VODItem[]>(`portal:${key}:vod:items:search:all`),
        cacheManager.get<VODItem[]>(`portal:${key}:vod:items:all:1`),
        cacheManager.get<Series[]>(`portal:${key}:series:list:search:all`),
        cacheManager.get<Series[]>(`portal:${key}:series:list:all:1`),
        cacheManager.get<EPGProgram[]>(`portal:${key}:epg`),
      ]);

      const liveChannels = liveChannelsFull || liveChannelsPage1;
      const vodItems = vodItemsFull || vodItemsPage1;
      const seriesList = seriesListFull || seriesListPage1;

      if (liveChannels && liveChannels.length > 0) store.setChannels(liveChannels);
      if (vodItems && vodItems.length > 0) store.setVodItems(vodItems);
      if (seriesList && seriesList.length > 0) store.setSeries(seriesList);
      if (epg && epg.length > 0) store.setEpgData(epg);

      console.log("✅ Cached portal data restored");
    } catch (e) {
      console.warn("⚠️ restoreCachedPortalData failed:", e);
    }
  },
  async split(portal: Portal) {
    // placeholder
  },

  async deletePortalData(portal: Portal): Promise<void> {
    try {
      if (portal.type === "mag") {
        const key = portal.id;
        await cacheManager.removeByPrefix(`portal:${key}`);
      } else if (portal.type === "xtream") {
        // xtream:URL:USERNAME:...
        const prefix = `xtream:${portal.config.url}:${portal.config.username}`;
        await cacheManager.removeByPrefix(prefix);
      } else if (portal.type === "m3u") {
        // m3u:portal:ID:...
        // checking both new and potential legacy keys if strictly needed, but new one supports ID
        const prefix = `m3u:portal:${portal.id}`;
        await cacheManager.removeByPrefix(prefix);

        // Also try legacy URL based if no ID (though we enforce ID now)
        await cacheManager.removeByPrefix(`m3u:${portal.config.url}`);
      }
      console.log(`🗑️ Deleted all data for portal ${portal.name} (${portal.type})`);
    } catch (e) {
      console.warn("deletePortalData failed:", e);
    }
  },
};
