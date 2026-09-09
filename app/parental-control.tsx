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
import { BackHandler, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePortalStore } from "../src/store/portalStore";
import {
  DEFAULT_PIN,
  LockScope,
  parentalControl,
  ParentalState,
} from "../src/services/parentalControl";
import { safeBack } from "../src/services/safeNavigation";
import { CinematicBackground } from "../src/components/CinematicBackground";
import PinPrompt from "../src/components/PinPrompt";
import { THEME, ph, psRaw as ps, pw } from "../src/theme/tokens";
import { isTablet } from "../src/utils/tabletUtils";
import { Focusable, FocusGroup } from "../src/tv";
import {
  CheckCircle,
  ChevronRight,
  Info,
  ShieldCheck,
  TriangleAlert,
  Unlock,
} from "lucide-react-native";
import { DynamicIcon } from "../src/components/DynamicIcon";
import { Text } from "../src/components/Text";

type IconName = string;

/** What the PIN prompt is currently being asked for. */
type PinIntent = "enter" | "change-current" | "change-new" | "change-confirm" | null;

const SCREEN_KEY = "parental-control";

function Row({
  icon,
  title,
  subtitle,
  on,
  onPress,
  preferred,
  disabled,
  danger,
  badge,
  focusKey,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  on?: boolean;
  onPress: () => void;
  preferred?: boolean;
  disabled?: boolean;
  danger?: boolean;
  badge?: string;
  focusKey?: string;
}) {
  return (
    <Focusable
      ringOnFocus={false}
      onPress={onPress}
      disabled={disabled}
      hasTVPreferredFocus={preferred}
      style={S.rowWrapper}
      focusKey={focusKey}
      screenKey={SCREEN_KEY}
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      accessibilityRole={on === undefined ? "button" : "switch"}
      selected={on}
    >
      {(focused) => (
        <View style={[S.row, focused && S.rowFocused, disabled && S.rowDisabled]}>
          <View
            style={[
              S.iconBadge,
              focused && S.iconBadgeFocused,
              danger && !focused && S.iconBadgeDanger,
              danger && focused && S.iconBadgeDangerFocused,
            ]}
          >
            <DynamicIcon
              name={icon}
              size={ps(2.2)}
              color={
                focused
                  ? danger
                    ? "#dc2626"
                    : "#0E0F14"
                  : danger
                    ? "#f87171"
                    : "#ffffff"
              }
            />
          </View>
          <View style={S.rowText}>
            <Text
              style={[
                S.rowTitle,
                focused && S.rowTitleFocused,
                danger && !focused && { color: "#f87171" },
                danger && focused && { color: "#dc2626" },
              ]}
            >
              {title}
            </Text>
            <Text
              style={[S.rowSubtitle, focused && S.rowSubtitleFocused]}
              numberOfLines={2}
            >
              {subtitle}
            </Text>
          </View>
          {on === undefined ? (
            badge ? (
              <View style={[S.badgePill, focused && S.badgePillFocused]}>
                <Text style={[S.badgePillText, focused && S.badgePillTextFocused]}>
                  {badge}
                </Text>
                <ChevronRight
                  size={ps(1.8)}
                  color={focused ? "#0E0F14" : "rgba(255,255,255,0.4)"}
                />
              </View>
            ) : (
              <ChevronRight
                size={ps(2)}
                color={focused ? "#0E0F14" : "rgba(255,255,255,0.35)"}
              />
            )
          ) : (
            <View
              style={[
                S.switchTrack,
                focused && S.switchTrackFocused,
                on && S.switchTrackOn,
                on && focused && S.switchTrackOnFocused,
              ]}
            >
              <View
                style={[
                  S.switchKnob,
                  focused && S.switchKnobFocused,
                  on && S.switchKnobOn,
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
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isPortrait = isTablet && windowHeight > windowWidth;
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
      const needsGate = parentalControl.requiresPin("settings");
      setUnlocked(!needsGate);
      if (needsGate) setPinIntent("enter");
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
    const live = channels.filter((c) => parentalControl.isRestricted("live", c)).length;
    const movies = vodItems.filter((v) => parentalControl.isRestricted("vod", v)).length;
    const shows = series.filter((s) => parentalControl.isRestricted("series", s)).length;
    return Math.max(0, live + movies + shows - lockedCount);
  }, [channels, vodItems, series, state?.blockAdultKeywords, lockedCount]);

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
        flash("PIN successfully updated.");
        break;
      default:
        setPinIntent(null);
    }
  }, [pinIntent, flash]);

  const handlePinCancel = useCallback(() => {
    const wasGate = pinIntent === "enter";
    setPinIntent(null);
    setPendingPin("");
    if (wasGate) safeBack();
  }, [pinIntent]);

  // Register hardware back press handler
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (pinIntent) {
        handlePinCancel();
        return true;
      }
      return safeBack();
    });
    return () => sub.remove();
  }, [pinIntent, handlePinCancel]);

  const pinCopy = useMemo(() => {
    switch (pinIntent) {
      case "enter":
        return {
          title: "Parental Security",
          message: "Enter your four-digit PIN to access parental settings.",
        };
      case "change-current":
        return {
          title: "Current PIN",
          message: "Enter your current PIN to authenticate.",
        };
      case "change-new":
        return {
          title: "New PIN",
          message: "Choose a new four-digit PIN.",
        };
      case "change-confirm":
        return {
          title: "Confirm New PIN",
          message: "Re-enter the new PIN to confirm.",
        };
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

      {/* ── Header ── */}
      <View style={[S.header, isTablet && { paddingHorizontal: 24, paddingTop: ph(3), paddingBottom: ph(2) }]}>
        <View style={S.headerTitles}>
          <Text style={S.headerTitle}>Parental Control</Text>
          <Text style={S.headerSubtitle}>
            {state.enabled
              ? `Active security · ${lockedCount} manually locked${
                  autoLockedCount > 0 ? ` + ${autoLockedCount} keyword matched` : ""
                }`
              : "Parental lock is currently turned off"}
          </Text>
        </View>

        {/* Protection Status Badge */}
        {state.enabled ? (
          <View style={S.statusBadge}>
            <View style={S.statusDotActive} />
            <ShieldCheck size={ps(1.6)} color="#4ade80" />
            <Text style={S.statusBadgeTextActive}>PROTECTED</Text>
          </View>
        ) : (
          <View style={[S.statusBadge, S.statusBadgeInactive]}>
            <View style={S.statusDotInactive} />
            <Unlock size={ps(1.6)} color="rgba(255,255,255,0.4)" />
            <Text style={S.statusBadgeTextInactive}>UNPROTECTED</Text>
          </View>
        )}
      </View>

      {/* ── System Overview Stats ── */}
      <View style={[S.statsRow, isTablet && { paddingHorizontal: 24 }, isTablet && isPortrait && { flexWrap: "wrap", gap: 10 }]}>
        <View style={[S.statCard, isTablet && isPortrait && { minWidth: "48%" }]}>
          <Text style={S.statLabel}>System State</Text>
          <Text
            style={[
              S.statValue,
              { color: state.enabled ? "#4ade80" : "rgba(255,255,255,0.5)" },
            ]}
          >
            {state.enabled ? "Active" : "Disabled"}
          </Text>
        </View>
        <View style={[S.statCard, isTablet && isPortrait && { minWidth: "48%" }]}>
          <Text style={S.statLabel}>Manually Locked</Text>
          <Text style={S.statValue}>
            {lockedCount} {lockedCount === 1 ? "Item" : "Items"}
          </Text>
        </View>
        <View style={[S.statCard, isTablet && isPortrait && { minWidth: "48%" }]}>
          <Text style={S.statLabel}>Adult Keyword Filter</Text>
          <Text
            style={[
              S.statValue,
              { color: state.blockAdultKeywords ? "#60a5fa" : "rgba(255,255,255,0.5)" },
            ]}
          >
            {state.blockAdultKeywords
              ? autoLockedCount > 0
                ? `${autoLockedCount} Filtered`
                : "Active"
              : "Off"}
          </Text>
        </View>
        <View style={[S.statCard, isTablet && isPortrait && { minWidth: "48%" }]}>
          <Text style={S.statLabel}>PIN Mode</Text>
          <Text
            style={[
              S.statValue,
              { color: parentalControl.isDefaultPin ? "#fbbf24" : "#4ade80" },
            ]}
          >
            {parentalControl.isDefaultPin ? "Factory (0000)" : "Custom PIN"}
          </Text>
        </View>
      </View>

      {/* ── Default PIN Warning Banner ── */}
      {parentalControl.isDefaultPin && state.enabled ? (
        <View style={[S.warningCard, isTablet && { marginHorizontal: 24 }]}>
          <View style={S.warningIconBox}>
            <TriangleAlert size={ps(2.2)} color="#fbbf24" />
          </View>
          <View style={S.warningContent}>
            <Text style={S.warningTitle}>Default Factory PIN in Use ({DEFAULT_PIN})</Text>
            <Text style={S.warningText}>
              Your lock is active with the default factory PIN. Anyone can bypass restrictions.
              Please update to a personal 4-digit PIN.
            </Text>
          </View>
          <Focusable
            ringOnFocus={false}
            onPress={() => setPinIntent("change-current")}
            style={S.warningBtnWrapper}
            focusKey="pc-fix-pin-btn"
            screenKey={SCREEN_KEY}
            accessibilityLabel="Change default PIN"
            accessibilityRole="button"
          >
            {(focused) => (
              <View style={[S.warningBtn, focused && S.warningBtnFocused]}>
                <Text
                  style={[S.warningBtnText, focused && S.warningBtnTextFocused]}
                >
                  Change PIN
                </Text>
              </View>
            )}
          </Focusable>
        </View>
      ) : null}

      {/* ── Notice Toast ── */}
      {notice ? (
        <View style={[S.noticeBanner, isTablet && { marginHorizontal: 24 }]}>
          <CheckCircle size={ps(1.8)} color="#4ade80" />
          <Text style={S.noticeBannerText}>{notice}</Text>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={[
          S.scroll,
          isTablet && {
            paddingHorizontal: 24,
            paddingBottom: insets.bottom + 36,
          },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Section 1: Security Master */}
        <View style={S.rootSection}>
          <Text style={S.sectionLabel}>SECURITY & MASTER LOCK</Text>
          <FocusGroup style={S.group}>
            <Row
              icon="lock-closed-outline"
              title="Parental Lock"
              subtitle="Require a PIN for all protected content and selected scopes"
              on={state.enabled}
              preferred={unlocked}
              focusKey="pc-master-lock"
              onPress={() => parentalControl.setEnabled(!state.enabled)}
            />
            <Row
              icon="key-outline"
              title="Change PIN"
              subtitle="Four-digit security code used to unlock channels and menus"
              badge={parentalControl.isDefaultPin ? "Factory (0000)" : "Custom PIN"}
              focusKey="pc-change-pin"
              onPress={() => setPinIntent("change-current")}
            />
          </FocusGroup>
        </View>

        {/* Section 2: Scopes */}
        <View style={S.rootSection}>
          <Text style={S.sectionLabel}>WHAT THE PIN GUARDS</Text>
          <FocusGroup style={S.group}>
            <Row
              icon="play-circle-outline"
              title="Watching Locked Channels"
              subtitle="Prompt for PIN before playing restricted live channels, movies, or series"
              on={state.scopes.playback}
              disabled={!state.enabled}
              focusKey="pc-guard-playback"
              onPress={() => toggleScope("playback")}
            />
            <Row
              icon="settings-outline"
              title="Opening Settings & Parental Menus"
              subtitle="Stops the lock or system settings being altered without the PIN"
              on={state.scopes.settings}
              disabled={!state.enabled}
              focusKey="pc-guard-settings"
              onPress={() => toggleScope("settings")}
            />
            <Row
              icon="server-outline"
              title="Adding or Modifying Portals"
              subtitle="Stops external or unmoderated playlists from being configured around the lock"
              on={state.scopes.portals}
              disabled={!state.enabled}
              focusKey="pc-guard-portals"
              onPress={() => toggleScope("portals")}
            />
          </FocusGroup>
        </View>

        {/* Section 3: Restrictions */}
        <View style={S.rootSection}>
          <Text style={S.sectionLabel}>CONTENT RESTRICTIONS</Text>
          <FocusGroup style={S.group}>
            <Row
              icon="eye-off-outline"
              title="Block Adult Channels Automatically"
              subtitle="Automatically filters titles matching adult keywords and adult categories"
              badge={autoLockedCount > 0 ? `${autoLockedCount} detected` : undefined}
              on={state.blockAdultKeywords}
              disabled={!state.enabled}
              focusKey="pc-block-adult"
              onPress={() =>
                parentalControl.setBlockAdultKeywords(!state.blockAdultKeywords)
              }
            />
            <Row
              icon="list-outline"
              title="Manage Locked Items"
              subtitle="Long-press any channel, movie or series in Live TV / Movies to lock or unlock it"
              badge={`${lockedCount} locked`}
              focusKey="pc-manage-locks"
              onPress={() => router.push("/live-tv")}
            />
            <Row
              icon="trash-outline"
              title="Clear All Manual Locks"
              subtitle="Remove locks from every channel, movie and category you flagged by hand"
              danger
              disabled={parentalControl.manualLockCount === 0}
              focusKey="pc-clear-locks"
              onPress={async () => {
                await parentalControl.clearAllLocks();
                flash("All manual locks cleared.");
              }}
            />
          </FocusGroup>
        </View>

        {/* Info Footnote Card */}
        <View style={S.infoCard}>
          <Info size={ps(2)} color="#93c5fd" style={S.infoCardIcon} />
          <View style={S.infoCardContent}>
            <Text style={S.infoCardTitle}>PIN Session Memory</Text>
            <Text style={S.infoCardText}>
              Entering a correct PIN unlocks playback for 15 minutes to allow uninterrupted
              channel zapping. Exiting the player relocks all protected content immediately.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* PIN Prompt Modal */}
      <PinPrompt
        visible={!!pinIntent}
        resetKey={pinIntent ?? ""}
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
  container: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    paddingHorizontal: pw(8),
    paddingTop: ph(5.5),
    paddingBottom: ph(3.5),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitles: {
    flex: 1,
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: ps(2.6),
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    color: "rgba(255, 255, 255, 0.55)",
    fontSize: ps(1.15),
    marginTop: ph(0.8),
  },

  // ── Status Badge ──────────────────────────────────────────────────────────
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(0.8),
    paddingHorizontal: pw(1.6),
    paddingVertical: ph(0.9),
    borderRadius: ps(1.2),
    backgroundColor: "rgba(74, 222, 128, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(74, 222, 128, 0.3)",
  },
  statusBadgeInactive: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: "rgba(255, 255, 255, 0.12)",
  },
  statusBadgeTextActive: {
    color: "#4ade80",
    fontSize: ps(1.1),
    fontWeight: "800",
    letterSpacing: 1,
  },
  statusBadgeTextInactive: {
    color: "rgba(255, 255, 255, 0.5)",
    fontSize: ps(1.1),
    fontWeight: "800",
    letterSpacing: 1,
  },
  statusDotActive: {
    width: ps(0.8),
    height: ps(0.8),
    borderRadius: ps(0.4),
    backgroundColor: "#4ade80",
  },
  statusDotInactive: {
    width: ps(0.8),
    height: ps(0.8),
    borderRadius: ps(0.4),
    backgroundColor: "rgba(255, 255, 255, 0.4)",
  },

  // ── Stats Summary Row ─────────────────────────────────────────────────────
  statsRow: {
    flexDirection: "row",
    gap: pw(1.5),
    paddingHorizontal: pw(8),
    marginBottom: ph(3.5),
  },
  statCard: {
    flex: 1,
    backgroundColor: "#17181c",
    borderRadius: ps(1.4),
    paddingHorizontal: pw(1.8),
    paddingVertical: ph(1.8),
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.06)",
  },
  statLabel: {
    color: "rgba(255, 255, 255, 0.45)",
    fontSize: ps(0.88),
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  statValue: {
    color: "#FFFFFF",
    fontSize: ps(1.4),
    fontWeight: "800",
    marginTop: ph(0.6),
  },

  // ── Warning & Notice ──────────────────────────────────────────────────────
  warningCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(1.8),
    marginHorizontal: pw(8),
    marginBottom: ph(3.5),
    paddingHorizontal: pw(2),
    paddingVertical: ph(1.6),
    borderRadius: ps(1.6),
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.35)",
  },
  warningIconBox: {
    width: ps(3.8),
    height: ps(3.8),
    borderRadius: ps(1.9),
    backgroundColor: "rgba(245, 158, 11, 0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  warningContent: {
    flex: 1,
  },
  warningTitle: {
    color: "#fbbf24",
    fontSize: ps(1.3),
    fontWeight: "800",
  },
  warningText: {
    color: "rgba(251, 191, 36, 0.85)",
    fontSize: ps(1.05),
    marginTop: ph(0.3),
    lineHeight: ps(1.45),
  },
  warningBtnWrapper: {},
  warningBtn: {
    paddingHorizontal: pw(1.8),
    paddingVertical: ph(1.1),
    borderRadius: ps(1),
    backgroundColor: "#fbbf24",
  },
  warningBtnFocused: {
    backgroundColor: "#FFFFFF",
    transform: [{ scale: 1.05 }],
  },
  warningBtnText: {
    color: "#0E0F14",
    fontSize: ps(1.15),
    fontWeight: "900",
  },
  warningBtnTextFocused: {
    color: "#0E0F14",
  },

  noticeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(1.2),
    marginHorizontal: pw(8),
    marginBottom: ph(3.5),
    paddingHorizontal: pw(2),
    paddingVertical: ph(1.4),
    borderRadius: ps(1.4),
    backgroundColor: "rgba(74, 222, 128, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(74, 222, 128, 0.35)",
  },
  noticeBannerText: {
    color: "#86efac",
    fontSize: ps(1.2),
    fontWeight: "700",
    flex: 1,
  },

  // ── Scroll & Content ──────────────────────────────────────────────────────
  scroll: {
    paddingHorizontal: pw(8),
    paddingBottom: ph(8),
  },
  rootSection: {
    marginBottom: ph(4.5),
  },
  sectionLabel: {
    fontSize: ps(1.35),
    fontWeight: "900",
    color: "rgba(255, 255, 255, 0.65)",
    letterSpacing: 2,
    marginBottom: ph(1.6),
    paddingLeft: pw(0.5),
  },
  group: {
    borderRadius: 18,
    padding: ps(0.8),
    backgroundColor: "#17181c",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.05)",
    overflow: "hidden",
  },

  // ── Rows ──────────────────────────────────────────────────────────────────
  rowWrapper: {
    marginBottom: ph(0.4),
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(1.8),
    paddingHorizontal: pw(2),
    paddingVertical: ph(2),
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: "transparent",
  },
  rowFocused: {
    backgroundColor: "#F5F5F5",
    borderColor: "#FFFFFF",
  },
  rowDisabled: {
    opacity: 0.38,
  },
  iconBadge: {
    width: ps(4.2),
    height: ps(4.2),
    borderRadius: ps(1.2),
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  iconBadgeFocused: {
    backgroundColor: "rgba(0, 0, 0, 0.08)",
  },
  iconBadgeDanger: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
  },
  iconBadgeDangerFocused: {
    backgroundColor: "rgba(220, 38, 38, 0.15)",
  },
  rowText: {
    flex: 1,
    paddingRight: pw(1),
  },
  rowTitle: {
    fontSize: ps(1.45),
    color: "#FFFFFF",
    fontWeight: "700",
  },
  rowTitleFocused: {
    color: "#0E0F14",
    fontWeight: "900",
  },
  rowSubtitle: {
    fontSize: ps(1.1),
    color: "rgba(255, 255, 255, 0.55)",
    marginTop: 3,
    lineHeight: ps(1.5),
  },
  rowSubtitleFocused: {
    color: "rgba(0, 0, 0, 0.65)",
  },

  badgePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(0.6),
    paddingHorizontal: pw(1.2),
    paddingVertical: ph(0.6),
    borderRadius: ps(0.8),
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  badgePillFocused: {
    backgroundColor: "rgba(0, 0, 0, 0.08)",
  },
  badgePillText: {
    color: "rgba(255, 255, 255, 0.8)",
    fontSize: ps(1.05),
    fontWeight: "700",
  },
  badgePillTextFocused: {
    color: "#0E0F14",
    fontWeight: "800",
  },

  // ── Switch ────────────────────────────────────────────────────────────────
  switchTrack: {
    width: pw(4.2),
    height: ph(3.2),
    minWidth: ps(3.8),
    borderRadius: ps(1.6),
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    padding: 2,
  },
  switchTrackFocused: {
    backgroundColor: "rgba(0, 0, 0, 0.15)",
    borderColor: "rgba(0, 0, 0, 0.3)",
  },
  switchTrackOn: {
    backgroundColor: "#4ADE80",
    borderColor: "#4ADE80",
  },
  switchTrackOnFocused: {
    backgroundColor: "#22c55e",
    borderColor: "#22c55e",
  },
  switchKnob: {
    width: ps(1.6),
    height: ps(1.6),
    borderRadius: ps(0.8),
    backgroundColor: "rgba(255, 255, 255, 0.6)",
  },
  switchKnobFocused: {
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  switchKnobOn: {
    alignSelf: "flex-end",
    backgroundColor: "#0E0F14",
  },

  // ── Info Footnote Card ────────────────────────────────────────────────────
  infoCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: pw(1.6),
    backgroundColor: "rgba(59, 130, 246, 0.08)",
    borderRadius: ps(1.6),
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.2)",
    paddingHorizontal: pw(2),
    paddingVertical: ph(1.8),
    marginTop: ph(1),
    marginBottom: ph(6),
  },
  infoCardIcon: {
    marginTop: ph(0.2),
  },
  infoCardContent: {
    flex: 1,
  },
  infoCardTitle: {
    color: "#93c5fd",
    fontSize: ps(1.2),
    fontWeight: "800",
  },
  infoCardText: {
    color: "rgba(147, 197, 253, 0.85)",
    fontSize: ps(1.05),
    lineHeight: ps(1.5),
    marginTop: ph(0.3),
  },
});
