import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Dimensions,
  Platform,
  TouchableOpacity,
  StatusBar,
  TextInput,
  Linking,
  Alert,
  FlatList,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as IntentLauncher from "expo-intent-launcher";

import { usePortalStore, VODItem, Category } from "../src/store/portalStore";
import { portalApi } from "../src/services/portalApi";
import { M3UApi } from "../src/services/m3uApi";
import { XtreamApi } from "../src/services/xtreamApi";
import { THEME, pw, ph, ps } from "../src/theme/tokens";
import { isTV } from "../src/utils/tvUtils";
import { CinematicBackground } from "../src/components/CinematicBackground";
import { launchExternalPlayer } from "../src/utils/externalPlayer";
import CategorySidebar from "../src/components/CategorySidebar";
import { Focusable, FocusGroup, Overlay } from "../src/tv";

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
    backgroundColor: "transparent",
  },
  cardBorderFocused: {
    padding: 2,
    shadowColor: THEME.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  vodItem: { backgroundColor: "#161622", borderRadius: ps(1.2), overflow: "hidden" },
  posterContainer: { width: "100%", aspectRatio: 2 / 3, backgroundColor: "#1c1c2b", overflow: "hidden", borderTopLeftRadius: ps(1.2), borderTopRightRadius: ps(1.2) },
  poster: { width: "100%", height: "100%" },
  posterPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#1c1c2b" },
  textOverlay: { display: "none" },
  cardContent: { padding: ps(0.7), backgroundColor: "#161622", borderBottomLeftRadius: ps(1.2), borderBottomRightRadius: ps(1.2) },
  vodTitle: { color: "#fff", fontSize: ps(0.95), fontWeight: "700", fontFamily: THEME.fonts.bold },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 6, height: ps(1.6) },
  vodMetaText: { color: "rgba(255,255,255,0.6)", fontSize: ps(0.8), fontWeight: "600", fontFamily: THEME.fonts.medium },
  metaDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: "rgba(255,255,255,0.3)", marginHorizontal: 6 },
  ratingWrapper: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255, 215, 0, 0.08)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  ratingText: { color: "#FFD700", fontSize: ps(0.8), fontWeight: "700", marginLeft: 3, fontFamily: THEME.fonts.bold },
  favoriteBtn: { position: "absolute", top: 10, right: 10, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 10, padding: 6 },
  loadingCenter: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { color: "rgba(255,255,255,0.4)", marginTop: 15, fontSize: ps(1), fontFamily: THEME.fonts.regular },
  emptyState: { flex: 1, justifyContent: "center", alignItems: "center", opacity: 0.5 },
  emptyTitle: { color: "#fff", fontSize: ps(1.2), marginTop: 10, fontFamily: THEME.fonts.bold },

  // Modal Styles
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", justifyContent: "center", alignItems: "center" },
  modalContainer: { backgroundColor: "#111", width: isTV ? ps(65) : "92%", borderRadius: 24, padding: ps(2), borderWidth: 1, borderColor: "rgba(255,255,255,0.05)", overflow: "hidden" },
  modalTVContent: { flexDirection: "row" },
  modalLeft: { flex: 1.4, padding: ps(1.5) },
  modalRight: { flex: 0.6, backgroundColor: "rgba(255,255,255,0.015)", padding: ps(2), borderRadius: 20, justifyContent: "center", gap: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.03)" },
  modalTitle: { color: "#fff", fontSize: ps(1.8), fontWeight: "900", marginBottom: 12, fontFamily: THEME.fonts.bold },
  modalDescription: { color: "rgba(255,255,255,0.5)", fontSize: ps(0.95), lineHeight: ps(1.4), marginBottom: 18, fontFamily: THEME.fonts.regular },
  modalMetaRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  modalBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.05)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  modalBadgeText: { color: "#fff", fontSize: ps(0.85), fontWeight: "700", fontFamily: THEME.fonts.bold },
  // ── Play-modal buttons: gradient acts as the border ──
  modalBtnWrapper: { borderRadius: 12, overflow: "visible" },
  modalBtnBorder: { padding: 1.5, borderRadius: 12 },
  modalBtnBorderFocused: {
    padding: 2.5,
    shadowColor: THEME.colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 14,
    elevation: 14,
  },
  modalBtnPrimaryInner: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "transparent" },
  modalBtnSecondaryInner: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#0d0d12" },
  modalBtnPrimaryText: { color: "#fff", fontSize: ps(0.95), fontWeight: "900", letterSpacing: 1, fontFamily: THEME.fonts.bold },
  modalBtnSecondaryText: { color: "rgba(255,255,255,0.85)", fontSize: ps(0.9), fontWeight: "700", letterSpacing: 0.5, fontFamily: THEME.fonts.bold },
  loadMoreFooter: { paddingVertical: ph(3), alignItems: "center", justifyContent: "center" },
  loadMoreBtn: { flexDirection: "row", alignItems: "center", gap: pw(0.8), paddingHorizontal: pw(3), paddingVertical: ph(1.4), backgroundColor: "rgba(255,255,255,0.06)", borderRadius: ps(1), borderWidth: 2, borderColor: "transparent" },
  loadMoreBtnFocused: { borderColor: "#fff", backgroundColor: THEME.colors.primary, shadowColor: THEME.colors.primary, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 12, elevation: 12 },
  loadMoreBtnText: { color: "#fff", fontSize: ps(1), fontWeight: "900", letterSpacing: 1.5, fontFamily: THEME.fonts.bold },
});

