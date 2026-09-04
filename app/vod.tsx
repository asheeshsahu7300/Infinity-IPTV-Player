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
  Linking,  FlatList,
  InteractionManager,
  BackHandler,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsFocused } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import * as IntentLauncher from "expo-intent-launcher";

import { usePortalStore, VODItem, Category, MediaMeta } from "../src/store/portalStore";
import { portalApi, buildImageUrl } from "../src/services/portalApi";
import { M3UApi } from "../src/services/m3uApi";
import { XtreamApi } from "../src/services/xtreamApi";
import { cacheManager } from "../src/services/cacheManager";
import { THEME, pw, ph, ps, TILE_FRAME, TILE_FRAME_FOCUSED } from "../src/theme/tokens";
import { isTV } from "../src/utils/tvUtils";
import { CinematicBackground, updateCinematicBackground } from "../src/components/CinematicBackground";
import { launchExternalPlayer } from "../src/utils/externalPlayer";
import CategorySidebar from "../src/components/CategorySidebar";
import { AppBootManager } from "../src/services/AppBootManager";
import { filterByCategory, useAdoptStoreContent } from "../src/hooks/useCategoryContent";
import { useNetworkActivity } from "../src/services/networkActivity";
import { Focusable, FocusGroup, Overlay, FocusMemory, useInitialFocusPulse, useIsFocusTrapped } from "../src/tv";
import { useDialog } from "../src/components/ConfirmDialog";
import { parentalControl } from "../src/services/parentalControl";
import { hiddenCategories } from "../src/services/hiddenCategories";
import { playbackQueue, queueFromVod } from "../src/services/playbackQueue";
import { resumeIndex } from "../src/services/resumeIndex";
import PinPrompt from "../src/components/PinPrompt";
import MediaMetaPanel from "../src/components/MediaMetaPanel";
import MetaFacts from "../src/components/MetaFacts";
import { formatRuntime } from "../src/utils/duration";

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
  list: { paddingHorizontal: pw(1), paddingTop: 0, paddingBottom: ph(10) },
  cardBorder: { ...TILE_FRAME },
  cardBorderFocused: { ...TILE_FRAME_FOCUSED },
  vodItem: { flex: 1, backgroundColor: "transparent", borderRadius: ps(1.1), overflow: "hidden" },
  posterContainer: { flex: 1, backgroundColor: "rgba(255,255,255,0.03)" },
  poster: { width: "100%", height: "100%" },
  posterPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.03)" },
  textOverlay: { display: "none" },
  cardContent: { position: "absolute", bottom: 0, width: "100%", padding: ps(0.8), borderBottomLeftRadius: ps(1.1), borderBottomRightRadius: ps(1.1), overflow: "hidden" },
  vodTitle: { color: "#fff", fontSize: ps(0.95), fontWeight: "700" },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 6, height: ps(1.6) },
  vodMetaText: { color: "rgba(255,255,255,0.7)", fontSize: ps(0.8), fontWeight: "600" },
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
  // Sits on the poster's bottom edge, the way a partially-watched title is
  // marked on every set-top box and streaming grid.
  resumeTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  resumeFill: { height: "100%", backgroundColor: "#e50914" },
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
  modalSurface: {
    width: '100%',
    borderTopLeftRadius: ps(2),
    borderTopRightRadius: ps(2),
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.2)",
    borderBottomWidth: 0,
    backgroundColor: 'rgba(10, 12, 18, 0.95)',
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
  modalMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: ps(0.6),
    marginBottom: ps(0.4),
    flexWrap: "wrap",
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
  loadMoreFooter: { paddingVertical: ph(3), alignItems: "center", justifyContent: "center" },
  loadMoreBtn: { flexDirection: "row", alignItems: "center", gap: pw(0.8), paddingHorizontal: pw(3), paddingVertical: ph(1.4), backgroundColor: "rgba(255,255,255,0.06)", borderRadius: ps(1), borderWidth: 2, borderColor: "transparent" },
  loadMoreBtnFocused: { borderColor: "#fff", backgroundColor: "#fff", shadowColor: "#fff", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 12, elevation: 12 },
  loadMoreBtnText: { color: "#fff", fontSize: ps(1), fontWeight: "900", letterSpacing: 1.5 },
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
  locked,
  resumeVersion,
}: {
  item: VODItem;
  index?: number;
  onPress: (item: VODItem) => void;
  onFocus?: (item: VODItem, index?: number) => void;
  onFavoritePress: (item: VODItem) => void;
  isFavorite: boolean;
  itemWidth: number;
  isFocusedItem?: boolean;
  locked?: boolean;
  /**
   * Bumped when a resume position is written, so the bar below moves without
   * every poster in the grid holding its own subscription.
   */
  resumeVersion: number;
}) {
  const handlePress = useCallback(() => {
    onPress(item);
  }, [onPress, item]);

  // A film half-watched carries a bar the way it does on a set-top box; one
  // never started, or finished, carries nothing. Both of those states read
  // better as the absence of a bar than as an empty or full one.
  const progress = useMemo(
    () => resumeIndex.progressFor(`vod:${item.id}`),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item.id, resumeVersion]
  );

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
                  <Image source={{ uri: item.logo }} recyclingKey={item.logo} style={S.poster} contentFit="cover" cachePolicy="memory-disk" />
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

                {locked ? (
                  <View style={S.lockBadge}>
                    <Ionicons name="lock-closed" size={ps(0.95)} color="#fff" />
                  </View>
                ) : null}

                {progress > 0 && progress < 0.98 ? (
                  <View style={S.resumeTrack}>
                    <View style={[S.resumeFill, { width: `${Math.round(progress * 100)}%` }]} />
                  </View>
                ) : null}
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
    prevProps.itemWidth === nextProps.itemWidth &&
    prevProps.locked === nextProps.locked &&
    prevProps.resumeVersion === nextProps.resumeVersion
  );
});

