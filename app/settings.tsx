import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Dimensions,
  Animated,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import * as Clipboard from 'expo-clipboard';
import { usePortalStore } from '../src/store/portalStore';
import { CinematicBackground } from '../src/components/CinematicBackground';
import { isTV } from '../src/utils/tvUtils';
import { THEME, fw, isPhone } from '../src/theme/tokens';
import { Focusable, FocusGroup } from "../src/tv";

const { width: W, height: H } = Dimensions.get("window");
const pw = (pct: number) => (W * pct) / 100;
const ph = (pct: number) => (H * pct) / 100;
// Font scale by device — TV 1×, phone 1.7×, tablet 1.4× (this screen's base
// sizes run larger than the others').
const PS_SCALE = isTV ? 1.3 : isPhone ? 1.7 : 1.4;
const ps = (pct: number) => ((pw(pct) + ph(pct)) / 2) * PS_SCALE;

const CARD_RADIUS = isTV ? ps(2) : 30;

// ── Toggle switch (grey when off → purple/indigo gradient when on, spring) ──
const TRACK_W = isTV ? 64 : 52;
const TRACK_H = isTV ? 36 : 30;
const KNOB = isTV ? 26 : 24;
const SW_PAD = 3;
const SW_TRAVEL = TRACK_W - KNOB - SW_PAD * 2;

function AnimatedSwitch({ value }: { value: boolean }) {
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(anim, {
      toValue: value ? 1 : 0,
      useNativeDriver: true,
      friction: 7,
      tension: 70,
    }).start();
  }, [value, anim]);
  return (
    <View style={S.switchTrack}>
      <Animated.View style={[StyleSheet.absoluteFillObject, { opacity: anim }]}>
        <LinearGradient
          colors={["#7C3AED", "#4F46E5"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={S.switchTrackFill}
        />
      </Animated.View>
      <Animated.View
        style={[
          S.switchKnob,
          { transform: [{ translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [0, SW_TRAVEL] }) }] },
        ]}
      />
    </View>
  );
}

