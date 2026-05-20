// api/xtreamApi.ts
import axios from "axios";
import { cacheManager, CACHE_TTL } from "./cacheManager";
import { requestManager } from "./requestManager";
import { Portal } from "../store/portalStore";

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

      await cacheManager.set(cacheKey, res.data, CACHE_TTL.AUTH);
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

      const url = `${this.config.url}/player_api.php?username=${this.config.username}&password=${this.config.password}&action=get_live_categories`;
      const res = await requestManager.axiosWithRetry<any[]>({
        method: "get",
        url,
        timeout: 15000,
      });

      const categories = (res.data || []).map((c: any) => ({
        id: c.category_id,
        name: c.category_name,
        type: "live",
      }));

      await cacheManager.set(cacheKey, categories, CACHE_TTL.CATEGORIES);
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
    const cacheKey = this.getCacheKey(
      "live_channels",
      `${categoryId || "all"}:${page}`
    );

    return requestManager.request(cacheKey, async () => {
      const cached = await cacheManager.get<any[]>(cacheKey);
      if (cached) return cached;

      const url = `${this.config.url}/player_api.php?username=${this.config.username}&password=${this.config.password}&action=get_live_streams`;
      const res = await requestManager.axiosWithRetry<any[]>({
        method: "get",
        url,
        timeout: 15000,
      });

      let rows = res.data || [];

      if (categoryId && categoryId !== "all") {
        rows = rows.filter((c: any) => c.category_id == categoryId);
      }

      // Pagination
      const start = (page - 1) * pageSize;
      const paginatedRows = rows.slice(start, start + pageSize);

      const channels = paginatedRows.map((c: any) => ({
        id: c.stream_id,
        name: c.name,
        logo: c.stream_icon,
        categoryId: c.category_id,
        streamUrl: this.builditvUrl(c.stream_id),
        epgId: c.epg_channel_id,
      }));

      await cacheManager.set(cacheKey, channels, CACHE_TTL.CHANNELS);
      return channels;
    });
  }

  // ============================================================
  // VOD CATEGORIES
  // ============================================================
  async getVodCategories() {
    const cacheKey = this.getCacheKey("vod_categories");

    return requestManager.request(cacheKey, async () => {
      const cached = await cacheManager.get<any[]>(cacheKey);
      if (cached) return cached;

      const url = `${this.config.url}/player_api.php?username=${this.config.username}&password=${this.config.password}&action=get_vod_categories`;
      const res = await requestManager.axiosWithRetry<any[]>({
        method: "get",
        url,
        timeout: 15000,
      });

      const categories = res.data.map((c: any) => ({
        id: c.category_id,
        name: c.category_name,
        type: "vod",
      }));

      await cacheManager.set(cacheKey, categories, CACHE_TTL.CATEGORIES);
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
    const cacheKey = this.getCacheKey(
      "vod_items",
      `${categoryId || "all"}:${page}`
    );

    return requestManager.request(cacheKey, async () => {
      const cached = await cacheManager.get<any[]>(cacheKey);
      if (cached) return cached;

      const url = `${this.config.url}/player_api.php?username=${this.config.username}&password=${this.config.password}&action=get_vod_streams`;
      const res = await requestManager.axiosWithRetry<any[]>({
        method: "get",
        url,
        timeout: 15000,
      });

      let rows = res.data || [];

      if (categoryId && categoryId !== "all") {
        rows = rows.filter((v: any) => v.category_id == categoryId);
      }

      // Pagination
      const start = (page - 1) * pageSize;
      const paginatedRows = rows.slice(start, start + pageSize);

      const items = paginatedRows.map((v: any) => ({
        id: v.stream_id,
        name: v.name,
        logo: v.stream_icon,
        categoryId: v.category_id,
        streamUrl: this.buildMovieUrl(v.stream_id, v.container_extension),
        description: v.plot,
        year: v.year,
        rating: v.rating,
        duration: v.duration,
      }));

      await cacheManager.set(cacheKey, items, CACHE_TTL.VOD);
      return items;
    });
  }

  // ============================================================
  // SERIES CATEGORIES
  // ============================================================
  async getSeriesCategories() {
    const cacheKey = this.getCacheKey("series_categories");

    return requestManager.request(cacheKey, async () => {
      const cached = await cacheManager.get<any[]>(cacheKey);
      if (cached) return cached;

      const url = `${this.config.url}/player_api.php?username=${this.config.username}&password=${this.config.password}&action=get_series_categories`;
      const res = await requestManager.axiosWithRetry<any[]>({
        method: "get",
        url,
        timeout: 15000,
      });

      const categories = res.data.map((c: any) => ({
        id: c.category_id,
        name: c.category_name,
        type: "series",
      }));

      await cacheManager.set(cacheKey, categories, CACHE_TTL.CATEGORIES);
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
    const cacheKey = this.getCacheKey(
      "series_list",
      `${categoryId || "all"}:${page}`
    );

    return requestManager.request(cacheKey, async () => {
      const cached = await cacheManager.get<any[]>(cacheKey);
      if (cached) return cached;

      const url = `${this.config.url}/player_api.php?username=${this.config.username}&password=${this.config.password}&action=get_series`;
      const res = await requestManager.axiosWithRetry<any[]>({
        method: "get",
        url,
        timeout: 15000,
      });

      let rows = res.data || [];

      if (categoryId && categoryId !== "all") {
        rows = rows.filter((s: any) => s.category_id == categoryId);
      }

      // Pagination
      const start = (page - 1) * pageSize;
      const paginatedRows = rows.slice(start, start + pageSize);

      const series = paginatedRows.map((s: any) => ({
        id: s.series_id,
        name: s.name,
        logo: s.cover,
        categoryId: s.category_id,
        description: s.plot,
        year: s.releaseDate,
        rating: s.rating,
      }));

      await cacheManager.set(cacheKey, series, CACHE_TTL.SERIES);
      return series;
    });
  }

  // ============================================================
  // SERIES INFO (Seasons + Episodes)
  // ============================================================
  async getSeriesInfo(seriesId: string) {
    const cacheKey = this.getCacheKey("series_info", seriesId);

    return requestManager.request(cacheKey, async () => {
      const cached = await cacheManager.get<any[]>(cacheKey);
      if (cached) return cached;

      const url = `${this.config.url}/player_api.php?username=${this.config.username}&password=${this.config.password}&action=get_series_info&series_id=${seriesId}`;
      const res = await requestManager.axiosWithRetry<any>({
        method: "get",
        url,
        timeout: 15000,
      });

      const episodes = res.data?.episodes || {};

      const seasons = Object.keys(episodes).map((seasonNum) => ({
        id: seasonNum,
        name: `Season ${seasonNum}`,
        seasonNumber: Number(seasonNum),

        episodes: episodes[seasonNum].map((ep: any) => ({
          id: ep.id.toString(),
          name: ep.title,
          episodeNum: ep.episode_num,
          streamUrl: this.buildSeriesUrl(ep.id, ep.container_extension),
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
      this.getCacheKey("live_channels", `all:1`),
      this.getCacheKey("vod_categories"),
      this.getCacheKey("vod_items", `all:1`),
      this.getCacheKey("series_categories"),
      this.getCacheKey("series_list", `all:1`),
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