// ─────────────────────────────────────────────
// Movie Item Component (Premium Design)
// ─────────────────────────────────────────────
const MovieItem = React.memo(function MovieItem({
  item,
  onPress,
  onFocus,
  onFavoritePress,
  isFavorite,
  itemWidth,
  autoFocus,
}: {
  item: VODItem;
  onPress: (item: VODItem) => void;
  onFocus?: (item: VODItem) => void;
  onFavoritePress: (item: VODItem) => void;
  isFavorite: boolean;
  itemWidth: number;
  autoFocus?: boolean;
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
        hasTVPreferredFocus={autoFocus}
        ringOnFocus={false}
      >
        {(focused) => (
          <LinearGradient
            colors={focused
              ? [THEME.colors.primary, THEME.colors.secondary]
              : ["transparent", "transparent"]
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[
              S.cardBorder,
              focused && S.cardBorderFocused,
              focused && {
                transform: [{ scale: 1.06 }],
                shadowColor: THEME.colors.primary,
                shadowOffset: { width: 0, height: 6 },
                shadowOpacity: 0.6,
                shadowRadius: 10,
                elevation: 14,
              }
            ]}
          >
            <View style={S.vodItem}>
              <View style={S.posterContainer}>
                {item.logo ? (
                  <Image source={{ uri: item.logo }} style={S.poster} contentFit="cover" />
                ) : (
                  <View style={S.posterPlaceholder}>
                    <MaterialCommunityIcons name="movie-outline" size={ps(3)} color="rgba(255,255,255,0.15)" />
                  </View>
                )}

                {isFavorite && (
                  <View style={S.favoriteBtn}>
                    <Ionicons name="heart" size={ps(1.1)} color="#ff2d55" />
                  </View>
                )}
              </View>

              <View style={S.cardContent}>
                <Text style={S.vodTitle} numberOfLines={1}>{item.name}</Text>
                <View style={S.metaRow}>
                  {item.year ? <Text style={S.vodMetaText}>{item.year}</Text> : null}
                  {item.year && item.rating ? <View style={S.metaDot} /> : null}
                  {item.rating ? (
                    <View style={S.ratingWrapper}>
                      <Ionicons name="star" size={ps(0.7)} color="#FFD700" style={{ marginRight: 2 }} />
                      <Text style={S.ratingText}>{item.rating}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
          </LinearGradient>
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

const pickDescription = (v: any) =>
  v?.description ?? v?.descr ?? v?.plot ?? v?.info ?? v?.storyline ?? v?.short_description ?? "";

// ─────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────
export default function VODScreen() {
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
    vodItems,
    setVodItems,
    categories,
    setCategories,
  } = usePortalStore();

  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [focusedImage, setFocusedImage] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchResults, setSearchResults] = useState<VODItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // Trap focus briefly during load-more append so the focus
  // engine doesn't fall back to the sidebar while FlatList reconciles.
  const [trappingFocus, setTrappingFocus] = useState(false);
  const trapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trapFocusBriefly = useCallback(() => {
    setTrappingFocus(true);
    if (trapTimeoutRef.current) clearTimeout(trapTimeoutRef.current);
    trapTimeoutRef.current = setTimeout(() => setTrappingFocus(false), 800);
  }, []);
  useEffect(() => () => {
    if (trapTimeoutRef.current) clearTimeout(trapTimeoutRef.current);
  }, []);



  const PAGE_SIZE = 28;

  const numColumns = isTV ? 5 : (SCREEN_WIDTH_VAL >= 768 ? 4 : 3);
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
  const [playModalVisible, setPlayModalVisible] = useState(false);
  const [selectedVod, setSelectedVod] = useState<VODItem | null>(null);
  const searchInputRef = useRef<TextInput>(null);

  const xtreamApiRef = useRef<XtreamApi | null>(null);
  const allVodCacheRef = useRef<VODItem[]>([]);
  // The current category's full filtered list — store/FlatList only see the
  // first N pages of this.
  const fullListRef = useRef<VODItem[]>([]);
  const prevCategoryIdRef = useRef<string | undefined>(undefined);
  // Track last focused VOD id so we can restore focus after refresh
  const focusedIdRef = useRef<string>("");
  const flatListRef = useRef<FlatList>(null);

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
    loadVodItems(undefined, 1, true);
  }, [activePortal?.id]);

  useEffect(() => {
    if (!activePortal || prevCategoryIdRef.current === selectedCategory) return;
    setPage(1);
    prevCategoryIdRef.current = selectedCategory;

    if (activePortal.type === "xtream" || activePortal.type === "m3u") {
      const cat = selectedCategory === "all" ? undefined : selectedCategory;
      const filtered = !cat
        ? allVodCacheRef.current
        : allVodCacheRef.current.filter(v => String(v.categoryId) === String(cat));
      fullListRef.current = filtered;
      const sliced = filtered.slice(0, PAGE_SIZE);
      setVodItems(sliced);
      setHasMore(filtered.length > sliced.length);
      setIsLoading(false);
    } else {
      setHasMore(true);
      loadVodItems(selectedCategory, 1, true);
    }
  }, [selectedCategory]);

  const loadCategories = async () => {
    if (!activePortal) return;
    try {
      let cats: Category[] = [];
      if (activePortal.type === "m3u") {
        cats = await new M3UApi({ url: activePortal.config.url }).getVodCategories();
      } else if (activePortal.type === "xtream") {
        cats = await xtreamApiRef.current!.getVodCategories();
      } else {
        cats = await portalApi.getVodCategories(activePortal);
      }
      // Read live state at call-time to avoid overwriting live/series categories
      const currentCategories = usePortalStore.getState().categories || [];
      const others = currentCategories.filter(c => c.type !== "vod");
      setCategories([...others, ...(Array.isArray(cats) ? cats : [])]);
    } catch (e) {
      console.error(e);
      // On error, do NOT clear categories — leave existing ones intact
    }
  };

  const loadVodItems = async (categoryId?: string, pageNum: number = 1, reset: boolean = false) => {
    if (!activePortal || loadingMore || (!hasMore && !reset)) return;
    try {
      reset ? setIsLoading(true) : setLoadingMore(true);
      let items: VODItem[] = [];
      const cat = !categoryId || categoryId === "all" ? undefined : categoryId;

      if (activePortal.type === "m3u") {
        if (allVodCacheRef.current.length === 0) {
          items = await new M3UApi({ url: activePortal.config.url }).getVodItems(undefined);
          allVodCacheRef.current = Array.isArray(items) ? items : [];
        }
        const filtered = !cat
          ? allVodCacheRef.current
          : allVodCacheRef.current.filter(v => String(v.categoryId) === String(cat));
        fullListRef.current = filtered;
        const sliced = filtered.slice(0, pageNum * PAGE_SIZE);
        if (!reset) trapFocusBriefly();
        setVodItems(sliced);
        setHasMore(filtered.length > sliced.length);
        setPage(pageNum);
        if (reset) restoreFocusPosition(sliced);
      } else if (activePortal.type === "xtream") {
        if (allVodCacheRef.current.length === 0) {
          const all = await xtreamApiRef.current!.getVodItems(undefined, 1, 100000);
          allVodCacheRef.current = Array.isArray(all) ? all : [];
        }
        const filtered = !cat
          ? allVodCacheRef.current
          : allVodCacheRef.current.filter(v => String(v.categoryId) === String(cat));
        fullListRef.current = filtered;
        const sliced = filtered.slice(0, pageNum * PAGE_SIZE);
        if (!reset) trapFocusBriefly();
        setVodItems(sliced);
        setHasMore(filtered.length > sliced.length);
        setPage(pageNum);
        if (reset) restoreFocusPosition(sliced);
      } else {
        // MAG / Stalker: server-side pagination
        const fresh = await portalApi.getVodItems(activePortal, cat, pageNum);
        items = Array.isArray(fresh) ? fresh : [];
        const current = usePortalStore.getState().vodItems;
        const updatedList = reset
          ? items
          : [...current, ...items.filter(i => !current.find(v => v.id === i.id))];
        if (!reset) trapFocusBriefly();
        setVodItems(updatedList);
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
      allVodCacheRef.current = [];
      fullListRef.current = [];
    }
    await loadVodItems(selectedCategory, 1, true);
    setRefreshing(false);
  }, [selectedCategory, activePortal]);

  const handleVodPress = useCallback(async (vod: VODItem) => {
    setSelectedVod(vod);
    setPlayModalVisible(true);
  }, []);

  const handleVodFocus = useCallback((vod: VODItem) => {
    setFocusedImage(vod.logo || null);
    focusedIdRef.current = String(vod.id);
  }, []);

  // After a refresh/reset, scroll the list back to the previously focused item
  const restoreFocusPosition = useCallback((items: VODItem[]) => {
    if (!focusedIdRef.current || !flatListRef.current) return;
    // With multi-column grids, scrollToIndex needs the flat index
    const idx = items.findIndex(v => String(v.id) === focusedIdRef.current);
    if (idx > 0) {
      setTimeout(() => {
        try {
          flatListRef.current?.scrollToIndex({ index: idx, animated: false, viewPosition: 0.3 });
        } catch { /* ignore if out of range */ }
      }, 120);
    }
  }, []);

  const handleFavoritePress = useCallback((vod: VODItem) => {
    toggleFavorite("vod", vod.id);
  }, [toggleFavorite]);

  const startPlayback = async (url: string | null, isExternal: boolean = false, title?: string) => {
    if (!url) { Alert.alert("Error", "No stream URL found"); return; }
    setPlayModalVisible(false);
    try {
      if (isExternal) {
        launchExternalPlayer({ url, title: title || selectedVod?.name || "Movie" });
      } else {
        router.push({ pathname: "/player", params: { url, title: title || selectedVod?.name || "Movie", type: "vod" } });
      }
    } catch (err) {
      console.error("Playback launch error:", err);
      Alert.alert("Error", "Failed to start playback. Make sure a video player app is installed.");
    }
  };

  const handleModalAction = async (isExternal: boolean) => {
    if (!selectedVod) return;
    const titleSnapshot = selectedVod.name;
    let streamUrl: string | undefined = selectedVod.streamUrl;

    try {
      if (activePortal?.type === "mag") {
        const cmd = streamUrl;
        if (cmd) {
          const resolved = await portalApi.getStreamUrl(activePortal, cmd, "vod");
          if (resolved) streamUrl = resolved;
        }
      }
    } catch (e) {
      console.warn("Stream URL resolution failed:", e);
    }

    if (!streamUrl) {
      Alert.alert("Error", "Could not resolve a playable stream URL for this title.");
      return;
    }

    startPlayback(streamUrl, isExternal, titleSnapshot);
  };

  const renderMovieItem = useCallback(({ item, index }: { item: VODItem; index: number }) => (
    <MovieItem
      item={item}
      onPress={handleVodPress}
      onFocus={handleVodFocus}
      onFavoritePress={handleFavoritePress}
      isFavorite={favorites.vod.includes(item.id)}
      itemWidth={itemWidth}
      autoFocus={
        focusedIdRef.current
          ? String(item.id) === focusedIdRef.current
          : index === 0 && !searchFocused
      }
    />
  ), [favorites.vod, itemWidth, searchFocused]);



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
        const apiResults = await portalApi.search(activePortal, debouncedQuery, "vod");
        if (!isMounted) return;
        const mapped = apiResults.map(i => ({
          id: String(i.id || i.cmd || ""),
          streamUrl: i.cmd || "",
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
  const filteredMovies = useMemo(() => {
    if (debouncedQuery) {
      if (isXtreamOrM3U) {
        return allVodCacheRef.current
          .filter(v => v.name.toLowerCase().includes(debouncedQuery.toLowerCase()))
          .slice(0, 100);
      } else {
        return searchResults;
      }
    }

    // Default: return the category-filtered and paginated items
    return vodItems;
  }, [vodItems, debouncedQuery, isXtreamOrM3U, searchResults]);

  const sidebarCategories: Category[] = [
    { id: "all", name: "All Movies", type: "vod" },
    ...categories.filter(c =>
      c.type === "vod" &&
      c.name.toLowerCase() !== "all" &&
      c.name.toLowerCase() !== "all movies"
    ),
  ];

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
        <Text style={S.headerTitle}>Movies</Text>
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
                  placeholder="Search movies..."
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
          <Text style={S.countText}>{isLoading ? "..." : String(filteredMovies.length)}</Text>
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
          {isLoading && vodItems.length === 0 ? (
            <View style={S.loadingCenter}>
              <ActivityIndicator color={THEME.colors.primary} size="large" />
              <Text style={S.loadingText}>Brewing cinematic magic...</Text>
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              onScrollToIndexFailed={() => {}}
              data={filteredMovies}
              renderItem={renderMovieItem}
              keyExtractor={(item) => String(item.id)}
              numColumns={numColumns}
              key={`vod-grid-${numColumns}`}
              contentContainerStyle={S.list}
              removeClippedSubviews={false}

              initialNumToRender={numColumns * 6}
              maxToRenderPerBatch={numColumns * 6}
              windowSize={11}
              onEndReached={() => {
                if (isLoading || loadingMore || !hasMore || debouncedQuery) return;
                trapFocusBriefly();
                if (isXtreamOrM3U) {
                  // Grow the slice from the cached full list — no network.
                  const nextPage = page + 1;
                  const sliced = fullListRef.current.slice(0, nextPage * PAGE_SIZE);
                  setVodItems(sliced);
                  setPage(nextPage);
                  setHasMore(fullListRef.current.length > sliced.length);
                } else {
                  loadVodItems(selectedCategory, page + 1);
                }
              }}
              onEndReachedThreshold={1.5}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
              ListEmptyComponent={
                isLoading ? (
                  <View style={{ flex: 1, paddingVertical: ph(10), justifyContent: "center", alignItems: "center" }}>
                    <ActivityIndicator color={THEME.colors.primary} size="large" />
                    <Text style={[S.loadingText, { marginTop: 10 }]}>Searching...</Text>
                  </View>
                ) : (
                  <View style={S.emptyState}>
                    <MaterialCommunityIcons name="movie-filter-outline" size={ps(4)} color="rgba(255,255,255,0.05)" />
                    <Text style={S.emptyTitle}>Nothing Found</Text>
                  </View>
                )
              }
              ListFooterComponent={
                loadingMore && filteredMovies.length > 0 ? (
                  <View style={{ width: "100%", paddingVertical: ph(3), alignItems: "center", justifyContent: "center", flexDirection: "row", gap: pw(1) }}>
                    <ActivityIndicator color={THEME.colors.primary} size="small" />
                    <Text style={{ color: "rgba(255,255,255,0.3)", fontSize: ps(0.9) }}>Loading more...</Text>
                  </View>
                ) : (hasMore && filteredMovies.length > 0 && !debouncedQuery) ? (
                  <View style={S.loadMoreFooter}>
                    <Focusable
                      onPress={() => {
                        const nextPage = page + 1;
                        if (isXtreamOrM3U) {
                          const sliced = fullListRef.current.slice(0, nextPage * PAGE_SIZE);
                          setVodItems(sliced);
                          setPage(nextPage);
                          setHasMore(fullListRef.current.length > sliced.length);
                        } else {
                          loadVodItems(selectedCategory, nextPage);
                        }
                      }}
                      ringOnFocus={false}
                      focusStyle={S.loadMoreBtnFocused}
                      style={S.loadMoreBtn}
                    >
                      <Ionicons name="chevron-down" size={ps(1.4)} color="#fff" />
                      <Text style={S.loadMoreBtnText}>LOAD MORE</Text>
                    </Focusable>
                  </View>
                ) : null
              }
            />
          )}
        </FocusGroup>
      </View>

      <Overlay
        visible={playModalVisible}
        onClose={() => setPlayModalVisible(false)}
        contentStyle={S.modalContainer}
      >
        <View style={isTV ? S.modalTVContent : null}>
          <View style={S.modalLeft}>
            <Text style={S.modalTitle} numberOfLines={2}>{selectedVod?.name}</Text>
            <Text style={S.modalDescription} numberOfLines={isTV ? 8 : 5}>
              {selectedVod?.description || "Custom"}
            </Text>
            <View style={S.modalMetaRow}>
              {selectedVod?.rating && (
                <View style={S.modalBadge}>
                  <Ionicons name="star" size={ps(1)} color="#FFD700" />
                  <Text style={S.modalBadgeText}>{selectedVod.rating}</Text>
                </View>
              )}
              {selectedVod?.year && (
                <View style={S.modalBadge}>
                  <Ionicons name="calendar-outline" size={ps(1)} color="#fff" />
                  <Text style={S.modalBadgeText}>{selectedVod.year}</Text>
                </View>
              )}
            </View>
          </View>

          <View style={S.modalRight}>
            <Focusable
              hasTVPreferredFocus
              ringOnFocus={false}
              onPress={() => handleModalAction(false)}
              style={S.modalBtnWrapper}
            >
              {(focused) => (
                <LinearGradient
                  colors={[THEME.colors.primary, THEME.colors.secondary]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[S.modalBtnBorder, focused && S.modalBtnBorderFocused]}
                >
                  <View style={S.modalBtnPrimaryInner}>
                    <Text style={S.modalBtnPrimaryText}>WATCH NOW</Text>
                  </View>
                </LinearGradient>
              )}
            </Focusable>
            <Focusable
              ringOnFocus={false}
              onPress={() => handleModalAction(true)}
              style={S.modalBtnWrapper}
            >
              {(focused) => (
                <LinearGradient
                  colors={focused
                    ? [THEME.colors.primary, THEME.colors.secondary]
                    : ["rgba(255,255,255,0.18)", "rgba(255,255,255,0.04)"]
                  }
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[S.modalBtnBorder, focused && S.modalBtnBorderFocused]}
                >
                  <View style={S.modalBtnSecondaryInner}>
                    <Text style={S.modalBtnSecondaryText}>EXTERNAL PLAYER</Text>
                  </View>
                </LinearGradient>
              )}
            </Focusable>
            <Focusable
              ringOnFocus={false}
              onPress={() => setPlayModalVisible(false)}
              style={S.modalBtnWrapper}
            >
              {(focused) => (
                <LinearGradient
                  colors={focused
                    ? [THEME.colors.primary, THEME.colors.secondary]
                    : ["rgba(255,255,255,0.18)", "rgba(255,255,255,0.04)"]
                  }
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[S.modalBtnBorder, focused && S.modalBtnBorderFocused]}
                >
                  <View style={S.modalBtnSecondaryInner}>
                    <Text style={S.modalBtnSecondaryText}>CLOSE</Text>
                  </View>
                </LinearGradient>
              )}
            </Focusable>
          </View>
        </View>
      </Overlay>
    </View>
  );
}