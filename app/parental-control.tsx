// ─────────────────────────────────────────────────────────────────────────────
// Parental Control — the PIN lock menu.
//
// Getting into this screen requires the PIN once the lock is on. That is the
// whole point: a parental control whose off switch is not itself protected is
// a suggestion, not a lock.
//
// The three scopes are separate rows rather than one master switch because
// households use them differently — most people want locked channels and an
// open settings menu, some want the reverse.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePortalStore } from "../src/store/portalStore";
import {
  DEFAULT_PIN,
  LockScope,
  parentalControl,
  ParentalState,
} from "../src/services/parentalControl";
import { CinematicBackground } from "../src/components/CinematicBackground";
import PinPrompt from "../src/components/PinPrompt";
import { THEME, ph, ps, pw } from "../src/theme/tokens";
import { Focusable, FocusGroup } from "../src/tv";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

/** What the PIN prompt is currently being asked for. */
type PinIntent = "enter" | "change-current" | "change-new" | "change-confirm" | null;

function Row({
  icon,
  title,
  subtitle,
  on,
  onPress,
  preferred,
  disabled,
  danger,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  on?: boolean;
  onPress: () => void;
  preferred?: boolean;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Focusable
      ringOnFocus={false}
      onPress={onPress}
      disabled={disabled}
      hasTVPreferredFocus={preferred}
      style={S.rowWrapper}
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      accessibilityRole={on === undefined ? "button" : "switch"}
      selected={on}
    >
      {(focused) => (
        <View style={[S.row, focused && S.rowFocused, disabled && S.rowDisabled]}>
          <View style={[S.rowIcon, focused && S.rowIconFocused]}>
            <Ionicons
              name={icon}
              size={ps(1.8)}
              color={focused ? "#000" : danger ? "#f87171" : "#fff"}
            />
          </View>
          <View style={S.rowText}>
            <Text style={[S.rowTitle, focused && S.onFocus, danger && !focused && { color: "#f87171" }]}>
              {title}
            </Text>
            <Text style={[S.rowSubtitle, focused && { color: "rgba(0,0,0,0.6)" }]} numberOfLines={2}>
              {subtitle}
            </Text>
          </View>
          {on === undefined ? (
            <Ionicons
              name="chevron-forward"
              size={ps(1.6)}
              color={focused ? "#000" : "rgba(255,255,255,0.3)"}
            />
          ) : (
            // Focused rows are white, so the off state and the knob both need
            // dark equivalents — a 14%-white track with a white knob on a white
            // row is a control you cannot see. Same fix as the categories
            // screen. The focused styles come last so they win.
            <View
              style={[
                S.switchTrack,
                on && S.switchTrackOn,
                focused && !on && S.switchTrackFocused,
              ]}
            >
              <View
                style={[
                  S.switchKnob,
                  on && S.switchKnobOn,
                  focused && !on && S.switchKnobFocused,
                ]}
              />
            </View>
          )}
        </View>
      )}
    </Focusable>
  );
}

