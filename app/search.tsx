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
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";

import { usePortalStore } from "../src/store/portalStore";
import { portalApi } from "../src/services/portalApi";
import { M3UApi } from "../src/services/m3uApi";
import { XtreamApi } from "../src/services/xtreamApi";
import { isTV } from "../src/utils/tvUtils";
import { CinematicBackground } from "../src/components/CinematicBackground";
import { Focusable, FocusGroup, Overlay } from "../src/tv";
import { useDialog } from "../src/components/ConfirmDialog";
import { THEME, pw, ph, ps, psRaw, CARD_FRAME, CARD_FRAME_INNER_RADIUS } from "../src/theme/tokens";
import { launchExternalPlayer } from "../src/utils/externalPlayer";

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
      screenKey="search"
      focusKey={`${item.type}-${item.id}`}
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
                      <View style={S.placeholderBadge}>
                        <Text style={S.placeholderBadgeText}>
                          {item.year ? `${item.year} • ` : ""}{item.type === "series" ? "SERIES" : "MOVIE"}
                        </Text>
                      </View>
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
                    <Text style={S.cardSub} numberOfLines={1}>
                      {item.year ? `${item.year} • ` : ""}{item.type === "series" ? "SERIES" : "MOVIE"}
                    </Text>
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
  if (!data || data.length === 0) return null;
  const scrollRef = useRef<ScrollView>(null);

  const handleCardFocus = useCallback((item: any, idx: number) => {
    onFocus?.(item);
    // Smoothly scroll the rail when navigating with D-pad
    const itemFullWidth = itemWidth + (isTV ? pw(1.2) : pw(1.5));
    const targetX = Math.max(0, (idx - 1) * itemFullWidth);
    scrollRef.current?.scrollTo({ x: targetX, animated: true });
  }, [itemWidth, onFocus]);

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

