// api/xtreamApi.ts
import axios from "axios";
import { cacheManager, CACHE_TTL } from "./cacheManager";
import type { MediaMeta, Season } from "../store/portalStore";
import { cleanMetaText as cleanText, splitMetaList as splitList } from "./metaText";
import { formatRuntime } from "../utils/duration";
import { requestManager } from "./requestManager";
import { Portal } from "../store/portalStore";
import { buildImageUrl } from "./portalApi";

/**
 * Pulls the shared credit block out of an Xtream `info` object.
 *
 * The same shape appears under `get_vod_info`.info and `get_series_info`.info,
 * with the usual per-panel field-name drift, so both go through here.
 */
function readMeta(info: any): MediaMeta {
  if (!info || typeof info !== "object") return {};
  return {
    cast: splitList(info.cast ?? info.actors),
    director: cleanText(info.director),
    // Deliberately not falling back to `category`: that is the shelf the item
    // was filed on, not its genre, and using it meant every title carried a
    // chip repeating the category the viewer had just navigated into.
    tags: splitList(info.genre ?? info.genres),
    plot: cleanText(info.plot ?? info.description ?? info.storyline),
    country: cleanText(info.country),
    releaseDate: cleanText(info.releasedate ?? info.releaseDate ?? info.release_date),
    backdrop: Array.isArray(info.backdrop_path)
      ? cleanText(info.backdrop_path[0])
      : cleanText(info.backdrop_path),
    trailer: cleanText(info.youtube_trailer ?? info.trailer),
  };
}

export class XtreamApi {
  constructor(
    private config: {
      url: string;
      username: string;
      password: string;
    }
  ) { }

  private getCacheKey(action: string, params?: string): string {
    return `xtream:${this.config.url}:${this.config.username}:${action}:${params || ""}`;
  }

  // ---------------------------
  // AUTH
  // ---------------------------
  async auth() {
    const cacheKey = this.getCacheKey("auth");

    return requestManager.request(cacheKey, async () => {
      const cached = await cacheManager.get<any>(cacheKey);
      if (cached) return cached;

      const url = `${this.config.url}/player_api.php?username=${this.config.username}&password=${this.config.password}`;
      const res = await requestManager.axiosWithRetry<any>({
        method: "get",
        url,
        timeout: 15000,
      });

      if (!res.data?.user_info) throw new Error("Invalid Xtream login");

      await cacheManager.set(cacheKey, res.data, CACHE_TTL.XTREAM_AUTH);
      return res.data;
    });
  }

  async login() {
    return this.auth();
  }

  // ============================================================
  // itv CATEGORIES
  // ============================================================
  async getitvCategories() {
    const cacheKey = this.getCacheKey("live_categories");

    return requestManager.request(cacheKey, async () => {
      const cached = await cacheManager.get<any[]>(cacheKey);
      if (cached) return cached;

      await this.auth().catch(() => {});

      const url = `${this.config.url}/player_api.php?username=${this.config.username}&password=${this.config.password}&action=get_live_categories`;
      const res = await requestManager.axiosWithRetry<any[]>({
        method: "get",
        url,
        timeout: 15000,
      });

      const rawData = Array.isArray(res.data) ? res.data : [];
      const categories = rawData.map((c: any) => ({
        id: `live:${c.category_id}`,
        name: c.category_name,
        type: "live",
      }));

      if (categories.length > 0) {
        await cacheManager.set(cacheKey, categories, CACHE_TTL.CATEGORIES);
      }
      return categories;
    });
  }

