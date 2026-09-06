// ─────────────────────────────────────────────────────────────────────────────
// EPG — the programme guide.
//
// Laid out as channels on the left and one channel's schedule on the right,
// rather than as a scrolling time grid. That is the shape set-top firmware
// itself uses, and on a D-pad it is the only one that works: a time grid needs
// two axes of scrolling plus a third for the channel list, and every press
// becomes a guess about which one moved.
//
// It also matches what can actually be fetched. Only MAG hands over the whole
// schedule at once; Xtream serves a few programmes per channel on request, and
// a plain M3U has nothing but an XMLTV file that may or may not exist. Asking
// for one channel at a time is the access pattern all three can satisfy — see
// src/services/epgService.ts.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image as RNImage, StatusBar, StyleSheet, View } from 'react-native';
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";

import { usePortalStore, Channel, EPGProgram } from "../src/store/portalStore";
import { epgService, type EpgLoadPhase } from "../src/services/epgService";
import { parentalControl } from "../src/services/parentalControl";
import { stbEnvironment } from "../src/services/stbEnvironment";
import {
  buildChannelNumbers,
  liveChannelSession,
  withChannelNumbers,
} from "../src/services/liveChannelSession";
import { StreamManager } from "../src/services/StreamManager";
import { CinematicBackground } from "../src/components/CinematicBackground";
import PinPrompt from "../src/components/PinPrompt";
import { THEME, ph, psRaw as ps, pw } from "../src/theme/tokens";
import { Focusable, FocusGroup } from "../src/tv";
import { Calendar, Lock, Tv } from 'lucide-react-native';
import { Text } from '../src/components/Text';


/**
 * The load phase, in words.
 *
 * One flat "Loading guide…" covered a download of several megabytes, a roughly
 * tenfold inflate and then a sweep over six figures of programmes — forty-odd
 * seconds of one unchanging line, which is indistinguishable from wedged. The
 * phases were already reported by the service; this is what reads them.
 */
const PHASE_TEXT: Record<EpgLoadPhase, string> = {
  idle: "Loading guide…",
  checking: "Checking the guide…",
  downloading: "Downloading guide…",
  inflating: "Decompressing guide…",
  parsing: "Reading programmes…",
  merging: "Matching channels…",
  saving: "Saving guide…",
  done: "Loading guide…",
  failed: "Loading guide…",
};

const CHANNEL_PANE_WIDTH = pw(30);
const CHANNEL_ROW_HEIGHT = ph(11);
const PROGRAM_ROW_HEIGHT = ph(14);

// ─────────────────────────────────────────────────────────────────────────────
// Rows
// ─────────────────────────────────────────────────────────────────────────────

const ChannelRow = React.memo(
  function ChannelRow({
    channel,
    number,
    isSelected,
    preferFocus,
    locked,
    onFocusChannel,
    onPlay,
    epgVersion,
    index,
  }: {
    channel: Channel;
    number?: number;
    isSelected: boolean;
    preferFocus: boolean;
    locked: boolean;
    onFocusChannel: (channel: Channel, index: number) => void;
    onPlay: (channel: Channel) => void;
    epgVersion: number;
    index: number;
  }) {
    const nowNext = useMemo(
      () => epgService.nowNext(channel),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [channel.id, epgVersion]
    );

    return (
      <Focusable
        ringOnFocus={false}
        hasTVPreferredFocus={preferFocus}
        onFocus={() => onFocusChannel(channel, index)}
        onPress={() => onPlay(channel)}
        style={S.channelRowWrapper}
        accessibilityLabel={`${channel.name}${nowNext.now ? `, now ${nowNext.now.title}` : ""}`}
      >
        {(focused) => (
          <View style={[S.channelRow, isSelected && S.channelRowSelected, focused && S.channelRowFocused]}>
            <Text style={[
              S.channelNumber,
              focused ? { color: "#000000" } : isSelected && S.textOnActive,
            ]}>{number ?? ""}</Text>

            <View style={S.channelLogo}>
              {locked ? (
                <Lock size={ps(1.4)}
                  color={focused ? "#000000" : isSelected ? "#111" : "rgba(255,255,255,0.6)"} />
              ) : channel.logo ? (
                <Image source={{ uri: channel.logo }} style={S.channelLogoImage} contentFit="contain" cachePolicy="memory-disk" />
              ) : (
                <Tv size={ps(1.4)}
                  color={focused ? "#000000" : isSelected ? "#111" : "rgba(255,255,255,0.2)"} />
              )}
            </View>

            <Text style={[
              S.channelName,
              (focused || isSelected) && S.textOnActive
            ]} numberOfLines={1}>
              {channel.name}
            </Text>
          </View>
        )}
      </Focusable>
    );
  },
  (prev, next) =>
    prev.channel.id === next.channel.id &&
    prev.isSelected === next.isSelected &&
    prev.preferFocus === next.preferFocus &&
    prev.locked === next.locked &&
    prev.number === next.number &&
    prev.epgVersion === next.epgVersion
);

