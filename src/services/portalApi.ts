// portalApi.ts
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { safeStorage } from "./safeStorage";
import { cacheManager, CACHE_TTL } from "./cacheManager";
import { requestManager } from "./requestManager";
import { cleanMetaText, splitMetaList as splitList } from "./metaText";
import { readEpisodeMedia } from "./episodeMedia";
import { formatRuntime } from "../utils/duration";
import { NetworkActivity } from "./networkActivity";
import { prewarmDns } from "./dnsResolver";
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

/**
 * Portal timestamps arrive as unix seconds, unix milliseconds, or a formatted
 * date string depending on the endpoint and the firmware behind it. Every EPG
 * reader in this file goes through here so they cannot drift apart.
 */
function magChannelNumber(c: any): number | undefined {
  const n = Number(c?.number ?? c?.num ?? c?.ch_number);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Normalises whatever a MAG portal calls a programme list.
 *
 * Three shapes are known to come back from the endpoints above:
 *
 *   • `{ "<chId>": [ ...programmes ] }` — the common bulk form;
 *   • `{ data: [ ...programmes ] }` — Ministra's paginated wrapper, where each
 *     programme carries its own `ch_id`;
 *   • a bare array, same as `data` without the wrapper.
 *
 * Field names vary within those too (`name`/`title`, `descr`/`description`,
 * `start_timestamp`/`start`/`time`), which is why every read below is a
 * fallback chain rather than a single key.
 */
function parseMagEpg(js: any): EPGProgram[] {
  if (!js) return [];

  const out: EPGProgram[] = [];

  const push = (raw: any, channelId: string) => {
    if (!raw) return;
    const cid = String(channelId || raw.ch_id || raw.channel_id || raw.xml_id || raw.epg_id || "");
    if (!cid) return;
    const start = epgTimeToMs(raw.start_timestamp ?? raw.start ?? raw.time ?? raw.start_time);
    const end = epgTimeToMs(raw.stop_timestamp ?? raw.end ?? raw.time_to ?? raw.end_time ?? raw.stop);
    if (!start || !end || end <= start) return;
    out.push({
      id: String(raw.id ?? `${cid}-${start}`),
      channelId: cid,
      title: raw.name ?? raw.title ?? "",
      description:
        (raw.descr ?? raw.description) || "No description available for this content.",
      start,
      end,
    });
  };

  // Bare array, or Ministra's { data: [...] } / { rows: [...] } wrapper.
  const flat = Array.isArray(js) ? js : Array.isArray(js.data) ? js.data : Array.isArray(js.rows) ? js.rows : null;
  if (flat) {
    for (const raw of flat) push(raw, "");
    return out;
  }

  // Otherwise a map of channel id → programmes or nested objects
  if (typeof js === "object") {
    for (const [cid, val] of Object.entries(js)) {
      if (Array.isArray(val)) {
        for (const raw of val) push(raw, cid);
      } else if (val && typeof val === "object") {
        if (Array.isArray((val as any).data)) {
          for (const raw of (val as any).data) push(raw, cid);
        } else if (Array.isArray((val as any).epg)) {
          for (const raw of (val as any).epg) push(raw, cid);
        }
      }
    }
  }
  return out;
}

function epgTimeToMs(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  const str = String(v).trim();
  if (!str) return 0;
  if (/^\d+$/.test(str)) {
    const n = Number(str);
    return n < 1e12 ? n * 1000 : n;
  }
  const parsed = Date.parse(str);
  return isNaN(parsed) ? 0 : parsed;
}


// ─── Redirect resolution ──────────────────────────────────────────────────────
// Some Stalker/Xtream/M3U backends return a URL that itself 301/302-redirects
// to the real CDN edge node. Letting the player follow that at play-time adds
// a full extra DNS+TCP+TLS+HTTP round trip before the first byte arrives.
// Resolve the chain once here and hand the player the final direct URL.
async function resolveDirectStreamUrl(startUrl: string): Promise<string> {
  if (!/^https?:\/\//i.test(startUrl)) return startUrl; // rtmp/rtsp/etc — nothing to resolve

  // 1. Try HEAD request via Fetch API first (fastest — res.url contains final target after 301/302 redirects)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(startUrl, {
      method: "HEAD",
      signal: controller.signal,
      headers: {
        "User-Agent": "okhttp/3.12.1",
        Accept: "*/*",
      },
    });
    clearTimeout(timeoutId);

    if (res.url && /^https?:\/\//i.test(res.url) && res.url !== startUrl) {
      return res.url;
    }
  } catch {
    // HEAD failed or timed out, fallback to GET
  }

  // 2. Fallback: Fast Range GET via Axios to capture responseURL
  try {
    const res = await axios.get(startUrl, {
      timeout: 4000,
      headers: {
        "User-Agent": "okhttp/3.12.1",
        Accept: "application/json, text/javascript, */*; q=0.01",
        Range: "bytes=0-1024",
      },
      maxRedirects: 5,
    });

    const final =
      (res.request as any)?.responseURL ||
      (res.request as any)?._url ||
      (res.request as any)?._responseURL ||
      res.config?.url;

    if (final && /^https?:\/\//i.test(final)) {
      return final;
    }
  } catch (err: any) {
    const final =
      (err?.response?.request as any)?.responseURL ||
      (err?.request as any)?.responseURL ||
      (err?.response?.request as any)?._url;
    if (final && /^https?:\/\//i.test(final)) {
      return final;
    }
  }

  return startUrl;
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

/**
 * The set-top box this client presents itself as to a Stalker/Ministra portal.
 *
 * Portals commonly gate on the device model: a generic HTTP client is refused
 * where a known MAG is let through. Two headers carry the identity — the
 * browser-style User-Agent the MAG firmware sends, and Stalker's own
 * `X-User-Agent`, which is the one portal scripts usually read.
 *
 * One constant rather than a per-portal setting, because every request has to
 * agree with the handshake: a token issued to a MAG254 and then used by
 * something claiming to be a different device is how a portal decides a
 * session is forged.
 *
 * The ver/rev pair is the conventional one Stalker clients send with every
 * model — it is not MAG254-specific, and no precise revision for this box has
 * been invented here. Only the model token identifies the device.
 *
 * MAG254 because that is what the portal already has on file for this account:
 * its get_profile reply carries `"stb_type": "MAG254"`. Announcing anything
 * else would have the headers contradict the portal's own record of the box.
 * Nothing on that portal enforces it — `strict_stb_type_check` is empty and
 * `allowed_stb_types` is `[]` — but matching what the portal believes costs
 * nothing and removes a reason for it to distrust the session.
 */
const STB_MODEL = "MAG254";
const STB_USER_AGENT =
  "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) " +
  STB_MODEL +
  " stbapp ver: 2 rev: 250 Mobile Safari/533.3";

/**
 * Headers for a *stream* request.
 *
 * Deliberately NOT the MAG identity the portal API sends, and that is the
 * whole point of this being a separate function. A provider CDN is not the
 * portal: portals gate on being a recognised set-top box, CDNs gate on a
 * whitelist of clients they have seen behave, and for Android IPTV that
 * whitelist is okhttp. Announcing a MAG to something that has only ever been
 * asked for content by okhttp got streams refused outright.
 *
 * So okhttp stays here — the value this app has always streamed with — and
 * MAG254 stays on the portal API calls, where stb_type is what gets checked.
 *
 * Four things were tried here and taken back out after streaming stopped: the
 * MAG User-Agent, an `X-User-Agent` model line, `Origin`, and the mac Cookie.
 * The reasoning for the cookie was sound — Stalker portals do re-check
 * sessions between segments — but it was never shown to help, and an
 * unproven change does not belong on the path that has to work.
 */
export function streamHeaders(
  streamUrl: string,
  portal: Portal | null | undefined
): Record<string, string> {
  return {
    "User-Agent": "okhttp/3.12.1",
    Accept: "*/*",
  };
}

/**
 * The timezone claimed to the portal, from the device rather than a literal.
 *
 * This was hardcoded to "Europe/London". The portal schedules the guide in
 * whatever zone the box reports, so a box that is not in London was being
 * handed London times — a guide out by a whole number of hours, with every
 * programme's start and end shifted and "now" pointing at the wrong show.
 * It agreed with this account by luck: the profile carries
 * `default_timezone: "Europe/London"` and `timezone_diff: 0`, while the
 * profile IP is in the United States.
 *
 * Only an IANA name is any use here — the portal parses it as a zone, and
 * an offset string like "UTC-08:00" is not one. `resolveTimezone()` in
 * stbEnvironment falls back to exactly that offset form, which is right for
 * a status screen and wrong for this, so this resolves its own.
 *
 * When no IANA name can be had, the old literal stands. Falling back to a
 * real zone the portal already has on file beats sending it something it
 * may reject outright.
 *
 * Read once, at import: a viewer who changes the system timezone will need
 * to restart the app for the guide to follow. That is the same restart a
 * real set-top box needs, and it keeps this off the path of every request.
 */
const PORTAL_TIMEZONE: string = (() => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && (tz === "UTC" || tz.includes("/"))) return tz;
  } catch {
    /* Hermes without full ICU */
  }
  return "Europe/London";
})();