// ─────────────────────────────────────────────
// Memoized Movie Row (Prevents re-rendering all rows on focus change)
// ─────────────────────────────────────────────
interface MovieRowProps {
  row: { id: string; items: VODItem[] };
  rowIndex: number;
  numColumns: number;
  itemWidth: number;
  focusedId: string;
  isSidebarFocused: boolean;
  onPress: (item: VODItem) => void;
  onFocus: (item: VODItem, index?: number) => void;
  onFavoritePress: (item: VODItem) => void;
  favorites: string[];
  resumeVersion: number;
  parentalVersion: number;
}

const MovieRow = React.memo(function MovieRow({
  row,
  rowIndex,
  numColumns,
  itemWidth,
  focusedId,
  isSidebarFocused,
  onPress,
  onFocus,
  onFavoritePress,
  favorites,
  resumeVersion,
}: MovieRowProps) {
  return (
    <View style={{ flexDirection: "row" }}>
      {row.items.map((movie, colIndex) => {
        const itemIndex = rowIndex * numColumns + colIndex;
        const id = String(movie.id);
        const isTargetFocus = false;

        return (
          <MovieItem
            key={movie.id}
            item={movie}
            index={itemIndex}
            onPress={onPress}
            onFocus={onFocus}
            onFavoritePress={onFavoritePress}
            isFavorite={favorites.includes(movie.id)}
            itemWidth={itemWidth}
            isFocusedItem={isTargetFocus}
            locked={parentalControl.isRestricted("vod", movie)}
            resumeVersion={resumeVersion}
          />
        );
      })}
    </View>
  );
}, (prev, next) => {
  if (prev.row !== next.row) return false;
  if (prev.itemWidth !== next.itemWidth) return false;
  if (prev.resumeVersion !== next.resumeVersion) return false;
  if (prev.parentalVersion !== next.parentalVersion) return false;
  if (prev.favorites !== next.favorites) {
    const hasFavChange = next.row.items.some(
      (m) => prev.favorites.includes(m.id) !== next.favorites.includes(m.id)
    );
    if (hasFavChange) return false;
  }
  const wasFocused = next.row.items.some((m) => String(m.id) === prev.focusedId);
  const isFocused = next.row.items.some((m) => String(m.id) === next.focusedId);
  if (wasFocused || isFocused) {
    if (prev.focusedId !== next.focusedId || prev.isSidebarFocused !== next.isSidebarFocused) {
      return false;
    }
  }
  return true;
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
  const isScreenFocused = useIsFocused();
  const isFocusTrapped = useIsFocusTrapped();
  // Errors surface through an in-tree overlay — Alert.alert does not
  // reliably appear on an Android TV release build.
  const { notify, node: dialogNode } = useDialog();

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
  /** Film held behind the parental PIN; the prompt reopens the play sheet. */
  const [pinTarget, setPinTarget] = useState<VODItem | null>(null);
  const [resumeVersion, setResumeVersion] = useState(0);
  const [parentalVersion, setParentalVersion] = useState(0);
  /** Bumped when the hidden-category set changes, to rebuild the sidebar. */
  const [hiddenVersion, setHiddenVersion] = useState(0);
  /**
   * Credits for the open sheet.
   *
   * Seeded from the list row and then topped up by the per-title detail call,
   * because Xtream keeps cast, director and genre behind get_vod_info — one
   * request per film, which is only affordable for the one being looked at.
   */
  const [vodMeta, setVodMeta] = useState<MediaMeta | null>(null);
  /** Which title the sheet is showing, so a late detail response can be dropped. */
  const selectedVodIdRef = useRef<string>("");

  useEffect(() => {
    parentalControl.load().then(() => setParentalVersion((v) => v + 1));
    resumeIndex.load();
    const unsubscribeResume = resumeIndex.subscribe(() => setResumeVersion((v) => v + 1));
    const unsubscribeLock = parentalControl.subscribe(() => setParentalVersion((v) => v + 1));
    hiddenCategories.load().then(() => setHiddenVersion((v) => v + 1));
    const unsubscribeHidden = hiddenCategories.subscribe(() => setHiddenVersion((v) => v + 1));
    return () => {
      unsubscribeResume();
      unsubscribeLock();
      unsubscribeHidden();
    };
  }, []);

  const searchInputRef = useRef<TextInput>(null);

  const xtreamApiRef = useRef<XtreamApi | null>(null);
  const allVodCacheRef = useRef<VODItem[]>([]);
  // The current category's full filtered list — store/FlatList only see the
  // first N pages of this.
  const fullListRef = useRef<VODItem[]>([]);
  const prevCategoryIdRef = useRef<string | undefined>(undefined);
  // Track last focused VOD id so we can restore focus after refresh
  const focusedIdRef = useRef<string>("");
  const isSidebarFocusedRef = useRef(true);
  const flatListRef = useRef<FlatList>(null);

  const loadCategories = useCallback(async (force = false) => {
    const portal = usePortalStore.getState().activePortal;
    if (!portal) return;
    try {
      if (force) {
        await cacheManager.removeByPrefix(`portal:${portal.id}:vod:categories`);
        await cacheManager.removeByPrefix(`portal:${portal.id}:categories`);
      }
      let cats: Category[] = [];
      if (portal.type === "m3u") {
        cats = await new M3UApi({ url: portal.config.url }).getVodCategories();
      } else if (portal.type === "xtream") {
        cats = await xtreamApiRef.current!.getVodCategories();
      } else {
        cats = await portalApi.getVodCategories(portal);
      }

      // Fallback: If API returned empty categories, try deriving categories from cached/store VOD items
      if ((!cats || cats.length === 0) && allVodCacheRef.current.length > 0) {
        const seen = new Set<string>();
        cats = [];
        for (const item of allVodCacheRef.current) {
          const cId = item.categoryId || item.category;
          const cName = item.category || item.categoryId;
          if (cId && !seen.has(cId) && cId !== "all" && cId !== "*") {
            seen.add(cId);
            cats.push({
              id: cId.startsWith("vod:") ? cId : `vod:${cId}`,
              name: cName || cId,
              type: "vod",
            });
          }
        }
      }

      // Read live state at call-time to avoid overwriting live/series categories
      const currentCategories = usePortalStore.getState().categories || [];
      const others = currentCategories.filter(c => c.type !== "vod");
      if (Array.isArray(cats) && cats.length > 0) {
        setCategories([...others, ...cats]);
      }
    } catch (e) {
      console.warn("Failed to load VOD categories:", e);
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

  const selectedCategoryRef = useRef(selectedCategory);
  useEffect(() => {
    selectedCategoryRef.current = selectedCategory;
  }, [selectedCategory]);

  useEffect(() => {
    if (!activePortal || prevCategoryIdRef.current === selectedCategory) return;
    prevCategoryIdRef.current = selectedCategory;
    setIsLoading(true);
    setPage(1);
    focusedIdRef.current = "";
    isSidebarFocusedRef.current = true;
    FocusMemory.set("category-sidebar", selectedCategory);
    flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
    const cat = selectedCategory;

    if (activePortal?.type === "m3u" || activePortal?.type === "xtream") {
      if (allVodCacheRef.current.length > 0) {
        const filtered = filterByCategory(allVodCacheRef.current, cat, categories);
        fullListRef.current = filtered;
        const sliced = filtered.slice(0, PAGE_SIZE);
        setDisplayVodItems(sliced);
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
  }, [selectedCategory, activePortal?.id]);

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
    await loadCategories(true);
    await loadVodItems(selectedCategory, 1, true);
    setRefreshing(false);
  }, [selectedCategory, activePortal, loadCategories]);

  const handleVodPress = useCallback(async (vod: VODItem) => {
    setSelectedVod(vod);
    selectedVodIdRef.current = String(vod.id);
    // Whatever the list row already carried, so the sheet is never blank while
    // the detail call is in flight.
    setVodMeta({ cast: vod.cast, director: vod.director, tags: vod.tags, plot: vod.plot, country: vod.country });

    if (parentalControl.isLocked("vod", vod)) {
      setPinTarget(vod);
      return;
    }
    setPlayModalVisible(true);

    // Top up the credits for the sheet that just opened. Fire-and-forget: the
    // panel already has whatever the list row carried, so a slow or missing
    // detail call costs nothing but a thinner sheet. Guarded by id so a fast
    // second selection cannot have the first one's response land on it.
    if (activePortal?.type === "xtream" && xtreamApiRef.current) {
      const forId = String(vod.id);
      xtreamApiRef.current
        .getVodInfo(forId)
        .then((detail) => {
          if (String(selectedVodIdRef.current) !== forId) return;
          setVodMeta((current) => ({ ...(current || {}), ...detail }));
        })
        .catch(() => { });
    }
  }, []);

  const totalCountRef = useRef(0);
  const handleLoadMoreRef = useRef<() => void>(() => {});

  const handleVodFocus = useCallback((vod: VODItem, index?: number) => {
    focusedIdRef.current = String(vod.id);
    isSidebarFocusedRef.current = false;

    InteractionManager.runAfterInteractions(() => {
      updateCinematicBackground(vod.logo || null);
    });

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
    if (!url) { notify("Playback Unavailable", "No stream URL was found for this title.", "danger"); return; }
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
            logo: selectedVod?.logo || "",
            cmd: selectedVod?.streamUrl || url,
            // Required for resume — the player only saves/restores position
            // when it is given a stable content id.
            ...(contentId ? { contentId } : {}),
          },
        });
      }
    } catch (err) {
      console.error("Playback launch error:", err);
      notify("Playback Failed", "Failed to start playback. Make sure a video player app is installed.", "danger");
    }
  };

  const handleModalAction = async (isExternal: boolean) => {
    if (!selectedVod) return;
    const latestPortal = usePortalStore.getState().activePortal ?? activePortal;
    const titleSnapshot = selectedVod.name;
    const contentIdSnapshot = `vod:${selectedVod.id}`;
    let streamUrl: string | undefined = selectedVod.streamUrl;

    try {
      if (latestPortal?.type === "mag") {
        const cmd = streamUrl;
        if (cmd) {
          const resolved = await portalApi.getStreamUrl(latestPortal, cmd, "vod");
          if (resolved) streamUrl = resolved;
        }
      }
    } catch (e) {
      console.warn("Stream URL resolution failed:", e);
    }

    if (!streamUrl) {
      notify("Playback Unavailable", "Could not resolve a playable stream URL for this title.", "danger");
      return;
    }

    // A film is a queue of one. It still goes through the queue so the player's
    // banner, resume offer and percentage jump have something to describe — and
    // so `ownsItem` can tell a film opened from here apart from a season left
    // behind by an earlier visit to a series.
    if (!isExternal && latestPortal) {
      playbackQueue.start(
        queueFromVod(selectedVod),
        0,
        selectedVod.name,
        latestPortal.id,
        // Nothing follows a film, so nothing auto-advances.
        false
      );
    }

    startPlayback(streamUrl, isExternal, titleSnapshot, contentIdSnapshot);
  };

  const renderRow = useCallback(
    ({ item: row, index: rowIndex }: { item: { id: string; items: VODItem[] }; index: number }) => (
      <MovieRow
        row={row}
        rowIndex={rowIndex}
        numColumns={numColumns}
        itemWidth={itemWidth}
        focusedId={focusedIdRef.current}
        isSidebarFocused={isSidebarFocusedRef.current}
        onPress={handleVodPress}
        onFocus={handleVodFocus}
        onFavoritePress={handleFavoritePress}
        favorites={favorites.vod}
        resumeVersion={resumeVersion}
        parentalVersion={parentalVersion}
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [numColumns, itemWidth, handleVodPress, handleVodFocus, handleFavoritePress, favorites.vod, resumeVersion, parentalVersion]
  );

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
        const base = (activePortal?.config?.url || "").replace(/\/$/, "");
        const mapped = apiResults.map(i => ({
          id: String(i.id || i.cmd || ""),
          streamUrl: i.cmd || "",
          name: i.name || i.title,
          logo: buildImageUrl(base, i.screen_uri ?? i.screenshot_uri ?? i.poster ?? i.cover ?? i.logo ?? i.stream_icon ?? ""),
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
      // Searching is scoped to whatever the sidebar has selected.
      //
      // Both branches ignored the category, so pressing one while a search was
      // open moved the sidebar highlight and changed nothing else. And
      // `selectedCategory` was not a dependency, so even a category-aware pool
      // could not have re-run this.
      if (isXtreamOrM3U) {
        const needle = debouncedQuery.toLowerCase();
        return filterByCategory(allVodCacheRef.current, selectedCategory, categories)
          .filter((v) => v.name.toLowerCase().includes(needle))
          .slice(0, 100);
      }
      // Server-side search: it already matched the query, possibly on fields
      // this screen never sees, so only the category scope is applied here.
      return filterByCategory(searchResults, selectedCategory, categories);
    }

    // Default: return local display state (category-filtered and paginated)
    return displayVodItems;
  }, [displayVodItems, debouncedQuery, isXtreamOrM3U, searchResults, selectedCategory, categories]);

  // Only relevant while the grid has nothing to show; a background refresh must
  // never replace content that is already on screen with a spinner.
  const busy = isLoading || (syncing && filteredMovies.length === 0);

  const chunkedMovies = useMemo(() => {
    const chunks = [];
    for (let i = 0; i < filteredMovies.length; i += numColumns) {
      const slice = filteredMovies.slice(i, i + numColumns);
      const rowKey = slice[0]?.id ? `r-${slice[0].id}` : `row-${i}`;
      chunks.push({
        id: rowKey,
        items: slice,
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
      // See the note in live-tv.tsx: hidden categories leave the sidebar, not
      // the library.
      ...hiddenCategories.filter(
        "vod",
        categories.filter(c =>
          c.type === "vod" &&
          c.name.toLowerCase() !== "all" &&
          c.name.toLowerCase() !== "all movies"
        )
      ),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [categories, hiddenVersion]
  );

  // The sidebar owns focus on this screen: it takes the initial focus on entry
  // and keeps it when the category changes. No grid tile claims
  // `hasTVPreferredFocus`, so the user moves right into the grid deliberately.
  const focusSidebar = useInitialFocusPulse(sidebarCategories.length > 0);

  const ROW_HEIGHT = Math.round(itemWidth * 1.5 + pw(1) * 2);
  // No leading pad: FlatList already accounts for contentContainerStyle padding,
  // so adding it here made scrollToIndex land one pad short of the target row.
  const getItemLayout = useCallback((_: any, index: number) => ({
    length: ROW_HEIGHT,
    offset: index * ROW_HEIGHT,
    index,
  }), [ROW_HEIGHT]);

  const handleCategorySelect = useCallback((catId: string) => {
    isSidebarFocusedRef.current = false;
    focusedIdRef.current = "";
    FocusMemory.set("category-sidebar", catId);
    setSelectedCategory(catId);
    setSearchQuery("");
    setDebouncedQuery("");
  }, []);

  const handleCategoryFocus = useCallback(() => {
    isSidebarFocusedRef.current = true;
  }, []);

  // Back button handler: Directly return to dashboard
  useEffect(() => {
    const handleBack = () => {
      if (playModalVisible) {
        setPlayModalVisible(false);
        return true;
      }
      if (pinTarget) {
        setPinTarget(null);
        return true;
      }
      safeGoBack();
      return true;
    };

    const sub = BackHandler.addEventListener("hardwareBackPress", handleBack);
    return () => sub.remove();
  }, [playModalVisible, pinTarget, safeGoBack]);

  return (
    <View style={[S.container, { paddingTop: insets.top }]}>
      <View
        style={{ flex: 1 }}
        accessibilityElementsHidden={playModalVisible}
        importantForAccessibility={playModalVisible ? "no-hide-descendants" : "auto"}
      >
        <CinematicBackground />

        <View style={S.header}>
          <Text style={S.headerTitle}>Movies</Text>
          <FocusGroup style={S.searchWrapper}>
            {/* A real border now, not two stacked gradients faking one — see
                the matching note in live-tv.tsx. */}
            <View style={[S.searchGradient, searchFocused && S.searchGradientFocused, { flex: 1 }]}>
              <View style={[S.searchInner, searchFocused && { backgroundColor: "#0b0b10" }]}>
                <Ionicons name="search" size={ps(1.1)} color={searchFocused ? "#fff" : "rgba(255,255,255,0.3)"} style={{ marginRight: pw(1) }} />
                <TextInput
                  ref={searchInputRef}
                  style={S.searchInput}
                  placeholder="Search movies..."
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus={false}
                  focusable={isScreenFocused && !isFocusTrapped && !playModalVisible && !pinTarget}
                  editable={isScreenFocused && !isFocusTrapped && !playModalVisible && !pinTarget}
                  importantForAutofill="no"
                  textContentType="none"
                  returnKeyType="search"
                  onFocus={() => { setSearchFocused(true); isSidebarFocusedRef.current = false; }}
                  onBlur={() => setSearchFocused(false)}
                  onSubmitEditing={() => setSearchFocused(false)}
                />
              </View>
            </View>
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
              onSelect={handleCategorySelect}
              onFocus={handleCategoryFocus}
              width={SIDEBAR_WIDTH_VAL}
              autoFocusFirst={focusSidebar}
            />
          </FocusGroup>
          <View style={S.gridArea}>
            <FlatList
              ref={flatListRef}
              data={chunkedMovies}
              renderItem={renderRow}
              keyExtractor={(item) => item.id}
              getItemLayout={getItemLayout}
              contentContainerStyle={[S.list, (isLoading || chunkedMovies.length === 0) && { flexGrow: 1 }]}
              removeClippedSubviews={false}
              extraData={filteredMovies.length}
              initialNumToRender={isTV ? 4 : 4}
              maxToRenderPerBatch={isTV ? 2 : 2}
              windowSize={3}
              updateCellsBatchingPeriod={50}
              onEndReached={handleLoadMore}
              onEndReachedThreshold={0.5}
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
          </View>
        </View>
      </View>

      <Overlay
        visible={playModalVisible}
        onClose={() => setPlayModalVisible(false)}
        style={{ justifyContent: 'flex-end', backgroundColor: 'transparent' }}
        contentStyle={{ width: '100%', maxWidth: '100%', margin: 0, padding: 0 }}
      >
        {/* The opaque backgroundColor is load-bearing, not decoration.
            expo-blur renders as fully transparent on a good number of Android
            TV builds — there is no native blur to fall back on — and this sheet
            was relying on it for its entire backdrop, so the poster grid showed
            straight through the synopsis. The blur is now a bonus on devices
            that support it, over a base that is readable everywhere. */}
        <BlurView intensity={120} tint="dark" style={S.modalSurface}>
          {selectedVod?.logo && (
            <Image
              source={{ uri: selectedVod.logo }}
              style={[StyleSheet.absoluteFillObject, { opacity: 0.22 }]}
              blurRadius={50}
              contentFit="cover"
            />
          )}
          <LinearGradient
            colors={['rgba(10,12,18,0.78)', 'rgba(8,8,12,0.96)', '#08080a']}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={[isTV ? S.modalTVContent : null, S.modalBody]}>
            {/* Poster thumbnail */}
            <View style={S.modalPosterWrapper}>
              {selectedVod?.logo ? (
                <Image
                  source={{ uri: selectedVod.logo }}
                  style={S.modalPosterImg}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : (
                <View style={S.modalPosterFallback}>
                  <Ionicons name="film-outline" size={ps(3.2)} color="rgba(255,255,255,0.3)" />
                </View>
              )}
            </View>

            {/* Details */}
            <View style={S.modalLeft}>
              <View style={S.modalTypeBadge}>
                <Text style={S.modalTypeBadgeText}>MOVIE</Text>
              </View>
              <Text style={S.modalTitle} numberOfLines={2}>{selectedVod?.name}</Text>
              <View style={S.modalMetaRow}>
                <MetaFacts
                  facts={[
                    { icon: "star", iconColor: "#FFD700", text: selectedVod?.rating },
                    { text: selectedVod?.year },
                    { text: formatRuntime(selectedVod?.duration) },
                  ]}
                />
              </View>
              <MediaMetaPanel
                meta={vodMeta}
                fallbackPlot={selectedVod?.description}
                plotLines={isTV ? 5 : 3}
                emptyText="No description available for this title."
              />
            </View>

            {/* Actions */}
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
                      <Ionicons name="play" size={ps(1.1)} color="#000" />
                      <Text style={S.modalBtnPrimaryText}>WATCH NOW</Text>
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

      <PinPrompt
        visible={!!pinTarget}
        title="Title Locked"
        message={pinTarget ? `Enter your PIN to watch ${pinTarget.name}.` : ""}
        onSubmit={(pin) => parentalControl.unlock(pin)}
        onCancel={() => setPinTarget(null)}
        onSuccess={() => {
          setPinTarget(null);
          setPlayModalVisible(true);
        }}
      />

      {dialogNode}
    </View>
  );
}
