// ─────────────────────────────────────────────────────────────────────────────
// playbackQueue — what plays after this, for on-demand content.
//
// The on-demand counterpart to liveChannelSession. Live TV has a channel list
// to zap through; a series has a season, and a set-top box treats the two the
// same way: the next thing is one button press away and the player never
// unloads to find it.
//
// Two behaviours separate it from the live session:
//
//   • it does not wrap. Channel 1 follows the last channel because a channel
//     list is a ring; episode 1 does not follow the finale.
//   • it advances on its own. An episode that ends rolls into the next one,
//     which is the whole reason anyone watches a season on a box. A film that
//     ends just ends.
//
// Like the live session this is deliberately plain module state: it belongs to
// the current act of watching, and routing a season through navigation params
// would serialise it on every screen transition.
// ─────────────────────────────────────────────────────────────────────────────
import type { Episode, VODItem } from "../store/portalStore";

export type QueueKind = "vod" | "episode";

export interface QueueItem {
  /** Stable, namespaced content id — the key resume positions are stored under. */
  id: string;
  title: string;
  /** "S2 · E5" for an episode, the category for a film. */
  subtitle?: string;
  seriesName?: string;
  episodeName?: string;
  poster?: string;
  /** The raw command or URL. Resolved to a playable URL at play time. */
  streamUrl: string;
  /**
   * MAG needs the episode number to build a stream URL for a series — the
   * season's command plus an index, rather than a command per episode.
   */
  episodeNum?: number;
  seasonNum?: number;
  description?: string;
  kind: QueueKind;
}

export interface PlaybackQueueState {
  items: QueueItem[];
  index: number;
  /** "Breaking Bad · Season 2", shown in the banner and the episode list. */
  title: string;
  portalId: string;
  /** Roll into the next item when one finishes. Episodes yes, films no. */
  autoAdvance: boolean;
}

let queue: PlaybackQueueState | null = null;

/** Builds a queue from a season's episode list. */
export function queueFromEpisodes(
  episodes: Episode[],
  seriesId: string,
  seriesName: string,
  seasonName: string,
  seasonCmd: string | undefined,
  poster: string | undefined
): QueueItem[] {
  return episodes.map((episode, idx) => {
    const epNum = episode.episodeNum || idx + 1;
    const epName = episode.name ? episode.name.trim() : "";
    const isGeneric =
      !epName ||
      epName.toLowerCase() === `episode ${epNum}`.toLowerCase() ||
      epName.toLowerCase() === `episode ${episode.episodeNum}`.toLowerCase() ||
      epName.toLowerCase() === `e${epNum}`.toLowerCase() ||
      epName.toLowerCase() === `${epNum}`.toLowerCase();

    // Primary Title: Series Name (so player header shows the show title!)
    const title = seriesName || (isGeneric ? `Episode ${epNum}` : epName);

    // Subtitle: e.g. "Season 3 · E1" or "Season 3 · E1 · Episode Name"
    const epLabel = isGeneric ? `Episode ${epNum}` : `E${epNum} · ${epName}`;
    const subtitle = seasonName ? `${seasonName} · ${epLabel}` : epLabel;

    return {
      id: `episode:${seriesId}:${episode.id}`,
      title,
      subtitle,
      seriesName,
      episodeName: isGeneric ? `Episode ${epNum}` : epName,
      poster,
      streamUrl: episode.streamUrl || episode.cmd || seasonCmd || "",
      episodeNum: epNum,
      seasonNum: episode.seasonNum,
      description: episode.description,
      kind: "episode" as const,
    };
  });
}

/** Builds a single-item queue for a film. */
export function queueFromVod(item: VODItem): QueueItem[] {
  return [
    {
      id: `vod:${item.id}`,
      title: item.name,
      subtitle: item.category,
      poster: item.logo,
      streamUrl: item.streamUrl || "",
      description: item.description,
      kind: "vod" as const,
    },
  ];
}

export const playbackQueue = {
  start(items: QueueItem[], index: number, title: string, portalId: string, autoAdvance: boolean) {
    queue = { items, index: Math.max(0, index), title, portalId, autoAdvance };
  },

  get current(): PlaybackQueueState | null {
    return queue;
  },

  get item(): QueueItem | null {
    if (!queue) return null;
    return queue.items[queue.index] ?? null;
  },

  get size(): number {
    return queue?.items.length ?? 0;
  },

  get index(): number {
    return queue?.index ?? 0;
  },

  get autoAdvance(): boolean {
    return queue?.autoAdvance ?? false;
  },

  get hasNext(): boolean {
    return !!queue && queue.index < queue.items.length - 1;
  },

  get hasPrevious(): boolean {
    return !!queue && queue.index > 0;
  },

  /**
   * Steps to the next or previous item. Returns null at either end rather than
   * wrapping — see the note at the top of the file.
   */
  step(delta: number): QueueItem | null {
    if (!queue) return null;
    const next = queue.index + delta;
    if (next < 0 || next >= queue.items.length) return null;
    queue.index = next;
    return queue.items[next];
  },

  jumpTo(index: number): QueueItem | null {
    if (!queue || index < 0 || index >= queue.items.length) return null;
    queue.index = index;
    return queue.items[index];
  },

  /**
   * True when this queue was started for the given content id or belongs to active series playback.
   */
  ownsItem(contentId: string | undefined | null): boolean {
    if (!queue || queue.items.length === 0) return false;
    if (!contentId) return true;
    const cleanId = String(contentId).trim();
    const foundIdx = queue.items.findIndex(
      (item) =>
        String(item.id) === cleanId ||
        String(item.id).endsWith(`:${cleanId}`) ||
        cleanId.endsWith(`:${item.id}`)
    );
    if (foundIdx >= 0) {
      queue.index = foundIdx;
      return true;
    }
    return queue.items[0]?.kind === "episode";
  },

  clear() {
    queue = null;
  },
};

export default playbackQueue;
