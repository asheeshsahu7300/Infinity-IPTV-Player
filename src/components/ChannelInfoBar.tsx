// ─────────────────────────────────────────────────────────────────────────────
// ChannelInfoBar — the banner a set-top box drops in on every channel change.
//
// One component, two homes: it sits at the foot of the Live TV grid tracking
// whatever tile is focused, and it overlays the video in the player tracking
// whatever is tuned. Those are the same piece of information, so they are the
// same component rather than two that drift apart.
//
// Layout follows the convention every STB shares, because it is what a viewer
// already knows how to read: number and logo on the left, what is on now with a
// progress bar through the middle, what is on next underneath, and the clock in
// the corner.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from 'react-native';
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";

import { THEME, ph, ps, pw } from "../theme/tokens";
import { NowNext } from "../services/epgService";
import { stbEnvironment } from "../services/stbEnvironment";
import type { Channel } from "../store/portalStore";
import { Lock, Tv } from 'lucide-react-native';
import { Text } from './Text';
import { RADIUS } from '../theme/materials';
import * as P from '../theme/palette';


export interface ChannelInfoBarProps {
  channel: Channel | null | undefined;
  nowNext: NowNext;
  /**
   * "player" overlays video and paints its own heavier scrim; "screen" sits on
   * the app background.
   *
   * "inline" is for sitting inside another panel — it drops this component's
   * own horizontal padding and background gradient so the host's insets and
   * scrim apply instead, which is what makes the banner and the transport
   * controls line up on both edges rather than reading as two stacked bands.
   */
  variant?: "player" | "screen" | "inline";
  /** Locked channels show a padlock instead of a logo. */
  locked?: boolean;
  /** Right-hand status chips: LIVE, quality, reconnecting, and so on. */
  badges?: { label: string; tone?: "live" | "warn" | "muted" }[];
  /** Extra hint line under the banner — the tuner and key hints use it. */
  hint?: string;
}

/** "20:00 - 21:00", honouring the box's 12/24-hour setting. */
function timeRange(startMs: number, endMs: number): string {
  return `${stbEnvironment.formatClock(startMs)} - ${stbEnvironment.formatClock(endMs)}`;
}

