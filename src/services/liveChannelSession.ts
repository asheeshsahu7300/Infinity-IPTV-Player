// ─────────────────────────────────────────────────────────────────────────────
// liveChannelSession — the channel list the player is tuned into.
//
// Zapping is the defining set-top interaction: CH+ moves one channel, "1 0 2"
// jumps to 102, and neither may involve leaving the video. That needs the whole
// ordered list inside the player, and route params cannot carry it — a ten
// thousand channel list serialised into a URL is not a navigation payload.
//
// So Live TV hands the list over here on the way to the player, and the player
// reads it back. The session is deliberately plain module state: it belongs to
// the current act of watching, not to the store, and it must survive the
// navigation without provoking a re-render of every store subscriber.
// ─────────────────────────────────────────────────────────────────────────────
import { usePortalStore, type Channel } from "../store/portalStore";
import { safeStorage } from "./safeStorage";

const LAST_CHANNEL_KEY = "stb_last_channel";

export interface LiveSession {
  /** The ordered list the user was browsing — a category, or everything. */
  channels: Channel[];
  /** Index of the channel currently tuned. */
  index: number;
  /** Category the list came from, shown in the banner. */
  categoryName: string;
  /** Portal the list belongs to; a stale session must not survive a switch. */
  portalId: string;
  /** Complete list of all channels across the entire portal, with channel numbers. */
  allChannels?: Channel[];
}

let session: LiveSession | null = null;

/**
 * Numbers are assigned once, here, rather than derived at each call site.
 *
 * Providers are inconsistent: Xtream usually sends `num`, M3U sometimes sends
 * `tvg-chno`, MAG often sends nothing. A tuner that only worked on some portals
 * would be worse than none, so anything missing a number gets a positional one
 * and every channel in the list ends up dialable.
 */
export function assignChannelNumbers(channels: Channel[]): Channel[] {
  const used = new Set<number>();
  for (const c of channels) {
    if (c.num && c.num > 0) used.add(c.num);
  }

  let nextFree = 1;
  return channels.map((c) => {
    if (c.num && c.num > 0) return c;
    while (used.has(nextFree)) nextFree++;
    used.add(nextFree);
    return { ...c, num: nextFree };
  });
}

/**
 * id → channel number, built from the *complete* channel list.
 *
 * Numbers are assigned across everything rather than per category on purpose:
 * a channel that is 42 while browsing Sports and 7 while browsing All is not a
 * channel number, it is a row index, and dialling it would tune somewhere else
 * the moment the filter changed.
 */
export function buildChannelNumbers(channels: Channel[]): Map<string, number> {
  const map = new Map<string, number>();
  const used = new Set<number>();

  for (const c of channels) {
    if (c.num && c.num > 0 && !used.has(c.num)) {
      used.add(c.num);
      map.set(String(c.id), c.num);
    }
  }

  let nextFree = 1;
  for (const c of channels) {
    const id = String(c.id);
    if (map.has(id)) continue;
    while (used.has(nextFree)) nextFree++;
    used.add(nextFree);
    map.set(id, nextFree);
  }

  return map;
}

/** Applies a number map to a list, leaving channels that already have one. */
export function withChannelNumbers(
  channels: Channel[],
  numbers: Map<string, number>
): Channel[] {
  return channels.map((c) =>
    c.num && c.num > 0 ? c : { ...c, num: numbers.get(String(c.id)) }
  );
}

