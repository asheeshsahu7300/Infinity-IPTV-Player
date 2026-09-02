// api/m3uApi.ts
import axios from "axios";
import { cacheManager, CACHE_TTL } from "./cacheManager";
import { requestManager } from "./requestManager";

// --------------------------------------------------
// TYPES
// --------------------------------------------------
export type M3UType = "live" | "vod" | "series";

export interface M3UEntry {
  id: string;
  name: string;
  logo: string | null;
  category: string;
  type: M3UType;
  streamUrl: string;
  /** `tvg-id` — the key an XMLTV guide files this channel under. */
  epgId?: string;
  /** `tvg-chno` — the provider's channel number, for the numeric tuner. */
  num?: number;
}

/**
 * FNV-1a over the identifying attributes of an entry.
 *
 * Entry ids used to be `Math.random()`, which meant every re-parse of the
 * playlist renamed every channel — favourites, parental locks and cached
 * guides all pointed at ids that no longer existed. Hashing the tvg-id (or the
 * stream URL) keeps an id stable for as long as the playlist itself is.
 */
function stableId(seed: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Pulls the guide URL out of an `#EXTM3U` header line.
 * Both spellings are in the wild: `x-tvg-url` and `url-tvg`.
 */
function parseHeaderEpgUrl(head: string): string | null {
  const m = /#EXTM3U[^\n]*?(?:x-tvg-url|url-tvg)\s*=\s*"([^"]+)"/i.exec(head);
  if (!m?.[1]) return null;
  // Some providers list several comma-separated guides; the first is enough.
  const first = m[1].split(",")[0].trim();
  return /^https?:\/\//i.test(first) ? first : null;
}

export class M3UApi {
  private playlist: M3UEntry[] = [];
  private loadError: Error | null = null;
  private lastLoadTime: number = 0;
  /** `x-tvg-url` / `url-tvg` from the #EXTM3U header, if the playlist has one. */
  private epgUrl: string | null = null;

  constructor(private config: { url: string; portalId?: string }) { }

  private getCacheKey(action: string, params?: string): string {
    if (this.config.portalId) {
      return `m3u:portal:${this.config.portalId}:${action}:${params || ""}`;
    }
    return `m3u:${this.config.url}:${action}:${params || ""}`;
  }

  // --------------------------------------------------
  // LOAD & CACHE PLAYLIST
  // --------------------------------------------------
  async load(): Promise<M3UEntry[]> {
    const cacheKey = this.getCacheKey("playlist");

    // Return memory cache if available
    if (this.playlist.length > 0) return this.playlist;

    return requestManager.request(cacheKey, async () => {
      // Check disk cache first
      const cached = await cacheManager.get<M3UEntry[]>(cacheKey);
      if (cached && cached.length > 0) {
        this.playlist = cached;
        this.loadError = null;
        return this.playlist;
      }

      try {
        const res = await requestManager.axiosWithRetry<string>({
          url: this.config.url,
          method: "get",
          responseType: "text",
          timeout: 60000,
          validateStatus: () => true, // handle manually
        });

        // 🔴 1️⃣ HTTP STATUS CHECK
        if (res.status !== 200) {
          throw new Error(`M3U request failed (${res.status})`);
        }

        // 🔴 2️⃣ TEXT CHECK
        if (!res.data || typeof res.data !== "string") {
          throw new Error("Invalid M3U response: empty or non-text data");
        }

        const text = res.data.trim();

        // 🔴 3️⃣ CRITICAL: M3U SIGNATURE CHECK
        if (!text.startsWith("#EXTM3U")) {
          throw new Error("Invalid M3U playlist (missing #EXTM3U)");
        }

        // ✅ Now safe to parse
        this.playlist = this.parseM3U(text);
        this.loadError = null;
        this.lastLoadTime = Date.now();

        // 🔴 4️⃣ VALID ENTRIES CHECK
        if (this.playlist.length === 0) {
          throw new Error("No valid entries found in M3U playlist");
        }

        // Cache to disk
        await cacheManager.set(cacheKey, this.playlist, CACHE_TTL.CHANNELS);
        return this.playlist;
      } catch (error: any) {
        this.loadError = error;
        this.handleError(error);
        throw error;
      }
    });
  }

  private handleError(error: any): void {
    if (error.response) {
      const status = error.response.status;
      if (status === 404) {
        throw new Error(
          `M3U URL not found (404). Please check:\n` +
          `1. URL is correct: ${this.config.url}\n` +
          `2. File exists on the server\n` +
          `3. You have access to the file`
        );
      } else if (status === 403) {
        throw new Error(
          `Access forbidden (403). Authentication may be required.`
        );
      } else if (status === 401) {
        throw new Error(`Unauthorized (401). Check credentials.`);
      } else {
        throw new Error(`HTTP error ${status}: ${error.response.statusText}`);
      }
    } else if (error.request) {
      throw new Error(
        `Network error: Unable to reach server.\n`
      );
    } else if (error.code === "ECONNABORTED") {
      throw new Error(`Request timeout: Server took too long to respond.`);
    } else {
      throw new Error(`Failed to load M3U: ${error.message}`);
    }
  }

  async login() {
    try {
      await this.load();

      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  }

  // Check if playlist is loaded
  isLoaded(): boolean {
    return this.playlist.length > 0;
  }

  // Get last error
  getLastError(): Error | null {
    return this.loadError;
  }

  // Clear cache (useful for retrying with new URL)
  clearCache(): void {
    this.playlist = [];
    this.loadError = null;
    this.epgUrl = null;
  }

  /**
   * The XMLTV guide URL the playlist advertises in its `#EXTM3U` header.
   *
   * M3U has no per-channel guide endpoint, so this is the only EPG a plain
   * playlist can offer. Returns null when the provider does not publish one.
   */
  async getEpgUrl(): Promise<string | null> {
    const cacheKey = this.getCacheKey("epg_url");
    if (this.epgUrl) return this.epgUrl;

    const cached = await cacheManager.get<string>(cacheKey);
    if (cached) {
      this.epgUrl = cached;
      return cached;
    }

    // Parsing the playlist populates `epgUrl` as a side effect; a cache hit in
    // load() skips that, so fall back to re-reading just the header.
    await this.load().catch(() => []);
    if (!this.epgUrl) {
      this.epgUrl = await this.fetchHeaderEpgUrl().catch(() => null);
    }
    if (this.epgUrl) await cacheManager.set(cacheKey, this.epgUrl, CACHE_TTL.CHANNELS);
    return this.epgUrl;
  }

  /** Reads only the first bytes of the playlist to recover its #EXTM3U header. */
  private async fetchHeaderEpgUrl(): Promise<string | null> {
    const res = await requestManager.axiosWithRetry<string>({
      url: this.config.url,
      method: "get",
      responseType: "text",
      timeout: 20000,
      headers: { Range: "bytes=0-2047" },
      validateStatus: () => true,
    });
    if (typeof res.data !== "string") return null;
    return parseHeaderEpgUrl(res.data.slice(0, 4096));
  }

  // --------------------------------------------------
  // STRICT & SAFE M3U PARSER
  // --------------------------------------------------
  private parseM3U(text: string): M3UEntry[] {
    const lines = text.split(/\r?\n/);
    const entries: M3UEntry[] = [];

    this.epgUrl = parseHeaderEpgUrl(text.slice(0, 4096));
    // Providers routinely repeat the same name across regions; the counter
    // keeps their hashed ids apart when nothing else distinguishes them.
    const idSeen = new Map<string, number>();

    // Validate M3U format
    if (!text.includes("#EXTINF")) {
      throw new Error("Invalid M3U format: No #EXTINF entries found");
    }

    let current: M3UEntry | null = null;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      // Skip comments (except EXTINF)
      if (line.startsWith("#") && !line.startsWith("#EXTINF")) {
        continue;
      }

      // ---------------- EXTINF ----------------
      if (line.startsWith("#EXTINF")) {
        current = {
          id: "",
          name: "Unknown Channel",
          category: "Other",
          logo: null,
          type: "live",
          streamUrl: "",
        };

        // tvg-id — how an XMLTV guide refers to this channel.
        const tvgIdMatch = line.match(/tvg-id="([^"]*)"/i);
        if (tvgIdMatch?.[1]) current.epgId = tvgIdMatch[1].trim();

        // tvg-chno / channel-number — the LCN the numeric tuner dials.
        const chnoMatch = line.match(/(?:tvg-chno|channel-number|tvg-num)="([^"]*)"/i);
        const chno = chnoMatch?.[1] ? Number(chnoMatch[1].trim()) : NaN;
        if (Number.isFinite(chno) && chno > 0) current.num = chno;

        // Channel name (after last comma)
        const name = line.split(",").pop();
        if (name && name.trim()) {
          current.name = name.trim();
        }

        // group-title
        const groupMatch = line.match(/group-title="([^"]*)"/);
        if (groupMatch?.[1]) {
          current.category =
            groupMatch[1] === "Undefined" ? "Other" : groupMatch[1];
        }

        // logo
        const logoMatch = line.match(/tvg-logo="([^"]*)"/);
        if (logoMatch?.[1]) {
          current.logo = logoMatch[1];
        }

        // detect type safely
        const cat = current.category.toLowerCase();
        if (cat.includes("movie") || cat.includes("vod")) {
          current.type = "vod";
        } else if (cat.includes("series") || cat.includes("show")) {
          current.type = "series";
        } else {
          current.type = "live";
        }

        continue;
      }

      // ---------------- STREAM URL ----------------
      if (line.startsWith("http") && current) {
        current.streamUrl = line;

        // Only push valid entries
        if (current.streamUrl.length > 5) {
          const seed = current.epgId || `${current.name}|${current.streamUrl}`;
          const dupe = idSeen.get(seed) ?? 0;
          idSeen.set(seed, dupe + 1);
          current.id = dupe === 0 ? stableId(seed) : `${stableId(seed)}-${dupe}`;
          entries.push({ ...current });
        }

        current = null;
      }
    }

    return entries;
  }

  // ==================================================
  // LIVE TV
  // ==================================================
  async getLiveCategories() {
    const cacheKey = this.getCacheKey("live_categories");

    return requestManager.request(cacheKey, async () => {
      const cached = await cacheManager.get<any[]>(cacheKey);
      if (cached) return cached;

      const rows = await this.load();
      const liveChannels = rows.filter((c) => c.type === "live");
      const categories = [...new Set(liveChannels.map((c) => c.category))];

      const result = categories.map((name) => ({
        id: name,
        name,
        type: "live" as const,
      }));

      await cacheManager.set(cacheKey, result, CACHE_TTL.CATEGORIES);
      return result;
    });
  }

  async getLiveChannels(
    categoryId?: string,
    page: number = 1,
    pageSize: number = 100
  ) {
    const rows = await this.load();
    let items = rows.filter((c) => c.type === "live");

    if (categoryId && categoryId !== "all") {
      items = items.filter((c) => c.category === categoryId);
    }

    // Apply pagination
    const start = (page - 1) * pageSize;
    const paginatedItems = items.slice(start, start + pageSize);

    // 🔥 Normalize to Channel[]
    const result = paginatedItems.map((c) => ({
      id: c.id,
      name: c.name,
      logo: c.logo ?? undefined,
      category: c.category,
      streamUrl: c.streamUrl,
      epgId: c.epgId,
      num: c.num,
    }));

    return result;
  }

  // ==================================================
  // VOD
  // ==================================================
  async getVodCategories() {
    const cacheKey = this.getCacheKey("vod_categories");

    return requestManager.request(cacheKey, async () => {
      const cached = await cacheManager.get<any[]>(cacheKey);
      if (cached) return cached;

      const rows = await this.load();
      const vodItems = rows.filter((c) => c.type === "vod");
      const categories = [...new Set(vodItems.map((c) => c.category))];

      const result = categories.map((name) => ({
        id: name,
        name,
        type: "vod" as const,
      }));

      await cacheManager.set(cacheKey, result, CACHE_TTL.CATEGORIES);
      return result;
    });
  }

  async getVodItems(
    categoryId?: string,
    page: number = 1,
    pageSize: number = 50
  ) {
    const rows = await this.load();
    let items = rows.filter((c) => c.type === "vod");

    if (categoryId && categoryId !== "all") {
      items = items.filter((v) => v.category === categoryId);
    }

    // Apply pagination
    const start = (page - 1) * pageSize;
    const paginatedItems = items.slice(start, start + pageSize);

    // Attempt to extract year/rating from the title when available
    const parseYearFromName = (name: string | undefined) => {
      if (!name) return undefined;
      const m = name.match(/(19|20)\d{2}/);
      return m ? m[0] : undefined;
    };

    const parseRatingFromName = (name: string | undefined) => {
      if (!name) return undefined;
      // Look for patterns like [7.8], (7.8), - 7.8, 7.8/10
      const m = name.match(/\b(\d(?:\.\d)?)(?:\/10)?\b/);
      return m ? m[1] : undefined;
    };

    const result = paginatedItems.map((v) => ({
      id: v.id,
      name: v.name,
      logo: v.logo ?? undefined,
      categoryId: v.category,
      streamUrl: v.streamUrl,
      description: "No description available for this content.",
      year: parseYearFromName(v.name),
      rating: parseRatingFromName(v.name),
    }));

    return result;
  }

  // ==================================================
  // SERIES
  // ==================================================
  async getSeriesCategories() {
    const cacheKey = this.getCacheKey("series_categories");

    return requestManager.request(cacheKey, async () => {
      const cached = await cacheManager.get<any[]>(cacheKey);
      if (cached) return cached;

      const rows = await this.load();
      const seriesItems = rows.filter((c) => c.type === "series");
      const categories = [...new Set(seriesItems.map((c) => c.category))];

      const result = categories.map((name) => ({
        id: name,
        name,
        type: "series" as const,
      }));

      await cacheManager.set(cacheKey, result, CACHE_TTL.CATEGORIES);
      return result;
    });
  }

  async getSeries(
    categoryId?: string,
    page: number = 1,
    pageSize: number = 50
  ) {
    const rows = await this.load();
    let items = rows.filter((c) => c.type === "series");

    if (categoryId && categoryId !== "all") {
      items = items.filter((v) => v.category === categoryId);
    }

    const seriesMap = new Map<string, any>();

    for (const item of items) {
      const match = item.name.match(/(.*?)(?:[ ._-]*(?:S\d+E\d+|\d+x\d+))/i);
      const seriesName = match ? match[1].trim() : item.name;

      if (!seriesMap.has(seriesName)) {
        seriesMap.set(seriesName, {
          id: seriesName.toLowerCase().replace(/[^a-z0-9]/g, "_"),
          name: seriesName,
          logo: item.logo,
          categoryId: item.category,
        });
      }
    }

    // Apply pagination
    const seriesArray = [...seriesMap.values()];
    const start = (page - 1) * pageSize;
    const paginatedSeries = seriesArray.slice(start, start + pageSize);

    return paginatedSeries;
  }

  async getSeriesEpisodes(seriesId: string) {
    const cacheKey = this.getCacheKey("series_episodes", seriesId);

    return requestManager.request(cacheKey, async () => {
      const cached = await cacheManager.get<any[]>(cacheKey);
      if (cached) return cached;

      const rows = await this.load();
      const allSeries = await this.getSeries();

      const series = allSeries.find((s) => s.id === seriesId);
      if (!series) return [];

      const episodes = rows.filter(
        (item) =>
          item.type === "series" &&
          item.name?.toLowerCase().includes(series.name.toLowerCase())
      );

      const result = episodes.map((ep) => {
        const match = ep.name?.match(/S(\d+)E(\d+)/i);

        return {
          id: ep.id,
          seriesId,
          name: ep.name,
          season: match ? Number(match[1]) : 1,
          episode: match ? Number(match[2]) : 1,
          streamUrl: ep.streamUrl,
          logo: ep.logo ?? undefined,
        };
      });

      await cacheManager.set(cacheKey, result, CACHE_TTL.SERIES_INFO);
      return result;
    });
  }

  // --------------------------------------------------
  // FORCE REFRESH ALL DATA (used for full refresh)
  // --------------------------------------------------
  async refreshData() {
    // Remove cached keys for first-page/all data
    const keys = [
      this.getCacheKey("playlist"),
    ];

    await Promise.all(keys.map((k) => cacheManager.remove(k).catch(() => { })));

    const liveCategories = await this.getLiveCategories();
    const liveChannels = await this.getLiveChannels(undefined, 1);
    const vodCategories = await this.getVodCategories();
    const vodItems = await this.getVodItems(undefined, 1);
    const seriesCategories = await this.getSeriesCategories();
    const seriesList = await this.getSeries(undefined, 1);

    return {
      liveCategories,
      liveChannels,
      vodCategories,
      vodItems,
      seriesCategories,
      seriesList,
    };
  }

  // ==================================================
  // STREAM URL (DIRECT FOR M3U)
  // ==================================================
  async getStreamUrl(entryId: string) {
    const cacheKey = this.getCacheKey("stream_url", entryId);

    return requestManager.request(cacheKey, async () => {
      const cached = await cacheManager.get<string>(cacheKey);
      if (cached) return cached;

      const rows = await this.load();
      const streamUrl = rows.find((x) => x.id === entryId)?.streamUrl ?? "";

      if (streamUrl) {
        await cacheManager.set(cacheKey, streamUrl, CACHE_TTL.STREAM_URL);
      }

      return streamUrl;
    });
  }
}
