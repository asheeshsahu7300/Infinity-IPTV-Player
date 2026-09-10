import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { View, StyleSheet, ActivityIndicator, Dimensions, FlatList, InteractionManager, BackHandler, Pressable , TextInput as RNTextInput, useWindowDimensions, Platform } from 'react-native';
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsFocused } from "@react-navigation/native";

import { usePortalStore, Series, Category } from "../src/store/portalStore";
import { portalApi, buildImageUrl } from "../src/services/portalApi";
import { M3UApi } from "../src/services/m3uApi";
import { XtreamApi } from "../src/services/xtreamApi";
import { cacheManager } from "../src/services/cacheManager";
import { THEME, pw, ph, ps } from "../src/theme/tokens";
import { TABLET_TILE_MAX_WIDTH, TILE_MAX_WIDTH, isTablet, SIDEBAR_WIDTH } from "../src/utils/tabletUtils";
import { isPhone, PHONE_GRID_COLUMNS, PHONE_SEARCH_BAR_WIDTH } from "../src/utils/phoneUtils";
import { CinematicBackground, updateCinematicBackground } from "../src/components/CinematicBackground";
import CategorySidebar from "../src/components/CategorySidebar";
import CategoryPills from "../src/components/CategoryPills";
import { AppBootManager } from "../src/services/AppBootManager";
import { filterByCategory, useAdoptStoreContent } from "../src/hooks/useCategoryContent";
import { useNetworkActivity } from "../src/services/networkActivity";
import { Focusable, FocusGroup, FocusMemory, useInitialFocusPulse, useIsFocusTrapped } from "../src/tv";
import { useDialog } from "../src/components/ConfirmDialog";
import { hiddenCategories } from "../src/services/hiddenCategories";
import { parentalControl } from "../src/services/parentalControl";
import { safeBack, safeNavigate } from "../src/services/safeNavigation";
import PinPrompt from "../src/components/PinPrompt";
import { Film, Heart, Lock, RefreshCw, Search, X } from 'lucide-react-native';
import { DynamicIcon } from '../src/components/DynamicIcon';
import { Text } from '../src/components/Text';
import { TextInput } from '../src/components/TextInput';



/** Namespace for this screen's focus memory. */
const SCREEN_KEY = "series";

// ─────────────────────────────────────────────
// Styles Defined at Top
// ─────────────────────────────────────────────
const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000000" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: pw(3),
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
  searchOpenBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#17181c",
    borderRadius: 22,
    paddingHorizontal: pw(1.4),
    height: 44,
    width: isPhone ? PHONE_SEARCH_BAR_WIDTH : pw(36),
    borderWidth: 0,
    borderColor: "transparent",
  },
  searchInput: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: ps(1.15),
    fontWeight: "600",
    paddingVertical: 0,
    textAlignVertical: "center",
  },
  body: { flex: 1, flexDirection: "row", marginTop: 10 },
  portraitPillsWrapper: {
    paddingVertical: 4,
    marginBottom: 6,
  },
  /** Pills above the grid instead of a sidebar beside it. */
  gridArea: { flex: 1, overflow: "hidden" },
  list: { paddingHorizontal: pw(1.2), paddingTop: 8, paddingBottom: 8 },
  seriesRow: { flexDirection: "row", overflow: "visible" },
  seriesItemWrapper: {
    paddingHorizontal: 5,
    paddingTop: 4,
    paddingBottom: 4,
    overflow: "visible",
  },
  seriesCardContainer: {
    // The tile, capped and centred on a tablet.
    //
    // The cap sits here rather than on `posterFrame` because the title is a
    // sibling of the poster, not a child: capping only the poster left the
    // title spanning the full 201dp slot and overhanging it either side.
    // Capping the container moves poster and title together, and the slack
    // becomes even gap instead of piling up at the end of the row.
    width: isTablet ? TABLET_TILE_MAX_WIDTH : "100%",
    alignSelf: "center",
    borderRadius: 16,
    overflow: "visible",
  },
  seriesCardContainerFocused: {},
  posterFrame: {
    width: "100%",
    borderRadius: 16,
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
  posterImage: { width: "100%", height: "100%" },
  posterFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#17181c",
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
  favoriteBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 12,
    padding: 5,
  },
  lockedBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 12,
    padding: 5,
  },
  seriesTitleText: {
    color: "rgba(255,255,255,0.75)",
    fontSize: ps(0.92),
    fontWeight: "700",
    marginTop: 8,
    lineHeight: 20,
  },
  seriesTitleTextFocused: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
  loadingCenter: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { color: "#B8B8B8", marginTop: 15, fontSize: ps(1.05), fontWeight: "600" },
  emptyState: { flex: 1, justifyContent: "center", alignItems: "center", paddingVertical: ph(6) },
  emptyTitle: { color: "#FFFFFF", fontSize: ps(1.4), marginTop: 12, fontWeight: "800" },
  emptySubtitle: { color: "#B8B8B8", fontSize: ps(1.05), marginTop: 6, textAlign: "center" },
  retryBtn: { marginTop: ph(2.5), borderRadius: 16, overflow: "visible" },
  retryInner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: pw(2.5),
    paddingVertical: ph(1.2),
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.10)",
    backgroundColor: "#161613CC",
  },
  retryInnerFocused: {
    backgroundColor: "#F9F4EA",
    borderColor: "#FFC857",
    elevation: 8,
  },
  retryText: { color: "#FFFFFF", fontSize: ps(1.05), fontWeight: "800", marginLeft: pw(0.6) },
});

