// ─────────────────────────────────────────────────────────────────────────────
// ChannelTunerOverlay — the big digits a set-top box throws up while you dial.
//
// Large, top-right, non-interactive, exactly where STB firmware puts it:
// the digits typed so far and what channel they resolve to.
//
// There is deliberately no on-screen keypad to go with it. There used to be,
// on the belief that Android TV never forwards number keys to JS — but
// react-native-tvos does (see the note at the top of src/tv/stbKeys.ts), so
// the remote is the keypad and this readout is the only UI the tuner needs.
// ─────────────────────────────────────────────────────────────────────────────
import React from "react";
import { StyleSheet, View } from 'react-native';

import { ph, ps, pw, THEME } from "../theme/tokens";
import * as P from "../theme/palette";
import { RADIUS } from "../theme/materials";
import { GlassSurface } from "./GlassSurface";
import { Text } from './Text';


export interface ChannelTunerReadoutProps {
  /** Digits typed so far. Null hides the readout entirely. */
  entry: string | null;
  /** Name of the channel the entry currently resolves to, when it resolves. */
  resolvedName?: string | null;
  /** Width of the longest channel number, so the placeholder dashes line up. */
  width?: number;
}

/** The dial-in readout. Purely informational — never takes focus. */
export const ChannelTunerReadout = React.memo(function ChannelTunerReadout({
  entry,
  resolvedName,
  width = 3,
}: ChannelTunerReadoutProps) {
  if (!entry) return null;

  // "12_" — the trailing placeholders are what tell the viewer more digits are
  // still being waited for, which is the whole reason the timeout is tolerable.
  const pad = Math.max(0, width - entry.length);

  return (
    <View style={S.readout} pointerEvents="none">
      {/* `ultraThin`, because this sits over live video and the picture
          underneath has to stay watchable while the viewer dials. It is also
          the one readout the STB puts up mid-programme, so it must never read
          as a panel that has taken the screen. */}
      <GlassSurface
        material="ultraThin"
        radius={RADIUS.lg}
        shadow="popover"
        style={S.readoutBox}
      >
        <Text style={S.readoutDigits}>
          {entry}
          {pad > 0 ? <Text style={S.readoutPad}>{"_".repeat(pad)}</Text> : null}
        </Text>
        <Text style={S.readoutLabel} numberOfLines={1}>
          {resolvedName ?? "Enter channel"}
        </Text>
      </GlassSurface>
    </View>
  );
});

const S = StyleSheet.create({
  readout: {
    position: "absolute",
    top: ph(6),
    right: pw(4),
    zIndex: 60,
  },
  readoutBox: {
    minWidth: ps(9),
    paddingHorizontal: pw(2),
    paddingVertical: ph(1.4),
    alignItems: "center",
  },
  readoutDigits: {
    color: P.label,
    fontSize: ps(4),
    fontFamily: THEME.fonts.bold,
    // Weight comes from the family, never from `fontWeight` — `Text` strips
    // that property, so the `fontFamily: THEME.fonts.bold` this used to carry rendered as
    // Regular. Bold rather than the Black that was asked for: at ps(4) these
    // digits are already the largest thing on the screen, and Black at that
    // size closes up the counters of the 0, 6 and 8 from across a room.
    //
    // The tracking stays generous and the tabular figures stay mandatory —
    // without them the readout's width jumps as each digit lands, which on a
    // right-anchored overlay makes the whole box twitch.
    letterSpacing: 4,
    fontVariant: ["tabular-nums"],
  },
  readoutPad: { color: P.quaternaryLabel },
  readoutLabel: {
    color: P.secondaryLabel,
    fontSize: ps(0.9),
    fontFamily: THEME.fonts.medium,
    letterSpacing: 1,
    marginTop: ph(0.4),
    maxWidth: pw(24),
    textTransform: "uppercase",
  },

});

export default ChannelTunerReadout;
