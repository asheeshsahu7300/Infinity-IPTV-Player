import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Platform, Image } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';

import { safeStorage } from '../src/services/safeStorage';
import { usePortalStore } from '../src/store/portalStore';
import { BUFFER_PROFILES, stbEnvironment, StbSettings } from '../src/services/stbEnvironment';
import { parentalControl } from '../src/services/parentalControl';
import { epgService } from '../src/services/epgService';
import { hiddenCategories } from '../src/services/hiddenCategories';
import PinPrompt from '../src/components/PinPrompt';
import { THEME, pw, ph, psRaw as ps } from '../src/theme/tokens';
import { Focusable, FocusGroup, FocusMemory, useFocusRestore } from '../src/tv';
import { CinematicBackground } from '../src/components/CinematicBackground';
import { useDialog } from '../src/components/ConfirmDialog';
import { ArrowLeftRight, ChevronRight, LogOut } from 'lucide-react-native';
import { DynamicIcon } from '../src/components/DynamicIcon';
import { Text } from '../src/components/Text';


type IconName = string;

const SCREEN_KEY = 'settings';

// ── Row primitives ───────────────────────────────────────────────────────────

/** What sits at the trailing edge of a row. Declarative rather than a render
 *  prop so the row itself owns the focused styling of its control. */
type RowControl =
  | { kind: 'switch'; on: boolean }
  | { kind: 'chevron' }
  /** A setting that cycles through named states rather than toggling. */
  | { kind: 'value'; text: string };

function RowControlView({ control, focused }: { control: RowControl; focused: boolean }) {
  if (control.kind === 'switch') {
    return (
      <View style={[S.switchTrack, focused && S.switchTrackFocused, control.on && S.switchTrackOn, control.on && focused && S.switchTrackOnFocused]}>
        <View style={[S.switchKnob, control.on && S.switchKnobOn, focused && S.switchKnobFocused]} />
      </View>
    );
  }
  if (control.kind === 'value') {
    return (
      <View style={[S.valuePill, focused && S.valuePillFocused]}>
        <Text style={[S.valuePillText, focused && { color: '#fff' }]}>{control.text}</Text>
      </View>
    );
  }
  return <ChevronRight size={ps(2)} color={focused ? '#000' : 'rgba(255,255,255,0.3)'} />;
}

interface SettingRowProps {
  icon: IconName;
  title: string;
  subtitle: string;
  focusKey: string;
  onPress: () => void;
  control: RowControl;
  preferred?: boolean;
  accessibilityRole?: 'button' | 'switch';
  selected?: boolean;
}

function SettingRow({
  icon,
  title,
  subtitle,
  focusKey,
  onPress,
  control,
  preferred,
  accessibilityRole = 'button',
  selected,
}: SettingRowProps) {
  return (
    <Focusable
      ringOnFocus={false}
      onPress={onPress}
      style={S.row}
      focusStyle={S.rowFocused}
      screenKey={SCREEN_KEY}
      focusKey={focusKey}
      hasTVPreferredFocus={preferred}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      selected={selected}
    >
      {(focused) => (
        <>
          <DynamicIcon
            name={icon}
            size={ps(2.6)}
            color={focused ? '#000' : 'rgba(255,255,255,0.75)'}
            style={S.rowIcon}
          />
          <View style={S.rowText}>
            <Text style={[S.rowTitle, focused && S.rowTitleFocused]}>{title}</Text>
            <Text style={[S.rowSubtitle, focused && S.rowSubtitleFocused]} numberOfLines={2}>
              {subtitle}
            </Text>
          </View>
          <RowControlView control={control} focused={focused} />
        </>
      )}
    </Focusable>
  );
}

interface DataTileProps {
  icon: IconName;
  title: string;
  subtitle: string;
  focusKey: string;
  onPress: () => void;
  /** Optional value badge on the trailing edge (e.g. the overscan amount). */
  value?: string;
}

