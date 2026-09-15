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
import { BackHandler, ScrollView, StyleSheet, View } from "react-native";
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
import { THEME, ph, psRaw as ps, pw, PAGE_HEADER } from "../src/theme/tokens";
import { RADIUS } from "../src/theme/materials";
import { isPhone } from "../src/utils/phoneUtils";
import { isTouch } from "../src/utils/tabletUtils";
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
import * as P from "../src/theme/palette";

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
                    ? P.systemRedOnTint
                    : P.onTint
                  : danger
                    ? P.systemRed
                    : P.label
              }
            />
          </View>
          <View style={S.rowText}>
            <Text
              style={[
                S.rowTitle,
                focused && S.rowTitleFocused,
                danger && !focused && { color: P.systemRed },
                danger && focused && { color: P.systemRedOnTint },
              ]}
            >
              {title}
            </Text>
            {!isPhone ? (
              <Text
                style={[S.rowSubtitle, focused && S.rowSubtitleFocused]}
                numberOfLines={2}
              >
                {subtitle}
              </Text>
            ) : null}
          </View>
          {on === undefined ? (
            badge ? (
              <View style={[S.badgePill, focused && S.badgePillFocused]}>
                <Text style={[S.badgePillText, focused && S.badgePillTextFocused]}>
                  {badge}
                </Text>
                <ChevronRight
                  size={ps(1.8)}
                  color={focused ? P.onTint : P.secondaryLabel}
                />
              </View>
            ) : (
              <ChevronRight
                size={ps(2)}
                color={focused ? P.onTint : P.secondaryLabel}
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
      <View style={[
        S.header,
        isTouch && { paddingHorizontal: 24, paddingTop: ph(3) },
        isPhone && { paddingHorizontal: 14, paddingTop: 10 },
      ]}>
        {/* No byline. The enabled state is on the badge to the right, and both
            lock counts are on the rows they belong to. */}
        <View style={S.headerTitles}>
          <Text style={S.headerTitle}>Parental Control</Text>
        </View>

        {/* Protection Status Badge */}
        {state.enabled ? (
          <View style={S.statusBadge}>
            <View style={S.statusDotActive} />
            <ShieldCheck size={ps(1.6)} color={P.systemGreen} />
            <Text style={S.statusBadgeTextActive}>PROTECTED</Text>
          </View>
        ) : (
          <View style={[S.statusBadge, S.statusBadgeInactive]}>
            <View style={S.statusDotInactive} />
            <Unlock size={ps(1.6)} color={P.secondaryLabel} />
            <Text style={S.statusBadgeTextInactive}>UNPROTECTED</Text>
          </View>
        )}
      </View>

      {/* ── Default PIN Warning Banner ── */}
      {parentalControl.isDefaultPin && state.enabled ? (
        <View style={[S.warningCard, isTouch && { marginHorizontal: 24 }, isPhone && { marginHorizontal: 14 }]}>
          <View style={S.warningIconBox}>
            <TriangleAlert size={ps(2.2)} color={P.systemOrange} />
          </View>
          <View style={S.warningContent}>
            <Text style={S.warningTitle}>Default Factory PIN in Use ({DEFAULT_PIN})</Text>
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
        <View style={[S.noticeBanner, isTouch && { marginHorizontal: 24 }, isPhone && { marginHorizontal: 14 }]}>
          <CheckCircle size={ps(1.8)} color={P.systemGreen} />
          <Text style={S.noticeBannerText}>{notice}</Text>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={[
          S.scroll,
          isTouch && {
            paddingHorizontal: 24,
            paddingBottom: insets.bottom + 36,
          },
          isPhone && {
            paddingHorizontal: 14,
            paddingBottom: insets.bottom + 20,
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
          <Info size={ps(2)} color={P.secondaryLabel} style={S.infoCardIcon} />
          <View style={S.infoCardContent}>
            <Text style={S.infoCardTitle}>PIN Session Memory</Text>
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
  /**
   * A row rather than `PAGE_HEADER.bar`, because this screen hangs the
   * PROTECTED/UNPROTECTED badge off the right-hand end — but it takes the
   * shared bar's spacing so it still lines up with the pages either side of it
   * in the menu.
   *
   * The `paddingBottom` is the part that matters: it was `ph(3.5)`, which is a
   * percentage of the *short* edge and so lands around 14dp on a portrait
   * handset — and that was measured when the header still carried a subtitle
   * to separate it from the content below.
   */
  header: {
    ...PAGE_HEADER.bar,
    paddingTop: ph(5.5),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitles: {
    flex: 1,
  },
  // The bar itself stays a row — this screen hangs a status badge off the
  // right-hand end — but the type is the shared one.
  headerTitle: PAGE_HEADER.title,

  // ── Status Badge ──────────────────────────────────────────────────────────
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(0.8),
    paddingHorizontal: pw(1.6),
    paddingVertical: ph(0.9),
    borderRadius: ps(1.2),
    backgroundColor: "rgba(50, 215, 75, 0.12)",
  },
  statusBadgeInactive: {
    backgroundColor: P.quaternarySystemFill,
  },
  statusBadgeTextActive: {
    color: P.systemGreen,
    fontSize: isPhone ? 12.6 : ps(0.95),
    fontFamily: THEME.fonts.bold,
    letterSpacing: 1,
  },
  statusBadgeTextInactive: {
    color: P.secondaryLabel,
    fontSize: isPhone ? 12.6 : ps(0.95),
    fontFamily: THEME.fonts.bold,
    letterSpacing: 1,
  },
  statusDotActive: {
    width: ps(0.8),
    height: ps(0.8),
    borderRadius: ps(0.4),
    backgroundColor: P.systemGreen,
  },
  statusDotInactive: {
    width: ps(0.8),
    height: ps(0.8),
    borderRadius: ps(0.4),
    backgroundColor: "rgba(255, 255, 255, 0.4)",
  },

  warningCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(1.8),
    marginHorizontal: pw(8),
    marginBottom: ph(3.5),
    paddingHorizontal: pw(2),
    paddingVertical: ph(1.6),
    borderRadius: RADIUS.lg,
    borderCurve: "continuous",
    // The tinted fill separates this on its own; the outline it carried was a
    // second statement of the same thing.
    backgroundColor: "rgba(255, 159, 10, 0.12)",
  },
  warningIconBox: {
    width: ps(3.8),
    height: ps(3.8),
    borderRadius: RADIUS.full,
    backgroundColor: "rgba(255, 159, 10, 0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  warningContent: {
    flex: 1,
  },
  warningTitle: {
    color: P.systemOrange,
    fontSize: isPhone ? 13.8 : ps(1.15),
    fontFamily: THEME.fonts.bold,
  },
  warningBtnWrapper: {},
  warningBtn: {
    paddingHorizontal: pw(1.8),
    paddingVertical: ph(1.1),
    borderRadius: RADIUS.sm,
    borderCurve: "continuous",
    backgroundColor: P.systemOrange,
  },
  // Focus lifts the button from the warning colour to the tint. Both are light
  // fills, so the ink stays `onTint` through the change rather than inverting.
  warningBtnFocused: {
    backgroundColor: P.tint,
    transform: [{ scale: 1.05 }],
  },
  warningBtnText: {
    color: P.onTint,
    fontSize: isPhone ? 13 : ps(1.0),
    fontFamily: THEME.fonts.bold,
  },
  warningBtnTextFocused: {
    color: P.onTint,
  },

  noticeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(1.2),
    marginHorizontal: pw(8),
    marginBottom: ph(3.5),
    paddingHorizontal: pw(2),
    paddingVertical: ph(1.4),
    borderRadius: RADIUS.card,
    borderCurve: "continuous",
    backgroundColor: "rgba(50, 215, 75, 0.12)",
  },
  noticeBannerText: {
    color: P.systemGreen,
    fontSize: isPhone ? 13.8 : ps(1.05),
    fontFamily: THEME.fonts.semibold,
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
  // Shared — see `PAGE_HEADER.sectionLabel`. This one was 15.5 on a phone,
  // within a point of `rowTitle` below it.
  sectionLabel: {
    ...PAGE_HEADER.sectionLabel,
    marginBottom: ph(1.6),
    paddingLeft: pw(0.5),
  },
  group: {
    borderRadius: RADIUS.lg,
    borderCurve: "continuous",
    padding: ps(0.8),
    backgroundColor: P.secondaryElevatedSystemBackground,
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
    // Tighter now that a row is one line rather than two — at the old
    // `ph(2)` the rows kept the height they had when they carried a
    // description, and read as mostly empty.
    paddingVertical: ph(1.5),
    borderRadius: RADIUS.card,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: "transparent",
  },
  // The fill carries focus on its own; a near-white edge on a near-white fill
  // was drawing a border nobody could see.
  rowFocused: {
    backgroundColor: P.tint,
    borderColor: P.tint,
  },
  rowDisabled: {
    opacity: 0.38,
  },
  iconBadge: {
    width: ps(4.2),
    height: ps(4.2),
    borderRadius: RADIUS.card,
    borderCurve: "continuous",
    backgroundColor: P.quaternarySystemFill,
    alignItems: "center",
    justifyContent: "center",
  },
  // On a focused row the badge sits on the off-white fill, so it deepens
  // rather than lightens — the same inversion the ink makes.
  iconBadgeFocused: {
    backgroundColor: "rgba(28, 28, 30, 0.10)",
  },
  iconBadgeDanger: {
    backgroundColor: "rgba(255, 69, 58, 0.15)",
  },
  iconBadgeDangerFocused: {
    backgroundColor: "rgba(179, 37, 27, 0.15)",
  },
  rowText: {
    flex: 1,
    justifyContent: "center",
    paddingRight: pw(1),
  },
  rowTitle: {
    fontSize: isPhone ? 15 : ps(1.7),
    color: P.label,
    fontFamily: THEME.fonts.semibold,
  },
  rowTitleFocused: {
    color: P.onTint,
    fontFamily: THEME.fonts.bold,
  },
  /**
   * Drawn on TV and tablet only — the same split settings uses, and for the
   * same reason: a box is read across a room with a remote and has a wide row
   * with space to spare, while a handset has the setting an inch from the eye
   * and a column too narrow to carry it.
   *
   * It stays the Focusable's accessibilityHint on every tier, so a screen
   * reader on a phone still gets the explanation the line does not draw.
   *
   * A focused row fills with the off-white tint, so both levels of ink invert.
   */
  rowSubtitle: {
    fontSize: ps(1.5),
    color: P.secondaryLabel,
    fontFamily: THEME.fonts.regular,
    marginTop: ph(0.3),
    // 1.4x the size. Generous for a regular face, but these lines are long and
    // read from a distance, and Inter needs ~1.21 as a floor.
    lineHeight: ps(2.1),
  },
  rowSubtitleFocused: {
    color: P.onTintSecondary,
  },

  badgePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(0.6),
    paddingHorizontal: pw(1.2),
    paddingVertical: ph(0.6),
    borderRadius: RADIUS.full,
    backgroundColor: P.tertiarySystemFill,
  },
  badgePillFocused: {
    backgroundColor: "rgba(28, 28, 30, 0.10)",
  },
  badgePillText: {
    color: P.label,
    fontSize: isPhone ? 12.6 : ps(0.95),
    fontFamily: THEME.fonts.semibold,
  },
  badgePillTextFocused: {
    color: P.onTint,
    fontFamily: THEME.fonts.bold,
  },

  // ── Switch ────────────────────────────────────────────────────────────────
  /*
   * Absolute geometry on a phone, same as the settings and categories
   * switches: the track was `ph(3.2)` = 13dp tall and the knob `ps(1.6)` = 12,
   * so after 2dp of padding and a 1dp border the knob was larger than the
   * 6.6dp of room holding it.
   */
  switchTrack: {
    width: isPhone ? 44 : pw(4.2),
    height: isPhone ? 26 : ph(3.2),
    minWidth: isPhone ? 44 : ps(3.8),
    borderRadius: RADIUS.full,
    backgroundColor: P.tertiarySystemFill,
    justifyContent: "center",
    padding: isPhone ? 3 : 2,
  },
  // On a focused row the switch sits on the off-white fill, so its track
  // deepens rather than lightens — the same inversion the ink and the icon
  // badge make.
  switchTrackFocused: {
    backgroundColor: "rgba(28, 28, 30, 0.15)",
  },
  // `#4ADE80` — Tailwind's green in uppercase, which is how it survived the
  // sweep that replaced every lowercase spelling of it.
  switchTrackOn: {
    backgroundColor: P.systemGreen,
  },
  switchTrackOnFocused: {
    backgroundColor: P.systemGreen,
  },
  switchKnob: {
    width: isPhone ? 18 : ps(1.6),
    height: isPhone ? 18 : ps(1.6),
    borderRadius: RADIUS.full,
    // Solid, not 60% white. The knob is the part that says which way the
    // switch is thrown, and it has to hold against both the grey track and the
    // green one.
    backgroundColor: P.label,
  },
  switchKnobFocused: {
    backgroundColor: P.onTint,
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
    // Neutral, not the blue this was. An explanatory card is not a status —
    // it is not telling you something succeeded, failed or needs attention —
    // so it takes a plain surface and lets the three status colours keep their
    // meaning. It was also the last blue left in the app.
    backgroundColor: P.quaternarySystemFill,
    borderRadius: RADIUS.lg,
    borderCurve: "continuous",
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
    color: P.label,
    fontSize: isPhone ? 13.8 : ps(1.05),
    fontFamily: THEME.fonts.bold,
  },
});
