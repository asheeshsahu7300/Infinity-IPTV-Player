import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Dimensions,
  TouchableOpacity,
  StatusBar,
  TextInput,
  FlatList,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";

import { usePortalStore, Series, Category } from "../src/store/portalStore";
import { portalApi } from "../src/services/portalApi";
import { M3UApi } from "../src/services/m3uApi";
import { XtreamApi } from "../src/services/xtreamApi";
import { THEME, pw, ph, ps } from "../src/theme/tokens";
import { isTV } from "../src/utils/tvUtils";
import { CinematicBackground } from "../src/components/CinematicBackground";
import CategorySidebar from "../src/components/CategorySidebar";
import { Focusable, FocusGroup } from "../src/tv";

const { width: SCREEN_WIDTH_VAL } = Dimensions.get("window");

// ─────────────────────────────────────────────
// Styles Defined at Top
// ─────────────────────────────────────────────
const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: pw(3),
    paddingVertical: ph(1.2),
    gap: pw(2),
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.03)",
  },
  headerTitle: { color: "#fff", fontSize: ps(1.8), fontWeight: "900", minWidth: pw(10) },
  searchWrapper: {
    flex: 1,
    height: ph(6.5),
  },
  searchGradient: {
    flex: 1,
    borderRadius: 25,
    padding: 1.5,
  },
  searchFocused: {
    shadowColor: THEME.colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 12,
    elevation: 12,
  },
  searchInner: {
    flex: 1,
    backgroundColor: "rgba(10, 10, 16, 0.61)",
    borderRadius: 25 - 1.5,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: pw(1.6),
  },
  searchInput: { flex: 1, color: "#fff", fontSize: ps(1.1) },
  iconBtn: { padding: ps(0.6), borderRadius: 12, backgroundColor: "rgba(255,255,255,0.05)" },
  countBadge: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 10,
    paddingHorizontal: pw(1.5),
    paddingVertical: ph(0.6),
  },
  countText: { color: THEME.colors.primary, fontSize: ps(1), fontWeight: "800", fontFamily: THEME.fonts.bold },
  body: { flex: 1, flexDirection: "row" },
  gridArea: { flex: 1 },
  list: { padding: pw(1), paddingBottom: ph(10) },
  cardBorder: {
    padding: 1,
    borderRadius: ps(1.4),
    backgroundColor: THEME.colors.glassBg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  cardBorderFocused: {
    padding: 1,
    borderColor: THEME.colors.glassBorderFocus,
    backgroundColor: THEME.colors.glassBgFocus,
    ...Platform.select({
      ios: {
        shadowColor: "#fff",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.6,
        shadowRadius: 16,
      },
      android: {
        elevation: 0,
      }
    })
  },
  seriesItem: { flex: 1, backgroundColor: "transparent", borderRadius: ps(1.1), overflow: "hidden" },
  posterContainer: { flex: 1, backgroundColor: "rgba(255,255,255,0.03)" },
  poster: { width: "100%", height: "100%" },
  posterPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.03)" },
  textOverlay: { display: "none" },
  cardContent: { position: "absolute", bottom: 0, width: "100%", padding: ps(0.8), borderBottomLeftRadius: ps(1.1), borderBottomRightRadius: ps(1.1), overflow: "hidden" },
  seriesTitle: { color: "#fff", fontSize: ps(0.95), fontWeight: "700", fontFamily: THEME.fonts.bold },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 6, height: ps(1.6) },
  seriesMetaText: { color: "rgba(255,255,255,0.7)", fontSize: ps(0.8), fontWeight: "600", fontFamily: THEME.fonts.medium },
  metaDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: "rgba(255,255,255,0.4)", marginHorizontal: 6 },
  ratingWrapper: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255, 215, 0, 0.15)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  ratingText: { color: "#FFD700", fontSize: ps(0.8), fontWeight: "800", marginLeft: 3, fontFamily: THEME.fonts.bold },
  favoriteBtn: { position: "absolute", top: 10, right: 10, backgroundColor: "rgba(0,0,0,0.4)", borderRadius: 12, padding: 6 },
  loadingCenter: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { color: "rgba(255,255,255,0.4)", marginTop: 15, fontSize: ps(1), fontFamily: THEME.fonts.regular },
  emptyState: { flex: 1, justifyContent: "center", alignItems: "center", opacity: 0.5 },
  emptyTitle: { color: "#fff", fontSize: ps(1.2), marginTop: 10, fontFamily: THEME.fonts.bold },
  loadMoreFooter: { paddingVertical: ph(3), alignItems: "center", justifyContent: "center" },
  loadMoreBtn: { flexDirection: "row", alignItems: "center", gap: pw(0.8), paddingHorizontal: pw(3), paddingVertical: ph(1.4), backgroundColor: "rgba(255,255,255,0.06)", borderRadius: ps(1), borderWidth: 2, borderColor: "transparent" },
  loadMoreBtnFocused: { borderColor: "#fff", backgroundColor: THEME.colors.primary, shadowColor: THEME.colors.primary, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 12, elevation: 12 },
  loadMoreBtnText: { color: "#fff", fontSize: ps(1), fontWeight: "900", letterSpacing: 1.5, fontFamily: THEME.fonts.bold },
});

