import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

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
    icon: 'save-outline',
    title: 'Local Storage & Credentials',
    body: [
      'Your playlist URLs, credentials, favorites, and settings are stored strictly on your local device to preserve your configuration between sessions.',
      'We do not operate backend servers and never collect, upload, or sell your personal data.',
    ],
  },
  {
    icon: 'globe-outline',
    title: 'Direct IPTV Connections',
    body: [
      'The App communicates directly with the IPTV service providers and playlist URLs you configure.',
      'Infinity IPTV Player does not host, provide, or distribute media content, and has no control over third-party IPTV servers.',
    ],
  },
  {
    icon: 'shield-checkmark-outline',
    title: 'Zero Tracking & No Ads',
    body: [
      'The App contains no third-party advertisements, tracking SDKs, or user analytics.',
      'Your viewing activity remains completely private to your device.',
    ],
  },
  {
    icon: 'trash-outline',
    title: 'Data Control & Deletion',
    body: [
      'You have complete control over your data. Clearing app data or disconnecting a portal in Settings immediately and permanently removes all stored data from your device.',
    ],
  },
];

const CONTACT_ROWS: { label: string; value: string; icon: IconName }[] = [
  { label: 'Support Email', value: SUPPORT_EMAIL, icon: 'mail-outline' },
  { label: 'Application', value: 'Infinity IPTV Player', icon: 'tv-outline' },
];

/**
 * One section of the policy, as a run of a continuous document rather than a
 * standalone card.
 *
 * An earlier pass laid these out as a two-column grid of cards. That fragments
 * ~200 words of legal copy into a dozen boxes of wildly differing height, and no
 * split of a card grid can come out level — the leftover is up to half a card
 * tall wherever it is cut. A single column has no such failure mode, and reads
 * the way a policy is meant to.
 */
