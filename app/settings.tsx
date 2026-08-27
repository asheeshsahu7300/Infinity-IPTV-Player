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
import { isTV } from '../src/utils/tvUtils';
import { THEME, pw, ph, psRaw as ps } from '../src/theme/tokens';
import { Focusable, FocusGroup, FocusMemory, useFocusRestore } from '../src/tv';
import { CinematicBackground } from '../src/components/CinematicBackground';
import { useDialog } from '../src/components/ConfirmDialog';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const SCREEN_KEY = 'settings';

// ── Row primitives ───────────────────────────────────────────────────────────

/** What sits at the trailing edge of a row. Declarative rather than a render
 *  prop so the row itself owns the focused styling of its control. */
type RowControl = { kind: 'switch'; on: boolean } | { kind: 'chevron' };

function RowControlView({ control, focused }: { control: RowControl; focused: boolean }) {
  if (control.kind === 'switch') {
    return (
      <View style={[S.switchTrack, focused && S.switchTrackFocused, control.on && S.switchTrackOn]}>
        <View style={[S.switchKnob, control.on && S.switchKnobOn]} />
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
  tone?: 'neutral' | 'danger';
  /** Optional value badge on the trailing edge (e.g. the overscan amount). */
  value?: string;
}

function DataTile({ icon, title, subtitle, focusKey, onPress, tone = 'neutral', value }: DataTileProps) {
  const danger = tone === 'danger';
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
        <View
          style={[
            S.tile,
            focused && S.tileFocused,
            focused && danger && S.tileFocusedDanger,
          ]}
        >
          <View style={[S.tileIconBox, focused && (danger ? S.tileIconBoxDanger : S.tileIconBoxFocused)]}>
            <Ionicons
              name={icon}
              size={ps(2)}
              color={focused ? (danger ? '#ff453a' : '#000') : 'rgba(255,255,255,0.75)'}
            />
          </View>
          <View style={S.tileText}>
            <Text style={[S.tileTitle, focused && danger && S.tileTitleDanger]} numberOfLines={1}>
              {title}
            </Text>
            <Text style={S.tileSubtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          </View>
          {value ? (
            <View style={S.valuePill}>
              <Text style={S.valuePillText}>{value}</Text>
            </View>
          ) : null}
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
  const portals = usePortalStore((s) => s.portals);
  const activePortal = usePortalStore((s) => s.activePortal);
  const setActivePortal = usePortalStore((s) => s.setActivePortal);
  const clearPortalData = usePortalStore((s) => s.clearPortalData);
  const clearPersistedPortalData = usePortalStore((s) => s.clearPersistedPortalData);

  const overscanPadding = usePortalStore((s) => s.overscanPadding);
  const setOverscanPadding = usePortalStore((s) => s.setOverscanPadding);

  const [hardwareAcceleration, setHardwareAcceleration] = useState(true);

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
                    <Ionicons name="warning" size={ps(1.8)} color={focused ? '#ff453a' : 'rgba(255,255,255,0.7)'} />
                    <Text style={[S.disconnectBtnText, { color: focused ? '#ff453a' : 'rgba(255,255,255,0.7)' }]}>
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
          </View>
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
              tone="danger"
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

        {/* Stats */}
        <View style={S.stats}>
          <View style={S.statItem}>
            <Text style={S.statValue}>{portals.length}</Text>
            <Text style={S.statLabel}>Configured Portals</Text>
          </View>
        </View>

        <View style={S.footer}>
          <Text style={S.footerText}>INFINITY IPTV PLAYER</Text>
          <Text style={S.footerSubtext}>Version {appVersion}</Text>
        </View>
      </ScrollView>

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
    borderRadius: ps(2),
    padding: ps(3.5),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
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
    color: 'rgba(255,255,255,0.35)',
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
  },
  disconnectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: pw(2),
    paddingVertical: ph(1.2),
    gap: pw(0.8),
    borderRadius: ps(1),
    borderWidth: .8,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#111015',
  },
  disconnectBtnFocused: {
    borderColor: '#ff453a',
    backgroundColor: 'rgba(255,69,58,0.12)',
    transform: [{ scale: 1.05 }],
    ...Platform.select({
      ios: {
        shadowColor: '#ff453a',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.6,
        shadowRadius: 12,
      },
      android: {
        elevation: 0,
      },
    }),
  },
  disconnectBtnText: {
    fontSize: ps(1.3),
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // ── Grouped list ──────────────────────────────────────────────────────────
  groupedCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: ps(2),
    padding: ps(1),
    borderWidth: .8,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  /** The transparent border is reserved up front so gaining focus recolours it
   *  instead of resizing the row and nudging the whole list. */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: ps(2),
    borderRadius: ps(1.8),
    borderWidth: .8,
    borderColor: 'transparent',
  },
  rowFocused: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderColor: 'rgba(255,255,255,0.85)',
  },
  rowIconBox: {
    width: ps(5),
    height: ps(5),
    borderWidth: .8,
    borderRadius: ps(2),
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: pw(2),
  },
  rowIconBoxFocused: {
    backgroundColor: '#fff',
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
    color: 'rgba(255,255,255,0.35)',
    marginTop: 2,
  },
  rowSubtitleFocused: {
    color: 'rgba(255,255,255,0.6)',
  },

  // ── Data tiles ────────────────────────────────────────────────────────────
  tileRow: {
    flexDirection: isTV ? 'row' : 'column',
    gap: isTV ? pw(2) : ph(1.5),
  },
  tileWrapper: {
    ...(isTV ? { flex: 1 } : { alignSelf: 'stretch' }),
    borderRadius: ps(2),
  },
  tile: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: ps(2),
    padding: ps(2.5),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: pw(1.5),
  },
  tileFocused: {
    backgroundColor: '#17161b',
    borderColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    transform: [{ scale: 1.03 }],
  },
  tileFocusedDanger: {
    borderColor: '#8a1a1483',
    backgroundColor: 'rgba(255,69,58,0.08)',
  },
  tileIconBox: {
    width: ps(5.5),
    height: ps(5.5),
    borderRadius: ps(2),
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileIconBoxFocused: {
    backgroundColor: '#fff',
  },
  tileIconBoxDanger: {
    backgroundColor: 'rgba(199, 70, 63, 0.16)',
  },
  tileText: {
    flex: 1,
  },
  tileTitle: {
    fontSize: isTV ? ps(1.5) : ps(1.35),
    color: '#fff',
    fontWeight: '700',
  },
  tileTitleDanger: {
    color: '#a52b24be',
  },
  tileSubtitle: {
    fontSize: isTV ? ps(1.1) : ps(0.95),
    color: 'rgba(255,255,255,0.35)',
    marginTop: 2,
  },
  valuePill: {
    paddingHorizontal: pw(1),
    paddingVertical: ph(0.6),
    borderRadius: ps(2),
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
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
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'transparent',
    justifyContent: 'center',
    padding: 2,
  },
  switchTrackFocused: {
    borderColor: 'rgba(255,255,255,0.5)',
  },
  switchTrackOn: {
    backgroundColor: THEME.colors.primary,
  },
  switchKnob: {
    width: ps(1.8),
    height: ps(1.8),
    borderRadius: ps(0.9),
    backgroundColor: '#fff',
  },
  switchKnobOn: {
    alignSelf: 'flex-end',
    backgroundColor: '#000',
  },

  // ── Footer ────────────────────────────────────────────────────────────────
  stats: {
    marginTop: ph(4),
    alignItems: 'center',
  },
  statItem: {
    alignItems: 'center',
    paddingVertical: ph(2),
  },
  statValue: {
    fontSize: ps(4),
    fontWeight: '300',
    color: THEME.colors.primary,
  },
  statLabel: {
    fontSize: ps(1.1),
    color: 'rgba(255,255,255,0.3)',
    marginTop: 4,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  footer: {
    alignItems: 'center',
    marginTop: ph(2),
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