const headers = (mac: string, token?: string, url?: string) => {
  const formattedMac = formatMac(mac);
  const cookieParts = [
    `mac=${encodeURIComponent(formattedMac)}`,
    "stb_lang=en",
    "timezone=" + PORTAL_TIMEZONE,
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
    // Was "okhttp/3.12.1" — a generic client, identifying as no device at all.
    "User-Agent": STB_USER_AGENT,
    "X-User-Agent": "Model: " + STB_MODEL + "; Link: WiFi",
    "Accept-Encoding": "gzip",
    Accept: "application/json, text/javascript, */*; q=0.01",
    Cookie: cookieParts.join("; "),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),


    Connection: "Keep-Alive",
  };
};

/**
 * Resilient Axios wrapper for MAG/Stalker portal endpoints.
 * Automatically injects active session token into headers & query string,
 * detects HTTP 200 OK responses with empty bodies ("" or {}),
 * re-authenticates session token on attempt 0/1, and retries with exponential backoff.
 */
async function portalGet(
  portal: Portal,
  rawUrl: string,
  options: AxiosRequestConfig = {},
  retries: number = 2
): Promise<AxiosResponse<any>> {
  let currentPortal = portal;
  let lastError: any = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      prewarmDns(rawUrl);
      const refreshed = await refreshToken(currentPortal, attempt > 0);
      const base = safe(refreshed.config.url).replace(/\/$/, "");
      const mac = refreshed.config.mac ?? "";
      const token = refreshed.config.token ?? "";

      // Ensure token is attached to query string if present
      let url = rawUrl;
      if (token && !/([?&])token=/i.test(url)) {
        const separator = url.includes("?") ? "&" : "?";
        url = `${url}${separator}token=${encodeURIComponent(token)}`;
      }

      const reqConfig: AxiosRequestConfig = {
        ...rmAcceptHeader,
        ...options,
        headers: {
          ...headers(mac, token, base),
          ...(options.headers || {}),
        },
        timeout: options.timeout || 30000,
      };

      const res = await axios.get(url, reqConfig);
      const data = res?.data;

      // Check for HTTP 200 OK with empty body ("", null, {}, or empty js payload)
      const isEmpty =
        res.status === 200 &&
        (data === "" ||
          data == null ||
          (typeof data === "string" && data.trim().length === 0) ||
          (typeof data === "object" && Object.keys(data).length === 0) ||
          (data?.js === "" || (data?.js == null && !data?.data && !data?.result && !Array.isArray(data))));

      if (!isEmpty) {
        return res;
      }

      // On search queries, an empty response body indicates 0 matches found on server, not an auth error
      const isSearchRequest = /[?&]search=/i.test(url);
      if (isSearchRequest) {
        return {
          status: 200,
          statusText: "OK",
          headers: {},
          config: options as any,
          data: { js: [] },
        };
      }

      console.warn("⚠️ [MAG Portal] HTTP 200 OK with empty response body:", {
        url,
        status: res.status,
        attempt,
      });

      // Force session token refresh on empty body response
      if (attempt < retries) {
        try {
          const auth = await portalApi.authenticate(currentPortal);
          if (auth?.token) {
            currentPortal = {
              ...currentPortal,
              config: {
                ...currentPortal.config,
                token: auth.token,
                expiry: auth.expiry,
              },
            };
            // Config only — this is a token refresh, not a portal switch.
            await usePortalStore.getState().persistPortalConfig(currentPortal);
          }
        } catch (authErr) {
          console.warn("⚠️ Re-authentication retry failed:", authErr);
        }
      }

      const delay = 300 * (attempt + 1);
      await new Promise((r) => setTimeout(r, delay));

    } catch (err: any) {
      lastError = err;
      console.warn(`⚠️ [MAG Portal] Request error on attempt ${attempt}:`, err?.message || err);
      if (attempt === retries) throw err;
      const delay = 300 * (attempt + 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  // Return clean empty response if server returns empty body persistently
  return {
    status: 200,
    statusText: "OK",
    headers: {},
    config: options as any,
    data: { js: [] },
  };
}

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

export const buildImageUrl = (base: string, raw?: any): string => {
  if (!raw || typeof raw !== "string") return "";
  const s = raw.trim();
  if (!s || s === "null" || s === "undefined" || s === "N/A" || s === "none") return "";

  const serverRoot = base
    .replace(/\/$/, "")
    .replace(/\/portal\.php$/i, "")
    .replace(/\/c$/i, "");

  // Stale or internal domains hardcoded in provider databases (e.g. corelink.blog, webhop.live, starshare.live, localhost)
  // that must be rewritten to the user's active portal base URL.
  const rewriteStaleOrigin = (urlStr: string): string => {
    const STALE_HOSTS = /(?:webhop\.live|starshare\.live|corelink\.|corelink\.blog|stalker\.|mag\.local|iptv\.local|localhost|127\.0\.0\.1)/i;
    const urlMatch = urlStr.match(/^(https?:\/\/[^\/]+)(\/.*)?$/i);
    if (urlMatch) {
      const origin = urlMatch[1];
      const path = urlMatch[2] || "";
      if (STALE_HOSTS.test(origin)) {
        return path ? (path.startsWith("/") ? `${serverRoot}${path}` : `${serverRoot}/${path}`) : serverRoot;
      }
    }
    return urlStr;
  };

  // 1. Data URI: already has the data: scheme (e.g. data:image/png;base64,...)
  if (s.startsWith("data:")) {
    // If it's an incomplete / truncated base64 image payload (e.g. < 350 chars), drop it to avoid Glide decode crashes
    if (s.length < 350) return "";
    return s;
  }

  // 2. Direct HTTP / HTTPS link: rewrite stale provider hostnames if matched
  if (s.startsWith("http://") || s.startsWith("https://")) {
    return rewriteStaleOrigin(s);
  }

  // 3. Base64-encoded URL (e.g. aHR0cDov... -> http:// or aHR0cHM6... -> https://)
  if (s.startsWith("aHR0cDov") || s.startsWith("aHR0cHM6") || s.startsWith("aHR0cDox")) {
    try {
      const decoded = typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("utf-8");
      if (decoded && (decoded.startsWith("http://") || decoded.startsWith("https://"))) {
        return rewriteStaleOrigin(decoded);
      }
    } catch {
      // not a base64 url
    }
  }

  // 4. Raw base64 image data without the data: prefix (must have sufficient length to be a complete image)
  if (s.length >= 350) {
    if (s.startsWith("/9j/")) {
      return `data:image/jpeg;base64,${s}`;
    }
    if (s.startsWith("iVBORw0KGgo")) {
      return `data:image/png;base64,${s}`;
    }
    if (s.startsWith("R0lGOD")) {
      return `data:image/gif;base64,${s}`;
    }
    if (s.startsWith("UklGR")) {
      return `data:image/webp;base64,${s}`;
    }
    if (s.startsWith("PHN2Zw") || s.startsWith("PD94bW")) {
      return `data:image/svg+xml;base64,${s}`;
    }
    if (s.startsWith("Qk")) {
      return `data:image/bmp;base64,${s}`;
    }

    // Long base64 string without URL slashes or dots (common raw base64 image payload)
    if (s.length > 500 && /^[A-Za-z0-9+/=\s]+$/.test(s)) {
      try {
        const sample = s.replace(/\s+/g, "").slice(0, 32);
        const decoded = typeof atob === "function" ? atob(sample) : Buffer.from(sample, "base64").toString("binary");
        if (decoded.startsWith("\x89PNG")) return `data:image/png;base64,${s}`;
        if (decoded.charCodeAt(0) === 0xff && decoded.charCodeAt(1) === 0xd8) return `data:image/jpeg;base64,${s}`;
        if (decoded.startsWith("GIF")) return `data:image/gif;base64,${s}`;
        if (decoded.startsWith("RIFF")) return `data:image/webp;base64,${s}`;
      } catch {
        // not a raw base64 image
      }
    }
  }

  // 5. Server-relative path
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

/**
 * The credit block, as MAG/Stalker spells it.
 *
 * Unlike Xtream, this arrives on the ordinary list row — there is no separate
 * detail call — so it costs nothing to read here and the details sheet has it
 * immediately.
 */
const pickMeta = (v: any) => ({
  cast: splitList(v?.actors ?? v?.actor ?? v?.cast),
  director: cleanMeta(v?.director),
  // Not `category_name`: see the matching note in xtreamApi.ts. On MAG that
  // fallback fired for every item, so the chip row was always just the
  // category restated rather than genre data.
  tags: splitList(v?.genres_str ?? v?.genre_str ?? v?.genre),
  plot: cleanMeta(v?.description ?? v?.plot ?? v?.storyline),
  country: cleanMeta(v?.country),
  releaseDate: cleanMeta(v?.year ?? v?.released ?? v?.release_date),
});

const cleanMeta = cleanMetaText;

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

const isExpired = (p: Portal) => {
  if (!p?.config?.token) return true;
  if (!p?.config?.expiry) return false;
  return Number(p.config.expiry) - Date.now() < 5 * 60 * 1000;
};

async function refreshToken(portal: Portal, forceRefresh = false): Promise<Portal> {
  if (!forceRefresh && !isExpired(portal)) return portal;

  const key = portal.id;

  // Reuse in-flight refresh
  if (!forceRefresh && tokenRefreshMap.has(key)) {
    return tokenRefreshMap.get(key)!;
  }

  const cacheKey = `portal:${key}:auth`;

  const refreshPromise = (async () => {
    // Try cached token first unless forceRefresh is true
    if (!forceRefresh) {
      const cached = await cacheManager.get<any>(cacheKey);
      if (cached && cached.expiry > Date.now() + 5 * 60 * 1000) {
        const updated = {
          ...portal,
          config: { ...portal.config, ...cached },
        };
        // 🟢 Sync token to global state — config only, never content.
        await usePortalStore.getState().persistPortalConfig(updated);
        return updated;
      }
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

    // 🟢 CRITICAL: Persist updated portal (token!) to store & disk — config
    // only. Routing this through setActivePortal wiped all loaded content.
    await usePortalStore.getState().persistPortalConfig(updated);

    // Cache for fast-path next time
    await cacheManager.set(
      cacheKey,
      { token: auth.token, expiry: auth.expiry, serverInfo: auth.serverInfo },
      CACHE_TTL.AUTH
    );

    return updated;
  })();

  tokenRefreshMap.set(key, refreshPromise);

  try {
    return await refreshPromise;
  } finally {
    tokenRefreshMap.delete(key);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAG sequential-fetch pacing
// ─────────────────────────────────────────────────────────────────────────────
// Stalker portals throttle bursts, so the content endpoints are fetched one at a
// time with a gap between them. The gap was 250ms across seven calls, which put
// ~2s of pure sleeping on the startup path before the first item could render.
// 120ms is still comfortably above the rate limits these portals enforce.
const SPACING_MS = 120;
/** Settling pause after the session handshake before the first content call. */
const SETTLE_MS = 150;

/**
 * Push categories into the store as soon as they arrive, ahead of the content
 * endpoints. The sidebar is the first thing a user looks at and it only needs
 * these, so it should not wait on the channel/VOD/series downloads.
 */
function publishCategories(
  liveRows: any[],
  vodRows: any[],
  seriesRows: any[],
  portalId: string,
  store: ReturnType<typeof usePortalStore.getState>
): void {
  const mapCats = (rows: any[], type: "live" | "vod" | "series") =>
    rows.map((c: any) => {
      const rawId = String(c.id ?? c.gid ?? "");
      const id = rawId === "*" || rawId === "0" ? "all" : `${type}:${rawId}`;
      return {
        id,
        name: c.title ?? c.name ?? c.genre_name ?? "Unknown",
        type,
      };
    });

  const all = [
    ...mapCats(liveRows, "live"),
    ...mapCats(vodRows, "vod"),
    ...mapCats(seriesRows, "series"),
  ];
  if (all.length > 0) store.setCategories(all, portalId).catch(() => { });
}

// Helper for fetching lists with zero-item retry logic
async function fetchWithRetry(
  portal: Portal,
  urlBuilder: (refreshed: Portal) => string
): Promise<any[]> {
  let refreshed = await refreshToken(portal);
  let base = safe(refreshed.config.url).replace(/\/$/, "");
  let url = urlBuilder(refreshed);

  let res = await axios.get(url, {
    ...rmAcceptHeader,
    headers: headers(refreshed.config.mac ?? "", refreshed.config.token ?? "", base),
    timeout: 60000,
  });

  let rows = extract(res);

  if (rows.length === 0) {
    refreshed = await refreshToken(portal, true);
    base = safe(refreshed.config.url).replace(/\/$/, "");
    url = urlBuilder(refreshed);
    res = await axios.get(url, {
      ...rmAcceptHeader,
      headers: headers(refreshed.config.mac ?? "", refreshed.config.token ?? "", base),
      timeout: 60000,
    });
    rows = extract(res);
  }

  return rows;
}

export const portalApi = {
  /**
   * Tells the portal this box is still alive.
   *
   * Stalker profiles carry a `watchdog_timeout` (82s on the portal this
   * was written against) and a `last_watchdog` stamp. A real MAG posts
   * `type=watchdog&action=get_events` on that period, and portals use it to
   * decide a session is still in use. A reaped session stops authorising
   * further HLS segments, so the failure does not look like an auth error at
   * all — playback simply stalls part-way through a programme and comes back
   * when you re-tune. That is the symptom this exists to prevent.
   *
   * Deliberately not routed through `fetchWithRetry`: that treats an empty
   * result as a failure worth repeating, and an empty watchdog reply is the
   * normal one, so every ping would cost two requests.
   *
   * Never throws. A missed ping is not worth disturbing playback over, and
   * the next one is seconds away.
   */
  async watchdog(portal: Portal): Promise<void> {
    if (!portal || portal.type !== "mag") return;
    try {
      const refreshed = await refreshToken(portal);
      const base = safe(refreshed.config.url).replace(/\/$/, "");
      const url =
        base +
        "/portal.php?type=watchdog&action=get_events" +
        "&init=0&cur_play_type=1&event_active_id=0&JsHttpRequest=1-xml";
      await axios.get(url, {
        ...rmAcceptHeader,
        headers: headers(refreshed.config.mac ?? "", refreshed.config.token ?? "", base),
        timeout: 15000,
      });
    } catch {
      // See above: swallowed on purpose.
    }
  },

  watchdogPeriodMs(portal: Portal | null | undefined): number {
    const raw = Number((portal?.config as any)?.serverInfo?.watchdog_timeout);
    const seconds = Number.isFinite(raw) && raw > 0 ? raw : 90;
    return Math.max(30, Math.round(seconds * 0.75)) * 1000;
  },

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

    const handshakeData = handshake?.data?.js ?? {};
    const profileData = profile?.data?.js ?? {};
    // Parse explicit epoch timestamp if present (expiresAt or expiry), else calculate from lifetime
    const rawEpoch = Number(
      handshakeData.expiresAt ??
      handshakeData.expiry ??
      profileData.expiresAt ??
      profileData.expiry ??
      0
    );

    let expiryMs: number;
    if (rawEpoch > Date.now() / 1000) {
      // Future epoch timestamp — convert seconds to ms if necessary
      expiryMs = rawEpoch < 1e12 ? rawEpoch * 1000 : rawEpoch;
    } else {
      const lifetimeSec = Number(
        handshakeData.token_page_lifetime ??
        handshakeData.account_page_lifetime ??
        profileData.token_page_lifetime ??
        profileData.account_page_lifetime ??
        3600
      );
      const validLifetimeSec = !isNaN(lifetimeSec) && lifetimeSec > 60 ? lifetimeSec : 3600;
      expiryMs = Date.now() + validLifetimeSec * 1000;
    }

    return {
      token,
      expiry: expiryMs,
      serverInfo: { ...handshakeData, ...profileData },
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

      const result = rows
        .map((c: any) => {
          const rawId = String(c.id ?? c.gid ?? "");
          const name = String(c.title ?? c.name ?? c.genre_name ?? "Unknown").trim();
          return {
            id: rawId,
            name,
            type: "live" as const,
          };
        })
        .filter((c) => {
          const lower = c.name.toLowerCase();
          const idLower = c.id.toLowerCase();
          return (
            lower !== "all" &&
            lower !== "all channels" &&
            lower !== "all live" &&
            lower !== "all live channels" &&
            idLower !== "all" &&
            idLower !== "*" &&
            idLower !== "0" &&
            c.id !== ""
          );
        });

      if (result.length > 0) await cacheManager.set(cacheKey, result, CACHE_TTL.CATEGORIES);
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
      const rawCategoryId = categoryId?.includes(":") ? categoryId.split(":")[1] : categoryId;
      const isAllCat = !rawCategoryId || rawCategoryId === "all" || rawCategoryId === "*";

      let rows = await fetchWithRetry(portal, (refreshed) => {
        const base = safe(refreshed.config.url).replace(/\/$/, "");
        let url = `${base}/portal.php?type=itv&action=get_ordered_list&p=${page}&JsHttpRequest=1-xml`;
        if (!isAllCat) {
          url += `&genre=${encodeURIComponent(rawCategoryId!)}`;
        } else {
          url += `&genre=*`;
        }
        return url;
      });

      const refreshed = await refreshToken(portal);
      const base = safe(refreshed.config.url).replace(/\/$/, "");

      // Fallback 1: Try genre=0 if genre=* returned 0 items
      if ((!rows || rows.length === 0) && isAllCat) {
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
      if ((!rows || rows.length === 0) && isAllCat) {
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
        logo: buildImageUrl(base, c.logo ?? c.logo_30x30 ?? c.screen_uri ?? c.screenshot_uri ?? c.poster ?? c.pic ?? c.cover ?? ""),
        category: c.tv_genre_name ?? c.genre ?? c.category_name ?? "",
        categoryId: String(c.tv_genre_id ?? c.genre_id ?? c.category_id ?? ""),
        streamUrl: c.cmd ?? "",
        epgId: String(c.xml_id ?? c.epg_id ?? c.xmltv_id ?? c.tvg_id ?? c.epg_xml_id ?? c.custom_epg ?? ""),
        num: magChannelNumber(c),
      }));

      if (result.length > 0) await cacheManager.set(cacheKey, result, CACHE_TTL.CHANNELS);
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

      const result = rows
        .map((c: any) => {
          const rawId = String(c.id ?? "");
          const name = String(c.title ?? c.name ?? "Unknown").trim();
          return {
            id: `vod:${rawId}`,
            name,
            type: "vod" as const,
          };
        })
        .filter((c) => {
          const lower = c.name.toLowerCase();
          const rawId = c.id.replace("vod:", "").toLowerCase();
          return (
            lower !== "all" &&
            lower !== "all movies" &&
            lower !== "all vod" &&
            rawId !== "all" &&
            rawId !== "*" &&
            rawId !== "0" &&
            rawId !== ""
          );
        });

      if (result.length > 0) await cacheManager.set(cacheKey, result, CACHE_TTL.CATEGORIES);
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
        const rawCategoryId = categoryId?.includes(":") ? categoryId.split(":")[1] : categoryId;
        const isAllCat = !rawCategoryId || rawCategoryId === "all" || rawCategoryId === "*";

        const refreshed = await refreshToken(portal);
        const base = safe(refreshed.config.url).replace(/\/$/, "");
        const mac = refreshed.config.mac ?? "";
        const token = refreshed.config.token ?? "";

        const buildVodUrl = (p: number) => {
          let url = `${base}/portal.php?type=vod&action=get_ordered_list&p=${p}&JsHttpRequest=1-xml`;
          if (!isAllCat) {
            url += `&category=${encodeURIComponent(rawCategoryId!)}`;
          } else {
            url += `&category=*`;
          }
          return url;
        };

        const res1 = await axios.get(buildVodUrl(1), {
          ...rmAcceptHeader,
          headers: headers(mac, token, base),
          timeout: 30000,
        }).catch(() => null);

        let rows: any[] = res1 ? extract(res1) : [];

        // Fallback 1: Try category=0 if category=* returned 0 items
        if ((!rows || rows.length === 0) && isAllCat) {
          const fbUrl1 = `${base}/portal.php?type=vod&action=get_ordered_list&p=1&category=0&JsHttpRequest=1-xml`;
          const fbRes1 = await axios.get(fbUrl1, {
            ...rmAcceptHeader,
            headers: headers(mac, token, base),
            timeout: 30000,
          }).catch(() => null);
          if (fbRes1) {
            const fbRows1 = extract(fbRes1);
            if (fbRows1 && fbRows1.length > 0) rows = fbRows1;
          }
        }

        // Fallback 2: Try no category parameter
        if ((!rows || rows.length === 0) && isAllCat) {
          const fbUrl2 = `${base}/portal.php?type=vod&action=get_ordered_list&p=1&JsHttpRequest=1-xml`;
          const fbRes2 = await axios.get(fbUrl2, {
            ...rmAcceptHeader,
            headers: headers(mac, token, base),
            timeout: 30000,
          }).catch(() => null);
          if (fbRes2) {
            const fbRows2 = extract(fbRes2);
            if (fbRows2 && fbRows2.length > 0) rows = fbRows2;
          }
        }

        // Automatically fetch remaining pages for the category if more items exist
        const js = res1?.data?.js;
        const totalItemsReported = Number(js?.total_items ?? js?.max_page_items ?? 0);
        const pageSize = rows.length > 0 ? rows.length : 14;

        if (totalItemsReported > rows.length && rows.length > 0) {
          const totalPages = Math.min(Math.ceil(totalItemsReported / pageSize), 60);
          const pagePromises: Promise<any[]>[] = [];
          for (let p = 2; p <= totalPages; p++) {
            pagePromises.push(
              axios.get(buildVodUrl(p), {
                ...rmAcceptHeader,
                headers: headers(mac, token, base),
                timeout: 30000,
              })
                .then(r => extract(r))
                .catch(() => [])
            );
          }
          const remainingPages = await Promise.all(pagePromises);
          for (const pageRows of remainingPages) {
            if (Array.isArray(pageRows)) {
              rows.push(...pageRows);
            }
          }
        }

        const result = rows.map((v: any) => {
          const rawLogo =
            v.screen_uri ??
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
            duration: formatRuntime(v.time, "minutes") ?? formatRuntime(v.duration) ?? "",
            ...pickMeta(v),
          };
        });

        if (result.length > 0) await cacheManager.set(cacheKey, result, CACHE_TTL.VOD);
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
      const rows = await fetchWithRetry(portal, (refreshed) => {
        const base = safe(refreshed.config.url).replace(/\/$/, "");
        return `${base}/portal.php?type=series&action=get_categories&JsHttpRequest=1-xml`;
      });

      const result = rows
        .map((c: any) => {
          const rawId = String(c.id ?? "");
          const name = String(c.title ?? c.name ?? "Unknown").trim();
          return {
            id: `series:${rawId}`,
            name,
            type: "series" as const,
          };
        })
        .filter((c) => {
          const lower = c.name.toLowerCase();
          const rawId = c.id.replace("series:", "").toLowerCase();
          return (
            lower !== "all" &&
            lower !== "all series" &&
            rawId !== "all" &&
            rawId !== "*" &&
            rawId !== "0" &&
            rawId !== ""
          );
        });

      if (result.length > 0) await cacheManager.set(cacheKey, result, CACHE_TTL.CATEGORIES);
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
        const rawCategoryId = categoryId?.includes(":") ? categoryId.split(":")[1] : categoryId;
        const isAllCat = !rawCategoryId || rawCategoryId === "all" || rawCategoryId === "*";

        const refreshed = await refreshToken(portal);
        const base = safe(refreshed.config.url).replace(/\/$/, "");
        const mac = refreshed.config.mac ?? "";
        const token = refreshed.config.token ?? "";

        const buildSeriesUrl = (p: number) => {
          let url = `${base}/portal.php?type=series&action=get_ordered_list&p=${p}&JsHttpRequest=1-xml`;
          if (!isAllCat) {
            url += `&category=${encodeURIComponent(rawCategoryId!)}`;
          } else {
            url += `&category=*`;
          }
          return url;
        };

        const res1 = await axios.get(buildSeriesUrl(1), {
          ...rmAcceptHeader,
          headers: headers(mac, token, base),
          timeout: 30000,
        }).catch(() => null);

        let rows: any[] = res1 ? extract(res1) : [];

        // Fallback 1: Try category=0 if category=* returned 0 items
        if ((!rows || rows.length === 0) && isAllCat) {
          const fallbackUrl = `${base}/portal.php?type=series&action=get_ordered_list&p=1&category=0&JsHttpRequest=1-xml`;
          const fbRes = await axios.get(fallbackUrl, {
            ...rmAcceptHeader,
            headers: headers(mac, token, base),
            timeout: 30000,
          }).catch(() => null);
          if (fbRes) {
            const fbRows = extract(fbRes);
            if (fbRows && fbRows.length > 0) rows = fbRows;
          }
        }

        // Fallback 2: Try type=vod&movie_type=series if series returned 0 items
        if ((!rows || rows.length === 0) && isAllCat) {
          const fallbackUrl2 = `${base}/portal.php?type=vod&action=get_ordered_list&p=1&category=*&movie_type=series&JsHttpRequest=1-xml`;
          const fbRes2 = await axios.get(fallbackUrl2, {
            ...rmAcceptHeader,
            headers: headers(mac, token, base),
            timeout: 30000,
          }).catch(() => null);
          if (fbRes2) {
            const fbRows2 = extract(fbRes2);
            if (fbRows2 && fbRows2.length > 0) rows = fbRows2;
          }
        }

        // Automatically fetch remaining pages for the series category if more items exist
        const js = res1?.data?.js;
        const totalItemsReported = Number(js?.total_items ?? js?.max_page_items ?? 0);
        const pageSize = rows.length > 0 ? rows.length : 14;

        if (totalItemsReported > rows.length && rows.length > 0) {
          const totalPages = Math.min(Math.ceil(totalItemsReported / pageSize), 60);
          const pagePromises: Promise<any[]>[] = [];
          for (let p = 2; p <= totalPages; p++) {
            pagePromises.push(
              axios.get(buildSeriesUrl(p), {
                ...rmAcceptHeader,
                headers: headers(mac, token, base),
                timeout: 30000,
              })
                .then(r => extract(r))
                .catch(() => [])
            );
          }
          const remainingPages = await Promise.all(pagePromises);
          for (const pageRows of remainingPages) {
            if (Array.isArray(pageRows)) {
              rows.push(...pageRows);
            }
          }
        }

        const result = rows.map((v: any) => {
          const rawLogo =
            v.screen_uri ??
            v.screenshot_uri ??
            v.cover ??
            v.poster ??
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
            ...pickMeta(v),
          };
        });

        if (result.length > 0) await cacheManager.set(cacheKey, result, CACHE_TTL.SERIES);
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
      let rows = await fetchWithRetry(portal, (refreshed) => {
        const base = safe(refreshed.config.url).replace(/\/$/, "");
        return `${base}/portal.php?type=series&action=get_ordered_list&movie_id=${encodeURIComponent(
          seriesId
        )}&JsHttpRequest=1-xml`;
      });

      const refreshed = await refreshToken(portal);
      const base = safe(refreshed.config.url).replace(/\/$/, "");

      if (!rows || (Array.isArray(rows) && rows.length === 0)) {
        // Fallback: try action=get_series_info or type=vod
        const fbUrl = `${base}/portal.php?type=series&action=get_series_info&series_id=${encodeURIComponent(
          seriesId
        )}&JsHttpRequest=1-xml`;
        const fbRes = await axios.get(fbUrl, {
          ...rmAcceptHeader,
          headers: headers(refreshed.config.mac ?? "", refreshed.config.token ?? "", base),
          timeout: 30000,
        }).catch(() => null);
        if (fbRes) {
          const fbRows = extract(fbRes);
          if (fbRows) rows = fbRows;
        }
      }

      const rowsRaw = rows as any;
      // Handle dictionary series structure (e.g. { info, seasons, episodes: { "1": [...] } })
      if (rowsRaw && typeof rowsRaw === "object" && !Array.isArray(rowsRaw) && (rowsRaw.episodes || rowsRaw.seasons)) {
        const episodesMap = rowsRaw.episodes || {};
        const seasonsList = Array.isArray(rowsRaw.seasons) ? rowsRaw.seasons : [];
        const seriesInfo = rowsRaw.info || {};
        const seriesMeta = pickMeta(seriesInfo);

        const dictSeasons: Season[] = Object.keys(episodesMap).map((seasonNum) => {
          const seasonInfo = seasonsList.find(
            (s: any) =>
              String(s.season_number) === String(seasonNum) ||
              String(s.id) === String(seasonNum)
          );
          const seasonName = seasonInfo?.name || `Season ${seasonNum}`;
          const rawCover = seasonInfo?.cover_big || seasonInfo?.cover;
          const seasonCover = rawCover ? buildImageUrl(base, rawCover) : undefined;
          const epList = Array.isArray(episodesMap[seasonNum]) ? episodesMap[seasonNum] : [];

          return {
            id: seasonNum,
            name: seasonName,
            seasonNumber: Number(seasonNum),
            cover: seasonCover,
            seriesMeta,
            episodes: epList.map((ep: any) => {
              const media = readEpisodeMedia(ep);

              return {
                id: String(ep.id ?? `${seriesId}:${seasonNum}-${ep.episode_num}`),
                name: ep.title || `Episode ${ep.episode_num}`,
                episodeNum: ep.episode_num,
                seasonNum: Number(seasonNum),
                cmd: ep.cmd,
                streamUrl: ep.streamUrl,
                description: pickDescription(ep.info) || pickDescription(ep),
                duration:
                  formatRuntime(ep.info?.duration) ??
                  formatRuntime(ep.info?.duration_secs, "seconds") ??
                  formatRuntime(ep.time, "minutes") ??
                  formatRuntime(ep.duration),
                still: media.still ? buildImageUrl(base, media.still) : undefined,
                airDate: ep.info?.releasedate ?? ep.info?.air_date ?? ep.air_date ?? ep.added,
                rating: ep.info?.rating ?? ep.rating,
                videoQuality: media.videoQuality,
                audioLanguage: media.audioLanguage,
              };
            }),
          };
        });

        if (dictSeasons.length > 0) {
          await cacheManager.set(cacheKey, dictSeasons, CACHE_TTL.SERIES_INFO);
          return dictSeasons;
        }
      }

      const rowsList = Array.isArray(rows) ? rows : [];
      const seasons: Season[] = [];

      // MAG returns the series' credits on the season rows themselves rather
      // than in a separate info block, so the first row that has any wins.
      const seriesMeta = (() => {
        for (const row of rowsList) {
          const meta = pickMeta(row);
          if (meta.cast || meta.director || meta.tags || meta.plot) return meta;
        }
        return undefined;
      })();

      for (const s of rowsList) {
        const seasonNum = Number(s.season_number ?? s.season ?? 1);
        const rawCover = s.cover_big ?? s.cover ?? s.poster ?? s.screenshot_uri ?? s.screen_uri ?? s.pic;
        const seasonCover = rawCover ? buildImageUrl(base, rawCover) : undefined;

        let episodes: Episode[] = [];
        let seriesRaw = s.series ?? s.episodes ?? s.data ?? s.list;

        // Convert object dictionary (e.g. {"1": ep1, "2": ep2} or {"1": "1", "2": "2"}) to array
        if (seriesRaw && typeof seriesRaw === "object" && !Array.isArray(seriesRaw)) {
          seriesRaw = Object.values(seriesRaw);
        }

        if (typeof seriesRaw === "string") {
          episodes = seriesRaw.split(",").map((num: string) => {
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
        } else if (Array.isArray(seriesRaw)) {
          episodes = seriesRaw.map((item: any, idx: number) => {
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
            const media = readEpisodeMedia(item);

            return {
              id: String(item.id ?? `${seriesId}:${seasonNum}-${epNum}`),
              name: item.title ?? item.name ?? `Episode ${epNum}`,
              episodeNum: epNum,
              seasonNum,
              cmd: item.cmd ?? s.cmd,
              description: pickDescription(item.info) || pickDescription(item) || pickDescription(s),
              duration:
                formatRuntime(item.info?.duration) ??
                formatRuntime(item.info?.duration_secs, "seconds") ??
                formatRuntime(item.time, "minutes") ??
                formatRuntime(item.duration),
              still: media.still ? buildImageUrl(base, media.still) : undefined,
              airDate: item.info?.releasedate ?? item.info?.air_date ?? item.air_date ?? item.added,
              rating: item.info?.rating ?? item.rating,
              videoQuality: media.videoQuality,
              audioLanguage: media.audioLanguage,
            };
          });
        } else if (s.cmd || s.id) {
          // Individual episode item returned directly
          const epNum = Number(s.episode_num ?? s.episode ?? s.num ?? 1);
          // This variant used to omit `info.still_path` from its own copy of the
          // fallback chain, so an episode returned bare lost its still. One
          // shared reader now, precisely so the three shapes cannot drift.
          const media = readEpisodeMedia(s);

          episodes = [{
            id: String(s.id ?? `${seriesId}:${seasonNum}-${epNum}`),
            name: s.title ?? s.name ?? `Episode ${epNum}`,
            episodeNum: epNum,
            seasonNum,
            cmd: s.cmd,
            description: pickDescription(s.info) || pickDescription(s),
            duration:
              formatRuntime(s.info?.duration) ??
              formatRuntime(s.info?.duration_secs, "seconds") ??
              formatRuntime(s.time, "minutes") ??
              formatRuntime(s.duration),
            still: media.still ? buildImageUrl(base, media.still) : undefined,
            airDate: s.info?.releasedate ?? s.info?.air_date ?? s.air_date ?? s.added,
            rating: s.info?.rating ?? s.rating,
            videoQuality: media.videoQuality,
            audioLanguage: media.audioLanguage,
          }];
        }

        episodes = episodes.filter((e) => !Number.isNaN(e.episodeNum));

        seasons.push({
          id: String(s.id ?? seasonNum),
          name: s.name ?? `Season ${seasonNum}`,
          seasonNumber: seasonNum,
          cover: seasonCover,
          seriesMeta,
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
    ep?: number,
    retryCount: number = 0
  ): Promise<string> {
    const latestPortal = usePortalStore.getState().activePortal ?? portal;
    const forceRefresh = retryCount > 0;
    let refreshed = latestPortal;
    try {
      refreshed = await refreshToken(latestPortal, forceRefresh);
    } catch (authErr) {
      console.warn("[portalApi] refreshToken error during getStreamUrl, using existing config:", authErr);
    }
    const base = safe(refreshed.config.url).replace(/\/$/, "");
    const serverRoot = base
      .replace(/\/$/, "")
      .replace(/\/portal\.php$/i, "")
      .replace(/\/c$/i, "");

    const cleanCmd = cmd.replace(/^(ffmpeg|ffrt\d*|auto|-i|vlc)\s+/i, "").trim();

    let url = `${base}/portal.php?type=${type}&action=create_link&cmd=${encodeURIComponent(
      cmd
    )}&JsHttpRequest=1-xml`;
    if (ep != null) url += `&series=${ep}`;

    const extractLink = (resData: any): string => {
      const js = resData?.js;
      const target = Array.isArray(js) ? js[0] : js;
      if (typeof target === "string") return target;
      if (target && typeof target === "object") {
        const found = target.cmd ?? target.url ?? target.link ?? target.playlist ?? target.stream ?? target.stream_url ?? target.uri ?? target.file ?? target.path ?? "";
        if (found) return String(found).trim();
      }
      const dataTarget = Array.isArray(resData) ? resData[0] : resData;
      if (typeof dataTarget === "string") return dataTarget;
      if (dataTarget && typeof dataTarget === "object") {
        const found = dataTarget.cmd ?? dataTarget.url ?? dataTarget.link ?? dataTarget.stream ?? dataTarget.stream_url ?? dataTarget.uri ?? "";
        if (found) return String(found).trim();
      }
      return "";
    };

    try {
      const reqHeaders = headers(
        refreshed.config.mac ?? "",
        refreshed.config.token ?? "",
        base
      );

      const res = await axios.get(url, {
        ...rmAcceptHeader,
        headers: reqHeaders,
        timeout: 30000,
      });

      let rawOut = extractLink(res?.data);

      // Attempt 1b: If rawOut is empty and cmd had prefixes like "auto " or "ffmpeg ", try with cleanCmd
      if (!rawOut && cleanCmd && cleanCmd !== cmd) {
        try {
          let cleanUrl = `${base}/portal.php?type=${type}&action=create_link&cmd=${encodeURIComponent(cleanCmd)}&JsHttpRequest=1-xml`;
          if (ep != null) cleanUrl += `&series=${ep}`;
          const resClean = await axios.get(cleanUrl, {
            ...rmAcceptHeader,
            headers: reqHeaders,
            timeout: 15000,
          });
          rawOut = extractLink(resClean?.data);
        } catch { }
      }

      // Attempt 1c: For series episodes, some Stalker middleware requires type=series instead of type=vod
      if (!rawOut && ep != null && type === "vod") {
        try {
          const seriesUrl = `${base}/portal.php?type=series&action=create_link&cmd=${encodeURIComponent(cleanCmd || cmd)}&series=${ep}&JsHttpRequest=1-xml`;
          const resSeries = await axios.get(seriesUrl, {
            ...rmAcceptHeader,
            headers: reqHeaders,
            timeout: 15000,
          });
          rawOut = extractLink(resSeries?.data);
        } catch { }
      }

      if (rawOut && /%mac%/i.test(rawOut)) {
        rawOut = rawOut.replace(/%mac%/ig, refreshed.config.mac ?? "");
      }

      // Clean backslashes and command prefixes (ffmpeg, ffrt, auto, -i, vlc)
      let out = rawOut.replace(/\\/g, "").trim();
      out = out.replace(/^(ffmpeg|ffrt\d*|auto|-i|vlc)\s+/i, "").trim();

      // Extract candidate HTTP/HTTPS/RTMP/RTSP URL
      const candidates = out
        .split(/\s+|\|/)
        .map((s) => s.trim())
        .filter(Boolean);
      const httpUrl =
        candidates.find((c) => /^(https?|rtmp|rtsp):\/\//i.test(c)) ??
        (/^(https?|rtmp|rtsp):\/\//i.test(out) ? out : "");

      let finalUrl = httpUrl || out || "";

      // Fix relative URLs (e.g. "/live/..." or "/media/...")
      if (finalUrl && finalUrl.startsWith("/") && !finalUrl.startsWith("//")) {
        finalUrl = `${serverRoot}${finalUrl}`;
      }

      // Rewrite localhost / 127.0.0.1 / stale provider domains to portal host
      if (finalUrl && /(localhost|127\.0\.0\.1|webhop\.live|starshare\.live)/i.test(finalUrl)) {
        try {
          const serverRootObj = new URL(serverRoot);
          const finalUrlObj = new URL(finalUrl);
          finalUrlObj.hostname = serverRootObj.hostname;
          if (serverRootObj.port && (!finalUrlObj.port || finalUrlObj.port === "80" || finalUrlObj.port === "8080")) {
            finalUrlObj.port = serverRootObj.port;
          }
          finalUrl = finalUrlObj.toString();
        } catch {
          finalUrl = finalUrl.replace(/https?:\/\/[^\/]+/i, serverRoot);
        }
      }

      // Fix empty stream parameter (e.g. "stream=&") if portal stripped stream ID
      if (finalUrl && /stream=(&|$)/i.test(finalUrl)) {
        let streamId = "";
        const streamMatch = cmd.match(/stream=([a-zA-Z0-9_\-]+)/i);
        if (streamMatch && streamMatch[1]) {
          streamId = streamMatch[1];
        } else if (/^\d+$/.test(cmd.trim())) {
          streamId = cmd.trim();
        } else {
          const chMatch = cmd.match(/(?:ch|channel|stream)\/([a-zA-Z0-9_\-]+)/i);
          if (chMatch && chMatch[1]) streamId = chMatch[1];
        }

        if (streamId) {
          finalUrl = finalUrl.replace(/stream=(&|$)/i, `stream=${streamId}$1`);
        }
      }

      // If create_link returned empty, BUT cmd is already a direct HTTP/HTTPS stream URL, use cleanCmd directly!
      if (!finalUrl && /^https?:\/\//i.test(cleanCmd)) {
        finalUrl = cleanCmd;
      }

      // If finalUrl is still empty and we haven't retried yet, force token refresh and retry
      if (!finalUrl && retryCount === 0) {
        console.warn("[portalApi] getStreamUrl returned empty link. Forcing session token refresh & retrying...");
        return this.getStreamUrl(latestPortal, cmd, type, ep, 1);
      }

      let out2 = finalUrl || out || "";

      // Resolve redirect chains ONLY for URLs without one-time play tokens
      if (
        out2 &&
        /^https?:\/\//i.test(out2) &&
        !/\.m3u8(\?|$)/i.test(out2) &&
        !/(play_token|token|auth_token|ticket|session)=/i.test(out2)
      ) {
        try {
          out2 = await resolveDirectStreamUrl(out2);
        } catch {
          // fallback safely to out2
        }
      }

      const { applySameHostStreamProxy } = await import("./stbEnvironment");
      return applySameHostStreamProxy(out2, latestPortal, cleanCmd || cmd);
    } catch (e: any) {
      console.warn("getStreamUrl failed:", e?.message || e);
      const { applySameHostStreamProxy } = await import("./stbEnvironment");
      if (/^https?:\/\//i.test(cleanCmd)) return applySameHostStreamProxy(cleanCmd, latestPortal, cleanCmd);

      // On 503 or server error, construct the direct stream URL on the same host if possible
      const fallbackUrl = applySameHostStreamProxy("", latestPortal, cleanCmd || cmd);
      if (fallbackUrl) return fallbackUrl;

      // Don't retry if server returned 503 (temporarily unavailable / overloaded)
      const is503 = e?.response?.status === 503;
      if (retryCount === 0 && !is503) {
        console.warn("[portalApi] getStreamUrl error. Forcing session token refresh & retrying...");
        return this.getStreamUrl(latestPortal, cmd, type, ep, 1);
      }
      return "";
    }
  },

  /**
   * The guide for a single channel.
   *
   * Tries standard Stalker and Ministra per-channel endpoints in sequence.
   */
  async getShortEpg(portal: Portal, channelId: string, size = 12): Promise<EPGProgram[]> {
    if (!channelId) return [];
    const refreshed = await refreshToken(portal);
    const base = safe(refreshed.config.url).replace(/\/$/, "");
    const requestHeaders = headers(refreshed.config.mac ?? "", refreshed.config.token ?? "", base);

    const candidates = [
      `${base}/portal.php?type=itv&action=get_short_epg&ch_id=${encodeURIComponent(channelId)}&size=${size}&JsHttpRequest=1-xml`,
      `${base}/portal.php?type=itv&action=get_epg_info&ch_id=${encodeURIComponent(channelId)}&size=${size}&JsHttpRequest=1-xml`,
      `${base}/portal.php?type=itv&action=get_epg_info&ch_id=${encodeURIComponent(channelId)}&JsHttpRequest=1-xml`,
      `${base}/portal.php?type=epg&action=get_short_epg&ch_id=${encodeURIComponent(channelId)}&size=${size}&JsHttpRequest=1-xml`,
      `${base}/portal.php?type=epg&action=get_epg_info&ch_id=${encodeURIComponent(channelId)}&JsHttpRequest=1-xml`,
    ];

    for (const url of candidates) {
      try {
        const res = await axios.get(url, { headers: requestHeaders, timeout: 15000 });
        const rawJs = res.data?.js;
        const rows = Array.isArray(rawJs)
          ? rawJs
          : Array.isArray(rawJs?.data)
            ? rawJs.data
            : Array.isArray(rawJs?.[channelId])
              ? rawJs[channelId]
              : [];

        if (rows.length > 0) {
          const out: EPGProgram[] = [];
          for (const p of rows) {
            if (!p) continue;
            const start = epgTimeToMs(p.start_timestamp ?? p.start ?? p.time ?? p.start_time);
            const end = epgTimeToMs(p.stop_timestamp ?? p.end ?? p.time_to ?? p.end_time ?? p.stop);
            if (!start || !(end > start)) continue;
            out.push({
              id: String(p.id ?? `${channelId}-${start}`),
              channelId: String(p.ch_id ?? channelId),
              title: p.name ?? p.title ?? "No title",
              description: (p.descr ?? p.description) || "",
              start,
              end,
            });
          }
          if (out.length > 0) return out;
        }
      } catch { }
    }
    return [];
  },

  /**
   * The whole portal's schedule, for as many days as it will give up.
   */
  async getEpg(portal: Portal): Promise<EPGProgram[]> {
    const refreshed = await refreshToken(portal);
    const base = safe(refreshed.config.url).replace(/\/$/, "");
    const requestHeaders = headers(
      refreshed.config.mac ?? "",
      refreshed.config.token ?? "",
      base
    );

    const variants = [
      "type=itv&action=get_epg_info&period=24",
      "type=itv&action=get_epg_info&period=168",
      "type=itv&action=get_epg_info&period=7",
      "type=itv&action=get_epg_info",
      "type=itv&action=get_all_epg",
      "type=itv&action=get_epg_table",
      "type=itv&action=get_simple_data_table&type=epg",
      "type=itv&action=epg_info",
      "type=itv&action=epg",
      "type=epg&action=get_epg_info",
      "type=epg&action=get_all_epg",
    ];

    let lastError: any = null;

    for (const variant of variants) {
      const url = `${base}/portal.php?${variant}&JsHttpRequest=1-xml`;
      try {
        const res = await axios.get(url, { headers: requestHeaders, timeout: 60000 });
        const programs = parseMagEpg(res.data?.js);
        if (programs.length > 0) {
          return programs;
        }
      } catch (err: any) {
        lastError = err;
      }
    }

    if (lastError) {
      console.warn("[EPG] every MAG guide endpoint failed:", lastError?.message || lastError);
    }
    return [];
  },

  async search(portal: Portal, q: string, type: string): Promise<any[]> {
    const latestPortal = usePortalStore.getState().activePortal ?? portal;
    const refreshed = await refreshToken(latestPortal);
    const magType = type === "live" ? "itv" : type;
    const base = safe(refreshed.config.url).replace(/\/$/, "");
    const action = magType === "itv" ? "get_all_channels" : "get_ordered_list";
    const url = `${base}/portal.php?type=${magType}&action=${action}&search=${encodeURIComponent(
      q
    )}&p=1&JsHttpRequest=1-xml`;

    console.log(`[MAG Portal API] Hitting search: type=${magType}, query="${q}", url=${url}`);
    try {
      const res = await portalGet(refreshed, url, { timeout: 15000 }, 0);
      const items = extract(res);
      console.log(`[MAG Portal API] Search returned ${items.length} items for "${q}" (${magType})`);
      return items;
    } catch (err: any) {
      console.warn(`[MAG Portal API] Search failed for "${q}":`, err?.message || err);
      return [];
    }
  },

  async getLiveChannelsForSearch(portal: Portal): Promise<Channel[]> {
    const key = portal.id;
    const cacheKey = `portal:${key}:live:channels:search:all`;

    return requestManager.request(cacheKey, async () => {
      const base = safe(portal.config.url).replace(/\/$/, "");
      const rows = await fetchWithRetry(portal, (refreshed) => {
        const refreshedBase = safe(refreshed.config.url).replace(/\/$/, "");
        return `${refreshedBase}/portal.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`;
      });

      const result: Channel[] = rows.map((c: any) => ({
        id: String(c.id ?? c.cmd ?? ""),
        name: c.name ?? c.title ?? "Unknown",
        logo: buildImageUrl(base, c.logo ?? c.logo_30x30 ?? c.screen_uri ?? c.screenshot_uri ?? c.poster ?? c.pic ?? c.cover ?? ""),
        category: c.tv_genre_name ?? c.genre ?? c.category_name ?? "",
        categoryId: String(c.tv_genre_id ?? c.genre_id ?? c.category_id ?? ""),
        streamUrl: c.cmd ?? "",
        epgId: String(c.epg_id ?? ""),
        num: magChannelNumber(c),
      }));
      await cacheManager.set(cacheKey, result, CACHE_TTL.CHANNELS);
      return result;
    });
  },

  async warmPortalData(portal: Portal): Promise<void> {
    return this.refreshPortalData(portal, false);
  },

  // The MAG branch below drives raw axios calls rather than going through
  // requestManager, so the in-flight counter is raised here explicitly. This is
  // the boot / resume / 30-minute-refresh / empty-body-retry path — the traffic
  // no screen knows it started.
  async refreshPortalData(portal: Portal, forceReset = false): Promise<void> {
    return NetworkActivity.track(() => this._refreshPortalData(portal, forceReset));
  },

  async _refreshPortalData(portal: Portal, forceReset = false): Promise<void> {
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

        const ops: Promise<void>[] = [];
        if (allCategories.length > 0) ops.push(store.setCategories(allCategories, portal.id));
        if (data.liveChannels?.length) ops.push(forceReset ? store.setChannels(data.liveChannels, portal.id) : store.mergeChannels(data.liveChannels, portal.id));
        if (data.vodItems?.length) ops.push(forceReset ? store.setVodItems(data.vodItems, portal.id) : store.mergeVodItems(data.vodItems, portal.id));
        if (data.seriesList?.length) ops.push(forceReset ? store.setSeries(data.seriesList, portal.id) : store.mergeSeries(data.seriesList, portal.id));
        await Promise.all(ops);
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

        const ops: Promise<void>[] = [];
        if (allCategories.length > 0) ops.push(store.setCategories(allCategories, portal.id));
        if (data.liveChannels?.length) ops.push(forceReset ? store.setChannels(data.liveChannels, portal.id) : store.mergeChannels(data.liveChannels, portal.id));
        if (data.vodItems?.length) ops.push(forceReset ? store.setVodItems(data.vodItems, portal.id) : store.mergeVodItems(data.vodItems, portal.id));
        if (data.seriesList?.length) ops.push(forceReset ? store.setSeries(data.seriesList, portal.id) : store.mergeSeries(data.seriesList, portal.id));
        await Promise.all(ops);
        return;
      }

      // ---------------------------------------
      // STALKER / MAG LOGIC
      // ---------------------------------------
      const refreshed = await refreshToken(portal, true); // Always perform fresh session handshake
      await new Promise(r => setTimeout(r, SETTLE_MS)); // post-handshake settling delay

      const base = safe(refreshed.config.url).replace(/\/$/, "");
      const mac = refreshed.config.mac ?? "";
      const token = refreshed.config.token ?? "";

      const liveCategoriesUrl = `${base}/portal.php?type=itv&action=get_genres&JsHttpRequest=1-xml`;
      const liveChannelsUrl = `${base}/portal.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`;
      const vodCategoriesUrl = `${base}/portal.php?type=vod&action=get_categories&JsHttpRequest=1-xml`;
      const vodItemsUrl = `${base}/portal.php?type=vod&action=get_ordered_list&max_page_items=100000&p=1&JsHttpRequest=1-xml`;
      const seriesCategoriesUrl = `${base}/portal.php?type=series&action=get_categories&JsHttpRequest=1-xml`;
      const seriesListUrl = `${base}/portal.php?type=series&action=get_ordered_list&max_page_items=100000&p=1&JsHttpRequest=1-xml`;
      const epgUrl = `${base}/portal.php?type=itv&action=epg_info&JsHttpRequest=1-xml`;

      // Helper to fetch a single endpoint sequentially.
      //
      // Stalker portals routinely answer 200 OK with an empty body when the
      // session token has gone stale — see the `livebox.pro` VOD-categories
      // case. A bare axios.get turns that into `extract() -> []`, i.e. "this
      // portal has no VOD categories", and because the retry below only fires
      // when *every* endpoint came back empty, one stale-token response silently
      // zeroed a whole section until the next sync 30 minutes later. Retry
      // per-endpoint with a fresh session instead of accepting the empty answer.
      const fetchEndpoint = async (
        name: string,
        url: string,
        targetMac = mac,
        targetToken = token,
        targetBase = base
      ): Promise<any[]> => {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            if (attempt > 0) {
              const retried = await refreshToken(portal, true);
              targetBase = safe(retried.config.url).replace(/\/$/, "");
              targetMac = retried.config.mac ?? targetMac;
              targetToken = retried.config.token ?? targetToken;
              await new Promise(r => setTimeout(r, SETTLE_MS));
            }

            const response = await axios.get(url, {
              ...rmAcceptHeader,
              headers: headers(targetMac, targetToken, targetBase),
              timeout: 60000,
            });

            const rows = extract(response);
            if (rows.length > 0) return rows;

            const body = response?.data;
            const isEmptyBody =
              body === "" ||
              body == null ||
              (typeof body === "string" && body.trim().length === 0) ||
              (typeof body === "object" && Object.keys(body).length === 0) ||
              body?.js === "";

            // A genuinely empty section is a valid answer; an empty *body* is not.
            if (!isEmptyBody) return rows;
            console.warn(`⚠️ ${name} returned HTTP ${response.status} with an empty body`);
          } catch (error: any) {
            console.warn(`❌ ${name} failed`, error?.message);
          }
        }
        return [];
      };



      // Categories are small and are what the sidebar needs first, so they are
      // pushed to the store before the heavy content endpoints are fetched
      // rather than after all seven calls finish.
      let liveCategoriesRows = await fetchEndpoint("Live Categories", liveCategoriesUrl);
      await new Promise(r => setTimeout(r, SPACING_MS));

      let vodCategoriesRows = await fetchEndpoint("VOD Categories", vodCategoriesUrl);
      await new Promise(r => setTimeout(r, SPACING_MS));

      let seriesCategoriesRows = await fetchEndpoint("Series Categories", seriesCategoriesUrl);
      await new Promise(r => setTimeout(r, SPACING_MS));

      publishCategories(liveCategoriesRows, vodCategoriesRows, seriesCategoriesRows, key, store);

      let liveChannelsRows = await fetchEndpoint("Live Channels", liveChannelsUrl);
      await new Promise(r => setTimeout(r, SPACING_MS));

      let vodItemsRows = await fetchEndpoint("VOD Items", vodItemsUrl);
      await new Promise(r => setTimeout(r, SPACING_MS));

      let seriesListRows = await fetchEndpoint("Series List", seriesListUrl);

      // EPG is only ever read by the EPG screen, which fetches it itself. It is
      // also the largest payload here, so pulling it on every warm was adding
      // seconds to startup for data nothing was about to display. Fetch it only
      // on an explicit full refresh.
      let epgRes = null;
      if (forceReset) {
        await new Promise(r => setTimeout(r, SPACING_MS));
        epgRes = await axios.get(epgUrl, {
          headers: headers(mac, token, base),
          timeout: 60000,
        }).catch(err => {
          console.warn("❌ EPG Info failed", err?.message);
          return null;
        });
      }

      let hasContent = liveChannelsRows.length > 0 || vodItemsRows.length > 0 || seriesListRows.length > 0;
      let hasCategories = liveCategoriesRows.length > 0 || vodCategoriesRows.length > 0 || seriesCategoriesRows.length > 0;

      // 1-TIME RETRY IF ALL ENDPOINTS RETURNED EMPTY DATA
      if (!hasContent && !hasCategories) {
        console.warn("⚠️ Refresh returned completely empty data. Attempting 1-time fresh session retry in 1500ms...");
        await new Promise(r => setTimeout(r, 1500));

        const retryPortal = await refreshToken(portal, true);
        const retryBase = safe(retryPortal.config.url).replace(/\/$/, "");
        const retryMac = retryPortal.config.mac ?? "";
        const retryToken = retryPortal.config.token ?? "";

        if (retryToken) {

          liveCategoriesRows = await fetchEndpoint("Retry Live Categories", liveCategoriesUrl, retryMac, retryToken, retryBase);
          await new Promise(r => setTimeout(r, SPACING_MS));
          liveChannelsRows = await fetchEndpoint("Retry Live Channels", liveChannelsUrl, retryMac, retryToken, retryBase);
          await new Promise(r => setTimeout(r, SPACING_MS));
          vodCategoriesRows = await fetchEndpoint("Retry VOD Categories", vodCategoriesUrl, retryMac, retryToken, retryBase);
          await new Promise(r => setTimeout(r, SPACING_MS));
          vodItemsRows = await fetchEndpoint("Retry VOD Items", vodItemsUrl, retryMac, retryToken, retryBase);
          await new Promise(r => setTimeout(r, SPACING_MS));
          seriesCategoriesRows = await fetchEndpoint("Retry Series Categories", seriesCategoriesUrl, retryMac, retryToken, retryBase);
          await new Promise(r => setTimeout(r, SPACING_MS));
          seriesListRows = await fetchEndpoint("Retry Series List", seriesListUrl, retryMac, retryToken, retryBase);

          hasContent = liveChannelsRows.length > 0 || vodItemsRows.length > 0 || seriesListRows.length > 0;
          hasCategories = liveCategoriesRows.length > 0 || vodCategoriesRows.length > 0 || seriesCategoriesRows.length > 0;
        }
      }

      if (!hasContent && !hasCategories) {
        console.warn("⚠️ Retry also returned empty data across all endpoints. Preserving existing cached data.");
        return;
      }

      const liveCategories = liveCategoriesRows.map((c: any) => {
        const rawId = String(c.id ?? c.gid ?? "");
        const id = rawId === "*" || rawId === "0" ? "all" : `live:${rawId}`;
        return {
          id,
          name: c.title ?? c.name ?? c.genre_name ?? "Unknown",
          type: "live" as const,
        };
      });

      const liveChannels: Channel[] = liveChannelsRows.map((c: any) => ({
        id: String(c.id ?? c.cmd ?? ""),
        name: c.name ?? c.title ?? "Unknown",
        logo: buildImageUrl(base, c.logo ?? c.logo_30x30 ?? c.screen_uri ?? c.screenshot_uri ?? c.poster ?? c.pic ?? c.cover ?? ""),
        category: c.tv_genre_name ?? c.genre ?? c.category_name ?? "",
        categoryId: String(c.tv_genre_id ?? c.genre_id ?? c.category_id ?? ""),
        streamUrl: c.cmd ?? "",
        epgId: String(c.epg_id ?? ""),
        num: magChannelNumber(c),
      }));

      const vodCategories = vodCategoriesRows.map((c: any) => {
        const rawId = String(c.id ?? "");
        const id = rawId === "*" || rawId === "0" ? "all" : `vod:${rawId}`;
        return {
          id,
          name: c.title ?? c.name ?? "Unknown",
          type: "vod" as const,
        };
      });

      const vodItems: VODItem[] = vodItemsRows.map((v: any) => ({
        id: String(v.id ?? ""),
        name: v.name ?? v.title ?? "Unknown",
        logo: buildImageUrl(base, v.screen_uri ?? v.screenshot_uri ?? v.poster ?? v.cover ?? v.logo ?? v.stream_icon ?? ""),
        category: v.category_name ?? v.genre ?? "",
        categoryId: String(v.category_id ?? ""),
        streamUrl: v.cmd ?? "",
        description: pickDescription(v),
        year: pickYear(v),
        rating: pickRating(v),
        duration: formatRuntime(v.time, "minutes") ?? formatRuntime(v.duration) ?? "",
      }));

      const seriesCategories = seriesCategoriesRows.map((c: any) => {
        const rawId = String(c.id ?? "");
        const id = rawId === "*" || rawId === "0" ? "all" : `series:${rawId}`;
        return {
          id,
          name: c.title ?? c.name ?? "Unknown",
          type: "series" as const,
        };
      });

      const seriesList: Series[] = seriesListRows.map((v: any) => ({
        id: String(v.id ?? ""),
        name: v.name ?? v.title ?? "Unknown",
        logo: buildImageUrl(base, v.screen_uri ?? v.screenshot_uri ?? v.cover ?? v.poster ?? v.logo ?? v.stream_icon ?? ""),
        category: v.category_name ?? v.genre ?? "",
        categoryId: String(v.category_id ?? ""),
        description: pickDescription(v),
        year: pickYear(v),
        rating: pickRating(v),
      }));

      const js = epgRes?.data?.js ?? {};
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

      const allMagCategories = [
        ...(liveCategories || []),
        ...(vodCategories || []),
        ...(seriesCategories || []),
      ];

      // 1. Update Zustand store immediately for instant UI responsiveness
      if (allMagCategories.length > 0) {
        store.setCategories(allMagCategories, key);
      }
      if (liveChannels.length > 0) {
        if (forceReset) store.setChannels(liveChannels, key);
        else store.mergeChannels(liveChannels, key);
      }
      if (vodItems.length > 0) {
        if (forceReset) store.setVodItems(vodItems, key);
        else store.mergeVodItems(vodItems, key);
      }
      if (seriesList.length > 0) {
        if (forceReset) store.setSeries(seriesList, key);
        else store.mergeSeries(seriesList, key);
      }
      if (epgPrograms.length > 0) {
        store.setEpgData(epgPrograms, key);
      }
    } catch (e: any) {
      if (e?.message?.includes("empty data")) {
        console.warn("⚠️ Portal refresh returned empty data. Keeping existing cached data.");
        return;
      }
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
        liveChannelsFull, liveChannelsSearch, liveChannelsPage1,
        vodItemsFull, vodItemsPage1,
        seriesListFull, seriesListPage1,
        epgFull, epgPage1
      ] = await Promise.all([
        cacheManager.get<Channel[]>(`portal:${key}:live:channels:all`),
        cacheManager.get<Channel[]>(`portal:${key}:live:channels:search:all`),
        cacheManager.get<Channel[]>(`portal:${key}:live:channels:all:1`),
        cacheManager.get<VODItem[]>(`portal:${key}:vod:items:all`),
        cacheManager.get<VODItem[]>(`portal:${key}:vod:items:all:1`),
        cacheManager.get<Series[]>(`portal:${key}:series:list:all`),
        cacheManager.get<Series[]>(`portal:${key}:series:list:all:1`),
        cacheManager.get<EPGProgram[]>(`portal:${key}:epg:all`),
        cacheManager.get<EPGProgram[]>(`portal:${key}:epg`),
      ]);

      const liveChannels = liveChannelsFull || liveChannelsSearch || liveChannelsPage1;
      const vodItems = vodItemsFull || vodItemsPage1;
      const seriesList = seriesListFull || seriesListPage1;
      const epg = epgFull || epgPage1;

      const nowCutoff = Date.now() - 12 * 60 * 60 * 1000;
      const validEpg = (epg || []).filter((p) => p.end >= nowCutoff);

      // Only UPGRADE — never downgrade store data that loadPortalData already
      // populated from the full MMKV storage dump. The cache-manager keys are
      // capped at page 1, so they should never shrink a larger dataset.
      if (liveChannels && liveChannels.length > store.channels.length) {
        store.setChannels(liveChannels, key);
      }
      if (vodItems && vodItems.length > store.vodItems.length) {
        store.setVodItems(vodItems, key);
      }
      if (seriesList && seriesList.length > store.series.length) {
        store.setSeries(seriesList, key);
      }
      if (validEpg.length > store.epgData.length) {
        store.setEpgData(validEpg, key);
      }


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

      // Clear raw storage keys written directly by the store
      await safeStorage.multiRemove([
        `portal:${key}:channels`,
        `portal:${key}:vod`,
        `portal:${key}:series`,
        `portal:${key}:categories`,
        `portal:${key}:epg`,
      ]).catch(console.warn);

      // Clear all cacheManager entries associated with this portal ID
      await cacheManager.removeByPrefix(`portal:${key}`);
      await cacheManager.removeByPrefix(`cache:portal:${key}`);
      await cacheManager.removeByPrefix(key);

      if (portal.type === "xtream") {
        const prefix = `xtream:${portal.config.url}:${portal.config.username}`;
        await cacheManager.removeByPrefix(prefix);
      } else if (portal.type === "m3u") {
        const prefix = `m3u:portal:${portal.id}`;
        await cacheManager.removeByPrefix(prefix);
        if (portal.config.url) {
          await cacheManager.removeByPrefix(`m3u:${portal.config.url}`);
        }
      }

      // Evict any leftover keys in storage containing this portal ID
      const allKeys = await safeStorage.getAllKeys();
      const portalKeys = allKeys.filter(
        (k) => k.includes(`portal:${key}`) || (k.startsWith("cache:") && k.includes(key))
      );
      if (portalKeys.length > 0) {
        await safeStorage.multiRemove(portalKeys).catch(console.warn);
      }


    } catch (e) {
      console.warn("deletePortalData failed:", e);
    }
  },
};