const ProgramRow = React.memo(function ProgramRow({
  program,
  isNow,
  isPast,
  onFocusProgram,
  onPlay,
  preferFocus,
}: {
  program: EPGProgram;
  isNow: boolean;
  isPast: boolean;
  onFocusProgram: (program: EPGProgram) => void;
  onPlay: () => void;
  preferFocus: boolean;
}) {
  const progress = isNow
    ? Math.min(1, Math.max(0, (Date.now() - program.start) / Math.max(1, program.end - program.start)))
    : 0;

  return (
    <Focusable
      ringOnFocus={false}
      hasTVPreferredFocus={preferFocus}
      onFocus={() => onFocusProgram(program)}
      onPress={onPlay}
      style={S.programRowWrapper}
      accessibilityLabel={`${program.title} at ${stbEnvironment.formatClock(program.start)}`}
    >
      {(focused) => (
        <View style={[S.programRow, isNow && S.programRowNow, focused && S.programRowFocused]}>
          <View style={S.programTimeCol}>
            <Text style={[S.programTime, focused ? { color: "#000000" } : isPast && S.dimmed]}>
              {stbEnvironment.formatClock(program.start)}
            </Text>
            <Text style={[S.programEnd, focused && { color: "rgba(0,0,0,0.5)" }]}>
              {stbEnvironment.formatClock(program.end)}
            </Text>
          </View>

          <View style={S.programBody}>
            <View style={S.programTitleRow}>
              <Text style={[S.programTitle, focused ? { color: "#000000" } : isPast && S.dimmed]} numberOfLines={1}>
                {program.title}
              </Text>
              {isNow ? (
                <View style={[S.nowBadge, focused && { backgroundColor: "#000000" }]}>
                  <Text style={[S.nowBadgeText, focused && { color: "#FFFFFF" }]}>ON NOW</Text>
                </View>
              ) : null}
            </View>
            {program.description ? (
              <Text style={[S.programDesc, focused && { color: "rgba(0,0,0,0.6)" }]} numberOfLines={1}>
                {program.description}
              </Text>
            ) : null}
            {isNow ? (
              <View style={[S.miniTrack, focused && { backgroundColor: "rgba(0,0,0,0.15)" }]}>
                <View
                  style={[
                    S.miniFill,
                    focused && { backgroundColor: "#000000" },
                    { width: `${Math.round(progress * 100)}%` },
                  ]}
                />
              </View>
            ) : null}
          </View>
        </View>
      )}
    </Focusable>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────────────

export default function EPGScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Per-field selectors — see the note in live-tv.tsx.
  const activePortal = usePortalStore((s) => s.activePortal);
  const storeChannels = usePortalStore((s) => s.channels);

  const [epgVersion, setEpgVersion] = useState(0);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [selectedProgram, setSelectedProgram] = useState<EPGProgram | null>(null);
  const [pinTarget, setPinTarget] = useState<Channel | null>(null);
  const [loadingChannelId, setLoadingChannelId] = useState<string | null>(null);

  const channelListRef = useRef<FlatList<Channel>>(null);
  const programListRef = useRef<FlatList<EPGProgram>>(null);
  const selectedIdRef = useRef<string | null>(null);
  const channelScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Data ──────────────────────────────────────────────────────────────────

  const channels = useMemo(
    () => storeChannels.filter((c) => !!c.streamUrl),
    [storeChannels]
  );

  const channelNumbers = useMemo(() => buildChannelNumbers(channels), [channels]);

  useEffect(() => {
    const unsubscribe = epgService.subscribe(() => setEpgVersion((v) => v + 1));
    parentalControl.load().then(() => setEpgVersion((v) => v + 1));
    stbEnvironment.load();
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!activePortal) {
      router.replace("/");
      return;
    }
    epgService
      .loadBulk(activePortal, { allowLargeXmltv: stbEnvironment.snapshot.fullXmltvGuide })
      .catch(() => { });
  }, [activePortal?.id]);

  // Open on the first channel so the right-hand pane is never blank.
  useEffect(() => {
    if (selectedChannel || channels.length === 0) return;
    setSelectedChannel(channels[0]);
  }, [channels, selectedChannel]);

  // Warm the guide for the channel under the cursor and the ones just after it,
  // so moving down the list does not stall on a request per row.
  const handleChannelFocus = useCallback(
    (channel: Channel) => {
      selectedIdRef.current = String(channel.id);
      setSelectedChannel(channel);

      // Auto-scroll channel list to keep focused item at the top — same
      // pattern as CategorySidebar's scrollToOffset.
      const at = channels.findIndex((c) => String(c.id) === String(channel.id));
      if (at >= 0) {
        if (channelScrollTimeoutRef.current) clearTimeout(channelScrollTimeoutRef.current);
        channelScrollTimeoutRef.current = setTimeout(() => {
          try {
            channelListRef.current?.scrollToOffset({
              offset: at * CHANNEL_ROW_HEIGHT,
              animated: true,
            });
          } catch { /* ignore */ }
        }, 16);
      }

      const portal = usePortalStore.getState().activePortal;
      if (!portal) return;
      epgService.ensureChannel(portal, channel).catch(() => { });
      if (at >= 0) epgService.prefetch(portal, channels.slice(at + 1, at + 8));
    },
    [channels]
  );

  const programs = useMemo(
    () => epgService.programsFor(selectedChannel),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedChannel?.id, epgVersion]
  );

  const nowIndex = useMemo(() => {
    const now = Date.now();
    return programs.findIndex((p) => p.start <= now && p.end > now);
  }, [programs]);

  // A schedule that opens at 6 a.m. is not useful; jump to what is on now.
  useEffect(() => {
    if (nowIndex < 0 || !programListRef.current) return;
    const timer = setTimeout(() => {
      try {
        programListRef.current?.scrollToIndex({ index: nowIndex, animated: false, viewPosition: 0.15 });
      } catch {
        /* not measured yet */
      }
    }, 80);
    return () => clearTimeout(timer);
  }, [nowIndex, selectedChannel?.id]);

  // Keep the hero pinned to whatever is on now until the viewer moves the
  // cursor into the schedule themselves.
  useEffect(() => {
    if (nowIndex >= 0) setSelectedProgram(programs[nowIndex]);
    else setSelectedProgram(programs[0] ?? null);
  }, [programs, nowIndex]);

  // ── Playback ──────────────────────────────────────────────────────────────

  const playChannel = useCallback(
    async (channel: Channel) => {
      const portal = usePortalStore.getState().activePortal;
      if (!portal || !channel.streamUrl) return;

      if (parentalControl.isChannelLocked(channel)) {
        setPinTarget(channel);
        return;
      }

      setLoadingChannelId(String(channel.id));

      // The guide is a channel list too, so it seeds the zap session the same
      // way Live TV does — CH+/CH- in the player then walks this list.
      const zapList = withChannelNumbers(channels, channelNumbers);
      const index = Math.max(0, zapList.findIndex((c) => String(c.id) === String(channel.id)));
      liveChannelSession.start(zapList, index, "TV Guide", portal.id);

      try {
        let url = channel.streamUrl;
        if (portal.type === "mag") {
          const result = await StreamManager.getStreamUrl(channel, portal, "itv");
          if (result.success && result.url) url = result.url;
        }
        router.push({
          pathname: "/player",
          params: {
            url,
            title: channel.name,
            type: "live",
            contentId: String(channel.id),
            cmd: channel.streamUrl,
          },
        });
      } catch {
        router.push({
          pathname: "/player",
          params: { url: channel.streamUrl, title: channel.name, type: "live" },
        });
      } finally {
        setLoadingChannelId(null);
      }
    },
    [channels, channelNumbers, router]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const renderChannel = useCallback(
    ({ item, index }: { item: Channel; index: number }) => (
      <ChannelRow
        channel={item}
        index={index}
        number={item.num && item.num > 0 ? item.num : channelNumbers.get(String(item.id))}
        isSelected={String(item.id) === String(selectedChannel?.id)}
        preferFocus={index === 0 && !selectedIdRef.current}
        locked={parentalControl.isChannelRestricted(item)}
        onFocusChannel={handleChannelFocus}
        onPlay={playChannel}
        epgVersion={epgVersion}
      />
    ),
    [channelNumbers, selectedChannel?.id, handleChannelFocus, playChannel, epgVersion]
  );

  const renderProgram = useCallback(
    ({ item, index }: { item: EPGProgram; index: number }) => (
      <ProgramRow
        program={item}
        isNow={index === nowIndex}
        isPast={item.end < Date.now()}
        preferFocus={false}
        onFocusProgram={setSelectedProgram}
        onPlay={() => selectedChannel && playChannel(selectedChannel)}
      />
    ),
    [nowIndex, selectedChannel, playChannel]
  );

  const guideStatus = epgService.status;
  // Safe to read during render: this screen already re-renders on the
  // service's own subscription (see epgVersion), which is what drives it.
  const guideProgress = epgService.loadProgress;

  return (
    <View style={[S.container, { paddingTop: insets.top }]}>
      <CinematicBackground />

      {/* ─── Header ─── */}
      <View style={S.header}>
        <Text style={S.headerTitle}>TV Guide</Text>
      </View>


      {/* ─── Panes ─── */}
      <View style={S.panes}>
        <FocusGroup style={{ width: CHANNEL_PANE_WIDTH }}>
          <Text style={S.paneLabel}>CHANNELS</Text>
          <FlatList
            ref={channelListRef}
            data={channels}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderChannel}
            getItemLayout={(_, index) => ({
              length: CHANNEL_ROW_HEIGHT,
              offset: CHANNEL_ROW_HEIGHT * index,
              index,
            })}
            initialNumToRender={10}
            maxToRenderPerBatch={8}
            windowSize={5}
            removeClippedSubviews={false}
            showsVerticalScrollIndicator={false}
            decelerationRate="fast"
            contentContainerStyle={S.paneContent}
            onScrollToIndexFailed={(info) => {
              setTimeout(() => {
                try {
                  channelListRef.current?.scrollToIndex({ index: info.index, animated: false });
                } catch { /* ignore */ }
              }, 80);
            }}
            ListEmptyComponent={
              <View style={S.empty}>
                <ActivityIndicator color={THEME.colors.primary} />
                <Text style={S.emptyText}>Loading channels…</Text>
              </View>
            }
          />
        </FocusGroup>

        <FocusGroup style={S.schedulePane}>
          <Text style={S.paneLabel}>
            {selectedChannel ? `SCHEDULE · ${selectedChannel.name.toUpperCase()}` : "SCHEDULE"}
          </Text>
          <FlatList
            ref={programListRef}
            data={programs}
            keyExtractor={(item) => item.id}
            renderItem={renderProgram}
            getItemLayout={(_, index) => ({
              length: PROGRAM_ROW_HEIGHT,
              offset: PROGRAM_ROW_HEIGHT * index,
              index,
            })}
            initialNumToRender={8}
            maxToRenderPerBatch={6}
            windowSize={5}
            removeClippedSubviews={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={S.paneContent}
            onScrollToIndexFailed={(info) => {
              setTimeout(() => {
                try {
                  programListRef.current?.scrollToIndex({ index: info.index, animated: false });
                } catch {
                  /* list shrank in the meantime */
                }
              }, 80);
            }}
            ListEmptyComponent={
              <View style={S.empty}>
                {guideStatus === "loading" ? (
                  <>
                    <ActivityIndicator color={THEME.colors.primary} />
                    <Text style={S.emptyText}>
                      {PHASE_TEXT[guideProgress.phase] +
                        (guideProgress.ratio == null
                          ? ""
                          : " " + Math.round(guideProgress.ratio * 100) + "%")}
                    </Text>
                  </>
                ) : (
                  <>
                    <Calendar size={ps(3)} color="rgba(255,255,255,0.1)" />
                    <Text style={S.emptyTitle}>No guide for this channel</Text>
                    <Text style={S.emptyText}>
                      {guideStatus === "unavailable"
                        ? "This portal does not publish a programme guide."
                        : "The provider has no listings for this channel."}
                    </Text>
                  </>
                )}
              </View>
            }
          />
        </FocusGroup>
      </View>



      <PinPrompt
        visible={!!pinTarget}
        title="Channel Locked"
        message={pinTarget ? `Enter your PIN to watch ${pinTarget.name}.` : ""}
        onSubmit={(pin) => parentalControl.unlock(pin)}
        onCancel={() => setPinTarget(null)}
        onSuccess={() => {
          const target = pinTarget;
          setPinTarget(null);
          if (target) playChannel(target);
        }}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000000" },

  // ── Header ──
  header: {
    paddingHorizontal: pw(3),
    paddingTop: ph(3),
    paddingBottom: ph(1.5),
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: ps(2.2),
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    color: "rgba(255,255,255,0.5)",
    fontSize: ps(1.1),
    marginTop: ph(0.6),
  },

  // ── Hero ──
  hero: {
    flexDirection: "row",
    paddingHorizontal: pw(8),
    paddingTop: ph(1),
    paddingBottom: ph(1.5),
    gap: pw(3),
  },
  heroText: { flex: 1, justifyContent: "center" },
  heroEyebrow: {
    color: THEME.colors.textDim,
    fontSize: ps(1.1),
    fontWeight: "900",
    letterSpacing: 1.5,
    marginBottom: ph(0.6),
  },
  heroTitle: { color: "#fff", fontSize: ps(2.2), fontWeight: "900" },
  heroTime: {
    color: THEME.colors.textMuted,
    fontSize: ps(1.12),
    fontWeight: "700",
    marginTop: ph(0.5),
    fontVariant: ["tabular-nums"],
  },
  heroDesc: {
    color: THEME.colors.textDim,
    fontSize: ps(1.1),
    lineHeight: ps(1.7),
    marginTop: ph(0.8),
    maxWidth: pw(52),
  },
  heroArt: {
    width: pw(16),
    height: ph(14),
    borderRadius: 18,
    backgroundColor: "#17181c",
    borderWidth: 0,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  heroLogo: { width: "72%", height: "72%" },

  // ── Panes ──
  panes: { flex: 1, flexDirection: "row", paddingHorizontal: pw(2), gap: pw(4) },
  schedulePane: { flex: 1 },
  paneLabel: {
    color: "rgba(255,255,255,0.65)",
    fontSize: ps(1.45),
    fontWeight: "900",
    letterSpacing: 2.5,
    paddingHorizontal: pw(0.5),
    paddingBottom: ph(1.4),
  },
  paneContent: { paddingBottom: ph(4) },

  // ── Channel rows ──
  channelRowWrapper: { height: CHANNEL_ROW_HEIGHT, justifyContent: "center", paddingHorizontal: pw(0.5), paddingVertical: ph(0.5) },
  channelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(1.5),
    paddingHorizontal: pw(2),
    paddingVertical: ph(1.8),
    borderRadius: 18,
    borderWidth: 0,
    borderColor: "transparent",
    backgroundColor: "#17181c",
  },
  channelRowSelected: {
    backgroundColor: "#22232a",
    borderColor: "transparent",
    borderWidth: 0,
  },
  channelRowFocused: {
    backgroundColor: "#F5F5F5",
    borderColor: "transparent",
    borderWidth: 0,
    elevation: 8,
  },
  channelNumber: {
    minWidth: ps(2.2),
    color: "rgba(255,255,255,0.5)",
    fontSize: ps(1.2),
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  channelLogo: { width: ps(4.5), height: ps(3.4), alignItems: "center", justifyContent: "center" },
  channelLogoImage: { width: "100%", height: "100%" },
  channelText: { flex: 1 },
  channelName: { color: "#FFFFFF", fontSize: ps(1.6), fontWeight: "800", letterSpacing: 0.2 },
  channelNow: { color: "rgba(255,255,255,0.5)", fontSize: ps(1), fontWeight: "600" },
  textOnActive: { color: "#000000" },

  // ── Programme rows ──
  programRowWrapper: { height: PROGRAM_ROW_HEIGHT, justifyContent: "center", paddingHorizontal: pw(0.5), paddingVertical: ph(0.6) },
  programRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(2.5),
    paddingHorizontal: pw(2.5),
    paddingVertical: ph(2.8),
    borderRadius: 18,
    borderWidth: 0,
    borderColor: "transparent",
    backgroundColor: "#17181c",
  },
  programRowNow: { backgroundColor: "#22232a" },
  programRowFocused: { backgroundColor: "#F5F5F5", borderColor: "transparent", borderWidth: 0 },
  programTimeCol: { alignItems: "flex-start", minWidth: ps(5.5) },
  programTime: {
    color: "#fff",
    fontSize: ps(1.5),
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  programEnd: {
    color: "rgba(255,255,255,0.4)",
    fontSize: ps(1.12),
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  programBody: { flex: 1, gap: 5 },
  programTitleRow: { flexDirection: "row", alignItems: "center", gap: pw(0.8) },
  programTitle: { color: "#fff", fontSize: ps(1.5), fontWeight: "700", flexShrink: 1 },
  programDesc: { color: "rgba(255,255,255,0.5)", fontSize: ps(1.12) },
  nowBadge: {
    backgroundColor: "rgba(255,255,255,0.9)",
    paddingHorizontal: pw(0.8),
    paddingVertical: 2,
    borderRadius: 4,
  },
  nowBadgeText: { color: "#000", fontSize: ps(0.85), fontWeight: "900", letterSpacing: 0.8 },

  // ── Shared ──
  textOnFocus: { color: "#000" },
  dimmed: { opacity: 0.45 },
  miniTrack: {
    height: 2,
    borderRadius: 1,
    backgroundColor: "rgba(255,255,255,0.16)",
    marginTop: 3,
    overflow: "hidden",
  },
  miniFill: { height: "100%", backgroundColor: "#fff" },

  empty: { alignItems: "center", justifyContent: "center", paddingVertical: ph(10), gap: ph(1) },
  emptyTitle: { color: "rgba(255,255,255,0.45)", fontSize: ps(1.5), fontWeight: "700" },
  emptyText: { color: "rgba(255,255,255,0.3)", fontSize: ps(1.1), textAlign: "center", maxWidth: pw(30) },

  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(2),
    paddingHorizontal: pw(8),
    paddingVertical: ph(1.2),
  },
  footerHint: {
    color: "rgba(255,255,255,0.35)",
    fontSize: ps(1),
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  footerBusy: { flexDirection: "row", alignItems: "center", gap: pw(0.8) },
});
