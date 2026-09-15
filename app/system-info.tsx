// ─────────────────────────────────────────────────────────────────────────────
// System Information — the identity page every set-top box has.
//
// It exists for one moment: a provider says "read me your MAC" or "which
// firmware are you on", and the answer has to be on screen without hunting.
// So the values that matter to support come first and are large enough to read
// from a sofa, and everything is copyable in one press rather than transcribed.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from 'react-native';
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import NetInfo from "@react-native-community/netinfo";

import { usePortalStore } from "../src/store/portalStore";
import {
  BUFFER_PROFILES,
  formatUptime,
  stbEnvironment,
  SystemInfo,
} from "../src/services/stbEnvironment";
import { epgService } from "../src/services/epgService";
import { parentalControl } from "../src/services/parentalControl";
import { CinematicBackground } from "../src/components/CinematicBackground";
import { THEME, ph, ps, pw, PAGE_HEADER, DATA_TILE } from "../src/theme/tokens";
import * as P from "../src/theme/palette";
import { RADIUS } from "../src/theme/materials";
import { isPhone } from "../src/utils/phoneUtils";
import { isTouch } from "../src/utils/tabletUtils";
import { Focusable, FocusGroup } from "../src/tv";
import { Gauge } from 'lucide-react-native';
import { DynamicIcon } from '../src/components/DynamicIcon';
import { Text } from '../src/components/Text';


interface Field {
  label: string;
  value: string;
  /** Highlighted fields are the ones support asks for. */
  emphasis?: boolean;
}

