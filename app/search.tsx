import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  FlatList,
  ScrollView,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsFocused } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";

import { usePortalStore } from "../src/store/portalStore";
import { portalApi, buildImageUrl } from "../src/services/portalApi";
import { M3UApi } from "../src/services/m3uApi";
import { XtreamApi } from "../src/services/xtreamApi";
import { isTV } from "../src/utils/tvUtils";
import { CinematicBackground } from "../src/components/CinematicBackground";
import { Focusable, FocusGroup, Overlay, useIsFocusTrapped } from "../src/tv";
import { useDialog } from "../src/components/ConfirmDialog";
import { THEME, pw, ph, ps, psRaw, CARD_FRAME, CARD_FRAME_INNER_RADIUS, TILE_FRAME, TILE_FRAME_FOCUSED } from "../src/theme/tokens";
import { launchExternalPlayer } from "../src/utils/externalPlayer";
import { playbackQueue } from "../src/services/playbackQueue";

const { width: W } = Dimensions.get("window");
const RAIL_H_PAD = pw(isTV ? 4.2 : 4);
const HEADER_ELEM_HEIGHT = isTV ? pw(3.8) : pw(9.5);

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
// Universal Content Card (16:11 for Live TV, 2:3 for Movies, Flush Focus Border)
// ─────────────────────────────────────────────
const ContentCard = React.memo(function ContentCard({
  item,
  onPress,
  onFocus,
  itemWidth,
}: {
  item: any;
  onPress: (item: any) => void;
  onFocus?: (item: any) => void;
  itemWidth: number;
}) {
  const isLive = item.type === "live";
  const cardHeight = isLive ? Math.round(itemWidth * 1.15) : Math.round(itemWidth * 1.38);

  const handlePress = useCallback(() => onPress(item), [onPress, item]);
  const handleFocus = useCallback(() => onFocus?.(item), [onFocus, item]);

  const channelMeta = isLive ? parseChannelMeta(item) : null;

  return (
    <Focusable
      onPress={handlePress}
      onFocus={handleFocus}
      ringOnFocus={false}
      accessibilityLabel={item.name}
      style={[S.cardWrapper, { width: itemWidth, overflow: "visible" }]}
    >
      {(focused) => (
        <View
          style={[
            S.cardBorder,
            { height: cardHeight },
            focused && S.cardBorderFocused,
            focused && { transform: [{ scale: 1.05 }] },
          ]}
        >
          <View style={S.card}>
            {isLive ? (
              // ── Live Channel Card (Enlarged Hero Logo, Channel #, Region/Category) ──
              <View style={S.liveCardInner}>
                <View style={S.liveLogoArea}>
                  {channelMeta?.channelNum ? (
                    <View style={S.channelNumBadge}>
                      <Text style={S.channelNumText}>{channelMeta.channelNum}</Text>
                    </View>
                  ) : null}

                  {item.logo ? (
                    <Image
                      source={{ uri: item.logo }}
                      style={S.liveLogoImg}
                      contentFit="contain"
                      cachePolicy="memory-disk"
                    />
                  ) : (
                    <Ionicons name="tv-outline" size={ps(3.2)} color="rgba(255,255,255,0.25)" />
                  )}

                  <View style={S.liveBadge}>
                    <View style={S.liveBadgeDot} />
                    <Text style={S.liveBadgeText}>LIVE</Text>
                  </View>
                </View>

                <View style={S.liveInfoArea}>
                  <Text style={[S.liveTitle, focused && S.liveTitleFocused]} numberOfLines={1}>
                    {channelMeta?.cleanTitle || item.name}
                  </Text>
                  <Text style={S.liveCategory} numberOfLines={1}>
                    {channelMeta?.subtitle || "Live Stream"}
                  </Text>
                </View>
              </View>
            ) : (
              // ── VOD / Series Poster Card ──
              <View style={S.vodCardInner}>
                <View style={S.cardImgContainer}>
                  {item.logo ? (
                    <Image
                      source={{ uri: item.logo }}
                      style={S.cardImg}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                    />
                  ) : (
                    <View style={S.brandedPlaceholder}>
                      <LinearGradient
                        colors={["#1c2032", "#10121d", "#08090f"]}
                        locations={[0, 0.5, 1]}
                        style={StyleSheet.absoluteFillObject}
                      />
                      <View style={S.placeholderIconWrap}>
                        <Ionicons
                          name={item.type === "series" ? "albums-outline" : "film-outline"}
                          size={ps(2.2)}
                          color="#FFFFFF"
                        />
                      </View>
                      <Text style={S.placeholderTitle} numberOfLines={2}>
                        {item.name}
                      </Text>
                      {/* Year only. The SERIES/MOVIE half is gone, and with it
                          the badge on anything that has no year — an empty pill
                          is worse than no pill. */}
                      {item.year ? (
                        <View style={S.placeholderBadge}>
                          <Text style={S.placeholderBadgeText}>{item.year}</Text>
                        </View>
                      ) : null}
                    </View>
                  )}
                  {item.quality ? (
                    <View style={S.badge}>
                      <Text style={S.badgeText}>{item.quality}</Text>
                    </View>
                  ) : null}
                </View>
                {item.logo ? (
                  <LinearGradient
                    colors={[
                      "transparent",
                      "rgba(8, 8, 12, 0.45)",
                      "rgba(8, 8, 12, 0.92)",
                      "#08080c",
                    ]}
                    locations={[0, 0.35, 0.7, 1]}
                    style={S.cardInfo}
                  >
                    <Text style={[S.cardTitle, focused && S.cardTitleFocused]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {/* Year only — see the note on the placeholder badge above.
                        Rendered conditionally so a card with no year does not
                        keep a blank line under its title. */}
                    {item.year ? (
                      <Text style={S.cardSub} numberOfLines={1}>
                        {item.year}
                      </Text>
                    ) : null}
                  </LinearGradient>
                ) : null}
              </View>
            )}
          </View>
        </View>
      )}
    </Focusable>
  );
});

// ─────────────────────────────────────────────
// Horizontal Content Rail with Smooth D-Pad Auto-Scrolling
// ─────────────────────────────────────────────
const ContentRail = React.memo(function ContentRail({
  title,
  subtitle,
  data,
  itemWidth,
  onPress,
  onFocus,
}: {
  title: string;
  subtitle?: string;
  data: any[];
  itemWidth: number;
  onPress: (item: any) => void;
  onFocus?: (item: any) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  /** Rail viewport width and current offset, for the visibility test below. */
  const viewportRef = useRef(0);
  const offsetRef = useRef(0);

  /**
   * Scrolls only when the focused card is not already fully visible.
   *
   * This used to run `scrollTo((idx - 1) * itemWidth)` on every focus event,
   * unconditionally. Two things fell out of that. Moving focus into a rail from
   * the search box or a neighbouring rail yanked it sideways even though the
   * card was already on screen, and stepping along a rail re-anchored the whole
   * strip on every press instead of scrolling once at the edge — which is the
   * drifting, over-eager scrolling this screen had.
   *
   * Now it behaves like scroll-into-view: off the left edge, reveal leftward;
   * off the right, reveal rightward; already visible, do nothing at all.
   */
  const handleCardFocus = useCallback((item: any, idx: number) => {
    onFocus?.(item);

    const gap = isTV ? pw(1.2) : pw(1.5);
    const stride = itemWidth + gap;
    const viewport = viewportRef.current;
    // Before the first layout there is nothing to measure against, and
    // guessing would reintroduce the yank.
    if (viewport <= 0) return;

    const left = idx * stride;
    const right = left + stride;
    const offset = offsetRef.current;

    if (left < offset) {
      scrollRef.current?.scrollTo({ x: Math.max(0, left - gap), animated: true });
    } else if (right > offset + viewport) {
      scrollRef.current?.scrollTo({ x: right - viewport + gap, animated: true });
    }
  }, [itemWidth, onFocus]);

  // Below the hooks, not above them.
  //
  // This return sat before the useRef and useCallback above, so a rail whose
  // data arrived after mount — which is every rail, since the library streams
  // in — went from calling zero hooks to calling two. React matches hook state
  // by call order, so that mismatch remounted the rail and dropped whatever
  // had focus inside it. It is the focus jumping on this screen.
  if (!data || data.length === 0) return null;

  return (
    <FocusGroup style={S.railSection}>
      <View style={S.railHeader}>
        <Text style={S.railTitle}>{title}</Text>
        {subtitle ? <Text style={S.railSubtitle}>{subtitle}</Text> : null}
      </View>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={S.railScrollContent}
        onLayout={(e) => { viewportRef.current = e.nativeEvent.layout.width; }}
        onScroll={(e) => { offsetRef.current = e.nativeEvent.contentOffset.x; }}
        // Cheap: this only feeds the visibility test, so it needs to be roughly
        // current, not every frame.
        scrollEventThrottle={64}
      >
        {data.map((item, idx) => (
          <ContentCard
            key={`${item.type}-${item.id}`}
            item={item}
            itemWidth={itemWidth}
            onPress={onPress}
            onFocus={(it) => handleCardFocus(it, idx)}
          />
        ))}
      </ScrollView>
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
const FILTER_TABS: { id: ContentFilter; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
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

  const [query, setQuery] = useState("");
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
  const [focusedImage, setFocusedImage] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  // VOD Modal
  const [playModalVisible, setPlayModalVisible] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);

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

      // 2. If it's a MAG portal, perform fast remote search to augment results
      if (activePortal.type === "mag") {
        const reqId = ++searchRequestId.current;
        setIsLoading(true);

        if (searchTimeout.current) clearTimeout(searchTimeout.current);
        searchTimeout.current = setTimeout(async () => {
          try {
            // Determine which types to search based on activeFilter
            const typesToQuery: ("live" | "vod" | "series")[] =
              activeFilter === "all" ? ["live", "vod", "series"] : [activeFilter];

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
              } catch {
                // Keep local in-memory matches intact
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
        }, 350);
      } else {
        setIsLoading(false);
      }
    },
    [activePortal, channels, vodItems, series, activeFilter]
  );

  useEffect(() => {
    performSearch(query);
  }, [query, activeFilter, performSearch]);

  const filteredResults = useMemo(() => {
    if (activeFilter === "all") return results;
    return results.filter((item) => item.type === activeFilter);
  }, [results, activeFilter]);

  const handleResultPress = (item: any) => {
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
  };

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

  const RESULT_COLUMNS = isTV ? 7 : (W >= 1024 ? 6 : (W >= 768 ? 4 : 3));
  const CARD_WIDTH = (W - RAIL_H_PAD * 2) / RESULT_COLUMNS;
  // Sized so that 6 cards + padding show fully and ~18-20% of the 7th card peeks on the right
  const RAIL_ITEM_WIDTH = isTV ? pw(13.2) : pw(27);

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

  // Keep a stable ref so renderResultRow doesn't recreate on every focusedImage change
  const handleResultFocus = useCallback((it: any) => {
    if (it.logo) setFocusedImage(it.logo);
  }, []);

  const renderResultRow = useCallback(({ item: row }: { item: { id: string; items: any[] } }) => (
    <FocusGroup style={{ flexDirection: "row" }}>
      {row.items.map((it) => (
        <ContentCard
          key={`${it.type}-${it.id}`}
          item={it}
          itemWidth={CARD_WIDTH}
          onPress={handleResultPress}
          onFocus={handleResultFocus}
        />
      ))}
    </FocusGroup>
  ), [CARD_WIDTH, handleResultPress, handleResultFocus]);

  return (
    <View style={[S.container, { paddingTop: insets.top + (isTV ? ph(3) : ph(3.5)) }]}>
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

        {/* Header Bar */}
        <FocusGroup>
          <View style={S.headerRow}>
            <View style={S.searchBarWrapper}>
              <View style={[S.searchBarContainer, searchFocused && S.searchBarContainerFocused]}>
                <Ionicons
                  name="search"
                  size={isTV ? ps(1.4) : ps(1.5)}
                  color={searchFocused ? "#fff" : "rgba(255,255,255,0.4)"}
                  style={{ marginRight: pw(0.8) }}
                />
                <TextInput
                  ref={inputRef}
                  style={S.searchInput}
                  placeholder="Search content..."
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={query}
                  onChangeText={setQuery}
                  autoCapitalize="none"
                  autoCorrect={false}
                  focusable={isScreenFocused && !isFocusTrapped && !playModalVisible}
                  editable={isScreenFocused && !isFocusTrapped && !playModalVisible}
                  returnKeyType="search"
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                  onSubmitEditing={() => setSearchFocused(false)}
                />
                {query.length > 0 && (
                  <TouchableOpacity onPress={() => setQuery("")} style={{ padding: 6 }}>
                    <Ionicons name="close-circle" size={isTV ? ps(1.4) : ps(1.5)} color="rgba(255,255,255,0.5)" />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            <Focusable
              ringOnFocus={false}
              focusStyle={S.roundBtnFocused}
              style={S.roundBtn}
              onPress={() => router.push("/portals")}
            >
              {(focused) => <Ionicons name="apps" size={isTV ? ps(1.4) : ps(1.35)} color={focused ? "#000" : "#fff"} />}
            </Focusable>
            <Focusable
              ringOnFocus={false}
              focusStyle={S.roundBtnFocused}
              style={S.roundBtn}
              onPress={() => router.push("/settings")}
            >
              {(focused) => <Ionicons name="settings-sharp" size={isTV ? ps(1.4) : ps(1.35)} color={focused ? "#000" : "#fff"} />}
            </Focusable>
          </View>
        </FocusGroup>

        {/* ── Content Type Filter Tabs (Live TV, VOD, Series) ── */}
        <FocusGroup style={S.filterBar}>
          {FILTER_TABS.map((tab, index) => {
            const isActive = activeFilter === tab.id;
            return (
              <Focusable
                key={tab.id}
                // Entry focus for the screen.
                //
                // Something has to claim it or Android picks, and left to
                // itself it picked the apps button at the end of the header.
                // It cannot be the search field: claiming focus there means
                // claiming it programmatically, and on a TV that is the one
                // thing guaranteed to hide the keyboard (see searchFocused).
                // The first chip is next to the field, so UP reaches it.
                hasTVPreferredFocus={index === 0 && !playModalVisible}
                ringOnFocus={false}
                // Pressing the active chip clears back to "all". With no All
                // chip that is the only route to mixed results, and without it
                // narrowing would be one-way until the screen was left.
                onPress={() => setActiveFilter(isActive ? "all" : tab.id)}
                style={S.filterChipWrapper}
              >
                {(focused) => (
                  <View
                    style={[
                      S.filterChip,
                      isActive && S.filterChipActive,
                      focused && S.filterChipFocused,
                    ]}
                  >
                    <Ionicons
                      name={tab.icon}
                      size={isTV ? ps(1.1) : ps(1.0)}
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

        {/* Dynamic Content Area: Horizontal Rails (Discovery) OR Grid (Search Results) */}
        {query.trim().length === 0 ? (
          // ── Horizontal 2-Axis Content Rails (Netflix/OTT Style) ──
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
                onFocus={(it) => it.logo && setFocusedImage(it.logo)}
              />
            ))}
          </ScrollView>
        ) : (
          // ── Search Results Grid (When searching with query) ──
          <FocusGroup style={S.resultsArea}>
            <View style={S.sectionLabelArea}>
              <Text style={S.sectionLabelTitle}>
                Results for "{query}" ({filteredResults.length})
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
              windowSize={isTV ? 9 : 7}
              updateCellsBatchingPeriod={80}
              renderItem={renderResultRow}
              ListEmptyComponent={
                !isLoading ? (
                  <View style={S.emptyState}>
                    <View style={S.emptyIconWrap}>
                      <Ionicons name="search-outline" size={isTV ? ps(4) : ps(3.5)} color="rgba(255,255,255,0.4)" />
                    </View>
                    <Text style={S.emptyTitle}>No Results Found</Text>
                    <Text style={S.emptyText}>
                      We couldn't find anything matching "{query}". Try searching by actor, genre, or title keywords.
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
          <View style={[isTV ? S.modalTVContent : null, S.modalBody]}>
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
                  <Ionicons
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
                    <Ionicons name="star" size={ps(0.9)} color="#FFD700" />
                    <Text style={S.modalBadgeText}>{selectedItem.rating}</Text>
                  </View>
                ) : null}
                {selectedItem?.year ? (
                  <View style={S.modalBadge}>
                    <Ionicons name="calendar-outline" size={ps(0.9)} color="#fff" />
                    <Text style={S.modalBadgeText}>{selectedItem.year}</Text>
                  </View>
                ) : null}
                {selectedItem?.category ? (
                  <View style={S.modalBadge}>
                    <Text style={S.modalBadgeText}>{selectedItem.category}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={S.modalDescription} numberOfLines={isTV ? 5 : 4}>
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
                  <View style={[S.modalBtnBorder, focused && S.modalBtnBorderFocused]}>
                    <View style={S.modalBtnPrimaryInner}>
                      <Ionicons name="play" size={ps(1.1)} color="#000" />
                      <Text style={[S.modalBtnPrimaryText, focused && { color: "#000" }]}>WATCH NOW</Text>
                    </View>
                  </View>
                )}
              </Focusable>
              <Focusable
                ringOnFocus={false}
                onPress={() => handleVodAction(true)}
                style={S.modalBtnWrapper}
              >
                {(focused) => (
                  <View style={[S.modalBtnBorder, focused && S.modalBtnBorderFocused]}>
                    <View style={[S.modalBtnSecondaryInner, focused && { backgroundColor: "#fff" }]}>
                      <Ionicons name="open-outline" size={ps(1.1)} color={focused ? "#000" : "#fff"} />
                      <Text style={[S.modalBtnSecondaryText, focused && { color: "#000" }]}>EXTERNAL PLAYER</Text>
                    </View>
                  </View>
                )}
              </Focusable>
              <Focusable
                ringOnFocus={false}
                onPress={() => setPlayModalVisible(false)}
                style={S.modalBtnWrapper}
              >
                {(focused) => (
                  <View style={[S.modalBtnBorder, focused && S.modalBtnBorderFocused]}>
                    <View style={[S.modalBtnSecondaryInner, focused && { backgroundColor: "#fff" }]}>
                      <Ionicons name="close" size={ps(1.1)} color={focused ? "#000" : "#fff"} />
                      <Text style={[S.modalBtnSecondaryText, focused && { color: "#000" }]}>CLOSE</Text>
                    </View>
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
    backgroundColor: "#08080a",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: RAIL_H_PAD,
    marginBottom: isTV ? ph(1.8) : ph(2.2),
    gap: isTV ? pw(1.2) : pw(2),
  },
  roundBtn: {
    width: isTV ? pw(3.8) : pw(9.5),
    height: isTV ? pw(3.8) : pw(9.5),
    borderRadius: isTV ? pw(1.9) : pw(4.75),
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: TILE_FRAME.borderWidth,
    borderColor: TILE_FRAME.borderColor,
    justifyContent: "center",
    alignItems: "center",
  },
  roundBtnFocused: {
    backgroundColor: "#FFFFFF",
    borderColor: "#FFFFFF",
    transform: [{ scale: 1.12 }],
    ...Platform.select({
      ios: {
        shadowColor: "#fff",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.85,
        shadowRadius: 14,
      },
      android: {
        elevation: 12,
      },
    }),
  },

  searchBarWrapper: {
    flex: 1,
    height: HEADER_ELEM_HEIGHT,
  },
  searchBarContainer: {
    ...TILE_FRAME,
    flex: 1,
    borderRadius: isTV ? pw(1.9) : pw(4.75),
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: isTV ? pw(1.2) : pw(2.5),
  },
  // Was white-45% against the tiles' white-60%, close enough to look like a
  // mistake rather than a choice.
  searchBarContainerFocused: { ...TILE_FRAME_FOCUSED },
  searchInput: {
    flex: 1,
    color: "#fff",
    fontSize: isTV ? ps(1.15) : ps(1.05),
    marginLeft: isTV ? 8 : 6,
    paddingVertical: 0,
    fontWeight: "500",
  },

  // ── Filter Bar ──
  filterBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: RAIL_H_PAD,
    gap: ps(0.8),
    marginBottom: isTV ? ph(1.6) : ph(1.8),
  },
  filterChipWrapper: {
    borderRadius: ps(2),
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: ps(0.45),
    paddingHorizontal: ps(1.1),
    paddingVertical: ps(0.48),
    borderRadius: ps(2),
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    // Had no border at all, so the chips were the one row on this screen with
    // no edge. Background left as it was — a chip reads as a filled pill.
    borderWidth: TILE_FRAME.borderWidth,
    borderColor: TILE_FRAME.borderColor,
  },
  filterChipActive: {
    backgroundColor: "#ffffff",
  },
  filterChipFocused: {
    backgroundColor: "#ffffff",
    transform: [{ scale: 1.06 }],
  },
  filterChipText: {
    color: "rgba(255, 255, 255, 0.75)",
    fontSize: ps(0.88),
    fontWeight: "600",
    fontFamily: THEME.fonts.medium,
  },
  filterChipTextActive: {
    color: "#000000",
    fontWeight: "800",
  },
  filterChipTextFocused: {
    color: "#000000",
    fontWeight: "800",
  },

  // ── Rails ──
  railSection: {
    marginBottom: isTV ? ph(3) : ph(3.5),
  },
  railHeader: {
    paddingHorizontal: RAIL_H_PAD,
    marginBottom: isTV ? ph(1) : ph(1.2),
  },
  railTitle: {
    color: "#FFFFFF",
    fontSize: isTV ? ps(1.6) : ps(1.4),
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  railSubtitle: {
    color: "rgba(142, 147, 168, 0.65)",
    fontSize: isTV ? ps(0.95) : ps(0.85),
    marginTop: 2,
    fontWeight: "500",
  },
  railScrollContent: {
    paddingHorizontal: RAIL_H_PAD,
    gap: isTV ? pw(1.2) : pw(1.5),
  },

  // ── Section Label ──
  sectionLabelArea: {
    paddingHorizontal: RAIL_H_PAD,
    marginBottom: isTV ? ph(1.5) : ph(1.8),
  },
  sectionLabelTitle: {
    color: "#FFFFFF",
    fontSize: isTV ? ps(1.6) : ps(1.4),
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  sectionLabelSubtitle: {
    color: "#8E93A8",
    fontSize: isTV ? ps(1.05) : ps(0.95),
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
  cardWrapper: {
    padding: isTV ? pw(0.4) : pw(0.3),
  },
  // This screen has its own rail card, separate from ContentCard, and it had
  // its own border to match: white-10% resting over an opaque black slab, and
  // a pure #FFFFFF 1.5px edge with an elevation-10 lift on focus. Both now
  // come from the shared frame, which also brings the translucent wash the
  // opaque background was standing in for.
  cardBorder: {
    ...TILE_FRAME,
    flex: 1,
    borderRadius: psRaw(1.5),
    overflow: "hidden",
  },
  cardBorderFocused: { ...TILE_FRAME_FOCUSED },
  card: {
    flex: 1,
    overflow: "hidden",
  },

  // ── Live Channel Card Styling (16:11, Large Logo, Channel #, Region/Quality) ──
  liveCardInner: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.02)",
    justifyContent: "space-between",
  },
  liveLogoArea: {
    flex: 1,
    padding: ps(0.6),
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },
  liveLogoImg: {
    width: "92%",
    height: "88%",
  },
  channelNumBadge: {
    position: "absolute",
    top: isTV ? ps(0.6) : ps(0.7),
    left: isTV ? ps(0.6) : ps(0.7),
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: isTV ? pw(0.6) : pw(0.9),
    paddingVertical: isTV ? ph(0.2) : ph(0.3),
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    zIndex: 2,
  },
  channelNumText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: isTV ? ps(0.7) : ps(0.65),
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  liveBadge: {
    position: "absolute",
    top: isTV ? ps(0.6) : ps(0.7),
    right: isTV ? ps(0.6) : ps(0.7),
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: isTV ? pw(0.9) : pw(1.3),
    paddingVertical: isTV ? ph(0.35) : ph(0.45),
    borderRadius: 100,
    borderWidth: 1,
    borderColor: "rgba(112, 222, 91, 0.35)",
    gap: pw(0.4),
    zIndex: 2,
  },
  liveBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#70de5b",
  },
  liveBadgeText: {
    color: "#70de5b",
    fontSize: isTV ? ps(0.7) : ps(0.65),
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  liveInfoArea: {
    paddingHorizontal: ps(1.1),
    paddingVertical: ps(0.75),
    backgroundColor: "rgba(10,11,16,0.92)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  liveTitle: {
    color: "#FFFFFF",
    fontSize: isTV ? ps(1.15) : ps(1.05),
    fontWeight: "700",
  },
  liveTitleFocused: {
    color: "#FFFFFF",
  },
  liveCategory: {
    color: "#8E93A8",
    fontSize: isTV ? ps(0.82) : ps(0.75),
    marginTop: 2,
    fontWeight: "600",
  },

  // ── Movies / Series Card Styling ──
  vodCardInner: {
    flex: 1,
  },
  brandedPlaceholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: ps(1.2),
  },
  placeholderIconWrap: {
    width: ps(4.5),
    height: ps(4.5),
    borderRadius: ps(2.25),
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: ph(0.8),
  },
  placeholderTitle: {
    color: "#FFFFFF",
    fontSize: isTV ? ps(1.1) : ps(0.95),
    fontWeight: "700",
    textAlign: "center",
    lineHeight: isTV ? ps(1.4) : ps(1.3),
  },
  placeholderBadge: {
    marginTop: ph(0.8),
    paddingHorizontal: pw(0.8),
    paddingVertical: ph(0.3),
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 4,
  },
  placeholderBadgeText: {
    color: "#A2A7BD",
    fontSize: isTV ? ps(0.75) : ps(0.7),
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  cardImgContainer: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  cardImg: {
    width: "100%",
    height: "100%",
  },
  cardInfo: {
    position: "absolute",
    bottom: 0,
    width: "100%",
    height: "48%",
    justifyContent: "flex-end",
    padding: ps(1.1),
    borderBottomLeftRadius: ps(1.1),
    borderBottomRightRadius: ps(1.1),
    overflow: "hidden",
  },
  cardTitle: {
    color: "#FFFFFF",
    fontSize: isTV ? ps(1.18) : ps(1.1),
    fontWeight: "700",
    textShadowColor: "rgba(0, 0, 0, 0.95)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  cardTitleFocused: {
    color: "#FFFFFF",
  },
  cardSub: {
    color: "#A2A7BD",
    fontSize: isTV ? ps(0.88) : ps(0.8),
    marginTop: 2,
    fontWeight: "600",
    textShadowColor: "rgba(0, 0, 0, 0.85)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  badge: {
    position: "absolute",
    top: isTV ? ps(0.6) : ps(0.8),
    right: isTV ? ps(0.6) : ps(0.8),
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: isTV ? pw(0.6) : pw(1),
    paddingVertical: isTV ? ph(0.3) : ph(0.5),
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  badgeText: {
    color: "#fff",
    fontSize: isTV ? ps(0.65) : ps(0.7),
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
    fontSize: isTV ? ps(2) : ps(1.6),
    fontWeight: "700",
    marginBottom: ph(1),
    letterSpacing: 0.3,
  },
  emptyText: {
    color: "#8E93A8",
    fontSize: isTV ? ps(1.2) : ps(1),
    textAlign: "center",
    lineHeight: isTV ? ps(1.8) : ps(1.5),
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
    width: isTV ? pw(11) : pw(22),
    aspectRatio: 2 / 3,
    borderRadius: ps(0.8),
    overflow: "hidden",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    marginRight: isTV ? pw(2) : pw(3),
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
    borderRadius: ps(0.6),
    overflow: "visible",
    width: "100%",
  },
  modalBtnBorder: {
    padding: 1,
    borderRadius: ps(0.6),
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
  },
  modalBtnBorderFocused: {
    borderColor: "#FFFFFF",
    backgroundColor: "#FFFFFF",
  },
  modalBtnPrimaryInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: ps(0.4),
    paddingVertical: ps(0.7),
    paddingHorizontal: ps(1.2),
    borderRadius: ps(0.5),
    backgroundColor: "#FFFFFF",
  },
  modalBtnSecondaryInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: ps(0.4),
    paddingVertical: ps(0.7),
    paddingHorizontal: ps(1.2),
    borderRadius: ps(0.5),
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  modalBtnPrimaryText: {
    color: "#000000",
    fontSize: ps(0.88),
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  modalBtnSecondaryText: {
    color: "#FFFFFF",
    fontSize: ps(0.88),
    fontWeight: "700",
    letterSpacing: 0.5,
  },
});
