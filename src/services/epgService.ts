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
import pako from "pako";

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
/**
 * How long a cached guide stays usable.
 *
 * Six hours rather than the 30 minutes the per-channel cache uses: the window
 * this keeps is ±30h wide, so a six-hour-old copy still covers everything
 * anyone is looking at, and re-parsing forty thousand programmes to refresh it
 * is far more expensive than the staleness costs.
 */
const BULK_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/**
 * Target size for one piece of the cached guide.
 *
 * Kept well under Android's ~2 MB SQLite cursor window, which is the ceiling
 * on the AsyncStorage fallback — see persistIndex.
 */
const BULK_CACHE_CHUNK_BYTES = 1024 * 1024;
/**
 * How long to wait before retrying a guide that failed.
 *
 * Shorter than the success interval on purpose — see the note in loadBulk.
 * A portal with genuinely no guide therefore costs one request every few
 * minutes at worst, and only while a screen is actually asking for one.
 */
const BULK_RETRY_INTERVAL_MS = 3 * 60 * 1000;
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
    // Leading provider/country tag: "UK:", "US |", "[FR]", "IN - ".
    //
    // A hyphen counts only when whitespace follows it, and that lookahead is
    // load-bearing in both directions.
    //
    // Without it, a guide whose display names are shaped "IN - ASIANET
    // MOVIES" matches nothing at all: the tag survives and "in" is welded onto
    // the front of every key. Measured 0/11 against a real channel list
    // before, 7/16 after. (The measurement came from a third-party national
    // guide, back when one could be configured; providers tag their own names
    // the same way, so the rule still earns its place.)
    //
    // But a bare hyphen cannot be a separator either. It used to be, and it
    // destroyed real names: "SUN-TV" and "STAR-TV" both matched `[a-z]{2,3}`
    // plus "-" and normalised to "tv", so they shared a key and got each
    // other's schedule. The lookahead keeps both cases right — checked against
    // SUN-TV, STAR-TV, MTV-Hits, E-Entertainment and A-One, none of which move.
    .replace(/^\s*[\[(]?[a-z]{2,3}[\])]?\s*(?:[:|]|-(?=\s))\s*/i, "")
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

  return utf8Decode(bytes);
}

/**
 * Gunzips without holding the JS thread for the whole file.
 *
 * `pako.inflate(bytes, { to: "string" })` is one unbroken block of work. On a
 * 3.9 MB guide that inflates to 60 MB it measured 848 ms on a desktop, so ten
 * to twenty times that on a TV box — which is the frozen "Loading guide…"
 * screen, before the parser has even started.
 *
 * Pushing 256 KB at a time through pako's streaming inflater does the same work
 * in the same order but yields between blocks: measured at a 71 ms worst block
 * for byte-identical output. The peak memory is unchanged — the whole string
 * still exists at the end — this only stops it arriving in one stall.
 */
async function inflateInChunks(
  bytes: Uint8Array,
  onProgress?: (ratio: number) => void
): Promise<string> {
  const CHUNK = 256 * 1024;
  const inflator = new pako.Inflate({ to: "string" });

  for (let i = 0; i < bytes.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, bytes.length);
    inflator.push(bytes.subarray(i, end), end >= bytes.length);
    if (inflator.err) {
      console.warn("[EPG] gunzip failed:", inflator.msg || inflator.err);
      return "";
    }
    await new Promise((r) => setTimeout(r, 0));
    // Compressed bytes consumed, not output produced. Output is what the
    // caller cannot know in advance, and this is the ~10x expansion step, so
    // reporting input is both cheap and the only honest denominator.
    onProgress?.(end / bytes.length);
  }

  return typeof inflator.result === "string" ? inflator.result : "";
}

/**
 * Bytes → string, by hand.
 *
 * `TextDecoder` is not guaranteed on Hermes, so it cannot be used here. Shared
 * by the base64 decoder above and the XMLTV archive reader below, which both
 * end up holding raw bytes.
 */
