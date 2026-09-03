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
  InteractionManager,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";

import { usePortalStore, Series, Category } from "../src/store/portalStore";
import { portalApi, buildImageUrl } from "../src/services/portalApi";
import { M3UApi } from "../src/services/m3uApi";
import { XtreamApi } from "../src/services/xtreamApi";
import { cacheManager } from "../src/services/cacheManager";
import { THEME, pw, ph, ps, TILE_FRAME, TILE_FRAME_FOCUSED } from "../src/theme/tokens";
import { isTV } from "../src/utils/tvUtils";
import { CinematicBackground, updateCinematicBackground } from "../src/components/CinematicBackground";
import CategorySidebar from "../src/components/CategorySidebar";
import { AppBootManager } from "../src/services/AppBootManager";
import { filterByCategory, useAdoptStoreContent } from "../src/hooks/useCategoryContent";
import { useNetworkActivity } from "../src/services/networkActivity";
import { Focusable, FocusGroup, FocusMemory, useInitialFocusPulse } from "../src/tv";
import { hiddenCategories } from "../src/services/hiddenCategories";
import { parentalControl } from "../src/services/parentalControl";

const { width: SCREEN_WIDTH_VAL } = Dimensions.get("window");

/** Namespace for this screen's focus memory. */
const SCREEN_KEY = "series";

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
  searchGradient: { ...TILE_FRAME, flex: 1, borderRadius: 25 },
  searchGradientFocused: { ...TILE_FRAME_FOCUSED },
  searchInner: {
    flex: 1,
    backgroundColor: "rgba(10, 10, 16, 0.61)",
    borderRadius: 25 - 1,
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
  body: { flex: 1, flexDirection: "row" },
  gridArea: { flex: 1 },
  list: { padding: pw(1), paddingBottom: ph(10) },
  cardBorder: { ...TILE_FRAME },
  cardBorderFocused: { ...TILE_FRAME_FOCUSED },
  seriesItem: { flex: 1, backgroundColor: "transparent", borderRadius: ps(1.1), overflow: "hidden" },
  posterContainer: { flex: 1, backgroundColor: "rgba(255,255,255,0.03)" },
  poster: { width: "100%", height: "100%" },
  posterPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.03)" },
  textOverlay: { display: "none" },
  cardContent: { position: "absolute", bottom: 0, width: "100%", padding: ps(0.8), borderBottomLeftRadius: ps(1.1), borderBottomRightRadius: ps(1.1), overflow: "hidden" },
  seriesTitle: { color: "#fff", fontSize: ps(0.95), fontWeight: "700" },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 6, height: ps(1.6) },
  seriesMetaText: { color: "rgba(255,255,255,0.7)", fontSize: ps(0.8), fontWeight: "600" },
  metaDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: "rgba(255,255,255,0.4)", marginHorizontal: 6 },
  ratingWrapper: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255, 215, 0, 0.15)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  ratingText: { color: "#FFD700", fontSize: ps(0.8), fontWeight: "800", marginLeft: 3 },
  favoriteBtn: { position: "absolute", top: 10, right: 10, backgroundColor: "rgba(0,0,0,0.4)", borderRadius: 12, padding: 6 },
  lockBadge: {
    position: "absolute",
    top: 10,
    left: 10,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 12,
    padding: 6,
  },
  loadingCenter: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { color: "rgba(255,255,255,0.4)", marginTop: 15, fontSize: ps(1), fontFamily: THEME.fonts.regular },
  emptyState: { flex: 1, justifyContent: "center", alignItems: "center", opacity: 0.5 },
  emptyTitle: { color: "#fff", fontSize: ps(1.2), marginTop: 10, fontFamily: THEME.fonts.bold },
  emptySubtitle: { color: "rgba(255,255,255,0.5)", fontSize: ps(0.95), marginTop: 6, textAlign: "center" },
  retryBtn: { marginTop: ph(2) },
  retryInner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: pw(3),
    paddingVertical: ph(1.2),
    borderRadius: ps(1),
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  retryInnerFocused: { backgroundColor: "#fff" },
  retryText: { color: "#fff", fontSize: ps(1), fontWeight: "800", marginLeft: pw(0.6) },
  loadMoreFooter: { paddingVertical: ph(3), alignItems: "center", justifyContent: "center" },
  loadMoreBtn: { flexDirection: "row", alignItems: "center", gap: pw(0.8), paddingHorizontal: pw(3), paddingVertical: ph(1.4), backgroundColor: "rgba(255,255,255,0.06)", borderRadius: ps(1), borderWidth: 1, borderColor: "transparent" },
  loadMoreBtnFocused: { borderColor: "#fff", backgroundColor: THEME.colors.primary, shadowColor: THEME.colors.primary, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 12, elevation: 12 },
  loadMoreBtnText: { color: "#fff", fontSize: ps(1), fontWeight: "900", letterSpacing: 1.5 },
});

