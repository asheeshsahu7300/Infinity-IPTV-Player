// ─────────────────────────────────────────────────────────────────────────────
// stbEnvironment — the box's own preferences and identity.
//
// Two things live here because on a real set-top box they are the same menu:
//
//   • settings — buffer profile, banner timeout, guide behaviour, startup
//                channel, clock format. Written rarely, read on every channel
//                change, so they are cached in memory and exposed synchronously
//                after one `load()` at boot.
//   • identity — model, serial, MAC, firmware, resolution, uptime. What the
//                "System Information" page shows and what a provider asks for
//                when a portal will not authorise.
//
// The buffer profile is the important one. It is the single knob that decides
// whether playback favours an instant channel change or riding out a bad line,
// and the player reads it on every mount.
// ─────────────────────────────────────────────────────────────────────────────
import { Dimensions, Platform } from "react-native";
import Constants from "expo-constants";

import { safeStorage } from "./safeStorage";
import type { Portal } from "../store/portalStore";

const STORAGE_KEY = "stb_environment_v1";

/**
 * How playback trades startup latency against resilience.
 *
 *   instant — near-zero cache. Channel changes are immediate, which is what a
 *             box on a clean local network should feel like, but any dip in
 *             the line becomes a visible stall.
 *   balanced — the default. Roughly a second of live cache: fast enough that a
 *             zap still feels instant, deep enough to absorb a lost segment.
 *   smooth  — several seconds. Channel changes visibly lag, and playback holds
 *             together on a congested or wireless connection.
 */
export type BufferProfile = "instant" | "balanced" | "smooth";

export interface BufferTuning {
  /** VLC `--network-caching` / `--live-caching`, in ms. */
  liveCacheMs: number;
  /** The same for on-demand, where startup latency matters far less. */
  vodCacheMs: number;
  /**
   * How long playback may make no progress before the stream is considered
   * dead and silently reconnected. Must exceed the cache depth or the
   * watchdog fires while the buffer is simply filling.
   */
  stallTimeoutMs: number;
}

export const BUFFER_PROFILES: Record<BufferProfile, BufferTuning & { label: string; detail: string }> = {
  instant: {
    label: "Instant",
    detail: "Fastest channel change. Needs a steady connection.",
    liveCacheMs: 1000,
    vodCacheMs: 800,
    stallTimeoutMs: 10000,
  },
  balanced: {
    label: "Balanced",
    detail: "Fast zapping with enough buffer to absorb minor network variance.",
    liveCacheMs: 2500,
    vodCacheMs: 1500,
    stallTimeoutMs: 14000,
  },
  smooth: {
    label: "Smooth",
    detail: "Deepest buffer. Best on Wi-Fi or a congested line.",
    liveCacheMs: 4000,
    vodCacheMs: 3000,
    stallTimeoutMs: 20000,
  },
};

export interface StbSettings {
  bufferProfile: BufferProfile;
  /** Seconds the channel banner stays up after a zap. */
  infoBarSeconds: number;
  /** Show the banner automatically on every channel change. */
  autoInfoBar: boolean;
  /**
   * Roll into the next episode when one finishes.
   *
   * On by default, because a season is what people sit down to watch and
   * stopping dead after each episode is the behaviour nobody wants. It is a
   * setting at all because it is the one piece of playback that starts without
   * being asked, so someone who does not want that needs a way to say so.
   */
  autoplayNext: boolean;
  /** 24-hour clock, as most of the world's STBs default to. */
  clock24h: boolean;
  /**
   * Pull the provider's whole XMLTV guide even when it is very large.
   * Off by default: a national guide is tens of megabytes.
   */
  fullXmltvGuide: boolean;
  /** Channel id to tune on launch, STB "boot channel" style. Empty = none. */
  startupChannelId: string;
  /** Keep the last channel and return to it on launch. */
  resumeLastChannel: boolean;
  /** Hardware decoding — mirrors the existing app_settings flag. */
  hardwareAcceleration: boolean;
  /**
   * Rewrite stream URLs to use the current portal server host and port.
   * Useful when streams return dead or unreachable CDN hosts, or when
   * empty links need to be played through the portal host as a proxy.
   */
  sameHostStreamProxy: boolean;
}

const DEFAULTS: StbSettings = {
  bufferProfile: "balanced",
  infoBarSeconds: 5,
  autoInfoBar: true,
  autoplayNext: true,
  clock24h: true,
  fullXmltvGuide: false,
  startupChannelId: "",
  resumeLastChannel: true,
  hardwareAcceleration: true,
  sameHostStreamProxy: false,
};

