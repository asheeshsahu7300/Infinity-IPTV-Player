// ─────────────────────────────────────────────────────────────────────────────
// episodeMedia — the technical attributes buried in an episode's `info` block.
//
// This exists because the same derivation had been written out four times —
// three shapes in portalApi (a season dictionary, an array of episode objects,
// and a single episode returned bare) plus once in xtreamApi — and the copies
// had already drifted: the bare-episode variant dropped `info.still_path` from
// its fallback chain, so an episode arriving that way silently lost its still.
//
// Portals only ever hint at quality. There is no field that says "1080p"; there
// is a nested `info.video.width/height` on the panels that transcode, and
// nothing at all on the ones that do not. So this reads the resolution and maps
// it to a label, and returns undefined rather than guessing when the numbers
// are absent — a badge reading "720p HD" on a stream nobody measured is worse
// than no badge.
// ─────────────────────────────────────────────────────────────────────────────

export interface EpisodeMedia {
  /** "4K UHD" / "1080p FHD" / "720p HD", or undefined when unmeasured. */
  videoQuality?: string;
  /** Upper-cased ISO-ish tag, e.g. "ENG". Undefined for the "und" placeholder. */
  audioLanguage?: string;
  /**
   * The still, exactly as the portal wrote it.
   *
   * Left unresolved on purpose: MAG paths are relative and need the portal's
   * base URL prepended, while Xtream sends absolute URLs. Resolving here would
   * force one of those to be wrong, so each caller applies its own rule.
   */
  still?: string;
}

/** Resolution → label. Ordered widest-first so the first match wins. */
const QUALITY_TIERS: { minHeight: number; minWidth: number; label: string }[] = [
  { minHeight: 2160, minWidth: 3840, label: "4K UHD" },
  { minHeight: 1080, minWidth: 1920, label: "1080p FHD" },
  { minHeight: 720, minWidth: 1280, label: "720p HD" },
];

function readQuality(info: any): string | undefined {
  const width = Number(info?.video?.width || 0);
  const height = Number(info?.video?.height || 0);
  if (!width && !height) return undefined;
  for (const tier of QUALITY_TIERS) {
    if (height >= tier.minHeight || width >= tier.minWidth) return tier.label;
  }
  return undefined;
}

function readAudioLanguage(info: any): string | undefined {
  const raw = info?.audio?.tags?.language ?? info?.audio?.language;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  // "und" is ffprobe's "undetermined" — a value meaning the opposite of one.
  if (!trimmed || trimmed.toLowerCase() === "und") return undefined;
  return trimmed.toUpperCase();
}

/**
 * Pulls quality, audio language and the still out of an episode row.
 *
 * @param row the episode object itself, which may carry an `info` sub-object.
 *            Both levels are searched for the still, because MAG puts it on the
 *            row (`screenshot_uri`) and Xtream inside `info` (`movie_image`).
 */
export function readEpisodeMedia(row: any): EpisodeMedia {
  const info = row?.info;
  return {
    videoQuality: readQuality(info),
    audioLanguage: readAudioLanguage(info),
    still:
      info?.movie_image ??
      info?.cover_big ??
      info?.still_path ??
      row?.screenshot_uri ??
      row?.cover ??
      row?.pic ??
      undefined,
  };
}
