import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { CinematicBackground } from '../src/components/CinematicBackground';
import { ph, psRaw as ps, pw, THEME } from '../src/theme/tokens';
import { useDPad } from '../src/tv';
import { isTV } from '../src/utils/tvUtils';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const LAST_UPDATED = 'August 2026';
const SUPPORT_EMAIL = 'infinity.apps.support@gmail.com';

interface Section {
  icon: IconName;
  title: string;
  body?: string[];
  bullets?: string[];
}

const SECTIONS: Section[] = [
  {
    icon: 'create',
    title: 'Information You Provide',
    body: ['Depending on the connection method you choose, the App may process information that you enter, including:'],
    bullets: [
      'M3U or M3U8 playlist URLs',
      'Xtream Codes server URLs',
      'Xtream Codes usernames',
      'Xtream Codes passwords',
      'MAG / Stalker portal information',
      'MAC addresses',
      'Favorite channels and media',
      'Application preferences and settings',
    ],
  },
  {
    icon: 'save',
    title: 'Local Storage',
    body: [
      'The App may store portal information, playlist information, favorites, preferences, and related configuration data locally on your device.',
      'This local information is used to allow the App to remember your configuration between sessions.',
    ],
  },
  {
    icon: 'globe',
    title: 'Third-Party IPTV Services',
    body: [
      'When you connect the App to an IPTV service, the App communicates with the server or service that you provide.',
      'Information required by that service, such as a server URL, username, password, playlist URL, or MAC address, may be transmitted to that third-party service to authenticate your connection or retrieve content.',
      'Infinity IPTV Player does not control the privacy practices, security, or data handling of third-party IPTV providers.',
      'You are responsible for reviewing the privacy policy and terms of any IPTV service that you connect to the App.',
    ],
  },
  {
    icon: 'wifi',
    title: 'Network Requests',
    body: [
      'The App uses network connections to retrieve playlists, channel information, metadata, media information, and other content requested by the user.',
      'The App does not operate or provide the IPTV services accessed through these connections.',
    ],
  },
  {
    icon: 'heart',
    title: 'Favorites and Application Settings',
    body: [
      'Favorites and application preferences may be stored locally on your device to provide quick access and preserve your settings.',
    ],
  },
  {
    icon: 'megaphone',
    title: 'Analytics and Advertising',
    body: [
      'The App does not currently display advertisements or use third-party advertising SDKs.',
      'The App does not currently use third-party analytics services to track users.',
    ],
  },
  {
    icon: 'share-social',
    title: 'Data Sharing',
    body: [
      'Infinity IPTV Player does not sell user information.',
      'The App does not intentionally share user information with third parties except where necessary to provide functionality requested by the user, such as communicating with an IPTV service configured by the user.',
    ],
  },
  {
    icon: 'lock-closed',
    title: 'Data Security',
    body: [
      'We take reasonable measures to protect information handled by the App.',
      'However, no method of electronic transmission or storage can be guaranteed to be completely secure.',
      'Users should only enter credentials for IPTV services that they are authorized to use.',
    ],
  },
  {
    icon: 'trash',
    title: 'Data Retention and Deletion',
    body: [
      "Information stored locally by the App remains on the user's device until it is removed by the user, the application data is cleared, or the App is uninstalled.",
      "Users can remove saved portal information and other locally stored application data through the App's available settings or Android system settings.",
    ],
  },
  {
    icon: 'happy',
    title: "Children's Privacy",
    body: [
      'Infinity IPTV Player is not specifically designed for children.',
      'The App does not knowingly collect personal information from children.',
    ],
  },
  {
    icon: 'link',
    title: 'Third-Party Services',
    body: [
      'The App may communicate with third-party services configured by the user.',
      'These third-party services operate independently and have their own privacy policies and terms.',
      'Infinity IPTV Player is not responsible for the privacy practices of third-party services.',
    ],
  },
  {
    icon: 'refresh',
    title: 'Changes to This Privacy Policy',
    body: [
      'We may update this Privacy Policy from time to time.',
      'Any changes will be reflected on this page with an updated "Last updated" date.',
    ],
  },
];

const CONTACT_ROWS: { label: string; value: string; icon: IconName }[] = [
  { label: 'Email', value: SUPPORT_EMAIL, icon: 'mail' },
  { label: 'Developer / Company', value: 'Infinity_Apps', icon: 'business' },
  { label: 'App', value: 'Infinity IPTV Player', icon: 'tv' },
];

