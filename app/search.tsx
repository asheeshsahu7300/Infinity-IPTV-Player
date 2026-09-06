import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { View, StyleSheet, ActivityIndicator, Dimensions, FlatList, ScrollView, Platform, Animated, findNodeHandle, Pressable , TextInput as RNTextInput} from 'react-native';
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsFocused } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";

import { usePortalStore } from "../src/store/portalStore";
import { portalApi, buildImageUrl } from "../src/services/portalApi";
import { M3UApi } from "../src/services/m3uApi";
import { XtreamApi } from "../src/services/xtreamApi";
import { CinematicBackground } from "../src/components/CinematicBackground";
import { Focusable, FocusGroup, Overlay, useIsFocusTrapped, useDPad, FocusMemory } from "../src/tv";
import { useDialog } from "../src/components/ConfirmDialog";
import { THEME, pw, ph, ps, psRaw, CARD_FRAME, CARD_FRAME_INNER_RADIUS, TILE_FRAME, TILE_FRAME_FOCUSED } from "../src/theme/tokens";
import { launchExternalPlayer } from "../src/utils/externalPlayer";
import { playbackQueue } from "../src/services/playbackQueue";
import { Calendar, ExternalLink, Play, Search, Star, X } from 'lucide-react-native';
import { DynamicIcon } from '../src/components/DynamicIcon';
import { Text } from '../src/components/Text';
import { TextInput } from '../src/components/TextInput';



const { width: W } = Dimensions.get("window");
const RAIL_H_PAD = pw(4.2);
const HEADER_ELEM_HEIGHT = pw(3.8);

// ─────────────────────────────────────────────
// Metadata & Channel Helpers
// ─────────────────────────────────────────────
const parseChannelMeta = (item: any) => {
  const name = item?.name || "";
  let cleanTitle = name;
  let regionTag = "";
  let qualityTag = "";

  // Detect quality badges
  if (name.includes("4K") || name.includes("UHD")) qualityTag = "4K UHD";
  else if (name.includes("FHD") || name.includes("1080")) qualityTag = "FHD";
  else if (name.includes("HD")) qualityTag = "HD";

  // Detect region / country / network provider
  if (name.includes("UK") || name.includes("GB")) regionTag = "UK";
  else if (name.includes("USA") || name.includes("US")) regionTag = "USA";
  else if (name.includes("CA") || name.includes("CANADA")) regionTag = "Canada";
  else if (name.includes("IN") || name.includes("INDIA") || name.includes("PB") || name.includes("PUNJABI")) regionTag = "India";
  else if (name.includes("AU")) regionTag = "Australia";

  const num = item?.num || item?.epg_channel_id || item?.channel_id;
  const channelNum = num ? `#${num}` : "";

  const categoryLabel = item?.category || "";
  const subtitleParts: string[] = [];
  if (regionTag) subtitleParts.push(regionTag);
  if (categoryLabel && categoryLabel.toLowerCase() !== "live tv" && categoryLabel.toLowerCase() !== "all") {
    subtitleParts.push(categoryLabel);
  }
  if (qualityTag) subtitleParts.push(qualityTag);

  const subtitle = subtitleParts.length > 0 ? subtitleParts.join(" • ") : (categoryLabel || "Live Stream");

  return { cleanTitle, channelNum, subtitle };
};

const pickRating = (v: any) => {
  const r = v?.rating ?? v?.rating_imdb ?? v?.imdb_rating ?? v?.rating_tmdb ?? v?.score;
  if (r == null) return "";
  const s = String(r).trim();
  const lower = s.toLowerCase();
  if (
    !s ||
    lower === "n/a" ||
    lower === "na" ||
    lower === "0" ||
    lower === "0.0" ||
    lower === "0.00" ||
    lower === "null" ||
    lower === "undefined"
  ) {
    return "";
  }
  return s;
};

const pickYear = (v: any) => {
  const y = v?.year ?? v?.production_year ?? v?.release_year ?? v?.first_air_date ?? (v?.release_date ? v?.release_date.slice(0, 4) : "");
  if (y == null) return "";
  const s = String(y).trim();
  const lower = s.toLowerCase();
  if (
    !s ||
    lower === "n/a" ||
    lower === "na" ||
    lower === "0" ||
    lower === "null" ||
    lower === "undefined"
  ) {
    return "";
  }
  const match = s.match(/(19|20)\d{2}/);
  return match ? match[0] : s;
};

// ─────────────────────────────────────────────
// Universal Content Card (VOD / OTT Tile Style with Clean Poster Frame & Titles Below)
// ─────────────────────────────────────────────
const CardInner = React.memo(function CardInner({
  item,
  isLive,
  posterHeight,
  channelMeta,
  ratingVal,
  focused,
}: {
  item: any;
  isLive: boolean;
  posterHeight: number;
  channelMeta: any;
  ratingVal: string;
  focused: boolean;
}) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [item?.logo]);

  return (
    <View style={[S.movieCardContainer, focused && S.movieCardContainerFocused]}>
      <View
        style={[
          S.posterFrame,
          { height: posterHeight },
          focused && S.posterFrameFocused,
        ]}
      >
        {item.logo && !imgError ? (
          <Image
            source={{ uri: item.logo }}
            recyclingKey={item.logo}
            style={S.posterImage}
            contentFit={isLive ? "contain" : "cover"}
            cachePolicy="memory-disk"
            transition={200}
            onError={() => setImgError(true)}
          />
        ) : (
          <View style={[StyleSheet.absoluteFillObject, S.posterFallback]}>
            <DynamicIcon
              name={isLive ? "television" : "filmstrip"}
              size={isLive ? ps(2.8) : ps(4.2)}
              color="rgba(255,255,255,0.32)"
            />
          </View>
        )}

        {isLive && (
          <View style={S.liveBadge}>
            <View style={S.liveBadgeDot} />
            <Text style={S.liveBadgeText}>LIVE</Text>
          </View>
        )}

        {isLive && channelMeta?.channelNum ? (
          <View style={S.channelNumBadge}>
            <Text style={S.channelNumText}>{channelMeta.channelNum}</Text>
          </View>
        ) : null}

        {!isLive && item.quality ? (
          <View style={S.qualityBadge}>
            <Text style={S.qualityBadgeText}>{item.quality}</Text>
          </View>
        ) : null}

        {!isLive && ratingVal ? (
          <View style={S.cornerRatingBadge}>
            <Text style={S.cornerRatingText}>{ratingVal}</Text>
          </View>
        ) : null}
      </View>

      <Text
        style={[S.movieTitleText, focused && S.movieTitleTextFocused]}
        numberOfLines={1}
      >
        {isLive ? (channelMeta?.cleanTitle || item.name) : item.name}
      </Text>

      {isLive ? (
        channelMeta?.subtitle ? (
          <Text style={S.movieSubText} numberOfLines={1}>
            {channelMeta.subtitle}
          </Text>
        ) : null
      ) : item.year ? (
        <Text style={S.movieSubText} numberOfLines={1}>
          {item.year}
        </Text>
      ) : null}
    </View>
  );
});

