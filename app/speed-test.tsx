// ─────────────────────────────────────────────────────────────────────────────
// Speed Test — the connection diagnostic on a set-top box's tools menu.
//
// The screen exists to answer one question: is the buffering my line or my
// provider? So it measures against the portal wherever it can, reports latency
// and jitter alongside throughput (jitter is what actually breaks live TV), and
// ends on a verdict in words rather than a number the viewer has to interpret.
//
// It also closes the loop: when the result is poor it offers the buffer profile
// that would help, rather than leaving the viewer to find that setting.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePortalStore } from "../src/store/portalStore";
import {
  formatBytes,
  formatSpeed,
  runSpeedTest,
  SpeedTestProgress,
  SpeedTestResult,
} from "../src/services/speedTest";
import { BUFFER_PROFILES, stbEnvironment } from "../src/services/stbEnvironment";
import { CinematicBackground } from "../src/components/CinematicBackground";
import { THEME, ph, ps, pw } from "../src/theme/tokens";
import { Focusable, FocusGroup } from "../src/tv";

const GRADE_COLOR: Record<string, string> = {
  excellent: "#4ade80",
  good: "#a3e635",
  fair: "#fbbf24",
  poor: "#f87171",
};

function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <View style={S.stat}>
      <Ionicons name={icon} size={ps(1.6)} color="rgba(255,255,255,0.35)" />
      <Text style={S.statLabel}>{label}</Text>
      <Text style={S.statValue}>{value}</Text>
      {hint ? <Text style={S.statHint}>{hint}</Text> : null}
    </View>
  );
}

