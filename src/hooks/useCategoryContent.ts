// src/hooks/useCategoryContent.ts
//
// Shared category-grid plumbing for the Live TV / VOD / Series screens.
//
// All three keep the portal's full item list in a ref, slice it per category
// into local state, and render that local state. That local copy is the problem
// this module solves: content arriving in the *store* after the screen mounted —
// the boot sync finishing, or a retry succeeding after the portal answered with
// an empty body — was invisible to the grid, so the screen kept showing "no
// items" until the user navigated away and back.

import React from "react";
import { Category } from "../store/portalStore";

/** Minimum shape the category filter needs. */
export interface CategorizedItem {
  id: string;
  category?: string;
  categoryId?: string;
}

/**
 * A category id with any portal prefix stripped.
 *
 * Category ids and the ids carried on items do not agree on shape: `xtreamApi`
 * builds its categories as `live:${category_id}` but puts the bare
 * `category_id` on every channel, and Stalker prefixes too. So any comparison
 * between a category and an item has to happen on this value.
 *
 * Exported because the guide learned that the hard way — it compared the two
 * raw, never matched, and fell through to labelling each category with its own
 * id, so the pills read as a row of numbers.
 */
export const bareCategoryId = (value: unknown): string => {
  const s = String(value ?? "").trim();
  const i = s.indexOf(":");
  return i >= 0 ? s.slice(i + 1) : s;
};

export const isAllCategory = (categoryId?: string): boolean => {
  if (!categoryId) return false;
  const s = String(categoryId).trim().toLowerCase();
  const raw = s.includes(":") ? s.split(":")[1] : s;
  return raw === "all" || raw === "*";
};

/**
 * Filter `items` to one category.
 *
 * Matches on `categoryId` first, then falls back to comparing the category
 * *name*: portals are inconsistent about whether a channel carries the genre id
 * or only its label, and Stalker additionally prefixes its ids (`live:42`).
 */
export function filterByCategory<T extends CategorizedItem>(
  items: T[],
  categoryId: string | undefined,
  categories: Category[] = []
): T[] {
  if (isAllCategory(categoryId)) return items;

  const target = String(categoryId || "").trim();
  if (!target) {
    return [];
  }

  const rawTarget = target.includes(":") ? target.split(":")[1] : target;
  const match = categories.find((c) => {
    const cId = String(c.id || "").trim();
    const rawCId = cId.includes(":") ? cId.split(":")[1] : cId;
    return cId === target || rawCId === rawTarget || cId === rawTarget;
  });
  const matchName = match?.name?.trim().toLowerCase();

  return items.filter((item) => {
    const rawCatId = item.categoryId != null ? String(item.categoryId).trim() : "";
    const cleanItemCatId = rawCatId.includes(":") ? rawCatId.split(":")[1] : rawCatId;

    // 1. If item has a categoryId, match STRICTLY on categoryId
    if (cleanItemCatId) {
      if (cleanItemCatId === rawTarget || rawCatId === target || cleanItemCatId === target) {
        return true;
      }
      // For M3U where categoryId might store the category title string
      if (matchName && cleanItemCatId.toLowerCase() === matchName) {
        return true;
      }
      return false;
    }

    // 2. Fallback to category name ONLY if item has no categoryId
    if (item.category) {
      const itemCatName = String(item.category).trim().toLowerCase();
      if (matchName && itemCatName === matchName) {
        return true;
      }
      if (itemCatName === target.toLowerCase() || itemCatName === rawTarget.toLowerCase()) {
        return true;
      }
    }

    return false;
  });
}

export interface AdoptStoreContentOptions<T extends CategorizedItem> {
  /** The store's full list for this content type. */
  storeItems: T[];
  /** The screen's cache of the portal's complete list. */
  cacheRef: React.MutableRefObject<T[]>;
  /** The screen's current category-filtered list. */
  fullListRef: React.MutableRefObject<T[]>;
  /** What the grid is rendering right now. */
  displayRef: React.MutableRefObject<T[]>;
  /** Current category id, by ref so adopting never re-runs on a category change. */
  categoryRef: React.MutableRefObject<string>;
  categories: Category[];
  pageSize?: number;
  /**
   * `true` for portals that serve everything in one request (Xtream, M3U), where
   * the screen slices a cached full list. `false` for Stalker/MAG, which
   * paginates server-side — there the store is only used as a last resort, so
   * adopting it cannot fight the server pagination.
   */
  slicesFullList: boolean;
  /** Called with the newly adopted slice. */
  onAdopt: (slice: T[], filteredTotal: number) => void;
}

/**
 * Adopts store content that lands after the screen has already rendered.
 *
 * Deliberately keyed off list *length*, not identity: the store emits on every
 * write, and re-slicing on each one would allocate a new array and re-render the
 * grid mid-scroll for no gain.
 */
export function useAdoptStoreContent<T extends CategorizedItem>({
  storeItems,
  cacheRef,
  fullListRef,
  displayRef,
  categoryRef,
  categories,
  pageSize,
  slicesFullList,
  onAdopt,
}: AdoptStoreContentOptions<T>): void {
  // Keep the non-primitive inputs in a ref so the effect depends only on the
  // store length — otherwise it fires on every parent render.
  const latest = React.useRef({
    cacheRef,
    fullListRef,
    displayRef,
    categoryRef,
    categories,
    pageSize,
    slicesFullList,
    onAdopt,
    storeItems,
  });
  latest.current = {
    cacheRef,
    fullListRef,
    displayRef,
    categoryRef,
    categories,
    pageSize,
    slicesFullList,
    onAdopt,
    storeItems,
  };

  React.useEffect(() => {
    const l = latest.current;
    if (l.storeItems.length === 0) return;

    if (l.slicesFullList) {
      // Nothing new to take.
      if (l.cacheRef.current.length >= l.storeItems.length) return;
      l.cacheRef.current = l.storeItems;
    } else if (l.displayRef.current.length > 0) {
      // MAG already has server-paginated results on screen — leave them alone.
      return;
    }

    const source = l.slicesFullList ? l.cacheRef.current : l.storeItems;
    const filtered = filterByCategory(source, l.categoryRef.current, l.categories);
    if (filtered.length === 0) return;

    l.fullListRef.current = filtered;
    const itemsToAdopt = l.pageSize ? filtered.slice(0, l.pageSize) : filtered;
    l.onAdopt(itemsToAdopt, filtered.length);
  }, [storeItems.length]);
}
