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
  InteractionManager,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import * as IntentLauncher from "expo-intent-launcher";

import { usePortalStore, VODItem, Category } from "../src/store/portalStore";
import { portalApi } from "../src/services/portalApi";
import { M3UApi } from "../src/services/m3uApi";
import { XtreamApi } from "../src/services/xtreamApi";
import { THEME, pw, ph, ps } from "../src/theme/tokens";
import { isTV } from "../src/utils/tvUtils";
import { CinematicBackground, updateCinematicBackground } from "../src/components/CinematicBackground";
import { launchExternalPlayer } from "../src/utils/externalPlayer";
import CategorySidebar from "../src/components/CategorySidebar";
import { AppBootManager } from "../src/services/AppBootManager";
import { filterByCategory, useAdoptStoreContent } from "../src/hooks/useCategoryContent";
import { useNetworkActivity } from "../src/services/networkActivity";
import { Focusable, FocusGroup, Overlay, FocusMemory, useInitialFocusPulse } from "../src/tv";

const { width: SCREEN_WIDTH_VAL } = Dimensions.get("window");

/** Namespace for this screen's focus memory. */
const SCREEN_KEY = "vod";

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
  vodItem: { flex: 1, backgroundColor: "transparent", borderRadius: ps(1.1), overflow: "hidden" },
  posterContainer: { flex: 1, backgroundColor: "rgba(255,255,255,0.03)" },
  poster: { width: "100%", height: "100%" },
  posterPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.03)" },
  textOverlay: { display: "none" },
  cardContent: { position: "absolute", bottom: 0, width: "100%", padding: ps(0.8), borderBottomLeftRadius: ps(1.1), borderBottomRightRadius: ps(1.1), overflow: "hidden" },
  vodTitle: { color: "#fff", fontSize: ps(0.95), fontWeight: "700", fontFamily: THEME.fonts.bold },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 6, height: ps(1.6) },
  vodMetaText: { color: "rgba(255,255,255,0.7)", fontSize: ps(0.8), fontWeight: "600", fontFamily: THEME.fonts.medium },
  metaDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: "rgba(255,255,255,0.4)", marginHorizontal: 6 },
  ratingWrapper: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255, 215, 0, 0.15)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  ratingText: { color: "#FFD700", fontSize: ps(0.8), fontWeight: "800", marginLeft: 3, fontFamily: THEME.fonts.bold },
  favoriteBtn: { position: "absolute", top: 10, right: 10, backgroundColor: "rgba(0,0,0,0.4)", borderRadius: 12, padding: 6 },
  loadingCenter: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { color: "rgba(255,255,255,0.5)", marginTop: 15, fontSize: ps(1), fontFamily: THEME.fonts.regular },
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

  // Modal Styles
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center" },
  modalContainer: { width: isTV ? ps(65) : "92%", borderRadius: 36, padding: ps(2), borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.3)", overflow: "hidden" },
  modalTVContent: { flexDirection: "row" },
  modalLeft: { flex: 1.4, padding: ps(1.5) },
  modalRight: { flex: 0.6, padding: ps(2), paddingRight: isTV ? ps(4) : ps(2), justifyContent: "center", gap: 12 },
  modalTitle: { color: "#fff", fontSize: ps(1.9), fontWeight: "900", marginBottom: 12, fontFamily: THEME.fonts.bold },
  modalDescription: { color: "rgba(255,255,255,0.7)", fontSize: ps(1.2), lineHeight: ps(1.4), marginBottom: 18, fontFamily: THEME.fonts.regular },
  modalMetaRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  modalBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.1)", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.2)" },
  modalBadgeText: { color: "#fff", fontSize: ps(0.85), fontWeight: "800", fontFamily: THEME.fonts.bold },
  // ── Play-modal buttons: gradient acts as the border ──
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
  modalBtnPrimaryText: { color: "#fff", fontSize: ps(0.95), fontWeight: "900", letterSpacing: 1, fontFamily: THEME.fonts.bold },
  modalBtnSecondaryText: { color: "rgba(255,255,255,0.9)", fontSize: ps(0.9), fontWeight: "700", letterSpacing: 0.5, fontFamily: THEME.fonts.bold },
  loadMoreFooter: { paddingVertical: ph(3), alignItems: "center", justifyContent: "center" },
  loadMoreBtn: { flexDirection: "row", alignItems: "center", gap: pw(0.8), paddingHorizontal: pw(3), paddingVertical: ph(1.4), backgroundColor: "rgba(255,255,255,0.06)", borderRadius: ps(1), borderWidth: 2, borderColor: "transparent" },
  loadMoreBtnFocused: { borderColor: "#fff", backgroundColor: "#fff", shadowColor: "#fff", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 12, elevation: 12 },
  loadMoreBtnText: { color: "#fff", fontSize: ps(1), fontWeight: "900", letterSpacing: 1.5, fontFamily: THEME.fonts.bold },
});