function PolicySection({ section, first }: { section: Section; first: boolean }) {
  return (
    <View style={[S.section, first && S.sectionFirst]}>
      <View style={S.sectionHeader}>
        <View style={S.sectionIcon}>
          <LinearGradient
            colors={["rgba(219, 4, 130, 0.2)", "rgba(51, 5, 235, 0.2)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Ionicons name={section.icon} size={ps(1.8)} color="#db0482" />
        </View>
        <Text style={S.sectionTitle}>{section.title}</Text>
      </View>

      {section.body?.map((paragraph) => (
        <Text key={paragraph} style={S.paragraph}>
          {paragraph}
        </Text>
      ))}

      {section.bullets ? (
        <View style={S.bulletList}>
          {section.bullets.map((bullet) => (
            <View key={bullet} style={S.bulletRow}>
              <View style={S.bulletDot} />
              <Text style={S.bulletText}>{bullet}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ContactSection() {
  return (
    <View style={S.section}>
      <View style={S.sectionHeader}>
        <View style={S.sectionIcon}>
          <LinearGradient
            colors={["rgba(219, 4, 130, 0.2)", "rgba(51, 5, 235, 0.2)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Ionicons name="chatbubble-ellipses" size={ps(1.8)} color="#db0482" />
        </View>
        <Text style={S.sectionTitle}>Contact & Support</Text>
      </View>
      <Text style={S.paragraph}>
        If you have questions about this Privacy Policy or Infinity IPTV Player, please contact:
      </Text>
      <View style={S.contactRows}>
        {CONTACT_ROWS.map((row) => (
          <View key={row.label} style={S.contactRow}>
            <View style={S.contactIconBg}>
              <Ionicons name={row.icon} size={ps(1.6)} color="#fff" />
            </View>
            <View style={S.contactRowText}>
              <Text style={S.contactLabel}>{row.label}</Text>
              <Text style={S.contactValue} numberOfLines={1}>
                {row.value}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function PrivacyPolicyScreen() {
  const insets = useSafeAreaInsets();

  const scrollRef = useRef<ScrollView>(null);
  const offsetRef = useRef(0);
  const scrollY = useRef(new Animated.Value(0)).current;
  const [viewportH, setViewportH] = useState(0);
  const [contentH, setContentH] = useState(0);

  const maxOffset = Math.max(0, contentH - viewportH);
  const canScroll = maxOffset > 4;
  const thumbH = contentH > 0 ? Math.max(ps(4), (viewportH / contentH) * viewportH) : 0;

  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: true,
        listener: (event: any) => {
          offsetRef.current = event.nativeEvent.contentOffset.y;
        },
      }),
    [scrollY]
  );

  const scrollBy = useCallback(
    (delta: number) => {
      const next = Math.min(Math.max(offsetRef.current + delta, 0), maxOffset);
      offsetRef.current = next;
      scrollRef.current?.scrollTo({ y: next, animated: true });
    },
    [maxOffset]
  );

  useDPad(
    {
      onUp: () => scrollBy(-viewportH * 0.6),
      onDown: () => scrollBy(viewportH * 0.6),
      onPageUp: () => scrollBy(-viewportH),
      onPageDown: () => scrollBy(viewportH),
    },
    { enabled: isTV && canScroll }
  );

  const thumbTranslate = scrollY.interpolate({
    inputRange: [0, Math.max(1, maxOffset)],
    outputRange: [0, Math.max(0, viewportH - thumbH)],
    extrapolate: 'clamp',
  });

  return (
    <View style={[S.container, { paddingTop: insets.top }]}>
      <CinematicBackground />

      <View style={S.header}>
        <View style={S.headerText}>
          <Text style={S.headerTitle}>Privacy Policy</Text>
          <Text style={S.headerSubtitle}>Infinity IPTV Player</Text>
        </View>

        <View style={S.updatedPill}>
          <Ionicons name="time" size={ps(1.4)} color="rgba(255,255,255,0.7)" />
          <Text style={S.updatedText}>Updated {LAST_UPDATED}</Text>
        </View>
      </View>

      <View style={S.scrollArea} onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}>
        <Animated.ScrollView
          ref={scrollRef}
          style={S.scroll}
          contentContainerStyle={S.scrollContent}
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onContentSizeChange={(_w, h) => setContentH(h)}
        >
          {/* Summary hero */}
          <View style={S.hero}>
            <LinearGradient
              colors={["rgba(219, 4, 130, 0.3)", "rgba(51, 5, 235, 0.1)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={S.heroBadge}>
              <LinearGradient
                colors={["#db0482", "#3305eb"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <Ionicons name="shield-checkmark" size={ps(3.5)} color="#fff" />
            </View>
            <View style={S.heroText}>
              <Text style={S.heroTitle}>Your data stays on your device</Text>
              <Text style={S.heroBody}>
                Infinity IPTV Player is a media player application that allows users to connect to and play content from
                IPTV services and playlists that they are authorized to access. The App does not provide, host, sell, or
                distribute IPTV channels, subscriptions, playlists, or credentials.
              </Text>
            </View>
          </View>

          {/* One continuous document */}
          <View style={S.document}>
            {SECTIONS.map((section, index) => (
              <PolicySection key={section.title} section={section} first={index === 0} />
            ))}
            <ContactSection />
          </View>
        </Animated.ScrollView>

        {canScroll && viewportH > 0 ? (
          <View style={S.scrollTrack} pointerEvents="none">
            <Animated.View style={[S.scrollThumb, { height: thumbH, transform: [{ translateY: thumbTranslate }] }]} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: pw(6),
    paddingTop: ph(3),
    paddingBottom: ph(3),
    gap: pw(2),
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: isTV ? ps(2.2) : ps(1.8),
    color: '#fff',
    fontWeight: '800',
    fontFamily: THEME.fonts.bold,
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    fontSize: isTV ? ps(1.3) : ps(1.1),
    color: 'rgba(255,255,255,0.5)',
    fontFamily: THEME.fonts.medium,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: 6,
  },
  updatedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: pw(1),
    paddingHorizontal: pw(2),
    paddingVertical: ph(1.2),
    borderRadius: ps(2),
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  updatedText: {
    fontSize: isTV ? ps(1.2) : ps(1),
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '700',
    fontFamily: THEME.fonts.bold,
  },

  // ── Scroll area ───────────────────────────────────────────────────────────
  scrollArea: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: pw(6),
    paddingTop: ph(4),
    paddingBottom: ph(10),
  },
  scrollTrack: {
    position: 'absolute',
    top: ph(4),
    bottom: ph(10),
    right: pw(1.5),
    width: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  scrollThumb: {
    width: 4,
    borderRadius: 2,
    backgroundColor: '#db0482',
    shadowColor: '#db0482',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 5,
    elevation: 2,
  },

  // ── Hero ──────────────────────────────────────────────────────────────────
  hero: {
    flexDirection: isTV ? 'row' : 'column',
    alignItems: isTV ? 'center' : 'stretch',
    gap: isTV ? pw(3) : ph(2.5),
    padding: ps(4),
    borderRadius: ps(3),
    backgroundColor: 'rgba(25, 25, 30, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(219, 4, 130, 0.4)',
    marginBottom: ph(4),
    overflow: 'hidden',
    shadowColor: '#db0482',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 5,
  },
  heroBadge: {
    width: ps(7.5),
    height: ps(7.5),
    borderRadius: ps(2.5),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  heroText: {
    flex: 1,
  },
  heroTitle: {
    fontSize: isTV ? ps(1.8) : ps(1.6),
    color: '#fff',
    fontWeight: '800',
    fontFamily: THEME.fonts.bold,
    marginBottom: ph(1.5),
    letterSpacing: 0.5,
  },
  heroBody: {
    fontSize: isTV ? ps(1.3) : ps(1.2),
    lineHeight: isTV ? ps(2.1) : ps(1.8),
    color: 'rgba(255,255,255,0.7)',
    fontFamily: THEME.fonts.medium,
  },

  // ── Document ──────────────────────────────────────────────────────────────
  document: {
    borderRadius: ps(3),
    backgroundColor: 'rgba(25, 25, 30, 0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: ps(4),
  },
  section: {
    paddingVertical: ps(3.5),
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  sectionFirst: {
    borderTopWidth: 0,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: pw(1.5),
    marginBottom: ph(2),
  },
  sectionIcon: {
    width: ps(4.2),
    height: ps(4.2),
    borderRadius: ps(1.5),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    overflow: 'hidden',
  },
  sectionTitle: {
    flex: 1,
    fontSize: isTV ? ps(1.7) : ps(1.5),
    color: '#fff',
    fontWeight: '800',
    fontFamily: THEME.fonts.bold,
    letterSpacing: 0.5,
  },
  paragraph: {
    fontSize: isTV ? ps(1.3) : ps(1.15),
    lineHeight: isTV ? ps(2) : ps(1.7),
    color: 'rgba(255,255,255,0.6)',
    fontFamily: THEME.fonts.regular,
    marginBottom: ph(1.5),
  },
  bulletList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: ph(1),
    rowGap: ph(1.2),
  },
  bulletRow: {
    width: isTV ? '50%' : '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: pw(1.2),
    paddingRight: pw(1.5),
  },
  bulletDot: {
    width: ps(0.8),
    height: ps(0.8),
    borderRadius: ps(0.4),
    backgroundColor: '#db0482',
  },
  bulletText: {
    flex: 1,
    fontSize: isTV ? ps(1.3) : ps(1.15),
    color: 'rgba(255,255,255,0.7)',
    fontFamily: THEME.fonts.medium,
  },

  // ── Contact ───────────────────────────────────────────────────────────────
  contactRows: {
    flexDirection: isTV ? 'row' : 'column',
    gap: isTV ? pw(3) : ph(2),
    marginTop: ph(2),
  },
  contactRow: {
    flex: isTV ? 1 : undefined,
    flexDirection: 'row',
    alignItems: 'center',
    gap: pw(1.5),
    backgroundColor: 'rgba(255,255,255,0.03)',
    padding: ps(1.5),
    borderRadius: ps(1.5),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  contactIconBg: {
    width: ps(4),
    height: ps(4),
    borderRadius: ps(1.2),
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactRowText: {
    flex: 1,
  },
  contactLabel: {
    fontSize: isTV ? ps(1) : ps(0.9),
    color: 'rgba(255,255,255,0.4)',
    fontWeight: '700',
    fontFamily: THEME.fonts.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  contactValue: {
    fontSize: isTV ? ps(1.4) : ps(1.2),
    color: '#fff',
    fontWeight: '800',
    fontFamily: THEME.fonts.bold,
    marginTop: 4,
  },
});
