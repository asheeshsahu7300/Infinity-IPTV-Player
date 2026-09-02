// ─────────────────────────────────────────────────────────────────────────────
// parentalControl — the PIN lock every set-top box ships with.
//
// Three things can be gated, and they are deliberately independent because
// households use them differently:
//
//   • channels    — an explicit list of locked channel ids, plus locked whole
//                   categories, plus an adult-keyword sweep that catches the
//                   XXX groups providers bury in the middle of a playlist.
//   • settings    — stops the lock being switched off by whoever it is for.
//   • portals     — stops a new (unfiltered) playlist being added around it.
//
// Entering the PIN opens a session window rather than unlocking one item, which
// is what STB firmware does: type it once and the next few minutes of channel
// surfing are not interrupted.
//
// The PIN is stored as a salted hash. This is not a secret worth defending
// against someone with the device in their hands and a file browser — it is
// there so the PIN is not sitting in plain text in app storage.
// ─────────────────────────────────────────────────────────────────────────────
import { safeStorage } from "./safeStorage";
import type { Channel } from "../store/portalStore";

const STORAGE_KEY = "parental_control_v1";

/** Factory PIN, the same one virtually every STB ships with. */
export const DEFAULT_PIN = "0000";

/** How long one successful entry keeps the lock open. */
const SESSION_MS = 15 * 60 * 1000;

export type LockScope = "playback" | "settings" | "portals";

/**
 * What is being locked.
 *
 * Ids are namespaced by kind because the three libraries number themselves
 * independently: Xtream stream 421 is a channel and movie 421 is a film, and an
 * un-namespaced lock list would hide one because the other was locked.
 */
export type MediaKind = "live" | "vod" | "series";

/** The shape every lockable thing shares. Channel, VODItem and Series all fit. */
export interface LockableItem {
  id: string;
  name: string;
  category?: string;
  categoryId?: string;
}

export interface ParentalState {
  enabled: boolean;
  /** Salted hash of the PIN — never the PIN itself. */
  pinHash: string;
  salt: string;
  /** Namespaced ids the user locked by hand, e.g. "vod:421". */
  lockedItemIds: string[];
  /** Namespaced category ids locked wholesale. */
  lockedCategoryIds: string[];
  /** Auto-lock anything whose name or category reads as adult content. */
  blockAdultKeywords: boolean;
  /** Which scopes the PIN guards. */
  scopes: Record<LockScope, boolean>;
}

/**
 * The groups providers actually use. Matched on word boundaries against the
 * channel name and its category, so "Maxxx Sports" is not caught by "xxx".
 */
const ADULT_PATTERNS = [
  /\bxxx\b/i,
  /\badult\b/i,
  /\bporn\b/i,
  /\berotic?\b/i,
  /\bplayboy\b/i,
  /\bhustler\b/i,
  /\bbrazzers\b/i,
  /\bvivid\b/i,
  /\bpenthouse\b/i,
  /\b18\+\s*$/,
  /\bfor\s+adults\b/i,
];

/** "vod:421" — see the note on MediaKind. */
function itemKey(kind: MediaKind, id: string): string {
  return `${kind}:${id}`;
}

const DEFAULT_STATE: ParentalState = {
  enabled: false,
  pinHash: "",
  salt: "",
  lockedItemIds: [],
  lockedCategoryIds: [],
  blockAdultKeywords: true,
  scopes: { playback: true, settings: false, portals: false },
};

/**
 * FNV-1a, iterated. Not a password KDF — see the header note. The iteration
 * count is there so a four-digit PIN is not recoverable from the hash by
 * eyeballing a rainbow table of ten thousand entries.
 */