export default function SpeedTestScreen() {
  const insets = useSafeAreaInsets();
  const activePortal = usePortalStore((s) => s.activePortal);

  const [progress, setProgress] = useState<SpeedTestProgress>({ phase: "idle", progress: 0 });
  const [result, setResult] = useState<SpeedTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bufferProfile, setBufferProfile] = useState(() => stbEnvironment.snapshot.bufferProfile);

  const runningRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    stbEnvironment.load().then(() => {
      if (mountedRef.current) setBufferProfile(stbEnvironment.snapshot.bufferProfile);
    });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const start = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setError(null);
    setResult(null);
    setProgress({ phase: "latency", progress: 0 });

    try {
      const outcome = await runSpeedTest(activePortal, (p) => {
        if (mountedRef.current) setProgress(p);
      });
      if (mountedRef.current) setResult(outcome);
    } catch (e: any) {
      if (mountedRef.current) {
        setError(e?.message || "The test could not complete.");
        setProgress({ phase: "failed", progress: 1 });
      }
    } finally {
      runningRef.current = false;
    }
  }, [activePortal]);

  // Running on arrival is the behaviour of the equivalent STB tool, and it is
  // the only thing anyone opens this screen to do.
  useEffect(() => {
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applySmootherBuffer = useCallback(async () => {
    await stbEnvironment.update({ bufferProfile: "smooth" });
    setBufferProfile("smooth");
  }, []);

  const running = progress.phase === "latency" || progress.phase === "download";
  const gradeColor = result ? GRADE_COLOR[result.verdict.grade] ?? "#fff" : "#fff";

  // While the transfer runs, the live figure is the interesting one; once it
  // is done, the sustained average is.
  const headlineSpeed = result ? result.mbps : progress.mbps ?? 0;

  return (
    <View style={[S.container, { paddingTop: insets.top }]}>
      <CinematicBackground />
      <StatusBar hidden />

      <View style={S.header}>
        <Text style={S.headerTitle}>Connection Test</Text>
        <Text style={S.headerSubtitle}>
          {activePortal
            ? `Measured against ${result?.host ?? activePortal.name}`
            : "No portal connected"}
        </Text>
      </View>

      <ScrollView contentContainerStyle={S.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Headline ── */}
        <View style={S.headline}>
          <Text style={[S.headlineValue, { color: result ? gradeColor : "#fff" }]}>
            {headlineSpeed > 0 ? formatSpeed(headlineSpeed) : "—"}
          </Text>
          <Text style={S.headlineLabel}>
            {running
              ? progress.message ?? "Testing…"
              : result
                ? "Sustained download speed"
                : error
                  ? "Test failed"
                  : "Ready"}
          </Text>

          <View style={S.progressTrack}>
            <View
              style={[
                S.progressFill,
                { width: `${Math.round(progress.progress * 100)}%` },
                result ? { backgroundColor: gradeColor } : null,
              ]}
            />
          </View>
        </View>

        {/* ── Numbers ── */}
        <View style={S.statRow}>
          <Stat
            icon="pulse-outline"
            label="LATENCY"
            value={
              result
                ? `${result.latencyMs} ms`
                : progress.latencyMs != null
                  ? `${progress.latencyMs} ms`
                  : "—"
            }
            hint="Time to reach the server"
          />
          <Stat
            icon="analytics-outline"
            label="JITTER"
            value={result ? `${result.jitterMs} ms` : "—"}
            hint="Steadiness — what breaks live TV"
          />
          <Stat
            icon="cloud-download-outline"
            label="TRANSFERRED"
            value={result ? formatBytes(result.bytes) : "—"}
            hint={result ? `in ${(result.durationMs / 1000).toFixed(1)}s` : undefined}
          />
          <Stat
            icon="wifi-outline"
            label="CONNECTION"
            value={result ? result.connectionType.toUpperCase() : "—"}
            hint="Reported by the system"
          />
        </View>

        {/* ── Verdict ── */}
        {result ? (
          <View style={[S.verdict, { borderColor: `${gradeColor}55` }]}>
            <View style={S.verdictHead}>
              <View style={[S.verdictDot, { backgroundColor: gradeColor }]} />
              <Text style={[S.verdictGrade, { color: gradeColor }]}>
                {result.verdict.grade.toUpperCase()}
              </Text>
              <Text style={S.verdictQuality}>Supports {result.verdict.maxQuality}</Text>
            </View>
            <Text style={S.verdictSummary}>{result.verdict.summary}</Text>
          </View>
        ) : null}

        {error ? (
          <View style={S.errorBox}>
            <Ionicons name="alert-circle-outline" size={ps(1.6)} color="#f87171" />
            <Text style={S.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* ── Actions ── */}
        <FocusGroup style={S.actions}>
          <Focusable
            ringOnFocus={false}
            hasTVPreferredFocus
            onPress={start}
            disabled={running}
            style={S.actionWrapper}
            accessibilityLabel="Run the test again"
          >
            {(focused) => (
              <View style={[S.action, focused && S.actionFocused, running && S.actionDisabled]}>
                {running ? (
                  <ActivityIndicator size="small" color={focused ? "#000" : "#fff"} />
                ) : (
                  <Ionicons name="refresh" size={ps(1.4)} color={focused ? "#000" : "#fff"} />
                )}
                <Text style={[S.actionText, focused && S.actionTextFocused]}>
                  {running ? "TESTING…" : "RUN AGAIN"}
                </Text>
              </View>
            )}
          </Focusable>

          {/* Offered only when it would actually help — a "fix it" button that
              is always there teaches people to ignore it. */}
          {result && result.verdict.grade !== "excellent" && bufferProfile !== "smooth" ? (
            <Focusable
              ringOnFocus={false}
              onPress={applySmootherBuffer}
              style={S.actionWrapper}
              accessibilityLabel="Switch the buffer profile to Smooth"
            >
              {(focused) => (
                <View style={[S.action, focused && S.actionFocused]}>
                  <Ionicons name="options-outline" size={ps(1.4)} color={focused ? "#000" : "#fff"} />
                  <Text style={[S.actionText, focused && S.actionTextFocused]}>
                    USE SMOOTH BUFFER
                  </Text>
                </View>
              )}
            </Focusable>
          ) : null}
        </FocusGroup>

        <Text style={S.footnote}>
          Buffer profile: {BUFFER_PROFILES[bufferProfile].label} — {BUFFER_PROFILES[bufferProfile].detail}
        </Text>
      </ScrollView>
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.colors.background },

  header: { paddingHorizontal: pw(4), paddingTop: ph(2) },
  headerTitle: { color: "#fff", fontSize: ps(2), fontWeight: "900" },
  headerSubtitle: { color: THEME.colors.textDim, fontSize: ps(1), marginTop: ph(0.4) },

  scroll: { paddingHorizontal: pw(4), paddingBottom: ph(6), gap: ph(2.4) },

  headline: { alignItems: "center", paddingTop: ph(3), gap: ph(0.6) },
  headlineValue: {
    color: "#fff",
    fontSize: ps(5),
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
    letterSpacing: -1,
  },
  headlineLabel: { color: THEME.colors.textMuted, fontSize: ps(1.05), fontWeight: "600" },
  progressTrack: {
    width: pw(50),
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
    marginTop: ph(1.2),
  },
  progressFill: { height: "100%", backgroundColor: "#fff", borderRadius: 2 },

  statRow: { flexDirection: "row", gap: pw(1.5) },
  stat: {
    flex: 1,
    padding: pw(1.5),
    borderRadius: ps(1),
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    gap: ph(0.3),
  },
  statLabel: {
    color: "rgba(255,255,255,0.35)",
    fontSize: ps(0.75),
    fontWeight: "900",
    letterSpacing: 1.2,
    marginTop: ph(0.4),
  },
  statValue: {
    color: "#fff",
    fontSize: ps(1.5),
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  statHint: { color: "rgba(255,255,255,0.28)", fontSize: ps(0.78) },

  verdict: {
    padding: pw(2),
    borderRadius: ps(1.1),
    borderWidth: 1,
    backgroundColor: "rgba(255,255,255,0.03)",
    gap: ph(0.8),
  },
  verdictHead: { flexDirection: "row", alignItems: "center", gap: pw(1) },
  verdictDot: { width: 10, height: 10, borderRadius: 5 },
  verdictGrade: { fontSize: ps(1.2), fontWeight: "900", letterSpacing: 1.5 },
  verdictQuality: { color: "#fff", fontSize: ps(1.05), fontWeight: "700" },
  verdictSummary: { color: THEME.colors.textMuted, fontSize: ps(1), lineHeight: ps(1.6) },

  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(1),
    padding: pw(1.5),
    borderRadius: ps(1),
    backgroundColor: "rgba(248,113,113,0.08)",
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.25)",
  },
  errorText: { color: "#fca5a5", fontSize: ps(1), flex: 1 },

  actions: { flexDirection: "row", gap: pw(1.5), flexWrap: "wrap" },
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
  actionDisabled: { opacity: 0.6 },
  actionText: { color: "#fff", fontSize: ps(1), fontWeight: "900", letterSpacing: 1 },
  actionTextFocused: { color: "#000" },

  footnote: { color: "rgba(255,255,255,0.28)", fontSize: ps(0.9) },
});
