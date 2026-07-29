import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  StatusBar,
  TextInput,
  RefreshControl,
  FlatList,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";

import { usePortalStore, Channel, Category } from "../src/store/portalStore";
import { portalApi } from "../src/services/portalApi";
import { M3UApi } from "../src/services/m3uApi";
import { XtreamApi } from "../src/services/xtreamApi";
import { StreamManager } from "../src/services/StreamManager";
import { THEME, pw, ph, ps } from "../src/theme/tokens";
import { isTV } from "../src/utils/tvUtils";
import { CinematicBackground, updateCinematicBackground } from "../src/components/CinematicBackground";
import CategorySidebar from "../src/components/CategorySidebar";
import { Focusable, FocusGroup, FocusMemory, useFocusRestore } from "../src/tv";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

/** Namespace for this screen's focus memory. */
const SCREEN_KEY = "live-tv";

// ─────────────────────────────────────────────
// Channel Card — single Focusable, no per-item TVEventHandler
// ─────────────────────────────────────────────
const ChannelCard = React.memo(function ChannelCard({
  item,
  index,
  onPress,
  onFocus,
  isFocusedItem,
  itemWidth,
}: {
  item: Channel;
  index?: number;
  onPress: (item: Channel) => void;
  onFocus?: (item: Channel, index?: number) => void;
  isFocusedItem?: boolean;
  itemWidth: number;
}) {
  const handlePress = useCallback(() => {
    onPress(item);
  }, [onPress, item]);

  const handleFocus = useCallback(() => {
    onFocus?.(item, index);
  }, [onFocus, item, index]);



  return (
    <View style={{ width: itemWidth, padding: pw(0.6) }}>
      <Focusable
        onPress={handlePress}
        onFocus={handleFocus}
        hasTVPreferredFocus={isFocusedItem}
        ringOnFocus={false}
        style={S.cardWrapper}
        screenKey={SCREEN_KEY}
        focusKey={String(item.id)}
        accessibilityLabel={item.category ? `${item.name}, ${item.category}` : item.name}
      >
        {(focused) => (
          <View
            style={[
              S.cardBorder,
              { height: Math.floor(itemWidth / 0.85) },
              focused && S.cardBorderFocused,
              focused && { transform: [{ scale: 1.06 }], backgroundColor: "#fff", borderColor: "#fff", borderWidth: 1 }
            ]}
          >
            <LinearGradient 
              colors={
                focused
                  ? ["transparent", "transparent"] // Background is handled by wrapper when focused
                  : ["rgba(255,255,255,0.05)", "rgba(255,255,255,0.01)"]
              }
              style={[
                S.card, 
                focused && { backgroundColor: "transparent" },
                { overflow: "hidden" }
              ]}
            >
              <View style={S.cardLogoWrapper}>
                {item.logo ? (
                  <Image source={{ uri: item.logo }} style={S.cardLogo} contentFit="contain" cachePolicy="memory-disk" />
                ) : (
                  <Ionicons name="tv-outline" size={ps(2)} color="rgba(255,255,255,0.15)" />
                )}
              </View>
              <View style={S.cardInfo}>
                <Text style={[S.cardTitle, focused && { color: "#000" }]} numberOfLines={2}>{item.name}</Text>
                {item.category ? (
                  <Text style={[S.cardCategory, focused && { color: "rgba(0,0,0,0.6)" }]} numberOfLines={1}>{item.category}</Text>
                ) : null}
              </View>
            </LinearGradient>
          </View>
        )}
      </Focusable>
    </View>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.isFocusedItem === nextProps.isFocusedItem &&
    prevProps.itemWidth === nextProps.itemWidth
  );
});

