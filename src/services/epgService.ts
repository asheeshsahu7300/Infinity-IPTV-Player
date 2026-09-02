// ─────────────────────────────────────────────────────────────────────────────
// epgService — one EPG index shared by every portal type.
//
// A set-top box always knows what is on the channel it is pointing at, so the
// grid, the info bar and the player all read now/next from here rather than
// each fetching a guide of their own.
//
// Two acquisition paths feed the same index:
//
//   • bulk   — everything the portal will hand over in one request. MAG serves
//              `epg_info` for every channel at once; Xtream and M3U only have
//              XMLTV, which is far too big to hold whole, so it is run through
//              a windowed parser that keeps just the surrounding ~30 hours.
//   • short  — one channel, on demand, a handful of programmes. This is what
//              the focused tile and the tuned channel use, and it is the only
//              guide many Xtream portals will answer for at all.
//
// Lookups are key-fuzzy on purpose: a channel is indexed under its portal id,
// its `tvg-id`, and its normalised name, because the three portal types
// disagree about which of those the guide is keyed by.
// ─────────────────────────────────────────────────────────────────────────────
import axios from "axios";

import { cacheManager, CACHE_TTL } from "./cacheManager";
import { portalApi } from "./portalApi";
import { XtreamApi } from "./xtreamApi";
import { M3UApi } from "./m3uApi";
import type { Channel, EPGProgram, Portal } from "../store/portalStore";

// ── Tunables ────────────────────────────────────────────────────────────────

/** How far back the windowed XMLTV parser keeps programmes. */
const WINDOW_PAST_MS = 3 * 60 * 60 * 1000;
/** How far ahead it keeps them. Beyond this the guide is re-fetched instead. */
const WINDOW_FUTURE_MS = 30 * 60 * 60 * 1000;
/** Programmes kept per channel — an STB guide banner never needs more. */
const MAX_PROGRAMS_PER_CHANNEL = 64;
/** Concurrent per-channel guide requests. Portals throttle aggressively. */
const SHORT_EPG_CONCURRENCY = 3;
/** A channel that answered "no guide" is not asked again for this long. */
const NEGATIVE_TTL_MS = 10 * 60 * 1000;
/**
 * Per-channel requests waiting for a slot. Beyond this the oldest are dropped:
 * they are prefetches for rows the viewer has already scrolled past.
 */
const MAX_PREFETCH_QUEUE = 32;
/** Bulk guides are refreshed no more often than this. */
const BULK_MIN_INTERVAL_MS = 15 * 60 * 1000;
/** XMLTV larger than this is skipped unless the user opts into a full guide. */
const XMLTV_SOFT_LIMIT_BYTES = 24 * 1024 * 1024;

// ── Types ───────────────────────────────────────────────────────────────────

export interface NowNext {
  now: EPGProgram | null;
  next: EPGProgram | null;
  /** 0–1 through the current programme. 0 when nothing is playing. */
  progress: number;
}

export const EMPTY_NOW_NEXT: NowNext = { now: null, next: null, progress: 0 };

type Listener = () => void;

// ── Small helpers ───────────────────────────────────────────────────────────

/**
 * Collapses the cosmetic differences between the same channel named three ways
 * — "UK: BBC One HD" and "bbc one" have to land on the same key or the
 * name-matched fallback never fires.
 */
