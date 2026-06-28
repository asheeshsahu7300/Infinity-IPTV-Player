/**
 * True when a server-provided string is actually meaningful — i.e. not empty,
 * whitespace, or a common placeholder ("na", "n/a", "null", "-"). IPTV panels
 * frequently return these stand-ins instead of an absent field, so a plain
 * truthiness check isn't enough before deciding whether to show a description.
 */
export function hasMeaningfulText(value?: string | null): boolean {
  if (!value) return false;
  const t = String(value).trim().toLowerCase();
  return (
    t !== "" &&
    t !== "na" &&
    t !== "n/a" &&
    t !== "null" &&
    t !== "undefined" &&
    t !== "-"
  );
}