function hashPin(pin: string, salt: string): string {
  let acc = `${salt}:${pin}`;
  for (let round = 0; round < 512; round++) {
    let h = 0x811c9dc5;
    for (let i = 0; i < acc.length; i++) {
      h ^= acc.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    acc = `${salt}:${(h >>> 0).toString(36)}:${round}`;
  }
  return acc;
}

function makeSalt(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
}

type Listener = (state: ParentalState) => void;

class ParentalControlImpl {
  private state: ParentalState = { ...DEFAULT_STATE, scopes: { ...DEFAULT_STATE.scopes } };
  private loaded = false;
  private loadPromise: Promise<ParentalState> | null = null;
  private listeners = new Set<Listener>();
  /** When the current unlock window expires. 0 when locked. */
  private sessionUntil = 0;

  // ── Persistence ───────────────────────────────────────────────────────────

  async load(): Promise<ParentalState> {
    if (this.loaded) return this.state;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      try {
        const raw = await safeStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          this.state = {
            ...DEFAULT_STATE,
            ...parsed,
            scopes: { ...DEFAULT_STATE.scopes, ...(parsed.scopes || {}) },
            lockedItemIds: Array.isArray(parsed.lockedItemIds) ? parsed.lockedItemIds : [],
            lockedCategoryIds: Array.isArray(parsed.lockedCategoryIds) ? parsed.lockedCategoryIds : [],
          };
        }
        // First run: seed the factory PIN so the feature can be switched on
        // without an enrolment flow, exactly as a boxed STB arrives.
        if (!this.state.pinHash) {
          this.state.salt = makeSalt();
          this.state.pinHash = hashPin(DEFAULT_PIN, this.state.salt);
        }
      } catch (e) {
        console.warn("[Parental] load failed:", e);
      } finally {
        this.loaded = true;
        this.loadPromise = null;
      }
      return this.state;
    })();

    return this.loadPromise;
  }

  private async persist() {
    try {
      await safeStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.warn("[Parental] save failed:", e);
    }
    this.listeners.forEach((l) => {
      try {
        l(this.state);
      } catch {
        /* one bad listener must not stop the rest */
      }
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Synchronous snapshot. Call `load()` once at boot before relying on it. */
  get snapshot(): ParentalState {
    return this.state;
  }

  get isEnabled(): boolean {
    return this.state.enabled;
  }

  // ── PIN ───────────────────────────────────────────────────────────────────

  /** True when the PIN has never been changed from the factory default. */
  get isDefaultPin(): boolean {
    if (!this.state.salt || !this.state.pinHash) return true;
    return this.state.pinHash === hashPin(DEFAULT_PIN, this.state.salt);
  }

  verifyPin(pin: string): boolean {
    if (!this.state.salt || !this.state.pinHash) return pin === DEFAULT_PIN;
    return hashPin(pin, this.state.salt) === this.state.pinHash;
  }

  async setPin(currentPin: string, nextPin: string): Promise<boolean> {
    await this.load();
    if (!this.verifyPin(currentPin)) return false;
    if (!/^\d{4,6}$/.test(nextPin)) return false;
    this.state.salt = makeSalt();
    this.state.pinHash = hashPin(nextPin, this.state.salt);
    await this.persist();
    return true;
  }

  // ── Unlock session ────────────────────────────────────────────────────────

  /** True while a recent correct PIN entry is still standing. */
  get isSessionUnlocked(): boolean {
    return Date.now() < this.sessionUntil;
  }

  /** Opens the unlock window if the PIN is right. */
  unlock(pin: string): boolean {
    if (!this.verifyPin(pin)) return false;
    this.sessionUntil = Date.now() + SESSION_MS;
    return true;
  }

  /** Closes the window immediately — used when leaving the player. */
  relock() {
    this.sessionUntil = 0;
  }

  // ── What is locked ────────────────────────────────────────────────────────

  /** True when this scope needs a PIN right now. */
  requiresPin(scope: LockScope): boolean {
    if (!this.state.enabled) return false;
    if (!this.state.scopes[scope]) return false;
    return !this.isSessionUnlocked;
  }

  /**
   * Whether an item is behind the lock at all — independent of the unlock
   * session, so a list keeps showing the padlock while playback is unlocked.
   */
  isRestricted(kind: MediaKind, item: LockableItem | null | undefined): boolean {
    if (!item || !this.state.enabled) return false;

    if (this.state.lockedItemIds.includes(itemKey(kind, String(item.id)))) return true;

    const catId = String(item.categoryId ?? "");
    if (catId && this.state.lockedCategoryIds.includes(itemKey(kind, catId))) return true;

    if (this.state.blockAdultKeywords) {
      const haystack = `${item.name ?? ""} ${item.category ?? ""}`;
      if (ADULT_PATTERNS.some((re) => re.test(haystack))) return true;
    }
    return false;
  }

  /** True when playing this item needs a PIN entered first. */
  isLocked(kind: MediaKind, item: LockableItem | null | undefined): boolean {
    if (!this.isRestricted(kind, item)) return false;
    if (!this.state.scopes.playback) return false;
    return !this.isSessionUnlocked;
  }

  // Channel-shaped conveniences. Live TV, the guide and the player all deal in
  // channels exclusively, and spelling the kind out at each of those call sites
  // adds nothing.
  isChannelRestricted(channel: Pick<Channel, "id" | "name" | "category" | "categoryId"> | null | undefined): boolean {
    return this.isRestricted("live", channel as LockableItem | null | undefined);
  }

  isChannelLocked(channel: Pick<Channel, "id" | "name" | "category" | "categoryId"> | null | undefined): boolean {
    return this.isLocked("live", channel as LockableItem | null | undefined);
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  async setEnabled(enabled: boolean) {
    await this.load();
    this.state.enabled = enabled;
    if (!enabled) this.relock();
    await this.persist();
  }

  async setScope(scope: LockScope, on: boolean) {
    await this.load();
    this.state.scopes = { ...this.state.scopes, [scope]: on };
    await this.persist();
  }

  async setBlockAdultKeywords(on: boolean) {
    await this.load();
    this.state.blockAdultKeywords = on;
    await this.persist();
  }

  /** Locks or unlocks one item. Returns the state it ended up in. */
  async toggleItem(kind: MediaKind, itemId: string): Promise<boolean> {
    await this.load();
    const key = itemKey(kind, String(itemId));
    const list = this.state.lockedItemIds;
    const at = list.indexOf(key);
    const nowLocked = at < 0;
    this.state.lockedItemIds = nowLocked
      ? [...list, key]
      : [...list.slice(0, at), ...list.slice(at + 1)];
    await this.persist();
    return nowLocked;
  }

  async toggleChannel(channelId: string): Promise<boolean> {
    return this.toggleItem("live", channelId);
  }

  async toggleCategory(kind: MediaKind, categoryId: string): Promise<boolean> {
    await this.load();
    const key = itemKey(kind, String(categoryId));
    const list = this.state.lockedCategoryIds;
    const at = list.indexOf(key);
    const nowLocked = at < 0;
    this.state.lockedCategoryIds = nowLocked
      ? [...list, key]
      : [...list.slice(0, at), ...list.slice(at + 1)];
    await this.persist();
    return nowLocked;
  }

  isCategoryLocked(kind: MediaKind, categoryId: string): boolean {
    return this.state.lockedCategoryIds.includes(itemKey(kind, String(categoryId)));
  }

  /** How many things are locked by hand, for the parental-control summary. */
  get manualLockCount(): number {
    return this.state.lockedItemIds.length + this.state.lockedCategoryIds.length;
  }

  async clearAllLocks() {
    await this.load();
    this.state.lockedItemIds = [];
    this.state.lockedCategoryIds = [];
    await this.persist();
  }
}

export const parentalControl = new ParentalControlImpl();
export default parentalControl;
