// ─────────────────────────────────────────────────────────────────────────────
// resumeIndex — how far through everything you are, readable synchronously.
//
// StreamManager already writes a resume position per title. What it cannot do
// is answer "how far through is this one?" while a grid of two hundred posters
// is rendering: its API is async, and a poster cannot await.
//
// So the whole set is read once into memory and kept there. It is small — one
// short record per title ever started, expired at thirty days by the writer —
// and it is what lets a partially-watched film carry a progress bar the way it
// does on a set-top box, and what lets the player know to offer "resume" rather
// than silently jumping.
// ─────────────────────────────────────────────────────────────────────────────
import { safeStorage } from "./safeStorage";
import type { PlaybackPosition } from "./StreamManager";

const KEY_PREFIX = "playback:";

/** Below this a title reads as "not really started". */
const MIN_PROGRESS_MS = 30000;
/** Within this of the end it reads as finished, not in progress. */
const END_MARGIN_MS = 60000;

export interface ResumeEntry {
  contentId: string;
  position: number;
  duration: number;
  /** 0–1. Zero when the duration was never known. */
  progress: number;
  timestamp: number;
}

type Listener = () => void;

class ResumeIndexImpl {
  private entries = new Map<string, ResumeEntry>();
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private listeners = new Set<Listener>();

  async load(force = false): Promise<void> {
    if (this.loaded && !force) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      try {
        const keys = (await safeStorage.getAllKeys()).filter((k) => k.startsWith(KEY_PREFIX));
        if (keys.length === 0) {
          this.entries.clear();
          return;
        }

        const pairs = await safeStorage.multiGet(keys);
        const next = new Map<string, ResumeEntry>();
        for (const [, raw] of pairs) {
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw) as PlaybackPosition;
            if (!parsed?.contentId || !(parsed.position > 0)) continue;
            next.set(parsed.contentId, {
              contentId: parsed.contentId,
              position: parsed.position,
              duration: parsed.duration,
              progress:
                parsed.duration > 0
                  ? Math.min(1, Math.max(0, parsed.position / parsed.duration))
                  : 0,
              timestamp: parsed.timestamp,
            });
          } catch {
            /* one unreadable record must not lose the rest */
          }
        }
        this.entries = next;
      } catch (e) {
        console.warn("[Resume] index load failed:", e);
      } finally {
        this.loaded = true;
        this.loadPromise = null;
        this.emit();
      }
    })();

    return this.loadPromise;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    this.listeners.forEach((l) => {
      try {
        l();
      } catch {
        /* one bad listener must not stop the rest */
      }
    });
  }

  /** Synchronous. Call `load()` once at boot before relying on it. */
  get(contentId: string): ResumeEntry | null {
    return this.entries.get(contentId) ?? null;
  }

  /** 0–1 through the title, or 0 when it has not been meaningfully started. */
  progressFor(contentId: string): number {
    const entry = this.entries.get(contentId);
    if (!entry || entry.position < MIN_PROGRESS_MS) return 0;
    return entry.progress;
  }

  /**
   * True when there is somewhere worth resuming to — far enough in to matter,
   * far enough from the end that resuming is not the same as replaying the
   * credits.
   */
  isResumable(contentId: string): boolean {
    const entry = this.entries.get(contentId);
    if (!entry) return false;
    if (entry.position < MIN_PROGRESS_MS) return false;
    if (entry.duration > 0 && entry.duration - entry.position < END_MARGIN_MS) return false;
    return true;
  }

  /**
   * Records a position locally without waiting for the write.
   *
   * The player saves through StreamManager every ten seconds; mirroring it here
   * keeps a grid the viewer backs out to showing the bar in the right place
   * rather than where it was when the screen mounted.
   */
  note(contentId: string, position: number, duration: number) {
    if (!contentId) return;
    this.entries.set(contentId, {
      contentId,
      position,
      duration,
      progress: duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0,
      timestamp: Date.now(),
    });
    this.emit();
  }

  forget(contentId: string) {
    if (this.entries.delete(contentId)) this.emit();
  }

  /** Everything in progress, most recently watched first. */
  continueWatching(): ResumeEntry[] {
    return Array.from(this.entries.values())
      .filter((e) => this.isResumable(e.contentId))
      .sort((a, b) => b.timestamp - a.timestamp);
  }
}

export const resumeIndex = new ResumeIndexImpl();
export default resumeIndex;