  // ============================================================
  // itv CHANNELS
  // ============================================================
  async getitvChannels(
    categoryId?: string,
    page: number = 1,
    pageSize: number = 100
  ) {
    const rawCacheKey = this.getCacheKey("raw_live_streams");

    const rows = await requestManager.request(rawCacheKey, async () => {
      const cached = await cacheManager.get<any[]>(rawCacheKey);
      if (cached) return cached;

      await this.auth().catch(() => {});

      const url = `${this.config.url}/player_api.php?username=${this.config.username}&password=${this.config.password}&action=get_live_streams`;
      const res = await requestManager.axiosWithRetry<any[]>({
        method: "get",
        url,
        timeout: 60000,
      });

      const data = res.data || [];
      await cacheManager.set(rawCacheKey, data, CACHE_TTL.CHANNELS);
      return data;
    });

    let filteredRows = rows;
    const targetCatId = categoryId?.includes(":") ? categoryId.split(":")[1] : categoryId;
    if (targetCatId && targetCatId !== "all") {
      filteredRows = rows.filter((c: any) => c.category_id == targetCatId);
    }

    const start = (page - 1) * pageSize;
    const paginatedRows = filteredRows.slice(start, start + pageSize);

    const channels = paginatedRows.map((c: any) => ({
      id: String(c.stream_id),
      name: c.name,
      logo: buildImageUrl(this.config.url, c.screen_uri ?? c.screenshot_uri ?? c.stream_icon ?? c.logo ?? ""),
      categoryId: c.category_id,
      streamUrl: this.builditvUrl(c.stream_id),
      epgId: c.epg_channel_id,
      // Xtream's `num` is the provider's own channel number — the one the
      // numeric tuner has to dial, so it must survive the mapping.
      num: Number.isFinite(Number(c.num)) ? Number(c.num) : undefined,
    }));

    return channels;
  }

  // ============================================================
  // VOD CATEGORIES
  // ============================================================
  async getVodCategories() {
    const cacheKey = this.getCacheKey("vod_categories");

    return requestManager.request(cacheKey, async () => {
      const cached = await cacheManager.get<any[]>(cacheKey);
      if (cached) return cached;

      await this.auth().catch(() => {});

      const url = `${this.config.url}/player_api.php?username=${this.config.username}&password=${this.config.password}&action=get_vod_categories`;
      const res = await requestManager.axiosWithRetry<any[]>({
        method: "get",
        url,
        timeout: 15000,
      });

      const rawData = Array.isArray(res.data) ? res.data : [];
      const categories = rawData.map((c: any) => ({
        id: `vod:${c.category_id}`,
        name: c.category_name,
        type: "vod",
      }));

      if (categories.length > 0) {
        await cacheManager.set(cacheKey, categories, CACHE_TTL.CATEGORIES);
      }
      return categories;
    });
  }

  // ============================================================
  // VOD ITEMS
  // ============================================================
  async getVodItems(
    categoryId?: string,
    page: number = 1,
    pageSize: number = 50
  ) {
    const rawCacheKey = this.getCacheKey("raw_vod_streams");

    const rows = await requestManager.request(rawCacheKey, async () => {
      const cached = await cacheManager.get<any[]>(rawCacheKey);
      if (cached) return cached;

      await this.auth().catch(() => {});

      const url = `${this.config.url}/player_api.php?username=${this.config.username}&password=${this.config.password}&action=get_vod_streams`;
      const res = await requestManager.axiosWithRetry<any[]>({
        method: "get",
        url,
        timeout: 60000,
      });

      const data = res.data || [];
      await cacheManager.set(rawCacheKey, data, CACHE_TTL.VOD);
      return data;
    });

    let filteredRows = rows;
    const targetCatId = categoryId?.includes(":") ? categoryId.split(":")[1] : categoryId;
    if (targetCatId && targetCatId !== "all") {
      filteredRows = rows.filter((v: any) => v.category_id == targetCatId);
    }

    const start = (page - 1) * pageSize;
    const paginatedRows = filteredRows.slice(start, start + pageSize);

    // Newer panels put some of the credit block on the list row itself. Where
    // they do, the detail sheet has something to show before `getVodInfo`
    // returns; where they do not, these are simply undefined.
    const items = paginatedRows.map((v: any) => ({
      id: v.stream_id,
      name: v.name,
      logo: buildImageUrl(this.config.url, v.screen_uri ?? v.screenshot_uri ?? v.stream_icon ?? v.cover ?? v.logo ?? ""),
      categoryId: v.category_id,
      streamUrl: this.buildMovieUrl(v.stream_id, v.container_extension),
      description: v.plot || "No description available for this content.",
      year: v.year,
      rating: v.rating,
      // Xtream writes this as a clock string on the panels that send it at all.
      duration: formatRuntime(v.duration),
      ...readMeta(v),
    }));

    return items;
  }

