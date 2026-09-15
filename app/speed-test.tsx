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
import { ActivityIndicator, Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
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
import { THEME, ph, psRaw as ps, pw, PAGE_HEADER, DATA_TILE } from "../src/theme/tokens";
import * as P from "../src/theme/palette";
import { RADIUS } from "../src/theme/materials";
import { isPhone } from "../src/utils/phoneUtils";
import { isTouch } from "../src/utils/tabletUtils";
import { Focusable, FocusGroup } from "../src/tv";
import { AlertCircle, RefreshCw, SlidersHorizontal } from 'lucide-react-native';
import { DynamicIcon } from '../src/components/DynamicIcon';
import { Text } from '../src/components/Text';


/**
 * The four grades, as a diagnostic ramp.
 *
 * These were Tailwind's `#4ade80`, `#a3e635`, `#fbbf24` and `#f87171` — the
 * same stray palette that had drifted into half a dozen other files and was
 * replaced there by Apple's system colours. This screen and `system-info` were
 * missed by that pass because neither used the old accent literal the sweep
 * keyed off, which is most of why the two of them stopped matching everything
 * else.
 *
 * Green -> yellow -> orange -> red rather than Tailwind's green -> lime ->
 * amber -> red: the system ramp has no lime, and a four-step diagnostic scale
 * is the one place a yellow "good" reads correctly rather than as a warning,
 * because the step above it is unambiguously green.
 */
const GRADE_COLOR: Record<string, string> = {
  excellent: P.systemGreen,
  good: P.systemYellow,
  fair: P.systemOrange,
  poor: P.systemRed,
};

function Stat({
  icon,
  label,
  value,
  style,
}: {
  icon: string;
  label: string;
  value: string;
  style?: any;
}) {
  return (
    <View style={[S.stat, style]}>
      <DynamicIcon name={icon} size={ps(1.6)} color={P.secondaryLabel} />
      <Text style={S.statLabel}>{label}</Text>
      <Text style={S.statValue}>{value}</Text>
    </View>
  );
}

export default function SpeedTestScreen() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // The same expression every other screen uses. This read `isTablet && ...`,
  // which is never true on a phone, so a handset took the landscape branch.
  const isPortrait = !Platform.isTV && windowHeight > windowWidth;
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

  useEffect(() => {
    start();
  }, [start]);

  const applySmootherBuffer = useCallback(async () => {
    await stbEnvironment.update({ bufferProfile: "smooth" });
    setBufferProfile("smooth");
  }, []);

  const running = progress.phase === "latency" || progress.phase === "download";
  const gradeColor = result ? GRADE_COLOR[result.verdict.grade] ?? P.label : P.label;

  // While the transfer runs, the live figure is the interesting one; once it
  // is done, the sustained average is.
  const headlineSpeed = result ? result.mbps : progress.mbps ?? 0;

  return (
    <View style={[S.container, { paddingTop: insets.top }]}>
      <CinematicBackground />

      <View style={[
        S.header,
        isTouch && { paddingHorizontal: 24, paddingTop: ph(1.5) },
        isPhone && { paddingHorizontal: 14, paddingTop: 4 },
      ]}>
        <Text style={S.headerTitle}>Connection Test</Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          S.scroll,
          isTouch && {
            paddingHorizontal: 24,
            paddingBottom: insets.bottom + 36,
          },
          // Same 14dp gutter as settings, so the two diagnostics screens line up.
          isPhone && {
            paddingHorizontal: 14,
            paddingBottom: insets.bottom + 20,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Headline ── */}
        <View style={S.headline}>
          <Text style={[S.headlineValue, { color: result ? gradeColor : P.label }]}>
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
        <View style={[S.statRow, isPortrait && { flexWrap: "wrap" }]}>
          <Stat
            style={isPortrait ? { minWidth: "48%" } : undefined}
            icon="pulse-outline"
            label="LATENCY"
            value={
              result
                ? `${result.latencyMs} ms`
                : progress.latencyMs != null
                  ? `${progress.latencyMs} ms`
                  : "—"
            }
          />
          <Stat
            style={isPortrait ? { minWidth: "48%" } : undefined}
            icon="analytics-outline"
            label="JITTER"
            value={result ? `${result.jitterMs} ms` : "—"}
          />
          <Stat
            style={isPortrait ? { minWidth: "48%" } : undefined}
            icon="cloud-download-outline"
            label="TRANSFERRED"
            value={result ? formatBytes(result.bytes) : "—"}
          />
          <Stat
            style={isPortrait ? { minWidth: "48%" } : undefined}
            icon="wifi-outline"
            label="CONNECTION"
            value={result ? result.connectionType.toUpperCase() : "—"}
          />
        </View>

        {/* ── Verdict ── */}
        {result ? (
          <View style={S.verdict}>
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
            <AlertCircle size={ps(1.6)} color={P.systemRed} />
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
                  <ActivityIndicator size="small" color={isPhone || focused ? P.onTint : P.label} />
                ) : (
                  <RefreshCw size={ps(1.4)} color={isPhone || focused ? P.onTint : P.label} />
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
                  <SlidersHorizontal size={ps(1.4)} color={isPhone || focused ? P.onTint : P.label} />
                  <Text style={[S.actionText, focused && S.actionTextFocused]}>
                    USE SMOOTH BUFFER
                  </Text>
                </View>
              )}
            </Focusable>
          ) : null}
        </FocusGroup>

        <Text style={S.footnote}>
          {activePortal
            ? `Measured against ${result?.host ?? activePortal.name} · `
            : "No portal connected · "}
          Buffer profile: {BUFFER_PROFILES[bufferProfile].label} — {BUFFER_PROFILES[bufferProfile].detail}
        </Text>
      </ScrollView>
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.colors.background },

  // NB: this file aliases `psRaw as ps`, so every other size in it is on the
  // unbumped scale. The header deliberately is not — it comes from
  // `PAGE_HEADER`, which uses the same `ps` as every other page header, so
  // this title finally matches them on a box instead of rendering a third
  // small. The rest of the screen is left on `psRaw` as it was.
  // The shared page header — see `PAGE_HEADER` in theme/tokens for the table of
  // what the six copies of this had drifted to.
  header: PAGE_HEADER.bar,
  headerTitle: PAGE_HEADER.title,

  scroll: { paddingHorizontal: pw(8), paddingBottom: ph(8), gap: ph(2.4) },

  headline: { alignItems: "center", paddingTop: ph(3), gap: ph(0.6) },
  headlineValue: {
    color: P.label,
    fontSize: ps(5),
    fontFamily: THEME.fonts.bold,
    fontVariant: ["tabular-nums"],
    letterSpacing: -1,
  },
  headlineLabel: { color: P.secondaryLabel, fontSize: isPhone ? 14.4 : ps(1.05) },
  progressTrack: {
    /*
     * `pw` is a percentage of the *long* edge, so `pw(50)` is 436dp — wider
     * than the 393dp screen it has to sit on, and this is a centred bar, so it
     * ran off both sides at once. A percentage of the container instead, which
     * is what the intent was: half the TV canvas, most of a phone's.
     */
    width: isPhone ? "80%" : pw(50),
    height: 4,
    borderRadius: RADIUS.full,
    backgroundColor: P.quaternarySystemFill,
    overflow: "hidden",
    marginTop: ph(1.2),
  },
  progressFill: { height: "100%", backgroundColor: P.tint, borderRadius: RADIUS.full },

  // Gap trimmed on a phone: the stats wrap two to a row at `minWidth: 48%`, and
  // `pw(1.5)` is 13dp, which leaves those two within 2dp of overflowing — the
  // same near-miss that dropped the settings tiles to one per row.
  statRow: { flexDirection: "row", gap: isPhone ? 10 : pw(1.5) },
  /*
   * A fixed height on a phone so all four stats match.
   *
   * They wrap two to a row, and flex only equalises within a row — so the pair
   * on the second line sized themselves independently of the first, and any
   * stat whose hint was absent or whose value wrapped came out shorter than its
   * neighbours below. 78 clears the tallest content (a ~13dp label, a ~20dp
   * value, a ~13dp hint and the padding), which makes it the height of every
   * tile rather than a floor.
   */
  stat: {
    flex: 1,
    minHeight: isPhone ? 78 : undefined,
    padding: isPhone ? 12 : pw(1.5),
    // Flat, not a material — see `DATA_TILE`.
    ...DATA_TILE,
    gap: ph(0.3),
  },
  statLabel: {
    color: P.secondaryLabel,
    fontSize: isPhone ? 11.5 : ps(0.75),
    fontFamily: THEME.fonts.medium,
    letterSpacing: 1.2,
    marginTop: ph(0.4),
  },
  statValue: {
    color: P.label,
    fontSize: isPhone ? 18.4 : ps(1.5),
    fontFamily: THEME.fonts.semibold,
    fontVariant: ["tabular-nums"],
  },

  /**
   * The verdict panel keeps the material's own neutral edge rather than a
   * grade-tinted one.
   *
   * It used to take `${gradeColor}55` as its border, which put the grade in
   * three places at once — the dot, the word, and a coloured frame around the
   * whole block. The dot and the word are enough; a tinted container is the
   * treatment `ConfirmDialog` had to have taken off it for the same reason.
   */
  verdict: {
    padding: pw(2),
    ...DATA_TILE,
    gap: ph(0.8),
  },
  verdictHead: { flexDirection: "row", alignItems: "center", gap: pw(1) },
  verdictDot: { width: 10, height: 10, borderRadius: RADIUS.full },
  verdictGrade: {
    fontSize: isPhone ? 15.5 : ps(1.2),
    fontFamily: THEME.fonts.semibold,
    letterSpacing: 1.5,
  },
  verdictQuality: {
    color: P.label,
    fontSize: isPhone ? 14.4 : ps(1.05),
    fontFamily: THEME.fonts.medium,
  },
  verdictSummary: { color: P.secondaryLabel, fontSize: ps(1), lineHeight: ps(1.6) },

  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(1),
    padding: pw(1.5),
    borderRadius: RADIUS.card,
    borderCurve: "continuous",
    // Fill only, matching the tiles above it.
    backgroundColor: "rgba(255, 69, 58, 0.12)",
  },
  errorText: { color: P.systemRed, fontSize: isPhone ? 13.8 : ps(1), flex: 1 },

  actions: { flexDirection: "row", gap: pw(1.5), flexWrap: "wrap" },
  actionWrapper: { borderRadius: RADIUS.card },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(0.8),
    paddingHorizontal: pw(2.5),
    paddingVertical: ph(1.3),
    borderRadius: RADIUS.card,
    borderCurve: "continuous",
    // Filled on a phone. The translucent fill is the *resting* state of a
    // control that fills when a remote focuses it, and a phone focuses
    // nothing — so it would have stayed a faint grey panel forever. This is
    // the same "no cursor, so the selected thing is always the filled one"
    // rule that `selectionRung` encodes for the category selectors.
    //
    // The fill is the tint rather than a bare `#fff`, which is the specific
    // thing that made this screen's buttons read a shade brighter than every
    // other focused control in the app.
    backgroundColor: isPhone ? P.tint : P.tertiarySystemFill,
    borderWidth: 1,
    borderColor: "transparent",
  },
  actionFocused: { backgroundColor: P.tint, borderColor: P.tint, transform: [{ scale: 1.04 }] },
  actionDisabled: { opacity: 0.6 },
  actionText: {
    color: isPhone ? P.onTint : P.label,
    fontSize: isPhone ? 15 : ps(1),
    fontFamily: THEME.fonts.semibold,
    letterSpacing: 1,
  },
  actionTextFocused: { color: P.onTint },

  footnote: { color: P.secondaryLabel, fontSize: isPhone ? 12.6 : ps(0.9) },
});