export default function ParentalControlScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const channels = usePortalStore((s) => s.channels);
  const vodItems = usePortalStore((s) => s.vodItems);
  const series = usePortalStore((s) => s.series);

  const [state, setState] = useState<ParentalState | null>(null);
  /** Gate for the screen itself; false until the PIN is entered when required. */
  const [unlocked, setUnlocked] = useState(false);
  const [pinIntent, setPinIntent] = useState<PinIntent>(null);
  const [pendingPin, setPendingPin] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    parentalControl.load().then((s) => {
      setState({ ...s });
      // The gate only applies when the lock is on *and* set to cover settings.
      setUnlocked(!parentalControl.requiresPin("settings"));
      if (parentalControl.requiresPin("settings")) setPinIntent("enter");
    });
    return parentalControl.subscribe((s) => setState({ ...s }));
  }, []);

  const flash = useCallback((message: string) => {
    setNotice(message);
    setTimeout(() => setNotice((n) => (n === message ? null : n)), 2600);
  }, []);

  const lockedCount = state?.lockedItemIds.length ?? 0;
  const autoLockedCount = useMemo(() => {
    if (!state?.blockAdultKeywords) return 0;
    // Counted across all three libraries rather than listed: the point is to
    // show the keyword sweep is doing something, not to enumerate what it hit.
    const live = channels.filter((c) => parentalControl.isRestricted("live", c)).length;
    const movies = vodItems.filter((v) => parentalControl.isRestricted("vod", v)).length;
    const shows = series.filter((s) => parentalControl.isRestricted("series", s)).length;
    return Math.max(0, live + movies + shows - lockedCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, vodItems, series, state?.blockAdultKeywords, state?.lockedItemIds, lockedCount]);

  // ── PIN flow ──────────────────────────────────────────────────────────────

  const handlePinSubmit = useCallback(
    async (pin: string): Promise<boolean> => {
      switch (pinIntent) {
        case "enter":
          return parentalControl.unlock(pin);

        case "change-current":
          if (!parentalControl.verifyPin(pin)) return false;
          setPendingPin(pin);
          return true;

        case "change-new":
          // Any four digits are acceptable as a new PIN; the confirm step is
          // what catches a mistyped one.
          setPendingPin((current) => `${current}|${pin}`);
          return true;

        case "change-confirm": {
          const [currentPin, newPin] = pendingPin.split("|");
          if (pin !== newPin) return false;
          return parentalControl.setPin(currentPin, newPin);
        }

        default:
          return false;
      }
    },
    [pinIntent, pendingPin]
  );

  const handlePinSuccess = useCallback(() => {
    switch (pinIntent) {
      case "enter":
        setUnlocked(true);
        setPinIntent(null);
        break;
      case "change-current":
        setPinIntent("change-new");
        break;
      case "change-new":
        setPinIntent("change-confirm");
        break;
      case "change-confirm":
        setPinIntent(null);
        setPendingPin("");
        flash("PIN changed.");
        break;
      default:
        setPinIntent(null);
    }
  }, [pinIntent, flash]);

  const handlePinCancel = useCallback(() => {
    const wasGate = pinIntent === "enter";
    setPinIntent(null);
    setPendingPin("");
    // Backing out of the gate means leaving — staying would show the settings
    // the PIN was protecting.
    if (wasGate) router.back();
  }, [pinIntent, router]);

  const pinCopy = useMemo(() => {
    switch (pinIntent) {
      case "enter":
        return { title: "Parental Control", message: "Enter your PIN to change these settings." };
      case "change-current":
        return { title: "Current PIN", message: "Enter your current PIN to continue." };
      case "change-new":
        return { title: "New PIN", message: "Choose a new four-digit PIN." };
      case "change-confirm":
        return { title: "Confirm PIN", message: "Enter the new PIN once more." };
      default:
        return { title: "Enter PIN", message: "" };
    }
  }, [pinIntent]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const toggleScope = useCallback((scope: LockScope) => {
    parentalControl.setScope(scope, !parentalControl.snapshot.scopes[scope]);
  }, []);

  if (!state) {
    return (
      <View style={[S.container, { paddingTop: insets.top }]}>
        <CinematicBackground />
      </View>
    );
  }

  return (
    <View style={[S.container, { paddingTop: insets.top }]}>
      <CinematicBackground />
      <StatusBar hidden />

      <View style={S.header}>
        <Text style={S.headerTitle}>Parental Control</Text>
        <Text style={S.headerSubtitle}>
          {state.enabled
            ? `Locked: ${lockedCount} item${lockedCount === 1 ? "" : "s"}${autoLockedCount > 0 ? ` + ${autoLockedCount} matched by keyword` : ""}`
            : "The lock is currently off"}
        </Text>
      </View>

      {parentalControl.isDefaultPin && state.enabled ? (
        <View style={S.warning}>
          <Ionicons name="warning-outline" size={ps(1.4)} color="#fbbf24" />
          <Text style={S.warningText}>
            Still using the default PIN ({DEFAULT_PIN}). Change it below.
          </Text>
        </View>
      ) : null}

      {notice ? (
        <View style={S.notice}>
          <Ionicons name="checkmark-circle-outline" size={ps(1.4)} color="#4ade80" />
          <Text style={S.noticeText}>{notice}</Text>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={S.scroll} showsVerticalScrollIndicator={false}>
        <Text style={S.sectionLabel}>LOCK</Text>
        <FocusGroup style={S.group}>
          <Row
            icon="lock-closed-outline"
            title="Parental Lock"
            subtitle="Require a PIN for the content selected below"
            on={state.enabled}
            preferred={unlocked}
            onPress={() => parentalControl.setEnabled(!state.enabled)}
          />
          <Row
            icon="key-outline"
            title="Change PIN"
            subtitle="Four digits. The factory PIN is 0000."
            onPress={() => setPinIntent("change-current")}
          />
        </FocusGroup>

        <Text style={S.sectionLabel}>WHAT THE PIN GUARDS</Text>
        <FocusGroup style={S.group}>
          <Row
            icon="play-circle-outline"
            title="Watching locked channels"
            subtitle="A PIN is asked for before a locked channel plays"
            on={state.scopes.playback}
            disabled={!state.enabled}
            onPress={() => toggleScope("playback")}
          />
          <Row
            icon="settings-outline"
            title="Opening this menu"
            subtitle="Stops the lock being switched off by whoever it is for"
            on={state.scopes.settings}
            disabled={!state.enabled}
            onPress={() => toggleScope("settings")}
          />
          <Row
            icon="server-outline"
            title="Adding or changing portals"
            subtitle="Stops an unfiltered playlist being added around the lock"
            on={state.scopes.portals}
            disabled={!state.enabled}
            onPress={() => toggleScope("portals")}
          />
        </FocusGroup>

        <Text style={S.sectionLabel}>WHAT IS LOCKED</Text>
        <FocusGroup style={S.group}>
          <Row
            icon="eye-off-outline"
            title="Block adult channels automatically"
            subtitle="Matches XXX, Adult and similar names and categories"
            on={state.blockAdultKeywords}
            disabled={!state.enabled}
            onPress={() => parentalControl.setBlockAdultKeywords(!state.blockAdultKeywords)}
          />
          <Row
            icon="list-outline"
            title={`Manually locked items (${lockedCount})`}
            subtitle="Long-press a channel, movie or series to lock or unlock it"
            onPress={() => router.push("/live-tv")}
          />
          <Row
            icon="trash-outline"
            title="Clear all manual locks"
            subtitle="Removes every channel and category you locked by hand"
            danger
            disabled={parentalControl.manualLockCount === 0}
            onPress={async () => {
              await parentalControl.clearAllLocks();
              flash("Manual locks cleared.");
            }}
          />
        </FocusGroup>

        <Text style={S.footnote}>
          A correct PIN unlocks playback for 15 minutes, so a run of channel changes is not
          interrupted. Leaving the player relocks it.
        </Text>
      </ScrollView>

      <PinPrompt
        visible={!!pinIntent}
        title={pinCopy.title}
        message={pinCopy.message}
        onSubmit={handlePinSubmit}
        onSuccess={handlePinSuccess}
        onCancel={handlePinCancel}
      />
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.colors.background },

  header: { paddingHorizontal: pw(4), paddingTop: ph(2), paddingBottom: ph(1) },
  headerTitle: { color: "#fff", fontSize: ps(2), fontWeight: "900" },
  headerSubtitle: { color: THEME.colors.textDim, fontSize: ps(1), marginTop: ph(0.4) },

  warning: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(1),
    marginHorizontal: pw(4),
    marginBottom: ph(1),
    paddingHorizontal: pw(1.5),
    paddingVertical: ph(1),
    borderRadius: ps(0.9),
    backgroundColor: "rgba(251,191,36,0.1)",
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.28)",
  },
  warningText: { color: "#fcd34d", fontSize: ps(0.95), flex: 1 },

  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(1),
    marginHorizontal: pw(4),
    marginBottom: ph(1),
    paddingHorizontal: pw(1.5),
    paddingVertical: ph(1),
    borderRadius: ps(0.9),
    backgroundColor: "rgba(74,222,128,0.1)",
    borderWidth: 1,
    borderColor: "rgba(74,222,128,0.25)",
  },
  noticeText: { color: "#86efac", fontSize: ps(0.95), flex: 1 },

  scroll: { paddingHorizontal: pw(4), paddingBottom: ph(6) },
  sectionLabel: {
    color: "rgba(255,255,255,0.32)",
    fontSize: ps(0.85),
    fontWeight: "900",
    letterSpacing: 2,
    marginTop: ph(2),
    marginBottom: ph(0.8),
  },
  group: {
    borderRadius: ps(1.2),
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    overflow: "hidden",
  },

  rowWrapper: {},
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(1.5),
    paddingHorizontal: pw(2),
    paddingVertical: ph(1.6),
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  rowFocused: { backgroundColor: "#fff" },
  rowDisabled: { opacity: 0.4 },
  rowIcon: {
    width: ps(3.2),
    height: ps(3.2),
    borderRadius: ps(1.6),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  rowIconFocused: { backgroundColor: "rgba(0,0,0,0.08)" },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: "#fff", fontSize: ps(1.15), fontWeight: "700" },
  rowSubtitle: { color: "rgba(255,255,255,0.4)", fontSize: ps(0.9) },
  onFocus: { color: "#000" },

  switchTrack: {
    width: ps(3.2),
    height: ps(1.7),
    borderRadius: ps(0.85),
    backgroundColor: "rgba(255,255,255,0.14)",
    padding: 2,
    justifyContent: "center",
  },
  switchTrackOn: { backgroundColor: "#4ade80" },
  switchTrackFocused: { backgroundColor: "rgba(0,0,0,0.16)" },
  switchKnobFocused: { backgroundColor: "#0E0F14" },
  switchKnob: {
    width: ps(1.3),
    height: ps(1.3),
    borderRadius: ps(0.65),
    backgroundColor: "#fff",
  },
  switchKnobOn: { alignSelf: "flex-end", backgroundColor: "#0E0F14" },

  footnote: {
    color: "rgba(255,255,255,0.28)",
    fontSize: ps(0.9),
    marginTop: ph(2.5),
    lineHeight: ps(1.5),
  },
});