// ─────────────────────────────────────────────
// Series Item Component (Premium Design)
// ─────────────────────────────────────────────
const SeriesItem = React.memo(function SeriesItem({
  item,
  onPress,
  onFocus,
  onFavoritePress,
  isFavorite,
  itemWidth,
  isFocusedItem,
}: {
  item: Series;
  onPress: (item: Series) => void;
  onFocus?: (item: Series) => void;
  onFavoritePress: (item: Series) => void;
  isFavorite: boolean;
  itemWidth: number;
  isFocusedItem?: boolean;
}) {
  const handlePress = useCallback(() => {
    onPress(item);
  }, [onPress, item]);

  const handleFocus = useCallback(() => {
    onFocus?.(item);
  }, [onFocus, item]);

  const handleFavoritePress = useCallback(() => {
    onFavoritePress(item);
  }, [onFavoritePress, item]);



  return (
    <View style={{ width: itemWidth, padding: pw(1), overflow: "visible" }}>
      <Focusable
        onPress={handlePress}
        onFocus={handleFocus}
        onLongPress={handleFavoritePress}
        hasTVPreferredFocus={isFocusedItem}
        ringOnFocus={false}
      >
        {(focused) => (
          <View
            style={[
              S.cardBorder,
              { height: itemWidth * 1.5 }, // Enforce aspect ratio on wrapper
              focused && S.cardBorderFocused,
              focused && {
                transform: [{ scale: 1.06 }],
              }
            ]}
          >
            <View style={S.seriesItem}>
              <View style={S.posterContainer}>
                {item.logo ? (
                  <Image source={{ uri: item.logo }} style={S.poster} contentFit="cover" />
                ) : (
                  <View style={S.posterPlaceholder}>
                    <Ionicons name="tv-outline" size={ps(3)} color="rgba(255,255,255,0.15)" />
                  </View>
                )}

                {isFavorite && (
                  <View style={S.favoriteBtn}>
                    <Ionicons name="heart" size={ps(1.1)} color="#ff2d55" />
                  </View>
                )}
              </View>

              <BlurView intensity={focused ? 80 : 60} tint="dark" style={S.cardContent}>
                <Text style={S.seriesTitle} numberOfLines={1}>{item.name}</Text>
                <View style={S.metaRow}>
                  {item.year ? <Text style={S.seriesMetaText}>{item.year}</Text> : null}
                  {item.year && item.rating ? <View style={S.metaDot} /> : null}
                  {item.rating ? (
                    <View style={S.ratingWrapper}>
                      <Ionicons name="star" size={ps(0.7)} color="#FFD700" style={{ marginRight: 2 }} />
                      <Text style={S.ratingText}>{item.rating}</Text>
                    </View>
                  ) : null}
                </View>
              </BlurView>
            </View>
          </View>
        )}
      </Focusable>
    </View>
  );
});

// ─────────────────────────────────────────────
// Metadata Pick Helpers
// ─────────────────────────────────────────────
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
  const y = v?.year ?? v?.production_year ?? v?.release_year ?? v?.first_air_date;
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

