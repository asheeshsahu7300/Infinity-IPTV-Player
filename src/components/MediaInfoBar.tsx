// ─────────────────────────────────────────────────────────────────────────────
// MediaInfoBar — the on-demand counterpart to ChannelInfoBar.
//
// Same idea, different facts. A channel banner answers "what is on"; a film
// banner answers "how far through am I and what is this". So the progress bar
// here is the viewer's own position rather than a programme's, and the line
// under the title is the episode or the synopsis rather than what is on next.
//
// It is a separate component rather than a mode of the channel banner because
// almost nothing survives the translation — number, logo, now/next and the
// clock all become elapsed, remaining, episode and poster.
// ─────────────────────────────────────────────────────────────────────────────
import React from "react";
import { StyleSheet, View } from 'react-native';
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";

import { THEME, ph, ps, pw } from "../theme/tokens";
import { isPhone } from "../utils/phoneUtils";
import type { QueueItem } from "../services/playbackQueue";
import { Film } from 'lucide-react-native';
import { Text } from './Text';


export interface MediaInfoBarProps {
  item: QueueItem | null | undefined;
  /** Milliseconds in. */
  position: number;
  /** Total milliseconds, or 0 when not yet known. */
  duration: number;
  /** "3 of 10" style position in the season. */
  queuePosition?: { index: number; total: number };
  /** Right-hand chips: quality, speed, and so on. */
  badges?: { label: string; tone?: "live" | "warn" | "muted" }[];
  /** What follows this, so the viewer knows before it arrives. */
  nextTitle?: string | null;
  hint?: string;
  /**
   * Drops this component's own horizontal padding and gradient so it can sit
   * inside the transport-control panel as its top half — see the matching note
   * in ChannelInfoBar.
   */
  inline?: boolean;
}

