import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Pressable,
  Platform,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePortalStore } from '../src/store/portalStore';
import { isTV } from '../src/utils/tvUtils';
import { LinearGradient } from 'expo-linear-gradient';
import { THEME } from '../src/theme/tokens';
import { BlurView } from 'expo-blur';
import MaskedView from "@react-native-masked-view/masked-view";
import { Focusable, FocusGroup } from "../src/tv";

const { width: W, height: H } = Dimensions.get("window");
const pw = (pct: number) => (W * pct) / 100;
const ph = (pct: number) => (H * pct) / 100;
const ps = (pct: number) => (pw(pct) + ph(pct)) / 2;



const GradientText = ({ text, style, colors }: { text: string; style?: any; colors?: string[] }) => {
  const gradientColors = (colors as [string, string, ...string[]]) || (["#fff", "rgba(255,255,255,0.4)"] as [string, string, ...string[]]);
  return (
    <MaskedView maskElement={<Text style={style}>{text}</Text>}>
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
      >
        <Text style={[style, { opacity: 0 }]}>{text}</Text>
      </LinearGradient>
    </MaskedView>
  );
};

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { portals, activePortal, setActivePortal, clearPortalData } = usePortalStore();

  const [autoPlay, setAutoPlay] = useState(true);
  const [hardwareAcceleration, setHardwareAcceleration] = useState(true);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  // Load settings on mount
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
      const currentSettings = {
        autoPlay,
        hardwareAcceleration,
        ...newSettings,
      };
      await AsyncStorage.setItem('app_settings', JSON.stringify(currentSettings));
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  };

  const toggleAutoPlay = useCallback(() => {
    const newValue = !autoPlay;
    setAutoPlay(newValue);
    saveSettings({ autoPlay: newValue });
  }, [autoPlay]);

  const toggleHardwareAcceleration = useCallback(() => {
    const newValue = !hardwareAcceleration;
    setHardwareAcceleration(newValue);
    saveSettings({ hardwareAcceleration: newValue });
  }, [hardwareAcceleration]);

  const handleClearCache = useCallback(() => {
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
            } catch (error) {
              Alert.alert('Error', 'Failed to clear cache');
            }
          },
        },
      ]
    );
  }, []);

  const handleClearAllData = useCallback(() => {
    Alert.alert(
      'Clear All Data',
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
            } catch (error) {
              Alert.alert('Error', 'Failed to clear data');
            }
          },
        },
      ]
    );
  }, []);

  const handleDisconnect = useCallback(async () => {
    await setActivePortal(null);
    clearPortalData();
    router.replace('/');
  }, []);

  const focusId = (id: string) => () => setFocusedId(id);
  const blurId = () => setFocusedId(null);

  const renderBentoContent = (icon: any, title: string, subtitle: string) => (
    <>
      <View style={S.bentoIconBox}>
        <Ionicons name={icon} size={ps(2)} color={THEME.colors.primary} />
      </View>
      <View>
        <GradientText
          text={title}
          style={S.bentoTitle}
          colors={["#fff", "rgba(255,255,255,0.7)"]}
        />
        <Text style={S.bentoSubtitle}>{subtitle}</Text>
      </View>
    </>
  );

  return (
    <View style={S.container}>
      {/* Background gradients */}
      <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
        <LinearGradient
          colors={["#2a0845", "transparent"]}
          start={{ x: 1, y: 0 }}
          end={{ x: 0.5, y: 0.5 }}
          style={{ position: "absolute", top: 0, right: 0, width: "100%", height: "100%", opacity: 0.3 }}
        />
        <LinearGradient
          colors={["#6441a5", "transparent"]}
          start={{ x: 0, y: 1 }}
          end={{ x: 0.3, y: 0.7 }}
          style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: "100%", opacity: 0.15 }}
        />
      </View>

      {/* Modern Centered Header */}
      <View style={S.headerBranding}>
        <View style={S.headerTopRow}>
          <Focusable
            ringOnFocus={false}
            onPress={() => router.back()}
            style={S.backBtn}
            focusStyle={S.backBtnFocused}
          >
            <Ionicons name="chevron-back" size={ps(2.5)} color="#fff" />
          </Focusable>
          <View style={{ flex: 1 }} />
        </View>
        <Text style={S.brandingText}>IPTV HUB</Text>
        <Text style={S.headerSubtitle}>APPLICATION PREFERENCES & SYSTEM</Text>
        <Text style={S.headerSubtitleAccent}>SETTINGS CONTROL PANEL</Text>
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
            <Text style={S.sectionLabel}>PORTAL INFORMATION</Text>
            <View style={S.portalCardImageStyle}>
              <View style={S.portalInfoCols}>
                <View style={S.infoCol}>
                  <Text style={S.tinyLabel}>Portal URL</Text>
                  <Text style={S.largeValue} numberOfLines={1}>{activePortal.config.url}</Text>
                </View>
                <View style={S.infoCol}>
                  <Text style={S.tinyLabel}>Device MAC Address</Text>
                  <Text style={S.largeValue}>{activePortal.config.mac || "00:1A:79:XX:XX:XX"}</Text>
                </View>
              </View>

              <Focusable
                ringOnFocus={false}
                onPress={handleDisconnect}
                style={S.disconnectBtnWrapper}
              >
                {(focused) => (
                  <LinearGradient
                    colors={[THEME.colors.primary, THEME.colors.secondary]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[S.disconnectBtnGradient, focused && S.disconnectBtnFocused]}
                  >
                    <Ionicons name="warning" size={ps(1.8)} color="#fff" />
                    <GradientText
                      text="Disconnect Portal"
                      style={S.disconnectBtnText}
                      colors={["#fff", "rgba(255,255,255,0.8)"]}
                    />
                  </LinearGradient>
                )}
              </Focusable>
            </View>
          </View>
        )}

        {/* Playback Section */}
        <View style={S.rootSection}>
          <Text style={S.sectionLabel}>PLAYBACK SETTINGS</Text>
          <View style={S.groupedCard}>
            {/* Item 1 */}
            <Focusable ringOnFocus={false} onPress={toggleAutoPlay} style={S.innerListItem}>
              {(focused) => (
                <>
                  <View style={[S.innerIconBox, focused && S.innerIconBoxFocused]}>
                    <Ionicons name="repeat-outline" size={ps(2.2)} color="#fff" />
                  </View>
                  <View style={S.innerTextContent}>
                    <Text style={S.innerTitle}>Autoplay Next Episode</Text>
                    <Text style={S.innerSubtitle}>Automatically play the next item in a series</Text>
                  </View>
                  <View style={[S.customSwitch, autoPlay && S.customSwitchActive]}>
                    <View style={[S.switchKnob, autoPlay && S.switchKnobActive]} />
                  </View>
                </>
              )}
            </Focusable>

            <View style={S.innerDivider} />

            {/* Item 2 */}
            <Focusable ringOnFocus={false} onPress={toggleHardwareAcceleration} style={S.innerListItem}>
              {(focused) => (
                <>
                  <View style={[S.innerIconBox, focused && S.innerIconBoxFocused]}>
                    <Ionicons name="flash-outline" size={ps(2.2)} color="#fff" />
                  </View>
                  <View style={S.innerTextContent}>
                    <Text style={S.innerTitle}>Hardware Acceleration</Text>
                    <Text style={S.innerSubtitle}>Use GPU for smoother video decoding</Text>
                  </View>
                  <View style={[S.customSwitch, hardwareAcceleration && S.customSwitchActive]}>
                    <View style={[S.switchKnob, hardwareAcceleration && S.switchKnobActive]} />
                  </View>
                </>
              )}
            </Focusable>
          </View>
        </View>

        {/* Data Section */}
        <View style={S.rootSection}>
          <Text style={S.sectionLabel}>APP MANAGEMENT / DATA</Text>
          <FocusGroup style={S.bentoRow}>
            <Focusable ringOnFocus={false} onPress={handleClearCache} style={S.bentoPressable}>
              {(focused) => (
                focused ? (
                  <LinearGradient
                    colors={[THEME.colors.primary, THEME.colors.secondary]}
                    style={S.bentoGradientBorder}
                  >
                    <View style={[S.bentoCard, S.bentoCardFocused]}>
                      {renderBentoContent('brush', 'Clear Cache', 'Remove temporary files')}
                    </View>
                  </LinearGradient>
                ) : (
                  <View style={S.bentoCard}>
                    {renderBentoContent('brush', 'Clear Cache', 'Remove temporary files')}
                  </View>
                )
              )}
            </Focusable>

            <Focusable ringOnFocus={false} onPress={handleClearAllData} style={S.bentoPressable}>
              {(focused) => (
                focused ? (
                  <LinearGradient
                    colors={[THEME.colors.primary, THEME.colors.secondary]}
                    style={S.bentoGradientBorder}
                  >
                    <View style={[S.bentoCard, S.bentoCardFocused]}>
                      {renderBentoContent('trash', 'Clear Data', 'Reset all settings')}
                    </View>
                  </LinearGradient>
                ) : (
                  <View style={S.bentoCard}>
                    {renderBentoContent('trash', 'Clear Data', 'Reset all settings')}
                  </View>
                )
              )}
            </Focusable>
          </FocusGroup>
        </View>


        {/* Stats */}
        <View style={S.stats}>
          <View style={S.statItem}>
            <Text style={S.statValue}>
              {portals.length}
            </Text>
            <Text style={S.statLabel}>
              Configured Portals
            </Text>
          </View>
        </View>


      </ScrollView>
    </View>
  );
}