// ─────────────────────────────────────────────
// Series Item Component (Premium Design)
// ─────────────────────────────────────────────
const SeriesItem = React.memo(function SeriesItem({
  item,
  index,
  onPress,
  onFocus,
  onFavoritePress,
  isFavorite,
  itemWidth,
  isFocusedItem,
  locked,
}: {
  item: Series;
  index?: number;
  onPress: (item: Series) => void;
  onFocus?: (item: Series, index?: number) => void;
  onFavoritePress: (item: Series) => void;
  isFavorite: boolean;
  itemWidth: number;
  isFocusedItem?: boolean;
  locked?: boolean;
}) {
  const handlePress = useCallback(() => {
    onPress(item);
  }, [onPress, item]);

  const handleFocus = useCallback(() => {
    onFocus?.(item, index);
  }, [onFocus, item, index]);

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
        screenKey={SCREEN_KEY}
        focusKey={String(item.id)}
        accessibilityLabel={item.name}
        accessibilityHint={isFavorite ? "In favourites. Hold to remove" : "Hold to add to favourites"}
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
                  <Image source={{ uri: item.logo }} style={S.poster} contentFit="cover" cachePolicy="memory-disk" />
                ) : (
                  <View style={S.posterPlaceholder}>
                    <Ionicons name="tv-outline" size={ps(3)} color="rgba(255,255,255,0.15)" />
                  </View>
                )}

                {/* Mirrors the film grid: a locked title still shows, so the
                    viewer can see it exists and that it needs the PIN, rather
                    than it silently vanishing. Hiding is the category hider's
                    job — see src/services/hiddenCategories.ts. */}
                {locked ? (
                  <View style={S.lockBadge}>
                    <Ionicons name="lock-closed" size={ps(0.95)} color="#fff" />
                  </View>
                ) : null}

                {isFavorite && (
                  <View style={S.favoriteBtn}>
                    <Ionicons name="heart" size={ps(1.1)} color="#ff2d55" />
                  </View>
                )}
              </View>

              <LinearGradient
                colors={
                  focused
                    ? ["transparent", "rgba(0,0,0,0.8)", "rgba(0,0,0,1)"]
                    : ["transparent", "rgba(0,0,0,0.6)", "rgba(0,0,0,0.9)"]
                }
                style={S.cardContent}
              >
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
              </LinearGradient>
            </View>
          </View>
        )}
      </Focusable>
    </View>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.isFocusedItem === nextProps.isFocusedItem &&
    prevProps.isFavorite === nextProps.isFavorite &&
    prevProps.itemWidth === nextProps.itemWidth
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

  // Per-field selectors — see the note in live-tv.tsx. Whole-store
  // destructuring re-rendered the grid on every unrelated store write.
  const activePortal = usePortalStore((s) => s.activePortal);
  const favorites = usePortalStore((s) => s.favorites);
  const toggleFavorite = usePortalStore((s) => s.toggleFavorite);
  const storeSeries = usePortalStore((s) => s.series);
  const setSeries = usePortalStore((s) => s.setSeries);
  const categories = usePortalStore((s) => s.categories);
  const setCategories = usePortalStore((s) => s.setCategories);

  // Local display state — drives FlatList directly, never blocked by store guards
  const [displaySeries, setDisplaySeries] = useState<Series[]>([]);
  const displaySeriesRef = useRef<Series[]>([]);
  displaySeriesRef.current = displaySeries;
  // An empty response is a load failure, not "this portal has no series".
  const [loadFailed, setLoadFailed] = useState(false);

  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  /**
   * Mirrors the field's own focus, purely for styling.
   *
   * The field is a plain D-pad target again — no wrapper, no programmatic
   * focus. That is not a style choice, it is the only thing that works on a
   * TV: ReactEditText.requestFocusProgrammatically() shows the keyboard only
   * `if (isInTouchMode && showSoftInputOnFocus)`, and a D-pad device is never
   * in touch mode, so every autoFocus and every ref.focus() took the else
   * branch and called hideSoftKeyboard(). RN says so in a comment there:
   * "only clicking the input will do that".
   *
   * What does work is the path RN actually designed for: the viewer navigates
   * onto the field, and ReactEditText.onKeyUp toggles isKeyboardOpened on
   * KEYCODE_DPAD_CENTER — so OK *on the focused field* opens the IME. Nothing
   * may intercept that press, which is why there is no Focusable wrapper here.
   */
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchResults, setSearchResults] = useState<Series[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  /** Bumped when the hidden-category set changes, to rebuild the sidebar. */
  const [hiddenVersion, setHiddenVersion] = useState(0);
  /** Bumped when a lock is toggled, so padlocks on the grid stay current. */
  const [parentalVersion, setParentalVersion] = useState(0);

  useEffect(() => {
    hiddenCategories.load().then(() => setHiddenVersion((v) => v + 1));
    parentalControl.load().then(() => setParentalVersion((v) => v + 1));
    const unsubscribeHidden = hiddenCategories.subscribe(() => setHiddenVersion((v) => v + 1));
    const unsubscribeLock = parentalControl.subscribe(() => setParentalVersion((v) => v + 1));
    return () => {
      unsubscribeHidden();
      unsubscribeLock();
    };
  }, []);
  const [refreshing, setRefreshing] = useState(false);
  // True while *any* portal request is in flight, including ones this screen did
  // not start — the boot sync, the periodic refresh, the empty-body retry.
  const syncing = useNetworkActivity();
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

  const loadCategories = useCallback(async (force = false) => {
    const portal = usePortalStore.getState().activePortal;
    if (!portal) return;
    try {
      if (force) {
        await cacheManager.removeByPrefix(`portal:${portal.id}:series:categories`);
        await cacheManager.removeByPrefix(`portal:${portal.id}:categories`);
      }
      let cats: Category[] = [];
      if (portal.type === "m3u") {
        cats = await new M3UApi({ url: portal.config.url }).getSeriesCategories();
      } else if (portal.type === "xtream") {
        cats = await xtreamApiRef.current!.getSeriesCategories();
      } else {
        cats = await portalApi.getSeriesCategories(portal);
      }
      let fetchedSeriesCats = (Array.isArray(cats) ? cats : []).map(c => ({
        ...c,
        type: "series" as const,
      }));

      // Fallback: If API returned empty categories, try deriving categories from cached/store Series items
      if (fetchedSeriesCats.length === 0 && allSeriesCacheRef.current.length > 0) {
        const seen = new Set<string>();
        fetchedSeriesCats = [];
        for (const item of allSeriesCacheRef.current) {
          const cId = item.categoryId || item.category;
          const cName = item.category || item.categoryId;
          if (cId && !seen.has(cId) && cId !== "all" && cId !== "*") {
            seen.add(cId);
            fetchedSeriesCats.push({
              id: cId.startsWith("series:") ? cId : `series:${cId}`,
              name: cName || cId,
              type: "series" as const,
            });
          }
        }
      }

      const currentCategories = usePortalStore.getState().categories || [];
      const others = currentCategories.filter(c => c.type && c.type !== "series");
      if (fetchedSeriesCats.length > 0) {
        setCategories([...others, ...fetchedSeriesCats]);
      }
    } catch (e) {
      console.warn("Failed to load series categories:", e);
    }
  }, [setCategories]);

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
  }, [activePortal?.id, loadCategories]);

  useEffect(() => {
    if (!activePortal || prevCategoryIdRef.current === selectedCategory) return;
    prevCategoryIdRef.current = selectedCategory;
    setIsLoading(true);
    setPage(1);
    FocusMemory.forget(SCREEN_KEY);
    focusedIdRef.current = "";
    flatListRef.current?.scrollToOffset({ offset: 0, animated: false });

    const timer = setTimeout(() => {
      if (activePortal.type === "xtream" || activePortal.type === "m3u") {
        if (allSeriesCacheRef.current.length > 0) {
          const filtered = filterByCategory(allSeriesCacheRef.current, selectedCategory, categories);
          fullListRef.current = filtered;
          const sliced = filtered.slice(0, PAGE_SIZE);
          setDisplaySeries(sliced);
          setHasMore(filtered.length > sliced.length);
          setIsLoading(false);
        } else {
          setHasMore(true);
          loadSeries(selectedCategory, 1, true);
        }
      } else {
        setHasMore(true);
        loadSeries(selectedCategory, 1, true);
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [selectedCategory, activePortal?.id]);

  const selectedSeriesCategoryRef = useRef(selectedCategory);
  const seriesRequestIdRef = useRef(0);
  useEffect(() => {
    selectedSeriesCategoryRef.current = selectedCategory;
  }, [selectedCategory]);

  // Marks the screen as failed-to-load and asks the portal to resync once.
  // The resync performs a fresh handshake and retries endpoints that answer
  // 200-with-an-empty-body, so it recovers from the stale-token case a plain
  // fetch reads as "this portal has nothing". The adoption hook below then picks
  // the content up without the user navigating away and back.
  const resyncRequestedRef = useRef(false);
  const reportLoadFailure = useCallback(() => {
    setLoadFailed(true);
    setHasMore(false);
    setIsLoading(false);
    setLoadingMore(false);
    if (resyncRequestedRef.current || !activePortal) return;
    resyncRequestedRef.current = true;
    AppBootManager.triggerBackgroundSync(activePortal, true).catch(() => { });
  }, [activePortal]);

  const applyAdopted = useCallback((slice: Series[], filteredTotal: number) => {
    setDisplaySeries(slice);
    setHasMore(filteredTotal > slice.length);
    setLoadFailed(false);
    setIsLoading(false);
    setPage(1);
  }, []);

  // Pick up series that reach the store after this screen mounted.
  useAdoptStoreContent<Series>({
    storeItems: storeSeries,
    cacheRef: allSeriesCacheRef,
    fullListRef,
    displayRef: displaySeriesRef,
    categoryRef: selectedSeriesCategoryRef,
    categories,
    pageSize: PAGE_SIZE,
    slicesFullList: activePortal?.type === "xtream" || activePortal?.type === "m3u",
    onAdopt: applyAdopted,
  });

  const loadSeries = async (categoryId?: string, pageNum: number = 1, reset: boolean = false) => {
    if (!activePortal || loadingMore || (!hasMore && !reset)) return;
    const requestId = ++seriesRequestIdRef.current;
    try {
      reset ? setIsLoading(true) : setLoadingMore(true);
      let items: Series[] = [];
      const cat = !categoryId || categoryId === "all" || categoryId === "*" ? undefined : categoryId;
      const targetCatId = categoryId ?? "all";

      if (activePortal.type === "m3u" || activePortal.type === "xtream") {
        if (allSeriesCacheRef.current.length === 0) {
          if (storeSeries.length > 0) {
            allSeriesCacheRef.current = storeSeries;
          } else {
            let fetched: Series[] = [];
            if (activePortal.type === "m3u") {
              fetched = await new M3UApi({ url: activePortal.config.url }).getSeries(undefined);
            } else if (activePortal.type === "xtream") {
              fetched = await xtreamApiRef.current!.getSeries(undefined, 1, 100000);
            }
            if (Array.isArray(fetched) && fetched.length > 0) {
              allSeriesCacheRef.current = fetched;
              // The store holds the complete list, never a page of it — search
              // reads it too, and it is what gets persisted for the next boot.
              setSeries(fetched, activePortal.id);
            } else {
              // Empty response and nothing cached. Report it as a failure and
              // let the portal sync retry with a fresh session — it detects the
              // empty-body case that a bare fetch reads as "no content".
              reportLoadFailure();
              return;
            }
          }
        }

        if (requestId !== seriesRequestIdRef.current || selectedSeriesCategoryRef.current !== targetCatId) return;

        const filtered = filterByCategory(allSeriesCacheRef.current, cat, categories);

        fullListRef.current = filtered;
        const sliced = filtered.slice(0, pageNum * PAGE_SIZE);
        if (!reset) trapFocusBriefly();
        // Local state only. Writing each page into the store re-rendered every
        // subscriber mid-scroll, and left the store holding a category slice
        // that search and the next boot then treated as the whole library.
        setLoadFailed(false);
        setDisplaySeries(sliced);
        setHasMore(filtered.length > sliced.length);
        setPage(pageNum);
        if (reset && sliced.length > 0) restoreFocusPosition(sliced);
      } else {
        // MAG / Stalker: Server-side pagination (14 items per page, infinite scroll as user scrolls)
        const fresh = await portalApi.getSeries(activePortal, cat, pageNum);
        if (requestId !== seriesRequestIdRef.current || selectedSeriesCategoryRef.current !== targetCatId) return;

        items = Array.isArray(fresh) ? fresh : [];
        const current = displaySeries;
        const updatedList = reset
          ? items
          : [...current, ...items.filter(i => !current.some(s => s.id === i.id))];
        if (reset && updatedList.length === 0) {
          reportLoadFailure();
          return;
        }
        if (!reset) trapFocusBriefly();
        setLoadFailed(false);
        setDisplaySeries(updatedList);
        // MAG paginates server-side, so the accumulated list *is* everything we
        // have — worth keeping in the store for search and the next cold start.
        setSeries(updatedList, activePortal.id);
        setHasMore(items.length > 0);
        setPage(pageNum);
        if (reset) restoreFocusPosition(updatedList);
      }
    } catch (e) {
      console.warn(e);
    } finally {
      setIsLoading(false);
      setLoadingMore(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(1);
    setHasMore(true);
    // An explicit refresh re-arms the one-shot resync so a repeat failure can
    // ask the portal for a fresh session again.
    resyncRequestedRef.current = false;
    if (activePortal?.type === "xtream" || activePortal?.type === "m3u") {
      allSeriesCacheRef.current = [];
      fullListRef.current = [];
    }
    await loadCategories(true);
    await loadSeries(selectedCategory, 1, true);
    setRefreshing(false);
  }, [selectedCategory, activePortal, loadCategories]);

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

  const totalCountRef = useRef(0);
  const handleLoadMoreRef = useRef<() => void>(() => { });

  const handleSeriesFocus = useCallback((item: Series, index?: number) => {
    updateCinematicBackground(item.logo || null);
    focusedIdRef.current = String(item.id);

    // Deferred: committing new cells while the native focus engine is still
    // resolving the key press is what makes focus land on the wrong tile.
    if (index !== undefined && totalCountRef.current > 0 && index >= totalCountRef.current - 12) {
      InteractionManager.runAfterInteractions(() => handleLoadMoreRef.current());
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
    <FocusGroup style={{ flexDirection: "row" }}>
      {row.items.map((seriesItem, colIndex) => {
        const itemIndex = rowIndex * numColumns + colIndex;
        return (
          <SeriesItem
            key={seriesItem.id}
            item={seriesItem}
            index={itemIndex}
            onPress={handleSeriesPress}
            onFocus={handleSeriesFocus}
            onFavoritePress={handleFavoritePress}
            isFavorite={favorites.series.includes(seriesItem.id)}
            itemWidth={itemWidth}
            locked={parentalControl.isRestricted("series", seriesItem)}
          />
        );
      })}
    </FocusGroup>
    // parentalVersion is read through parentalControl rather than passed, so it
    // has to be a dependency or a toggled lock leaves a stale padlock on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [favorites.series, itemWidth, numColumns, handleSeriesPress, handleSeriesFocus, handleFavoritePress, parentalVersion]);

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
        const base = (activePortal?.config?.url || "").replace(/\/$/, "");
        const mapped = apiResults.map(i => ({
          id: String(i.id || i.cmd || ""),
          name: i.name || i.title,
          logo: buildImageUrl(base, i.screen_uri ?? i.screenshot_uri ?? i.cover ?? i.poster ?? i.logo ?? i.stream_icon ?? ""),
          year: pickYear(i),
          description: pickDescription(i),
          rating: pickRating(i),
          categoryId: "",
        }));
        setSearchResults(mapped);
      } catch (err) {
        console.warn("Series Data Fetch Error:", err);
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
      // Scoped to the sidebar's selection — see the matching note in vod.tsx.
      if (isXtreamOrM3U) {
        const needle = debouncedQuery.toLowerCase();
        return filterByCategory(allSeriesCacheRef.current, selectedCategory, categories)
          .filter((s) => s.name.toLowerCase().includes(needle))
          .slice(0, 100);
      }
      return filterByCategory(searchResults, selectedCategory, categories);
    }

    // Default: return the local display state (category-filtered and paginated)
    return displaySeries;
  }, [displaySeries, debouncedQuery, isXtreamOrM3U, searchResults, selectedCategory, categories]);

  // Only relevant while the grid has nothing to show; a background refresh must
  // never replace content that is already on screen with a spinner.
  const busy = isLoading || (syncing && filteredSeries.length === 0);

  useEffect(() => {
    totalCountRef.current = filteredSeries.length;
  }, [filteredSeries.length]);

  const handleLoadMore = useCallback(() => {
    if (isLoading || loadingMore || !hasMore || debouncedQuery) return;
    trapFocusBriefly();
    if (isXtreamOrM3U) {
      // Grow the slice from the cached full list — no network.
      const nextPage = page + 1;
      const sliced = fullListRef.current.slice(0, nextPage * PAGE_SIZE);
      // Local state only — no store write mid-scroll. See loadSeries.
      setDisplaySeries(sliced);
      setPage(nextPage);
      setHasMore(fullListRef.current.length > sliced.length);
    } else {
      loadSeries(selectedCategory, page + 1);
    }
  }, [isLoading, loadingMore, hasMore, debouncedQuery, isXtreamOrM3U, page, selectedCategory, trapFocusBriefly]);

  useEffect(() => {
    handleLoadMoreRef.current = handleLoadMore;
  }, [handleLoadMore]);

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

  const ROW_HEIGHT = itemWidth * 1.5 + pw(1);
  // No leading pad: FlatList already accounts for contentContainerStyle padding,
  // so adding it here made scrollToIndex land one pad short of the target row.
  const getItemLayout = useCallback((_: any, index: number) => ({
    length: ROW_HEIGHT,
    offset: index * ROW_HEIGHT,
    index,
  }), [ROW_HEIGHT]);

  const sidebarCategories: Category[] = useMemo(() => {
    const seriesCats = (categories || []).filter(c =>
      (!c.type || c.type === "series") &&
      c.name.toLowerCase() !== "all" &&
      c.name.toLowerCase() !== "all series"
    );
    return [
      { id: "all", name: "All Series", type: "series" as const },
      // See the note in live-tv.tsx: hidden categories leave the sidebar, not
      // the library.
      ...hiddenCategories.filter("series", seriesCats),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, hiddenVersion]);

  // The sidebar owns focus on this screen: it takes the initial focus on entry
  // and keeps it when the category changes. No grid tile claims
  // `hasTVPreferredFocus`, so the user moves right into the grid deliberately.
  const focusSidebar = useInitialFocusPulse(sidebarCategories.length > 0);

  const searchInputRef = useRef<TextInput>(null);

  const handleCategorySelect = useCallback((catId: string) => {
    setSelectedCategory(catId);
    setSearchQuery("");
    setDebouncedQuery("");
  }, []);

  return (
    <View style={[S.container, { paddingTop: insets.top }]}>
      <CinematicBackground />

      <View style={S.header}>
        <Text style={S.headerTitle}>TV Series</Text>
        <FocusGroup style={S.searchWrapper}>
          {/* A real border now, not two stacked gradients faking one.
              The ring used to be `padding: 1.5` on this view with a gradient
              filling it, which is why this field never matched the tiles
              around it — it had no border to match with. It carries TILE_FRAME
              like everything else, keeping only its own pill radius. */}
          <View style={[S.searchGradient, searchFocused && S.searchGradientFocused, { flex: 1 }]}>
            <View style={[S.searchInner, searchFocused && { backgroundColor: "#0b0b10" }]}>
              <Ionicons name="search" size={ps(1.1)} color={searchFocused ? "#fff" : "rgba(255,255,255,0.3)"} style={{ marginRight: pw(1) }} />
              <TextInput
                ref={searchInputRef}
                style={S.searchInput}
                placeholder="Search series..."
                placeholderTextColor="rgba(255,255,255,0.2)"
                value={searchQuery}
                onChangeText={setSearchQuery}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                onSubmitEditing={() => setSearchFocused(false)}
              />
            </View>
          </View>
        </FocusGroup>
        <View style={S.countBadge}>
          <Text style={S.countText}>{busy ? "..." : String(filteredSeries.length)}</Text>
        </View>
      </View>

      <View style={S.body}>
        <FocusGroup style={{ width: SIDEBAR_WIDTH_VAL }}>
          <CategorySidebar
            categories={sidebarCategories}
            selectedId={selectedCategory || "all"}
            onSelect={handleCategorySelect}
            width={SIDEBAR_WIDTH_VAL}
            autoFocusFirst={focusSidebar}
          />
        </FocusGroup>
        <FocusGroup style={S.gridArea} trapLeft={trappingFocus} trapUp={trappingFocus}>
          <FlatList
            ref={flatListRef}
            data={chunkedSeries}
            renderItem={renderRow}
            keyExtractor={(item) => item.id}
            getItemLayout={getItemLayout}
            contentContainerStyle={[S.list, (isLoading || chunkedSeries.length === 0) && { flexGrow: 1 }]}
            removeClippedSubviews={Platform.OS === "android" && !isTV}
            extraData={filteredSeries.length}
            initialNumToRender={isTV ? 8 : 6}
            maxToRenderPerBatch={isTV ? 6 : 4}
            windowSize={5}
            updateCellsBatchingPeriod={50}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={1.5}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
            ListEmptyComponent={
              busy ? (
                <View style={{ flex: 1, paddingVertical: ph(10), justifyContent: "center", alignItems: "center" }}>
                  <ActivityIndicator color={THEME.colors.primary} size="large" />
                  <Text style={[S.loadingText, { marginTop: 10 }]}>Loading series library...</Text>
                </View>
              ) : (
                <View style={S.emptyState}>
                  <Ionicons
                    name={loadFailed ? "cloud-offline-outline" : "tv-outline"}
                    size={ps(4)}
                    color="rgba(255,255,255,0.05)"
                  />
                  <Text style={S.emptyTitle}>
                    {loadFailed ? "Couldn't Load Series" : "No Series Available"}
                  </Text>
                  {loadFailed ? (
                    <>
                      <Text style={S.emptySubtitle}>
                        The portal returned no data. Retrying in the background…
                      </Text>
                      <Focusable onPress={onRefresh} ringOnFocus={false} style={S.retryBtn}>
                        {(focused) => (
                          <View style={[S.retryInner, focused && S.retryInnerFocused]}>
                            <Ionicons name="refresh" size={ps(1.1)} color={focused ? "#000" : "#fff"} />
                            <Text style={[S.retryText, focused && { color: "#000" }]}>Retry</Text>
                          </View>
                        )}
                      </Focusable>
                    </>
                  ) : null}
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