function PolicySection({ section, first }: { section: Section; first: boolean }) {
  return (
    <View style={[S.section, first && S.sectionFirst]}>
      <View style={S.sectionHeader}>
        <View style={S.sectionIcon}>
          <Ionicons name={section.icon} size={ps(1.6)} color="rgba(255,255,255,0.85)" />
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
          <Ionicons name="chatbubble-ellipses-outline" size={ps(1.6)} color="rgba(255,255,255,0.85)" />
        </View>
        <Text style={S.sectionTitle}>Contact</Text>
      </View>
      <Text style={S.paragraph}>
        If you have questions about this Privacy Policy or Infinity IPTV Player, please contact:
      </Text>
      <View style={S.contactRows}>
        {CONTACT_ROWS.map((row) => (
          <View key={row.label} style={S.contactRow}>
            <Ionicons name={row.icon} size={ps(1.5)} color="rgba(255,255,255,0.4)" />
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

  // The page holds no focusable content, so on TV the D-pad drives the document
  // directly instead of walking a list of fake focus targets. The back button
  // keeps its own OK handler — `useDPad` dispatches per key, not per subscriber.
  useDPad(
    {
      onUp: () => scrollBy(-viewportH * 0.6),
      onDown: () => scrollBy(viewportH * 0.6),
      onPageUp: () => scrollBy(-viewportH),
      onPageDown: () => scrollBy(viewportH),
    },
    { enabled: isTV && canScroll }
  );

  return (
    <View style={[S.container, { paddingTop: insets.top }]}>
      <CinematicBackground />

      <View style={S.header}>
        <View style={S.headerText}>
          <Text style={S.headerTitle}>Privacy Policy</Text>
          <Text style={S.headerSubtitle}>Infinity IPTV Player</Text>
        </View>

        <View style={S.updatedPill}>
          <Ionicons name="time-outline" size={ps(1.2)} color="rgba(255,255,255,0.6)" />
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
            <View style={S.heroBadge}>
              <Ionicons name="shield-checkmark" size={ps(3)} color="#fff" />
            </View>
            <View style={S.heroText}>
              <Text style={S.heroTitle}>Your data stays on your device</Text>
              <Text style={S.heroBody}>
                Infinity IPTV Player is a local media player. Your credentials, playlists, and viewing history remain strictly on your device. We do not host content, collect personal data, or track your activity.
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
    paddingTop: ph(2),
    paddingBottom: ph(2),
    gap: pw(2),
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: isTV ? ps(1.8) : ps(1.5),
    color: '#fff',
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    fontSize: isTV ? ps(1.2) : ps(0.9),
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 1,
    marginTop: 2,
  },
  updatedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: pw(0.6),
    paddingHorizontal: pw(1.4),
    paddingVertical: ph(0.8),
    borderRadius: ps(2),
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  updatedText: {
    fontSize: isTV ? ps(1.2) : ps(0.9),
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '600',
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
    paddingTop: ph(3),
    paddingBottom: ph(8),
  },

  // ── Hero ──────────────────────────────────────────────────────────────────
  hero: {
    flexDirection: isTV ? 'row' : 'column',
    alignItems: isTV ? 'flex-start' : 'stretch',
    gap: isTV ? pw(2.5) : ph(2),
    padding: ps(3),
    borderRadius: ps(2.5),
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    marginBottom: ph(3),
  },
  heroBadge: {
    width: ps(7),
    height: ps(7),
    borderRadius: ps(3.5),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  heroText: {
    flex: 1,
  },
  heroTitle: {
    fontSize: isTV ? ps(1.6) : ps(1.4),
    color: '#fff',
    fontWeight: '700',
    marginBottom: ph(1),
  },
  heroBody: {
    fontSize: isTV ? ps(1.4) : ps(1.15),
    lineHeight: isTV ? ps(2.2) : ps(1.8),
    color: 'rgba(255,255,255,0.65)',
  },
  // ── Document ──────────────────────────────────────────────────────────────
  /** One surface holding every section, with hairlines between them instead of
   *  a box around each. Sections are separated, not boxed. */
  document: {
    borderRadius: ps(2),
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: ps(3),
  },
  section: {
    paddingVertical: ps(2.5),
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  sectionFirst: {
    borderTopWidth: 0,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: pw(1.2),
    marginBottom: ph(1.5),
  },
  sectionIcon: {
    width: ps(3.6),
    height: ps(3.6),
    borderRadius: ps(0.9),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  sectionTitle: {
    flex: 1,
    fontSize: isTV ? ps(1.6) : ps(1.4),
    color: THEME.colors.primary,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  paragraph: {
    fontSize: isTV ? ps(1.2) : ps(1),
    lineHeight: isTV ? ps(1.9) : ps(1.6),
    color: 'rgba(255,255,255,0.6)',
    marginBottom: ph(1),
  },
  /** Two abreast on TV. Safe to wrap where the cards were not: every bullet is
   *  a single line, so each wrapped row is the same height and none can leave a
   *  gap beneath it. */
  bulletList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: ph(0.5),
    rowGap: ph(0.9),
  },
  bulletRow: {
    width: isTV ? '50%' : '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: pw(1),
    paddingRight: pw(1),
  },
  bulletDot: {
    width: ps(0.5),
    height: ps(0.5),
    borderRadius: ps(0.25),
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  bulletText: {
    flex: 1,
    fontSize: isTV ? ps(1.2) : ps(1),
    color: 'rgba(255,255,255,0.75)',
  },

  // ── Contact ───────────────────────────────────────────────────────────────
  /** Three abreast on TV — the document is full width, so there is room. */
  contactRows: {
    flexDirection: isTV ? 'row' : 'column',
    gap: isTV ? pw(3) : ph(1.5),
    marginTop: ph(1),
  },
  contactRow: {
    flex: isTV ? 1 : undefined,
    flexDirection: 'row',
    alignItems: 'center',
    gap: pw(1),
  },
  contactRowText: {
    flex: 1,
  },
  contactLabel: {
    fontSize: isTV ? ps(1.1) : ps(0.95),
    color: 'rgba(255,255,255,0.35)',
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  contactValue: {
    fontSize: isTV ? ps(1.5) : ps(1.35),
    color: '#fff',
    fontWeight: '700',
    marginTop: 2,
  },
});