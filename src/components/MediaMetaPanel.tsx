// ─────────────────────────────────────────────────────────────────────────────
// MediaMetaPanel — cast, director, genre and plot, for films and series alike.
//
// One component because the two detail screens were drifting: each had its own
// idea of how to lay out a credit line, and neither handled the case that
// actually dominates in IPTV — a provider that supplies almost none of it.
//
// The governing rule here is that **an absent field renders nothing at all**.
// No "Cast: N/A", no empty label, no placeholder row. Portals are wildly
// inconsistent about what they fill in, and a screen full of labels with
// nothing after them reads as a broken app rather than a thin catalogue.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useMemo } from "react";
import { StyleSheet, View } from 'react-native';

import { THEME, ph, ps, pw } from "../theme/tokens";
import type { MediaMeta } from "../store/portalStore";
import { Text } from './Text';


export interface MediaMetaPanelProps {
  meta?: MediaMeta | null;
  /**
   * The synopsis to show when `meta.plot` is absent — normally the item's
   * `description`. Skipped when it duplicates the plot.
   */
  fallbackPlot?: string;
  /** Cast names beyond this are dropped; a wall of extras helps nobody. */
  maxCast?: number;
  /** Lines of plot to show before truncating. */
  plotLines?: number;
  compact?: boolean;
  /**
   * Rendered when there is genuinely nothing else to show.
   *
   * Without this the panel returns null on a portal that supplies no credits —
   * which is most plain M3U playlists — and the detail sheet loses even its
   * synopsis line, looking emptier than before the panel existed. Callers that
   * already show a synopsis elsewhere (the episode sheet, whose series plot is
   * on the screen behind it) leave this unset and get the null.
   */
  emptyText?: string;
}

/** Drops the "no description available" placeholders the API layer inserts. */
function realText(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const s = value.trim();
  if (!s) return undefined;
  const lower = s.toLowerCase();
  if (lower.startsWith("no description available")) return undefined;
  if (lower === "n/a" || lower === "null" || lower === "undefined") return undefined;
  return s;
}

/**
 * One credit line: a small-caps label followed by its value, in one Text.
 *
 * It used to be a two-column row with a fixed-width label. That put the values
 * on a left edge of their own, indented away from the synopsis directly above
 * them — so nothing on the panel lined up with anything else. As an inline
 * prefix the label costs no column, every line starts at the same margin as the
 * plot, and long values wrap under themselves instead of into a narrow gutter.
 */
function Credit({ label, value }: { label: string; value: string }) {
  return (
    <Text style={S.credit} numberOfLines={2}>
      <Text style={S.creditLabel}>{label}  </Text>
      {value}
    </Text>
  );
}

export const MediaMetaPanel = React.memo(function MediaMetaPanel({
  meta,
  fallbackPlot,
  maxCast = 6,
  plotLines = 4,
  compact,
  emptyText,
}: MediaMetaPanelProps) {
  const plot = useMemo(() => {
    const own = realText(meta?.plot);
    const fallback = realText(fallbackPlot);
    if (!own || !fallback) return own ?? fallback;

    // `meta.plot` is the specific one and normally wins. The only reason to
    // look at the fallback at all is that portals frequently return the same
    // synopsis truncated in one field and whole in the other, so when one text
    // contains the other, take the fuller copy.
    //
    // Length alone is NOT a safe test, and using it was a bug: on the episode
    // sheet `own` is the episode's plot while the fallback is the *series*
    // blurb, which is longer nearly every time — so the episode plot was
    // silently discarded in favour of the show's description.
    const a = own.toLowerCase();
    const b = fallback.toLowerCase();
    if (a.includes(b) || b.includes(a)) {
      return own.length >= fallback.length ? own : fallback;
    }
    return own;
  }, [meta?.plot, fallbackPlot]);

  const cast = useMemo(() => {
    const list = (meta?.cast ?? []).map((c) => c.trim()).filter(Boolean);
    if (list.length === 0) return undefined;
    const shown = list.slice(0, maxCast).join(", ");
    return list.length > maxCast ? `${shown} +${list.length - maxCast} more` : shown;
  }, [meta?.cast, maxCast]);

  const tags = useMemo(() => {
    const list = (meta?.tags ?? []).map((t) => t.trim()).filter(Boolean);
    return list.length ? list.slice(0, 6) : undefined;
  }, [meta?.tags]);

  const director = realText(meta?.director);
  const country = realText(meta?.country);

  // Nothing to say. One honest line if the caller supplied one, otherwise
  // nothing at all — never an empty framed box or a row of bare labels.
  if (!plot && !cast && !tags && !director && !country) {
    return emptyText ? (
      <View style={[S.wrap, compact && S.wrapCompact]}>
        <Text style={S.plot} numberOfLines={plotLines}>
          {emptyText}
        </Text>
      </View>
    ) : null;
  }

  return (
    <View style={[S.wrap, compact && S.wrapCompact]}>
      {/* Genres as one plain line rather than a row of filled chips.
          Three or four capsules stacked under the facts line gave the
          containers more weight than the words, and made a piece of
          information look like a row of buttons you could press. */}
      {tags ? (
        <Text style={S.tags} numberOfLines={2}>
          {tags.join("  ·  ")}
        </Text>
      ) : null}

      {plot ? (
        <Text style={S.plot} numberOfLines={plotLines}>
          {plot}
        </Text>
      ) : null}

      {cast || director || country ? (
        <View style={S.credits}>
          {cast ? <Credit label="CAST" value={cast} /> : null}
          {director ? <Credit label="DIRECTOR" value={director} /> : null}
          {country ? <Credit label="COUNTRY" value={country} /> : null}
        </View>
      ) : null}
    </View>
  );
});

// Sized for a television read from a sofa, not a phone held at arm's length.
// Everything here was roughly a third smaller and sat in one undifferentiated
// block: the jump from the huge hero title straight down to body text at
// ps(0.9) left no middle of the hierarchy, and the whole panel read as fine
// print under the badges.
const S = StyleSheet.create({
  wrap: { gap: ph(1.6) },
  wrapCompact: { gap: ph(0.9) },

  tags: {
    color: "rgba(255,255,255,0.6)",
    fontSize: ps(1),
    fontWeight: "700",
    letterSpacing: 0.8,
  },

  plot: {
    color: "rgba(255,255,255,0.82)",
    fontSize: ps(1.2),
    // Generous leading: a four-line synopsis set tight is the hardest thing on
    // the screen to read across a room.
    lineHeight: ps(1.85),
  },

  // Grouped so the gap between the synopsis and the credits is larger than the
  // gap between the credit lines themselves — one block, not three loose rows.
  credits: { gap: ph(0.7) },
  credit: {
    color: "rgba(255,255,255,0.8)",
    fontSize: ps(1.05),
    fontWeight: "600",
    lineHeight: ps(1.6),
  },
  creditLabel: {
    color: "rgba(255,255,255,0.4)",
    fontSize: ps(0.85),
    fontWeight: "900",
    letterSpacing: 1.2,
  },
});

export default MediaMetaPanel;
