// ─────────────────────────────────────────────────────────────────────────────
// MetaFacts — the rating / year / runtime line, as plain text.
//
// These facts used to be a row of filled capsules. Three of them side by side
// put more visual weight on the containers than on the numbers inside, and on a
// detail screen that already has a poster, a huge title and a row of buttons,
// they read as another set of controls rather than as information.
//
// So: no pills, no borders, no fills. One line of text, separated by dots, with
// an icon only where it earns one. The facts themselves are what should be
// legible from across a room.
//
// Every entry is optional and blank ones are dropped, because no portal
// supplies all of them and a dangling separator looks like a bug.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useMemo } from "react";
import { StyleSheet, View } from 'react-native';


import { ph, ps, pw, THEME } from "../theme/tokens";
import * as P from '../theme/palette';

import { DynamicIcon } from "./DynamicIcon";
import { Text } from './Text';


export interface MetaFact {
  /** Shown before the text. Only worth it where the glyph reads faster. */
  icon?: string;
  iconColor?: string;
  text?: string | number | null;
  /** Highlights one fact — a resume position, say. */
  tone?: "default" | "accent";
}

export interface MetaFactsProps {
  facts: (MetaFact | null | undefined | false)[];
  compact?: boolean;
}

/** Empty, "N/A" and the usual junk all mean "do not render this fact". */
function usable(value: MetaFact["text"]): string | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  if (!s || /^(n\/?a|null|undefined)$/i.test(s)) return undefined;
  return s;
}

export const MetaFacts = React.memo(function MetaFacts({ facts, compact }: MetaFactsProps) {
  const shown = useMemo(
    () =>
      facts
        .filter((f): f is MetaFact => !!f)
        .map((f) => ({ ...f, label: usable(f.text) }))
        .filter((f) => !!f.label),
    [facts]
  );

  if (shown.length === 0) return null;

  return (
    <View style={[S.row, compact && S.rowCompact]}>
      {shown.map((fact, i) => (
        <View key={`${fact.label}-${i}`} style={S.fact}>
          {/* The separator belongs to the fact that follows it, so the first
              one never gets a leading dot and the last never a trailing one. */}
          {i > 0 ? <Text style={S.separator}>·</Text> : null}
          {fact.icon ? (
            <DynamicIcon
              name={fact.icon}
              size={ps(1.05)}
              color={fact.iconColor ?? P.secondaryLabel}
            />
          ) : null}
          <Text style={[S.text, fact.tone === "accent" && S.textAccent]} numberOfLines={1}>
            {fact.label}
          </Text>
        </View>
      ))}
    </View>
  );
});

const S = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  rowCompact: {},
  fact: { flexDirection: "row", alignItems: "center", gap: pw(0.45) },
  separator: {
    color: P.quaternaryLabel,
    fontSize: ps(1.05),
    marginHorizontal: pw(0.8),
  },
  text: {
    color: "rgba(235, 235, 245, 0.80)",
    fontSize: ps(1.05),
    fontFamily: THEME.fonts.medium,
    letterSpacing: 0.2,
  },
  // systemGreen, not the Tailwind `#4ade80` it was. This is the "resume from
  // here" fact, and it is the only coloured thing on the line.
  textAccent: { color: P.systemGreen },
});

export default MetaFacts;