/** "34 min left" — what a viewer actually wants from a progress bar. */
function remaining(endMs: number): string {
  const mins = Math.max(0, Math.round((endMs - Date.now()) / 60000));
  if (mins < 1) return "ending now";
  if (mins < 60) return `${mins} min left`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h left` : `${h}h ${m}m left`;
}

/** Ticks once a minute so the clock in the corner is not frozen. */
function useClock(): string {
  const [now, setNow] = useState(() => stbEnvironment.formatClock());
  useEffect(() => {
    const id = setInterval(() => setNow(stbEnvironment.formatClock()), 20000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export const ChannelInfoBar = React.memo(function ChannelInfoBar({
  channel,
  nowNext,
  variant = "screen",
  locked = false,
  badges,
  hint,
}: ChannelInfoBarProps) {
  const clock = useClock();
  if (!channel) return null;

  const { now, next, progress } = nowNext;
  const isPlayer = variant === "player" || variant === "inline";
  const isInline = variant === "inline";

  return (
    <View style={[S.wrap, isPlayer && S.wrapPlayer, isInline && S.wrapInline]}>
      {/* No scrim when inline: the host panel already paints one, and two
          stacked gradients produce a visible seam across the picture. */}
      {isPlayer && !isInline && (
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.92)"]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      )}

      <View style={S.row}>
        {/* ── Channel number + logo ── */}
        <View style={S.identity}>
          <View style={S.numberBox}>
            <Text style={S.numberText}>{channel.num ?? "—"}</Text>
          </View>
          <View style={S.logoBox}>
            {locked ? (
              <Lock size={ps(2.4)} color={P.secondaryLabel} />
            ) : channel.logo ? (
              <Image
                source={{ uri: channel.logo }}
                style={S.logo}
                contentFit="contain"
                cachePolicy="memory-disk"
                transition={120}
              />
            ) : (
              <Tv size={ps(2.4)} color={P.tertiaryLabel} />
            )}
          </View>
        </View>

        {/* ── Now / next ── */}
        <View style={S.detail}>
          <View style={S.titleRow}>
            <Text style={S.channelName} numberOfLines={1}>
              {channel.name}
            </Text>
            {/* Keyed by position as well as label: two badges can legitimately
                read the same, and a component should not warn about how its
                caller chose to label things. */}
            {badges?.map((b, i) => (
              <View
                key={`${b.label}-${i}`}
                style={[
                  S.badge,
                  b.tone === "live" && S.badgeLive,
                  b.tone === "warn" && S.badgeWarn,
                ]}
              >
                {b.tone === "live" && <View style={S.liveDot} />}
                <Text style={S.badgeText}>{b.label}</Text>
              </View>
            ))}
            <Text style={S.clock}>{clock}</Text>
          </View>

          {now ? (
            <>
              <View style={S.nowRow}>
                <Text style={S.nowTime}>{timeRange(now.start, now.end)}</Text>
                <Text style={S.nowTitle} numberOfLines={1}>
                  {now.title}
                </Text>
                <Text style={S.remaining}>{remaining(now.end)}</Text>
              </View>
              <View style={S.progressTrack}>
                <View style={[S.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
              </View>
            </>
          ) : (
            <Text style={S.noGuide} numberOfLines={1}>
              No guide data for this channel
            </Text>
          )}

          {next ? (
            <Text style={S.nextLine} numberOfLines={1}>
              <Text style={S.nextLabel}>NEXT </Text>
              {stbEnvironment.formatClock(next.start)}  {next.title}
            </Text>
          ) : null}

          {hint ? <Text style={S.hint} numberOfLines={1}>{hint}</Text> : null}
        </View>
      </View>
    </View>
  );
});

const S = StyleSheet.create({
  wrap: {
    paddingHorizontal: pw(2),
    paddingVertical: ph(1.2),
    borderTopWidth: 1,
    borderTopColor: P.glassEdgeSoft,
    // The "screen" variant sits on the app background rather than over video,
    // so it needs a ground of its own. Apple's elevated background, which is
    // the colour a raised container takes on a dark ground — `#151512` before,
    // a warm near-black that belonged to the old cinema palette.
    backgroundColor: P.elevatedSystemBackground,
  },
  // Inherits the host's horizontal inset and scrim; see the `variant` note.
  wrapInline: { paddingHorizontal: 0, paddingTop: 0, paddingBottom: ph(1) },
  wrapPlayer: {
    borderTopWidth: 0,
    backgroundColor: "transparent",
    paddingHorizontal: pw(4),
    paddingVertical: ph(2),
  },

  row: { flexDirection: "row", alignItems: "center", gap: pw(1.6) },

  identity: { flexDirection: "row", alignItems: "center", gap: pw(1) },
  numberBox: {
    minWidth: ps(3.8),
    height: ps(5.4),
    paddingHorizontal: pw(0.8),
    borderRadius: RADIUS.sm,
    borderCurve: "continuous",
    backgroundColor: P.tertiarySystemFill,
    borderWidth: 1,
    borderColor: P.glassEdgeSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  numberText: {
    fontFamily: THEME.fonts.bold,
    // The channel number is the thing a viewer dials by, so it is the one
    // thing on this banner given full emphasis — `label` and bold, against the
    // `secondaryLabel` everything else around it sits at.
    //
    // Emphasis here is weight and brightness rather than hue, because the
    // accent is achromatic: there is no colour to spend, so the hierarchy has
    // to be carried by the two axes that are left.
    color: P.label,
    fontSize: ps(1.6),
    letterSpacing: 1,
    fontVariant: ["tabular-nums"],
  },
  // Matched to the grid card's treatment: the logo is what identifies the
  // channel, so it gets room. The box keeps a roughly 16:9 shape because that
  // is how most provider logos are delivered, and contentFit="contain"
  // letterboxes the square ones rather than cropping them.
  logoBox: {
    width: ps(8.8),
    height: ps(5.4),
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS.sm,
    borderCurve: "continuous",
    backgroundColor: P.quaternarySystemFill,
    borderWidth: 1,
    borderColor: P.glassEdgeSoft,
  },
  logo: { width: "95%", height: "95%" },

  detail: { flex: 1, gap: ph(0.5) },
  titleRow: { flexDirection: "row", alignItems: "center", gap: pw(0.8) },
  channelName: {
    color: P.label,
    fontSize: ps(1.3),
    fontFamily: THEME.fonts.semibold,
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  clock: {
    marginLeft: "auto",
    color: P.secondaryLabel,
    fontSize: ps(1.05),
    letterSpacing: 0.2,
    fontVariant: ["tabular-nums"],
  },

  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(0.35),
    paddingHorizontal: pw(0.7),
    paddingVertical: ph(0.25),
    borderRadius: RADIUS.full,
    backgroundColor: P.tertiarySystemFill,
  },
  // systemRed and systemOrange at low alpha, rather than the two hand-mixed
  // reds and ambers these were. The LIVE dot is the full-strength colour,
  // since a 6dp dot has no room to say anything at reduced alpha.
  badgeLive: { backgroundColor: "rgba(255, 69, 58, 0.22)" },
  badgeWarn: { backgroundColor: "rgba(255, 159, 10, 0.22)" },
  badgeText: {
    color: P.label,
    fontSize: ps(0.7),
    letterSpacing: 0.8,
  },
  liveDot: { width: 6, height: 6, borderRadius: RADIUS.full, backgroundColor: P.systemRed },

  nowRow: { flexDirection: "row", alignItems: "center", gap: pw(1) },
  nowTime: {
    color: P.secondaryLabel,
    fontSize: ps(0.95),
    fontVariant: ["tabular-nums"],
  },
  nowTitle: { color: P.label, fontSize: ps(1.05), fontFamily: THEME.fonts.medium, flex: 1 },
  remaining: {
    color: P.secondaryLabel,
    fontSize: ps(0.85),
    fontVariant: ["tabular-nums"],
  },

  progressTrack: {
    height: 3,
    borderRadius: RADIUS.full,
    backgroundColor: P.quaternarySystemFill,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: THEME.colors.primary },

  noGuide: {
    color: P.tertiaryLabel,
    fontSize: ps(0.95),
    fontStyle: "italic",
  },
  nextLine: { color: P.secondaryLabel, fontSize: ps(0.9) },
  // The "NEXT" caption. `secondaryLabel` rather than the accent — it labels
  // the line after it rather than being read itself, and an achromatic accent
  // would have made it as bright as the programme title it introduces.
  nextLabel: { color: P.secondaryLabel, letterSpacing: 1 },
  hint: { color: P.tertiaryLabel, fontSize: ps(0.8), marginTop: ph(0.3) },
});

export default ChannelInfoBar;