// ─────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────
export default function LiveTVScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const safeGoBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/dashboard");
  }, [router]);

  const {
    channels: storeChannels,
    categories: storeCategories,
    activePortal,
    setChannels,
    setCategories,
  } = usePortalStore();

  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const [isLoading, setIsLoading] = useState(storeChannels.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // While appending more rows, FlatList briefly detaches the focused cell
  // during reconciliation. The native focus engine then falls back to the
  // nearest focusable ancestor — i.e. the sidebar, which sits to the left in
  // the row layout. We trap leftward focus for ~600ms so focus stays inside
  // the grid until the new cells settle.
  const [trappingFocus, setTrappingFocus] = useState(false);
  const trapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<TextInput>(null);
  // Track last focused channel id so we can restore focus after refresh
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



  const localCategories = useMemo(
    () => (storeCategories || []).filter(c => c.type === "live"),
    [storeCategories]
  );

  const numColumns = isTV ? 5 : (SCREEN_WIDTH >= 1024 ? 5 : (SCREEN_WIDTH >= 768 ? 4 : 3));
  const PAGE_SIZE = numColumns * Math.ceil(28 / numColumns);

  const xtreamApiRef = useRef<XtreamApi | null>(null);
  // Raw, unfiltered cache (Xtream / M3U).
  const allChannelsCacheRef = useRef<Channel[]>([]);
  // The current category's full filtered list — store/FlatList only see the
  // first N pages of this.
  const fullListRef = useRef<Channel[]>([]);
  const prevCategoryIdRef = useRef<string | undefined>(undefined);

  // ── Load Categories ──
  // NOTE: Read current categories from store at call-time (not closure)
  // to avoid stale-closure bugs when the store is cleared/evicted.
  const loadCategories = useCallback(async () => {
    if (!activePortal) return;
    try {
      let cats: Category[] = [];
      if (activePortal.type === "m3u") {
        const api = new M3UApi({ url: activePortal.config.url, portalId: activePortal.id });
        cats = ((await api.getLiveCategories()) || []) as Category[];
      } else if (activePortal.type === "xtream") {
        const raw = (await xtreamApiRef.current!.getitvCategories()) || [];
        cats = raw.map((c: any) => ({ id: c.id, name: c.name, type: "live" as const }));
      } else {
        cats = (await portalApi.getLiveCategories(activePortal)) || [];
      }
      // Read live state at call-time to avoid stale closure wiping non-live categories
      const currentCategories = usePortalStore.getState().categories || [];
      const others = currentCategories.filter(c => c.type !== "live");
      setCategories([...others, ...cats]);
    } catch (e) {
      console.warn("loadCategories error:", e);
    }
  }, [activePortal, setCategories]);

  // ── Load Channels (mirrors VOD/Series pattern) ──
  const loadChannels = useCallback(async (
    categoryId?: string,
    pageNum: number = 1,
    reset: boolean = false
  ) => {
    if (!activePortal) return;
    if (loadingMore && !reset) return;
    if (!hasMore && !reset) return;

    try {
      reset ? setIsLoading(true) : setLoadingMore(true);
      let list: Channel[] = [];
      const cat = !categoryId || categoryId === "all" || categoryId === "*" ? undefined : categoryId;

      if (activePortal.type === "m3u") {
        if (allChannelsCacheRef.current.length === 0) {
          if (storeChannels.length > 0) {
            allChannelsCacheRef.current = storeChannels;
          }
          const api = new M3UApi({ url: activePortal.config.url, portalId: activePortal.id });
          const raw = (await api.getLiveChannels(undefined, 1, 100000)) || [];
          if (Array.isArray(raw) && raw.length > 0) {
            allChannelsCacheRef.current = raw.map((c: any) => ({
              id: String(c.id),
              name: c.name,
              logo: c.logo,
              category: c.category,
              categoryId: c.categoryId ?? c.category,
              streamUrl: c.streamUrl,
            }));
          }
        }
        const filtered = !cat
          ? allChannelsCacheRef.current
          : allChannelsCacheRef.current.filter(c => String(c.categoryId) === String(cat));
        fullListRef.current = filtered;
        list = filtered.slice(0, pageNum * PAGE_SIZE);
        setHasMore(filtered.length > list.length);
      } else if (activePortal.type === "xtream") {
        if (allChannelsCacheRef.current.length === 0) {
          if (storeChannels.length > 0) {
            allChannelsCacheRef.current = storeChannels;
          }
          const all = (await xtreamApiRef.current!.getitvChannels(undefined, 1, 100000)) || [];
          if (Array.isArray(all) && all.length > 0) {
            allChannelsCacheRef.current = all;
          }
        }
        const filtered = !cat
          ? allChannelsCacheRef.current
          : allChannelsCacheRef.current.filter(c => String(c.categoryId) === String(cat));
        fullListRef.current = filtered;
        list = filtered.slice(0, pageNum * PAGE_SIZE);
        setHasMore(filtered.length > list.length);
      } else {
        const fresh = (await portalApi.getLiveChannels(activePortal, cat, pageNum)) || [];
        const current = usePortalStore.getState().channels;
        if (reset) {
          // A failed/empty refresh should never blank a screen that already has data.
          list = fresh.length > 0 || current.length === 0 ? fresh : current;
        } else {
          list = [...current, ...fresh.filter(i => !current.find(c => c.id === i.id))];
        }
        setHasMore(fresh.length > 0);
      }

      list = Array.isArray(list) ? list : [];
      setChannels(list);
      setPage(pageNum);
      // Restore scroll position after a reset-load so focus doesn't snap to top
      if (reset) restoreFocusPosition(list);
    } catch (err) {
      console.warn("Live TV Data Fetch Error:", err);
    } finally {
      setIsLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
    }
  }, [activePortal, loadingMore, hasMore, setChannels]);

  // Initial load
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
  }, [activePortal?.id]);

  // Category change — Xtream/M3U slice the cached full list; MAG hits the API.
  useEffect(() => {
    if (!activePortal || prevCategoryIdRef.current === selectedCategory) return;
    setIsLoading(true);
    setPage(1);
    prevCategoryIdRef.current = selectedCategory;
    focusedIdRef.current = "";
    // A remembered tile from the previous category is not in the new list.
    FocusMemory.forget(SCREEN_KEY);

    const timer = setTimeout(() => {
      if (activePortal.type === "xtream" || activePortal.type === "m3u") {
        if (allChannelsCacheRef.current.length > 0) {
          const isAll = !selectedCategory || selectedCategory === "all" || selectedCategory === "*";
          const cat = isAll ? undefined : selectedCategory;
          const filtered = !cat
            ? allChannelsCacheRef.current
            : allChannelsCacheRef.current.filter(c => String(c.categoryId) === String(cat));
          fullListRef.current = filtered;
          const sliced = filtered.slice(0, PAGE_SIZE);
          setChannels(sliced);
          setHasMore(filtered.length > sliced.length);
          setIsLoading(false);
        } else {
          setHasMore(true);
          loadChannels(selectedCategory, 1, true);
        }
      } else {
        setHasMore(true);
        loadChannels(selectedCategory, 1, true);
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [selectedCategory]);

  // Channel press
  const handleChannelPress = useCallback(async (channel: Channel) => {
    if (!activePortal || !channel.streamUrl) return;
    try {
      let url = channel.streamUrl;
      if (activePortal.type === "mag") {
        const result = await StreamManager.getStreamUrl(channel, activePortal, "itv");
        if (result.success && result.url) url = result.url;
      }
      router.push({ pathname: "/player", params: { url, title: channel.name, type: "live", contentId: channel.id, cmd: channel.streamUrl } });
    } catch {
      router.push({ pathname: "/player", params: { url: channel.streamUrl || "", title: channel.name, type: "live" } });
    }
  }, [activePortal, router]);

  const totalCountRef = useRef(0);
  const onEndReachedRef = useRef<() => void>(() => {});

  const handleChannelFocus = useCallback((channel: Channel, index?: number) => {
    updateCinematicBackground(channel.logo || null);
    focusedIdRef.current = String(channel.id);

    if (index !== undefined && totalCountRef.current > 0 && index >= totalCountRef.current - 12) {
      onEndReachedRef.current();
    }
  }, []);

  // After a refresh/reset, scroll the list back to the previously focused item
  const restoreFocusPosition = useCallback((list: Channel[]) => {
    if (!focusedIdRef.current || !flatListRef.current) return;
    const idx = list.findIndex(c => String(c.id) === focusedIdRef.current);
    if (idx > 0) {
      setTimeout(() => {
        try {
          flatListRef.current?.scrollToIndex({ index: idx, animated: false, viewPosition: 0.3 });
        } catch { /* ignore if out of range */ }
      }, 120);
    }
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(1);
    setHasMore(true);
    if (activePortal?.type === "xtream") allChannelsCacheRef.current = [];
    await loadCategories();
    await loadChannels(selectedCategory, 1, true);
    setRefreshing(false);
  }, [selectedCategory, activePortal, loadChannels, loadCategories]);

  const onEndReached = useCallback(() => {
    if (isLoading || loadingMore || !hasMore) return;

    // Hold focus inside the grid while the new cells reconcile so the focus
    // engine doesn't fall back to the sidebar.
    trapFocusBriefly();

    if (activePortal?.type === "xtream" || activePortal?.type === "m3u") {
      // Grow the slice from the cached full list — no network.
      const nextPage = page + 1;
      const sliced = fullListRef.current.slice(0, nextPage * PAGE_SIZE);
      setChannels(sliced);
      setPage(nextPage);
      setHasMore(fullListRef.current.length > sliced.length);
      return;
    }

    // MAG: fetch the next server page.
    loadChannels(selectedCategory, page + 1, false);
  }, [isLoading, loadingMore, hasMore, selectedCategory, page, loadChannels, activePortal, setChannels, trapFocusBriefly]);

  useEffect(() => {
    onEndReachedRef.current = onEndReached;
  }, [onEndReached]);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);


  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // ── Filter ──
  // When searching on Xtream/M3U: search across fullListRef (uncapped).
  // Otherwise: show the paginated store list (respecting category + search).
  const filteredChannels = useMemo(() => {
    const isXtreamOrM3U = activePortal?.type === "xtream" || activePortal?.type === "m3u";

    // Pick the right source
    let source: typeof storeChannels;
    if (debouncedQuery && isXtreamOrM3U) {
      source = fullListRef.current;           // full current-category list
    } else {
      source = storeChannels;                 // paginated store slice
    }

    return source.filter(c => {
      // Category filter (skip for Xtream/M3U search – fullListRef is already category-filtered)
      const matchByCategory =
        (debouncedQuery && isXtreamOrM3U)
          ? true
          : selectedCategory === "all" || selectedCategory === "*" || String(c.categoryId) === String(selectedCategory);

      const matchBySearch =
        !debouncedQuery || c.name.toLowerCase().includes(debouncedQuery.toLowerCase());

    return matchByCategory && matchBySearch;
    });
  }, [storeChannels, selectedCategory, debouncedQuery, activePortal?.type]);

  const chunkedChannels = useMemo(() => {
    const chunks = [];
    for (let i = 0; i < filteredChannels.length; i += numColumns) {
      chunks.push({
        id: `row-${i}`,
        items: filteredChannels.slice(i, i + numColumns),
      });
    }
    return chunks;
  }, [filteredChannels, numColumns]);

  useEffect(() => {
    totalCountRef.current = filteredChannels.length;
  }, [filteredChannels.length]);

  // Build sidebar categories with "All" at top
  // Restore the exact tile we left from; fall back to the first only when
  // there is no memory for this category.
  const autoFocusFirst = useFocusRestore(
    SCREEN_KEY,
    !isLoading && chunkedChannels.length > 0,
    selectedCategory
  );

  const sidebarCategories: Category[] = [
    { id: "all", name: "All Channels", type: "live" },
    ...localCategories.filter(c =>
      c.type === "live" &&
  c.name.toLowerCase() !== "all" &&
      c.name.toLowerCase() !== "all channels"
    ),
  ];

  const SIDEBAR_WIDTH = isTV ? 260 : 220;
  const GRID_H_PADDING = pw(1.5) * 2;
  const SAFETY_MARGIN = 4;
  const itemWidth = Math.floor(
    (SCREEN_WIDTH - SIDEBAR_WIDTH - GRID_H_PADDING - SAFETY_MARGIN) / numColumns
  );
  const ROW_HEIGHT = Math.floor(itemWidth / 0.85) + pw(1.2);
  const getItemLayout = useCallback((_: any, index: number) => ({
    length: ROW_HEIGHT,
    offset: pw(1.5) + index * ROW_HEIGHT,
    index,
  }), [ROW_HEIGHT]);

  return (
    <View style={[S.container, { paddingTop: insets.top }]}>
      <CinematicBackground />
      <StatusBar hidden />

      {/* ─── Header ─── */}
      <View style={S.header}>
        <Focusable
          ringOnFocus={false}
          focusStyle={S.backBtnFocused}
          style={S.backBtn}
          accessibilityLabel="Back"
          onPress={safeGoBack}
        >
          {(focused) => (
            <Ionicons name="chevron-back" size={ps(1.6)} color={focused ? "#000" : "#fff"} />
          )}
        </Focusable>
        <Text style={S.headerTitle}>Live TV</Text>

        <FocusGroup style={S.searchWrapper}>
          <Focusable
            onPress={() => searchInputRef.current?.focus()}
            ringOnFocus={false}
            style={{ flex: 1 }}
          >
            {(focused) => (
              <View style={[S.searchGradient, (focused || searchFocused) && S.searchFocused]}>
            <LinearGradient
              colors={["rgba(255,255,255,0.12)", "rgba(255,255,255,0.06)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[StyleSheet.absoluteFill, { borderRadius: 25 }]}
            />
            {(focused || searchFocused) && (
              <LinearGradient
                colors={[THEME.colors.primary, THEME.colors.secondary]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[StyleSheet.absoluteFill, { borderRadius: 25 }]}
              />
            )}
            <View style={[
              S.searchInner,
              { borderRadius: (focused || searchFocused) ? 25 - 1.5 : 25 },
              (focused || searchFocused) && { backgroundColor: "#0b0b10" }
            ]}>
              <Ionicons name="search" size={ps(1.1)} color={(focused || searchFocused) ? "#fff" : "rgba(255,255,255,0.3)"} style={{ marginRight: pw(1) }} />
              <TextInput
                ref={searchInputRef}
                style={S.searchInput}
                placeholder="Search channels..."
                placeholderTextColor="rgba(255,255,255,0.2)"
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
              />
            </View>
          </View>
            )}
          </Focusable>
        </FocusGroup>

        <View style={S.countBadge}>
          <Text style={S.countText}>
            {isLoading ? "..." : String(filteredChannels.length)}
          </Text>
        </View>
      </View>

      {/* ─── Body: Sidebar + Grid ─── */}
      <View style={S.body}>
        {/* Left sidebar */}
        <FocusGroup style={{ width: SIDEBAR_WIDTH }}>
          <CategorySidebar
            categories={sidebarCategories}
            selectedId={selectedCategory}
            onSelect={setSelectedCategory}
            width={SIDEBAR_WIDTH}
          />
        </FocusGroup>

        {/* Right channel grid */}
        <FocusGroup style={S.gridArea} trapLeft={trappingFocus} trapUp={trappingFocus}>
          <FlatList
            data={chunkedChannels}
            keyExtractor={(item) => item.id}
            getItemLayout={getItemLayout}
            onEndReached={onEndReached}
            onEndReachedThreshold={0.5}
            removeClippedSubviews={Platform.OS === "android"}
            contentContainerStyle={[S.gridContent, (isLoading || chunkedChannels.length === 0) && { flexGrow: 1 }]}
            extraData={filteredChannels.length}
            initialNumToRender={isTV ? 8 : 6}
            maxToRenderPerBatch={isTV ? 6 : 4}
            windowSize={5}
            updateCellsBatchingPeriod={50}
            ref={flatListRef}
            renderItem={useCallback(({ item: row, index: rowIndex }: { item: { id: string; items: Channel[] }; index: number }) => (
              <FocusGroup style={{ flexDirection: "row" }}>
                {row.items.map((channel, colIndex) => {
                  const itemIndex = rowIndex * numColumns + colIndex;
                  return (
                    <ChannelCard
                      key={channel.id}
                      item={channel}
                      index={itemIndex}
                      itemWidth={itemWidth}
                      isFocusedItem={autoFocusFirst && itemIndex === 0 && !searchFocused}
                      onPress={handleChannelPress}
                      onFocus={handleChannelFocus}
                    />
                  );
                })}
              </FocusGroup>
            ), [itemWidth, searchFocused, numColumns, autoFocusFirst, handleChannelPress, handleChannelFocus])}
            ListEmptyComponent={
              isLoading ? (
                <View style={{ flex: 1, paddingVertical: ph(10), justifyContent: "center", alignItems: "center" }}>
                  <ActivityIndicator color={THEME.colors.primary} size="large" />
                  <Text style={[S.loadingText, { marginTop: 10 }]}>Loading channels...</Text>
                </View>
              ) : (
                <View style={S.emptyState}>
                  <Ionicons name="tv-outline" size={64} color="rgba(255,255,255,0.08)" />
                  <Text style={S.emptyTitle}>No Channels Found</Text>
                  <Text style={S.emptySubtitle}>
                    {searchQuery ? "Try a different search term" : "No channels in this category"}
                  </Text>
                </View>
              )
            }
            ListFooterComponent={
              loadingMore && filteredChannels.length > 0 ? (
                <View style={S.loadingMore}>
                  <ActivityIndicator color={THEME.colors.primary} size="small" />
                  <Text style={S.loadingMoreText}>Loading more...</Text>
                </View>
              ) : null
            }
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={THEME.colors.primary}
              />
            }
          />
        </FocusGroup>
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },

  // ── Header ──
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
  backBtn: {
    width: ps(3.2),
    height: ps(3.2),
    borderRadius: ps(1.6),
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  backBtnFocused: {
    backgroundColor: "#fff",
    transform: [{ scale: 1.1 }],
  },
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
  countText: { color: THEME.colors.primary, fontSize: ps(1), fontWeight: "800" },

  // ── Body ──
  body: {
    flex: 1,
    flexDirection: "row",
  },
  gridArea: {
    flex: 1,
  },

  // ── Cards ──
  gridContent: {
    padding: pw(1.5),
    paddingBottom: ph(4),
  },
  gridRow: {
    justifyContent: "flex-start",
  },
  cardWrapper: {
    aspectRatio: 0.85,
  },
  cardBorder: {
    flex: 1,
    padding: 1,
    borderRadius: ps(1.2),
    backgroundColor: THEME.colors.glassBg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  cardBorderFocused: {
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
  card: {
    flex: 1,
    backgroundColor: "transparent",
    borderRadius: ps(1.1),
    padding: ps(0.7),
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  cardLogoWrapper: {
    width: "65%",
    height: "55%",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: ph(0.6),
  },
  cardLogo: {
    width: "100%",
    height: "100%",
  },
  cardInfo: {
    alignItems: "center",
    width: "100%",
    paddingHorizontal: 4,
  },
  cardTitle: {
    color: "#fff",
    fontSize: ps(0.9),
    fontWeight: "700",
    textAlign: "center",
  },
  cardCategory: {
    color: "rgba(255,255,255,0.28)",
    fontSize: ps(0.72),
    fontWeight: "600",
    textAlign: "center",
    marginTop: 2,
  },

  // ── States ──
  loadingCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: ph(2),
  },
  loadingText: {
    color: "rgba(255,255,255,0.35)",
    fontSize: ps(1),
    fontWeight: "600",
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: ph(12),
    gap: ph(1.5),
  },
  emptyTitle: {
    color: "rgba(255,255,255,0.45)",
    fontSize: ps(1.4),
    fontWeight: "700",
  },
  emptySubtitle: {
    color: "rgba(255,255,255,0.22)",
    fontSize: ps(0.95),
  },
  loadingMore: {
    width: "100%",
    paddingVertical: ph(3),
    alignItems: "center",
    gap: ph(0.8),
    flexDirection: "row",
    justifyContent: "center",
  },
  loadingMoreText: {
    color: "rgba(255,255,255,0.3)",
    fontSize: ps(0.9),
    marginLeft: pw(1),
  },
  loadMoreFooter: {
    paddingVertical: ph(3),
    alignItems: "center",
    justifyContent: "center",
  },
  loadMoreBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(0.8),
    paddingHorizontal: pw(3),
    paddingVertical: ph(1.4),
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: ps(1),
    borderWidth: 2,
    borderColor: "transparent",
  },
  loadMoreBtnFocused: {
    borderColor: "#fff",
    backgroundColor: THEME.colors.primary,
    shadowColor: THEME.colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 12,
    elevation: 12,
  },
  loadMoreBtnText: {
    color: "#fff",
    fontSize: ps(1),
    fontWeight: "900",
    letterSpacing: 1.5,
  },
});