const pickDescription = (v: any) => {
  const desc = v?.description ?? v?.descr ?? v?.plot ?? v?.info ?? v?.storyline ?? v?.short_description ?? "";
  if (!desc) return "No description available for this content.";
  const lower = String(desc).trim().toLowerCase();
  if (lower === "na" || lower === "n/a" || lower === "null" || lower === "undefined" || lower === "") {
    return "No description available for this content.";
  }
  return String(desc).trim();
};

// ─────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────
export default function SeriesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const safeGoBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/dashboard");
  }, [router]);

  const {
    activePortal,
    favorites,
    toggleFavorite,
    series,
    setSeries,
    categories,
    setCategories,
  } = usePortalStore();

  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [focusedImage, setFocusedImage] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchResults, setSearchResults] = useState<Series[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [trappingFocus, setTrappingFocus] = useState(false);
  const trapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track last focused Series id so we can restore focus after refresh
  const focusedIdRef = useRef<string>("");
  const flatListRef = useRef<FlatList>(null);
  const trapFocusBriefly = useCallback(() => {
    setTrappingFocus(true);
    if (trapTimeoutRef.current) clearTimeout(trapTimeoutRef.current);
    trapTimeoutRef.current = setTimeout(() => setTrappingFocus(false), 800);
  }, []);
  useEffect(() => () => {
    if (trapTimeoutRef.current) clearTimeout(trapTimeoutRef.current);
  }, []);



  const numColumns = isTV ? 5 : (SCREEN_WIDTH_VAL >= 768 ? 4 : 3);
  const PAGE_SIZE = numColumns * Math.ceil(28 / numColumns);
  const SIDEBAR_WIDTH_VAL = isTV ? 240 : 200;
  // The FlatList's contentContainerStyle (S.list) adds pw(1) horizontal
  // padding on each side. Subtract that plus a small safety margin and
  // floor — so sub-pixel rounding never pushes the rightmost card past the
  // viewport edge.
  const GRID_H_PADDING = pw(1) * 2;
  const SAFETY_MARGIN = 4;
  const itemWidth = Math.floor(
    (SCREEN_WIDTH_VAL - SIDEBAR_WIDTH_VAL - GRID_H_PADDING - SAFETY_MARGIN) / numColumns
  );

  const xtreamApiRef = useRef<XtreamApi | null>(null);
  const allSeriesCacheRef = useRef<Series[]>([]);
  // The current category's full filtered list — store/FlatList only see the
  // first N pages of this.
  const fullListRef = useRef<Series[]>([]);
  const prevCategoryIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!activePortal) { router.replace("/"); return; }
    if (activePortal.type === "xtream") {
      xtreamApiRef.current = new XtreamApi({
        url: activePortal.config.url,
        username: activePortal.config.username!,
        password: activePortal.config.password!,
      });
    }
    loadCategories();
    loadSeries(undefined, 1, true);
  }, [activePortal?.id]);

  useEffect(() => {
    if (!activePortal || prevCategoryIdRef.current === selectedCategory) return;
    setPage(1);
    prevCategoryIdRef.current = selectedCategory;

    if (activePortal.type === "xtream" || activePortal.type === "m3u") {
      const cat = selectedCategory === "all" ? undefined : selectedCategory;
      const filtered = !cat
        ? allSeriesCacheRef.current
        : allSeriesCacheRef.current.filter(s => String(s.categoryId) === String(cat));
      fullListRef.current = filtered;
      const sliced = filtered.slice(0, PAGE_SIZE);
      setSeries(sliced);
      setHasMore(filtered.length > sliced.length);
      setIsLoading(false);
    } else {
      setHasMore(true);
      loadSeries(selectedCategory, 1, true);
    }
  }, [selectedCategory]);

  const loadCategories = async () => {
    if (!activePortal) return;
    try {
      let cats: Category[] = [];
      if (activePortal.type === "m3u") {
        cats = await new M3UApi({ url: activePortal.config.url }).getSeriesCategories();
      } else if (activePortal.type === "xtream") {
        cats = await xtreamApiRef.current!.getSeriesCategories();
      } else {
        cats = await portalApi.getSeriesCategories(activePortal);
      }
      // Read live state at call-time to avoid overwriting live/vod categories
      const currentCategories = usePortalStore.getState().categories || [];
      const others = currentCategories.filter(c => c.type !== "series");
      setCategories([...others, ...(Array.isArray(cats) ? cats : [])]);
    } catch (e) {
      console.error(e);
      // On error, do NOT clear categories — leave existing ones intact
    }
  };

  const loadSeries = async (categoryId?: string, pageNum: number = 1, reset: boolean = false) => {
    if (!activePortal || loadingMore || (!hasMore && !reset)) return;
    try {
      reset ? setIsLoading(true) : setLoadingMore(true);
      let items: Series[] = [];
      const cat = !categoryId || categoryId === "all" ? undefined : categoryId;

      if (activePortal.type === "m3u") {
        if (allSeriesCacheRef.current.length === 0) {
          items = await new M3UApi({ url: activePortal.config.url }).getSeries(undefined);
          allSeriesCacheRef.current = Array.isArray(items) ? items : [];
        }
        const filtered = !cat
          ? allSeriesCacheRef.current
          : allSeriesCacheRef.current.filter(s => String(s.categoryId) === String(cat));
        fullListRef.current = filtered;
        const sliced = filtered.slice(0, pageNum * PAGE_SIZE);
        if (!reset) trapFocusBriefly();
        setSeries(sliced);
        setHasMore(filtered.length > sliced.length);
        setPage(pageNum);
        if (reset) restoreFocusPosition(sliced);
      } else if (activePortal.type === "xtream") {
        if (allSeriesCacheRef.current.length === 0) {
          const all = await xtreamApiRef.current!.getSeries(undefined, 1, 100000);
          allSeriesCacheRef.current = Array.isArray(all) ? all : [];
        }
        const filtered = !cat
          ? allSeriesCacheRef.current
          : allSeriesCacheRef.current.filter(s => String(s.categoryId) === String(cat));
        fullListRef.current = filtered;
        const sliced = filtered.slice(0, pageNum * PAGE_SIZE);
        if (!reset) trapFocusBriefly();
        setSeries(sliced);
        setHasMore(filtered.length > sliced.length);
        setPage(pageNum);
        if (reset) restoreFocusPosition(sliced);
      } else {
        // MAG / Stalker: server-side pagination
        const fresh = await portalApi.getSeries(activePortal, cat, pageNum);
        items = Array.isArray(fresh) ? fresh : [];
        const current = usePortalStore.getState().series;
        const updatedList = reset
          ? items
          : [...current, ...items.filter(i => !current.find(s => s.id === i.id))];
        if (!reset) trapFocusBriefly();
        setSeries(updatedList);
        setHasMore(items.length > 0);
        setPage(pageNum);
        if (reset) restoreFocusPosition(updatedList);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
      setLoadingMore(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(1);
    setHasMore(true);
    if (activePortal?.type === "xtream" || activePortal?.type === "m3u") {
      allSeriesCacheRef.current = [];
      fullListRef.current = [];
    }
    await loadSeries(selectedCategory, 1, true);
    setRefreshing(false);
  }, [selectedCategory, activePortal]);

  const handleSeriesPress = useCallback((item: Series) => {
    router.push({
      pathname: "/series-details",
      params: {
        id: item.id,
        name: item.name,
        logo: item.logo,
        description: item.description,
        year: item.year,
        rating: item.rating
      }
    });
  }, [router]);

  const handleSeriesFocus = useCallback((item: Series) => {
    setFocusedImage(item.logo || null);
    focusedIdRef.current = String(item.id);

    if (flatListRef.current) {
      const data = flatListRef.current.props.data as any[];
      if (data && data.length > 0) {
        let foundNearEnd = false;
        const checkCount = Math.min(3, data.length);
        for (let i = data.length - checkCount; i < data.length; i++) {
          if (data[i].items?.some((s: Series) => s.id === item.id)) {
            foundNearEnd = true;
            break;
          }
        }
        if (foundNearEnd && flatListRef.current.props.onEndReached) {
          flatListRef.current.props.onEndReached({ distanceFromEnd: 0 });
        }
      }
    }
  }, []);

  // After a refresh/reset, scroll the list back to the previously focused item
  const restoreFocusPosition = useCallback((items: Series[]) => {
    if (!focusedIdRef.current || !flatListRef.current) return;
    // With chunked rows, scrollToIndex needs the row index
    const idx = items.findIndex(s => String(s.id) === focusedIdRef.current);
    if (idx > 0) {
      const rowIndex = Math.floor(idx / numColumns);
      setTimeout(() => {
        try {
          flatListRef.current?.scrollToIndex({ index: rowIndex, animated: false, viewPosition: 0.3 });
        } catch { /* ignore if out of range */ }
      }, 120);
    }
  }, [numColumns]);

  const handleFavoritePress = useCallback((item: Series) => {
    toggleFavorite("series", item.id);
  }, [toggleFavorite]);

  const renderRow = useCallback(({ item: row, index: rowIndex }: { item: { id: string; items: Series[] }; index: number }) => (
    <View style={{ flexDirection: "row" }}>
      {row.items.map((seriesItem, colIndex) => {
        const itemIndex = rowIndex * numColumns + colIndex;
        return (
          <SeriesItem
            key={seriesItem.id}
            item={seriesItem}
            onPress={() => handleSeriesPress(seriesItem)}
            onFocus={handleSeriesFocus}
            onFavoritePress={handleFavoritePress}
            isFavorite={favorites.series.includes(seriesItem.id)}
            itemWidth={itemWidth}
            isFocusedItem={
              focusedIdRef.current
                ? String(seriesItem.id) === focusedIdRef.current
                : itemIndex === 0 && !searchFocused
            }
          />
        );
      })}
    </View>
  ), [favorites.series, itemWidth, searchFocused, handleSeriesPress, numColumns]);



  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const isXtreamOrM3U = activePortal?.type === "xtream" || activePortal?.type === "m3u";

  // Remote search for non-Xtream/M3U portals (e.g. MAG/Stalker which uses server-side search)
  useEffect(() => {
    if (!debouncedQuery || isXtreamOrM3U || !activePortal) {
      setSearchResults([]);
      return;
    }

    let isMounted = true;
    const performRemoteSearch = async () => {
      try {
        setIsLoading(true);
        const apiResults = await portalApi.search(activePortal, debouncedQuery, "series");
        if (!isMounted) return;
        const mapped = apiResults.map(i => ({
          id: String(i.id || i.cmd || ""),
          name: i.name || i.title,
          logo: i.screenshot_uri ?? i.logo ?? i.stream_icon ?? i.cover ?? "",
          year: pickYear(i),
          description: pickDescription(i),
          rating: pickRating(i),
          categoryId: "",
        }));
        setSearchResults(mapped);
      } catch (e) {
        console.error("Remote search error:", e);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    performRemoteSearch();

    return () => {
      isMounted = false;
    };
  }, [debouncedQuery, activePortal, isXtreamOrM3U]);

  // Global search memo
  const filteredSeries = useMemo(() => {
    if (debouncedQuery) {
      if (isXtreamOrM3U) {
        return allSeriesCacheRef.current
          .filter(s => s.name.toLowerCase().includes(debouncedQuery.toLowerCase()))
          .slice(0, 100);
      } else {
        return searchResults;
      }
    }

    // Default: return the category-filtered and paginated items
    return series;
  }, [series, debouncedQuery, isXtreamOrM3U, searchResults]);

  const chunkedSeries = useMemo(() => {
    const chunks = [];
    for (let i = 0; i < filteredSeries.length; i += numColumns) {
      chunks.push({
        id: `row-${i}`,
        items: filteredSeries.slice(i, i + numColumns),
      });
    }
    return chunks;
  }, [filteredSeries, numColumns]);

  const sidebarCategories: Category[] = [
    { id: "all", name: "All Series", type: "series" },
    ...categories.filter(c =>
      c.type === "series" &&
      c.name.toLowerCase() !== "all" &&
      c.name.toLowerCase() !== "all series"
    ),
  ];

  const searchInputRef = useRef<TextInput>(null);

  return (
    <View style={[S.container, { paddingTop: insets.top }]}>
      <CinematicBackground uri={focusedImage} />
      <StatusBar hidden />

      <View style={S.header}>
        <Focusable
          ringOnFocus={false}
          focusStyle={{ borderWidth: 2, borderColor: "rgba(255,255,255,0.5)", borderRadius: ps(2) }}
          onPress={safeGoBack}
          style={S.iconBtn}
        >
          {() => <Ionicons name="chevron-back" size={ps(1.4)} color="#fff" />}
        </Focusable>
        <Text style={S.headerTitle}>TV Series</Text>
        <Focusable
          onPress={() => searchInputRef.current?.focus()}
          ringOnFocus={false}
          style={S.searchWrapper}
        >
          {(focused) => (
            <LinearGradient
              colors={focused || searchFocused ? [THEME.colors.primary, THEME.colors.secondary] : ["rgba(255,255,255,0.12)", "rgba(255,255,255,0.06)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[S.searchGradient, (focused || searchFocused) && S.searchFocused]}
            >
              <View style={[
                S.searchInner,
                { borderRadius: (focused || searchFocused) ? 25 - 1.5 : 25 },
                (focused || searchFocused) && { backgroundColor: "#0b0b10" }
              ]}>
                <Ionicons name="search" size={ps(1.1)} color={focused || searchFocused ? "#fff" : "rgba(255,255,255,0.3)"} style={{ marginRight: pw(1) }} />
                <TextInput
                  ref={searchInputRef}
                  style={S.searchInput}
                  placeholder="Search series..."
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                />
              </View>
            </LinearGradient>
          )}
        </Focusable>
        <View style={S.countBadge}>
          <Text style={S.countText}>{isLoading ? "..." : String(filteredSeries.length)}</Text>
        </View>
      </View>

      <View style={S.body}>
        <FocusGroup style={{ width: SIDEBAR_WIDTH_VAL }}>
          <CategorySidebar
            categories={sidebarCategories}
            selectedId={selectedCategory || "all"}
            onSelect={setSelectedCategory}
            width={SIDEBAR_WIDTH_VAL}
          />
        </FocusGroup>
        <FocusGroup style={S.gridArea} trapLeft={trappingFocus} trapUp={trappingFocus}>
          <FlatList
            ref={flatListRef}
            data={chunkedSeries}
            renderItem={renderRow}
            keyExtractor={(item) => item.id}
            contentContainerStyle={[S.list, (isLoading || chunkedSeries.length === 0) && { flexGrow: 1 }]}
            removeClippedSubviews={false}
            extraData={filteredSeries.length}
            initialNumToRender={8}
            maxToRenderPerBatch={6}
            windowSize={5}
            updateCellsBatchingPeriod={50}
            onEndReached={() => {
              if (isLoading || loadingMore || !hasMore || debouncedQuery) return;
              trapFocusBriefly();
              if (isXtreamOrM3U) {
                // Grow the slice from the cached full list — no network.
                const nextPage = page + 1;
                const sliced = fullListRef.current.slice(0, nextPage * PAGE_SIZE);
                setSeries(sliced);
                setPage(nextPage);
                setHasMore(fullListRef.current.length > sliced.length);
              } else {
                loadSeries(selectedCategory, page + 1);
              }
            }}
            onEndReachedThreshold={0.5}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
            ListEmptyComponent={
              isLoading ? (
                <Focusable hasTVPreferredFocus={!searchFocused} style={{ flex: 1, paddingVertical: ph(10), justifyContent: "center", alignItems: "center" }} ringOnFocus={false}>
                  <ActivityIndicator color={THEME.colors.primary} size="large" />
                  <Text style={[S.loadingText, { marginTop: 10 }]}>Loading series library...</Text>
                </Focusable>
              ) : (
                <View style={S.emptyState}>
                  <Ionicons name="tv-outline" size={ps(4)} color="rgba(255,255,255,0.05)" />
                  <Text style={S.emptyTitle}>No Series Available</Text>
                </View>
              )
            }
            ListFooterComponent={
              loadingMore && filteredSeries.length > 0 ? (
                <View style={{ width: "100%", paddingVertical: ph(3), alignItems: "center", flexDirection: "row", justifyContent: "center", gap: pw(1) }}>
                  <ActivityIndicator color={THEME.colors.primary} size="small" />
                  <Text style={{ color: "rgba(255,255,255,0.3)", fontSize: ps(0.9) }}>Loading more...</Text>
                </View>
              ) : null
            }
          />
        </FocusGroup>
      </View>
    </View>
  );
}