// ─────────────────────────────────────────────
// Main Search Screen Component
// ─────────────────────────────────────────────
export default function SearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { notify, node: dialogNode } = useDialog();

  const activePortal = usePortalStore((s) => s.activePortal);
  const channels = usePortalStore((s) => s.channels);
  const vodItems = usePortalStore((s) => s.vodItems);
  const series = usePortalStore((s) => s.series);
  const searchTimeout = useRef<any>(null);

  const [query, setQuery] = useState("");
  const [activeType, setActiveType] = useState<string>("all");
  const [results, setResults] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [focusedImage, setFocusedImage] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (searchFocused) {
      inputRef.current?.focus();
    }
  }, [searchFocused]);

  // VOD Modal
  const [playModalVisible, setPlayModalVisible] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);

  // ── Curated Content Rails (Discovery State) ──
  const discoveryRails = useMemo(() => {
    if (activeType === "live") {
      return [
        { title: "Top Live Channels", subtitle: "Direct broadcast streams from your playlist", data: channels.slice(0, 18).map((c) => ({ ...c, type: "live" })) },
        { title: "Entertainment & News", subtitle: "Browse more live channels", data: channels.slice(18, 36).map((c) => ({ ...c, type: "live" })) },
      ];
    }
    if (activeType === "vod") {
      return [
        { title: "Featured Movies", subtitle: "Top rated titles available to stream", data: vodItems.slice(0, 18).map((v) => ({ ...v, type: "vod" })) },
        { title: "Recently Added Movies", subtitle: "Fresh additions to your movie library", data: vodItems.slice(18, 36).map((v) => ({ ...v, type: "vod" })) },
      ];
    }
    if (activeType === "series") {
      return [
        { title: "Popular Series", subtitle: "Binge-worthy shows with all seasons", data: series.slice(0, 18).map((s) => ({ ...s, type: "series" })) },
        { title: "Recommended TV Shows", subtitle: "Top series from your provider", data: series.slice(18, 36).map((s) => ({ ...s, type: "series" })) },
      ];
    }

    // "all": Rich multi-rail home discovery with priority order
    const rails: any[] = [];
    if (vodItems.length > 0) {
      rails.push({
        title: "Recommended Movies",
        subtitle: "Popular on-demand films",
        data: vodItems.slice(0, 16).map((v) => ({ ...v, type: "vod" })),
      });
    }
    if (series.length > 0) {
      rails.push({
        title: "Trending Series",
        subtitle: "Top television shows",
        data: series.slice(0, 16).map((s) => ({ ...s, type: "series" })),
      });
    }
    if (channels.length > 0) {
      rails.push({
        title: "Top Live Channels",
        subtitle: "Direct live TV broadcast streams",
        data: channels.slice(0, 16).map((c) => ({ ...c, type: "live" })),
      });
    }
    if (vodItems.length > 16) {
      rails.push({
        title: "Recently Added",
        subtitle: "Latest entertainment in your library",
        data: vodItems.slice(16, 32).map((v) => ({ ...v, type: "vod" })),
      });
    }
    return rails;
  }, [activeType, channels, vodItems, series]);

  // Search Logic (Instant, Error-Free In-Memory + MAG Fallback)
  const performSearch = useCallback(async (q: string, type: string) => {
    if (!q.trim() || !activePortal) {
      setResults([]);
      return;
    }

    setIsLoading(true);
    const term = q.toLowerCase();

    try {
      let finalResults: any[] = [];

      // ================= M3U & XTREAM (Direct Memory Search — 0ms, No 503 errors) =================
      if (activePortal.type === "m3u" || activePortal.type === "xtream") {
        if (type === "all" || type === "live") {
          finalResults = [
            ...finalResults,
            ...channels.filter((c) => c.name.toLowerCase().includes(term)).map((c) => ({ ...c, type: "live" })),
          ];
        }
        if (type === "all" || type === "vod") {
          finalResults = [
            ...finalResults,
            ...vodItems.filter((v) => v.name.toLowerCase().includes(term)).map((v) => ({ ...v, type: "vod" })),
          ];
        }
        if (type === "all" || type === "series") {
          finalResults = [
            ...finalResults,
            ...series.filter((s) => s.name.toLowerCase().includes(term)).map((s) => ({ ...s, type: "series" })),
          ];
        }
      }

      // ================= MAG / STALKER =================
      else if (activePortal.type === "mag") {
        const searchTypes = type === "all" ? ["live", "vod", "series"] : [type];
        for (const st of searchTypes) {
          try {
            const apiResults = await portalApi.search(activePortal, q, st as any);
            const mapped = (apiResults || []).map((i: any) => ({
              ...i,
              id: String(i.id || i.cmd || ""),
              streamUrl: i.cmd || "",
              name: i.name || i.title,
              logo: i.screenshot_uri || i.logo || "",
              type: st,
              year: pickYear(i),
              description: i.description || i.descr || i.plot || "",
              rating: pickRating(i),
            }));
            finalResults = [...finalResults, ...mapped];
          } catch (magErr) {
            console.warn(`MAG search failed for ${st}:`, magErr);
          }
        }
      }

      const seen = new Set();
      const unique = finalResults.filter((item) => {
        const key = `${item.type}-${item.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      setResults(unique.slice(0, 60));
    } catch (error) {
      console.error("Search error:", error);
    } finally {
      setIsLoading(false);
    }
  }, [activePortal, channels, vodItems, series]);

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);

    searchTimeout.current = setTimeout(() => {
      performSearch(query, activeType);
    }, 250);

    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, [query, activeType, performSearch]);

  const handleResultPress = (item: any) => {
    if (item.type === "live") {
      router.push({ pathname: "/player", params: { url: item.streamUrl, title: item.name, type: "live" } });
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
      router.push({
        pathname: "/player",
        params: {
          url: streamUrl,
          title: selectedItem.name,
          type: "vod",
          contentId: `vod:${selectedItem.id}`,
        },
      });
    }
  };

  const RESULT_COLUMNS = isTV ? 7 : (W >= 1024 ? 6 : (W >= 768 ? 4 : 3));
  const CARD_WIDTH = (W - RAIL_H_PAD * 2) / RESULT_COLUMNS;
  // Sized so that 6 cards + padding show fully and ~18-20% of the 7th card peeks on the right
  const RAIL_ITEM_WIDTH = isTV ? pw(13.2) : pw(27);

  const renderResultItem = useCallback(({ item }: any) => (
    <ContentCard
      item={item}
      itemWidth={CARD_WIDTH}
      onPress={handleResultPress}
      onFocus={(it) => it.logo && setFocusedImage(it.logo)}
    />
  ), [CARD_WIDTH, handleResultPress]);

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
            <Focusable
              hasTVPreferredFocus={!playModalVisible}
              disabled={playModalVisible}
              onFocus={() => {
                // Focus ring on the container only
              }}
              onBlur={() => {
                setSearchFocused(false);
              }}
              onPress={() => {
                // Pressing OK / Enter enables input and opens soft keyboard on the first press
                setSearchFocused(true);
                inputRef.current?.focus();
              }}
              ringOnFocus={false}
              style={S.searchBarWrapper}
            >
              {(focused) => (
                <View
                  style={[
                    S.searchBarContainer,
                    (focused || searchFocused) && S.searchBarContainerFocused,
                  ]}
                >
                  <Ionicons
                    name="search"
                    size={isTV ? ps(1.4) : ps(1.5)}
                    color={(focused || searchFocused) ? "#fff" : "rgba(255,255,255,0.4)"}
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
                    returnKeyType="search"
                    showSoftInputOnFocus={true}
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => setSearchFocused(false)}
                    onSubmitEditing={() => setSearchFocused(false)}
                    editable={!playModalVisible}
                    focusable={true}
                  />
                  {query.length > 0 && (
                    <TouchableOpacity onPress={() => setQuery("")} style={{ padding: 6 }}>
                      <Ionicons name="close-circle" size={isTV ? ps(1.4) : ps(1.5)} color="rgba(255,255,255,0.5)" />
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </Focusable>

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

        {/* Filter row */}
        <FocusGroup>
          <View style={S.filterRow}>
            {[
              { id: "all", label: "All Content", icon: "grid-outline" },
              { id: "live", label: "Live TV", icon: "tv-outline" },
              { id: "vod", label: "Movies", icon: "film-outline" },
              { id: "series", label: "Series", icon: "albums-outline" },
            ].map((filter) => {
              const isActive = activeType === filter.id;
              return (
                <Focusable
                  key={filter.id}
                  onPress={() => setActiveType(filter.id)}
                  ringOnFocus={false}
                  style={S.filterPillWrapper}
                >
                  {(focused) => (
                    <View style={[
                      S.filterPill,
                      isActive && S.filterPillActive,
                      focused && S.filterPillFocused,
                      focused && { transform: [{ scale: 1.05 }] },
                    ]}>
                      <Ionicons
                        name={filter.icon as any}
                        size={isTV ? ps(1.1) : ps(1.0)}
                        color={focused ? "#000000" : (isActive ? "#FFFFFF" : "rgba(255,255,255,0.6)")}
                        style={{ marginRight: pw(0.5) }}
                      />
                      <Text style={[
                        S.filterText,
                        isActive && S.filterTextActive,
                        focused && S.filterTextFocused,
                      ]}>
                        {filter.label}
                      </Text>
                    </View>
                  )}
                </Focusable>
              );
            })}
          </View>
        </FocusGroup>

        {/* Dynamic Content Area: Horizontal Rails (Discovery) OR Grid (Search Results) */}
        {query.trim().length === 0 ? (
          // ── Horizontal 2-Axis Content Rails (Netflix/OTT Style) ──
          <ScrollView
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: ph(8) }}
          >
            {discoveryRails.map((rail, idx) => (
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
                Results for "{query}" ({results.length})
              </Text>
              <Text style={S.sectionLabelSubtitle}>
                Showing matching live channels, movies, and series
              </Text>
            </View>

            {isLoading && (
              <View style={S.loadingInline}>
                <ActivityIndicator size="small" color="#FFFFFF" />
              </View>
            )}

            <FlatList
              data={results}
              numColumns={RESULT_COLUMNS}
              key={`results-${RESULT_COLUMNS}`}
              keyExtractor={(item: any) => `${item.type}-${item.id}`}
              contentContainerStyle={{ paddingHorizontal: RAIL_H_PAD, paddingBottom: ph(6) }}
              columnWrapperStyle={{ justifyContent: "flex-start" }}
              removeClippedSubviews={Platform.OS === "android" && !isTV}
              initialNumToRender={RESULT_COLUMNS * 3}
              maxToRenderPerBatch={RESULT_COLUMNS * 2}
              windowSize={5}
              updateCellsBatchingPeriod={50}
              renderItem={renderResultItem}
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
        <BlurView intensity={120} tint="dark" style={{ width: "100%", borderTopLeftRadius: 36, borderTopRightRadius: 36, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.25)", borderBottomWidth: 0 }}>
          {selectedItem?.logo && (
            <Image
              source={{ uri: selectedItem.logo }}
              style={[StyleSheet.absoluteFillObject, { opacity: 0.4 }]}
              blurRadius={40}
              contentFit="cover"
            />
          )}
          <LinearGradient
            colors={["rgba(255,255,255,0.1)", "rgba(0,0,0,0.5)", "#000"]}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={[isTV ? S.modalTVContent : null, { padding: ps(3) }]}>
            <View style={S.modalLeft}>
              <Text style={S.modalTitle} numberOfLines={2}>{selectedItem?.name}</Text>
              <Text style={S.modalDescription} numberOfLines={isTV ? 8 : 5}>
                {selectedItem?.description || "No description available for this content."}
              </Text>
              <View style={S.modalMetaRow}>
                {selectedItem?.rating ? (
                  <View style={S.modalBadge}>
                    <Ionicons name="star" size={ps(1)} color="#FFD700" />
                    <Text style={S.modalBadgeText}>{selectedItem.rating}</Text>
                  </View>
                ) : null}
                {selectedItem?.year ? (
                  <View style={S.modalBadge}>
                    <Ionicons name="calendar-outline" size={ps(1)} color="#fff" />
                    <Text style={S.modalBadgeText}>{selectedItem.year}</Text>
                  </View>
                ) : null}
              </View>
            </View>

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
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
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
    flex: 1,
    borderRadius: isTV ? pw(1.9) : pw(4.75),
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.08)",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: isTV ? pw(1.2) : pw(2.5),
  },
  searchBarContainerFocused: {
    borderColor: "rgba(255, 255, 255, 0.45)",
    borderWidth: 1,
    backgroundColor: "rgba(255, 255, 255, 0.09)",
    ...Platform.select({
      ios: {
        shadowColor: "#fff",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  searchInput: {
    flex: 1,
    color: "#fff",
    fontSize: isTV ? ps(1.15) : ps(1.05),
    marginLeft: isTV ? 8 : 6,
    paddingVertical: 0,
    fontWeight: "500",
  },

  // ── Filter Pills ──
  filterRow: {
    flexDirection: "row",
    gap: isTV ? pw(0.9) : pw(1.2),
    paddingHorizontal: RAIL_H_PAD,
    marginBottom: isTV ? ph(2) : ph(2.5),
  },
  filterPillWrapper: {
    borderRadius: 100,
    overflow: "hidden",
  },
  filterPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: isTV ? pw(1.6) : pw(2.8),
    paddingVertical: isTV ? ph(0.75) : ph(0.9),
    borderRadius: 100,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  filterPillActive: {
    borderColor: "rgba(255,255,255,0.5)",
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  filterPillFocused: {
    borderColor: "#FFFFFF",
    backgroundColor: "#FFFFFF",
    ...Platform.select({
      ios: {
        shadowColor: "#fff",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.8,
        shadowRadius: 12,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  filterText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: isTV ? ps(1.0) : ps(0.92),
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  filterTextActive: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  filterTextFocused: {
    color: "#000000",
    fontWeight: "700",
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
  cardBorder: {
    flex: 1,
    borderRadius: psRaw(1.5),
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    backgroundColor: THEME.colors.background,
    overflow: "hidden",
  },
  cardBorderFocused: {
    borderColor: "#FFFFFF",
    borderWidth: 1.5,
    ...Platform.select({
      ios: {
        shadowColor: "#FFFFFF",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.65,
        shadowRadius: 14,
      },
      android: {
        elevation: 10,
      },
    }),
  },
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
  modalContainer: { backgroundColor: "#111", width: isTV ? ps(65) : "92%", borderRadius: 24, padding: ps(2), borderWidth: 1, borderColor: "rgba(255,255,255,0.05)", overflow: "hidden" },
  modalTVContent: { flexDirection: "row" },
  modalLeft: { flex: 1.4, padding: ps(1.5) },
  modalRight: { flex: 0.6, padding: ps(2), paddingRight: isTV ? ps(4) : ps(2), justifyContent: "center", gap: 12 },
  modalTitle: { color: "#fff", fontSize: ps(1.9), fontWeight: "900", marginBottom: 12 },
  modalDescription: { color: "rgba(255,255,255,0.5)", fontSize: ps(1.2), lineHeight: ps(1.4), marginBottom: 18 },
  modalMetaRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  modalBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.05)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  modalBadgeText: { color: "#fff", fontSize: ps(0.85), fontWeight: "700" },
  modalBtnWrapper: { borderRadius: 8, overflow: "visible", width: "100%", maxWidth: 380, alignSelf: "flex-end" },
  modalBtnBorder: { padding: 1, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.15)" },
  modalBtnBorderFocused: {
    padding: 1,
    borderWidth: 0,
    backgroundColor: "#fff",
    ...Platform.select({
      ios: {
        shadowColor: "#fff",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.8,
        shadowRadius: 16,
      },
      android: {
        elevation: 0,
      }
    })
  },
  modalBtnPrimaryInner: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: "transparent", overflow: "hidden" },
  modalBtnSecondaryInner: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.3)", overflow: "hidden" },
  modalBtnPrimaryText: { color: "#fff", fontSize: ps(0.95), fontWeight: "900", letterSpacing: 1 },
  modalBtnSecondaryText: { color: "rgba(255,255,255,0.85)", fontSize: ps(0.9), fontWeight: "700", letterSpacing: 0.5 },
});