// ─────────────────────────────────────────────
// Series Item Component (TV Optimized)
// ─────────────────────────────────────────────
const SeriesItem = React.memo(function SeriesItem({
  item,
  index,
  onPress,
  onFocus,
  onFavoritePress,
  isFavorite,
  itemWidth,
  tileWidth,
  posterHeight,
  isFocusedItem,
  locked,
  trapFocusDown,
}: {
  item: Series;
  index?: number;
  onPress: (item: Series) => void;
  onFocus?: (item: Series, index?: number) => void;
  onFavoritePress: (item: Series) => void;
  isFavorite: boolean;
  itemWidth: number;
  tileWidth: number;
  posterHeight: number;
  isFocusedItem?: boolean;
  locked?: boolean;
  trapFocusDown?: boolean;
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

  const ratingVal = useMemo(() => {
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
  }, [item.rating]);

  return (
    <View style={[S.seriesItemWrapper, { width: itemWidth }]}>
      <Focusable
        onPress={handlePress}
        onFocus={handleFocus}
        onLongPress={handleFavoritePress}
        hasTVPreferredFocus={isFocusedItem}
        trapFocusDown={trapFocusDown}
        ringOnFocus={false}
        screenKey={SCREEN_KEY}
        focusKey={String(item.id)}
        accessibilityLabel={item.name}
        accessibilityHint={isFavorite ? "In favourites. Hold to remove" : "Hold to add to favourites"}
      >
        {(focused) => (
          <View
            style={[
              S.seriesCardContainer,
              // Overrides the style's landscape cap: in portrait the column
              // count already sizes the tile, so it fills its slot.
              { width: tileWidth },
              focused && S.seriesCardContainerFocused,
            ]}
          >
            <View
              style={[
                S.posterFrame,
                { height: posterHeight },
                focused && S.posterFrameFocused,
              ]}
            >
              {item.logo ? (
                <Image
                  source={{ uri: item.logo }}
                  recyclingKey={item.logo}
                  style={S.posterImage}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={200}
                />
              ) : (
                <View style={[StyleSheet.absoluteFillObject, S.posterFallback]}>
                  <Film size={ps(4.2)} color="rgba(255,255,255,0.32)" />
                </View>
              )}

              {isFavorite && (
                <View style={S.favoriteBadge}>
                  <Heart size={ps(1.1)} color="#ffffff" />
                </View>
              )}

              {locked ? (
                <View style={S.lockedBadge}>
                  <Lock size={ps(0.95)} color="#ffffff" />
                </View>
              ) : null}

              {ratingVal ? (
                <View style={S.cornerRatingBadge}>
                  <Text style={S.cornerRatingText}>{ratingVal}</Text>
                </View>
              ) : null}
            </View>

            <Text
              style={[S.seriesTitleText, focused && S.seriesTitleTextFocused]}
              numberOfLines={1}
            >
              {item.name}
            </Text>
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
    prevProps.tileWidth === nextProps.tileWidth &&
    prevProps.posterHeight === nextProps.posterHeight &&
    prevProps.locked === nextProps.locked &&
    prevProps.trapFocusDown === nextProps.trapFocusDown
  );
});

// ─────────────────────────────────────────────
// Memoized Series Row (Prevents re-rendering all rows on focus change)
// ─────────────────────────────────────────────
interface SeriesRowProps {
  row: { id: string; items: Series[] };
  rowIndex: number;
  totalRows: number;
  numColumns: number;
  itemWidth: number;
  tileWidth: number;
  posterHeight: number;
  rowHeight: number;
  onPress: (item: Series) => void;
  onFocus: (item: Series, index?: number) => void;
  onFavoritePress: (item: Series) => void;
  favorites: string[];
  parentalVersion: number;
}

const SeriesRow = React.memo(function SeriesRow({
  row,
  rowIndex,
  totalRows,
  numColumns,
  itemWidth,
  tileWidth,
  posterHeight,
  rowHeight,
  onPress,
  onFocus,
  onFavoritePress,
  favorites,
}: SeriesRowProps) {
  const isLastRow = rowIndex >= totalRows - 1;

  return (
    <View style={[S.seriesRow, { height: rowHeight, overflow: "visible" }]}>
      {row.items.map((seriesItem, colIndex) => {
        const itemIndex = rowIndex * numColumns + colIndex;
        const isTargetFocus = false;

        return (
          <SeriesItem
            key={seriesItem.id}
            item={seriesItem}
            index={itemIndex}
            onPress={onPress}
            onFocus={onFocus}
            onFavoritePress={onFavoritePress}
            isFavorite={favorites.includes(seriesItem.id)}
            itemWidth={itemWidth}
            tileWidth={tileWidth}
            posterHeight={posterHeight}
            isFocusedItem={isTargetFocus}
            locked={parentalControl.isRestricted("series", seriesItem)}
            trapFocusDown={isLastRow}
          />
        );
      })}
    </View>
  );
}, (prev, next) => {
  if (prev.row !== next.row) return false;
  if (prev.tileWidth !== next.tileWidth) return false;
  if (prev.itemWidth !== next.itemWidth) return false;
  if (prev.posterHeight !== next.posterHeight) return false;
  if (prev.rowHeight !== next.rowHeight) return false;
  if (prev.totalRows !== next.totalRows) return false;
  if (prev.parentalVersion !== next.parentalVersion) return false;
  if (prev.favorites !== next.favorites) {
    const hasFavChange = next.row.items.some(
      (s) => prev.favorites.includes(s.id) !== next.favorites.includes(s.id)
    );
    if (hasFavChange) return false;
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
export default function SeriesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isScreenFocused = useIsFocused();
  const isFocusTrapped = useIsFocusTrapped();
  const { notify, node: dialogNode } = useDialog();

  const safeGoBack = useCallback(() => {
    safeBack();
  }, []);

  // Per-field selectors
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
  const [loadFailed, setLoadFailed] = useState(false);

  const [selectedCategory, setSelectedCategory] = useState<string>("");

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<Series[]>([]);
  const searchQueryRef = useRef("");
  searchQueryRef.current = searchQuery;

  const commitSearch = useCallback((overrideText?: string) => {
    const candidate = (typeof overrideText === "string" && overrideText.trim().length > 0)
      ? overrideText
      : (searchQueryRef.current || searchQuery);
    const q = (candidate || "").trim();
    console.log(`[Series] commitSearch called with: "${q}"`);
    setDebouncedQuery(q);
    if (!q) {
      setIsSearchOpen(false);
      setSearchResults([]);
    }
  }, [searchQuery]);
  const [isLoading, setIsLoading] = useState(true);

  const [hiddenVersion, setHiddenVersion] = useState(0);
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
  const syncing = useNetworkActivity();
  const [trappingFocus, setTrappingFocus] = useState(false);
  const trapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const focusedIdRef = useRef<string>("");
  const isSidebarFocusedRef = useRef(true);
  const flatListRef = useRef<FlatList>(null);
  const gridScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bgUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trapFocusBriefly = useCallback(() => {
    setTrappingFocus(true);
    if (trapTimeoutRef.current) clearTimeout(trapTimeoutRef.current);
    trapTimeoutRef.current = setTimeout(() => setTrappingFocus(false), 800);
  }, []);

  useEffect(() => () => {
    if (trapTimeoutRef.current) clearTimeout(trapTimeoutRef.current);
    if (gridScrollTimeoutRef.current) clearTimeout(gridScrollTimeoutRef.current);
    if (bgUpdateTimerRef.current) clearTimeout(bgUpdateTimerRef.current);
  }, []);

  const { width: SCREEN_WIDTH_VAL, height: SCREEN_HEIGHT_VAL } = useWindowDimensions();
  const isPortrait = !Platform.isTV && SCREEN_HEIGHT_VAL > SCREEN_WIDTH_VAL;

  // In portrait `SCREEN_WIDTH_VAL` is the shortest side, so `isPhone` is the
  // same test as a `>= 600` literal and says why. See live-tv.tsx.
  /*
   * Landscape column count follows the panel on a tablet.
   *
   * It was a fixed 5. The tile is capped at `TABLET_TILE_MAX_WIDTH`, so on a
   * wide panel the surplus had nowhere to go but the gaps: a 1506dp tablet got
   * a 239dp cell holding a 168dp poster — 71dp of dead space between every
   * column, against the 10 the box has — and a 1920 one got 146. The grid read
   * as scattered rather than as a grid.
   *
   * Dividing by the capped tile plus that 10dp gutter keeps the gutter at
   * exactly 10 everywhere and spends the width on more posters instead, which
   * is what `tabletClamp` says the surplus is for. `max(5, ...)` holds the
   * floor for smaller tablets, which already sit under the cap and are
   * unchanged; TV does not take this branch at all.
   */
  const numColumns = isPortrait
    ? (isPhone ? PHONE_GRID_COLUMNS : 4)
    : isTablet
      ? Math.max(
          5,
          Math.ceil(
            (SCREEN_WIDTH_VAL - SIDEBAR_WIDTH - pw(1.2) * 2) / (TABLET_TILE_MAX_WIDTH + 10)
          )
        )
      : 5;

  const SIDEBAR_WIDTH_VAL = isPortrait ? 0 : SIDEBAR_WIDTH;
  const GRID_H_PADDING = isPortrait ? 16 : pw(1.2) * 2;
  const itemWidth = Math.floor(
    (SCREEN_WIDTH_VAL - SIDEBAR_WIDTH_VAL - GRID_H_PADDING) / numColumns
  );

  const tileWidth = Math.min(itemWidth - 10, TILE_MAX_WIDTH);

  // Exactly 2 rows visible in viewport in landscape
  const HEADER_HEIGHT_VAL = 56;
  const BODY_MARGIN_TOP = 10;
  const GRID_V_PADDING = 16;
  /*
   * `insets.bottom` is deliberately NOT subtracted here.
   *
   * The grid's own `contentContainerStyle` already carries
   * `paddingBottom: insets.bottom + 24`, so the safe area is reserved inside
   * the scrollable content where it belongs. Taking it off the viewport as
   * well reserved it twice: the body ends up `screen - insets.bottom` tall and
   * the remainder is bare container underneath — a black band across the foot
   * of the screen with the rows squeezed to make room for it. Work the
   * arithmetic through and the leftover is exactly `insets.bottom`.
   *
   * `insets.top` is still subtracted, because the container pads by it rather
   * than any child doing so.
   */
  const AVAILABLE_VIEWPORT_HEIGHT =
    SCREEN_HEIGHT_VAL - insets.top - HEADER_HEIGHT_VAL - BODY_MARGIN_TOP - GRID_V_PADDING;
  const TITLE_SPACE = 28;

  // In landscape, 2 rows fill the viewport cleanly.
  // In portrait, compute posterHeight from tileWidth (2:3 poster aspect ratio) and allow natural scrolling.
  const targetVisibleRows = 2;
  /*
   * The poster keeps its 2:3 shape on every panel.
   *
   * Landscape used to take the height straight from `AVAILABLE / rows`, while
   * the width was capped at `TABLET_TILE_MAX_WIDTH`. Capping one axis and
   * letting the other grow with the viewport is what stretched the artwork:
   * a 1506x941 tablet produced a 168x393 poster — aspect 2.34 against the 1.50
   * a 2:3 poster wants — and the taller the tablet the worse it got.
   *
   * Taking the smaller of the two keeps the row's limit as a ceiling while the
   * aspect decides the actual height. On the box the two are already equal
   * (193 against 194), so this is a no-op there.
   */
  const posterHeight = isPortrait
    ? Math.floor(tileWidth * 1.5)
    : Math.min(
        Math.floor(Math.floor(AVAILABLE_VIEWPORT_HEIGHT / targetVisibleRows) - TITLE_SPACE - 8),
        Math.round(tileWidth * 1.5)
      );
  const ROW_HEIGHT = isPortrait
    ? posterHeight + TITLE_SPACE + 14
    : posterHeight + TITLE_SPACE + 8;
  /*
   * The body still fills the viewport even when the rows no longer divide it
   * exactly — otherwise shortening the row would reopen the black band at the
   * foot. A large tablet therefore shows *more* rows rather than taller ones,
   * which is what `tabletClamp` says the surplus space is for.
   */
  const EXACT_GRID_HEIGHT = isPortrait
    ? ROW_HEIGHT * targetVisibleRows + GRID_V_PADDING
    : AVAILABLE_VIEWPORT_HEIGHT + GRID_V_PADDING;

  const [pinTarget, setPinTarget] = useState<Series | null>(null);

  const xtreamApiRef = useRef<XtreamApi | null>(null);
  const allSeriesCacheRef = useRef<Series[]>([]);
  const seriesFetchPromiseRef = useRef<Promise<Series[]> | null>(null);
  const fullListRef = useRef<Series[]>([]);
  const prevCategoryIdRef = useRef<string | undefined>(undefined);
  const hasInitializedCategoryRef = useRef(false);

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
      let fetchedSeriesCats = (Array.isArray(cats) ? cats : []).map((c) => ({
        ...c,
        type: "series" as const,
      }));

      // Fallback: derive categories from cached/store Series items if API returns empty
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
      const others = currentCategories.filter((c) => c.type && c.type !== "series");
      if (fetchedSeriesCats.length > 0) {
        setCategories([...others, ...fetchedSeriesCats]);
      }
    } catch (e) {
      console.warn("Failed to load series categories:", e);
    }
  }, [setCategories]);

  useEffect(() => {
    if (!activePortal) {
      router.replace("/");
      return;
    }
    hasInitializedCategoryRef.current = false;
    seriesFetchPromiseRef.current = null;
    if (activePortal.type === "xtream") {
      xtreamApiRef.current = new XtreamApi({
        url: activePortal.config.url,
        username: activePortal.config.username!,
        password: activePortal.config.password!,
      });
    }
    loadCategories();
  }, [activePortal?.id, loadCategories, router]);

  const selectedSeriesCategoryRef = useRef(selectedCategory);
  useEffect(() => {
    selectedSeriesCategoryRef.current = selectedCategory;
  }, [selectedCategory]);

  const resyncRequestedRef = useRef(false);
  const reportLoadFailure = useCallback(() => {
    setLoadFailed(true);
    setIsLoading(false);
    if (resyncRequestedRef.current || !activePortal) return;
    resyncRequestedRef.current = true;
    AppBootManager.triggerBackgroundSync(activePortal, true).catch(() => { });
  }, [activePortal]);

  const applyAdopted = useCallback((items: Series[]) => {
    setDisplaySeries(items);
    setLoadFailed(false);
    setIsLoading(false);
  }, []);

  useAdoptStoreContent<Series>({
    storeItems: storeSeries,
    cacheRef: allSeriesCacheRef,
    fullListRef,
    displayRef: displaySeriesRef,
    categoryRef: selectedSeriesCategoryRef,
    categories,
    slicesFullList: activePortal?.type === "xtream" || activePortal?.type === "m3u",
    onAdopt: applyAdopted,
  });

  const seriesRequestIdRef = useRef(0);

  const loadSeries = async (categoryId?: string, reset: boolean = false) => {
    if (!activePortal) return;
    const requestId = ++seriesRequestIdRef.current;
    try {
      if (reset && displaySeries.length === 0) {
        setIsLoading(true);
      }
      let items: Series[] = [];
      const cat = !categoryId || categoryId === "all" || categoryId === "*" ? undefined : categoryId;
      const targetCatId = categoryId ?? "all";

      if (activePortal.type === "m3u" || activePortal.type === "xtream") {
        let allItems = allSeriesCacheRef.current;
        if (allItems.length === 0) {
          if (storeSeries.length > 0) {
            allItems = storeSeries;
            allSeriesCacheRef.current = storeSeries;
          } else {
            if (!seriesFetchPromiseRef.current) {
              seriesFetchPromiseRef.current = (async () => {
                try {
                  let fetched: Series[] = [];
                  if (activePortal.type === "m3u") {
                    fetched = await new M3UApi({ url: activePortal.config.url }).getSeries(undefined);
                  } else if (activePortal.type === "xtream") {
                    fetched = await xtreamApiRef.current!.getSeries(undefined, 1, 100000);
                  }
                  if (Array.isArray(fetched) && fetched.length > 0) {
                    allSeriesCacheRef.current = fetched;
                    setSeries(fetched, activePortal.id);
                    return fetched;
                  } else {
                    reportLoadFailure();
                    return [];
                  }
                } finally {
                  seriesFetchPromiseRef.current = null;
                }
              })();
            }
            const fetched = await seriesFetchPromiseRef.current;
            allItems = fetched || [];
          }
        }

        if (allItems.length === 0) return;

        const activeCat = selectedSeriesCategoryRef.current || selectedCategory || sidebarCategories[0]?.id;
        if (!activeCat) return;
        const filtered = filterByCategory(allItems, activeCat, categories);

        fullListRef.current = filtered;
        if (!reset) trapFocusBriefly();
        setLoadFailed(false);
        setDisplaySeries(filtered);
        if (reset && filtered.length > 0) restoreFocusPosition(filtered);
      } else {
        const fresh = await portalApi.getSeries(activePortal, cat, 1);
        if (requestId !== seriesRequestIdRef.current || selectedSeriesCategoryRef.current !== targetCatId) return;

        items = Array.isArray(fresh) ? fresh : [];
        if (reset && items.length === 0) {
          reportLoadFailure();
          return;
        }
        if (!reset) trapFocusBriefly();
        setLoadFailed(false);
        setDisplaySeries(items);
        setSeries(items, activePortal.id);
        if (reset) restoreFocusPosition(items);
      }
    } catch (e) {
      console.warn(e);
    } finally {
      setIsLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    resyncRequestedRef.current = false;
    seriesFetchPromiseRef.current = null;
    if (activePortal?.type === "xtream" || activePortal?.type === "m3u") {
      allSeriesCacheRef.current = [];
      fullListRef.current = [];
    }
    await loadCategories(true);
    await loadSeries(selectedCategory, true);
    setRefreshing(false);
  }, [selectedCategory, activePortal, loadCategories]);

  const navigateToSeries = useCallback((item: Series) => {
    safeNavigate("/series-details", {
      id: item.id,
      name: item.name,
      logo: item.logo,
      description: item.description,
      year: item.year,
      rating: item.rating,
      category: item.category || "",
    });
  }, []);

  const handleSeriesPress = useCallback((item: Series) => {
    if (parentalControl.isRestricted("series", item)) {
      setPinTarget(item);
      return;
    }
    navigateToSeries(item);
  }, [navigateToSeries]);

  const currentGridTopRowRef = useRef(0);

  const handleSeriesFocus = useCallback((item: Series, index?: number) => {
    focusedIdRef.current = String(item.id);
    isSidebarFocusedRef.current = false;

    if (bgUpdateTimerRef.current) clearTimeout(bgUpdateTimerRef.current);
    bgUpdateTimerRef.current = setTimeout(() => {
      updateCinematicBackground(item.logo || null);
    }, 120);

    if (index !== undefined) {
      const rowIndex = Math.floor(index / numColumns);
      if (currentGridTopRowRef.current !== rowIndex) {
        currentGridTopRowRef.current = rowIndex;
        const targetOffset = rowIndex * ROW_HEIGHT;
        if (gridScrollTimeoutRef.current) clearTimeout(gridScrollTimeoutRef.current);
        gridScrollTimeoutRef.current = setTimeout(() => {
          try {
            flatListRef.current?.scrollToOffset({ offset: targetOffset, animated: true });
          } catch { /* ignore */ }
        }, 16);
      }
    }
  }, [numColumns, ROW_HEIGHT]);

  const restoreFocusPosition = useCallback((items: Series[]) => {
    if (!focusedIdRef.current || !flatListRef.current) return;
    const idx = items.findIndex((s) => String(s.id) === focusedIdRef.current);
    if (idx >= 0) {
      const rowIndex = Math.floor(idx / numColumns);
      currentGridTopRowRef.current = rowIndex;
      const targetOffset = rowIndex * ROW_HEIGHT;
      setTimeout(() => {
        try {
          flatListRef.current?.scrollToOffset({ offset: targetOffset, animated: false });
        } catch {
          /* ignore if out of range */
        }
      }, 120);
    }
  }, [numColumns, ROW_HEIGHT]);

  const handleFavoritePress = useCallback((item: Series) => {
    toggleFavorite("series", item.id);
  }, [toggleFavorite]);


  const isXtreamOrM3U = activePortal?.type === "xtream" || activePortal?.type === "m3u";

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
        const mapped = apiResults.map((i) => ({
          id: String(i.id || i.cmd || ""),
          name: i.name || i.title,
          logo: buildImageUrl(
            base,
            i.screen_uri ?? i.screenshot_uri ?? i.cover ?? i.poster ?? i.logo ?? i.stream_icon ?? ""
          ),
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

  const filteredSeries = useMemo(() => {
    if (debouncedQuery) {
      if (isXtreamOrM3U) {
        const needle = debouncedQuery.toLowerCase();
        const pool =
          allSeriesCacheRef.current.length > 0
            ? allSeriesCacheRef.current
            : storeSeries.length > 0
              ? storeSeries
              : displaySeries;
        return pool
          .filter((s) => (s.name || "").toLowerCase().includes(needle))
          .slice(0, 100);
      }
      return searchResults;
    }
    return displaySeries;
  }, [displaySeries, debouncedQuery, isXtreamOrM3U, searchResults, storeSeries]);

  const busy = isLoading || (syncing && filteredSeries.length === 0);

  const chunkedSeries = useMemo(() => {
    const chunks = [];
    for (let i = 0; i < filteredSeries.length; i += numColumns) {
      const slice = filteredSeries.slice(i, i + numColumns);
      const rowKey = slice[0]?.id ? `r-${slice[0].id}` : `row-${i}`;
      chunks.push({
        id: rowKey,
        items: slice,
      });
    }
    return chunks;
  }, [filteredSeries, numColumns]);

  const renderRow = useCallback(
    ({ item: row, index: rowIndex }: { item: { id: string; items: Series[] }; index: number }) => (
      <SeriesRow
        row={row}
        rowIndex={rowIndex}
        totalRows={chunkedSeries.length}
        numColumns={numColumns}
        itemWidth={itemWidth}
        tileWidth={tileWidth}
        posterHeight={posterHeight}
        rowHeight={ROW_HEIGHT}
        onPress={handleSeriesPress}
        onFocus={handleSeriesFocus}
        onFavoritePress={handleFavoritePress}
        favorites={favorites.series}
        parentalVersion={parentalVersion}
      />
    ),
    [chunkedSeries.length, numColumns, itemWidth, tileWidth, posterHeight, ROW_HEIGHT, handleSeriesPress, handleSeriesFocus, handleFavoritePress, favorites.series, parentalVersion]
  );

  // Exact matching sidebarCategories from vod.tsx (no 'All Series' placeholder)
  const sidebarCategories: Category[] = useMemo(
    () => [
      ...hiddenCategories.filter(
        "series",
        (categories || []).filter(
          (c) =>
            (!c.type || c.type === "series") &&
            c.name.toLowerCase() !== "all" &&
            c.name.toLowerCase() !== "all series"
        )
      ),
    ],
    [categories, hiddenVersion]
  );

  const isSameCat = useCallback((a: any, b: any) => {
    if (!a || !b) return false;
    if (a === b) return true;
    const sa = String(a).trim();
    const sb = String(b).trim();
    if (sa === sb) return true;
    const rawA = sa.includes(":") ? sa.split(":")[1] : sa;
    const rawB = sb.includes(":") ? sb.split(":")[1] : sb;
    return rawA === rawB;
  }, []);

  // Initial category selection matching vod.tsx
  useEffect(() => {
    if (sidebarCategories.length === 0) return;
    if (selectedCategory && sidebarCategories.some((c) => isSameCat(c.id, selectedCategory))) {
      return;
    }
    if (hasInitializedCategoryRef.current) return;
    hasInitializedCategoryRef.current = true;

    const remembered = FocusMemory.get("category-sidebar");
    const matchRemembered = remembered && sidebarCategories.find((c) => isSameCat(c.id, remembered));
    const defaultCat = matchRemembered ? matchRemembered.id : sidebarCategories[0].id;
    setSelectedCategory(defaultCat);
  }, [sidebarCategories, selectedCategory, isSameCat]);

  // Category switch and data loading matching vod.tsx
  useEffect(() => {
    if (!activePortal || !selectedCategory) return;
    prevCategoryIdRef.current = selectedCategory;
    focusedIdRef.current = "";
    isSidebarFocusedRef.current = true;
    FocusMemory.set("category-sidebar", selectedCategory);
    currentGridTopRowRef.current = 0;
    if (gridScrollTimeoutRef.current) clearTimeout(gridScrollTimeoutRef.current);
    flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
    const cat = selectedCategory;

    setIsLoading(true);
    setDisplaySeries([]);

    if (activePortal?.type === "m3u" || activePortal?.type === "xtream") {
      const sourceList = allSeriesCacheRef.current.length > 0 ? allSeriesCacheRef.current : storeSeries;
      if (sourceList.length > 0) {
        if (allSeriesCacheRef.current.length === 0) {
          allSeriesCacheRef.current = sourceList;
        }
        const filtered = filterByCategory(sourceList, cat, categories);
        fullListRef.current = filtered;
        const timer = setTimeout(() => {
          setDisplaySeries(filtered);
          setIsLoading(false);
          restoreFocusPosition(filtered);
        }, 120);
        return () => clearTimeout(timer);
      } else {
        loadSeries(selectedCategory, true);
      }
    } else {
      loadSeries(selectedCategory, true);
    }
  }, [selectedCategory, activePortal?.id, categories]);

  const focusSidebar = useInitialFocusPulse(sidebarCategories.length > 0);

  const getItemLayout = useCallback((_: any, index: number) => ({
    length: ROW_HEIGHT,
    offset: index * ROW_HEIGHT,
    index,
  }), [ROW_HEIGHT]);

  const searchInputRef = useRef<RNTextInput>(null);

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
      if (!isScreenFocused) return false;
      if (pinTarget) {
        setPinTarget(null);
        return true;
      }
      if (isSearchOpen) {
        setIsSearchOpen(false);
        setSearchQuery("");
        setDebouncedQuery("");
        return true;
      }
      return safeBack();
    };

    const sub = BackHandler.addEventListener("hardwareBackPress", handleBack);
    return () => sub.remove();
  }, [isScreenFocused, pinTarget, isSearchOpen]);

  return (
    <View style={[S.container, { paddingTop: isPortrait ? Math.max(insets.top, 24) + 8 : insets.top }]}>
      <CinematicBackground />

      <View style={S.header}>
        <View style={{ width: 38 }} />

        <View style={S.headerCenterTitleWrapper}>
          <Text style={S.headerTitle}>TV Series</Text>
        </View>

        <View style={S.headerRight}>
          {isSearchOpen ? (
            <View style={S.searchOpenBar}>
              <Pressable onPress={() => commitSearch()} style={{ padding: 2 }}>
                <Search
                  size={ps(1.8)}
                  color="rgba(255,255,255,0.75)"
                  style={{ marginRight: pw(0.8) }}
                />
              </Pressable>
              <TextInput
                ref={searchInputRef}
                style={S.searchInput}
                placeholder="Search series..."
                placeholderTextColor="rgba(255,255,255,0.4)"
                value={searchQuery}
                onChangeText={(text) => {
                  searchQueryRef.current = text;
                  setSearchQuery(text);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus={true}
                returnKeyType="search"
                onSubmitEditing={(e) => commitSearch(e.nativeEvent?.text)}
                onEndEditing={(e) => commitSearch(e.nativeEvent?.text)}
                onKeyPress={(e) => {
                  if (e.nativeEvent.key === "Enter" || (e.nativeEvent as any).key === "Select") {
                    commitSearch();
                  }
                }}
              />
              <Focusable
                screenKey={SCREEN_KEY}
                focusKey="series-search-close"
                onPress={() => {
                  setSearchQuery("");
                  setDebouncedQuery("");
                  setIsSearchOpen(false);
                }}
                ringOnFocus={false}
                style={{ padding: 2, borderRadius: 18, justifyContent: "center", alignItems: "center" }}
              >
                {(focused) => (
                  <View style={focused ? { transform: [{ scale: 1.15 }] } : undefined}>
                    <X
                      size={ps(2.1)}
                      color={focused ? "#ffffff" : "rgba(255,255,255,0.75)"}
                    />
                  </View>
                )}
              </Focusable>
            </View>
          ) : (
            <Focusable
              screenKey={SCREEN_KEY}
              focusKey="series-search-btn"
              onPress={() => {
                setIsSearchOpen(true);
                setSearchQuery("");
                setDebouncedQuery("");
                setTimeout(() => searchInputRef.current?.focus(), 150);
              }}
              ringOnFocus={false}
              style={[S.searchBtnWrapper, { borderRadius: 24 }]}
            >
              {(focused) => (
                <View
                  style={[
                    S.searchCircleBtn,
                    focused && S.searchCircleBtnFocused,
                    { borderRadius: 22 },
                  ]}
                >
                  <Search size={ps(2.2)} color={focused ? "#000000" : "#ffffff"} />
                </View>
              )}
            </Focusable>
          )}
        </View>
      </View>

      {/* ─── Category Pills (Portrait Mode) ─── */}
      {isPortrait && (
        <View style={S.portraitPillsWrapper}>
          <CategoryPills
            categories={sidebarCategories}
            selectedId={selectedCategory || (sidebarCategories[0]?.id ?? "")}
            onSelect={handleCategorySelect}
          />
        </View>
      )}

      <View style={[S.body, isPortrait ? { flex: 1, height: undefined, flexDirection: "column", marginTop: 2 } : { height: EXACT_GRID_HEIGHT }]}>
        {!isPortrait && (
          <FocusGroup style={{ width: SIDEBAR_WIDTH_VAL, height: EXACT_GRID_HEIGHT }}>
            <CategorySidebar
              categories={sidebarCategories}
              selectedId={selectedCategory || (sidebarCategories[0]?.id ?? "")}
              onSelect={handleCategorySelect}
              onFocus={handleCategoryFocus}
              width={SIDEBAR_WIDTH_VAL}
              height={EXACT_GRID_HEIGHT}
              autoFocusFirst={focusSidebar}
            />
          </FocusGroup>
        )}

        <View style={[S.gridArea, isPortrait ? { flex: 1, height: undefined } : { height: EXACT_GRID_HEIGHT }]}>
          <FlatList
            ref={flatListRef}
            data={chunkedSeries}
            renderItem={renderRow}
            keyExtractor={(item) => item.id}
            getItemLayout={getItemLayout}
            style={isPortrait ? { flex: 1 } : { height: EXACT_GRID_HEIGHT, overflow: "hidden" }}
            contentContainerStyle={[
              S.list,
              { paddingBottom: insets.bottom + 24 },
              (isLoading || chunkedSeries.length === 0) && { flexGrow: 1 },
            ]}
            removeClippedSubviews={false}
            extraData={filteredSeries.length}
            initialNumToRender={6}
            maxToRenderPerBatch={6}
            windowSize={5}
            updateCellsBatchingPeriod={16}
            scrollEventThrottle={16}
            decelerationRate="fast"
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              busy ? (
                <View style={{ flex: 1, paddingVertical: ph(10), justifyContent: "center", alignItems: "center" }}>
                  <ActivityIndicator color={THEME.colors.primary} size="large" />
                  <Text style={[S.loadingText, { marginTop: 10 }]}>Loading series library...</Text>
                </View>
              ) : (
                <View style={S.emptyState}>
                  <DynamicIcon
                    name={loadFailed ? "cloud-off-outline" : "television-play"}
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
                            <RefreshCw size={ps(1.1)} color={focused ? "#111111" : "#FFFFFF"} />
                            <Text style={[S.retryText, focused && { color: "#111111" }]}>Retry</Text>
                          </View>
                        )}
                      </Focusable>
                    </>
                  ) : null}
                </View>
              )
            }
            ListFooterComponent={null}
          />
        </View>
      </View>

      <PinPrompt
        visible={!!pinTarget}
        title="Series Locked"
        message={pinTarget ? `Enter your PIN to view ${pinTarget.name}.` : ""}
        onSubmit={(pin) => parentalControl.unlock(pin)}
        onCancel={() => setPinTarget(null)}
        onSuccess={() => {
          const target = pinTarget;
          setPinTarget(null);
          if (target) navigateToSeries(target);
        }}
      />

      {dialogNode}
    </View>
  );
}