function FieldGrid({ title, fields }: { title: string; fields: Field[] }) {
  return (
    <View style={S.section}>
      <Text style={S.sectionLabel}>{title}</Text>
      <View style={S.grid}>
        {fields.map((f) => (
          <View key={f.label} style={S.field}>
            <Text style={S.fieldLabel}>{f.label}</Text>
            <Text
              style={[S.fieldValue, f.emphasis && S.fieldValueEmphasis]}
              numberOfLines={2}
            >
              {f.value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function SystemInfoScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const activePortal = usePortalStore((s) => s.activePortal);
  const channels = usePortalStore((s) => s.channels);
  const vodItems = usePortalStore((s) => s.vodItems);
  const series = usePortalStore((s) => s.series);

  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [ip, setIp] = useState<string>("—");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;

    const refresh = () => {
      if (alive) setInfo(stbEnvironment.describe(activePortal));
    };

    stbEnvironment.load().then(refresh);
    parentalControl.load().then(refresh);

    // Uptime is the only value that moves on its own, and once a minute is
    // often enough for a page nobody watches.
    const timer = setInterval(refresh, 60000);

    NetInfo.fetch()
      .then((s) => {
        const details = s.details as any;
        if (alive && details?.ipAddress) setIp(String(details.ipAddress));
      })
      .catch(() => { });

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [activePortal]);

  const copyAll = useCallback(async () => {
    if (!info) return;
    // One block of text, because the reason to copy this page is to paste it
    // into a support chat.
    const lines = [
      `${info.appName} ${info.appVersion} (build ${info.buildNumber})`,
      `Device: ${info.model} · ${info.platform}`,
      `Screen: ${info.resolution}`,
      `Device ID: ${info.deviceId}`,
      `MAC: ${info.mac}`,
      `Portal: ${info.portalName} (${info.portalType})`,
      `Portal URL: ${info.portalUrl}`,
      `IP: ${ip}`,
      `Timezone: ${info.timezone}`,
      `Uptime: ${formatUptime(info.uptimeMs)}`,
      `Buffer: ${BUFFER_PROFILES[info.bufferProfile].label}`,
    ];
    await Clipboard.setStringAsync(lines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }, [info, ip]);

  if (!info) {
    return (
      <View style={[S.container, { paddingTop: insets.top }]}>
        <CinematicBackground />
      </View>
    );
  }

  const guideStatus =
    epgService.status === "done"
      ? "Loaded"
      : epgService.status === "loading"
        ? "Loading…"
        : epgService.status === "unavailable"
          ? "Not published by this portal"
          : "Not loaded";

  return (
    <View style={[S.container, { paddingTop: insets.top }]}>
      <CinematicBackground />

      <View style={[
        S.header,
        isTouch && { paddingHorizontal: 24, paddingTop: ph(1.5) },
        isPhone && { paddingHorizontal: 14, paddingTop: 4 },
      ]}>
        <Text style={S.headerTitle}>System Information</Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          S.scroll,
          isTouch && {
            paddingHorizontal: 24,
            paddingBottom: insets.bottom + 36,
          },
          // The 14dp gutter the other two diagnostics screens use.
          isPhone && {
            paddingHorizontal: 14,
            paddingBottom: insets.bottom + 20,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <FieldGrid
          title="DEVICE"
          fields={[
            { label: "Model", value: info.model },
            { label: "Platform", value: info.platform },
            { label: "Screen resolution", value: info.resolution },
            { label: "Layout size", value: info.layoutSize },
            { label: "Device ID", value: info.deviceId, emphasis: true },
            { label: "Uptime", value: formatUptime(info.uptimeMs) },
          ]}
        />

        <FieldGrid
          title="NETWORK & PORTAL"
          fields={[
            { label: "MAC address", value: info.mac, emphasis: true },
            { label: "IP address", value: ip },
            { label: "Portal", value: info.portalName },
            { label: "Portal type", value: info.portalType },
            { label: "Portal URL", value: info.portalUrl },
            { label: "Timezone", value: info.timezone },
          ]}
        />

        <FieldGrid
          title="CONTENT & PLAYBACK"
          fields={[
            { label: "Live channels", value: String(channels.length) },
            { label: "Movies", value: String(vodItems.length) },
            { label: "Series", value: String(series.length) },
            { label: "Programme guide", value: guideStatus },
            { label: "Buffer profile", value: BUFFER_PROFILES[info.bufferProfile].label },
            {
              label: "Parental lock",
              value: parentalControl.isEnabled ? "On" : "Off",
            },
          ]}
        />

        <FocusGroup style={S.actions}>
          <Focusable
            ringOnFocus={false}
            hasTVPreferredFocus
            onPress={copyAll}
            style={S.actionWrapper}
            accessibilityLabel="Copy system information"
          >
            {(focused) => (
              <View style={[S.action, focused && S.actionFocused]}>
                <DynamicIcon
                  name={copied ? "checkmark" : "copy-outline"}
                  size={ps(1.4)}
                  color={isPhone || focused ? P.onTint : P.label}
                />
                <Text style={[S.actionText, focused && S.actionTextFocused]}>
                  {copied ? "COPIED" : "COPY ALL"}
                </Text>
              </View>
            )}
          </Focusable>

          <Focusable
            ringOnFocus={false}
            onPress={() => router.push("/speed-test")}
            style={S.actionWrapper}
            accessibilityLabel="Run a connection test"
          >
            {(focused) => (
              <View style={[S.action, focused && S.actionFocused]}>
                <Gauge size={ps(1.4)} color={isPhone || focused ? P.onTint : P.label} />
                <Text style={[S.actionText, focused && S.actionTextFocused]}>SPEED TEST</Text>
              </View>
            )}
          </Focusable>
        </FocusGroup>
      </ScrollView>
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.colors.background },

  // The shared page header — see `PAGE_HEADER` in theme/tokens for the table of
  // what the six copies of this had drifted to.
  header: PAGE_HEADER.bar,
  headerTitle: PAGE_HEADER.title,

  // Was `pw(4)` — half the gutter every other page in this menu uses, and it
  // had to move with the header or the two would no longer line up.
  scroll: { paddingHorizontal: pw(8), paddingBottom: ph(6) },

  section: { marginTop: ph(2) },
  sectionLabel: {
    ...PAGE_HEADER.sectionLabel,
    marginBottom: ph(1),
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: isPhone ? 10 : pw(1.2) },
  /*
   * A fixed height on a phone so the grid is even.
   *
   * These wrap across several rows and flex only equalises within a row, so
   * each row sized itself to its own longest value — a field holding "Android
   * 14" ended up shorter than the one beside it holding a resolution string,
   * and the grid stepped up and down the page. 62 clears a label line, a value
   * line and the padding; a value that wraps still grows past it, since this is
   * a minimum rather than a cap.
   */
  field: {
    width: isTouch ? "48%" : `${100 / 3}%`,
    minWidth: isTouch ? "46%" : pw(24),
    flexGrow: 1,
    flexBasis: isTouch ? "46%" : pw(24),
    minHeight: isPhone ? 62 : undefined,
    padding: isPhone ? 12 : pw(1.4),
    // Flat, not a material — see `DATA_TILE` for why glass was wrong here.
    ...DATA_TILE,
    gap: ph(0.3),
  },
  // `secondaryLabel`, not tertiary. Tertiary is 30% alpha, which on this tile
  // is about 2.4:1 against the fill — under AA and, on a phone held at arm's
  // length, genuinely hard to read. Tertiary is for placeholders and disabled
  // text; a caption naming the value beneath it has to be legible.
  fieldLabel: {
    color: P.secondaryLabel,
    fontSize: isPhone ? 11.5 : ps(0.78),
    fontFamily: THEME.fonts.medium,
    letterSpacing: 0.8,
  },
  fieldValue: {
    color: P.label,
    fontSize: isPhone ? 15 : ps(1.1),
    fontFamily: THEME.fonts.medium,
  },
  /**
   * The fields support asks for — MAC and device ID.
   *
   * Emphasis is **weight and figures only, never size.** A larger size here
   * broke the grid twice over: every tile is a fixed height, so the two
   * emphasised values sat visibly taller than their neighbours, and a MAC
   * address at 17.3dp no longer fits a half-width tile on a 393dp phone — it
   * wrapped to "00:1A:79:BC:AD:" / "4A", splitting the one value on this page
   * most likely to be read aloud down a phone line.
   *
   * Tabular figures are the other half of the emphasis and matter in their own
   * right: they keep the digit columns even in a value being dictated.
   *
   * It also used to take `THEME.colors.primary`, a *coloured* accent at the
   * time and an off-white now — indistinguishable from `label` on the same
   * tile, so colour cannot carry this either.
   */
  fieldValueEmphasis: {
    color: P.label,
    fontFamily: THEME.fonts.bold,
    fontVariant: ["tabular-nums"],
  },

  actions: { flexDirection: "row", gap: isPhone ? 10 : pw(1.5), marginTop: ph(3), flexWrap: "wrap" },
  actionWrapper: { borderRadius: RADIUS.card },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(0.8),
    paddingHorizontal: pw(2.5),
    paddingVertical: ph(1.3),
    borderRadius: RADIUS.card,
    borderCurve: "continuous",
    // Filled on a phone — the translucent fill is a resting state only a
    // remote's focus ever lifts. Same as the speed-test actions, and the same
    // rule `selectionRung` encodes: with no cursor, the control is always in
    // its filled state.
    backgroundColor: isPhone ? P.tint : P.tertiarySystemFill,
    borderWidth: 1,
    borderColor: "transparent",
  },
  actionFocused: { backgroundColor: P.tint, borderColor: P.tint, transform: [{ scale: 1.04 }] },
  actionText: {
    color: isPhone ? P.onTint : P.label,
    fontSize: isPhone ? 15 : ps(1),
    fontFamily: THEME.fonts.semibold,
    letterSpacing: 1,
  },
  actionTextFocused: { color: P.onTint },
});
