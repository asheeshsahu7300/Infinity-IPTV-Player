import { safeStorage } from "./safeStorage";

export interface ScreensaverData {
  url: string;
  title?: string;
  copyright?: string;
  date: string;
}

const STORAGE_KEYS = {
  DATE: "daily_screensaver_date",
  URL: "daily_screensaver_url",
  TITLE: "daily_screensaver_title",
  COPYRIGHT: "daily_screensaver_copyright",
};

const BING_API = "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=en-US";

class ScreensaverService {
  private currentWallpaper: string | null = null;
  private isFetching = false;

  /**
   * Formats a Date object into YYYYMMDD string in local time.
   */
  private getTodayDateKey(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}${m}${day}`;
  }

  /**
   * Retrieves the daily screensaver wallpaper data (url, title, copyright, date).
   * Checks local storage first. If not cached today, fetches from Bing, saves to storage, and returns.
   */
  async getDailyScreensaver(): Promise<ScreensaverData | null> {
    const today = this.getTodayDateKey();

    // 1. Check safeStorage first
    try {
      const savedDate = await safeStorage.getItem(STORAGE_KEYS.DATE);
      const savedUrl = await safeStorage.getItem(STORAGE_KEYS.URL);
      const savedTitle = await safeStorage.getItem(STORAGE_KEYS.TITLE);
      const savedCopyright = await safeStorage.getItem(STORAGE_KEYS.COPYRIGHT);

      if (savedDate === today && savedUrl) {
        this.currentWallpaper = savedUrl;
        return {
          url: savedUrl,
          title: savedTitle || undefined,
          copyright: savedCopyright || undefined,
          date: savedDate,
        };
      }
    } catch (e) {
      console.warn("[ScreensaverService] Error reading storage:", e);
    }

    // 2. Fetch from Bing API and save
    if (!this.isFetching) {
      this.isFetching = true;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);

        const res = await fetch(BING_API, {
          signal: controller.signal,
          headers: { "User-Agent": "Mozilla/5.0 (Android TV) InfinityIPTV" },
        });
        clearTimeout(timeout);

        if (res.ok) {
          const json = await res.json();
          const img = json?.images?.[0];
          if (img?.url) {
            const fullUrl = img.url.startsWith("http")
              ? img.url
              : `https://www.bing.com${img.url}`;

            this.currentWallpaper = fullUrl;

            // Save to storage for today
            await safeStorage.setItem(STORAGE_KEYS.DATE, today);
            await safeStorage.setItem(STORAGE_KEYS.URL, fullUrl);
            if (img.title) await safeStorage.setItem(STORAGE_KEYS.TITLE, img.title);
            if (img.copyright) await safeStorage.setItem(STORAGE_KEYS.COPYRIGHT, img.copyright);

            console.log("[ScreensaverService] Saved new daily screensaver for", today, ":", img.title);
            return {
              url: fullUrl,
              title: img.title,
              copyright: img.copyright,
              date: today,
            };
          }
        }
      } catch (err: any) {
        console.warn("[ScreensaverService] Fetch daily wallpaper failed:", err?.message || err);
      } finally {
        this.isFetching = false;
      }
    }

    // 3. Fallback to previously saved wallpaper
    const fallbackSaved = await safeStorage.getItem(STORAGE_KEYS.URL);
    const fallbackTitle = await safeStorage.getItem(STORAGE_KEYS.TITLE);
    if (fallbackSaved) {
      this.currentWallpaper = fallbackSaved;
      return {
        url: fallbackSaved,
        title: fallbackTitle || undefined,
        date: today,
      };
    }

    return null;
  }

  /**
   * Retrieves the daily screensaver wallpaper URL.
   */
  async getDailyWallpaper(): Promise<string | null> {
    const data = await this.getDailyScreensaver();
    return data ? data.url : null;
  }
}

export const screensaverService = new ScreensaverService();