const ContentCard = React.memo(
  function ContentCard({
    item,
    index,
    onPress,
    onFocus,
    itemWidth,
    hasTVPreferredFocus = false,
    trapFocusLeft = false,
    trapFocusRight = false,
    nextFocusUp,
    cardRef,
  }: {
    item: any;
    index?: number;
    onPress: (item: any) => void;
    onFocus?: (item: any, index?: number) => void;
    itemWidth: number;
    hasTVPreferredFocus?: boolean;
    trapFocusLeft?: boolean;
    trapFocusRight?: boolean;
    nextFocusUp?: number;
    cardRef?: React.RefObject<any>;
  }) {
    const isLive = item.type === "live";
    const posterHeight = isLive ? Math.round(itemWidth * 0.75) : Math.round(itemWidth * 1.48);

    const handlePress = useCallback(() => onPress(item), [onPress, item]);
    const handleFocus = useCallback(() => onFocus?.(item, index), [onFocus, item, index]);

    const channelMeta = isLive ? parseChannelMeta(item) : null;

    const ratingVal = useMemo(() => {
      if (isLive) return "";
      const r = item.rating;
      if (!r) return "";
      const s = String(r).trim();
      const lower = s.toLowerCase();
      if (
        lower === "0" ||
        lower === "0.0" ||
        lower === "0.00" ||
        lower === "null" ||
        lower === "undefined" ||
        lower === "na" ||
        lower === "n/a"
      ) {
        return "";
      }
      const num = parseFloat(s);
      if (!isNaN(num) && num > 0) {
        return Number.isInteger(num) ? num.toFixed(1) : String(Math.round(num * 10) / 10);
      }
      return s;
    }, [isLive, item.rating]);

    return (
      <View style={[S.movieItemWrapper, { width: itemWidth }]}>
        <Focusable
          ref={cardRef}
          screenKey="search-screen"
          focusKey={`${item.type}-${item.id}`}
          onPress={handlePress}
          onFocus={handleFocus}
          hasTVPreferredFocus={hasTVPreferredFocus}
          trapFocusLeft={trapFocusLeft}
          trapFocusRight={trapFocusRight}
          nextFocusUp={nextFocusUp}
          ringOnFocus={false}
          accessibilityLabel={item.name}
        >
          {(focused) => (
            <CardInner
              item={item}
              isLive={isLive}
              posterHeight={posterHeight}
              channelMeta={channelMeta}
              ratingVal={ratingVal}
              focused={focused}
            />
          )}
        </Focusable>
      </View>
    );
  },
  (prev, next) => {
    return (
      prev.item?.id === next.item?.id &&
      prev.index === next.index &&
      prev.itemWidth === next.itemWidth &&
      prev.hasTVPreferredFocus === next.hasTVPreferredFocus &&
      prev.trapFocusLeft === next.trapFocusLeft &&
      prev.trapFocusRight === next.trapFocusRight &&
      prev.nextFocusUp === next.nextFocusUp &&
      prev.cardRef === next.cardRef &&
      prev.onPress === next.onPress &&
      prev.onFocus === next.onFocus
    );
  }
);

// ─────────────────────────────────────────────
// Horizontal Content Rail with Smooth D-Pad Auto-Scrolling
// ─────────────────────────────────────────────
interface ContentRailProps {
  title: string;
  subtitle?: string;
  data: any[];
  itemWidth: number;
  onPress: (item: any) => void;
  onFocus?: (item: any) => void;
  isFirstRail?: boolean;
  nextFocusUp?: number;
  inputRef?: React.RefObject<any>;
  firstCardRef?: React.RefObject<any>;
}

const ContentRail = React.memo(function ContentRail({
  title,
  subtitle,
  data,
  itemWidth,
  onPress,
  onFocus,
  isFirstRail = false,
  nextFocusUp,
  inputRef,
  firstCardRef,
}: ContentRailProps) {
  const flatListRef = useRef<FlatList>(null);
  const scrollRafRef = useRef<number | null>(null);
  const currentScrollIndexRef = useRef(-1);

  useEffect(() => () => {
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
  }, []);

  const gap = pw(1.2);
  const stride = itemWidth + gap;

  const getItemLayout = useCallback(
    (_: any, index: number) => ({
      length: stride,
      offset: stride * index,
      index,
    }),
    [stride]
  );

  /**
   * Keep focus fixed at the first item slot on the screen (Slot 0)
   * while smoothly scrolling the horizontal rail with VSYNC timing.
   */
  const handleCardFocus = useCallback(
    (item: any, idx?: number) => {
      onFocus?.(item);

      if (idx === undefined || currentScrollIndexRef.current === idx) return;
      currentScrollIndexRef.current = idx;

      const targetOffset = idx * stride;
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = requestAnimationFrame(() => {
        try {
          flatListRef.current?.scrollToOffset({
            offset: targetOffset,
            animated: true,
          });
        } catch { /* ignore */ }
      });
    },
    [onFocus, stride]
  );

  const renderItem = useCallback(
    ({ item, index }: { item: any; index: number }) => (
      <ContentCard
        key={`${item.type}-${item.id}`}
        item={item}
        index={index}
        itemWidth={itemWidth}
        onPress={onPress}
        onFocus={handleCardFocus}
        trapFocusLeft={index === 0}
        trapFocusRight={index === data.length - 1}
        hasTVPreferredFocus={isFirstRail && index === 0}
        nextFocusUp={isFirstRail ? nextFocusUp : undefined}
        cardRef={isFirstRail && index === 0 ? firstCardRef : undefined}
      />
    ),
    [itemWidth, onPress, handleCardFocus, data.length, isFirstRail, nextFocusUp, firstCardRef]
  );

  if (!data || data.length === 0) return null;

  return (
    <FocusGroup
      style={[S.railSection, { overflow: "visible" }]}
      trapLeft
      trapRight
      destinations={isFirstRail && inputRef?.current ? [inputRef.current] : undefined}
    >
      <View style={S.railHeader}>
        <Text style={S.railTitle}>{title}</Text>
        {subtitle ? <Text style={S.railSubtitle}>{subtitle}</Text> : null}
      </View>
      <FlatList
        ref={flatListRef}
        horizontal
        data={data}
        renderItem={renderItem}
        keyExtractor={(item) => `${item.type}-${item.id}`}
        getItemLayout={getItemLayout}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={S.railScrollContent}
        style={{ overflow: "visible" }}
        scrollEventThrottle={16}
        removeClippedSubviews={false}
        initialNumToRender={Math.max(data.length, 10)}
        maxToRenderPerBatch={Math.max(data.length, 10)}
        windowSize={11}
        updateCellsBatchingPeriod={16}
      />
    </FocusGroup>
  );
});