export const liveChannelSession = {
  /** Called by Live TV as it launches the player. */
  start(
    channels: Channel[],
    index: number,
    categoryName: string,
    portalId: string,
    allChannels?: Channel[]
  ) {
    session = { channels, index, categoryName, portalId, allChannels };
  },

  get current(): LiveSession | null {
    return session;
  },

  /** The channel now tuned, or null when there is no session. */
  get channel(): Channel | null {
    if (!session) return null;
    return session.channels[session.index] ?? null;
  },

  get size(): number {
    return session?.channels.length ?? 0;
  },

  /** True when zapping is possible — i.e. there is more than one channel. */
  get canZap(): boolean {
    return (session?.channels.length ?? 0) > 1;
  },

  /**
   * Steps `delta` channels, wrapping at both ends.
   *
   * Wrapping is deliberate: on a set-top box CH+ from the last channel returns
   * to the first, and stopping dead at the end of the list reads as a fault.
   */
  step(delta: number): Channel | null {
    if (!session || session.channels.length === 0) return null;
    const size = session.channels.length;
    session.index = ((session.index + delta) % size + size) % size;
    return session.channels[session.index];
  },

  /** Tunes an exact channel number, or returns null when nothing matches. */
  tuneToNumber(num: number): Channel | null {
    if (!session) return null;
    const at = session.channels.findIndex((c) => c.num === num);
    if (at < 0) return null;
    session.index = at;
    return session.channels[at];
  },

  /**
   * Finds a channel by its dialled number across the session and the entire portal.
   */
  findByNumber(num: number): { channel: Channel; index: number; isFromAll: boolean } | null {
    if (session && session.channels.length > 0) {
      const idx = session.channels.findIndex((c) => c.num === num);
      if (idx >= 0) {
        return { channel: session.channels[idx], index: idx, isFromAll: false };
      }
    }
    // Search all channels pool
    const pool = session?.allChannels && session.allChannels.length > 0
      ? session.allChannels
      : usePortalStore.getState().channels;
    const allIdx = pool.findIndex((c) => c.num === num);
    if (allIdx >= 0) {
      return { channel: pool[allIdx], index: allIdx, isFromAll: true };
    }
    return null;
  },

  /**
   * Adopts a channel from outside the current category into the active session
   * so subsequent zapping (CH+/CH-) and info bar readouts work seamlessly.
   */
  adoptChannel(channel: Channel): number {
    if (!session) return 0;
    const existing = session.channels.findIndex((c) => String(c.id) === String(channel.id));
    if (existing >= 0) {
      session.index = existing;
      return existing;
    }
    if (session.allChannels && session.allChannels.length > 0) {
      session.channels = session.allChannels;
      const allIdx = session.channels.findIndex((c) => String(c.id) === String(channel.id));
      session.index = Math.max(0, allIdx);
      return session.index;
    }
    session.channels.push(channel);
    session.index = session.channels.length - 1;
    return session.index;
  },

  /** Tunes by id — used when the channel list overlay is clicked through. */
  tuneToId(id: string): Channel | null {
    if (!session) return null;
    const at = session.channels.findIndex((c) => String(c.id) === String(id));
    if (at < 0) return null;
    session.index = at;
    return session.channels[at];
  },

  /**
   * True when this session was started for the given channel.
   *
   * The session is module state that outlives the player, so a screen opened
   * from Search or a deep link would otherwise inherit whatever list Live TV
   * left behind — showing the wrong channel in the banner and zapping into an
   * unrelated category. Entry points that did not start a session simply do not
   * match, and lose zapping rather than getting it wrong.
   */
  ownsChannel(contentId: string | undefined | null): boolean {
    if (!session || !contentId) return false;
    return String(session.channels[session.index]?.id) === String(contentId);
  },

  /** Whether a number could match something if more digits arrive. */
  hasNumberPrefix(prefix: number): boolean {
    const asText = String(prefix);
    if (session?.channels.some((c) => String(c.num ?? "").startsWith(asText))) {
      return true;
    }
    const pool = session?.allChannels && session.allChannels.length > 0
      ? session.allChannels
      : usePortalStore.getState().channels;
    return pool.some((c) => String(c.num ?? "").startsWith(asText));
  },

  /** Drops the session — a portal switch must not leave a stale list behind. */
  clear() {
    session = null;
  },

  /** Records the tuned channel so the box can return to it on next launch. */
  async rememberLastChannel(channel: Channel, portalId: string) {
    try {
      await safeStorage.setItem(
        LAST_CHANNEL_KEY,
        JSON.stringify({ id: String(channel.id), portalId, at: Date.now() })
      );
    } catch {
      /* a failed write only costs the resume, never playback */
    }
  },

  async getLastChannelId(portalId: string): Promise<string | null> {
    try {
      const raw = await safeStorage.getItem(LAST_CHANNEL_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?.portalId !== portalId) return null;
      return typeof parsed.id === "string" ? parsed.id : null;
    } catch {
      return null;
    }
  },
};

export default liveChannelSession;