export function normalizeChannelName(name: string): string {
  return String(name || "")
    .toLowerCase()
    // Leading provider/country tag: "UK:", "US |", "[FR]".
    //
    // A hyphen is deliberately NOT a valid separator here. It used to be, and
    // it silently destroyed real names: "SUN-TV" and "STAR-TV" both matched
    // `[a-z]{2,3}` + "-" and normalised to "tv", so they shared a key and got
    // each other's schedule. Provider tags in the wild use ":" or "|".
    .replace(/^\s*[\[(]?[a-z]{2,3}[\])]?\s*[:|]\s*/i, "")
    .replace(/\b(fhd|uhd|hd|sd|4k|hevc|h265|h264|raw|backup|vip)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/**
 * Shortest name key worth trusting.
 *
 * After normalisation a name like "TV 1" collapses to "tv1"; anything shorter
 * than this is so generic that a match means nothing, and matching it to the
 * wrong channel is worse than showing no guide at all.
 */
const MIN_NAME_KEY = 4;

/** Every key a channel might be filed under in a guide. */
function channelKeys(channel: Pick<Channel, "id" | "name" | "epgId">): string[] {
  const keys: string[] = [];
  if (channel.id) keys.push(`id:${String(channel.id).toLowerCase()}`);
  if (channel.epgId) keys.push(`x:${String(channel.epgId).toLowerCase()}`);
  const n = normalizeChannelName(channel.name);
  if (n.length >= MIN_NAME_KEY) keys.push(`n:${n}`);
  return keys;
}

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64 → UTF-8. Xtream wraps every guide title and description in it. */
function decodeBase64(input: string): string {
  if (!input) return "";
  const clean = input.replace(/[^A-Za-z0-9+/=]/g, "");
  if (!clean) return "";
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c1 = B64_CHARS.indexOf(clean[i]);
    const c2 = B64_CHARS.indexOf(clean[i + 1]);
    const c3 = B64_CHARS.indexOf(clean[i + 2]);
    const c4 = B64_CHARS.indexOf(clean[i + 3]);
    if (c1 < 0 || c2 < 0) break;
    bytes.push((c1 << 2) | (c2 >> 4));
    if (c3 >= 0) bytes.push(((c2 & 15) << 4) | (c3 >> 2));
    if (c4 >= 0) bytes.push(((c3 & 3) << 6) | c4);
  }

  // Manual UTF-8 decode — TextDecoder is not guaranteed on Hermes.
  let out = "";
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i += 1;
    } else if (b >= 0xc0 && b < 0xe0 && i + 1 < bytes.length) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (b >= 0xe0 && b < 0xf0 && i + 2 < bytes.length) {
      out += String.fromCharCode(
        ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)
      );
      i += 3;
    } else if (b >= 0xf0 && i + 3 < bytes.length) {
      const cp =
        ((b & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      const v = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
      i += 4;
    } else {
      i += 1;
    }
  }
  return out;
}

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function decodeXmlText(s: string): string {
  if (!s) return "";
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m] ?? m)
    .trim();
}

/**
 * XMLTV timestamps are `YYYYMMDDHHMMSS` with an optional ` +HHMM` offset.
 * A missing offset means the provider's local time, which we can only read as
 * UTC — and every provider that omits it publishes in UTC anyway.
 */
function parseXmltvTime(value: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/.exec(
    String(value || "").trim()
  );
  if (!m) return 0;
  const [, y, mo, d, h, mi, se, tz] = m;
  let ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se || 0));
  if (tz) {
    const sign = tz[0] === "-" ? -1 : 1;
    const offMin = Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5));
    ms -= sign * offMin * 60 * 1000;
  }
  return ms;
}