const S = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#08080a',
  },
  headerBranding: {
    alignItems: 'center',
    paddingTop: ph(4),
    marginBottom: ph(2),
  },
  headerTopRow: {
    width: '100%',
    flexDirection: 'row',
    paddingHorizontal: pw(4),
    position: 'absolute',
    top: ph(3),
    zIndex: 10,
  },
  backBtn: {
    width: ps(5),
    height: ps(5),
    borderRadius: ps(2.5),
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnFocused: {
    backgroundColor: THEME.colors.primary,
    transform: [{ scale: 1.1 }],
  },
  brandingText: {
    fontSize: isTV ? ps(2.5) : ps(2.2),
    fontWeight: "500",
    color: "#fff",
    letterSpacing: 5,
    marginBottom: ph(1),
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: isTV ? ps(1.2) : ps(0.9),
    color: "rgba(255,255,255,0.4)",
    fontWeight: "400",
    letterSpacing: 1.5,
    textAlign: "center",
    marginBottom: ph(0.5),
  },
  headerSubtitleAccent: {
    fontSize: isTV ? ps(1.2) : ps(0.9),
    color: THEME.colors.primary,
    fontWeight: "600",
    letterSpacing: 2,
    textAlign: "center",
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: pw(8),
    paddingBottom: ph(10),
  },
  itemWrapper: {
    marginBottom: ph(1.5),
  },
  pressable: {
    borderRadius: ps(1.5),
    overflow: 'hidden',
  },
  gradientBorder: {
    padding: 1,
    borderRadius: ps(1.5),
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: ps(2),
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: ps(1.4),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  settingItemFocused: {
    backgroundColor: '#1D1B20',
    borderWidth: 0,
    shadowColor: THEME.colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 10,
  },
  settingIcon: {
    width: ps(6),
    height: ps(6),
    borderRadius: ps(1.5),
    backgroundColor: 'rgba(255,255,255,0.02)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: pw(2),
  },
  settingIconActive: {
    backgroundColor: 'transparent',
  },
  settingIconDanger: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  settingInfo: {
    flex: 1,
  },
  settingTitle: {
    fontSize: ps(1.8),
    fontWeight: '300',
    color: '#fff',
    letterSpacing: 1,
  },
  settingTitleDanger: {
    color: '#ef4444',
  },
  settingSubtitle: {
    fontSize: ps(1.1),
    color: 'rgba(255,255,255,0.3)',
    fontWeight: '300',
    marginTop: 4,
    letterSpacing: 0.5,
  },
  rootSection: {
    marginBottom: ph(4),
  },
  sectionLabel: {
    fontSize: isTV ? ps(1.2) : ps(1),
    fontWeight: '700',
    color: 'rgba(255,255,255,0.2)',
    letterSpacing: 1.5,
    marginBottom: ph(2),
  },
  portalCardImageStyle: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: ps(2),
    padding: ps(3.5),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  portalInfoCols: {
    flexDirection: 'row',
    marginBottom: ph(4),
    gap: pw(4),
  },
  infoCol: {
    flex: 1,
  },
  tinyLabel: {
    fontSize: isTV ? ps(1.1) : ps(0.9),
    color: 'rgba(255,255,255,0.3)',
    fontWeight: '600',
    marginBottom: ph(0.5),
  },
  largeValue: {
    fontSize: ps(1.8),
    color: '#fff',
    fontWeight: '700',
  },
  disconnectBtnWrapper: {
    alignSelf: 'flex-start',
    borderRadius: ps(1.2),
    overflow: 'hidden',
    // Shadow for gradient button
    shadowColor: THEME.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 10,
  },
  disconnectBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: pw(3),
    paddingVertical: ph(1.8),
    gap: pw(1.2),
  },
  disconnectBtnFocused: {
    transform: [{ scale: 1.05 }],
    borderWidth: 1,
    borderColor: '#fff',
  },
  disconnectBtnText: {
    color: '#fff',
    fontSize: ps(1.4),
    fontWeight: '700',
  },

  // Grouped Card
  groupedCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: ps(2),
    padding: ps(1),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  innerListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: ps(2),
    borderRadius: ps(1),
  },
  innerIconBox: {
    width: ps(5),
    height: ps(5),
    borderRadius: ps(2.5),
    backgroundColor: 'rgba(255,255,255,0.03)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: pw(2),
  },
  innerIconBoxFocused: {
    backgroundColor: THEME.colors.primary + '20',
  },
  innerTextContent: {
    flex: 1,
  },
  innerTitle: {
    fontSize: ps(1.6),
    color: '#fff',
    fontWeight: '700',
  },
  innerSubtitle: {
    fontSize: isTV ? ps(1.2) : ps(1.1),
    color: 'rgba(255,255,255,0.3)',
    marginTop: 2,
  },
  innerDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginHorizontal: ps(2),
  },

  // Bento Row
  bentoRow: {
    flexDirection: 'row',
    gap: pw(2),
  },
  bentoPressable: {
    flex: 1,
    borderRadius: ps(2),
    overflow: 'hidden',
  },
  bentoGradientBorder: {
    padding: 1,
    borderRadius: ps(2),
  },
  bentoCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: ps(2),
    padding: ps(3),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: pw(1.5),
  },
  bentoCardFocused: {
    backgroundColor: '#1D1B20',
    borderWidth: 0,
    shadowColor: THEME.colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 10,
  },
  bentoIconBox: {
    width: ps(6),
    height: ps(6),
    borderRadius: ps(1.2),
    backgroundColor: 'rgba(255,255,255,0.02)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bentoTitle: {
    fontSize: ps(1.6),
    color: '#fff',
    fontWeight: '700',
  },
  bentoSubtitle: {
    fontSize: isTV ? ps(1.1) : ps(1),
    color: 'rgba(255,255,255,0.3)',
    width: pw(25),
    marginTop: 2,
  },

  // Switch
  customSwitch: {
    width: pw(4.5),
    height: ph(3.5),
    borderRadius: ps(2),
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    padding: 2,
  },
  customSwitchActive: {
    backgroundColor: THEME.colors.primary,
  },
  switchKnob: {
    width: ps(1.8),
    height: ps(1.8),
    borderRadius: ps(0.9),
    backgroundColor: '#fff',
  },
  switchKnobActive: {
    alignSelf: 'flex-end',
  },

  stats: {
    marginTop: ph(6),
    alignItems: 'center',
  },
  statItem: {
    alignItems: 'center',
    paddingVertical: ph(3),
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
    marginTop: ph(4),
  },
  footerText: {
    fontSize: ps(1.2),
    color: 'rgba(255,255,255,0.2)',
    fontWeight: '700',
    letterSpacing: 2,
  },
  footerSubtext: {
    fontSize: ps(1),
    color: 'rgba(255,255,255,0.1)',
    marginTop: 4,
    letterSpacing: 1,
  },
});