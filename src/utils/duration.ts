// ─────────────────────────────────────────────────────────────────────────────
// duration — runtimes, in the one form a viewer can read at a glance.
//
// Portals disagree about the unit as much as about anything else. The same
// "duration" field arrives as:
//
//   • whole minutes      — MAG's `time`, "112"
//   • seconds            — Xtream's `duration_secs`, "6720"
//   • a clock string      — Xtream's `info.duration`, "01:52:00"
//   • already formatted   — some resellers send "1h 52m" or "112 min"
//
// So the unit is passed in wherever the caller knows it, which is at the parse
// site. `formatRuntime` guesses only as a last resort — for values already
// cached from before this existed — and the guess is documented below rather
// than hidden.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Above this, a bare number is read as seconds rather than minutes.
 *
 * The two units genuinely overlap and no rule is right every time: 400 could be
 * a 6h40m film or a 6m40s clip. The threshold sits where the error is least
 * bad — a catalogue full of 400-minute titles does not exist, while 400-second
 * clips do — and callers that know the unit never reach this.
 */
const MINUTES_CEILING = 600;

/** "1h 52m", "52m", or "1h" when it lands exactly on the hour. */
export function formatMinutes(totalMinutes: number): string | undefined {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return undefined;
  const mins = Math.round(totalMinutes);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatSeconds(totalSeconds: number): string | undefined {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return undefined;
  // Under a minute still deserves to say something rather than round to "0m".
  if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`;
  return formatMinutes(totalSeconds / 60);
}

/**
 * Whatever a portal put in a duration field → "1h 52m".
 *
 * Returns undefined for anything unreadable, so a caller renders no badge
 * rather than a badge containing junk.
 *
 * @param unit what the caller knows the value to be. "auto" guesses — see
 *             MINUTES_CEILING — and is only for values whose origin is lost.
 */
export function formatRuntime(
  value: string | number | null | undefined,
  unit: "minutes" | "seconds" | "auto" = "auto"
): string | undefined {
  if (value === null || value === undefined) return undefined;

  if (typeof value === "number") {
    if (unit === "seconds") return formatSeconds(value);
    if (unit === "minutes") return formatMinutes(value);
    return value > MINUTES_CEILING ? formatSeconds(value) : formatMinutes(value);
  }

  const raw = String(value).trim();
  if (!raw || /^(n\/?a|null|undefined|0)$/i.test(raw)) return undefined;

  // Already in a human form — leave it exactly as the provider wrote it.
  if (/\d\s*h/i.test(raw) || /\bmins?\b/i.test(raw) || /\bminutes?\b/i.test(raw)) {
    return raw;
  }

  // "01:52:00" or "52:00". Two parts are minutes:seconds, three are hours:mins:secs.
  if (raw.includes(":")) {
    const parts = raw.split(":").map((p) => Number(p.trim()));
    if (parts.some((n) => !Number.isFinite(n))) return undefined;
    const seconds =
      parts.length >= 3
        ? parts[0] * 3600 + parts[1] * 60 + parts[2]
        : parts[0] * 60 + (parts[1] || 0);
    return formatSeconds(seconds);
  }

  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return undefined;
  return formatRuntime(numeric, unit);
}