  // ============================================================
  // SERIES CATEGORIES
  // ============================================================
  async getSeriesCategories() {
    const cacheKey = this.getCacheKey("series_categories");

    return requestManager.request(cacheKey, async () => {
      const cached = await cacheManager.get<any[]>(cacheKey);
      if (cached) return cached;

      await this.auth().catch(() => {});

      const url = `${this.config.url}/player_api.php?username=${this.config.username}&password=${this.config.password}&action=get_series_categories`;
      const res = await requestManager.axiosWithRetry<any[]>({
        method: "get",
        url,
        timeout: 15000,
      });

      const rawData = Array.isArray(res.data) ? res.data : [];
      const categories = rawData.map((c: any) => ({
        id: `series:${c.category_id}`,
        name: c.category_name,
        type: "series",
      }));

      if (categories.length > 0) {
        await cacheManager.set(cacheKey, categories, CACHE_TTL.CATEGORIES);
      }
      return categories;
    });
  }

  // ============================================================
  // SERIES LIST
  // ============================================================
  async getSeries(
    categoryId?: string,
    page: number = 1,
    pageSize: number = 50
  ) {
    const rawCacheKey = this.getCacheKey("raw_series");

    const rows = await requestManager.request(rawCacheKey, async () => {
      const cached = await cacheManager.get<any[]>(rawCacheKey);
      if (cached) return cached;

      await this.auth().catch(() => {});

      const url = `${this.config.url}/player_api.php?username=${this.config.username}&password=${this.config.password}&action=get_series`;
      const res = await requestManager.axiosWithRetry<any[]>({
        method: "get",
        url,
        timeout: 60000,
      });

      const data = res.data || [];
      await cacheManager.set(rawCacheKey, data, CACHE_TTL.SERIES);
      return data;
    });

    let filteredRows = rows;
    const targetCatId = categoryId?.includes(":") ? categoryId.split(":")[1] : categoryId;
    if (targetCatId && targetCatId !== "all") {
      filteredRows = rows.filter((s: any) => s.category_id == targetCatId);
    }

    const start = (page - 1) * pageSize;
    const paginatedRows = filteredRows.slice(start, start + pageSize);

    const series = paginatedRows.map((s: any) => ({
      id: s.series_id,
      name: s.name,
      logo: buildImageUrl(this.config.url, s.screen_uri ?? s.screenshot_uri ?? s.cover ?? s.stream_icon ?? s.logo ?? ""),
      categoryId: s.category_id,
      description: s.plot || "No description available for this content.",
      year: s.releaseDate,
      rating: s.rating,
      // `get_series` rows carry the credit block directly, unlike VOD rows.
      ...readMeta(s),
    }));

    return series;
  }

  // ============================================================
  // SERIES INFO (Seasons + Episodes)
  // ============================================================
  /**
   * A single film's credit block.
   *
   * Xtream's `get_vod_streams` list rows carry only the poster, year and
   * rating — cast, director, genre and the full plot live behind a per-title
   * `get_vod_info`. So this is called by the details sheet when it opens
   * rather than during the library load: fetching it for every film up front
   * would be one request per title across a library of thousands.
   *
   * Returns an empty object rather than throwing. Missing credits are a
   * cosmetic gap, and a details sheet that fails to open because of one is a
   * far worse outcome than one with a blank cast line.
   */
  async getVodInfo(vodId: string): Promise<MediaMeta> {
    const cacheKey = this.getCacheKey("vod_info", vodId);

    return requestManager.request(cacheKey, async () => {
      const cached = await cacheManager.get<MediaMeta>(cacheKey);
      if (cached) return cached;

      try {
        await this.auth().catch(() => { });

        const url =
          `${this.config.url}/player_api.php?username=${this.config.username}` +
          `&password=${this.config.password}&action=get_vod_info&vod_id=${encodeURIComponent(vodId)}`;
        const res = await requestManager.axiosWithRetry<any>({
          method: "get",
          url,
          timeout: 15000,
        });

        const meta = readMeta(res.data?.info);
        await cacheManager.set(cacheKey, meta, CACHE_TTL.SERIES_INFO);
        return meta;
      } catch (err) {
        console.warn("getVodInfo failed:", (err as any)?.message || err);
        return {};
      }
    });
  }

