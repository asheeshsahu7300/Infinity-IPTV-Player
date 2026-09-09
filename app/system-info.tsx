// ─────────────────────────────────────────────────────────────────────────────
// System Information — the identity page every set-top box has.
//
// It exists for one moment: a provider says "read me your MAC" or "which
// firmware are you on", and the answer has to be on screen without hunting.
// So the values that matter to support come first and are large enough to read
// from a sofa, and everything is copyable in one press rather than transcribed.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StatusBar, StyleSheet, View } from 'react-native';
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
import { THEME, ph, ps, pw } from "../src/theme/tokens";
import { isTablet } from "../src/utils/tabletUtils";
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

      <View style={[S.header, isTablet && { paddingHorizontal: 24, paddingTop: ph(3) }]}>
        <Text style={S.headerTitle}>System Information</Text>
        <Text style={S.headerSubtitle}>
          Device specifications, network status and streaming capabilities
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          S.scroll,
          isTablet && {
            paddingHorizontal: 24,
            paddingBottom: insets.bottom + 36,
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
                  color={focused ? "#000" : "#fff"}
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
                <Gauge size={ps(1.4)} color={focused ? "#000" : "#fff"} />
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

  header: { paddingHorizontal: pw(4), paddingTop: ph(2), paddingBottom: ph(1) },
  headerTitle: { color: "#fff", fontSize: ps(2), fontWeight: "900" },
  headerSubtitle: { color: THEME.colors.textDim, fontSize: ps(1), marginTop: ph(0.4) },

  scroll: { paddingHorizontal: pw(4), paddingBottom: ph(6) },

  section: { marginTop: ph(2) },
  sectionLabel: {
    color: "rgba(255,255,255,0.32)",
    fontSize: ps(0.85),
    fontWeight: "900",
    letterSpacing: 2,
    marginBottom: ph(1),
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: pw(1.2) },
  field: {
    width: isTablet ? "48%" : `${100 / 3}%`,
    minWidth: isTablet ? "46%" : pw(24),
    flexGrow: 1,
    flexBasis: isTablet ? "46%" : pw(24),
    padding: pw(1.4),
    borderRadius: ps(0.9),
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
    gap: ph(0.3),
  },
  fieldLabel: {
    color: "rgba(255,255,255,0.32)",
    fontSize: ps(0.78),
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  fieldValue: { color: "#fff", fontSize: ps(1.1), fontWeight: "700" },
  fieldValueEmphasis: {
    color: THEME.colors.primary,
    fontSize: ps(1.25),
    fontVariant: ["tabular-nums"],
  },

  actions: { flexDirection: "row", gap: pw(1.5), marginTop: ph(3), flexWrap: "wrap" },
  actionWrapper: { borderRadius: ps(1) },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(0.8),
    paddingHorizontal: pw(2.5),
    paddingVertical: ph(1.3),
    borderRadius: ps(1),
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "transparent",
  },
  actionFocused: { backgroundColor: "#fff", borderColor: "#fff", transform: [{ scale: 1.04 }] },
  actionText: { color: "#fff", fontSize: ps(1), fontWeight: "900", letterSpacing: 1 },
  actionTextFocused: { color: "#000" },
});