/** Seconds or milliseconds since the epoch, or a parseable date string. */
export function toMillis(value: any): number {
  if (value == null) return 0;
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const str = String(value).trim();
  if (!str) return 0;
  if (/^\d+$/.test(str)) {
    const n = Number(str);
    return n < 1e12 ? n * 1000 : n;
  }
  // "2026-09-02 12:00:00" — Xtream's non-timestamp form, server-local, no zone.
  const sql = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(str);
  if (sql) {
    return Date.UTC(
      Number(sql[1]),
      Number(sql[2]) - 1,
      Number(sql[3]),
      Number(sql[4]),
      Number(sql[5]),
      Number(sql[6])
    );
  }
  const parsed = Date.parse(str);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortAndTrim(list: EPGProgram[]): EPGProgram[] {
  const seen = new Set<string>();
  const out: EPGProgram[] = [];
  for (const p of list) {
    if (!p || !(p.end > p.start)) continue;
    const k = `${p.start}-${p.end}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  out.sort((a, b) => a.start - b.start);
  if (out.length <= MAX_PROGRAMS_PER_CHANNEL) return out;

  // Keep the window around "now" rather than the head of the day.
  const now = Date.now();
  let start = out.findIndex((p) => p.end > now);
  if (start < 0) start = Math.max(0, out.length - MAX_PROGRAMS_PER_CHANNEL);
  start = Math.max(0, start - 2);
  return out.slice(start, start + MAX_PROGRAMS_PER_CHANNEL);
}

// ── The service ─────────────────────────────────────────────────────────────

class EpgServiceImpl {
  /** key (see `channelKeys`) → programmes, ascending by start. */
  private index = new Map<string, EPGProgram[]>();
  private listeners = new Set<Listener>();
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;

  private portalId: string | null = null;
  private bulkState: "idle" | "loading" | "done" | "unavailable" = "idle";
  private lastBulkAt = 0;
  private bulkPromise: Promise<void> | null = null;

  /** Channels already asked about, so a miss is not retried in a loop. */
  private negative = new Map<string, number>();
  private inFlight = new Map<string, Promise<EPGProgram[]>>();
  /** key → the one channel identity allowed to file under it. See `merge`. */
  private keyOwner = new Map<string, string>();
  /** Keys two different channels answered to, and which are now unusable. */
  private poisoned = new Set<string>();
  private queue: { run: () => void; drop: () => void }[] = [];
  private active = 0;

  /** Ticks every 30 s so progress bars advance and now/next rolls over. */
  private tick: ReturnType<typeof setInterval> | null = null;

  // ── Subscription ──────────────────────────────────────────────────────────

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (!this.tick) {
      this.tick = setInterval(() => this.emit(), 30000);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.tick) {
        clearInterval(this.tick);
        this.tick = null;
      }
    };
  }

  /** Coalesced — a bulk parse writes thousands of channels in one pass. */
  private emit() {
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.listeners.forEach((l) => {
        try {
          l();
        } catch {
          /* one bad listener must not stop the rest */
        }
      });
    }, 120);
  }

  // ── Index access ──────────────────────────────────────────────────────────

  /**
   * True once anything at all is known — lets the UI tell "no guide on this
   * portal" apart from "the guide has not landed yet".
   */
  get hasData(): boolean {
    return this.index.size > 0;
  }

  get status(): "idle" | "loading" | "done" | "unavailable" {
    return this.bulkState;
  }

  private lookup(channel: Pick<Channel, "id" | "name" | "epgId">): EPGProgram[] | null {
    for (const key of channelKeys(channel)) {
      const hit = this.index.get(key);
      if (hit && hit.length) return hit;
    }
    return null;
  }

  programsFor(channel: Pick<Channel, "id" | "name" | "epgId"> | null | undefined): EPGProgram[] {
    if (!channel) return [];
    return this.lookup(channel) ?? [];
  }

  nowNext(channel: Pick<Channel, "id" | "name" | "epgId"> | null | undefined): NowNext {
    if (!channel) return EMPTY_NOW_NEXT;
    const list = this.lookup(channel);
    if (!list || list.length === 0) return EMPTY_NOW_NEXT;

    const now = Date.now();
    // Ascending list — binary search for the last programme starting at or
    // before now, so a full day costs six comparisons per repaint.
    let lo = 0;
    let hi = list.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].start <= now) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    const candidate = idx >= 0 ? list[idx] : null;
    const current = candidate && candidate.end > now ? candidate : null;
    const next = list[idx + 1] ?? null;

    const span = current ? current.end - current.start : 0;
    const progress =
      current && span > 0 ? Math.min(1, Math.max(0, (now - current.start) / span)) : 0;

    return { now: current, next, progress };
  }

  /**
   * Files a channel's programmes under every key it might be looked up by.
   *
   * `owner` is the guide-side identity of the channel the programmes belong to,
   * and it is what makes this safe. Keys are not unique by construction: two
   * channels can normalise to the same name, and a portal can hand back an
   * `epg_id` that collides with another channel's `id`. This used to
   * concatenate regardless, so a collision interleaved two schedules into one
   * key — the guide then showed a plausible-looking programme list that simply
   * belonged to a different channel.
   *
   * A key claimed by a second owner is therefore **poisoned**: it is dropped
   * from the index and never filled again. Once two channels answer to a key,
   * nothing it returns can be trusted, and no guide beats a wrong guide.
   * Repeat merges from the *same* owner still concatenate, which is how a short
   * per-channel fetch tops up what the bulk load started.
   */
  private merge(keys: string[], programs: EPGProgram[], owner: string) {
    if (programs.length === 0) return;
    const trimmed = sortAndTrim(programs);
    if (trimmed.length === 0) return;

    for (const key of keys) {
      if (this.poisoned.has(key)) continue;

      const currentOwner = this.keyOwner.get(key);
      if (currentOwner !== undefined && currentOwner !== owner) {
        this.poisoned.add(key);
        this.keyOwner.delete(key);
        this.index.delete(key);
        continue;
      }

      this.keyOwner.set(key, owner);
      const existing = this.index.get(key);
      this.index.set(key, existing ? sortAndTrim(existing.concat(trimmed)) : trimmed);
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Drops everything when the active portal changes. */
  reset(portalId: string | null) {
    if (this.portalId === portalId) return;
    this.portalId = portalId;
    this.index.clear();
    this.keyOwner.clear();
    this.poisoned.clear();
    this.negative.clear();
    this.inFlight.clear();
    this.queue.length = 0;
    this.bulkState = "idle";
    this.bulkPromise = null;
    this.lastBulkAt = 0;
    this.emit();
  }

  // ── Bulk guide ────────────────────────────────────────────────────────────

  /**
   * Pulls whatever guide the portal will serve in one go. Safe to call on every
   * Live TV mount: it is single-flighted and rate-limited, and it resolves
   * immediately when the portal has no bulk endpoint worth calling.
   */
  async loadBulk(
    portal: Portal,
    opts: { force?: boolean; allowLargeXmltv?: boolean } = {}
  ): Promise<void> {
    if (!portal) return;
    this.reset(portal.id);
    if (this.bulkPromise) return this.bulkPromise;
    if (!opts.force) {
      if (this.bulkState === "unavailable") return;
      if (this.bulkState === "done" && Date.now() - this.lastBulkAt < BULK_MIN_INTERVAL_MS) return;
    }

    this.bulkState = "loading";
    this.emit();

    // Captured, because a portal switch mid-fetch resets everything: without
    // this the old portal's result would land on the new portal's state and
    // leave it marked "done" with an empty index.
    const forPortal = portal.id;

    this.bulkPromise = (async () => {
      try {
        let loaded = false;
        if (portal.type === "mag") loaded = await this.loadMagBulk(portal);
        else if (portal.type === "xtream")
          loaded = await this.loadXtreamBulk(portal, opts.allowLargeXmltv === true);
        else if (portal.type === "m3u")
          loaded = await this.loadM3uBulk(portal, opts.allowLargeXmltv === true);

        if (this.portalId !== forPortal) return;
        this.lastBulkAt = Date.now();
        this.bulkState = loaded ? "done" : "unavailable";
      } catch (e) {
        console.warn("[EPG] bulk load failed:", (e as any)?.message || e);
        if (this.portalId === forPortal) this.bulkState = "unavailable";
      } finally {
        if (this.portalId === forPortal) this.bulkPromise = null;
        this.emit();
      }
    })();

    return this.bulkPromise;
  }

  private async loadMagBulk(portal: Portal): Promise<boolean> {
    const programs = await portalApi.getEpg(portal);
    if (!Array.isArray(programs) || programs.length === 0) return false;

    const byChannel = new Map<string, EPGProgram[]>();
    for (const p of programs) {
      const cid = String(p.channelId ?? "").toLowerCase();
      if (!cid) continue;
      const list = byChannel.get(cid);
      if (list) list.push(p);
      else byChannel.set(cid, [p]);
    }
    // Both namespaces, because Stalker builds disagree about whether the bulk
    // response is keyed by the channel's `id` or its `epg_id`. Writing to both
    // and letting `merge` poison whichever collides is what makes guessing
    // safe: the namespace that is actually right stays intact, and the wrong
    // one only survives while nothing contradicts it.
    byChannel.forEach((list, cid) => this.merge([`id:${cid}`, `x:${cid}`], list, `mag:${cid}`));
    return byChannel.size > 0;
  }

  private async loadXtreamBulk(portal: Portal, allowLarge: boolean): Promise<boolean> {
    const base = String(portal.config.url || "").replace(/\/$/, "");
    if (!base || !portal.config.username) return false;
    const url =
      `${base}/xmltv.php?username=${encodeURIComponent(portal.config.username)}` +
      `&password=${encodeURIComponent(portal.config.password || "")}`;
    return this.loadXmltv(url, allowLarge);
  }

  private async loadM3uBulk(portal: Portal, allowLarge: boolean): Promise<boolean> {
    const api = new M3UApi({ url: portal.config.url, portalId: portal.id });
    const guideUrl = await api.getEpgUrl().catch(() => null);
    if (!guideUrl) return false;
    return this.loadXmltv(guideUrl, allowLarge);
  }

  /**
   * Fetches an XMLTV guide and folds it into the index.
   *
   * A national XMLTV feed runs to tens of megabytes, so nothing is kept that
   * the UI cannot use: programmes outside the ±window are dropped as they are
   * matched, and the source string is released before the index is published.
   */
  private async loadXmltv(url: string, allowLarge: boolean): Promise<boolean> {
    if (!allowLarge) {
      // A HEAD is cheap and saves pulling 60 MB onto a 1 GB box.
      try {
        const head = await axios.head(url, { timeout: 8000, validateStatus: () => true });
        const len = Number(head.headers?.["content-length"] || 0);
        if (len > XMLTV_SOFT_LIMIT_BYTES || len === 0) {
          // If server reports > 24MB or does not report content-length (chunked gzip feeds are typically 50-100MB),
          // skip bulk XMLTV to avoid OOM crash on Android.
          console.warn(
            `[EPG] XMLTV guide is ${len > 0 ? (len / 1048576).toFixed(0) + " MB" : "unbounded chunked stream"} — skipped to protect memory. ` +
            `Per-channel short EPG will be used instead.`
          );
          return false;
        }
      } catch (headErr) {
        console.warn("[EPG] XMLTV HEAD check failed, skipping bulk download to protect memory:", (headErr as any)?.message || headErr);
        return false;
      }
    }

    let xml: string;
    try {
      const maxBytes = allowLarge ? 48 * 1024 * 1024 : XMLTV_SOFT_LIMIT_BYTES;
      const res = await axios.get<string>(url, {
        timeout: 60000,
        responseType: "text",
        maxContentLength: maxBytes,
        maxBodyLength: maxBytes,
        transformResponse: [(d) => d],
        headers: { "User-Agent": "okhttp/3.12.1", "Accept-Encoding": "gzip" },
      });
      xml = typeof res.data === "string" ? res.data : "";
    } catch (e) {
      console.warn("[EPG] XMLTV fetch failed:", (e as any)?.message || e);
      return false;
    }
    if (!xml || xml.indexOf("<programme") === -1) return false;

    const matched = this.parseXmltv(xml);
    // Hand the source string back to the collector before anything else runs.
    xml = "";
    if (matched === 0) return false;
    this.emit();
    return true;
  }

  /** Returns how many channels gained programmes. */
  private parseXmltv(xml: string): number {
    const now = Date.now();
    const minStart = now - WINDOW_PAST_MS;
    const maxStart = now + WINDOW_FUTURE_MS;

    // channel id → display names, so a guide keyed by "bbc1.uk" still matches a
    // playlist channel that only knows itself as "BBC One".
    const displayNames = new Map<string, string[]>();
    const chRe = /<channel\b[^>]*\bid\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/channel>/g;
    let cm: RegExpExecArray | null;
    while ((cm = chRe.exec(xml)) !== null) {
      const id = cm[1];
      const names: string[] = [];
      const nameRe = /<display-name[^>]*>([\s\S]*?)<\/display-name>/g;
      let nm: RegExpExecArray | null;
      while ((nm = nameRe.exec(cm[2])) !== null) {
        const n = normalizeChannelName(decodeXmlText(nm[1]));
        if (n) names.push(n);
      }
      if (names.length) displayNames.set(id.toLowerCase(), names);
    }

    const byChannel = new Map<string, EPGProgram[]>();
    // Deliberately an `exec` loop rather than `match`/`matchAll`: a national
    // guide holds ~400k programme elements and materialising them all at once
    // is what makes a TV box run out of memory.
    const progRe = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
    let pm: RegExpExecArray | null;
    let kept = 0;
    while ((pm = progRe.exec(xml)) !== null) {
      const attrs = pm[1];
      const startAttr = /\bstart\s*=\s*"([^"]*)"/.exec(attrs);
      const stopAttr = /\bstop\s*=\s*"([^"]*)"/.exec(attrs);
      const chanAttr = /\bchannel\s*=\s*"([^"]*)"/.exec(attrs);
      if (!startAttr || !stopAttr || !chanAttr) continue;

      const start = parseXmltvTime(startAttr[1]);
      if (start < minStart || start > maxStart) continue;
      const end = parseXmltvTime(stopAttr[1]);
      if (!(end > start)) continue;

      const body = pm[2];
      const titleM = /<title[^>]*>([\s\S]*?)<\/title>/.exec(body);
      const descM = /<desc[^>]*>([\s\S]*?)<\/desc>/.exec(body);
      const cid = chanAttr[1];

      const program: EPGProgram = {
        id: `${cid}-${start}`,
        channelId: cid,
        title: decodeXmlText(titleM?.[1] || "") || "No title",
        description: decodeXmlText(descM?.[1] || ""),
        start,
        end,
      };

      const key = cid.toLowerCase();
      const list = byChannel.get(key);
      if (list) list.push(program);
      else byChannel.set(key, [program]);
      kept++;
    }

    if (kept === 0) return 0;

    byChannel.forEach((list, cid) => {
      const keys = [`x:${cid}`, `id:${cid}`];
      for (const n of displayNames.get(cid) || []) keys.push(`n:${n}`);
      this.merge(keys, list, `xmltv:${cid}`);
    });
    return byChannel.size;
  }

  // ── Per-channel guide ─────────────────────────────────────────────────────

  /**
   * Ensures the focused/tuned channel has a guide, fetching a short one if the
   * bulk pass did not cover it. Resolves to what is known either way, so
   * callers can render without branching on the fetch.
   */
  async ensureChannel(
    portal: Portal | null,
    channel: Channel | null | undefined
  ): Promise<NowNext> {
    if (!portal || !channel) return EMPTY_NOW_NEXT;

    const known = this.lookup(channel);
    if (known && known.length) {
      const last = known[known.length - 1];
      // Still covered for the next couple of hours — nothing to do.
      if (last.end > Date.now() + 2 * 60 * 60 * 1000) return this.nowNext(channel);
    }

    const cacheId = `${portal.id}:${channel.id}`;
    const negativeAt = this.negative.get(cacheId);
    if (negativeAt && Date.now() - negativeAt < NEGATIVE_TTL_MS) return this.nowNext(channel);

    const existing = this.inFlight.get(cacheId);
    if (existing) {
      await existing.catch(() => []);
      return this.nowNext(channel);
    }

    const task = this.runQueued(
      () => this.fetchShortEpg(portal, channel),
      () => [] as EPGProgram[]
    );
    this.inFlight.set(cacheId, task);
    try {
      const programs = await task;
      if (programs.length > 0) {
        this.merge(channelKeys(channel), programs, `ch:${channel.id}`);
        this.emit();
      } else {
        this.negative.set(cacheId, Date.now());
      }
    } catch {
      this.negative.set(cacheId, Date.now());
    } finally {
      this.inFlight.delete(cacheId);
    }
    return this.nowNext(channel);
  }

  /** Fire-and-forget warm-up for the tiles currently on screen. */
  prefetch(portal: Portal | null, channels: Channel[]) {
    if (!portal || channels.length === 0) return;
    for (const channel of channels) {
      const known = this.lookup(channel);
      if (known && known.length) continue;
      this.ensureChannel(portal, channel).catch(() => { });
    }
  }

  private runQueued<T>(job: () => Promise<T>, onDropped: () => T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.active++;
        job()
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            this.pump();
          });
      };

      if (this.active < SHORT_EPG_CONCURRENCY) {
        run();
        return;
      }

      this.queue.push({ run, drop: () => resolve(onDropped()) });

      // Scrolling a ten-thousand channel list enqueues a request per row it
      // passes. Without a cap the queue outlives the viewer's interest by
      // minutes and the portal is still being asked about channels they left
      // behind long ago — so the oldest waiting entries are dropped, resolving
      // with what is already known rather than hanging their callers.
      while (this.queue.length > MAX_PREFETCH_QUEUE) {
        const stale = this.queue.shift();
        stale?.drop();
      }
    });
  }

  /**
   * Starts whatever is waiting, newest first.
   *
   * Last-in-first-out rather than a fair queue: the newest entry is the row
   * nearest the cursor, and the oldest is somewhere the viewer scrolled past.
   * Serving the queue in arrival order would fill the banner for the wrong
   * channel while the one being looked at waited behind it.
   */
  private pump() {
    while (this.active < SHORT_EPG_CONCURRENCY) {
      const next = this.queue.pop();
      if (!next) return;
      next.run();
    }
  }

  private async fetchShortEpg(portal: Portal, channel: Channel): Promise<EPGProgram[]> {
    const cacheKey = `epg:short:${portal.id}:${channel.id}`;
    const cached = await cacheManager.get<EPGProgram[]>(cacheKey);
    if (cached && cached.length) {
      const last = cached[cached.length - 1];
      if (last.end > Date.now()) return cached;
    }

    let programs: EPGProgram[] = [];
    if (portal.type === "mag") {
      programs = await portalApi.getShortEpg(portal, String(channel.id), 12).catch(() => []);
    } else if (portal.type === "xtream") {
      const api = new XtreamApi({
        url: portal.config.url,
        username: portal.config.username || "",
        password: portal.config.password || "",
      });
      const raw = await api.getShortEpg(String(channel.id), 12).catch(() => null);
      programs = parseXtreamShortEpg(raw, String(channel.id));
    }
    // M3U has no per-channel endpoint — for it, it is XMLTV or nothing.

    if (programs.length) await cacheManager.set(cacheKey, programs, CACHE_TTL.EPG);
    return programs;
  }
}

/** Shape-tolerant reader for Xtream's `get_short_epg` payload. */
export function parseXtreamShortEpg(raw: any, channelId: string): EPGProgram[] {
  const rows: any[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.epg_listings)
      ? raw.epg_listings
      : Array.isArray(raw?.js)
        ? raw.js
        : [];

  const out: EPGProgram[] = [];
  for (const row of rows) {
    if (!row) continue;
    const start = toMillis(row.start_timestamp ?? row.start);
    const end = toMillis(row.stop_timestamp ?? row.end ?? row.stop);
    if (!start || !(end > start)) continue;

    // Xtream base64-encodes title/description; some forks do not. A value that
    // decodes to control characters was never encoded in the first place.
    const rawTitle = String(row.title ?? row.name ?? "");
    const rawDesc = String(row.description ?? row.descr ?? "");
    const decodedTitle = decodeBase64(rawTitle);
    const decodedDesc = decodeBase64(rawDesc);

    out.push({
      id: String(row.id ?? `${channelId}-${start}`),
      channelId: String(row.channel_id ?? channelId),
      title: (looksDecoded(decodedTitle) ? decodedTitle : rawTitle) || "No title",
      description: looksDecoded(decodedDesc) ? decodedDesc : rawDesc,
      start,
      end,
    });
  }
  return out;
}

/** Base64-decoding a string that was never encoded yields mojibake. */
function looksDecoded(s: string): boolean {
  if (!s) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // C0 controls (tab and newline aside) and U+FFFD are the tell-tale of a
    // decode that ran over text which was never base64 to begin with.
    if (c < 0x09 || (c > 0x0a && c < 0x20) || c === 0xfffd) return false;
  }
  return true;
}

export const epgService = new EpgServiceImpl();
export default epgService;