  async getSeriesInfo(seriesId: string) {
    const cacheKey = this.getCacheKey("series_info", seriesId);

    return requestManager.request(cacheKey, async () => {
      const cached = await cacheManager.get<any[]>(cacheKey);
      if (cached) return cached;

      await this.auth().catch(() => {});

      const url = `${this.config.url}/player_api.php?username=${this.config.username}&password=${this.config.password}&action=get_series_info&series_id=${seriesId}`;
      const res = await requestManager.axiosWithRetry<any>({
        method: "get",
        url,
        timeout: 15000,
      });

      const episodes = res.data?.episodes || {};
      // `get_series_info` is the only place the series' cast and plot live, and
      // the details screen is already awaiting this call — so the metadata is
      // attached to the returned seasons rather than fetched a second time.
      const seriesMeta = readMeta(res.data?.info);

      const seasons: Season[] = Object.keys(episodes).map((seasonNum) => ({
        id: seasonNum,
        name: `Season ${seasonNum}`,
        seasonNumber: Number(seasonNum),
        seriesMeta,

        episodes: episodes[seasonNum].map((ep: any) => ({
          id: ep.id.toString(),
          name: ep.title,
          episodeNum: ep.episode_num,
          seasonNum: Number(seasonNum),
          streamUrl: this.buildSeriesUrl(ep.id, ep.container_extension),
          // The episode's own synopsis. Left undefined rather than filled with
          // a placeholder, so a screen can fall back to the series' plot and
          // tell the difference between "no episode blurb" and a real one.
          description: cleanText(ep.info?.plot ?? ep.info?.description),
          // Two fields, two units — hence telling the formatter which is which
          // rather than letting it guess. `duration` is "HH:MM:SS";
          // `duration_secs` is what its name says.
          duration:
            formatRuntime(cleanText(ep.info?.duration)) ??
            formatRuntime(ep.info?.duration_secs, "seconds"),
          rating: cleanText(ep.info?.rating),
          airDate: cleanText(ep.info?.releasedate ?? ep.info?.air_date),
          still: cleanText(ep.info?.movie_image ?? ep.info?.cover_big ?? ep.info?.still_path),
        })),
      }));

      await cacheManager.set(cacheKey, seasons, CACHE_TTL.SERIES_INFO);
      return seasons;
    });
  }

  // ============================================================
  // STREAM URL HELPERS
  // ============================================================
  builditvUrl(streamId: string) {
    return `${this.config.url}/itv/${this.config.username}/${this.config.password}/${streamId}.m3u8`;
  }

  buildMovieUrl(streamId: string, ext: string = "mp4") {
    return `${this.config.url}/movie/${this.config.username}/${this.config.password}/${streamId}.${ext}`;
  }

  buildSeriesUrl(streamId: string, ext: string = "mp4") {
    return `${this.config.url}/series/${this.config.username}/${this.config.password}/${streamId}.${ext}`;
  }

  // ============================================================
  // EPG
  // ============================================================

