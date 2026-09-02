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
import { StyleSheet, Text, View } from "react-native";

import { THEME, ph, ps, pw } from "../theme/tokens";

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
      <View style={S.readoutBox}>
        <Text style={S.readoutDigits}>
          {entry}
          {pad > 0 ? <Text style={S.readoutPad}>{"_".repeat(pad)}</Text> : null}
        </Text>
        <Text style={S.readoutLabel} numberOfLines={1}>
          {resolvedName ?? "Enter channel"}
        </Text>
      </View>
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
    borderRadius: ps(1),
    backgroundColor: "rgba(8,8,12,0.88)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
  },
  readoutDigits: {
    color: "#fff",
    fontSize: ps(4),
    fontWeight: "900",
    letterSpacing: 4,
    fontVariant: ["tabular-nums"],
  },
  readoutPad: { color: "rgba(255,255,255,0.22)" },
  readoutLabel: {
    color: "rgba(255,255,255,0.55)",
    fontSize: ps(0.9),
    fontWeight: "700",
    letterSpacing: 1,
    marginTop: ph(0.4),
    maxWidth: pw(24),
  },

});

export default ChannelTunerReadout;