/** "1:24:31" / "24:31" — hours only when there are any. */
function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** "48 min left" — the number a viewer deciding whether to start actually wants. */
function remaining(position: number, duration: number): string {
  if (duration <= 0) return "";
  const mins = Math.max(0, Math.round((duration - position) / 60000));
  if (mins < 1) return "ending now";
  if (mins < 60) return `${mins} min left`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h left` : `${h}h ${m}m left`;
}

export const MediaInfoBar = React.memo(function MediaInfoBar({
  item,
  position,
  duration,
  queuePosition,
  badges,
  nextTitle,
  hint,
  inline,
}: MediaInfoBarProps) {
  if (!item) return null;

  const progress = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;

  return (
    <View style={[S.wrap, inline && S.wrapInline]}>
      {inline ? null : (
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.92)"]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      )}

      <View style={S.row}>
        {/* ── Poster ── */}
        <View style={S.posterBox}>
          {item.poster ? (
            <Image
              source={{ uri: item.poster }}
              style={S.poster}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={120}
            />
          ) : (
            <Film size={ps(1.8)} color="rgba(255,255,255,0.25)" />
          )}
        </View>

        {/* ── Detail ── */}
        <View style={S.detail}>
          <View style={S.titleRow}>
            <Text style={S.title} numberOfLines={1}>
              {item.title}
            </Text>
            {queuePosition && queuePosition.total > 1 ? (
              <View style={S.badge}>
                <Text style={S.badgeText}>
                  {queuePosition.index + 1} OF {queuePosition.total}
                </Text>
              </View>
            ) : null}
            {/* Keyed by position as well as label: two badges can legitimately
                read the same, and a component should not warn about how its
                caller chose to label things. */}
            {badges?.map((b, i) => (
              <View
                key={`${b.label}-${i}`}
                style={[S.badge, b.tone === "warn" && S.badgeWarn]}
              >
                <Text style={S.badgeText}>{b.label}</Text>
              </View>
            ))}
          </View>

          {item.subtitle ? (
            <Text style={S.subtitle} numberOfLines={1}>
              {item.subtitle}
            </Text>
          ) : null}

          {/* Only when this bar is standing on its own.
              Inside the transport panel there is already a scrubber directly
              below carrying the same position, duration and remaining time —
              two progress bars one line apart, which is what they looked like.
              With the controls hidden this is the only one there is, so it
              stays for that case. */}
          {inline ? null : (
            <>
              <View style={S.timeRow}>
                <Text style={S.time}>{clock(position)}</Text>
                <View style={S.progressTrack}>
                  <View style={[S.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
                </View>
                <Text style={S.time}>{duration > 0 ? clock(duration) : "--:--"}</Text>
              </View>

              {duration > 0 ? (
                <Text style={S.remaining}>{remaining(position, duration)}</Text>
              ) : null}
            </>
          )}

          {nextTitle ? (
            <Text style={S.nextLine} numberOfLines={1}>
              <Text style={S.nextLabel}>NEXT </Text>
              {nextTitle}
            </Text>
          ) : null}

          {hint ? (
            <Text style={S.hint} numberOfLines={1}>
              {hint}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
});

const S = StyleSheet.create({
  wrap: { paddingHorizontal: pw(4), paddingVertical: ph(2) },
  wrapInline: { paddingHorizontal: 0, paddingTop: 0, paddingBottom: isPhone ? 2 : ph(1) },
  // Bottom-aligned, not centred. The poster is much taller than the text
  // beside it, so centring left the title floating in the middle of the
  // artwork with nothing to line up against. Sitting on the poster's bottom
  // edge gives both a shared baseline.
  row: { flexDirection: "row", alignItems: "flex-end", gap: pw(1.8) },

  // Bigger than it was: the poster is the only artwork on the screen while
  // video is playing behind a scrim, and at ps(4.4) it read as a thumbnail
  // rather than as the thing being watched. A 2:3 ratio, which is how posters
  // are delivered.
  /*
   * Much smaller on a phone, because here the poster sets the height of the
   * whole bottom panel and the panel is competing with the transport buttons
   * for a 393dp-tall landscape viewport. At `ps(9.6)` it is 94dp — a quarter of
   * the screen — which pushed the title up across the play controls. 62 keeps
   * the 2:3 ratio and the artwork still reads.
   */
  posterBox: {
    width: isPhone ? 41 : ps(6.4),
    height: isPhone ? 62 : ps(9.6),
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.18)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  poster: { width: "100%", height: "100%" },

  detail: { flex: 1, gap: ph(0.5) },
  titleRow: { flexDirection: "row", alignItems: "center", gap: pw(0.8) },
  title: { color: "#fff", fontSize: ps(1.4), fontWeight: "800", flexShrink: 1 },
  subtitle: { color: "rgba(255,255,255,0.5)", fontSize: ps(1), fontWeight: "600" },

  badge: {
    paddingHorizontal: pw(0.8),
    paddingVertical: ph(0.35),
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  badgeWarn: { backgroundColor: "rgba(255,204,0,0.2)" },
  badgeText: { color: "#fff", fontSize: ps(0.7), fontWeight: "900", letterSpacing: 0.8 },

  timeRow: { flexDirection: "row", alignItems: "center", gap: pw(1), marginTop: ph(0.3) },
  time: {
    color: "rgba(255,255,255,0.7)",
    fontSize: ps(0.95),
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  progressTrack: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.16)",
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: "#F5F5F5" },

  remaining: { color: "rgba(255,255,255,0.42)", fontSize: ps(0.85), fontWeight: "600" },
  nextLine: { color: "rgba(255,255,255,0.5)", fontSize: ps(0.85), fontWeight: "600", flexShrink: 1 },
  nextLabel: { color: "rgba(255,255,255,0.32)", fontWeight: "900", letterSpacing: 1 },
  hint: { color: "rgba(255,255,255,0.3)", fontSize: ps(0.8), marginTop: ph(0.2) },
});

export default MediaInfoBar;
