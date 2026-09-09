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
import {
  ActivityIndicator,
  FlatList,
  Image as RNImage,
  Modal,
  Platform,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";

import { usePortalStore, Channel, EPGProgram, Category } from "../src/store/portalStore";
import CategoryPills from "../src/components/CategoryPills";
import { filterByCategory } from "../src/hooks/useCategoryContent";
import { epgService, type EpgLoadPhase } from "../src/services/epgService";
import { parentalControl } from "../src/services/parentalControl";
import { hiddenCategories } from "../src/services/hiddenCategories";
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
import { remoteFocusEnabled, isTablet } from "../src/utils/tabletUtils";
import { Focusable, FocusGroup } from "../src/tv";
import { Calendar, ChevronDown, Filter, Lock, Play, Tv, X } from 'lucide-react-native';
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

/**
 * The active (selected) channel row: white on touch, dark on the box.
 *
 * Every other selected state in the app -- the category sidebar, the zap
 * list, the search filter chips -- is a #F5F5F5 pill with dark ink, and on a
 * tablet this now matches them.
 *
 * The box keeps its dark #22232a instead, because there `channelRowFocused`
 * is itself #F5F5F5: making selected white too would leave the viewer unable
 * to tell which row the D-pad is on from which channel is showing. Touch has
 * no focus, so only one of the two ever appears and the conflict cannot arise.
 *
 * Background and ink are declared together deliberately -- they were split
 * across a style and a render-time ternary before, which is how the row ended
 * up painting near-black text onto a near-black background.
 */
const ACTIVE_ROW_BG = isTablet ? "#F5F5F5" : "#22232a";
const ACTIVE_ROW_INK = isTablet ? "#000000" : "#FFFFFF";

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
    rowHeight,
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
    rowHeight?: number;
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
        onPress={() =>
          remoteFocusEnabled ? onPlay(channel) : onFocusChannel(channel, index)
        }
        style={[S.channelRowWrapper, rowHeight != null && { height: rowHeight }]}
        accessibilityLabel={`${channel.name}${nowNext.now ? `, now ${nowNext.now.title}` : ""}`}
      >
        {(focused) => (
          <View style={[
            S.channelRow,
            isTablet && { paddingVertical: 8, paddingHorizontal: 10, gap: 10 },
            isSelected && S.channelRowSelected,
            focused && S.channelRowFocused
          ]}>
            <Text style={[
              S.channelNumber,
              isTablet && { fontSize: 12, minWidth: 22 },
              focused ? S.textOnFocus : isSelected && S.textOnActive,
            ]}>{number ?? ""}</Text>

            <View style={[S.channelLogo, isTablet && { width: 34, height: 26 }]}>
              {locked ? (
                <Lock size={isTablet ? 16 : ps(1.4)}
                  color={focused ? "#000000" : isSelected ? ACTIVE_ROW_INK : "rgba(255,255,255,0.6)"} />
              ) : channel.logo ? (
                <Image source={{ uri: channel.logo }} style={S.channelLogoImage} contentFit="contain" cachePolicy="memory-disk" />
              ) : (
                <Tv size={isTablet ? 16 : ps(1.4)}
                  color={focused ? "#000000" : isSelected ? ACTIVE_ROW_INK : "rgba(255,255,255,0.2)"} />
              )}
            </View>

            <Text style={[
              S.channelName,
              isTablet && { fontSize: 13 },
              focused ? S.textOnFocus : isSelected && S.textOnActive,
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
    prev.rowHeight === next.rowHeight &&
    prev.epgVersion === next.epgVersion
);

const ProgramRow = React.memo(function ProgramRow({
  program,
  isNow,
  isPast,
  onFocusProgram,
  onPlay,
  preferFocus,
  rowHeight,
}: {
  program: EPGProgram;
  isNow: boolean;
  isPast: boolean;
  onFocusProgram: (program: EPGProgram) => void;
  onPlay: () => void;
  preferFocus: boolean;
  rowHeight?: number;
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
      style={[S.programRowWrapper, rowHeight != null && { height: rowHeight }]}
      accessibilityLabel={`${program.title} at ${stbEnvironment.formatClock(program.start)}`}
    >
      {(focused) => (
        <View style={[
          S.programRow,
          isTablet && { paddingVertical: 8, paddingHorizontal: 10, gap: 10 },
          isNow && S.programRowNow,
          focused && S.programRowFocused
        ]}>
          <View style={[S.programTimeCol, isTablet && { minWidth: 46 }]}>
            <Text style={[S.programTime, isTablet && { fontSize: 12 }, focused ? { color: "#000000" } : isPast && S.dimmed]}>
              {stbEnvironment.formatClock(program.start)}
            </Text>
            <Text style={[S.programEnd, isTablet && { fontSize: 10.5 }, focused && { color: "rgba(0,0,0,0.5)" }]}>
              {stbEnvironment.formatClock(program.end)}
            </Text>
          </View>

          <View style={S.programBody}>
            <View style={S.programTitleRow}>
              <Text style={[S.programTitle, isTablet && { fontSize: 13 }, focused ? { color: "#000000" } : isPast && S.dimmed]} numberOfLines={1}>
                {program.title}
              </Text>
              {isNow ? (
                <View style={[S.nowBadge, focused && { backgroundColor: "#000000" }]}>
                  <Text style={[S.nowBadgeText, isTablet && { fontSize: 9 }, focused && { color: "#FFFFFF" }]}>ON NOW</Text>
                </View>
              ) : null}
            </View>
            {program.description ? (
              <Text style={[S.programDesc, isTablet && { fontSize: 11 }, focused && { color: "rgba(0,0,0,0.6)" }]} numberOfLines={1}>
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
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isPortrait = !Platform.isTV && windowHeight > windowWidth;
  const channelPaneWidth = isPortrait
    ? Math.min(220, Math.max(130, windowWidth * 0.36))
    : (isTablet ? Math.min(280, windowWidth * 0.28) : CHANNEL_PANE_WIDTH);
  const channelRowHeight = isTablet ? 54 : CHANNEL_ROW_HEIGHT;
  const programRowHeight = isTablet ? (isPortrait ? 76 : 70) : PROGRAM_ROW_HEIGHT;

  // Per-field selectors — see the note in live-tv.tsx.
  const activePortal = usePortalStore((s) => s.activePortal);
  const storeChannels = usePortalStore((s) => s.channels);
  const storeCategories = usePortalStore((s) => s.categories);

  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const [epgVersion, setEpgVersion] = useState(0);
  const [hiddenVersion, setHiddenVersion] = useState(0);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [selectedProgram, setSelectedProgram] = useState<EPGProgram | null>(null);
  const [pinTarget, setPinTarget] = useState<Channel | null>(null);
  const [loadingChannelId, setLoadingChannelId] = useState<string | null>(null);

  const channelListRef = useRef<FlatList<Channel>>(null);
  const programListRef = useRef<FlatList<EPGProgram>>(null);
  const selectedIdRef = useRef<string | null>(null);
  const channelScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Data ──────────────────────────────────────────────────────────────────

  const allChannels = useMemo(
    () => storeChannels.filter((c) => !!c.streamUrl),
    [storeChannels]
  );

  const epgCategories: Category[] = useMemo(() => {
    // 1. Only include Live TV categories (exclude VOD and Series)
    const liveCats = (storeCategories || []).filter((c) => c.type === "live");

    // 2. Also map categories directly present on the actual loaded channels
    const channelCatMap = new Map<string, string>();
    for (const item of allChannels) {
      const cId = item.categoryId || item.category;
      const cName = item.category || item.categoryId;
      if (cId && !channelCatMap.has(String(cId))) {
        channelCatMap.set(String(cId), String(cName || cId).trim());
      }
    }

    let cats: Category[] = [];
    if (liveCats.length > 0) {
      cats = liveCats.filter((c) => {
        const id = String(c.id);
        const name = (c.name || "").trim().toLowerCase();
        return channelCatMap.has(id) || Array.from(channelCatMap.values()).some((v) => v.toLowerCase() === name);
      });
    }

    // Fallback: If no portal live categories found, construct them directly from channels
    if (cats.length === 0) {
      channelCatMap.forEach((name, id) => {
        cats.push({
          id: String(id),
          name: String(name),
          type: "live",
        });
      });
    }

    // 3. Filter hidden categories and remove placeholders
    const clean = hiddenCategories.filter(
      "live",
      cats.filter((c) => {
        if (!c.name) return false;
        const lower = c.name.trim().toLowerCase();
        const idLower = String(c.id).trim().toLowerCase();
        return (
          lower !== "all" &&
          lower !== "all channels" &&
          lower !== "all live" &&
          lower !== "all live channels" &&
          idLower !== "all" &&
          idLower !== "all channels" &&
          idLower !== "*"
        );
      })
    );

    return [
      { id: "all", name: "All Channels", type: "live" as const },
      ...clean,
    ];
  }, [storeCategories, allChannels, hiddenVersion]);

  const channels = useMemo(() => {
    if (!isPortrait || !selectedCategory || selectedCategory === "all") {
      return allChannels;
    }
    return filterByCategory(allChannels, selectedCategory, epgCategories);
  }, [isPortrait, allChannels, selectedCategory, epgCategories]);

  const channelNumbers = useMemo(() => buildChannelNumbers(channels), [channels]);

  const currentCategoryName = useMemo(() => {
    if (!selectedCategory || selectedCategory === "all") return "";
    const match = epgCategories.find((c) => String(c.id) === String(selectedCategory));
    return match?.name ? ` · ${match.name.toUpperCase()}` : "";
  }, [selectedCategory, epgCategories]);

  const handleCategorySelect = useCallback((catId: string) => {
    setSelectedCategory(catId);
    try {
      channelListRef.current?.scrollToOffset({ offset: 0, animated: false });
    } catch {}
  }, []);

  useEffect(() => {
    hiddenCategories.load().then(() => setHiddenVersion((v) => v + 1));
    const unsubscribeHidden = hiddenCategories.subscribe(() => setHiddenVersion((v) => v + 1));
    return unsubscribeHidden;
  }, []);

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
    if (channels.length === 0) return;
    if (!selectedChannel || !channels.some((c) => String(c.id) === String(selectedChannel.id))) {
      setSelectedChannel(channels[0]);
    }
  }, [channels, selectedChannel]);

  // Warm the guide for the channel under the cursor and the ones just after it,
  // so moving down the list does not stall on a request per row.
  const handleChannelFocus = useCallback(
    (channel: Channel) => {
      selectedIdRef.current = String(channel.id);
      setSelectedChannel(channel);

      // Auto-scroll channel list to keep focused item at the top — same
      // pattern as CategorySidebar's scrollToOffset.
      //
      // Remote only. This pins the *focused* row to the top as focus walks the
      // list, which is right for a D-pad and wrong for a finger: a tap now
      // selects a channel, and scrolling the tapped row to the top would drag
      // the list out from under the hand that just tapped it. On touch the
      // viewer has already scrolled where they want to be.
      const at = remoteFocusEnabled
        ? channels.findIndex((c) => String(c.id) === String(channel.id))
        : -1;
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

  const channelPills: Category[] = useMemo(() => {
    return channels.map((c) => ({
      id: String(c.id),
      name: c.num && c.num > 0 ? `${c.num}. ${c.name}` : c.name,
      type: "live" as const,
      logo: c.logo,
    }));
  }, [channels]);

  const handleChannelPillSelect = useCallback(
    (chId: string) => {
      const ch = channels.find((c) => String(c.id) === chId);
      if (ch) {
        handleChannelFocus(ch);
      }
    },
    [channels, handleChannelFocus]
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
        rowHeight={channelRowHeight}
      />
    ),
    [channelNumbers, selectedChannel?.id, handleChannelFocus, playChannel, epgVersion, channelRowHeight]
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
        rowHeight={programRowHeight}
      />
    ),
    [nowIndex, selectedChannel, playChannel, programRowHeight]
  );

  const guideStatus = epgService.status;
  // Safe to read during render: this screen already re-renders on the
  // service's own subscription (see epgVersion), which is what drives it.
  const guideProgress = epgService.loadProgress;

  return (
    <View style={[S.container, { paddingTop: isPortrait ? Math.max(insets.top, 24) + 8 : insets.top }]}>
      <CinematicBackground />

      {/* ─── Header ─── */}
      <View style={[S.header, isPortrait && { paddingTop: 6, paddingBottom: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}>
        <View>
          <Text style={S.headerTitle}>TV Guide</Text>
          {isPortrait && selectedCategory !== "all" && (
            <Text style={S.headerSubtitle} numberOfLines={1}>
              {epgCategories.find((c) => String(c.id) === String(selectedCategory))?.name}
            </Text>
          )}
        </View>

        {isPortrait && epgCategories.length > 1 && (
          <TouchableOpacity
            style={S.categoryBadge}
            onPress={() => setCategoryModalVisible(true)}
            activeOpacity={0.7}
          >
            <Filter size={13} color="#FFFFFF" style={{ marginRight: 6 }} />
            <Text style={S.categoryBadgeText} numberOfLines={1}>
              {selectedCategory === "all"
                ? "All Categories"
                : (epgCategories.find((c) => String(c.id) === String(selectedCategory))?.name || "Category")}
            </Text>
            <ChevronDown size={14} color="rgba(255,255,255,0.7)" style={{ marginLeft: 4 }} />
          </TouchableOpacity>
        )}
      </View>

      {/* ─── Channel Pills (Portrait Mode) ─── */}
      {isPortrait && channelPills.length > 0 && (
        <View style={S.portraitPillsWrapper}>
          <CategoryPills
            categories={channelPills}
            selectedId={selectedChannel ? String(selectedChannel.id) : ""}
            onSelect={handleChannelPillSelect}
          />
        </View>
      )}

      {/* ─── Panes ─── */}
      <View style={[S.panes, isPortrait ? { paddingHorizontal: 12, gap: 0 } : (isTablet && { paddingHorizontal: 20, gap: 16 })]}>
        {!isPortrait && (
          <FocusGroup style={{ width: channelPaneWidth }}>
            <Text style={[S.paneLabel, isTablet && { fontSize: 11, letterSpacing: 1.5 }]}>
              CHANNELS
            </Text>
            <FlatList
              ref={channelListRef}
              data={channels}
              keyExtractor={(item) => String(item.id)}
              renderItem={renderChannel}
              getItemLayout={(_, index) => ({
                length: channelRowHeight,
                offset: channelRowHeight * index,
                index,
              })}
              initialNumToRender={10}
              maxToRenderPerBatch={8}
              windowSize={5}
              removeClippedSubviews={false}
              showsVerticalScrollIndicator={false}
              decelerationRate="fast"
              contentContainerStyle={[S.paneContent, isTablet && { paddingBottom: insets.bottom + 28 }]}
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
        )}

        <FocusGroup style={[S.schedulePane, isPortrait && { flex: 1, width: "100%" }]}>
          <View style={[S.scheduleHeaderRow, isPortrait && { paddingBottom: 10 }]}>
            <Text style={[S.paneLabel, isTablet && { fontSize: 11, letterSpacing: 1.5 }, isPortrait && { paddingBottom: 0 }]}>
              {selectedChannel ? `SCHEDULE · ${selectedChannel.name.toUpperCase()}` : "SCHEDULE"}
            </Text>
            {isPortrait && selectedChannel && (
              <TouchableOpacity
                style={S.watchLiveBtn}
                onPress={() => playChannel(selectedChannel)}
                activeOpacity={0.8}
              >
                <Play size={11} color="#000000" fill="#000000" style={{ marginRight: 4 }} />
                <Text style={S.watchLiveBtnText}>Watch Live</Text>
              </TouchableOpacity>
            )}
          </View>
          <FlatList
            ref={programListRef}
            data={programs}
            keyExtractor={(item) => item.id}
            renderItem={renderProgram}
            getItemLayout={(_, index) => ({
              length: programRowHeight,
              offset: programRowHeight * index,
              index,
            })}
            initialNumToRender={8}
            maxToRenderPerBatch={6}
            windowSize={5}
            removeClippedSubviews={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[S.paneContent, isTablet && { paddingBottom: insets.bottom + 28 }]}
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

      {/* ─── Category Selection Modal (Portrait Mode) ─── */}
      <Modal
        visible={categoryModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCategoryModalVisible(false)}
      >
        <TouchableOpacity
          style={S.modalOverlay}
          activeOpacity={1}
          onPress={() => setCategoryModalVisible(false)}
        >
          <View style={[S.modalContent, { maxHeight: windowHeight * 0.75 }]}>
            <View style={S.modalHeader}>
              <Text style={S.modalTitle}>Select Category</Text>
              <TouchableOpacity onPress={() => setCategoryModalVisible(false)} hitSlop={12}>
                <X size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={epgCategories}
              keyExtractor={(item) => String(item.id)}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const isSelected = String(item.id) === String(selectedCategory);
                return (
                  <TouchableOpacity
                    style={[S.categoryModalItem, isSelected && S.categoryModalItemSelected]}
                    onPress={() => {
                      setSelectedCategory(String(item.id));
                      setCategoryModalVisible(false);
                    }}
                  >
                    <Text style={[S.categoryModalItemText, isSelected && S.categoryModalItemTextSelected]}>
                      {item.name}
                    </Text>
                    {isSelected && (
                      <View style={S.categoryCheckDot} />
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>



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
  portraitPillsWrapper: {
    paddingVertical: 4,
    marginBottom: 6,
  },

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
    backgroundColor: ACTIVE_ROW_BG,
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
  /**
   * The active (selected) channel: white.
   *
   * `channelRowSelected` is #22232a -- dark -- so the active row is marked by
   * going brighter than its neighbours, not by inverting into them. This used
   * to be #000000 and shared with `textOnFocus` (the Shared block below,
   * used for #F5F5F5 focused rows), which is why the active row rendered as
   * near-invisible dark-on-dark.
   */
  textOnActive: { color: ACTIVE_ROW_INK },


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

  categoryBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#17181c",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    maxWidth: 180,
  },
  categoryBadgeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
    flexShrink: 1,
  },
  scheduleHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: pw(0.5),
  },
  watchLiveBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: THEME.colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  watchLiveBtnText: {
    color: "#000000",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  modalContent: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: "#17181c",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.15)",
  },
  modalTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "800",
  },
  categoryModalItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 4,
  },
  categoryModalItemSelected: {
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  categoryModalItemText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    fontWeight: "600",
  },
  categoryModalItemTextSelected: {
    color: "#FFFFFF",
    fontWeight: "800",
  },
  categoryCheckDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: THEME.colors.primary,
  },
});