function DataTile({ icon, title, subtitle, focusKey, onPress, value }: DataTileProps) {
  return (
    <Focusable
      ringOnFocus={false}
      onPress={onPress}
      style={S.tileWrapper}
      screenKey={SCREEN_KEY}
      focusKey={focusKey}
      accessibilityLabel={title}
      accessibilityHint={subtitle}
    >
      {(focused) => (
        <View style={[S.tile, focused && S.tileFocused]}>
          <DynamicIcon
            name={icon}
            size={ps(2.5)}
            color={focused ? '#000' : 'rgba(255,255,255,0.75)'}
            style={S.tileIcon}
          />
          <View style={S.tileText}>
            <View style={S.tileHeaderRow}>
              <Text style={[S.tileTitle, focused && S.tileTitleFocused]} numberOfLines={1}>
                {title}
              </Text>
              {value ? (
                <View style={[S.valuePill, focused && S.valuePillFocused]}>
                  <Text style={[S.valuePillText, focused && { color: '#fff' }]}>{value}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[S.tileSubtitle, focused && S.tileSubtitleFocused]} numberOfLines={2}>
              {subtitle}
            </Text>
          </View>
        </View>
      )}
    </Focusable>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <Text style={S.sectionLabel}>{children}</Text>;
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Selectors — see the note in live-tv.tsx.
  const activePortal = usePortalStore((s) => s.activePortal);
  const setActivePortal = usePortalStore((s) => s.setActivePortal);
  const clearPortalData = usePortalStore((s) => s.clearPortalData);
  const clearPersistedPortalData = usePortalStore((s) => s.clearPersistedPortalData);

  const overscanPadding = usePortalStore((s) => s.overscanPadding);
  const setOverscanPadding = usePortalStore((s) => s.setOverscanPadding);

  const [hardwareAcceleration, setHardwareAcceleration] = useState(true);

  // Set-top-box settings live in their own store; the switch above predates it
  // and still writes app_settings, so stbEnvironment mirrors that one key.
  const [stb, setStb] = useState<StbSettings>(() => stbEnvironment.snapshot);
  const [parentalOn, setParentalOn] = useState(() => parentalControl.isEnabled);
  const [hiddenCategoryCount, setHiddenCategoryCount] = useState(() => hiddenCategories.count);
  /** Set when the parental lock guards this screen and the PIN is still owed. */
  const [pinGateTarget, setPinGateTarget] = useState<null | 'parental' | 'portals'>(null);

  // Confirmations run through an in-tree overlay rather than `Alert.alert`,
  // which never reliably surfaces on an Android TV release build.
  const { open: openDialog, close: closeDialog, node: dialogNode } = useDialog();

  // Initial focus goes to the first non-destructive control; on re-entry the
  // last-focused row wins instead.
  const autoFocusFirst = useFocusRestore(SCREEN_KEY, true);

  const isFirstFocusRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      // Coming back from a pushed screen (the privacy policy) leaves native
      // focus nowhere in particular, so put it back where the user left it.
      if (isFirstFocusRef.current) {
        isFirstFocusRef.current = false;
        if (activePortal) {
          FocusMemory.set(SCREEN_KEY, 'switch-portal');
        }
        return;
      }
      FocusMemory.restoreWithRetry(SCREEN_KEY);
    }, [activePortal])
  );

  // Load settings on mount
  useEffect(() => {
    (async () => {
      try {
        const settings = await safeStorage.getItem('app_settings');
        if (settings) {
          const parsed = JSON.parse(settings);
          setHardwareAcceleration(parsed.hardwareAcceleration ?? true);
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
      }
    })();
  }, []);

  useEffect(() => {
    stbEnvironment.load().then((s) => setStb({ ...s }));
    parentalControl.load().then(() => setParentalOn(parentalControl.isEnabled));
    const unsubscribeStb = stbEnvironment.subscribe((s) => setStb({ ...s }));
    const unsubscribeLock = parentalControl.subscribe(() => setParentalOn(parentalControl.isEnabled));
    hiddenCategories.load().then(() => setHiddenCategoryCount(hiddenCategories.count));
    const unsubscribeHidden = hiddenCategories.subscribe(() =>
      setHiddenCategoryCount(hiddenCategories.count)
    );
    return () => {
      unsubscribeStb();
      unsubscribeLock();
      unsubscribeHidden();
    };
  }, []);

  /**
   * Routes to a screen the parental lock may be guarding.
   *
   * The PIN is asked for here rather than inside the destination for the portal
   * list, which has no lock of its own — the guard has to sit on the way in or
   * it is not a guard.
   */
  const openGuarded = useCallback((destination: 'parental' | 'portals') => {
    const scope = destination === 'parental' ? 'settings' : 'portals';
    if (parentalControl.requiresPin(scope)) {
      setPinGateTarget(destination);
      return;
    }
    router.push(destination === 'parental' ? '/parental-control' : '/portals');
  }, [router]);

  const cycleBufferProfile = useCallback(() => {
    stbEnvironment.cycleBufferProfile();
  }, []);

  const cycleInfoBarSeconds = useCallback(() => {
    // 3 → 5 → 8 → 12 → off, which covers "just a glance" through to "leave it
    // up while I read the synopsis".
    const steps = [3, 5, 8, 12, 0];
    const next = steps[(steps.indexOf(stbEnvironment.snapshot.infoBarSeconds) + 1) % steps.length];
    stbEnvironment.update({ infoBarSeconds: next, autoInfoBar: next > 0 });
  }, []);

  const toggleFullGuide = useCallback(async () => {
    const next = !stbEnvironment.snapshot.fullXmltvGuide;
    await stbEnvironment.update({ fullXmltvGuide: next });
    // Re-fetch immediately: switching this on and seeing nothing change until
    // the next cold start reads as a broken switch.
    const portal = usePortalStore.getState().activePortal;
    if (portal) epgService.loadBulk(portal, { force: true, allowLargeXmltv: next }).catch(() => { });
  }, []);

  /**
   * Merged into whatever is already stored rather than overwriting the record.
   * `app_settings` is shared — player.tsx also reads it — so a blind write would
   * drop keys this screen no longer knows about.
   */
  const persistSettings = useCallback(async (next: { hardwareAcceleration: boolean }) => {
    try {
      const raw = await safeStorage.getItem('app_settings');
      const current = raw ? JSON.parse(raw) : {};
      await safeStorage.setItem('app_settings', JSON.stringify({ ...current, ...next }));
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  }, []);

  const toggleHardwareAcceleration = useCallback(() => {
    const next = !hardwareAcceleration;
    setHardwareAcceleration(next);
    persistSettings({ hardwareAcceleration: next });
    // The player reads this through stbEnvironment when it builds its VLC
    // options, so both records have to move together.
    stbEnvironment.update({ hardwareAcceleration: next });
  }, [hardwareAcceleration, persistSettings]);

  const cycleOverscan = useCallback(() => {
    // Cycle 0 -> 10 -> 20 -> 30 -> 40 -> 0
    const nextVal = overscanPadding >= 40 ? 0 : overscanPadding + 10;
    setOverscanPadding(nextVal);
  }, [overscanPadding, setOverscanPadding]);

  // ── Destructive actions ────────────────────────────────────────────────────

  const handleClearCache = useCallback(() => {
    openDialog({
      id: 'clear-cache',
      icon: 'brush-outline',
      title: 'Clear Cache',
      message:
        'Cached channels, movies and series will be removed and downloaded again on next open. Your portals and favourites are kept.',
      confirmLabel: 'Clear Cache',
      onConfirm: async () => {
        try {
          await clearPersistedPortalData();
          openDialog({
            id: 'clear-cache-done',
            tone: 'success',
            icon: 'checkmark-circle-outline',
            title: 'Cache Cleared',
            message: 'Fresh content will be fetched the next time you open your library.',
            confirmLabel: 'Done',
            acknowledgeOnly: true,
          });
        } catch {
          openDialog({
            id: 'clear-cache-failed',
            tone: 'danger',
            icon: 'alert-circle-outline',
            title: 'Could Not Clear Cache',
            message: 'Something went wrong while removing the cached data. Please try again.',
            confirmLabel: 'Close',
            acknowledgeOnly: true,
          });
        }
      },
    });
  }, [openDialog, clearPersistedPortalData]);

  const handleClearAllData = useCallback(() => {
    openDialog({
      id: 'clear-all',
      tone: 'danger',
      icon: 'trash-outline',
      title: 'Clear All Data',
      message: 'This deletes every portal, favourite and preference on this device. It cannot be undone.',
      confirmLabel: 'Delete All',
      onConfirm: async () => {
        try {
          await safeStorage.clear();
          await setActivePortal(null);
          clearPortalData();
          FocusMemory.clear(SCREEN_KEY);
          closeDialog();
          router.replace('/');
        } catch {
          openDialog({
            id: 'clear-all-failed',
            tone: 'danger',
            icon: 'alert-circle-outline',
            title: 'Could Not Clear Data',
            message: 'Some data could not be removed. Please try again.',
            confirmLabel: 'Close',
            acknowledgeOnly: true,
          });
        }
      },
    });
  }, [openDialog, closeDialog, setActivePortal, clearPortalData, router]);

  const handleDisconnect = useCallback(() => {
    openDialog({
      id: 'disconnect',
      tone: 'danger',
      icon: 'warning-outline',
      title: 'Disconnect Portal',
      message: `"${activePortal?.name ?? 'This portal'}" will be disconnected. It stays saved, so you can reconnect at any time.`,
      confirmLabel: 'Disconnect',
      onConfirm: async () => {
        await setActivePortal(null);
        clearPortalData();
        closeDialog();
        router.replace('/');
      },
    });
  }, [openDialog, closeDialog, activePortal?.name, setActivePortal, clearPortalData, router]);

  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <View style={[S.container, { paddingTop: insets.top }]}>
      <CinematicBackground />

      {/* ── Header ── */}
      <View style={S.header}>
        <Text style={S.headerTitle}>Settings</Text>
      </View>

      <ScrollView
        style={S.content}
        contentContainerStyle={S.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        removeClippedSubviews={false}
      >
        {/* Portal Section */}
        {activePortal && (
          <View style={S.rootSection}>
            <SectionLabel>PORTAL INFORMATION</SectionLabel>
            <View style={S.portalCard}>
              <View style={S.portalCardHeader}>
                <View style={S.portalNameRow}>
                  <Text style={S.portalNameText}>{activePortal.name}</Text>
                  <View style={S.portalTypeBadge}>
                    <Text style={S.portalTypeBadgeText}>
                      {activePortal.type === "m3u"
                        ? "M3U PLAYLIST"
                        : activePortal.type === "xtream"
                          ? "XTREAM CODES API"
                          : "MAC PORTAL"}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={S.portalInfoCols}>
                <View style={S.infoCol}>
                  <Text style={S.tinyLabel}>PORTAL URL</Text>
                  <Text style={S.largeValue} numberOfLines={1}>{activePortal.config.url}</Text>
                </View>
                <View style={S.infoCol}>
                  <Text style={S.tinyLabel}>DEVICE MAC ADDRESS</Text>
                  <Text style={S.largeValue}>{activePortal.config.mac || '00:1A:79:XX:XX:XX'}</Text>
                </View>
              </View>

              <FocusGroup style={S.portalActionsRow}>
                <Focusable
                  ringOnFocus={false}
                  onPress={() => openGuarded('portals')}
                  style={S.portalBtnWrapper}
                  screenKey={SCREEN_KEY}
                  focusKey="switch-portal"
                  hasTVPreferredFocus={autoFocusFirst}
                  accessibilityLabel="Switch or manage portals"
                >
                  {(focused) => (
                    <View style={[S.switchBtn, focused && S.switchBtnFocused]}>
                      <ArrowLeftRight size={ps(1.8)} color={focused ? '#000' : '#fff'} />
                      <Text style={[S.switchBtnText, focused && S.switchBtnTextFocused]}>
                        Switch Portal
                      </Text>
                    </View>
                  )}
                </Focusable>

                <Focusable
                  ringOnFocus={false}
                  onPress={handleDisconnect}
                  style={S.portalBtnWrapper}
                  screenKey={SCREEN_KEY}
                  focusKey="disconnect"
                  accessibilityLabel="Disconnect portal"
                >
                  {(focused) => (
                    <View style={[S.disconnectBtn, focused && S.disconnectBtnFocused]}>
                      <LogOut size={ps(1.8)} color={focused ? '#000' : 'rgba(255,255,255,0.7)'} />
                      <Text style={[S.disconnectBtnText, focused && S.disconnectBtnTextFocused]}>
                        Disconnect
                      </Text>
                    </View>
                  )}
                </Focusable>
              </FocusGroup>
            </View>
          </View>
        )}

        {/* Playback Section */}
        <View style={S.rootSection}>
          <SectionLabel>PLAYBACK SETTINGS</SectionLabel>
          <View style={S.groupedCard}>
            <SettingRow
              icon="flash-outline"
              title="Hardware Acceleration"
              subtitle="Use the GPU for smoother video decoding"
              focusKey="hwaccel"
              preferred={autoFocusFirst && !activePortal}
              onPress={toggleHardwareAcceleration}
              accessibilityRole="switch"
              selected={hardwareAcceleration}
              control={{ kind: 'switch', on: hardwareAcceleration }}
            />
            <SettingRow
              icon="server-outline"
              title="Same Host Stream Proxy"
              subtitle="Rewrite stream URLs to match portal host to prevent buffering and bypass dead or empty links"
              focusKey="same-host-proxy"
              onPress={() => stbEnvironment.update({ sameHostStreamProxy: !stb.sameHostStreamProxy })}
              accessibilityRole="switch"
              selected={stb.sameHostStreamProxy}
              control={{ kind: 'switch', on: stb.sameHostStreamProxy }}
            />
          </View>
        </View>

        {/* Set-Top Box Section */}
        <View style={S.rootSection}>
          <SectionLabel>SET-TOP BOX</SectionLabel>
          <View style={S.groupedCard}>
            <SettingRow
              icon="speedometer-outline"
              title="Buffer Profile"
              subtitle={BUFFER_PROFILES[stb.bufferProfile].detail}
              focusKey="buffer-profile"
              onPress={cycleBufferProfile}
              control={{ kind: 'value', text: BUFFER_PROFILES[stb.bufferProfile].label }}
            />
            <SettingRow
              icon="information-circle-outline"
              title="Channel Banner"
              subtitle="How long the channel and programme banner stays up after a zap"
              focusKey="info-bar"
              onPress={cycleInfoBarSeconds}
              control={{ kind: 'value', text: stb.infoBarSeconds > 0 ? `${stb.infoBarSeconds}s` : 'Off' }}
            />
            <SettingRow
              icon="play-forward-outline"
              title="Autoplay Next Episode"
              subtitle="Roll into the next episode when one finishes, with a countdown you can cancel"
              focusKey="autoplay-next"
              onPress={() => stbEnvironment.update({ autoplayNext: !stb.autoplayNext })}
              accessibilityRole="switch"
              selected={stb.autoplayNext}
              control={{ kind: 'switch', on: stb.autoplayNext }}
            />
            <SettingRow
              icon="time-outline"
              title="24-Hour Clock"
              subtitle="Show times as 21:40 rather than 9:40 PM"
              focusKey="clock"
              onPress={() => stbEnvironment.update({ clock24h: !stb.clock24h })}
              accessibilityRole="switch"
              selected={stb.clock24h}
              control={{ kind: 'switch', on: stb.clock24h }}
            />
            <SettingRow
              icon="calendar-outline"
              title="Full XMLTV Guide"
              subtitle="Download the provider's complete guide. Accurate, but can be tens of megabytes."
              focusKey="full-guide"
              onPress={toggleFullGuide}
              accessibilityRole="switch"
              selected={stb.fullXmltvGuide}
              control={{ kind: 'switch', on: stb.fullXmltvGuide }}
            />
          </View>
        </View>

        {/* Tools Section */}
        <View style={S.rootSection}>
          <SectionLabel>TOOLS &amp; DIAGNOSTICS</SectionLabel>
          <FocusGroup style={S.tileRow}>
            <DataTile
              icon="speedometer-outline"
              title="Speed Test"
              subtitle="Measure the line to your provider"
              focusKey="speed-test"
              onPress={() => router.push('/speed-test')}
            />
            <DataTile
              icon="lock-closed-outline"
              title="Parental Control"
              subtitle="PIN lock for channels and settings"
              focusKey="parental"
              onPress={() => openGuarded('parental')}
              value={parentalOn ? 'On' : 'Off'}
            />
            <DataTile
              icon="hardware-chip-outline"
              title="System Info"
              subtitle="MAC, device and portal details"
              focusKey="system-info"
              onPress={() => router.push('/system-info')}
            />
            <DataTile
              icon="eye-off-outline"
              title="Categories"
              subtitle="Hide the ones you never open"
              focusKey="categories"
              onPress={() => router.push('/categories')}
              value={hiddenCategoryCount > 0 ? hiddenCategoryCount + " hidden" : undefined}
            />
            <DataTile
              icon="calendar-outline"
              title="TV Guide"
              subtitle="Browse the programme schedule"
              focusKey="epg"
              onPress={() => router.push('/epg')}
            />
          </FocusGroup>
        </View>

        {/* Data Section */}
        <View style={S.rootSection}>
          <SectionLabel>APP MANAGEMENT / DATA</SectionLabel>
          <FocusGroup style={S.tileRow}>
            <DataTile
              icon="brush-outline"
              title="Clear Cache"
              subtitle="Remove temporary files"
              focusKey="clear-cache"
              onPress={handleClearCache}
            />
            <DataTile
              icon="trash-outline"
              title="Clear Data"
              subtitle="Reset all settings"
              focusKey="clear-data"
              onPress={handleClearAllData}
            />
            <DataTile
              icon="tv-outline"
              title="TV Safe Area"
              subtitle="Prevent edge cropping"
              focusKey="overscan"
              onPress={cycleOverscan}
              value={`${overscanPadding}px`}
            />
          </FocusGroup>
        </View>

        {/* Legal Section */}
        <View style={S.rootSection}>
          <SectionLabel>LEGAL</SectionLabel>
          <View style={S.groupedCard}>
            <SettingRow
              icon="document-text-outline"
              title="Privacy Policy"
              subtitle="How your data is handled inside the app"
              focusKey="privacy"
              onPress={() => router.push('/privacy-policy')}
              control={{ kind: 'chevron' }}
            />
          </View>
        </View>

        <View style={S.footer}>
          <Text style={S.footerText}>INFINITY IPTV PLAYER</Text>
          <Text style={S.footerSubtext}>Version {appVersion}</Text>
        </View>
      </ScrollView>

      <PinPrompt
        visible={!!pinGateTarget}
        title="Parental Control"
        message="Enter your PIN to continue."
        onSubmit={(pin) => parentalControl.unlock(pin)}
        onCancel={() => setPinGateTarget(null)}
        onSuccess={() => {
          const target = pinGateTarget;
          setPinGateTarget(null);
          if (target) router.push(target === 'parental' ? '/parental-control' : '/portals');
        }}
      />

      {dialogNode}
    </View>
  );
}

const S = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    paddingHorizontal: pw(8),
    paddingTop: ph(5),
    paddingBottom: ph(2),
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: ps(2.6),
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: ps(1.1),
    marginTop: ph(0.6),
  },

  content: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: pw(8),
    paddingTop: ph(2),
    paddingBottom: ph(8),
  },

  // ── Sections ──────────────────────────────────────────────────────────────
  rootSection: {
    marginBottom: ph(5),
  },
  sectionLabel: {
    fontSize: ps(1.45),
    fontWeight: '900',
    color: 'rgba(255,255,255,0.65)',
    letterSpacing: 2.5,
    marginBottom: ph(1.4),
    paddingLeft: pw(0.5),
  },

  // ── Portal card ───────────────────────────────────────────────────────────
  portalCard: {
    backgroundColor: '#17181c',
    borderRadius: 18,
    padding: ps(2.8),
    borderWidth: 0,
    borderColor: 'transparent',
  },
  portalCardHeader: {
    marginBottom: ph(2),
  },
  portalNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: pw(1.2),
  },
  portalNameText: {
    color: '#FFFFFF',
    fontSize: ps(2.2),
    fontWeight: '900',
  },
  portalTypeBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 6,
    paddingHorizontal: pw(1),
    paddingVertical: ph(0.6),
    borderWidth: 0,
    borderColor: 'transparent',
  },
  portalTypeBadgeText: {
    color: 'rgba(255, 255, 255, 0.95)',
    fontSize: ps(0.95),
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  portalInfoCols: {
    flexDirection: 'row',
    marginBottom: ph(2.2),
    gap: pw(4),
  },
  infoCol: {
    flex: 1,
  },
  tinyLabel: {
    fontSize: ps(1.05),
    color: 'rgba(255,255,255,0.5)',
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: ph(0.5),
  },
  largeValue: {
    fontSize: ps(1.5),
    color: '#fff',
    fontWeight: '600',
  },
  portalActionsRow: {
    flexDirection: 'row',
    gap: pw(1.5),
    marginTop: ph(1),
  },
  portalBtnWrapper: {
    borderRadius: 18,
    overflow: 'visible',
  },
  switchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: pw(2.2),
    paddingVertical: ph(1.4),
    gap: pw(0.8),
    borderRadius: 18,
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: '#17181c',
  },
  switchBtnFocused: {
    borderColor: 'transparent',
    borderWidth: 0,
    backgroundColor: '#fff',
    transform: [{ scale: 1.04 }],
    elevation: 8,
  },
  switchBtnText: {
    fontSize: ps(1.25),
    fontWeight: '800',
    letterSpacing: 0.5,
    color: '#fff',
  },
  switchBtnTextFocused: {
    color: '#000',
  },
  disconnectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: pw(2.2),
    paddingVertical: ph(1.4),
    gap: pw(0.8),
    borderRadius: 18,
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: '#17181c',
  },
  disconnectBtnFocused: {
    borderColor: 'transparent',
    borderWidth: 0,
    backgroundColor: '#fff',
    transform: [{ scale: 1.04 }],
    elevation: 8,
  },
  disconnectBtnText: {
    fontSize: ps(1.25),
    fontWeight: '800',
    letterSpacing: 0.5,
    color: 'rgba(255,255,255,0.7)',
  },
  disconnectBtnTextFocused: {
    color: '#000',
  },

  // ── Grouped list ──────────────────────────────────────────────────────────
  groupedCard: {
    borderRadius: 18,
    padding: ps(0.8),
    backgroundColor: '#17181c',
    borderWidth: 0,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: pw(2),
    paddingVertical: ph(2.4),
    borderRadius: 12,
    borderWidth: 0,
    borderColor: 'transparent',
    marginBottom: ph(0.4),
  },
  rowFocused: {
    borderColor: 'transparent',
    borderWidth: 0,
    backgroundColor: "#F5F5F5",
  },
  rowIcon: {
    marginRight: pw(1.8),
  },
  rowText: {
    flex: 1,
    paddingRight: pw(1),
  },
  rowTitle: {
    fontSize: ps(1.5),
    color: '#fff',
    fontWeight: '700',
  },
  rowTitleFocused: {
    color: '#000',
    fontWeight: '900',
  },
  rowSubtitle: {
    fontSize: ps(1.12),
    color: 'rgba(255,255,255,0.6)',
    marginTop: 4,
    lineHeight: ps(1.55),
  },
  rowSubtitleFocused: {
    color: 'rgba(0,0,0,0.65)',
  },

  // ── Data tiles ────────────────────────────────────────────────────
  tileRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: pw(1.5),
  },
  tileWrapper: {
    width: '31.8%',
    borderRadius: 18,
    marginBottom: ph(1.5),
  },
  tile: {
    flex: 1,
    minHeight: ph(12.5),
    borderRadius: 18,
    paddingHorizontal: pw(1.8),
    paddingVertical: ph(1.6),
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#17181c',
    borderWidth: 0,
    borderColor: 'transparent',
  },
  tileFocused: {
    borderColor: 'transparent',
    borderWidth: 0,
    backgroundColor: "#F5F5F5",
    transform: [{ scale: 1.035 }],
  },
  tileIcon: {
    marginRight: pw(1.4),
  },
  tileText: {
    flex: 1,
    minWidth: 0,
    gap: ph(0.4),
    justifyContent: 'center',
  },
  tileHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    gap: pw(0.6),
  },
  tileTitle: {
    fontSize: ps(1.35),
    color: '#fff',
    fontWeight: '700',
    flexShrink: 1,
  },
  tileTitleFocused: {
    color: '#000',
    fontWeight: '900',
  },
  tileSubtitle: {
    fontSize: ps(1.05),
    color: 'rgba(255,255,255,0.6)',
    marginTop: 2,
    lineHeight: ps(1.45),
  },
  tileSubtitleFocused: {
    color: 'rgba(0,0,0,0.65)',
  },
  valuePill: {
    paddingHorizontal: pw(1.6),
    paddingVertical: ph(0.8),
    minHeight: ph(3.4),
    borderRadius: ps(1),
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  valuePillFocused: {
    backgroundColor: '#0E0F14',
    borderColor: '#0E0F14',
    borderWidth: 1,
  },
  valuePillText: {
    color: '#fff',
    fontSize: ps(1.15),
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  // ── Switch ────────────────────────────────────────────────────────────────
  switchTrack: {
    width: pw(4.2),
    height: ph(3.2),
    minWidth: ps(3.8),
    borderRadius: ps(1.6),
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    padding: 2,
  },
  // When row is focused (white bg), track must go dark so it's visible
  switchTrackFocused: {
    backgroundColor: 'rgba(0,0,0,0.15)',
    borderColor: 'rgba(0,0,0,0.3)',
  },
  switchTrackOn: {
    backgroundColor: '#4ADE80',
    borderColor: '#4ADE80',
  },
  // ON + focused: keep green but slightly darker
  switchTrackOnFocused: {
    backgroundColor: '#22c55e',
    borderColor: '#22c55e',
  },
  switchKnob: {
    width: ps(1.6),
    height: ps(1.6),
    borderRadius: ps(0.8),
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  switchKnobFocused: {
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  switchKnobOn: {
    alignSelf: 'flex-end',
    backgroundColor: '#000',
  },

  // ── Footer ────────────────────────────────────────────────────────────────
  footer: {
    alignItems: 'center',
    marginTop: ph(3),
    paddingBottom: ph(2),
  },
  footerText: {
    fontSize: ps(1),
    color: 'rgba(255,255,255,0.3)',
    fontWeight: '800',
    letterSpacing: 2,
  },
  footerSubtext: {
    fontSize: ps(0.85),
    color: 'rgba(255,255,255,0.18)',
    marginTop: 4,
    letterSpacing: 1,
  },
});