function utf8Decode(bytes: ArrayLike<number>): string {
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

// ── Load progress ───────────────────────────────────────────────────────────

/**
 * Which part of a bulk load is running.
 *
 * A guide load is not one operation, it is five with wildly different costs:
 * a 3 MB download, a 38 MB inflate, a sweep over ~114,000 programmes, the
 * channel-key merge, and a six-chunk write. Reporting them separately is the
 * point — "Loading guide..." for forty seconds is what made this look hung,
 * because nothing on screen distinguished working from wedged.
 */
export type EpgLoadPhase =
  | "idle"
  | "checking"
  | "downloading"
  | "inflating"
  | "parsing"
  | "merging"
  | "saving"
  | "done"
  | "failed";

export interface EpgLoadProgress {
  phase: EpgLoadPhase;
  /**
   * How far through the *current phase*, 0..1 — or null when the total is not
   * knowable, which happens whenever a server omits content-length.
   *
   * Deliberately per-phase rather than overall: the phases cannot be weighed
   * against each other until the file has been read, so any single blended
   * number would be invented. Callers that want one bar can estimate from the
   * phase; callers that want the truth show the phase name.
   */
  ratio: number | null;
  /** Channels with programmes so far. */
  channels: number;
  /** Programmes kept so far — after the ±30h window filter, not raw. */
  programmes: number;
  /** Bytes downloaded so far, and the total when the server declared one. */
  bytes: number;
  totalBytes: number | null;
  /** Only set when phase is "failed". */
  error?: string;
}

const IDLE_PROGRESS: EpgLoadProgress = {
  phase: "idle",
  ratio: null,
  channels: 0,
  programmes: 0,
  bytes: 0,
  totalBytes: null,
};

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
  private progress: EpgLoadProgress = IDLE_PROGRESS;

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

  /** Where the current (or last) bulk load got to. See EpgLoadProgress. */
  get loadProgress(): EpgLoadProgress {
    return this.progress;
  }

  get channelCount(): number {
    return this.index.size;
  }

  /** Walks the index, so for summaries rather than for every render. */
  get programmeCount(): number {
    let n = 0;
    this.index.forEach((list) => {
      n += list.length;
    });
    return n;
  }

  /**
   * Progress rides the existing listener channel, which is debounced at 120 ms
   * — about eight updates a second. That matters: the parse loop reports every
   * 400 programmes, so an uncoalesced emit would cost hundreds of renders and
   * make the load slower than the stall it is reporting on.
   */
  private setProgress(next: Partial<EpgLoadProgress>) {
    this.progress = { ...this.progress, ...next };
    this.emit();
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

      const isFuzzyKey = key.startsWith("n:") || key.startsWith("x:");
      const currentOwner = this.keyOwner.get(key);
      if (currentOwner !== undefined && currentOwner !== owner) {
        if (!isFuzzyKey) {
          this.poisoned.add(key);
          this.keyOwner.delete(key);
          this.index.delete(key);
          continue;
        }
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

    // Single-flighted, except when forced.
    //
    // Returning the in-flight promise for a forced load looked right and was
    // wrong: Live TV kicks off a load on mount, so when someone then saved a
    // new XMLTV URL in Settings, the save adopted that already-running load —
    // which had read the *old* source before the save happened. It resolved,
    // the dialog reported success, and none of the newly chosen guide had been
    // fetched. A forced load waits the old one out and then does its own.
    if (this.bulkPromise) {
      if (!opts.force) return this.bulkPromise;
      await this.bulkPromise.catch(() => {});
    }
    if (!opts.force) {
      // "unavailable" means back off, not give up.
      //
      // This used to return unconditionally, so a single failed load disabled
      // the guide for the rest of the session: every later mount of Live TV or
      // the EPG screen bailed here, and only a portal switch or re-saving the
      // source in Settings could clear it. A failure is usually transient — a
      // dropped request, a portal hiccup, a source that was briefly 502 — and
      // far more likely to heal than a successful load is to go stale, so it
      // gets a shorter cooldown than "done" rather than a permanent one.
      if (
        this.bulkState === "unavailable" &&
        Date.now() - this.lastBulkAt < BULK_RETRY_INTERVAL_MS
      ) {
        return;
      }
      if (this.bulkState === "done" && Date.now() - this.lastBulkAt < BULK_MIN_INTERVAL_MS) return;
    }

    // Show what was cached first, then decide whether to refresh.
    //
    // Restoring is near-instant and gives every screen real data immediately;
    // a refresh behind it is invisible. Without this the choice was between a
    // blank guide and a ten-second stall on every launch.
    if (this.index.size === 0) {
      const savedAt = await this.restoreIndex(portal.id);
      if (savedAt > 0) {
        this.bulkState = "done";
        this.lastBulkAt = savedAt;
        this.emit();
        // Fresh enough to leave alone — the network is not touched at all.
        if (!opts.force && Date.now() - savedAt < BULK_MIN_INTERVAL_MS) return;
      }
    }

    this.bulkState = "loading";
    this.setProgress({ ...IDLE_PROGRESS, phase: "checking" });

    // Captured, because a portal switch mid-fetch resets everything: without
    // this the old portal's result would land on the new portal's state and
    // leave it marked "done" with an empty index.
    const forPortal = portal.id;

    this.bulkPromise = (async () => {
      try {
        let loaded = false;

        // The guide comes from the portal, and only from the portal.
        //
        // There was a custom XMLTV URL setting here that loaded a third-party
        // guide first and merged the portal's own on top. It is gone: matching
        // a stranger's channel names against a provider's channel list only
        // ever managed about half of them, and half a guide attached to the
        // wrong rows is worse than no guide, because nothing on screen tells
        // you which half you are looking at.
        if (portal.type === "mag") {
          const magLoaded = await this.loadMagBulk(portal);
          if (magLoaded) loaded = true;
        } else if (portal.type === "xtream") {
          const xtreamLoaded = await this.loadXtreamBulk(portal, opts.allowLargeXmltv === true);
          if (xtreamLoaded) loaded = true;
        } else if (portal.type === "m3u") {
          const m3uLoaded = await this.loadM3uBulk(portal, opts.allowLargeXmltv === true);
          if (m3uLoaded) loaded = true;
        }

        if (this.portalId !== forPortal) return;
        this.lastBulkAt = Date.now();
        this.bulkState = loaded ? "done" : "unavailable";
        if (loaded) await this.persistIndex(forPortal);

        this.setProgress({
          phase: loaded ? "done" : "failed",
          ratio: 1,
          channels: this.index.size,
          programmes: this.programmeCount,
          error: loaded
            ? undefined
            : "No programmes were found. Check the URL is an XMLTV file and is reachable.",
        });
      } catch (e) {
        console.warn("[EPG] bulk load failed:", (e as any)?.message || e);
        if (this.portalId === forPortal) this.bulkState = "unavailable";
        this.setProgress({
          phase: "failed",
          ratio: null,
          error: (e as any)?.message || "The guide could not be loaded.",
        });
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
  /**
   * Fetches an XMLTV guide and folds it into the index without blocking the UI thread.
   */
  private async loadXmltv(url: string, allowLarge: boolean): Promise<boolean> {
    if (!url) return false;

    this.setProgress({ phase: "checking", ratio: null });

    // Only skip if the server explicitly reports content-length > limit
    if (!allowLarge) {
      try {
        const head = await axios.head(url, { timeout: 8000, validateStatus: () => true });
        const len = Number(head.headers?.["content-length"] || 0);
        if (len > XMLTV_SOFT_LIMIT_BYTES) {
          console.warn(
            `[EPG] XMLTV guide is ${(len / 1048576).toFixed(0)} MB — skipped to protect memory. Enable Full XMLTV Guide in Settings to load.`
          );
          return false;
        }
      } catch {}
    }

    let xml: string;
    try {
      const maxBytes = allowLarge ? 64 * 1024 * 1024 : XMLTV_SOFT_LIMIT_BYTES;

      // A gzipped *file* is not the same thing as a gzipped *response*.
      //
      // `Accept-Encoding: gzip` covers transport compression, where the server
      // compresses an .xml body and the HTTP stack transparently inflates it.
      // It does nothing for a URL that ends .xml.gz, which is a gzip archive
      // served as application/gzip — reading that as text produces mojibake and
      // the parser then finds zero programmes and reports "no guide", silently.
      // Providers serve xmltv.php this way often enough to matter.
      //
      // So a .gz URL is fetched as bytes and inflated explicitly.
      const isArchive = /\.gz(\?|$)/i.test(url);

      // Reported per byte where the server declares a length.
      //
      // Not every one does, and RN's XHR does not reliably deliver incremental
      // progress for an arraybuffer response — hence a null ratio rather than
      // a fabricated number. The phase alone still earns its place: it is what
      // separates "downloading" from "wedged".
      const onDownloadProgress = (e: { loaded?: number; total?: number }) => {
        const total = e.total && e.total > 0 ? e.total : null;
        const loaded = e.loaded || 0;
        this.setProgress({
          phase: "downloading",
          ratio: total ? Math.min(1, loaded / total) : null,
          bytes: loaded,
          totalBytes: total,
        });
      };

      this.setProgress({ phase: "downloading", ratio: null, bytes: 0, totalBytes: null });

      if (isArchive) {
        const res = await axios.get<ArrayBuffer>(url, {
          timeout: 90000,
          responseType: "arraybuffer",
          maxContentLength: maxBytes,
          maxBodyLength: maxBytes,
          headers: { "User-Agent": "okhttp/3.12.1" },
          onDownloadProgress,
        });
        const bytes = new Uint8Array(res.data as ArrayBuffer);
        // Some servers send .gz already inflated by the transport layer, in
        // which case the body is plain XML and has no gzip magic number.
        const isGzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
        // utf8Decode rather than TextDecoder — see the note on that helper.
        if (isGzip) {
          this.setProgress({ phase: "inflating", ratio: 0 });
          xml = await inflateInChunks(bytes, (ratio) =>
            this.setProgress({ phase: "inflating", ratio })
          );
        } else {
          xml = utf8Decode(bytes);
        }
      } else {
        const res = await axios.get<string>(url, {
          timeout: 60000,
          responseType: "text",
          maxContentLength: maxBytes,
          maxBodyLength: maxBytes,
          transformResponse: [(d) => d],
          headers: { "User-Agent": "okhttp/3.12.1", "Accept-Encoding": "gzip" },
          onDownloadProgress,
        });
        xml = typeof res.data === "string" ? res.data : "";
      }
    } catch (e) {
      console.warn("[EPG] XMLTV fetch failed:", (e as any)?.message || e);
      return false;
    }
    if (!xml || xml.indexOf("<programme") === -1) return false;

    const matched = await this.parseXmltv(xml);
    xml = "";
    if (matched === 0) return false;
    this.emit();
    return true;
  }

  /** Returns how many channels gained programmes. Non-blocking parser for Hermes. */
  private async parseXmltv(xml: string): Promise<number> {
    const now = Date.now();
    const minStart = now - WINDOW_PAST_MS;
    const maxStart = now + WINDOW_FUTURE_MS;

    const displayNames = new Map<string, string[]>();

    // 1. Fast parse <channel> tags
    let chPos = 0;
    let chSeen = 0;
    while ((chPos = xml.indexOf("<channel", chPos)) !== -1) {
      // A national guide carries well over a thousand of these, each costing a
      // slice and two regexes. Without a yield the JS thread is held for the
      // whole sweep before the programme loop even starts.
      if (++chSeen % 250 === 0) {
        await new Promise((r) => setTimeout(r, 0));
        // No ratio here: <channel> tags cluster at the head of the file, so a
        // position-based fraction would read as 2% and then sit there.
        this.setProgress({ phase: "parsing", ratio: null, channels: displayNames.size });
      }

      const chEnd = xml.indexOf("</channel>", chPos);
      if (chEnd === -1) break;
      const block = xml.slice(chPos, chEnd + 10);
      chPos = chEnd + 10;

      const idMatch = /\bid\s*=\s*"([^"]*)"/i.exec(block);
      if (!idMatch) continue;
      const id = idMatch[1].toLowerCase().trim();

      const names: string[] = [];
      const nameRe = /<display-name[^>]*>([\s\S]*?)<\/display-name>/gi;
      let nm: RegExpExecArray | null;
      while ((nm = nameRe.exec(block)) !== null) {
        const n = normalizeChannelName(decodeXmlText(nm[1]));
        if (n && n.length >= MIN_NAME_KEY) names.push(n);
      }
      if (names.length) displayNames.set(id, names);
    }

    // 2. Fast parse <programme> tags without freezing event loop
    const byChannel = new Map<string, EPGProgram[]>();
    let pPos = 0;
    let count = 0;
    let kept = 0;

    while ((pPos = xml.indexOf("<programme", pPos)) !== -1) {
      const pEnd = xml.indexOf("</programme>", pPos);
      if (pEnd === -1) break;
      const tagClose = xml.indexOf(">", pPos);
      if (tagClose === -1 || tagClose > pEnd) {
        pPos += 10;
        continue;
      }

      // Yield on *iterations*, before any of the per-programme work.
      //
      // The counter used to sit at the bottom of the loop, past the window
      // filter's `continue`, so only kept programmes advanced it. A national
      // guide is ~114,000 programmes of which the ±30h window keeps maybe an
      // eighth — so roughly a hundred thousand iterations ran without ever
      // reaching the yield, and each gap between yields was thousands of
      // slices and regexes over a 60 MB string. That is the frozen
      // "Loading guide…" screen.
      if (++count % 400 === 0) {
        await new Promise((r) => setTimeout(r, 0));
        // pPos is the offset of the tag being read, so this is a genuine
        // fraction of the file — the one phase that can honestly report one.
        this.setProgress({
          phase: "parsing",
          ratio: xml.length > 0 ? Math.min(1, pPos / xml.length) : null,
          channels: byChannel.size,
          programmes: kept,
        });
      }

      const openTag = xml.slice(pPos, tagClose + 1);
      const bodyStart = tagClose + 1;
      pPos = pEnd + 12;

      const startAttr = /\bstart\s*=\s*"([^"]*)"/i.exec(openTag);
      const stopAttr = /\bstop\s*=\s*"([^"]*)"/i.exec(openTag);
      const chanAttr = /\bchannel\s*=\s*"([^"]*)"/i.exec(openTag);
      if (!startAttr || !stopAttr || !chanAttr) continue;

      const start = parseXmltvTime(startAttr[1]);
      if (start < minStart || start > maxStart) continue;
      const end = parseXmltvTime(stopAttr[1]);
      if (!(end > start)) continue;

      // Sliced only now that the programme is known to be inside the window.
      // Doing it up front allocated a substring for every one of the ~100,000
      // programmes that get discarded, purely to throw it away.
      const body = xml.slice(bodyStart, pEnd);

      const titleM = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body);
      const descM = /<desc[^>]*>([\s\S]*?)<\/desc>/i.exec(body);
      const cid = chanAttr[1];

      const program: EPGProgram = {
        id: `${cid}-${start}`,
        channelId: cid,
        title: decodeXmlText(titleM?.[1] || "") || "No title",
        description: decodeXmlText(descM?.[1] || ""),
        start,
        end,
      };

      const key = cid.toLowerCase().trim();
      const list = byChannel.get(key);
      if (list) list.push(program);
      else byChannel.set(key, [program]);
      kept++;
    }

    if (kept === 0) return 0;

    this.setProgress({
      phase: "merging",
      ratio: null,
      channels: byChannel.size,
      programmes: kept,
    });

    byChannel.forEach((list, cid) => {
      const keys = [`x:${cid}`, `id:${cid}`];
      for (const n of displayNames.get(cid) || []) {
        if (n && n.length >= MIN_NAME_KEY) keys.push(`n:${n}`);
      }
      const normCid = normalizeChannelName(cid);
      if (normCid && normCid.length >= MIN_NAME_KEY && !keys.includes(`n:${normCid}`)) {
        keys.push(`n:${normCid}`);
      }
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

  // ── Persistence ───────────────────────────────────────────────────────────
  //
  // Only the *per-channel* short EPG was ever cached. The bulk index — the one
  // that costs a 2.8 MB download, a 38 MB inflate and forty thousand parsed
  // programmes — lived in memory alone, so every cold start paid for it again
  // and every screen read "No guide data" until it finished. That is why the
  // guide only ever seemed to appear right after Save & Load Guide: that is the
  // one moment someone sits and waits for it.
  //
  // What gets written is the already-trimmed index: the ±30h window and the
  // 64-programmes-per-channel cap are applied before this, so it is a fraction
  // of the source file rather than a copy of it.

  private bulkCacheKey(portalId: string): string {
    // Keyed on the portal alone now that the portal is the only source. The
    // old keys carried a source segment and simply go unread, expiring on the
    // 6h TTL rather than needing a migration.
    return "epg:bulk:" + portalId;
  }

  /**
   * Writes the index in ~1 MB pieces rather than one blob.
   *
   * Measured, the trimmed India guide serialises to 4.21 MB. That is fine for
   * MMKV but not for the AsyncStorage fallback: Android's SQLite cursor window
   * is around 2 MB, so a single write that size is rejected — and it would be
   * rejected precisely on the devices running the fallback, which are the ones
   * that have not been natively rebuilt yet.
   *
   * Chunks are filled by serialised length rather than by a fixed channel
   * count, so a guide with long descriptions splits into more pieces instead of
   * overflowing. Same approach as portalPersistence.
   */
  private async persistIndex(portalId: string): Promise<void> {
    try {
      const base = this.bulkCacheKey(portalId);
      const chunks: [string, EPGProgram[]][][] = [];
      let current: [string, EPGProgram[]][] = [];
      let currentBytes = 0;

      this.index.forEach((programs, key) => {
        const entry: [string, EPGProgram[]] = [key, programs];
        const bytes = JSON.stringify(entry).length;
        if (current.length > 0 && currentBytes + bytes > BULK_CACHE_CHUNK_BYTES) {
          chunks.push(current);
          current = [];
          currentBytes = 0;
        }
        current.push(entry);
        currentBytes += bytes;
      });
      if (current.length) chunks.push(current);
      if (chunks.length === 0) return;

      // Pieces first, then the manifest — so a write that dies half way leaves
      // a manifest pointing at nothing rather than at a partial guide.
      for (let i = 0; i < chunks.length; i++) {
        this.setProgress({
          phase: "saving",
          ratio: chunks.length ? i / chunks.length : null,
        });
        await cacheManager.set(`${base}:${i}`, chunks[i], BULK_CACHE_TTL_MS);
      }
      await cacheManager.set(
        base,
        { savedAt: Date.now(), chunks: chunks.length },
        BULK_CACHE_TTL_MS
      );
    } catch (e) {
      // A guide that cannot be cached still works for this session.
      console.warn("[EPG] could not cache the guide:", (e as any)?.message || e);
    }
  }

  /**
   * Rebuilds the index from disk. Returns when it was written, or 0.
   *
   * Deliberately does not touch `keyOwner` or `poisoned`: those exist to catch
   * two channels colliding on one key *while merging*, and the stored index is
   * already the resolved outcome of that.
   */
  private async restoreIndex(portalId: string): Promise<number> {
    try {
      const base = this.bulkCacheKey(portalId);
      const manifest = await cacheManager.get<{ savedAt: number; chunks: number }>(base);
      if (!manifest?.chunks) return 0;

      // Programmes that have already finished are dead weight — dropped on the
      // way in rather than letting a stale cache pad the index.
      const cutoff = Date.now() - WINDOW_PAST_MS;
      let restored = 0;

      for (let i = 0; i < manifest.chunks; i++) {
        const chunk = await cacheManager.get<[string, EPGProgram[]][]>(`${base}:${i}`);
        // A missing piece means the write was interrupted or a chunk expired
        // separately. Half a guide filed under real keys is worse than none, so
        // the whole restore is abandoned.
        if (!chunk) {
          this.index.clear();
          return 0;
        }
        for (const [key, programs] of chunk) {
          const live = programs.filter((p) => p && p.end > cutoff);
          if (live.length) {
            this.index.set(key, live);
            restored += live.length;
          }
        }
        // Rebuilding several megabytes of objects is not free either.
        await new Promise((r) => setTimeout(r, 0));
      }

      return restored > 0 ? manifest.savedAt : 0;
    } catch {
      return 0;
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
      if (programs.length === 0 && channel.epgId && channel.epgId !== channel.id) {
        programs = await portalApi.getShortEpg(portal, String(channel.epgId), 12).catch(() => []);
      }
    } else if (portal.type === "xtream") {
      const api = new XtreamApi({
        url: portal.config.url,
        username: portal.config.username || "",
        password: portal.config.password || "",
      });
      const raw = await api.getShortEpg(String(channel.id), 12).catch(() => null);
      programs = parseXtreamShortEpg(raw, String(channel.id));
      if (programs.length === 0 && channel.epgId && channel.epgId !== channel.id) {
        const rawEpgId = await api.getShortEpg(String(channel.epgId), 12).catch(() => null);
        programs = parseXtreamShortEpg(rawEpgId, String(channel.id));
      }
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