// Strip protocol / path / port so only the domain shows by default.
const getDomain = (url?: string) => {
  if (!url) return '';
  try {
    const s = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
    return s.split('/')[0].split(':')[0] || url;
  } catch {
    return url;
  }
};

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { portals, activePortal, setActivePortal, clearPortalData } = usePortalStore();

  const [autoPlay, setAutoPlay] = useState(true);
  const [hardwareAcceleration, setHardwareAcceleration] = useState(true);
  const [headerH, setHeaderH] = useState(isPhone ? 104 : 88);

  // Mount fade-in for the scroll content.
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 380, useNativeDriver: true }).start();
  }, [fade]);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const settings = await AsyncStorage.getItem('app_settings');
      if (settings) {
        const parsed = JSON.parse(settings);
        setAutoPlay(parsed.autoPlay ?? true);
        setHardwareAcceleration(parsed.hardwareAcceleration ?? true);
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const saveSettings = async (newSettings: { autoPlay?: boolean; hardwareAcceleration?: boolean }) => {
    try {
      await AsyncStorage.setItem('app_settings', JSON.stringify({ autoPlay, hardwareAcceleration, ...newSettings }));
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  };

  const toggleAutoPlay = () => {
    const v = !autoPlay;
    setAutoPlay(v);
    saveSettings({ autoPlay: v });
  };

  const toggleHardwareAcceleration = () => {
    const v = !hardwareAcceleration;
    setHardwareAcceleration(v);
    saveSettings({ hardwareAcceleration: v });
  };

  const handleCopyUrl = async () => {
    if (!activePortal?.config.url) return;
    try {
      await Clipboard.setStringAsync(activePortal.config.url);
      Alert.alert('Copied', 'Portal URL copied to clipboard');
    } catch {
      Alert.alert('Error', 'Could not copy the URL');
    }
  };

  const handleClearCache = () => {
    Alert.alert(
      'Clear Cache',
      'This will clear all cached data. Your portals and favorites will be kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          onPress: async () => {
            try {
              clearPortalData();
              Alert.alert('Success', 'Cache cleared successfully');
            } catch {
              Alert.alert('Error', 'Failed to clear cache');
            }
          },
        },
      ]
    );
  };

  const handleClearAllData = () => {
    Alert.alert(
      'Reset App',
      'This will delete all portals, favorites, and settings. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: async () => {
            try {
              await AsyncStorage.clear();
              await setActivePortal(null);
              clearPortalData();
              router.replace('/');
            } catch {
              Alert.alert('Error', 'Failed to clear data');
            }
          },
        },
      ]
    );
  };

  const handleDisconnect = async () => {
    await setActivePortal(null);
    clearPortalData();
    router.replace('/');
  };

  // ── Row builders ──
  const toggleRow = (icon: any, title: string, subtitle: string, value: boolean, onPress: () => void) => (
    <Focusable ringOnFocus={false} onPress={onPress} style={S.rowPressable}>
      {(focused: boolean) => (
        <View style={[S.row, focused && S.rowFocused]}>
          <View style={[S.rowIcon, focused && S.rowIconFocused]}>
            <Ionicons name={icon} size={ps(1.9)} color="#fff" />
          </View>
          <View style={S.rowText}>
            <Text style={S.rowTitle}>{title}</Text>
            <Text style={S.rowSubtitle}>{subtitle}</Text>
          </View>
          <AnimatedSwitch value={value} />
        </View>
      )}
    </Focusable>
  );

  const actionRow = (icon: any, title: string, subtitle: string, onPress: () => void, danger?: boolean) => (
    <Focusable ringOnFocus={false} onPress={onPress} style={S.rowPressable}>
      {(focused: boolean) => (
        <View style={[S.row, focused && S.rowFocused]}>
          <View style={[S.rowIcon, focused && S.rowIconFocused, danger && S.rowIconDanger]}>
            <Ionicons name={icon} size={ps(1.9)} color={danger ? "#FF453A" : "#fff"} />
          </View>
          <View style={S.rowText}>
            <Text style={[S.rowTitle, danger && { color: "#FF453A" }]}>{title}</Text>
            <Text style={S.rowSubtitle}>{subtitle}</Text>
          </View>
          <Ionicons name="chevron-forward" size={ps(1.5)} color="rgba(255,255,255,0.3)" />
        </View>
      )}
    </Focusable>
  );

  return (
    <View style={S.container}>
      <CinematicBackground />

      {/* Frosted header on iOS; solid on Android (expo-blur glows there). */}
      {Platform.OS === 'ios' ? (
        <BlurView
          intensity={30}
          tint="dark"
          onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)}
          style={[S.header, { paddingTop: insets.top + (isPhone ? 8 : ph(1)) }]}
        >
          <Text style={S.headerTitle}>Settings</Text>
        </BlurView>
      ) : (
        <View
          onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)}
          style={[S.header, S.headerAndroid, { paddingTop: insets.top + (isPhone ? 8 : ph(1)) }]}
        >
          <Text style={S.headerTitle}>Settings</Text>
        </View>
      )}

      <ScrollView
        style={S.content}
        contentContainerStyle={[S.scrollContent, { paddingTop: headerH + (isPhone ? 14 : ph(1.5)) }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        removeClippedSubviews={false}
      >
        <Animated.View style={[S.contentInner, { opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}>
          {/* Portal status card */}
          {activePortal && (
            <View style={S.section}>
              <Text style={S.sectionTitle}>Portal</Text>
              <View style={S.card}>
                <View style={S.statusRow}>
                  <View style={S.greenDot} />
                  <Text style={S.statusText}>Connected</Text>
                </View>

                <View style={S.chip}>
                  <Text style={S.chipLabel}>Portal</Text>
                  <Text style={S.chipValue} numberOfLines={1}>{getDomain(activePortal.config.url)}</Text>
                </View>
                <View style={S.chip}>
                  <Text style={S.chipLabel}>MAC Address</Text>
                  <Text style={S.chipValue} numberOfLines={1}>{activePortal.config.mac || "00:1A:79:XX:XX:XX"}</Text>
                </View>

                <View style={S.divider} />

                <FocusGroup style={S.btnRow}>
                  <Focusable ringOnFocus={false} onPress={handleCopyUrl} style={S.btnFlex}>
                    {(focused: boolean) => (
                      <View style={[S.secondaryBtn, focused && S.secondaryBtnFocused]}>
                        <Ionicons name="copy-outline" size={ps(1.5)} color="#fff" />
                        <Text style={S.secondaryBtnText}>Copy URL</Text>
                      </View>
                    )}
                  </Focusable>
                  <Focusable ringOnFocus={false} onPress={handleDisconnect} style={S.btnFlex}>
                    {(focused: boolean) => (
                      <LinearGradient
                        colors={[THEME.colors.primary, THEME.colors.secondary]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={[S.dangerBtn, focused && S.dangerBtnFocused]}
                      >
                        <Ionicons name="warning-outline" size={ps(1.5)} color="#000000" />
                        <Text style={S.dangerBtnText}>Disconnect</Text>
                      </LinearGradient>
                    )}
                  </Focusable>
                </FocusGroup>
              </View>
            </View>
          )}

          {/* Playback */}
          <View style={S.section}>
            <Text style={S.sectionTitle}>Playback</Text>
            <Text style={S.sectionSubtitle}>Manage how content plays back</Text>
            <View style={S.card}>
              {toggleRow('repeat-outline', 'Autoplay Next Episode', 'Automatically play the next item in a series', autoPlay, toggleAutoPlay)}
              <View style={S.divider} />
              {toggleRow('flash-outline', 'Hardware Acceleration', 'Use the GPU for smoother video decoding', hardwareAcceleration, toggleHardwareAcceleration)}
            </View>
          </View>

          {/* Storage */}
          <View style={S.section}>
            <Text style={S.sectionTitle}>Storage</Text>
            <Text style={S.sectionSubtitle}>Free up space or reset the app</Text>
            <FocusGroup style={S.card}>
              {actionRow('sparkles-outline', 'Clear Cache', 'Remove temporary files', handleClearCache)}
              <View style={S.divider} />
              {actionRow('trash-outline', 'Reset App', 'Delete all portals and settings', handleClearAllData, true)}
            </FocusGroup>
          </View>

          {/* Legal */}
          <View style={S.section}>
            <Text style={S.sectionTitle}>Legal</Text>
            <Text style={S.sectionSubtitle}>Policies and terms</Text>
            <FocusGroup style={S.card}>
              {actionRow('document-text-outline', 'Privacy Policy', 'Read our privacy policy', () => router.push('/privacy-policy'))}
            </FocusGroup>
          </View>

          <View style={S.footer}>
            <Image source={require("../assets/images/TV.png")} style={{ width: pw(40), height: ph(4), maxWidth: 200, maxHeight: 40, opacity: 0.5 }} contentFit="contain" />
            <Text style={S.footerSubtext}>
              {portals.length} {portals.length === 1 ? 'portal' : 'portals'} configured
            </Text>
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const S = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#070708',
  },

  // Header
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    alignItems: 'center',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(8,8,12,0.55)',
    overflow: 'hidden',
  },
  // Android has no blur, so use a near-opaque fill (content scrolls under the
  // absolute header) and no glow.
  headerAndroid: {
    backgroundColor: '#0b0b10',
  },
  headerTitle: {
    fontSize: isTV ? ps(1.7) : ps(1.9),
    fontWeight: fw('700'),
    color: '#fff',
    letterSpacing: 0.5,
    textAlign: 'center',
  },

  content: { flex: 1 },
  scrollContent: {
    paddingHorizontal: isPhone ? pw(5) : pw(8),
    paddingBottom: ph(8),
    alignItems: "center",
  },
  // Keep content readable/centered on wide TV screens instead of full-bleed.
  contentInner: {
    width: "100%",
    maxWidth: isTV ? 760 : 620,
    alignSelf: "center",
  },

  // Sections
  section: {
    marginBottom: ph(3.5),
  },
  sectionTitle: {
    fontSize: isTV ? ps(1.4) : ps(1.6),
    fontWeight: fw('600'),
    color: '#fff',
    letterSpacing: 0.2,
    marginBottom: ph(0.4),
    marginLeft: ps(0.5),
  },
  sectionSubtitle: {
    fontSize: isTV ? ps(1) : ps(1.05),
    color: 'rgba(255,255,255,0.4)',
    marginBottom: ph(1.4),
    marginLeft: ps(0.5),
  },

  // Card
  card: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
    paddingVertical: ps(0.6),
  },

  // Portal status
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: pw(2),
    paddingHorizontal: ps(2.2),
    paddingTop: ps(1.6),
    paddingBottom: ps(1.2),
  },
  greenDot: {
    width: ps(0.9),
    height: ps(0.9),
    borderRadius: ps(0.9),
    backgroundColor: '#30D158',
    shadowColor: '#30D158',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 4,
  },
  statusText: {
    fontSize: isTV ? ps(1.2) : ps(1.3),
    fontWeight: fw('700'),
    color: '#fff',
  },
  chip: {
    marginHorizontal: ps(1.6),
    marginVertical: ps(0.5),
    paddingHorizontal: ps(1.6),
    paddingVertical: ps(1.1),
    borderRadius: ps(1.4),
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  chipLabel: {
    fontSize: isTV ? ps(0.95) : ps(0.95),
    color: 'rgba(255,255,255,0.4)',
    fontWeight: fw('600'),
    marginBottom: 3,
  },
  chipValue: {
    fontSize: isTV ? ps(1.3) : ps(1.4),
    color: '#fff',
    fontWeight: fw('700'),
  },

  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginHorizontal: ps(2),
    marginVertical: ps(0.4),
  },

  // Portal buttons
  btnRow: {
    flexDirection: 'row',
    gap: pw(2.5),
    paddingHorizontal: ps(1.6),
    paddingTop: ps(1.2),
    paddingBottom: ps(1.6),
  },
  btnFlex: { flex: 1 },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: pw(1.5),
    paddingVertical: ps(1.3),
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  secondaryBtnFocused: {
    borderColor: '#fff',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  secondaryBtnText: {
    color: '#fff',
    fontSize: isTV ? ps(1.1) : ps(1.2),
    fontWeight: fw('700'),
  },
  dangerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: pw(1.5),
    paddingVertical: ps(1.3),
    borderRadius: 18,
    shadowColor: THEME.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  dangerBtnFocused: {
    borderWidth: 2,
    borderColor: '#fff',
    transform: [{ scale: 1.03 }],
  },
  dangerBtnText: {
    color: '#000000',
    fontSize: isTV ? ps(1.1) : ps(1.2),
    fontWeight: fw('800'),
  },

  // List rows (playback + storage)
  rowPressable: {
    borderRadius: ps(1.4),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: pw(3),
    paddingVertical: ps(1.7),
    paddingHorizontal: ps(2),
    borderRadius: ps(1.4),
    borderWidth: 2,
    borderColor: 'transparent',
  },
  rowFocused: {
    borderColor: '#fff',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  rowIcon: {
    width: ps(4.4),
    height: ps(4.4),
    borderRadius: ps(2.2),
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconFocused: {
    backgroundColor: THEME.colors.primary + '22',
  },
  rowIconDanger: {
    backgroundColor: 'rgba(255,69,58,0.12)',
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    fontSize: isTV ? ps(1.4) : ps(1.5),
    color: '#fff',
    fontWeight: fw('700'),
  },
  rowSubtitle: {
    fontSize: isTV ? ps(1) : ps(1.1),
    color: 'rgba(255,255,255,0.4)',
    marginTop: 3,
  },

  // Switch
  switchTrack: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    backgroundColor: 'rgba(255,255,255,0.14)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SW_PAD,
    overflow: 'hidden',
  },
  switchTrackFill: {
    flex: 1,
    borderRadius: TRACK_H / 2,
  },
  switchKnob: {
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: '#fff',
  },

  // Footer
  footer: {
    alignItems: 'center',
    marginTop: ph(2),
  },
  footerText: {
    fontSize: ps(1.2),
    color: 'rgba(255,255,255,0.25)',
    fontWeight: fw('700'),
    letterSpacing: 1,
  },
  footerSubtext: {
    fontSize: ps(1),
    color: 'rgba(255,255,255,0.15)',
    marginTop: 4,
  },
});