// ─────────────────────────────────────────────
// Movie Item Component (Premium Design)
// ─────────────────────────────────────────────
const MovieItem = React.memo(function MovieItem({
  item,
  index,
  onPress,
  onFocus,
  onFavoritePress,
  isFavorite,
  itemWidth,
  isFocusedItem,
}: {
  item: VODItem;
  index?: number;
  onPress: (item: VODItem) => void;
  onFocus?: (item: VODItem, index?: number) => void;
  onFavoritePress: (item: VODItem) => void;
  isFavorite: boolean;
  itemWidth: number;
  isFocusedItem?: boolean;
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
            <View style={S.vodItem}>
              <View style={S.posterContainer}>
                {item.logo ? (
                  <Image source={{ uri: item.logo }} style={S.poster} contentFit="cover" cachePolicy="memory-disk" />
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

              <LinearGradient
                colors={
                  focused
                    ? ["transparent", "rgba(0,0,0,0.8)", "rgba(0,0,0,1)"]
                    : ["transparent", "rgba(0,0,0,0.6)", "rgba(0,0,0,0.9)"]
                }
                style={S.cardContent}
              >
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
export default function VODScreen() {
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
  const storeVodItems = usePortalStore((s) => s.vodItems);
  const setVodItems = usePortalStore((s) => s.setVodItems);
  const categories = usePortalStore((s) => s.categories);
  const setCategories = usePortalStore((s) => s.setCategories);

  // Local display state — drives FlatList directly, never blocked by store guards
  const [displayVodItems, setDisplayVodItems] = useState<VODItem[]>([]);
  const displayVodItemsRef = useRef<VODItem[]>([]);
  displayVodItemsRef.current = displayVodItems;
  // An empty response is a load failure, not "this portal has no movies".
  const [loadFailed, setLoadFailed] = useState(false);

  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchResults, setSearchResults] = useState<VODItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // True while *any* portal request is in flight, including ones this screen did
  // not start — the boot sync, the periodic refresh, the empty-body retry.
  const syncing = useNetworkActivity();
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
  }, [activePortal?.id]);

  const selectedCategoryRef = useRef(selectedCategory);
  useEffect(() => {
    selectedCategoryRef.current = selectedCategory;
  }, [selectedCategory]);

  useEffect(() => {
    if (!activePortal || prevCategoryIdRef.current === selectedCategory) return;
    prevCategoryIdRef.current = selectedCategory;
    setIsLoading(true);
    setPage(1);
    // A remembered tile from the previous category is not in the new list.
    FocusMemory.forget(SCREEN_KEY);
    focusedIdRef.current = "";
    // Focus stays in the sidebar on a category switch, so nothing else scrolls
    // the grid back up — do it here, or the new category renders half-scrolled
    // at wherever the previous one was left.
    flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
    const cat = selectedCategory;

    const timer = setTimeout(() => {
      if (activePortal?.type === "m3u" || activePortal?.type === "xtream") {
        if (allVodCacheRef.current.length > 0) {
          const filtered = filterByCategory(allVodCacheRef.current, cat, categories);
          fullListRef.current = filtered;
          const sliced = filtered.slice(0, PAGE_SIZE);
          setDisplayVodItems(sliced);  // local state — never blocked
          setHasMore(filtered.length > sliced.length);
          setIsLoading(false);
          restoreFocusPosition(sliced);
        } else {
          setHasMore(true);
          loadVodItems(selectedCategory, 1, true);
        }
      } else {
        setHasMore(true);
        loadVodItems(selectedCategory, 1, true);
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [selectedCategory, activePortal?.id]);

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
      console.warn(e);
      // On error, do NOT clear categories — leave existing ones intact
    }
  };

  const vodRequestIdRef = useRef(0);

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
    AppBootManager.triggerBackgroundSync(activePortal, true).catch(() => {});
  }, [activePortal]);

  const applyAdopted = useCallback((slice: VODItem[], filteredTotal: number) => {
    setDisplayVodItems(slice);
    setHasMore(filteredTotal > slice.length);
    setLoadFailed(false);
    setIsLoading(false);
    setPage(1);
  }, []);

  // Pick up items that reach the store after this screen mounted.
  useAdoptStoreContent<VODItem>({
    storeItems: storeVodItems,
    cacheRef: allVodCacheRef,
    fullListRef,
    displayRef: displayVodItemsRef,
    categoryRef: selectedCategoryRef,
    categories,
    pageSize: PAGE_SIZE,
    slicesFullList: activePortal?.type === "xtream" || activePortal?.type === "m3u",
    onAdopt: applyAdopted,
  });

  const loadVodItems = async (categoryId?: string, pageNum: number = 1, reset: boolean = false) => {
    if (!activePortal || loadingMore || (!hasMore && !reset)) return;
    const requestId = ++vodRequestIdRef.current;
    try {
      reset ? setIsLoading(true) : setLoadingMore(true);
      let items: VODItem[] = [];
      const cat = !categoryId || categoryId === "all" || categoryId === "*" ? undefined : categoryId;
      const targetCatId = categoryId ?? "all";

      if (activePortal.type === "m3u" || activePortal.type === "xtream") {
        if (allVodCacheRef.current.length === 0) {
          if (storeVodItems.length > 0) {
            allVodCacheRef.current = storeVodItems;
          } else {
            let fetched: VODItem[] = [];
            if (activePortal.type === "m3u") {
              fetched = await new M3UApi({ url: activePortal.config.url }).getVodItems(undefined);
            } else if (activePortal.type === "xtream") {
              fetched = await xtreamApiRef.current!.getVodItems(undefined, 1, 100000);
            }
            if (Array.isArray(fetched) && fetched.length > 0) {
              allVodCacheRef.current = fetched;
              // The store holds the complete list, never a page of it — search
              // reads it too, and it is what gets persisted for the next boot.
              setVodItems(fetched, activePortal.id);
            } else {
              // Empty response and nothing cached. Report it as a failure and
              // let the portal sync retry with a fresh session — it detects the
              // empty-body case that a bare fetch reads as "no content".
              reportLoadFailure();
              return;
            }
          }
        }

        if (requestId !== vodRequestIdRef.current || selectedCategoryRef.current !== targetCatId) return;

        const filtered = filterByCategory(allVodCacheRef.current, cat, categories);

        fullListRef.current = filtered;
        const sliced = filtered.slice(0, pageNum * PAGE_SIZE);
        if (!reset) trapFocusBriefly();
        // Local state only. Writing each page into the store re-rendered every
        // subscriber mid-scroll, and left the store holding a category slice
        // that search and the next boot then treated as the whole library.
        setLoadFailed(false);
        setDisplayVodItems(sliced);
        setHasMore(filtered.length > sliced.length);
        setPage(pageNum);
        if (reset && sliced.length > 0) restoreFocusPosition(sliced);
      } else {
        // MAG / Stalker: Server-side pagination (14 items per page, infinite scroll as user scrolls)
        const fresh = await portalApi.getVodItems(activePortal, cat, pageNum);
        if (requestId !== vodRequestIdRef.current || selectedCategoryRef.current !== targetCatId) return;

        items = Array.isArray(fresh) ? fresh : [];
        const current = displayVodItems;
        const updatedList = reset
          ? items
          : [...current, ...items.filter(i => !current.some(v => v.id === i.id))];
        if (reset && updatedList.length === 0) {
          reportLoadFailure();
          return;
        }
        if (!reset) trapFocusBriefly();
        setLoadFailed(false);
        setDisplayVodItems(updatedList);
        // MAG paginates server-side, so the accumulated list *is* everything we
        // have — worth keeping in the store for search and the next cold start.
        setVodItems(updatedList, activePortal.id);
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

  const totalCountRef = useRef(0);
  const handleLoadMoreRef = useRef<() => void>(() => {});

  const handleVodFocus = useCallback((vod: VODItem, index?: number) => {
    updateCinematicBackground(vod.logo || null);
    focusedIdRef.current = String(vod.id);

    // Deferred: committing new cells while the native focus engine is still
    // resolving the key press is what makes focus land on the wrong tile.
    if (index !== undefined && totalCountRef.current > 0 && index >= totalCountRef.current - 12) {
      InteractionManager.runAfterInteractions(() => handleLoadMoreRef.current());
    }
  }, []);

  // Real focus restoration: FocusMemory re-focuses the exact tile we left from
  // After a refresh/reset, scroll the list back to the previously focused item
  const restoreFocusPosition = useCallback((items: VODItem[]) => {
    if (!focusedIdRef.current || !flatListRef.current) return;
    // With chunked rows, scrollToIndex needs the row index
    const idx = items.findIndex(v => String(v.id) === focusedIdRef.current);
    if (idx > 0) {
      const rowIndex = Math.floor(idx / numColumns);
      setTimeout(() => {
        try {
          flatListRef.current?.scrollToIndex({ index: rowIndex, animated: false, viewPosition: 0.3 });
        } catch { /* ignore if out of range */ }
      }, 120);
    }
  }, [numColumns]);

  const getDisplayDescription = (desc: string | undefined | null) => {
    if (!desc) return "No description available for this content.";
    const lower = desc.trim().toLowerCase();
    if (lower === "n/a" || lower === "na" || lower === "undefined" || lower === "null" || lower === "") {
      return "No description available for this content.";
    }
    return desc.trim();
  };

  const handleFavoritePress = useCallback((item: VODItem) => {
    toggleFavorite("vod", item.id);
  }, [toggleFavorite]);

  const startPlayback = async (
    url: string | null,
    isExternal: boolean = false,
    title?: string,
    contentId?: string
  ) => {
    if (!url) { Alert.alert("Error", "No stream URL found"); return; }
    setPlayModalVisible(false);
    try {
      if (isExternal) {
        launchExternalPlayer({ url, title: title || selectedVod?.name || "Movie" });
      } else {
        router.push({
          pathname: "/player",
          params: {
            url,
            title: title || selectedVod?.name || "Movie",
            type: "vod",
            // Required for resume — the player only saves/restores position
            // when it is given a stable content id.
            ...(contentId ? { contentId } : {}),
          },
        });
      }
    } catch (err) {
      console.error("Playback launch error:", err);
      Alert.alert("Error", "Failed to start playback. Make sure a video player app is installed.");
    }
  };

  const handleModalAction = async (isExternal: boolean) => {
    if (!selectedVod) return;
    const titleSnapshot = selectedVod.name;
    const contentIdSnapshot = `vod:${selectedVod.id}`;
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

    startPlayback(streamUrl, isExternal, titleSnapshot, contentIdSnapshot);
  };

  const renderRow = useCallback(({ item: row, index: rowIndex }: { item: { id: string; items: VODItem[] }; index: number }) => (
    <FocusGroup style={{ flexDirection: "row" }}>
      {row.items.map((movie, colIndex) => {
        const itemIndex = rowIndex * numColumns + colIndex;
        return (
          <MovieItem
            key={movie.id}
            item={movie}
            index={itemIndex}
            onPress={handleVodPress}
            onFocus={handleVodFocus}
            onFavoritePress={handleFavoritePress}
            isFavorite={favorites.vod.includes(movie.id)}
            itemWidth={itemWidth}
          />
        );
      })}
    </FocusGroup>
  ), [favorites.vod, itemWidth, numColumns, handleVodPress, handleVodFocus, handleFavoritePress]);



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
      } catch (err) {
        console.warn("VOD Data Fetch Error:", err);
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

    // Default: return local display state (category-filtered and paginated)
    return displayVodItems;
  }, [displayVodItems, debouncedQuery, isXtreamOrM3U, searchResults]);

  // Only relevant while the grid has nothing to show; a background refresh must
  // never replace content that is already on screen with a spinner.
  const busy = isLoading || (syncing && filteredMovies.length === 0);

  const chunkedMovies = useMemo(() => {
    const chunks = [];
    for (let i = 0; i < filteredMovies.length; i += numColumns) {
      chunks.push({
        id: `row-${i}`,
        items: filteredMovies.slice(i, i + numColumns),
      });
    }
    return chunks;
  }, [filteredMovies, numColumns]);

  useEffect(() => {
    totalCountRef.current = filteredMovies.length;
  }, [filteredMovies.length]);

  const handleLoadMore = useCallback(() => {
    if (isLoading || loadingMore || !hasMore || debouncedQuery) return;
    trapFocusBriefly();
    if (isXtreamOrM3U) {
      // Grow the slice from the cached full list — no network.
      const nextPage = page + 1;
      const sliced = fullListRef.current.slice(0, nextPage * PAGE_SIZE);
      // Local state only — no store write mid-scroll. See loadVodItems.
      setDisplayVodItems(sliced);
      setPage(nextPage);
      setHasMore(fullListRef.current.length > sliced.length);
    } else {
      loadVodItems(selectedCategory, page + 1);
    }
  }, [isLoading, loadingMore, hasMore, debouncedQuery, isXtreamOrM3U, page, selectedCategory, trapFocusBriefly]);

  useEffect(() => {
    handleLoadMoreRef.current = handleLoadMore;
  }, [handleLoadMore]);

  // Memoised: a fresh array on every render made CategorySidebar's FlatList
  // treat the data as changed each time, re-running its scroll effect.
  const sidebarCategories: Category[] = useMemo(
    () => [
      { id: "all", name: "All Movies", type: "vod" as const },
      ...categories.filter(c =>
        c.type === "vod" &&
        c.name.toLowerCase() !== "all" &&
        c.name.toLowerCase() !== "all movies"
      ),
    ],
    [categories]
  );

  // The sidebar owns focus on this screen: it takes the initial focus on entry
  // and keeps it when the category changes. No grid tile claims
  // `hasTVPreferredFocus`, so the user moves right into the grid deliberately.
  const focusSidebar = useInitialFocusPulse(sidebarCategories.length > 0);

  const ROW_HEIGHT = itemWidth * 1.5 + pw(1);
  // No leading pad: FlatList already accounts for contentContainerStyle padding,
  // so adding it here made scrollToIndex land one pad short of the target row.
  const getItemLayout = useCallback((_: any, index: number) => ({
    length: ROW_HEIGHT,
    offset: index * ROW_HEIGHT,
    index,
  }), [ROW_HEIGHT]);

  return (
    <View style={[S.container, { paddingTop: insets.top }]}>
      <View
        style={{ flex: 1 }}
        accessibilityElementsHidden={playModalVisible}
        importantForAccessibility={playModalVisible ? "no-hide-descendants" : "auto"}
      >
        <CinematicBackground />
        <StatusBar hidden />

        <View style={S.header}>
          <Text style={S.headerTitle}>Movies</Text>
          <FocusGroup style={S.searchWrapper}>
            <Focusable
              disabled={playModalVisible}
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
                  placeholder="Search movies..."
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                  editable={!playModalVisible}
                  focusable={!playModalVisible}
                />
                </View>
              </View>
              )}
            </Focusable>
          </FocusGroup>
          <View style={S.countBadge}>
            <Text style={S.countText}>{busy ? "..." : String(filteredMovies.length)}</Text>
          </View>
        </View>

        <View style={S.body}>
          <FocusGroup style={{ width: SIDEBAR_WIDTH_VAL }}>
            <CategorySidebar
              categories={sidebarCategories}
              selectedId={selectedCategory || "all"}
              onSelect={setSelectedCategory}
              width={SIDEBAR_WIDTH_VAL}
              autoFocusFirst={focusSidebar}
            />
          </FocusGroup>
          <FocusGroup style={S.gridArea} trapLeft={trappingFocus} trapUp={trappingFocus}>
            <FlatList
              ref={flatListRef}
              data={chunkedMovies}
              renderItem={renderRow}
              keyExtractor={(item) => item.id}
              getItemLayout={getItemLayout}
              contentContainerStyle={[S.list, (isLoading || chunkedMovies.length === 0) && { flexGrow: 1 }]}
              removeClippedSubviews={Platform.OS === "android" && !isTV}
              extraData={filteredMovies.length}
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
                    <Text style={[S.loadingText, { marginTop: 10 }]}>Brewing cinematic magic...</Text>
                  </View>
                ) : (
                  <View style={S.emptyState}>
                    <MaterialCommunityIcons
                      name={loadFailed ? "cloud-off-outline" : "movie-filter-outline"}
                      size={ps(4)}
                      color="rgba(255,255,255,0.05)"
                    />
                    <Text style={S.emptyTitle}>
                      {loadFailed ? "Couldn't Load Movies" : "Nothing Found"}
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
                loadingMore && filteredMovies.length > 0 ? (
                  <View style={{ width: "100%", paddingVertical: ph(3), alignItems: "center", justifyContent: "center", flexDirection: "row", gap: pw(1) }}>
                    <ActivityIndicator color={THEME.colors.primary} size="small" />
                    <Text style={{ color: "rgba(255,255,255,0.3)", fontSize: ps(0.9) }}>Loading more...</Text>
                  </View>
                ) : null
              }
            />
          </FocusGroup>
        </View>
      </View>

      <Overlay
        visible={playModalVisible}
        onClose={() => setPlayModalVisible(false)}
        style={{ justifyContent: 'flex-end', backgroundColor: 'transparent' }}
        contentStyle={{ width: '100%', maxWidth: '100%', margin: 0, padding: 0 }}
      >
        <BlurView intensity={120} tint="dark" style={{ width: '100%', borderTopLeftRadius: 36, borderTopRightRadius: 36, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.25)", borderBottomWidth: 0 }}>
          {selectedVod?.logo && (
            <Image
              source={{ uri: selectedVod.logo }}
              style={[StyleSheet.absoluteFillObject, { opacity: 0.4 }]}
              blurRadius={40}
              contentFit="cover"
            />
          )}
          <LinearGradient
            colors={['rgba(255,255,255,0.1)', 'rgba(0,0,0,0.5)', '#000']}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={[isTV ? S.modalTVContent : null, { padding: ps(3) }]}>
            <View style={S.modalLeft}>
              <Text style={S.modalTitle} numberOfLines={2}>{selectedVod?.name}</Text>
              <Text style={S.modalDescription} numberOfLines={isTV ? 8 : 5}>
                {getDisplayDescription(selectedVod?.description)}
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
                  <View style={[S.modalBtnBorder, focused && S.modalBtnBorderFocused]}>
                    <View style={S.modalBtnPrimaryInner}>
                      <Text style={[S.modalBtnPrimaryText, focused && { color: "#000" }]}>WATCH NOW</Text>
                    </View>
                  </View>
                )}
              </Focusable>
              <Focusable
                ringOnFocus={false}
                onPress={() => handleModalAction(true)}
                style={S.modalBtnWrapper}
              >
                {(focused) => (
                  <View style={[S.modalBtnBorder, focused && S.modalBtnBorderFocused]}>
                    <View style={S.modalBtnSecondaryInner}>
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
                    <View style={S.modalBtnSecondaryInner}>
                      <Text style={[S.modalBtnSecondaryText, focused && { color: "#000" }]}>CLOSE</Text>
                    </View>
                  </View>
                )}
              </Focusable>
            </View>
          </View>
        </BlurView>
      </Overlay>
    </View>
  );
}
