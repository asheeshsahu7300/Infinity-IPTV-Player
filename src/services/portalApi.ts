// portalApi.ts
import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
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

    // 4) try adding .m3u8 as query param (some providers expect ?format=m3u8)
    candidates.push(candidateUrl + (urlObj.search ? "&" : "?") + "format=m3u8");

    const probeCandidate = async (c: string): Promise<string> => {
      try {
        const head = await axios.head(c, { timeout: 3000 });
        const ct = String(head.headers["content-type"] || "").toLowerCase();
        if (
          head.status >= 200 &&
          head.status < 300 &&
          (ct.includes("mpegurl") ||
            ct.includes("vnd.apple.mpegurl") ||
            ct.includes("text/plain") ||
            ct.includes("application/vnd.apple.mpegurl"))
        ) {
          return c;
        }
      } catch (e) {
        // ignore and try GET fallback
      }

      const res = await axios.get(c, {
        timeout: 3000,
        responseType: "text",
        headers: { Range: "bytes=0-512" },
      });
      const data = String(res.data || "");
      if (/^#EXTM3U/m.test(data) || data.includes("EXTINF") || data.includes("#EXT-X-")) {
        return c;
      }
      throw new Error("Not valid m3u8");
    };

    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000));
    const probePromise = Promise.any(candidates.map((c) => probeCandidate(c))).catch(() => null);

    return await Promise.race([probePromise, timeoutPromise]);
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

export const formatMac = (mac: string) => {
  if (!mac) return "";
  let clean = mac.replace(/[^A-Fa-f0-9]/g, "").toUpperCase();
  if (clean.length === 0) return mac;
  if (clean.length % 2 !== 0) {
    clean = "0" + clean;
  }
  const pairs = clean.match(/.{2}/g);
  return pairs ? pairs.join(":") : mac;
};

const headers = (mac: string, token?: string, url?: string) => {
  const formattedMac = formatMac(mac);
  const cookieParts = [
    `mac=${encodeURIComponent(formattedMac)}`,
    "stb_lang=en",
    "timezone=Europe/London",
  ];
  if (token) {
    cookieParts.push(`token=${encodeURIComponent(token)}`);
    cookieParts.push(`token_type=bearer`);
  }

  let originHeaders: Record<string, string> = {};
  if (url) {
    try {
      const u = new URL(url);
      originHeaders["Referer"] = `${u.origin}/c/index.html`;
      originHeaders["Origin"] = u.origin;
    } catch {
      // ignore
    }
  }

  return {
    "User-Agent":
      "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG254 Safari/533.3",
    "Accept-Encoding": "gzip",
    Accept: "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "en-US,en;q=0.9",
    Cookie: cookieParts.join("; "),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...originHeaders,
    "X-User-Agent": "Model: MAG254; Link: Ethernet",
    Connection: "Keep-Alive",
  };
};

const extract = (res: any): any[] => {
  let data = res?.data?.js?.data ?? res?.data?.js ?? res?.data ?? res ?? [];

  if (Array.isArray(data)) {
    return data.filter((v) => v != null && typeof v === "object");
  }

  if (typeof data === "object" && data !== null) {
    const values = Object.values(data).filter((v) => v != null);
    if (values.length > 0 && values.every((v) => Array.isArray(v))) {
      return values.flat().filter((v) => v != null && typeof v === "object");
    }
    if (values.length > 0 && values.every((v) => typeof v === "object")) {
      return values;
    }
    return [data];
  }

  return [];
};

const buildImageUrl = (base: string, raw?: any): string => {
  if (!raw || typeof raw !== "string") return "";
  const s = raw.trim();
  if (!s || s === "null" || s === "undefined" || s === "N/A" || s === "none") return "";
  if (s.startsWith("http://") || s.startsWith("https://")) return s;

  const serverRoot = base
    .replace(/\/$/, "")
    .replace(/\/portal\.php$/i, "")
    .replace(/\/c$/i, "");

  if (s.startsWith("/")) {
    return `${serverRoot}${s}`;
  }
  return `${serverRoot}/${s}`;
};

const pickRating = (v: any) => {
  const r =
    v?.rating_imdb ??
    v?.imdb_rating ??
    v?.rating ??
    v?.vote_average ??
    v?.rating_tmdb ??
    v?.score ??
    v?.kinopoisk_rating ??
    v?.rating_kinopoisk ??
    v?.imdb ??
    v?.kinopoisk;
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
    v?.year ??
    v?.production_year ??
    v?.release_year ??
    v?.first_air_date ??
    v?.o_name ??
    v?.name ??
    v?.title;
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
  const match = s.match(/(19\d{2}|20\d{2})/);
  return match ? match[0] : undefined;
};

