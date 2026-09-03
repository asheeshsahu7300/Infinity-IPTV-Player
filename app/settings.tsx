import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
  Image,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';

import { safeStorage } from '../src/services/safeStorage';
import { usePortalStore } from '../src/store/portalStore';
import { BUFFER_PROFILES, stbEnvironment, StbSettings } from '../src/services/stbEnvironment';
import { parentalControl } from '../src/services/parentalControl';
import { epgService } from '../src/services/epgService';
import { hiddenCategories } from '../src/services/hiddenCategories';
import PinPrompt from '../src/components/PinPrompt';
import { isTV } from '../src/utils/tvUtils';
import { THEME, pw, ph, psRaw as ps, TILE_FRAME, TILE_FRAME_FOCUSED } from '../src/theme/tokens';
import { Focusable, FocusGroup, FocusMemory, useFocusRestore } from '../src/tv';
import { CinematicBackground } from '../src/components/CinematicBackground';
import { useDialog } from '../src/components/ConfirmDialog';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

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
      <View style={[S.switchTrack, focused && S.switchTrackFocused, control.on && S.switchTrackOn]}>
        <View style={[S.switchKnob, control.on && S.switchKnobOn]} />
      </View>
    );
  }
  if (control.kind === 'value') {
    return (
      <View style={[S.valuePill, focused && S.valuePillFocused]}>
        <Text style={[S.valuePillText, focused && { color: '#000' }]}>{control.text}</Text>
      </View>
    );
  }
  return <Ionicons name="chevron-forward" size={ps(2)} color={focused ? '#fff' : 'rgba(255,255,255,0.3)'} />;
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
          <View style={[S.rowIconBox, focused && S.rowIconBoxFocused]}>
            <Ionicons name={icon} size={ps(2.2)} color={focused ? '#000' : '#fff'} />
          </View>
          <View style={S.rowText}>
            <Text style={S.rowTitle}>{title}</Text>
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
          <View style={[S.tileIconBox, focused && S.tileIconBoxFocused]}>
            <Ionicons
              name={icon}
              size={ps(2)}
              color={focused ? '#000' : 'rgba(255,255,255,0.75)'}
            />
          </View>
          <View style={S.tileText}>
            <Text style={S.tileTitle} numberOfLines={1}>
              {title}
            </Text>
            <Text style={S.tileSubtitle} numberOfLines={2}>
              {subtitle}
            </Text>
            {/* Under the title, not beside it.
                As a sibling of the text column this pill claimed its intrinsic
                width first and left the flexible column with almost nothing, so a tile
                with a value rendered the icon and the pill and no title at all
                — which is what "Off" and "19 hidden" looked like. */}
            {value ? (
              <View style={S.valuePill}>
                <Text style={S.valuePillText}>{value}</Text>
              </View>
            ) : null}
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
        return;
      }
      FocusMemory.restoreWithRetry(SCREEN_KEY);
    }, [])
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

      <View style={S.headerBranding}>
        <Image source={require('../assets/images/TV.png')} style={S.headerLogoImage} resizeMode="contain" />
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
              <View style={S.portalInfoCols}>
                <View style={S.infoCol}>
                  <Text style={S.tinyLabel}>Portal URL</Text>
                  <Text style={S.largeValue} numberOfLines={1}>{activePortal.config.url}</Text>
                </View>
                <View style={S.infoCol}>
                  <Text style={S.tinyLabel}>Device MAC Address</Text>
                  <Text style={S.largeValue}>{activePortal.config.mac || '00:1A:79:XX:XX:XX'}</Text>
                </View>
              </View>

              <Focusable
                ringOnFocus={false}
                onPress={handleDisconnect}
                style={S.disconnectBtnWrapper}
                screenKey={SCREEN_KEY}
                focusKey="disconnect"
                accessibilityLabel="Disconnect portal"
              >
                {(focused) => (
                  <View style={[S.disconnectBtn, focused && S.disconnectBtnFocused]}>
                    <Ionicons name="warning" size={ps(1.8)} color={focused ? '#000' : 'rgba(255,255,255,0.7)'} />
                    <Text style={[S.disconnectBtnText, focused && S.disconnectBtnTextFocused]}>
                      Disconnect Portal
                    </Text>
                  </View>
                )}
              </Focusable>
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
              // Inherited the screen's initial focus when the autoplay row above
              // it was removed.
              preferred={autoFocusFirst}
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
              focusKey="guide"
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
    backgroundColor: 'transparent',
  },

  // ── Header ────────────────────────────────────────────────────────────────
  headerBranding: {
    alignItems: 'center',
    paddingTop: ph(4),
    marginBottom: ph(2),
  },
  headerLogoImage: {
    width: pw(25),
    height: ph(8),
    transform: [{ scale: 2.5 }],
    marginBottom: ph(1),
  },

  content: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: pw(8),
    paddingBottom: ph(10),
  },

  // ── Sections ──────────────────────────────────────────────────────────────
  rootSection: {
    marginBottom: ph(4),
  },
  sectionLabel: {
    fontSize: isTV ? ps(1.2) : ps(1),
    fontWeight: '700',
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 1.5,
    marginBottom: ph(2),
  },

  // ── Portal card ───────────────────────────────────────────────────────────
  portalCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: ps(2.5),
    padding: ps(3.5),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  portalInfoCols: {
    flexDirection: isTV ? 'row' : 'column',
    marginBottom: ph(3),
    gap: isTV ? pw(4) : ph(2),
  },
  infoCol: {
    flex: isTV ? 1 : undefined,
  },
  tinyLabel: {
    fontSize: isTV ? ps(1.2) : ps(0.9),
    color: 'rgba(255,255,255,0.4)',
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: ph(0.5),
  },
  largeValue: {
    fontSize: isTV ? ps(1.8) : ps(1.5),
    color: '#fff',
    fontWeight: '600',
  },
  disconnectBtnWrapper: {
    alignSelf: 'flex-start',
    marginTop: ph(1),
    borderRadius: ps(1.2),
  },
  disconnectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: pw(2),
    paddingVertical: ph(1.2),
    gap: pw(0.8),
    borderRadius: ps(1.2),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  disconnectBtnFocused: {
    borderColor: '#fff',
    backgroundColor: '#fff',
    transform: [{ scale: 1.04 }],
  },
  disconnectBtnText: {
    fontSize: ps(1.3),
    fontWeight: '700',
    letterSpacing: 0.5,
    color: 'rgba(255,255,255,0.7)',
  },
  disconnectBtnTextFocused: {
    color: '#000',
  },

  // ── Grouped list ──────────────────────────────────────────────────────────
  // This is the tile on this screen — the thing that legitimately wears the
  // frame — so it takes the shared values (was 0.07 / 0.03 against 0.05 / 0.04).
  groupedCard: {
    ...TILE_FRAME,
    borderRadius: ps(2.5),
    padding: ps(1),
  },
  /** The transparent border is reserved up front so gaining focus recolours it
   *  instead of resizing the row and nudging the whole list. */
  /**
   * No resting frame, deliberately — the frame belongs to `groupedCard`.
   *
   * Every SettingRow lives inside one, so giving the row TILE_FRAME's own
   * hairline and wash drew a box inside a box: each row read as a raised slab
   * with its own edge, stacked within the group's edge. The card is the tile
   * here; the rows are bands inside it.
   *
   * The border still has to be *declared* at rest, transparent, so gaining
   * focus only recolours it instead of adding 1px and reflowing the row —
   * same trick as Focusable's ringReserved.
   */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: ps(2),
    borderRadius: ps(2),
    borderWidth: TILE_FRAME.borderWidth,
    borderColor: 'transparent',
  },
  rowFocused: { ...TILE_FRAME_FOCUSED },
  rowIconBox: {
    width: ps(5.5),
    height: ps(5.5),
    borderWidth: 1,
    borderRadius: ps(2.75),
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: pw(2),
  },
  rowIconBoxFocused: {
    backgroundColor: '#fff',
    borderColor: '#fff',
  },
  rowText: {
    flex: 1,
    paddingRight: pw(1),
  },
  rowTitle: {
    fontSize: isTV ? ps(1.6) : ps(1.4),
    color: '#fff',
    fontWeight: '700',
  },
  rowSubtitle: {
    fontSize: isTV ? ps(1.2) : ps(1),
    color: 'rgba(255,255,255,0.4)',
    marginTop: 2,
  },
  rowSubtitleFocused: {
    color: 'rgba(255,255,255,0.85)',
  },

  // ── Data tiles ────────────────────────────────────────────────────
  tileRow: {
    flexDirection: isTV ? 'row' : 'column',
    ...(isTV ? { flexWrap: 'wrap' as const } : null),
    gap: isTV ? 16 : ph(1.5),
  },
  tileWrapper: {
    ...(isTV
      ? { width: '31.8%', minWidth: 0, flexGrow: 0, flexShrink: 0 }
      : { alignSelf: 'stretch' }),
    borderRadius: ps(2.5),
  },
  tile: {
    ...TILE_FRAME,
    flex: 1,
    borderRadius: ps(2.5),
    paddingHorizontal: ps(2),
    paddingVertical: ps(2),
    flexDirection: 'row',
    alignItems: 'center',
    gap: pw(1.2),
  },
  // The lift is this tile's own, and stays: it is how a Tools tile reads as
  // pressable. Only the border and wash now come from the shared frame.
  tileFocused: { ...TILE_FRAME_FOCUSED, transform: [{ scale: 1.04 }] },
  tileIconBox: {
    width: ps(5.5),
    height: ps(5.5),
    borderRadius: ps(2.75),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileIconBoxFocused: {
    backgroundColor: '#fff',
    borderColor: '#fff',
  },
  tileText: {
    flex: 1,
    // Lets the column shrink to the space actually available instead of
    // forcing the row wider than the tile.
    minWidth: 0,
    gap: ph(0.4),
    alignItems: 'flex-start',
  },
  tileTitle: {
    fontSize: isTV ? ps(1.5) : ps(1.35),
    color: '#fff',
    fontWeight: '700',
  },
  tileSubtitle: {
    fontSize: isTV ? ps(1.1) : ps(0.95),
    color: 'rgba(255,255,255,0.4)',
    marginTop: 2,
  },
  valuePill: {
    paddingHorizontal: pw(1.2),
    paddingVertical: ph(0.6),
    borderRadius: ps(1.2),
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  valuePillFocused: { backgroundColor: '#fff' },
  valuePillText: {
    color: '#fff',
    fontSize: ps(1.2),
    fontWeight: '700',
  },

  // ── Switch ────────────────────────────────────────────────────────────────
  switchTrack: {
    width: pw(4.5),
    height: ph(3.5),
    minWidth: ps(4),
    borderRadius: ps(2),
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    padding: 2,
  },
  switchTrackFocused: {
    borderColor: 'rgba(255,255,255,0.85)',
  },
  switchTrackOn: {
    backgroundColor: '#fff',
    borderColor: '#fff',
  },
  switchKnob: {
    width: ps(1.8),
    height: ps(1.8),
    borderRadius: ps(0.9),
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  switchKnobOn: {
    alignSelf: 'flex-end',
    backgroundColor: '#000',
  },

  // ── Footer ────────────────────────────────────────────────────────────────
  footer: {
    alignItems: 'center',
    marginTop: ph(4),
  },
  footerText: {
    fontSize: ps(1.2),
    color: 'rgba(255,255,255,0.25)',
    fontWeight: '700',
    letterSpacing: 2,
  },
  footerSubtext: {
    fontSize: ps(1),
    color: 'rgba(255,255,255,0.15)',
    marginTop: 4,
    letterSpacing: 1,
  },

});