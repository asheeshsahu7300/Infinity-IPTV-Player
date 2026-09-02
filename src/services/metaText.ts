// ─────────────────────────────────────────────────────────────────────────────
// metaText — normalising the free-text metadata fields portals hand back.
//
// Genre, cast and director arrive as loose strings with no agreed format: the
// separator may be a comma, a pipe or a slash, the field may be padded with
// empties, and "not available" is spelled a dozen ways. Both the Xtream and MAG
// layers had their own copy of this logic, and both had the same bug — so it
// lives in one place now.
// ─────────────────────────────────────────────────────────────────────────────

/** Every way the portals in the wild spell "nothing here". */
const PLACEHOLDER = /^(n\s*\/?\s*a|null|undefined|none|unknown|-+|0)$/i;

/**
 * True when a whole field means "absent" rather than carrying a value.
 *
 * Checked against the *whole* string before any splitting. That order is the
 * point: "N/A" contains a slash, so splitting first turned it into ["N", "A"],
 * and neither fragment matches a placeholder pattern any more — which is how a
 * genre of "N/A" ended up rendering as two chips reading "N" and "A".
 */
function isPlaceholder(value: string): boolean {
  return !value || PLACEHOLDER.test(value.trim());
}

/** A single text field, or undefined when the portal did not fill it in. */
export function cleanMetaText(value: any): string | undefined {
  if (typeof value !== "string") return undefined;
  const s = value.trim();
  return isPlaceholder(s) ? undefined : s;
}

/**
 * Splits a people/genre field into a list.
 *
 * Fragments shorter than two characters are dropped. Nothing in a genre or a
 * person's name is one character on its own, so anything that short is debris
 * from a separator that was really part of the text.
 */
export function splitMetaList(value: any): string[] | undefined {
  if (Array.isArray(value)) {
    const out = dedupe(value.map((v) => String(v).trim()).filter((s) => !isPlaceholder(s)));
    return out.length ? out : undefined;
  }

  if (typeof value !== "string") return undefined;
  const whole = value.trim();
  if (isPlaceholder(whole)) return undefined;

  const out = dedupe(
    whole
      .split(/[,|/;]/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && !isPlaceholder(s))
  );
  return out.length ? out : undefined;
}

/**
 * Layers one credit block over another, keeping whatever is actually filled in.
 *
 * A plain spread cannot be used here. The readers return an object with *every*
 * key present and the missing ones set to `undefined`, so `{...listRow,
 * ...detailCall}` blanks out a cast the list row did have wherever the detail
 * call happened to omit it. This only overwrites with values that exist.
 */
export function mergeMeta<T extends Record<string, any>>(
  base: T | null | undefined,
  override: T | null | undefined
): T {
  const out: Record<string, any> = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(override ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === "string" && !value.trim()) continue;
    out[key] = value;
  }
  return out as T;
}

/** Case-insensitive, order-preserving. Portals repeat genres freely. */
function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const k = item.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}