const pickDescription = (v: any): string => {
  const desc =
    v?.description ??
    v?.plot ??
    v?.desc ??
    v?.info ??
    v?.storyline ??
    v?.short_description ??
    v?.comments ??
    v?.o_name ??
    v?.actors ??
    v?.director;
  if (!desc || typeof desc !== "string") return "";
  const s = desc.trim();
  return s === "null" || s === "undefined" ? "" : s;
};

// 🔁 Token refresh with deduplication & global state sync
const tokenRefreshMap = new Map<string, Promise<Portal>>();
const warmPromiseMap = new Map<string, Promise<void>>();

const isExpired = (p: Portal) =>
  !p?.config?.token ||
  !p?.config?.expiry ||
  Number(p.config.expiry) - Date.now() < 5 * 60 * 1000;

async function refreshToken(portal: Portal): Promise<Portal> {
  if (!isExpired(portal)) return portal;

  const key = portal.id;

  // Reuse in-flight refresh
  if (tokenRefreshMap.has(key)) {
    return tokenRefreshMap.get(key)!;
  }

  const cacheKey = `portal:${key}:auth`;

  const refreshPromise = (async () => {
    // Try cached token first
    const cached = await cacheManager.get<any>(cacheKey);
    if (cached && cached.expiry > Date.now() + 5 * 60 * 1000) {
      const updated = {
        ...portal,
        config: { ...portal.config, ...cached },
      };
      // 🟢 Sync to global state if still active
      const store = usePortalStore.getState();
      if (store.activePortal?.id === portal.id) {
        await store.setActivePortal(updated);
      } else {
        await store.updatePortal(portal.id, { config: updated.config });
      }
      return updated;
    }

    // Start new auth flow
    const auth = await portalApi.authenticate(portal);
    const updated = {
      ...portal,
      config: {
        ...portal.config,
        token: auth.token,
        expiry: auth.expiry,
        serverInfo: auth.serverInfo,
      },
    };

    // 🟢 CRITICAL: Persist updated portal (token!) to store & disk if still active
    const store = usePortalStore.getState();
    if (store.activePortal?.id === portal.id) {
      await store.setActivePortal(updated);
    } else {
      await store.updatePortal(portal.id, { config: updated.config });
    }

    // Cache for fast-path next time
    await cacheManager.set(
      cacheKey,
      { token: auth.token, expiry: auth.expiry, serverInfo: auth.serverInfo },
      CACHE_TTL.AUTH
    );

    // Warm portal data on first handshake
    try {
      portalApi.warmPortalData(updated).catch(() => { });
    } catch {
      // ignore
    }

    return updated;
  })();

  tokenRefreshMap.set(key, refreshPromise);

  try {
    return await refreshPromise;
  } finally {
    tokenRefreshMap.delete(key);
  }
}

