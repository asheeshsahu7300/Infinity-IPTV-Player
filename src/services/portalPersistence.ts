// src/services/portalPersistence.ts
//
// Chunked, size-capped persistence for a portal's content lists.
//
// AsyncStorage on Android is one SQLite database with a fixed size budget and a
// ~2MB ceiling per row, which is why a single `JSON.stringify(100_000 channels)`
// write silently fails. Bound and split it instead: a capped prefix of each list
// is stored across several rows, so a cold start paints real content immediately
// and the background sync fills in the remainder.
//
// `loadSlot` returns `null` when nothing is stored. That is deliberately
// distinct from `[]` — callers must never treat "no cache" as "no data", or a
// first run wipes whatever the network just delivered.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { safeStorage } from "./safeStorage";

export type PortalSlot = "channels" | "vod" | "series" | "categories";

const CHUNK_SIZE = 1500;

/** Per-slot item caps, chosen to keep the whole portal under ~4MB of storage. */
const CAPS: Record<PortalSlot, number> = {
  channels: 9000,
  vod: 4500,
  series: 3000,
  categories: 4000,
};

const metaKey = (portalId: string, slot: PortalSlot) => `portal:${portalId}:${slot}:meta`;
const chunkKey = (portalId: string, slot: PortalSlot, i: number) =>
  `portal:${portalId}:${slot}:c${i}`;
/** Pre-chunking single-key format. Still read so existing installs keep their data. */
const legacyKey = (portalId: string, slot: PortalSlot) => `portal:${portalId}:${slot}`;

interface SlotMeta {
  chunks: number;
  count: number;
  savedAt: number;
}

// Writes for the same slot must not interleave, or a slow large write can land
// after a fast small one and leave the meta row pointing at missing chunks.
const writeChains = new Map<string, Promise<unknown>>();

function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = writeChains.get(key) ?? Promise.resolve();
  const next = prev.then(task, task);
  writeChains.set(
    key,
    next.catch(() => {}).then(() => {
      if (writeChains.get(key) === next) writeChains.delete(key);
    })
  );
  return next;
}

async function readMeta(portalId: string, slot: PortalSlot): Promise<SlotMeta | null> {
  const raw = await safeStorage.getItem(metaKey(portalId, slot));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SlotMeta;
    return typeof parsed?.chunks === "number" ? parsed : null;
  } catch {
    return null;
  }
}

async function writeChunks<T>(
  portalId: string,
  slot: PortalSlot,
  items: T[],
  cap: number,
  staleChunks: number
): Promise<boolean> {
  const capped = items.length > cap ? items.slice(0, cap) : items;
  const pairs: [string, string][] = [];
  const chunks = Math.max(1, Math.ceil(capped.length / CHUNK_SIZE));

  for (let i = 0; i < chunks; i++) {
    pairs.push([
      chunkKey(portalId, slot, i),
      JSON.stringify(capped.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)),
    ]);
  }
  pairs.push([
    metaKey(portalId, slot),
    JSON.stringify({ chunks, count: capped.length, savedAt: Date.now() } satisfies SlotMeta),
  ]);

  try {
    await AsyncStorage.multiSet(pairs);
  } catch (err: any) {
    console.warn(`[portalPersistence] multiSet failed for ${slot}:`, err?.message || err);
    await safeStorage.handleSqliteFull();
    return false;
  }

  // Drop chunks left over from a previously longer list so a shrunken slot
  // cannot resurrect stale tail items on the next load.
  if (staleChunks > chunks) {
    const orphans: string[] = [];
    for (let i = chunks; i < staleChunks; i++) orphans.push(chunkKey(portalId, slot, i));
    await safeStorage.multiRemove(orphans);
  }

  return true;
}

/**
 * Persist `items` for `slot`. Empty lists are ignored — clearing a slot is
 * `clearSlot`'s job, so a failed refresh can never erase a good cache.
 */
export function saveSlot<T>(portalId: string, slot: PortalSlot, items: T[]): Promise<void> {
  if (!portalId || !Array.isArray(items) || items.length === 0) return Promise.resolve();

  const key = `${portalId}:${slot}`;
  return serialize(key, async () => {
    const prev = await readMeta(portalId, slot);
    const staleChunks = prev?.chunks ?? 0;
    const cap = CAPS[slot];

    if (await writeChunks(portalId, slot, items, cap, staleChunks)) return;

    // Retry once at a quarter of the cap. A smaller cache still beats a cold
    // start that has to wait on the network before showing anything.
    await writeChunks(portalId, slot, items, Math.max(200, Math.floor(cap / 4)), staleChunks);
  });
}

/** `null` means "nothing cached" — never conflate it with an empty list. */
export async function loadSlot<T>(portalId: string, slot: PortalSlot): Promise<T[] | null> {
  if (!portalId) return null;

  const meta = await readMeta(portalId, slot);

  if (!meta) {
    // Fall back to the pre-chunking single-key format.
    const raw = await safeStorage.getItem(legacyKey(portalId, slot));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.length > 0 ? (parsed as T[]) : null;
    } catch {
      return null;
    }
  }

  if (meta.count === 0) return null;

  const keys: string[] = [];
  for (let i = 0; i < meta.chunks; i++) keys.push(chunkKey(portalId, slot, i));

  let entries: readonly [string, string | null][];
  try {
    entries = await AsyncStorage.multiGet(keys);
  } catch (err: any) {
    console.warn(`[portalPersistence] multiGet failed for ${slot}:`, err?.message || err);
    return null;
  }

  const byKey = new Map(entries.map(([k, v]) => [k, v]));
  const out: T[] = [];
  for (const k of keys) {
    const raw = byKey.get(k);
    if (!raw) continue; // a missing chunk costs items, not the whole slot
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) out.push(...(parsed as T[]));
    } catch {
      /* skip corrupt chunk */
    }
  }

  return out.length > 0 ? out : null;
}

/** Timestamp of the last successful write, or 0. */
export async function slotSavedAt(portalId: string, slot: PortalSlot): Promise<number> {
  const meta = await readMeta(portalId, slot);
  return meta?.savedAt ?? 0;
}

export async function clearSlot(portalId: string, slot: PortalSlot): Promise<void> {
  const meta = await readMeta(portalId, slot);
  const keys = [metaKey(portalId, slot), legacyKey(portalId, slot)];
  for (let i = 0; i < (meta?.chunks ?? 0); i++) keys.push(chunkKey(portalId, slot, i));
  await safeStorage.multiRemove(keys);
}

export const PORTAL_SLOTS: PortalSlot[] = ["channels", "vod", "series", "categories"];