  /**
   * The next few programmes on one channel.
   *
   * The alternative is `xmltv.php`, which serves the entire provider's guide —
   * tens of megabytes for a banner that shows two rows. Titles and descriptions
   * come back base64-encoded; decoding is the caller's job (see epgService).
   */
  async getShortEpg(streamId: string, limit = 12): Promise<any> {
    if (!streamId) return null;
    const cacheKey = this.getCacheKey("short_epg", `${streamId}:${limit}`);

    return requestManager.request(cacheKey, async () => {
      const cached = await cacheManager.get<any>(cacheKey);
      if (cached) return cached;

      const url =
        `${this.config.url}/player_api.php?username=${encodeURIComponent(this.config.username)}` +
        `&password=${encodeURIComponent(this.config.password)}` +
        `&action=get_short_epg&stream_id=${encodeURIComponent(streamId)}&limit=${limit}`;

      const res = await requestManager.axiosWithRetry<any>({
        method: "get",
        url,
        timeout: 15000,
      });

      const data = res.data ?? null;
      if (data) await cacheManager.set(cacheKey, data, CACHE_TTL.EPG);
      return data;
    });
  }

  async getEpg() {
    const cacheKey = this.getCacheKey("epg");

    return requestManager.request(cacheKey, async () => {
      const cached = await cacheManager.get<any>(cacheKey);
      if (cached) return cached;

      const url = `${this.config.url}/xmltv.php?username=${this.config.username}&password=${this.config.password}`;
      const res = await requestManager.axiosWithRetry<any>({
        method: "get",
        url,
        timeout: 30000,
      });

      await cacheManager.set(cacheKey, res.data, CACHE_TTL.EPG);
      return res.data; // XML EPG → your UI can parse
    });
  }

  // UNIVERSAL
  async getStreamUrl(id: string, type: "itv" | "vod" | "series", ext?: string) {
    switch (type) {
      case "itv":
        return this.builditvUrl(id);
      case "vod":
        return this.buildMovieUrl(id, ext);
      case "series":
        return this.buildSeriesUrl(id, ext);
      default:
        return "";
    }
  }

  // --------------------------------------------------
  // FORCE REFRESH ALL DATA (used for full refresh)
  // --------------------------------------------------
  async refreshData() {
    // Clear first-page/all cached keys then re-fetch
    const keys = [
      this.getCacheKey("auth"),
      this.getCacheKey("live_categories"),
      this.getCacheKey("raw_live_streams"),
      this.getCacheKey("vod_categories"),
      this.getCacheKey("raw_vod_streams"),
      this.getCacheKey("series_categories"),
      this.getCacheKey("raw_series"),
      this.getCacheKey("epg"),
    ];

    await Promise.all(keys.map((k) => cacheManager.remove(k).catch(() => { })));

    // Ensure auth refreshed
    await this.auth();

    const liveCategories = await this.getitvCategories();
    const liveChannels = await this.getitvChannels(undefined, 1);
    const vodCategories = await this.getVodCategories();
    const vodItems = await this.getVodItems(undefined, 1);
    const seriesCategories = await this.getSeriesCategories();
    const seriesList = await this.getSeries(undefined, 1);
    const epg = await this.getEpg();

    return {
      liveCategories,
      liveChannels,
      vodCategories,
      vodItems,
      seriesCategories,
      seriesList,
      epg,
    };
  }
  // ============================================================
  // XTREAM SEARCH (INSTANCE METHOD)
  // ============================================================
  async searchXtream(q: string, type: "itv" | "vod" | "series") {
    let action = "";

    switch (type) {
      case "itv":
        action = "get_live_streams";
        break;
      case "vod":
        action = "get_vod_streams";
        break;
      case "series":
        action = "get_series";
        break;
      default:
        throw new Error("Invalid Xtream search type");
    }

    const res = await axios.get(
      `${this.config.url.replace(/\/$/, "")}/player_api.php`,
      {
        params: {
          username: this.config.username,
          password: this.config.password,
          action,
        },
        timeout: 15000,
      }
    );

    if (!Array.isArray(res.data)) {
      throw new Error("Invalid Xtream response");
    }

    const query = q.toLowerCase();

    // 🔥 Xtream has NO real search → filter locally
    return res.data.filter((item: any) =>
      item.name?.toLowerCase().includes(query)
    );
  }
}
