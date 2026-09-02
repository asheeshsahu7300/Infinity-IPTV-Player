// ─────────────────────────────────────────────────────────────────────────────
// hiddenCategories — the category hider every set-top box has.
//
// An IPTV portal typically ships several hundred categories, most of which a
// given household will never open: forty country-specific sports tiers, adult
// sections, test channels. Scrolling past them on every visit is the single
// most common complaint about a big playlist, and it is why box firmware has
// had a "hide category" toggle for as long as it has had categories.
//
// This is deliberately **not** the parental lock, and the difference matters:
//
//   • hiding is a convenience — the category is gone from the sidebar, and
//     anyone can unhide it in Settings without a PIN;
//   • locking is a restriction — the content stays visible but needs a PIN to
//     play, so the person it is aimed at can see that it exists.
//
// Conflating them would produce a lock anyone can switch off, or a tidying
// tool that demands a PIN. See [[parentalControl]] for the other one.
//
// Ids are namespaced by kind for the same reason the parental lock namespaces
// them: the three libraries number their categories independently, so a bare
// "12" would hide a film category and a channel category together.
// ─────────────────────────────────────────────────────────────────────────────
import { safeStorage } from "./safeStorage";
import type { MediaKind } from "./parentalControl";

const STORAGE_KEY = "hidden_categories_v1";

type Listener = () => void;

/** "vod:12" — see the note above. */
function key(kind: MediaKind, categoryId: string): string {
  return `${kind}:${categoryId}`;
}

class HiddenCategoriesImpl {
  private hidden = new Set<string>();
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private listeners = new Set<Listener>();

  async load(): Promise<void> {
    if (this.loaded) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      try {
        const raw = await safeStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            this.hidden = new Set(parsed.map((v) => String(v)));
          }
        }
      } catch (e) {
        console.warn("[HiddenCategories] load failed:", e);
      } finally {
        this.loaded = true;
        this.loadPromise = null;
        this.emit();
      }
    })();

    return this.loadPromise;
  }

  private async persist() {
    await safeStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(this.hidden)));
    this.emit();
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

  /** Synchronous, so a sidebar can filter while rendering. */
  isHidden(kind: MediaKind, categoryId: string | undefined | null): boolean {
    if (!categoryId) return false;
    return this.hidden.has(key(kind, String(categoryId)));
  }

  get count(): number {
    return this.hidden.size;
  }

  /** How many of one kind are hidden, for the Settings summary. */
  countFor(kind: MediaKind): number {
    const prefix = `${kind}:`;
    let n = 0;
    this.hidden.forEach((k) => {
      if (k.startsWith(prefix)) n++;
    });
    return n;
  }

  async toggle(kind: MediaKind, categoryId: string): Promise<boolean> {
    await this.load();
    const k = key(kind, String(categoryId));
    const nowHidden = !this.hidden.has(k);
    if (nowHidden) this.hidden.add(k);
    else this.hidden.delete(k);
    await this.persist();
    return nowHidden;
  }

  async setHidden(kind: MediaKind, categoryId: string, hidden: boolean): Promise<void> {
    await this.load();
    const k = key(kind, String(categoryId));
    if (hidden) this.hidden.add(k);
    else this.hidden.delete(k);
    await this.persist();
  }

  async showAll(kind?: MediaKind): Promise<void> {
    await this.load();
    if (!kind) {
      this.hidden.clear();
    } else {
      const prefix = `${kind}:`;
      Array.from(this.hidden).forEach((k) => {
        if (k.startsWith(prefix)) this.hidden.delete(k);
      });
    }
    await this.persist();
  }

  /**
   * Drops hidden categories from a list.
   *
   * "All" is never removed, whatever its id: hiding the one category that shows
   * everything would leave a sidebar with no way back to the full library.
   */
  filter<T extends { id: string; name?: string }>(kind: MediaKind, list: T[]): T[] {
    if (this.hidden.size === 0) return list;
    return list.filter((c) => {
      const id = String(c.id ?? "");
      if (!id || id === "all" || id.endsWith(":all")) return true;
      return !this.isHidden(kind, id);
    });
  }
}

export const hiddenCategories = new HiddenCategoriesImpl();
export default hiddenCategories;