export const portalApi = {
  async authenticate(portal: Portal) {
    const base = safe(portal.config.url).replace(/\/$/, "");
    const mac = formatMac(portal.config.mac ?? "");

    const hURL = `${base}/portal.php?type=stb&action=handshake&JsHttpRequest=1-xml`;

    let handshake: any = null;
    let lastError: any = null;

    // Retry handshake up to 3 times on transient errors
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        handshake = await axios.get(hURL, {
          ...rmAcceptHeader,
          headers: headers(mac, undefined, base),
          timeout: 60000,
        });
        if (handshake?.data?.js?.token) break;
      } catch (err) {
        lastError = err;
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }

    const token = handshake?.data?.js?.token;
    if (!token || typeof token !== "string") {
      throw lastError || new Error("Portal handshake failed: Server did not return a valid token.");
    }

    const pURL = `${base}/portal.php?type=stb&action=get_profile&token=${encodeURIComponent(
      token
    )}&JsHttpRequest=1-xml`;

    let profile: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        profile = await axios.get(pURL, {
          ...rmAcceptHeader,
          headers: headers(mac, token, base),
          timeout: 60000,
        });
        if (profile?.data) break;
      } catch (err) {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }

    const profileData = profile?.data?.js ?? {};
    const lifetimeSec = Number(
      profileData.token_page_lifetime ??
        profileData.account_page_lifetime ??
        3600
    );
    const validLifetimeSec = !isNaN(lifetimeSec) && lifetimeSec > 60 ? lifetimeSec : 3600;

    return {
      token,
      expiry: Date.now() + validLifetimeSec * 1000,
      serverInfo: profileData,
    };
  },

  async getLiveCategories(portal: Portal): Promise<Category[]> {
    const key = portal.id;
    const cacheKey = `portal:${key}:live:categories`;

    return requestManager.request(cacheKey, async () => {
      const refreshed = await refreshToken(portal);
      console.log(refreshed);
      const base = safe(refreshed.config.url).replace(/\/$/, "");
      const url = `${base}/portal.php?type=itv&action=get_genres&JsHttpRequest=1-xml`;

      const res = await axios.get(url, {
        ...rmAcceptHeader,
        headers: headers(
          refreshed.config.mac ?? "",
          refreshed.config.token ?? "",
          base
        ),
        timeout: 60000,
      });

      const rows = extract(res);
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
      const refreshed = await refreshToken(portal);
      const base = safe(refreshed.config.url).replace(/\/$/, "");
      let url = `${base}/portal.php?type=itv&action=get_ordered_list&p=${page}&JsHttpRequest=1-xml`;
      if (categoryId && categoryId !== "all") {
        url += `&genre=${encodeURIComponent(categoryId)}`;
      } else {
        url += `&genre=*`;
      }

      let res = await axios.get(url, {
        ...rmAcceptHeader,
        headers: headers(
          refreshed.config.mac ?? "",
          refreshed.config.token ?? "",
          base
        ),
        timeout: 60000,
      });

      let rows = extract(res);

      // Fallback 1: Try genre=0 if genre=* returned 0 items
      if ((!rows || rows.length === 0) && (!categoryId || categoryId === "all")) {
        const fbUrl1 = `${base}/portal.php?type=itv&action=get_ordered_list&p=${page}&genre=0&JsHttpRequest=1-xml`;
        const fbRes1 = await axios.get(fbUrl1, {
          ...rmAcceptHeader,
          headers: headers(refreshed.config.mac ?? "", refreshed.config.token ?? "", base),
          timeout: 30000,
        }).catch(() => null);
        if (fbRes1) {
          const fbRows1 = extract(fbRes1);
          if (fbRows1 && fbRows1.length > 0) rows = fbRows1;
        }
      }

      // Fallback 2: Try no genre parameter
      if ((!rows || rows.length === 0) && (!categoryId || categoryId === "all")) {
        const fbUrl2 = `${base}/portal.php?type=itv&action=get_ordered_list&p=${page}&JsHttpRequest=1-xml`;
        const fbRes2 = await axios.get(fbUrl2, {
          ...rmAcceptHeader,
          headers: headers(refreshed.config.mac ?? "", refreshed.config.token ?? "", base),
          timeout: 30000,
        }).catch(() => null);
        if (fbRes2) {
          const fbRows2 = extract(fbRes2);
          if (fbRows2 && fbRows2.length > 0) rows = fbRows2;
        }
      }
      const result = rows.map((c: any) => ({
        id: String(c.id ?? c.cmd ?? ""),
        name: c.name ?? c.title ?? "Unknown",
        logo: buildImageUrl(base, c.logo ?? c.logo_30x30 ?? c.screenshot_uri ?? c.poster ?? c.pic ?? ""),
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
      const refreshed = await refreshToken(portal);
      const base = safe(refreshed.config.url).replace(/\/$/, "");
      const url = `${base}/portal.php?type=vod&action=get_categories&JsHttpRequest=1-xml`;

      const res = await axios.get(url, {
        ...rmAcceptHeader,
        headers: headers(
          refreshed.config.mac ?? "",
          refreshed.config.token ?? "",
          base
        ),
        timeout: 60000,
      });

      const rows = extract(res);
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
      try {
        const refreshed = await refreshToken(portal);
        const base = safe(refreshed.config.url).replace(/\/$/, "");
        let url = `${base}/portal.php?type=vod&action=get_ordered_list&p=${page}&JsHttpRequest=1-xml`;
        if (categoryId && categoryId !== "all") {
          url += `&category=${encodeURIComponent(categoryId)}`;
        } else {
          url += `&category=*`;
        }

        let res = await axios.get(url, {
          ...rmAcceptHeader,
          headers: headers(
            refreshed.config.mac ?? "",
            refreshed.config.token ?? "",
            base
          ),
          timeout: 60000,
        });

        let rows = extract(res);

        // Fallback 1: Try category=0 if category=* returned 0 items
        if ((!rows || rows.length === 0) && (!categoryId || categoryId === "all")) {
          const fbUrl1 = `${base}/portal.php?type=vod&action=get_ordered_list&p=${page}&category=0&JsHttpRequest=1-xml`;
          const fbRes1 = await axios.get(fbUrl1, {
            ...rmAcceptHeader,
            headers: headers(refreshed.config.mac ?? "", refreshed.config.token ?? "", base),
            timeout: 30000,
          }).catch(() => null);
          if (fbRes1) {
            const fbRows1 = extract(fbRes1);
            if (fbRows1 && fbRows1.length > 0) rows = fbRows1;
          }
        }

        // Fallback 2: Try no category parameter
        if ((!rows || rows.length === 0) && (!categoryId || categoryId === "all")) {
          const fbUrl2 = `${base}/portal.php?type=vod&action=get_ordered_list&p=${page}&JsHttpRequest=1-xml`;
          const fbRes2 = await axios.get(fbUrl2, {
            ...rmAcceptHeader,
            headers: headers(refreshed.config.mac ?? "", refreshed.config.token ?? "", base),
            timeout: 30000,
          }).catch(() => null);
          if (fbRes2) {
            const fbRows2 = extract(fbRes2);
            if (fbRows2 && fbRows2.length > 0) rows = fbRows2;
          }
        }

        const result = rows.map((v: any) => {
          const rawLogo =
            v.screenshot_uri ??
            v.poster ??
            v.cover ??
            v.big_poster ??
            v.poster_url ??
            v.pic ??
            v.logo ??
            v.stream_icon ??
            v.image ??
            v.icon ??
            "";
          return {
            id: String(v.id ?? ""),
            name: v.name ?? v.title ?? "Unknown",
            logo: buildImageUrl(base, rawLogo),
            category: v.category_name ?? v.genre ?? "",
            categoryId: String(v.category_id ?? ""),
            streamUrl: v.cmd ?? "",
            description: pickDescription(v),
            year: pickYear(v),
            rating: pickRating(v),
            duration: v.time ?? v.duration ?? "",
          };
        });

        await cacheManager.set(cacheKey, result, CACHE_TTL.VOD);
        return result;
      } catch (err) {
        console.warn(`getVodItems error (page ${page}):`, err);
        return [];
      }
    });
  },

  async getSeriesCategories(portal: Portal): Promise<Category[]> {
    const key = portal.id;
    const cacheKey = `portal:${key}:series:categories`;

    return requestManager.request(cacheKey, async () => {
      const refreshed = await refreshToken(portal);
      const base = safe(refreshed.config.url).replace(/\/$/, "");
      const url = `${base}/portal.php?type=series&action=get_categories&JsHttpRequest=1-xml`;

      const res = await axios.get(url, {
        ...rmAcceptHeader,
        headers: headers(
          refreshed.config.mac ?? "",
          refreshed.config.token ?? "",
          base
        ),
        timeout: 60000,
      });

      const rows = extract(res);
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
      try {
        const refreshed = await refreshToken(portal);
        const base = safe(refreshed.config.url).replace(/\/$/, "");
        let url = `${base}/portal.php?type=series&action=get_ordered_list&p=${page}&JsHttpRequest=1-xml`;
        if (categoryId && categoryId !== "all") {
          url += `&category=${encodeURIComponent(categoryId)}`;
        } else {
          url += `&category=*`;
        }

        let res = await axios.get(url, {
          ...rmAcceptHeader,
          headers: headers(
            refreshed.config.mac ?? "",
            refreshed.config.token ?? "",
            base
          ),
          timeout: 60000,
        });

        let rows = extract(res);

        // Fallback 1: Try category=0 if category=* returned 0 items
        if ((!rows || rows.length === 0) && (!categoryId || categoryId === "all")) {
          const fallbackUrl = `${base}/portal.php?type=series&action=get_ordered_list&p=${page}&category=0&JsHttpRequest=1-xml`;
          const fbRes = await axios.get(fallbackUrl, {
            ...rmAcceptHeader,
            headers: headers(refreshed.config.mac ?? "", refreshed.config.token ?? "", base),
            timeout: 30000,
          }).catch(() => null);
          if (fbRes) {
            const fbRows = extract(fbRes);
            if (fbRows && fbRows.length > 0) rows = fbRows;
          }
        }

        // Fallback 2: Try type=vod&movie_type=series if series returned 0 items
        if ((!rows || rows.length === 0) && (!categoryId || categoryId === "all")) {
          const fallbackUrl2 = `${base}/portal.php?type=vod&action=get_ordered_list&p=${page}&category=*&movie_type=series&JsHttpRequest=1-xml`;
          const fbRes2 = await axios.get(fallbackUrl2, {
            ...rmAcceptHeader,
            headers: headers(refreshed.config.mac ?? "", refreshed.config.token ?? "", base),
            timeout: 30000,
          }).catch(() => null);
          if (fbRes2) {
            const fbRows2 = extract(fbRes2);
            if (fbRows2 && fbRows2.length > 0) rows = fbRows2;
          }
        }

        const result = rows.map((v: any) => {
          const rawLogo =
            v.screenshot_uri ??
            v.poster ??
            v.cover ??
            v.big_poster ??
            v.poster_url ??
            v.pic ??
            v.logo ??
            v.stream_icon ??
            v.image ??
            v.icon ??
            "";
          return {
            id: String(v.id ?? ""),
            name: v.name ?? v.title ?? "Unknown",
            logo: buildImageUrl(base, rawLogo),
            category: v.category_name ?? v.genre ?? "",
            categoryId: String(v.category_id ?? ""),
            description: pickDescription(v),
            year: pickYear(v),
            rating: pickRating(v),
          };
        });

        await cacheManager.set(cacheKey, result, CACHE_TTL.SERIES);
        return result;
      } catch (err) {
        console.warn(`getSeries error (page ${page}):`, err);
        return [];
      }
    });
  },

  async getSeriesInfo(portal: Portal, seriesId: string): Promise<Season[]> {
    const key = portal.id;
    const cacheKey = `portal:${key}:series:info:${seriesId}`;

    return requestManager.request(cacheKey, async () => {
      const refreshed = await refreshToken(portal);
      const base = safe(refreshed.config.url).replace(/\/$/, "");
      const url = `${base}/portal.php?type=series&action=get_ordered_list&movie_id=${encodeURIComponent(
        seriesId
      )}&JsHttpRequest=1-xml`;

      const res = await axios.get(url, {
        ...rmAcceptHeader,
        headers: headers(
          refreshed.config.mac ?? "",
          refreshed.config.token ?? "",
          base
        ),
        timeout: 60000,
      });

      const rows = extract(res);
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
          refreshed.config.token ?? "",
          base
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
        refreshed.config.token ?? "",
        base
      ),
      timeout: 60000,
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
          description: (p.descr ?? p.description) || "No description available for this content.",
          start: toMs(p.start_timestamp ?? p.start),
          end: toMs(p.stop_timestamp ?? p.end),
        });
      }
    }
    return out;
  },

  async search(portal: Portal, q: string, type: string) {
    const refreshed = await refreshToken(portal);
    const base = safe(refreshed.config.url).replace(/\/$/, "");
    const url = `${base}/portal.php?type=${type}&action=get_ordered_list&search=${encodeURIComponent(
      q
    )}&JsHttpRequest=1-xml`;

    const res = await axios.get(url, {
      ...rmAcceptHeader,
      headers: headers(
        refreshed.config.mac ?? "",
        refreshed.config.token ?? "",
        base
      ),
      timeout: 60000,
    });

    return extract(res);
  },

  async getLiveChannelsForSearch(portal: Portal): Promise<Channel[]> {
    const key = portal.id;
    const cacheKey = `portal:${key}:live:channels:search:all`;

    return requestManager.request(cacheKey, async () => {
      const refreshed = await refreshToken(portal);
      const base = safe(refreshed.config.url).replace(/\/$/, "");
      let url = `${base}/portal.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`;

      const res = await axios.get(url, {
        ...rmAcceptHeader,
        headers: headers(
          refreshed.config.mac ?? "",
          refreshed.config.token ?? "",
          base
        ),
        timeout: 60000,
      });

      const rows = extract(res);
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
    const key = portal.id;
    if (warmPromiseMap.has(key)) {
      return warmPromiseMap.get(key)!;
    }

    const warmPromise = (async () => {
      try {
        if (portal.type !== "mag") {
          return await this.refreshPortalData(portal);
        }

        // Ensure we have a valid token before warming
        const refreshed = await refreshToken(portal);
        const base = safe(refreshed.config.url).replace(/\/$/, "");
        const mac = refreshed.config.mac ?? "";
        const token = refreshed.config.token ?? "";

        // Helper to only fetch if cache missing, but always returns current data (cached or loaded)
        const fetchIfMissing = async <T>(
          cacheKey: string,
          loader: () => Promise<T>,
          ttl: number,
          setter?: (v: T) => void
        ): Promise<T | null> => {
          try {
            if (await cacheManager.has(cacheKey)) {
              const cached = await cacheManager.get<T>(cacheKey);
              if (cached != null) return cached;
            }
            const val = await loader();
            // Validate that we don't overwrite with empty data by accident
            if (Array.isArray(val) && val.length === 0) return null;
            await cacheManager.set(cacheKey, val, ttl);
            if (setter) setter(val);
            return val;
          } catch (e) {
            // non-fatal warming error
            console.warn(`warmPortalData failed for ${cacheKey}:`, e);
            return null;
          }
        };

        let liveCategories: Category[] = [];
        let vodCategories: Category[] = [];
        let seriesCategories: Category[] = [];

        // Live categories
        const liveCats = (await fetchIfMissing(
          `portal:${key}:live:categories`,
          async () => {
            const url = `${base}/portal.php?type=itv&action=get_genres&JsHttpRequest=1-xml`;
            const res = await axios.get(url, {
              ...rmAcceptHeader,
              headers: headers(mac, token, base),
              timeout: 60000,
            });
            const rows = extract(res);
            return rows.map((c: any) => ({
              id: String(c.id ?? c.gid ?? ""),
              name: c.title ?? c.name ?? c.genre_name ?? "Unknown",
              type: "live" as const,
            }));
          },
          CACHE_TTL.CATEGORIES
        )) || [];
        liveCategories = liveCats;

        // All live channels (for search / initial listing)
        await fetchIfMissing(
          `portal:${key}:live:channels:search:all`,
          async () => {
            const url = `${base}/portal.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`;
            const res = await axios.get(url, {
              ...rmAcceptHeader,
              headers: headers(mac, token, base),
              timeout: 60000,
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
          (v) => usePortalStore.getState().setChannels(v as any, key)
        );

        // VOD categories
        const vodCats = (await fetchIfMissing(
          `portal:${key}:vod:categories`,
          async () => {
            const url = `${base}/portal.php?type=vod&action=get_categories&JsHttpRequest=1-xml`;
            const res = await axios.get(url, {
              ...rmAcceptHeader,
              headers: headers(mac, token, base),
              timeout: 60000,
            });
            const rows = extract(res);
            return rows.map((c: any) => ({
              id: String(c.id ?? ""),
              name: c.title ?? c.name ?? "Unknown",
              type: "vod" as const,
            }));
          },
          CACHE_TTL.CATEGORIES
        )) || [];
        vodCategories = vodCats;

        // VOD items (first page)
        await fetchIfMissing(
          `portal:${key}:vod:items:all:1`,
          async () => {
            const url = `${base}/portal.php?type=vod&action=get_ordered_list&p=1&JsHttpRequest=1-xml`;
            const res = await axios.get(url, {
              ...rmAcceptHeader,
              headers: headers(mac, token, base),
              timeout: 60000,
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
          (v) => usePortalStore.getState().setVodItems(v as any, key)
        );

        // Series categories
        const seriesCats = (await fetchIfMissing(
          `portal:${key}:series:categories`,
          async () => {
            const url = `${base}/portal.php?type=series&action=get_categories&JsHttpRequest=1-xml`;
            const res = await axios.get(url, {
              ...rmAcceptHeader,
              headers: headers(mac, token, base),
              timeout: 60000,
            });
            const rows = extract(res);
            return rows.map((c: any) => ({
              id: String(c.id ?? ""),
              name: c.title ?? c.name ?? "Unknown",
              type: "series" as const,
            }));
          },
          CACHE_TTL.CATEGORIES
        )) || [];
        seriesCategories = seriesCats;

        // Push all warmed categories (live, vod, series) to store
        const allWarmedCategories = [
          ...liveCategories,
          ...vodCategories,
          ...seriesCategories,
        ];
        if (allWarmedCategories.length > 0) {
          await usePortalStore.getState().setCategories(allWarmedCategories, key);
        }

        // Series list (first page)
        await fetchIfMissing(
          `portal:${key}:series:list:all:1`,
          async () => {
            const url = `${base}/portal.php?type=series&action=get_ordered_list&p=1&JsHttpRequest=1-xml`;
            const res = await axios.get(url, {
              ...rmAcceptHeader,
              headers: headers(mac, token, base),
              timeout: 60000,
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
          (v) => usePortalStore.getState().setSeries(v as any, key)
        );

        // EPG
        await fetchIfMissing(
          `portal:${key}:epg`,
          async () => {
            const url = `${base}/portal.php?type=itv&action=epg_info&JsHttpRequest=1-xml`;
            const res = await axios.get(url, {
              headers: headers(mac, token, base),
              timeout: 60000,
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
                  description: (p.descr ?? p.description) || "No description available for this content.",
                  start: toMs(p.start_timestamp ?? p.start),
                  end: toMs(p.stop_timestamp ?? p.end),
                });
              }
            }
            return out;
          },
          CACHE_TTL.EPG,
          (v) => usePortalStore.getState().setEpgData(v as any, key)
        );
      } catch (e) {
        console.warn("warmPortalData top-level failure:", e);
      } finally {
        warmPromiseMap.delete(key);
      }
    })();

    warmPromiseMap.set(key, warmPromise);
    return warmPromise;
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
          store.setCategories(allCategories, portal.id),
          store.setChannels(data.liveChannels || [], portal.id),
          store.setVodItems(data.vodItems || [], portal.id),
          store.setSeries(data.seriesList || [], portal.id),
          store.setEpgData([], portal.id),
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
          store.setCategories(allCategories, portal.id),
          store.setChannels(data.liveChannels || [], portal.id),
          store.setVodItems(data.vodItems || [], portal.id),
          store.setSeries(data.seriesList || [], portal.id),
        ]);

        console.log("✅ M3U portal data refreshed");
        return;
      }

      // ---------------------------------------
      // STALKER / MAG LOGIC
      // ---------------------------------------
      // Ensure token is refreshed before fetching
      const refreshed = await refreshToken(portal);
      const base = safe(refreshed.config.url).replace(/\/$/, "");
      const mac = refreshed.config.mac ?? "";
      const token = refreshed.config.token ?? "";

      // Fetch all data
      const liveCategoriesUrl = `${base}/portal.php?type=itv&action=get_genres&JsHttpRequest=1-xml`;
      const liveCategoriesRes = await axios.get(liveCategoriesUrl, {
        ...rmAcceptHeader,
        headers: headers(mac, token, base),
        timeout: 60000,
      });
      const liveCategoriesRows = extract(liveCategoriesRes);
      const liveCategories = liveCategoriesRows.map((c: any) => ({
        id: String(c.id ?? c.gid ?? ""),
        name: c.title ?? c.name ?? c.genre_name ?? "Unknown",
        type: "live" as const,
      }));

      const liveChannelsUrl = `${base}/portal.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`;
      const liveChannelsRes = await axios.get(liveChannelsUrl, {
        ...rmAcceptHeader,
        headers: headers(mac, token, base),
        timeout: 60000,
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

      const vodCategoriesUrl = `${base}/portal.php?type=vod&action=get_categories&JsHttpRequest=1-xml`;
      const vodCategoriesRes = await axios.get(vodCategoriesUrl, {
        ...rmAcceptHeader,
        headers: headers(mac, token, base),
        timeout: 60000,
      });
      const vodCategoriesRows = extract(vodCategoriesRes);
      const vodCategories = vodCategoriesRows.map((c: any) => ({
        id: String(c.id ?? ""),
        name: c.title ?? c.name ?? "Unknown",
        type: "vod" as const,
      }));

      const vodItemsUrl = `${base}/portal.php?type=vod&action=get_ordered_list&p=1&JsHttpRequest=1-xml`;
      const vodItemsRes = await axios.get(vodItemsUrl, {
        ...rmAcceptHeader,
        headers: headers(mac, token, base),
        timeout: 60000,
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

      const seriesCategoriesUrl = `${base}/portal.php?type=series&action=get_categories&JsHttpRequest=1-xml`;
      const seriesCategoriesRes = await axios.get(seriesCategoriesUrl, {
        ...rmAcceptHeader,
        headers: headers(mac, token, base),
        timeout: 60000,
      });
      const seriesCategoriesRows = extract(seriesCategoriesRes);
      const seriesCategories = seriesCategoriesRows.map((c: any) => ({
        id: String(c.id ?? ""),
        name: c.title ?? c.name ?? "Unknown",
        type: "series" as const,
      }));

      const seriesListUrl = `${base}/portal.php?type=series&action=get_ordered_list&p=1&JsHttpRequest=1-xml`;
      const seriesListRes = await axios.get(seriesListUrl, {
        ...rmAcceptHeader,
        headers: headers(mac, token, base),
        timeout: 60000,
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

      const epgUrl = `${base}/portal.php?type=itv&action=epg_info&JsHttpRequest=1-xml`;
      const epgRes = await axios.get(epgUrl, {
        headers: headers(mac, token, base),
        timeout: 60000,
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
            description: (p.descr ?? p.description) || "No description available for this content.",
            start: toMs(p.start_timestamp ?? p.start),
            end: toMs(p.stop_timestamp ?? p.end),
          });
        }
      }

      // Check if data is valid before persisting
      if (liveChannels.length === 0 && vodItems.length === 0 && seriesList.length === 0) {
        throw new Error("Portal returned empty data. Token may be invalid.");
      }

      // Save to cache and store
      await cacheManager.set(`portal:${key}:live:channels:search:all`, liveChannels, CACHE_TTL.CHANNELS);
      await cacheManager.set(`portal:${key}:vod:items:all:1`, vodItems, CACHE_TTL.VOD);
      await cacheManager.set(`portal:${key}:series:list:all:1`, seriesList, CACHE_TTL.SERIES);
      await cacheManager.set(`portal:${key}:epg`, epgPrograms, CACHE_TTL.EPG);

      const allMagCategories = [
        ...(liveCategories || []),
        ...(vodCategories || []),
        ...(seriesCategories || []),
      ];

      await Promise.all([
        store.setCategories(allMagCategories, key),
        store.setChannels(liveChannels, key),
        store.setVodItems(vodItems, key),
        store.setSeries(seriesList, key),
        store.setEpgData(epgPrograms, key)
      ]);

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
        store.setCategories(portal.categories, key);
      }

      // Load other cached data in parallel
      const [
        liveChannelsFull, liveChannelsPage1,
        vodItemsPage1,
        seriesListPage1,
        epg
      ] = await Promise.all([
        cacheManager.get<Channel[]>(`portal:${key}:live:channels:search:all`),
        cacheManager.get<Channel[]>(`portal:${key}:live:channels:all:1`),
        cacheManager.get<VODItem[]>(`portal:${key}:vod:items:all:1`),
        cacheManager.get<Series[]>(`portal:${key}:series:list:all:1`),
        cacheManager.get<EPGProgram[]>(`portal:${key}:epg`),
      ]);

      const liveChannels = liveChannelsFull || liveChannelsPage1;
      const vodItems = vodItemsPage1;
      const seriesList = seriesListPage1;

      const nowCutoff = Date.now() - 12 * 60 * 60 * 1000;
      const validEpg = (epg || []).filter((p) => p.end >= nowCutoff);

      if (liveChannels && liveChannels.length > 0) store.setChannels(liveChannels, key);
      else store.setChannels([], key);

      if (vodItems && vodItems.length > 0) store.setVodItems(vodItems, key);
      else store.setVodItems([], key);

      if (seriesList && seriesList.length > 0) store.setSeries(seriesList, key);
      else store.setSeries([], key);

      if (validEpg.length > 0) store.setEpgData(validEpg, key);
      else store.setEpgData([], key);

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
      const key = portal.id;

      // Clear raw AsyncStorage keys written directly by the store
      await AsyncStorage.multiRemove([
        `portal:${key}:channels`,
        `portal:${key}:vod`,
        `portal:${key}:series`,
        `portal:${key}:categories`,
        `portal:${key}:epg`,
      ]).catch(console.warn);

      if (portal.type === "mag") {
        await cacheManager.removeByPrefix(`portal:${key}`);
      } else if (portal.type === "xtream") {
        // xtream:URL:USERNAME:...
        const prefix = `xtream:${portal.config.url}:${portal.config.username}`;
        await cacheManager.removeByPrefix(prefix);
      } else if (portal.type === "m3u") {
        // m3u:portal:ID:...
        const prefix = `m3u:portal:${portal.id}`;
        await cacheManager.removeByPrefix(prefix);

        // Also try legacy URL based if no ID
        await cacheManager.removeByPrefix(`m3u:${portal.config.url}`);
      }
      console.log(`🗑️ Deleted all data for portal ${portal.name} (${portal.type})`);
    } catch (e) {
      console.warn("deletePortalData failed:", e);
    }
  },
};
