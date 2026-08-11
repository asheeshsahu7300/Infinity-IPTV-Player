import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CinematicBackground } from '../src/components/CinematicBackground';
import { pw, ph, psRaw as ps, THEME } from '../src/theme/tokens';
import { Focusable } from '../src/tv';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { isTV } from '../src/utils/tvUtils';

export default function PrivacyPolicyScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[S.container, { paddingTop: insets.top }]}>
      <CinematicBackground />

      <View style={S.header}>
        <Focusable ringOnFocus={false} onPress={() => router.back()} style={S.backBtnWrapper}>
          {(focused) => (
            <View style={[S.backBtn, focused && S.backBtnFocused]}>
              <Ionicons name="arrow-back" size={ps(2.5)} color={focused ? "#000" : "#fff"} />
            </View>
          )}
        </Focusable>
        <Text style={S.headerTitle}>Privacy Policy</Text>
      </View>

      <ScrollView 
        style={S.content}
        contentContainerStyle={S.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={S.paragraph}>
          <Text style={S.bold}>Last updated:</Text> August 2026
        </Text>

        <Text style={S.paragraph}>
          Infinity IPTV Player ("the App") is a media player application that allows users to connect to and play content from IPTV services and playlists that they are authorized to access.
        </Text>
        <Text style={S.paragraph}>
          The App does not provide, host, sell, or distribute IPTV channels, subscriptions, playlists, or credentials.
        </Text>

        <Text style={S.heading}>Information You Provide</Text>
        <Text style={S.paragraph}>
          Depending on the connection method you choose, the App may process information that you enter, including:
        </Text>
        <Text style={S.listItem}>• M3U or M3U8 playlist URLs</Text>
        <Text style={S.listItem}>• Xtream Codes server URLs</Text>
        <Text style={S.listItem}>• Xtream Codes usernames</Text>
        <Text style={S.listItem}>• Xtream Codes passwords</Text>
        <Text style={S.listItem}>• MAG / Stalker portal information</Text>
        <Text style={S.listItem}>• MAC addresses</Text>
        <Text style={S.listItem}>• Favorite channels and media</Text>
        <Text style={S.listItem}>• Application preferences and settings</Text>
        <Text style={S.paragraph}>
          This information is used only to provide the functionality requested by you.
        </Text>

        <Text style={S.heading}>Local Storage</Text>
        <Text style={S.paragraph}>
          The App may store portal information, playlist information, favorites, preferences, and related configuration data locally on your device.
        </Text>
        <Text style={S.paragraph}>
          This local information is used to allow the App to remember your configuration between sessions.
        </Text>

        <Text style={S.heading}>Third-Party IPTV Services</Text>
        <Text style={S.paragraph}>
          When you connect the App to an IPTV service, the App communicates with the server or service that you provide.
        </Text>
        <Text style={S.paragraph}>
          Information required by that service, such as a server URL, username, password, playlist URL, or MAC address, may be transmitted to that third-party service to authenticate your connection or retrieve content.
        </Text>
        <Text style={S.paragraph}>
          Infinity IPTV Player does not control the privacy practices, security, or data handling of third-party IPTV providers.
        </Text>
        <Text style={S.paragraph}>
          You are responsible for reviewing the privacy policy and terms of any IPTV service that you connect to the App.
        </Text>

        <Text style={S.heading}>Network Requests</Text>
        <Text style={S.paragraph}>
          The App uses network connections to retrieve playlists, channel information, metadata, media information, and other content requested by the user.
        </Text>
        <Text style={S.paragraph}>
          The App does not operate or provide the IPTV services accessed through these connections.
        </Text>

        <Text style={S.heading}>Favorites and Application Settings</Text>
        <Text style={S.paragraph}>
          Favorites and application preferences may be stored locally on your device to provide quick access and preserve your settings.
        </Text>

        <Text style={S.heading}>Analytics and Advertising</Text>
        <Text style={S.paragraph}>
          The App does not currently display advertisements or use third-party advertising SDKs.
        </Text>
        <Text style={S.paragraph}>
          The App does not currently use third-party analytics services to track users.
        </Text>

        <Text style={S.heading}>Data Sharing</Text>
        <Text style={S.paragraph}>
          Infinity IPTV Player does not sell user information.
        </Text>
        <Text style={S.paragraph}>
          The App does not intentionally share user information with third parties except where necessary to provide functionality requested by the user, such as communicating with an IPTV service configured by the user.
        </Text>

        <Text style={S.heading}>Data Security</Text>
        <Text style={S.paragraph}>
          We take reasonable measures to protect information handled by the App.
        </Text>
        <Text style={S.paragraph}>
          However, no method of electronic transmission or storage can be guaranteed to be completely secure.
        </Text>
        <Text style={S.paragraph}>
          Users should only enter credentials for IPTV services that they are authorized to use.
        </Text>

        <Text style={S.heading}>Data Retention and Deletion</Text>
        <Text style={S.paragraph}>
          Information stored locally by the App remains on the user's device until it is removed by the user, the application data is cleared, or the App is uninstalled.
        </Text>
        <Text style={S.paragraph}>
          Users can remove saved portal information and other locally stored application data through the App's available settings or Android system settings.
        </Text>

        <Text style={S.heading}>Children's Privacy</Text>
        <Text style={S.paragraph}>
          Infinity IPTV Player is not specifically designed for children.
        </Text>
        <Text style={S.paragraph}>
          The App does not knowingly collect personal information from children.
        </Text>

        <Text style={S.heading}>Third-Party Services</Text>
        <Text style={S.paragraph}>
          The App may communicate with third-party services configured by the user.
        </Text>
        <Text style={S.paragraph}>
          These third-party services operate independently and have their own privacy policies and terms.
        </Text>
        <Text style={S.paragraph}>
          Infinity IPTV Player is not responsible for the privacy practices of third-party services.
        </Text>

        <Text style={S.heading}>Changes to This Privacy Policy</Text>
        <Text style={S.paragraph}>
          We may update this Privacy Policy from time to time.
        </Text>
        <Text style={S.paragraph}>
          Any changes will be reflected on this page with an updated "Last updated" date.
        </Text>

        <Text style={S.heading}>Contact</Text>
        <Text style={S.paragraph}>
          If you have questions about this Privacy Policy or Infinity IPTV Player, please contact:
        </Text>
        <Text style={S.paragraph}>
          <Text style={S.bold}>Email:</Text> infinity.apps.support@gmail.com{"\n"}
          <Text style={S.bold}>Developer / Company:</Text> Infinity_Apps{"\n"}
          <Text style={S.bold}>App:</Text> Infinity IPTV Player
        </Text>

      </ScrollView>
    </View>
  );
}

const S = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: pw(4),
    paddingVertical: ph(2),
  },
  backBtnWrapper: {
    borderRadius: ps(2.5),
    overflow: 'hidden',
    marginRight: pw(2),
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
  headerTitle: {
    fontSize: isTV ? ps(1.8) : ps(1.5),
    color: '#fff',
    fontWeight: '600',
    letterSpacing: 1,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: pw(8),
    paddingBottom: ph(10),
  },
  heading: {
    fontSize: isTV ? ps(1.5) : ps(1.3),
    color: THEME.colors.primary,
    fontWeight: '700',
    marginTop: ph(4),
    marginBottom: ph(1.5),
  },
  paragraph: {
    fontSize: isTV ? ps(1.2) : ps(1),
    color: 'rgba(255,255,255,0.7)',
    lineHeight: isTV ? ps(1.8) : ps(1.5),
    marginBottom: ph(1),
  },
  bold: {
    fontWeight: '700',
    color: '#fff',
  },
  listItem: {
    fontSize: isTV ? ps(1.2) : ps(1),
    color: 'rgba(255,255,255,0.7)',
    lineHeight: isTV ? ps(1.8) : ps(1.5),
    marginBottom: ph(0.5),
    paddingLeft: pw(2),
  }
});