type ContentFilter = "all" | "live" | "vod" | "series";

/**
 * No "All" chip.
 *
 * "all" is still a real state and still the one the screen starts in — it is
 * what shows the mixed discovery rails and searches all three types at once
 * (see the branches on activeFilter below). Only the chip is gone, so the way
 * back to it is pressing the active chip again rather than a chip of its own.
 * Dropping the state as well would have made the landing page a single type,
 * which is a different change from removing a chip.
 */
const FILTER_TABS: { id: ContentFilter; label: string; icon?: string }[] = [
  { id: "live", label: "Live TV", icon: "tv-outline" },
  { id: "vod", label: "Movies", icon: "film-outline" },
  { id: "series", label: "Series", icon: "albums-outline" },
];

// ─────────────────────────────────────────────
// Main Search Screen Component
// ─────────────────────────────────────────────
export default function SearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isScreenFocused = useIsFocused();
  const isFocusTrapped = useIsFocusTrapped();
  const { notify, node: dialogNode } = useDialog();

  const activePortal = usePortalStore((s) => s.activePortal);
  const channels = usePortalStore((s) => s.channels);
  const vodItems = usePortalStore((s) => s.vodItems);
  const series = usePortalStore((s) => s.series);
  const searchTimeout = useRef<any>(null);
  const searchRequestId = useRef(0);

  const draftQueryRef = useRef("");
  const lastSearchedRef = useRef("");

  const [draftQuery, setDraftQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<ContentFilter>("all");
  const [results, setResults] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  /**
   * Mirrors the field's own focus, purely for styling. See the note on the
   * same state in live-tv.tsx for why the field is a plain D-pad target with
   * no wrapper and no programmatic focus — on a TV, programmatic focus can
   * only ever hide the keyboard.
   */
  const [searchFocused, setSearchFocused] = useState(false);
  const [clearFocused, setClearFocused] = useState(false);
  const [focusedImage, setFocusedImage] = useState<string | null>(null);

  const inputRef = useRef<RNTextInput>(null);
  const clearBtnRef = useRef<View>(null);
  const firstFilterRef = useRef<View>(null);
  const firstCardRef = useRef<View>(null);

  const [inputNode, setInputNode] = useState<number | undefined>(undefined);
  const [clearBtnNode, setClearBtnNode] = useState<number | undefined>(undefined);
  const [firstFilterNode, setFirstFilterNode] = useState<number | undefined>(undefined);
  const [firstCardNode, setFirstCardNode] = useState<number | undefined>(undefined);

  useEffect(() => {
    const attachNodes = () => {
      const input = inputRef.current ? findNodeHandle(inputRef.current) : null;
      const firstFilter = firstFilterRef.current ? findNodeHandle(firstFilterRef.current) : null;
      const clearBtn = clearBtnRef.current ? findNodeHandle(clearBtnRef.current) : null;
      const card = firstCardRef.current ? findNodeHandle(firstCardRef.current) : null;
      if (input) setInputNode(input);
      if (firstFilter) setFirstFilterNode(firstFilter);
      if (card) setFirstCardNode(card);
      setClearBtnNode(clearBtn || undefined);
    };

    attachNodes();
    const t = setTimeout(attachNodes, 120);
    return () => clearTimeout(t);
  }, [draftQuery, submittedQuery, activeFilter]);

  const handleClearSearch = useCallback(() => {
    setDraftQuery("");
    setSubmittedQuery("");
    setResults([]);
    setClearFocused(false);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  // VOD Modal
  const [playModalVisible, setPlayModalVisible] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);

  const isTopRowFocusedRef = useRef(false);

  useDPad(
    {
      onUp: () => {
        if (isTopRowFocusedRef.current && !playModalVisible) {
          inputRef.current?.focus();
        }
      },
      onDown: () => {
        if ((searchFocused || clearFocused) && !playModalVisible) {
          inputRef.current?.blur();
          setSearchFocused(false);
          setClearFocused(false);
          if (firstCardRef.current) {
            (firstCardRef.current as any)?.focus?.();
          } else {
            const firstItem =
              submittedQuery.trim().length === 0
                ? filteredRails[0]?.data?.[0]
                : filteredResults[0];
            if (firstItem) {
              const key = `${firstItem.type}-${firstItem.id}`;
              const node = FocusMemory.getRef("search-screen", key)?.current;
              node?.focus?.();
            }
          }
        }
      },
    },
    { enabled: isScreenFocused && !playModalVisible }
  );

  // ── Curated Content Rails (Discovery State) ──
  const discoveryRails = useMemo(() => {
    const base = (activePortal?.config?.url || "").replace(/\/$/, "");
    const rails: any[] = [];
    if (vodItems.length > 0) {
      rails.push({
        title: "Recommended Movies",
        subtitle: "Popular on-demand films",
        data: vodItems.slice(0, 16).map((v) => ({
          ...v,
          type: "vod",
          logo: buildImageUrl(base, v.logo || (v as any).screen_uri || (v as any).poster || (v as any).cover || ""),
        })),
      });
    }
    if (series.length > 0) {
      rails.push({
        title: "Trending Series",
        subtitle: "Top television shows",
        data: series.slice(0, 16).map((s) => ({
          ...s,
          type: "series",
          logo: buildImageUrl(base, s.logo || (s as any).screen_uri || (s as any).poster || (s as any).cover || ""),
        })),
      });
    }
    if (channels.length > 0) {
      rails.push({
        title: "Top Live Channels",
        subtitle: "Direct live TV broadcast streams",
        data: channels.slice(0, 16).map((c) => ({
          ...c,
          type: "live",
          logo: buildImageUrl(base, c.logo),
        })),
      });
    }
    if (vodItems.length > 16) {
      rails.push({
        title: "Recently Added",
        subtitle: "Latest entertainment in your library",
        data: vodItems.slice(16, 32).map((v) => ({
          ...v,
          type: "vod",
          logo: buildImageUrl(base, v.logo || (v as any).screen_uri || (v as any).poster || (v as any).cover || ""),
        })),
      });
    }
    return rails;
  }, [channels, vodItems, series, activePortal]);

  // ── Derived Filtered Discovery Rails ──
  const filteredRails = useMemo(() => {
    if (activeFilter === "all") return discoveryRails;
    return discoveryRails.filter((r) => r.data?.[0]?.type === activeFilter);
  }, [discoveryRails, activeFilter]);

  // Search Logic (Instant Synchronous In-Memory + Debounced MAG Remote Search)
  const performSearch = useCallback(
    (q: string) => {
      const term = q.trim().toLowerCase();
      if (!term || !activePortal) {
        setResults([]);
        setIsLoading(false);
        return;
      }

      const base = (activePortal?.config?.url || "").replace(/\/$/, "");

      // 1. Instant local search across all loaded in-memory items (0ms, zero errors, never disappears)
      const localLive = channels
        .filter((c) => (c.name || (c as any).title || "").toLowerCase().includes(term))
        .map((c) => ({
          ...c,
          type: "live" as const,
          logo: buildImageUrl(base, c.logo),
        }));
      const localVod = vodItems
        .filter((v) => (v.name || (v as any).title || (v as any).o_name || "").toLowerCase().includes(term))
        .map((v) => ({
          ...v,
          type: "vod" as const,
          logo: buildImageUrl(base, v.logo || (v as any).screen_uri || (v as any).poster || (v as any).cover || (v as any).stream_icon || ""),
        }));
      const localSeries = series
        .filter((s) => (s.name || (s as any).title || "").toLowerCase().includes(term))
        .map((s) => ({
          ...s,
          type: "series" as const,
          logo: buildImageUrl(base, s.logo || (s as any).screen_uri || (s as any).poster || (s as any).cover || (s as any).stream_icon || ""),
        }));

      const localCombined = [...localLive, ...localVod, ...localSeries];
      setResults(localCombined);

      // 2. If it's a MAG portal, perform remote search for VOD & Series to augment results immediately
      // NOTE: Do NOT query "live" remotely on MAG because MAG does not support live search (it returns all 11,000+ channels)
      // and live channels are already fully searched locally in memory above!
      if (activePortal.type === "mag") {
        const reqId = ++searchRequestId.current;
        setIsLoading(true);
        console.log(`[Search] Initiating MAG search for "${q}"...`);

        (async () => {
          try {
            // Determine which types to search remotely based on activeFilter
            const typesToQuery: ("vod" | "series")[] =
              activeFilter === "vod"
                ? ["vod"]
                : activeFilter === "series"
                  ? ["series"]
                  : ["vod", "series"];

            const remoteMatches: any[] = [];
            for (const st of typesToQuery) {
              if (searchRequestId.current !== reqId) return;

              try {
                const apiResults = await portalApi.search(activePortal, q, st);
                if (searchRequestId.current !== reqId) return;

                const base = (activePortal?.config?.url || "").replace(/\/$/, "");
                const mapped = (apiResults || []).map((i: any) => ({
                  ...i,
                  id: String(i.id || i.cmd || ""),
                  streamUrl: i.cmd || "",
                  name: i.name || i.title,
                  logo: buildImageUrl(
                    base,
                    i.screen_uri || i.screenshot_uri || i.poster || i.cover || i.logo || i.stream_icon || ""
                  ),
                  type: st,
                  year: pickYear(i),
                  description: i.description || i.descr || i.plot || "",
                  rating: pickRating(i),
                }));
                remoteMatches.push(...mapped);
              } catch (err) {
                console.warn(`[Search] Error searching ${st}:`, err);
              }
            }

            if (searchRequestId.current !== reqId) return;

            // Merge remote matches with existing local matches, deduplicating by key
            setResults((prev) => {
              const map = new Map<string, any>();
              for (const item of prev) {
                map.set(`${item.type}-${item.id}`, item);
              }
              for (const item of remoteMatches) {
                map.set(`${item.type}-${item.id}`, item);
              }
              return Array.from(map.values()).slice(0, 100);
            });
          } finally {
            if (searchRequestId.current === reqId) {
              setIsLoading(false);
            }
          }
        })();
      } else {
        setIsLoading(false);
      }
    },
    [activePortal, channels, vodItems, series, activeFilter]
  );

  const commitSearch = useCallback(
    (overrideText?: string) => {
      const candidate = (typeof overrideText === "string" && overrideText.trim().length > 0)
        ? overrideText
        : (draftQueryRef.current || draftQuery);
      const textToSearch = (candidate || "").trim();
      console.log(`[Search] commitSearch called with: "${textToSearch}"`);
      if (!textToSearch) {
        lastSearchedRef.current = "";
        setSubmittedQuery("");
        setResults([]);
        return;
      }
      lastSearchedRef.current = textToSearch;
      setSubmittedQuery(textToSearch);
      performSearch(textToSearch);
      setSearchFocused(false);
    },
    [draftQuery, performSearch]
  );

  useEffect(() => {
    if (submittedQuery && submittedQuery !== lastSearchedRef.current) {
      lastSearchedRef.current = submittedQuery;
      performSearch(submittedQuery);
    }
  }, [submittedQuery, performSearch]);

  useEffect(() => {
    if (submittedQuery) {
      performSearch(submittedQuery);
    }
  }, [activeFilter]);

  const filteredResults = useMemo(() => {
    if (activeFilter === "all") return results;
    return results.filter((item) => item.type === activeFilter);
  }, [results, activeFilter]);

  const handleResultPress = useCallback((item: any) => {
    if (item.type === "live") {
      router.push({
        pathname: "/player",
        params: {
          url: item.streamUrl,
          title: item.name,
          type: "live",
          logo: item.logo || "",
          cmd: item.streamUrl,
          contentId: `live:${item.id}`,
        },
      });
      return;
    }
    if (item.type === "series") {
      router.push({
        pathname: "/series-details",
        params: {
          id: item.id,
          name: item.name,
          logo: item.logo,
          description: item.description,
          year: item.year,
          rating: item.rating,
        },
      });
      return;
    }
    setSelectedItem(item);
    setPlayModalVisible(true);
  }, []);

  const handleVodAction = async (isExternal: boolean) => {
    if (!selectedItem || !activePortal) return;

    let streamUrl: string | undefined = selectedItem.streamUrl;
    const latestPortal = usePortalStore.getState().activePortal ?? activePortal;

    try {
      if (latestPortal.type === "xtream") {
        const xtream = new XtreamApi({
          url: latestPortal.config.url,
          username: latestPortal.config.username!,
          password: latestPortal.config.password!,
        });
        streamUrl = xtream.buildMovieUrl(String(selectedItem.id), selectedItem.quality?.toLowerCase() || "mp4");
      } else if (latestPortal.type === "m3u") {
        const m3uApi = new M3UApi({ url: latestPortal.config.url });
        streamUrl = await m3uApi.getStreamUrl(String(selectedItem.id));
      } else if (latestPortal.type === "mag") {
        const cmd = selectedItem.streamUrl;
        if (cmd) {
          const resolved = await portalApi.getStreamUrl(latestPortal, cmd, "vod");
          if (resolved) streamUrl = resolved;
        }
      }
    } catch (e) {
      console.warn("Search VOD stream resolution failed:", e);
    }

    if (!streamUrl) {
      notify("Playback Unavailable", "No stream URL was found for this content.", "danger");
      return;
    }

    setPlayModalVisible(false);
    if (isExternal) {
      launchExternalPlayer({ url: streamUrl, title: selectedItem.name });
    } else {
      playbackQueue.start(
        [
          {
            id: `vod:${selectedItem.id}`,
            title: selectedItem.name,
            subtitle: selectedItem.category || "Movie",
            poster: selectedItem.logo || "",
            streamUrl: streamUrl || selectedItem.streamUrl || "",
            description: selectedItem.description,
            hasStill: false,
            kind: "vod",
          },
        ],
        0,
        selectedItem.name,
        activePortal.id,
        false
      );

      router.push({
        pathname: "/player",
        params: {
          url: streamUrl,
          title: selectedItem.name,
          type: "vod",
          logo: selectedItem.logo || "",
          poster: selectedItem.logo || "",
          cmd: selectedItem.streamUrl || streamUrl,
          contentId: `vod:${selectedItem.id}`,
        },
      });
    }
  };

  const RESULT_COLUMNS = 7;
  const CARD_WIDTH = (W - RAIL_H_PAD * 2) / RESULT_COLUMNS;
  // Sized so that 6 cards + padding show fully and ~18-20% of the 7th card peeks on the right
  const RAIL_ITEM_WIDTH = pw(13.2);

  // Chunk flat results into rows of RESULT_COLUMNS — same pattern as vod.tsx.
  // A FocusGroup (TVFocusGuideView) wraps each row so left/right D-pad
  // movement is bounded within the row and can't jump to a different section.
  const chunkedResults = useMemo(() => {
    const rows: { id: string; items: any[] }[] = [];
    for (let i = 0; i < filteredResults.length; i += RESULT_COLUMNS) {
      rows.push({ id: `row-${i}`, items: filteredResults.slice(i, i + RESULT_COLUMNS) });
    }
    return rows;
  }, [filteredResults, RESULT_COLUMNS]);

  // Debounced backdrop artwork update to prevent re-renders on rapid D-pad moves
  const focusedImageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (focusedImageTimerRef.current) clearTimeout(focusedImageTimerRef.current);
  }, []);

  const handleResultFocus = useCallback((it: any) => {
    if (!it?.logo) return;
    if (focusedImageTimerRef.current) clearTimeout(focusedImageTimerRef.current);
    focusedImageTimerRef.current = setTimeout(() => {
      setFocusedImage(it.logo);
    }, 180);
  }, []);

  const renderResultRow = useCallback(
    ({ item: row, index: rowIndex }: { item: { id: string; items: any[] }; index: number }) => (
      <FocusGroup
        style={{ flexDirection: "row" }}
        trapLeft
        trapRight
        destinations={rowIndex === 0 && inputRef.current ? [inputRef.current] : undefined}
      >
        {row.items.map((it, colIndex) => (
          <ContentCard
            key={`${it.type}-${it.id}`}
            item={it}
            itemWidth={CARD_WIDTH}
            onPress={handleResultPress}
            onFocus={(item) => {
              handleResultFocus(item);
              isTopRowFocusedRef.current = rowIndex === 0;
            }}
            hasTVPreferredFocus={rowIndex === 0 && colIndex === 0 && !searchFocused}
            trapFocusLeft={colIndex === 0}
            trapFocusRight={colIndex === row.items.length - 1}
            nextFocusUp={rowIndex === 0 ? inputNode : undefined}
            cardRef={rowIndex === 0 && colIndex === 0 ? firstCardRef : undefined}
          />
        ))}
      </FocusGroup>
    ),
    [CARD_WIDTH, handleResultPress, handleResultFocus, searchFocused, inputNode, firstCardRef]
  );

  return (
    <View style={[S.container, { paddingTop: insets.top }]}>
      <View
        style={{ flex: 1 }}
        accessibilityElementsHidden={playModalVisible}
        importantForAccessibility={playModalVisible ? "no-hide-descendants" : "auto"}
      >
        <CinematicBackground uri={focusedImage} />

        {/* Dark Vignette Overlay (Softens background artwork intensity) */}
        <LinearGradient
          colors={["rgba(8, 8, 10, 0.62)", "rgba(8, 8, 10, 0.88)", "#08080a"]}
          locations={[0, 0.4, 0.95]}
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
        />

        {/* ─── Clean Header Bar ─── */}
        <View style={S.header}>
          <View style={{ width: 38 }} />

          <View style={S.headerCenterTitleWrapper}>
            <Text style={S.headerTitle}>Search</Text>
          </View>

          <View style={{ width: 38 }} />
        </View>

        {/* ─── Search Input Bar + Content Type Filter Tabs ─── */}
        <View style={S.searchControlsRow}>
          <View style={[S.searchBarContainer, (searchFocused || clearFocused) && S.searchBarContainerFocused]}>
            <Pressable onPress={() => commitSearch()} style={{ padding: 4 }}>
              <Search
                size={ps(1.5)}
                color={searchFocused || clearFocused ? "#ffffff" : "rgba(255,255,255,0.4)"}
                style={{ marginRight: pw(0.8) }}
              />
            </Pressable>
            <TextInput
              ref={inputRef}
              style={S.searchInput}
              placeholder="Search channels, movies, and series..."
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={draftQuery}
              onChangeText={(text) => {
                draftQueryRef.current = text;
                setDraftQuery(text);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              focusable={isScreenFocused && !isFocusTrapped && !playModalVisible}
              editable={isScreenFocused && !isFocusTrapped && !playModalVisible}
              returnKeyType="search"
              nextFocusRight={clearBtnNode ?? firstFilterNode}
              nextFocusDown={firstCardNode}
              onFocus={() => {
                setSearchFocused(true);
                isTopRowFocusedRef.current = false;
              }}
              onBlur={() => setSearchFocused(false)}
              onSubmitEditing={(e) => commitSearch(e.nativeEvent?.text)}
              onEndEditing={(e) => commitSearch(e.nativeEvent?.text)}
              onKeyPress={(e) => {
                if (e.nativeEvent.key === "Enter" || (e.nativeEvent as any).key === "Select") {
                  commitSearch();
                }
              }}
            />
            {draftQuery.length > 0 && (
              <Focusable
                ref={clearBtnRef}
                focusKey="search-clear-btn"
                ringOnFocus={false}
                nextFocusLeft={inputNode}
                nextFocusRight={firstFilterNode}
                nextFocusDown={firstCardNode}
                onPress={handleClearSearch}
                onFocus={() => {
                  setClearFocused(true);
                  isTopRowFocusedRef.current = false;
                }}
                onBlur={() => setClearFocused(false)}
                style={S.clearBtnWrapper}
              >
                {(focused) => (
                  <View style={[S.clearBtnCircle, focused && S.clearBtnCircleFocused]}>
                    <X
                      size={ps(1.8)}
                      color={"#ffffff"}
                    />
                  </View>
                )}
              </Focusable>
            )}
          </View>

          {/* Filter Tabs */}
          <FocusGroup style={S.filterBar} trapRight>
            {FILTER_TABS.map((tab, idx) => {
              const isActive = activeFilter === tab.id;
              return (
                <Focusable
                  key={tab.id}
                  ref={idx === 0 ? firstFilterRef : undefined}
                  focusKey={`filter-${tab.id}`}
                  ringOnFocus={false}
                  nextFocusLeft={idx === 0 ? (clearBtnNode ?? inputNode) : undefined}
                  nextFocusDown={firstCardNode}
                  onFocus={() => {
                    isTopRowFocusedRef.current = false;
                  }}
                  onPress={() => setActiveFilter(isActive ? "all" : tab.id)}
                  style={S.filterChipWrapper}
                  trapFocusRight={idx === FILTER_TABS.length - 1}
                >
                  {(focused) => (
                    <View
                      style={[
                        S.filterChip,
                        isActive && S.filterChipActive,
                        focused && S.filterChipFocused,
                      ]}
                    >
                      <DynamicIcon
                        name={tab.icon}
                        size={ps(1.25)}
                        color={focused || isActive ? "#000000" : "rgba(255,255,255,0.7)"}
                      />
                      <Text
                        style={[
                          S.filterChipText,
                          isActive && S.filterChipTextActive,
                          focused && S.filterChipTextFocused,
                        ]}
                      >
                        {tab.label}
                      </Text>
                    </View>
                  )}
                </Focusable>
              );
            })}
          </FocusGroup>
        </View>

        {/* Dynamic Content Area: Horizontal Rails (Discovery) OR Grid (Search Results) */}
        {submittedQuery.trim().length === 0 ? (
          // ── Horizontal 2-Axis Content Rails (Discovery) ──
          <ScrollView
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: ph(8) }}
          >
            {filteredRails.map((rail, idx) => (
              <ContentRail
                key={`${rail.title}-${idx}`}
                title={rail.title}
                subtitle={rail.subtitle}
                data={rail.data}
                itemWidth={RAIL_ITEM_WIDTH}
                onPress={handleResultPress}
                onFocus={(item) => {
                  handleResultFocus(item);
                  isTopRowFocusedRef.current = idx === 0;
                }}
                isFirstRail={idx === 0}
                nextFocusUp={inputNode}
                inputRef={inputRef}
                firstCardRef={firstCardRef}
              />
            ))}
          </ScrollView>
        ) : (
          // ── Search Results Grid (When searching with query) ──
          <FocusGroup style={S.resultsArea}>
            <View style={S.sectionLabelArea}>
              <Text style={S.sectionLabelTitle}>
                Results for "{submittedQuery}" ({filteredResults.length})
              </Text>
              <Text style={S.sectionLabelSubtitle}>
                {activeFilter === "all"
                  ? "Showing matching live channels, movies, and series"
                  : activeFilter === "live"
                    ? "Showing matching live TV channels"
                    : activeFilter === "vod"
                      ? "Showing matching movies"
                      : "Showing matching series"}
              </Text>
            </View>

            {isLoading && (
              <View style={S.loadingInline}>
                <ActivityIndicator size="small" color="#FFFFFF" />
              </View>
            )}

            <FlatList
              data={chunkedResults}
              key={`results-${RESULT_COLUMNS}-${activeFilter}`}
              keyExtractor={(row: any) => row.id}
              contentContainerStyle={{ paddingHorizontal: RAIL_H_PAD, paddingBottom: ph(6) }}
              removeClippedSubviews={false}
              initialNumToRender={4}
              maxToRenderPerBatch={3}
              windowSize={9}
              updateCellsBatchingPeriod={80}
              renderItem={renderResultRow}
              ListEmptyComponent={
                !isLoading ? (
                  <View style={S.emptyState}>
                    <View style={S.emptyIconWrap}>
                      <Search size={ps(4)} color="rgba(255,255,255,0.4)" />
                    </View>
                    <Text style={S.emptyTitle}>No Results Found</Text>
                    <Text style={S.emptyText}>
                      We couldn't find anything matching "{submittedQuery}". Try searching by actor, genre, or title keywords.
                    </Text>
                  </View>
                ) : null
              }
            />
          </FocusGroup>
        )}
      </View>

      {/* Action Overlay Modal */}
      <Overlay
        visible={playModalVisible}
        onClose={() => setPlayModalVisible(false)}
        style={{ justifyContent: "flex-end", backgroundColor: "transparent" }}
        contentStyle={{ width: "100%", maxWidth: "100%", margin: 0, padding: 0 }}
      >
        <BlurView intensity={120} tint="dark" style={S.modalBlurContainer}>
          {selectedItem?.logo ? (
            <Image
              source={{ uri: selectedItem.logo }}
              style={[StyleSheet.absoluteFillObject, { opacity: 0.25 }]}
              blurRadius={50}
              contentFit="cover"
            />
          ) : null}
          <LinearGradient
            colors={["rgba(10, 12, 18, 0.75)", "rgba(8, 8, 12, 0.95)", "#08080a"]}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={[S.modalTVContent, S.modalBody]}>
            {/* Left: Poster Image */}
            <View style={S.modalPosterWrapper}>
              {selectedItem?.logo ? (
                <Image
                  source={{ uri: selectedItem.logo }}
                  style={S.modalPosterImg}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : (
                <View style={S.modalPosterFallback}>
                  <DynamicIcon
                    name={selectedItem?.type === "series" ? "albums-outline" : "film-outline"}
                    size={ps(3.2)}
                    color="rgba(255, 255, 255, 0.3)"
                  />
                </View>
              )}
            </View>

            {/* Middle: Details */}
            <View style={S.modalLeft}>
              <View style={S.modalTypeBadge}>
                <Text style={S.modalTypeBadgeText}>
                  {selectedItem?.type === "series" ? "SERIES" : "MOVIE"}
                </Text>
              </View>
              <Text style={S.modalTitle} numberOfLines={2}>{selectedItem?.name}</Text>
              <View style={S.modalMetaRow}>
                {selectedItem?.rating ? (
                  <View style={S.modalBadge}>
                    <Star size={ps(0.9)} color="#FFD700" />
                    <Text style={S.modalBadgeText}>{selectedItem.rating}</Text>
                  </View>
                ) : null}
                {selectedItem?.year ? (
                  <View style={S.modalBadge}>
                    <Calendar size={ps(0.9)} color="#fff" />
                    <Text style={S.modalBadgeText}>{selectedItem.year}</Text>
                  </View>
                ) : null}
                {selectedItem?.category ? (
                  <View style={S.modalBadge}>
                    <Text style={S.modalBadgeText}>{selectedItem.category}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={S.modalDescription} numberOfLines={5}>
                {selectedItem?.description || "No description available for this content."}
              </Text>
            </View>

            {/* Right: Action buttons */}
            <View style={S.modalRight}>
              <Focusable
                hasTVPreferredFocus
                ringOnFocus={false}
                onPress={() => handleVodAction(false)}
                style={S.modalBtnWrapper}
              >
                {(focused) => (
                  <View style={[S.modalBtnPill, focused && S.modalBtnPillFocused]}>
                    <Play size={ps(1.15)} color={focused ? "#000000" : "#FFFFFF"} />
                    <Text style={[S.modalBtnText, focused && S.modalBtnTextFocused]}>WATCH NOW</Text>
                  </View>
                )}
              </Focusable>
              <Focusable
                ringOnFocus={false}
                onPress={() => handleVodAction(true)}
                style={S.modalBtnWrapper}
              >
                {(focused) => (
                  <View style={[S.modalBtnPill, focused && S.modalBtnPillFocused]}>
                    <ExternalLink size={ps(1.15)} color={focused ? "#000000" : "#FFFFFF"} />
                    <Text style={[S.modalBtnText, focused && S.modalBtnTextFocused]}>EXTERNAL PLAYER</Text>
                  </View>
                )}
              </Focusable>
              <Focusable
                ringOnFocus={false}
                onPress={() => setPlayModalVisible(false)}
                style={S.modalBtnWrapper}
              >
                {(focused) => (
                  <View style={[S.modalBtnPill, focused && S.modalBtnPillFocused]}>
                    <X size={ps(1.15)} color={focused ? "#000000" : "#FFFFFF"} />
                    <Text style={[S.modalBtnText, focused && S.modalBtnTextFocused]}>CLOSE</Text>
                  </View>
                )}
              </Focusable>
            </View>
          </View>
        </BlurView>
      </Overlay>

      {dialogNode}
    </View>
  );
}

const S = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: RAIL_H_PAD,
    height: 56,
  },
  headerCenterTitleWrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: ps(1.6),
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  searchBtnWrapper: {
    borderRadius: 24,
    overflow: "hidden",
  },
  searchCircleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#17181c",
    borderWidth: 0,
    borderColor: "transparent",
    overflow: "hidden",
  },
  searchCircleBtnFocused: {
    borderRadius: 22,
    backgroundColor: "#F5F5F5",
    borderColor: "transparent",
    borderWidth: 0,
    transform: [{ scale: 1.12 }],
    overflow: "hidden",
  },
  searchControlsRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: RAIL_H_PAD,
    gap: pw(1.2),
    marginBottom: ph(1.6),
  },
  searchBarContainer: {
    flex: 1,
    height: 46,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: pw(1.2),
    backgroundColor: "#17181c",
    borderWidth: 1,
    borderColor: "transparent",
  },
  searchBarContainerFocused: {
    borderColor: "#ffffff",
    backgroundColor: "#17181c",
  },
  searchInput: {
    flex: 1,
    color: "#fff",
    fontSize: ps(1.15),
    marginLeft: 8,
    paddingVertical: 0,
    fontWeight: "500",
  },
  clearBtnWrapper: {
    borderRadius: 16,
    overflow: "hidden",
    marginLeft: 6,
  },
  clearBtnCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "transparent",
    justifyContent: "center",
    alignItems: "center",
  },
  clearBtnCircleFocused: {
    backgroundColor: "transparent",
    transform: [{ scale: 1.25 }],
    elevation: 8,
  },

  // ── Filter Bar ──
  filterBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: ps(0.8),
  },
  filterChipWrapper: {
    borderRadius: 18,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: ps(0.6),
    paddingHorizontal: ps(1.5),
    height: 44,
    borderRadius: 18,
    backgroundColor: "#17181c",
    borderWidth: 0,
    borderColor: "transparent",
  },
  filterChipActive: {
    backgroundColor: "#F5F5F5",
    borderColor: "transparent",
    borderWidth: 0,
  },
  filterChipFocused: {
    backgroundColor: "#F5F5F5",
    borderColor: "transparent",
    borderWidth: 0,
    transform: [{ scale: 1.06 }],
  },
  filterChipText: {
    color: "rgba(255, 255, 255, 0.75)",
    fontSize: ps(1.15),
    fontWeight: "700",
  },
  filterChipTextActive: {
    color: "#111111",
    fontWeight: "800",
  },
  filterChipTextFocused: {
    color: "#111111",
    fontWeight: "800",
  },

  // ── Rails ──
  railSection: {
    marginBottom: ph(4.5),
  },
  railHeader: {
    paddingHorizontal: RAIL_H_PAD,
    marginBottom: ph(1.8),
  },
  railTitle: {
    color: "#FFFFFF",
    fontSize: ps(1.6),
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  railSubtitle: {
    color: "rgba(142, 147, 168, 0.65)",
    fontSize: ps(0.95),
    marginTop: 2,
    fontWeight: "500",
  },
  railScrollContent: {
    paddingHorizontal: RAIL_H_PAD,
    paddingTop: ph(1.5),
    paddingBottom: ph(1.8),
    gap: pw(1.2),
  },

  // ── Section Label ──
  sectionLabelArea: {
    paddingHorizontal: RAIL_H_PAD,
    marginBottom: ph(1.5),
  },
  sectionLabelTitle: {
    color: "#FFFFFF",
    fontSize: ps(1.6),
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  sectionLabelSubtitle: {
    color: "#8E93A8",
    fontSize: ps(1.05),
    marginTop: 2,
  },

  // ── Results Area ──
  resultsArea: {
    flex: 1,
  },
  loadingInline: {
    paddingVertical: ph(3),
    alignItems: "center",
  },
  // ── VOD / OTT Movie Item Styles (Same as vod.tsx) ──
  movieItemWrapper: {
    paddingHorizontal: pw(0.4),
    paddingTop: 4,
    paddingBottom: 4,
    overflow: "visible",
  },
  movieCardContainer: {
    borderRadius: 16,
    overflow: "visible",
  },
  movieCardContainerFocused: {},
  posterFrame: {
    width: "100%",
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#17181c",
    borderWidth: 1,
    borderColor: "transparent",
  },
  posterFrameFocused: {
    borderColor: "#ffffff",
    borderWidth: 1,
    transform: [{ scale: 1.03 }],
    elevation: 12,
  },
  posterImage: {
    width: "100%",
    height: "100%",
  },
  posterFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2C2D32",
  },
  cornerRatingBadge: {
    position: "absolute",
    bottom: 6,
    right: 6,
    backgroundColor: "rgba(0, 0, 0, 0.78)",
    borderWidth: 0,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 7,
    elevation: 4,
  },
  cornerRatingText: {
    color: "#FFFFFF",
    fontSize: ps(0.85),
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  movieTitleText: {
    color: "rgba(255,255,255,0.75)",
    fontSize: ps(0.92),
    fontWeight: "700",
    marginTop: 8,
    lineHeight: 20,
  },
  movieTitleTextFocused: {
    color: "#ffffff",
    fontWeight: "900",
  },
  movieSubText: {
    color: "rgba(255,255,255,0.45)",
    fontSize: ps(0.8),
    fontWeight: "500",
    marginTop: 2,
  },
  qualityBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
  },
  qualityBadgeText: {
    color: "#FFFFFF",
    fontSize: ps(0.72),
    fontWeight: "800",
  },
  liveBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(229, 9, 20, 0.85)",
    paddingHorizontal: 6,
    paddingVertical: 2.5,
    borderRadius: 5,
    gap: 4,
  },
  liveBadgeDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#F5F5F5",
  },
  liveBadgeText: {
    color: "#FFFFFF",
    fontSize: ps(0.68),
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  channelNumBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 0,
  },
  channelNumText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: ps(0.7),
    fontWeight: "800",
  },

  // ── Empty State ──
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: ph(10),
    paddingHorizontal: pw(10),
  },
  emptyIconWrap: {
    width: ps(7),
    height: ps(7),
    borderRadius: ps(3.5),
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: ph(2),
  },
  emptyTitle: {
    color: "#FFFFFF",
    fontSize: ps(2),
    fontWeight: "700",
    marginBottom: ph(1),
    letterSpacing: 0.3,
  },
  emptyText: {
    color: "#8E93A8",
    fontSize: ps(1.2),
    textAlign: "center",
    lineHeight: ps(1.8),
    maxWidth: pw(45),
  },

  // ── Action overlay ──
  modalBlurContainer: {
    width: "100%",
    borderTopLeftRadius: ps(2),
    borderTopRightRadius: ps(2),
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.2)",
    borderBottomWidth: 0,
    backgroundColor: "rgba(10, 12, 18, 0.95)",
  },
  modalBody: {
    padding: ps(2.2),
  },
  modalTVContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  modalPosterWrapper: {
    width: pw(11),
    aspectRatio: 2 / 3,
    borderRadius: ps(0.8),
    overflow: "hidden",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    marginRight: pw(2),
  },
  modalPosterImg: {
    width: "100%",
    height: "100%",
  },
  modalPosterFallback: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
  },
  modalTypeBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    paddingHorizontal: ps(0.6),
    paddingVertical: ps(0.2),
    borderRadius: ps(0.3),
    marginBottom: ps(0.5),
  },
  modalTypeBadgeText: {
    color: "#FFFFFF",
    fontSize: ps(0.7),
    fontWeight: "800",
    letterSpacing: 1,
  },
  modalLeft: {
    flex: 1.4,
    paddingRight: ps(1.5),
    justifyContent: "center",
  },
  modalRight: {
    flex: 0.65,
    paddingLeft: ps(1.5),
    justifyContent: "center",
    gap: ps(0.8),
  },
  modalTitle: {
    color: "#FFFFFF",
    fontSize: ps(1.6),
    fontWeight: "800",
    marginBottom: ps(0.6),
  },
  modalDescription: {
    color: "rgba(255, 255, 255, 0.6)",
    fontSize: ps(0.95),
    lineHeight: ps(1.3),
    marginTop: ps(0.4),
  },
  modalMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: ps(0.6),
    marginBottom: ps(0.4),
  },
  modalBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: ps(0.3),
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    paddingHorizontal: ps(0.6),
    paddingVertical: ps(0.3),
    borderRadius: ps(0.4),
  },
  modalBadgeText: {
    color: "#FFFFFF",
    fontSize: ps(0.8),
    fontWeight: "700",
  },
  modalBtnWrapper: {
    borderRadius: 18,
    overflow: "visible",
    width: "100%",
  },
  modalBtnPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: ps(0.6),
    paddingVertical: ps(0.95),
    paddingHorizontal: ps(1.5),
    borderRadius: 18,
    borderWidth: 0,
    borderColor: "transparent",
    backgroundColor: "#17181c",
  },
  modalBtnPillFocused: {
    backgroundColor: "#F5F5F5",
    borderColor: "transparent",
    borderWidth: 0,
    elevation: 8,
    transform: [{ scale: 1.05 }],
  },
  modalBtnText: {
    color: "#FFFFFF",
    fontSize: ps(1.0),
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  modalBtnTextFocused: {
    color: "#000000",
    fontSize: ps(1.0),
    fontWeight: "900",
    letterSpacing: 0.3,
  },
});