type Listener = (settings: StbSettings) => void;

class StbEnvironmentImpl {
  private settings: StbSettings = { ...DEFAULTS };
  private loaded = false;
  private loadPromise: Promise<StbSettings> | null = null;
  private listeners = new Set<Listener>();
  private readonly bootedAt = Date.now();

  // ── Settings ──────────────────────────────────────────────────────────────

  async load(): Promise<StbSettings> {
    if (this.loaded) return this.settings;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      try {
        const raw = await safeStorage.getItem(STORAGE_KEY);
        if (raw) this.settings = { ...DEFAULTS, ...JSON.parse(raw) };

        // `hardwareAcceleration` predates this store and still lives in
        // `app_settings`, which the settings screen writes. Read it across so
        // the two do not disagree about the same switch.
        const legacy = await safeStorage.getItem("app_settings");
        if (legacy) {
          const parsed = JSON.parse(legacy);
          if (typeof parsed.hardwareAcceleration === "boolean") {
            this.settings.hardwareAcceleration = parsed.hardwareAcceleration;
          }
        }
      } catch (e) {
        console.warn("[STB] settings load failed:", e);
      } finally {
        this.loaded = true;
        this.loadPromise = null;
      }
      return this.settings;
    })();

    return this.loadPromise;
  }

  /** Synchronous snapshot. `load()` runs once at boot. */
  get snapshot(): StbSettings {
    return this.settings;
  }

  get buffer(): BufferTuning {
    return BUFFER_PROFILES[this.settings.bufferProfile] ?? BUFFER_PROFILES.balanced;
  }

  /**
   * Resolves active buffer tuning adaptively from user preferences and portal
   * server capabilities (e.g. MAG hls_fast_start, playback_buffer_size).
   */
  getBufferTuning(portal?: Portal | null): BufferTuning {
    const baseTuning = BUFFER_PROFILES[this.settings.bufferProfile] ?? BUFFER_PROFILES.balanced;
    const serverInfo = (portal?.config as any)?.serverInfo;

    if (serverInfo && portal?.type === "mag") {
      const serverBufSec = Number(serverInfo.playback_buffer_size);

      if (this.settings.bufferProfile === "instant") {
        return {
          liveCacheMs: 800,
          vodCacheMs: 500,
          stallTimeoutMs: 10000,
        };
      }

      if (this.settings.bufferProfile === "balanced") {
        const liveMs = Number.isFinite(serverBufSec) && serverBufSec > 0
          ? Math.min(2500, Math.max(1200, Math.round(serverBufSec * 150)))
          : 1500;
        return {
          liveCacheMs: liveMs,
          vodCacheMs: 1000,
          stallTimeoutMs: 12000,
        };
      }
    }

    return baseTuning;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async update(patch: Partial<StbSettings>): Promise<StbSettings> {
    await this.load();
    this.settings = { ...this.settings, ...patch };
    try {
      await safeStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch (e) {
      console.warn("[STB] settings save failed:", e);
    }
    this.listeners.forEach((l) => {
      try {
        l(this.settings);
      } catch {
        /* one bad listener must not stop the rest */
      }
    });
    return this.settings;
  }

  /** Cycles the buffer profile — one focusable row, three states. */
  async cycleBufferProfile(): Promise<BufferProfile> {
    const order: BufferProfile[] = ["instant", "balanced", "smooth"];
    const next = order[(order.indexOf(this.settings.bufferProfile) + 1) % order.length];
    await this.update({ bufferProfile: next });
    return next;
  }

  // ── Clock ─────────────────────────────────────────────────────────────────

  /** "21:40" or "9:40 PM", per the clock setting. */
  formatClock(date: Date | number = Date.now()): string {
    const d = typeof date === "number" ? new Date(date) : date;
    const h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, "0");
    if (this.settings.clock24h) return `${String(h).padStart(2, "0")}:${m}`;
    const suffix = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${m} ${suffix}`;
  }

  // ── Identity ──────────────────────────────────────────────────────────────

  /** Milliseconds since the app started — the STB "uptime" line. */
  get uptimeMs(): number {
    return Date.now() - this.bootedAt;
  }

  /**
   * The box's identity page.
   *
   * The MAC comes from the active portal when there is one, because on a MAG
   * portal that is the device identity the provider actually authorised — it is
   * the number support asks for.
   */
  describe(portal: Portal | null): SystemInfo {
    const { width, height, scale } = Dimensions.get("screen");
    const expo = Constants.expoConfig;

    return {
      model: describeModel(),
      platform: `${Platform.OS}${Platform.Version ? ` ${Platform.Version}` : ""}`,
      appName: expo?.name ?? "IPTV Hub",
      appVersion: expo?.version ?? "1.0.0",
      // The native build number is what distinguishes two installs carrying the
      // same JS version, which is the thing that matters when diagnosing.
      buildNumber: String(
        (expo as any)?.android?.versionCode ?? (expo as any)?.ios?.buildNumber ?? "—"
      ),
      resolution: `${Math.round(width * scale)} × ${Math.round(height * scale)}`,
      layoutSize: `${Math.round(width)} × ${Math.round(height)} dp`,
      deviceId: Constants.sessionId?.slice(0, 8)?.toUpperCase() ?? "—",
      mac: portal?.config?.mac || "—",
      portalName: portal?.name ?? "Not connected",
      portalType: portal ? portal.type.toUpperCase() : "—",
      portalUrl: portal?.config?.url ?? "—",
      timezone: resolveTimezone(),
      uptimeMs: this.uptimeMs,
      bufferProfile: this.settings.bufferProfile,
    };
  }
}

export interface SystemInfo {
  model: string;
  platform: string;
  appName: string;
  appVersion: string;
  buildNumber: string;
  resolution: string;
  layoutSize: string;
  deviceId: string;
  mac: string;
  portalName: string;
  portalType: string;
  portalUrl: string;
  timezone: string;
  uptimeMs: number;
  bufferProfile: BufferProfile;
}

function describeModel(): string {
  const device = (Constants as any)?.deviceName;
  if (device) return String(device);
  if (Platform.isTV) return "Android TV";
  return Platform.OS === "android" ? "Android device" : Platform.OS;
}

function resolveTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) return tz;
  } catch {
    /* Hermes without full ICU */
  }
  const offsetMin = -new Date().getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** "3h 12m" — how an STB status page renders uptime. */
export function formatUptime(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export const stbEnvironment = new StbEnvironmentImpl();
export default stbEnvironment;

/**
 * Rewrites a stream URL to use the portal server host/port if sameHostStreamProxy
 * is enabled, or if the URL contains a known stale/dead middleware domain.
 * Also constructs a fallback same-host URL if the streamUrl is empty.
 */
export function applySameHostStreamProxy(
  streamUrl: string,
  portal: Portal | null | undefined,
  cmd?: string
): string {
  if (!portal?.config?.url) return streamUrl;
  const isEnabled = stbEnvironment.snapshot.sameHostStreamProxy;

  const serverRoot = portal.config.url
    .replace(/\/$/, "")
    .replace(/\/portal\.php$/i, "")
    .replace(/\/c$/i, "");

  let target = streamUrl ? streamUrl.trim() : "";

  // If empty player link, attempt to build same host link from cmd if available
  if (!target && cmd) {
    const clean = cmd.replace(/^(ffmpeg|ffrt\d*|auto|-i|vlc)\s+/i, "").trim();
    if (clean) {
      if (/^https?:\/\//i.test(clean)) {
        target = clean;
      } else if (clean.startsWith("/") || clean.includes(".mpg") || clean.includes(".m3u8") || clean.includes(".ts") || clean.includes("ch/")) {
        target = `${serverRoot}/${clean.replace(/^\/+/, "")}`;
      }
    }
  }

  if (!target) return "";

  const isKnownStale = /(localhost|127\.0\.0\.1|webhop\.live|starshare\.live|corelink\.|corelink\.blog|stalker\.|mag\.local|iptv\.local)/i.test(target);
  if (!isEnabled && !isKnownStale) {
    return target;
  }

  try {
    const portalUrlObj = new URL(serverRoot);
    const targetUrlObj = new URL(target);

    targetUrlObj.protocol = portalUrlObj.protocol;
    targetUrlObj.hostname = portalUrlObj.hostname;
    if (portalUrlObj.port && (!targetUrlObj.port || targetUrlObj.port === "80" || targetUrlObj.port === "8080" || isEnabled)) {
      targetUrlObj.port = portalUrlObj.port;
    }
    return targetUrlObj.toString();
  } catch {
    if (target.startsWith("/") && !target.startsWith("//")) {
      return `${serverRoot}${target}`;
    }
    return target;
  }
}
