import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { View, StyleSheet, ActivityIndicator, Dimensions, Platform, FlatList, InteractionManager, BackHandler, Animated, Pressable , TextInput as RNTextInput, useWindowDimensions } from 'react-native';
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsFocused } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";

import { usePortalStore, VODItem, Category, MediaMeta } from "../src/store/portalStore";
import { portalApi, buildImageUrl } from "../src/services/portalApi";
import { M3UApi } from "../src/services/m3uApi";
import { XtreamApi } from "../src/services/xtreamApi";
import { cacheManager } from "../src/services/cacheManager";
import { THEME, pw, ph, ps } from "../src/theme/tokens";
import { TABLET_TILE_MAX_WIDTH, TILE_MAX_WIDTH, isTablet, SIDEBAR_WIDTH } from "../src/utils/tabletUtils";
import { isPhone, PHONE_GRID_COLUMNS, PHONE_H_PAD, PHONE_SEARCH_BAR_WIDTH } from "../src/utils/phoneUtils";
import { CinematicBackground, updateCinematicBackground } from "../src/components/CinematicBackground";
import { launchExternalPlayer } from "../src/utils/externalPlayer";
import CategorySidebar from "../src/components/CategorySidebar";
import CategoryPills from "../src/components/CategoryPills";
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
import { ExternalLink, Film, Heart, Lock, Play, RefreshCw, Search, X } from 'lucide-react-native';
import { DynamicIcon } from '../src/components/DynamicIcon';
import { Text } from '../src/components/Text';
import { TextInput } from '../src/components/TextInput';



/** Namespace for this screen's focus memory. */
const SCREEN_KEY = "vod";

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
  movieRow: { flexDirection: "row", overflow: "visible" },
  movieItemWrapper: {
    paddingHorizontal: 5,
    paddingTop: 4,
    paddingBottom: 4,
    overflow: "visible",
  },
  movieCardContainer: {
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
  movieCardContainerFocused: {},
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
  resumeBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 3.5,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  resumeProgress: { height: "100%", backgroundColor: "#F5F5F5" },
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

  // Modal Styles
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", alignItems: "center" },
  modalContainer: { width: ps(65), borderRadius: 36, padding: ps(2), overflow: "hidden" },
  modalSurface: {
    width: '100%',
    borderTopLeftRadius: ps(2),
    borderTopRightRadius: ps(2),
    overflow: 'hidden',
    backgroundColor: 'rgba(21, 21, 18, 0.98)',
  },
  /*
   * The play sheet is three columns — poster, details, actions — and on a phone
   * the third one collapses.
   *
   * `Overlay` renders this full width at the bottom, so the row has ~350dp to
   * divide: 113 goes to the poster and its gap, and the 1.4/0.65 split leaves
   * the actions column 75dp. Its own padding takes 15 and each button's
   * horizontal padding another 29, so "EXTERNAL PLAYER" and its icon are asked
   * to fit in 31dp.
   *
   * `flexWrap` is the fix rather than a full column stack. The phone sheet is
   * three stacked bands, and each one is a wrap line: the poster beside the
   * title block, then the description, then the actions. The two lower bands
   * take `width: "100%"`, which cannot share a line, so they break onto their
   * own automatically — no second container and no change to the TV layout,
   * which stays a single unwrapped row.
   */
  modalBody: {
    padding: isPhone ? PHONE_H_PAD : ps(2.2),
    flexDirection: "row",
    flexWrap: isPhone ? "wrap" : "nowrap",
    alignItems: isPhone ? "flex-start" : "center",
  },
  modalPosterWrapper: {
    // Smaller on a phone now that it only has to hold the first line beside the
    // title, rather than stand next to the whole synopsis.
    width: isPhone ? 72 : pw(11),
    aspectRatio: 2 / 3,
    borderRadius: ps(0.8),
    overflow: "hidden",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    marginRight: isPhone ? 12 : pw(2),
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
    paddingRight: isPhone ? 0 : ps(1.5),
    justifyContent: "center",
    // The title block is shorter than the 108dp poster it now sits beside, so
    // centre it against the poster instead of letting it hang from the top.
    // `alignSelf` rather than the row's `alignItems`, which would also move the
    // full-width bands below.
    alignSelf: isPhone ? "center" : "auto",
  },

  /** The synopsis and credits as their own full-width band, phones only. */
  modalDescBlock: {
    width: "100%",
    marginTop: 14,
  },
  modalRight: {
    // `flex: 0` with a full width is what forces the wrap onto a second line.
    flex: isPhone ? 0 : 0.65,
    width: isPhone ? "100%" : undefined,
    paddingLeft: isPhone ? 0 : ps(1.5),
    // Clears the details column above, whose last line is the DIRECTOR credit.
    //
    // The wrap puts the actions directly under whichever of the poster or the
    // details is taller, and with a 5-line plot plus credits it is always the
    // details — so this margin is the whole of the gap between the director
    // line and the first button. Without it they touch.
    marginTop: isPhone ? 32 : 0,
    justifyContent: "center",
    gap: isPhone ? 10 : ps(0.8),
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
  modalRatingBadge: {
    backgroundColor: "#B8860B",
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  modalRatingBadgeText: {
    color: "#FFFFFF",
    fontSize: ps(0.85),
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  modalMetaDot: {
    color: "#B8B8B8",
    fontSize: ps(1.05),
    fontWeight: "700",
    marginHorizontal: pw(0.8),
  },
  modalBtnWrapper: {
    borderRadius: 10,
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
    borderRadius: 10,
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
  loadMoreFooter: { paddingVertical: ph(3), alignItems: "center", justifyContent: "center" },
  loadMoreBtn: { flexDirection: "row", alignItems: "center", gap: pw(0.8), paddingHorizontal: pw(3), paddingVertical: ph(1.4), backgroundColor: "#17181c", borderRadius: 24, borderWidth: 0, borderColor: "transparent" },
  loadMoreBtnFocused: { borderColor: "transparent", borderWidth: 0, backgroundColor: "#F5F5F5", shadowColor: "#fff", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 12, elevation: 12 },
  loadMoreBtnText: { color: "#000000", fontSize: ps(1), fontWeight: "900", letterSpacing: 1.5 },
});

// ─────────────────────────────────────────────
// Movie Item Component (Black & White Design)
// ─────────────────────────────────────────────
const MovieItem = React.memo(function MovieItem({
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
  resumeVersion,
  trapFocusDown,
}: {
  item: VODItem;
  index?: number;
  onPress: (item: VODItem) => void;
  onFocus?: (item: VODItem, index?: number) => void;
  onFavoritePress: (item: VODItem) => void;
  isFavorite: boolean;
  itemWidth: number;
  tileWidth: number;
  posterHeight: number;
  isFocusedItem?: boolean;
  locked?: boolean;
  resumeVersion: number;
  trapFocusDown?: boolean;
}) {
  const handlePress = useCallback(() => {
    onPress(item);
  }, [onPress, item]);

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
    <View style={[S.movieItemWrapper, { width: itemWidth }]}>
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
              S.movieCardContainer,
              // Overrides the style's landscape cap: in portrait the column
              // count already sizes the tile, so it fills its slot.
              { width: tileWidth },
              focused && S.movieCardContainerFocused,
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

              {progress > 0 && progress < 0.98 ? (
                <View style={S.resumeBar}>
                  <View style={[S.resumeProgress, { width: `${Math.round(progress * 100)}%` }]} />
                </View>
              ) : null}

              {ratingVal ? (
                <View style={S.cornerRatingBadge}>
                  <Text style={S.cornerRatingText}>{ratingVal}</Text>
                </View>
              ) : null}
            </View>

            <Text
              style={[S.movieTitleText, focused && S.movieTitleTextFocused]}
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
    prevProps.resumeVersion === nextProps.resumeVersion &&
    prevProps.trapFocusDown === nextProps.trapFocusDown
  );
});

// ─────────────────────────────────────────────
// Memoized Movie Row (Prevents re-rendering all rows on focus change)
// ─────────────────────────────────────────────
interface MovieRowProps {
  row: { id: string; items: VODItem[] };
  rowIndex: number;
  totalRows: number;
  numColumns: number;
  itemWidth: number;
  tileWidth: number;
  posterHeight: number;
  rowHeight: number;
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
  resumeVersion,
}: MovieRowProps) {
  const isLastRow = rowIndex >= totalRows - 1;

  return (
    <View style={[S.movieRow, { height: rowHeight, overflow: "visible" }]}>
      {row.items.map((movie, colIndex) => {
        const itemIndex = rowIndex * numColumns + colIndex;
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
            tileWidth={tileWidth}
            posterHeight={posterHeight}
            isFocusedItem={isTargetFocus}
            locked={parentalControl.isRestricted("vod", movie)}
            resumeVersion={resumeVersion}
            trapFocusDown={isLastRow}
          />
        );
      })}
    </View>
  );
}, (prev, next) => {
  if (prev.row !== next.row) return false;
  if (prev.rowIndex !== next.rowIndex) return false;
  if (prev.totalRows !== next.totalRows) return false;
  if (prev.tileWidth !== next.tileWidth) return false;
  if (prev.itemWidth !== next.itemWidth) return false;
  if (prev.posterHeight !== next.posterHeight) return false;
  if (prev.rowHeight !== next.rowHeight) return false;
  if (prev.resumeVersion !== next.resumeVersion) return false;
  if (prev.parentalVersion !== next.parentalVersion) return false;
  if (prev.favorites !== next.favorites) {
    const hasFavChange = next.row.items.some(
      (m) => prev.favorites.includes(m.id) !== next.favorites.includes(m.id)
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

import { safeBack } from "../src/services/safeNavigation";

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
    safeBack();
  }, []);

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

  const [selectedCategory, setSelectedCategory] = useState<string>("");

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
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<VODItem[]>([]);
  const searchQueryRef = useRef("");
  searchQueryRef.current = searchQuery;

  const commitSearch = useCallback((overrideText?: string) => {
    const candidate = (typeof overrideText === "string" && overrideText.trim().length > 0)
      ? overrideText
      : (searchQueryRef.current || searchQuery);
    const q = (candidate || "").trim();
    console.log(`[VOD] commitSearch called with: "${q}"`);
    setDebouncedQuery(q);
    if (!q) {
      setIsSearchOpen(false);
      setSearchResults([]);
    }
  }, [searchQuery]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // True while *any* portal request is in flight, including ones this screen did
  // not start — the boot sync, the periodic refresh, the empty-body retry.
  const syncing = useNetworkActivity();
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

  const { width: SCREEN_WIDTH_VAL, height: SCREEN_HEIGHT_VAL } = useWindowDimensions();
  const isPortrait = !Platform.isTV && SCREEN_HEIGHT_VAL > SCREEN_WIDTH_VAL;

  // In portrait `SCREEN_WIDTH_VAL` is the shortest side, so `isPhone` is the
  // same test as a `>= 600` literal and says why. See live-tv.tsx.
  const numColumns = isPortrait ? (isPhone ? PHONE_GRID_COLUMNS : 4) : 5;

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
  const AVAILABLE_VIEWPORT_HEIGHT =
    SCREEN_HEIGHT_VAL - insets.top - insets.bottom - HEADER_HEIGHT_VAL - BODY_MARGIN_TOP - GRID_V_PADDING;
  const TITLE_SPACE = 28;

  // In landscape, 2 rows fill the viewport cleanly.
  // In portrait, compute posterHeight from tileWidth (2:3 poster aspect ratio) and allow natural scrolling.
  const targetVisibleRows = 2;
  const posterHeight = isPortrait
    ? Math.floor(tileWidth * 1.5)
    : Math.floor(Math.floor(AVAILABLE_VIEWPORT_HEIGHT / targetVisibleRows) - TITLE_SPACE - 8);
  const ROW_HEIGHT = isPortrait
    ? posterHeight + TITLE_SPACE + 14
    : Math.floor(AVAILABLE_VIEWPORT_HEIGHT / targetVisibleRows);
  const EXACT_GRID_HEIGHT = ROW_HEIGHT * targetVisibleRows + GRID_V_PADDING;

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

  const searchInputRef = useRef<RNTextInput>(null);

  const xtreamApiRef = useRef<XtreamApi | null>(null);
  const allVodCacheRef = useRef<VODItem[]>([]);
  const vodFetchPromiseRef = useRef<Promise<VODItem[]> | null>(null);
  // The current category's full filtered list — store/FlatList only see the
  // first N pages of this.
  const fullListRef = useRef<VODItem[]>([]);
  const prevCategoryIdRef = useRef<string | undefined>(undefined);
  const focusedIdRef = useRef<string>("");
  const isSidebarFocusedRef = useRef(true);
  const flatListRef = useRef<FlatList>(null);
  const gridScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bgUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (gridScrollTimeoutRef.current) clearTimeout(gridScrollTimeoutRef.current);
    if (bgUpdateTimerRef.current) clearTimeout(bgUpdateTimerRef.current);
  }, []);

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

  const hasInitializedCategoryRef = useRef(false);

  useEffect(() => {
    if (!activePortal) { router.replace("/"); return; }
    hasInitializedCategoryRef.current = false;
    vodFetchPromiseRef.current = null;
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

  const applyAdopted = useCallback((items: VODItem[]) => {
    setDisplayVodItems(items);
    setLoadFailed(false);
    setIsLoading(false);
  }, []);

  useAdoptStoreContent<VODItem>({
    storeItems: storeVodItems,
    cacheRef: allVodCacheRef,
    fullListRef,
    displayRef: displayVodItemsRef,
    categoryRef: selectedCategoryRef,
    categories,
    slicesFullList: activePortal?.type === "xtream" || activePortal?.type === "m3u",
    onAdopt: applyAdopted,
  });

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

    // Show loader immediately on category switch
    setIsLoading(true);
    setDisplayVodItems([]);

    if (activePortal?.type === "m3u" || activePortal?.type === "xtream") {
      const sourceList = allVodCacheRef.current.length > 0 ? allVodCacheRef.current : storeVodItems;
      if (sourceList.length > 0) {
        if (allVodCacheRef.current.length === 0) {
          allVodCacheRef.current = sourceList;
        }
        const filtered = filterByCategory(sourceList, cat, categories);
        fullListRef.current = filtered;
        const timer = setTimeout(() => {
          setDisplayVodItems(filtered);
          setIsLoading(false);
          restoreFocusPosition(filtered);
        }, 120);
        return () => clearTimeout(timer);
      } else {
        loadVodItems(selectedCategory, true);
      }
    } else {
      loadVodItems(selectedCategory, true);
    }
  }, [selectedCategory, activePortal?.id, categories]);

  const vodRequestIdRef = useRef(0);

  // Marks the screen as failed-to-load and asks the portal to resync once.
  const resyncRequestedRef = useRef(false);
  const reportLoadFailure = useCallback(() => {
    setLoadFailed(true);
    setIsLoading(false);
    if (resyncRequestedRef.current || !activePortal) return;
    resyncRequestedRef.current = true;
    AppBootManager.triggerBackgroundSync(activePortal, true).catch(() => { });
  }, [activePortal]);

  const loadVodItems = async (categoryId?: string, reset: boolean = false) => {
    if (!activePortal) return;
    const requestId = ++vodRequestIdRef.current;
    try {
      if (reset && displayVodItems.length === 0) {
        setIsLoading(true);
      }
      let items: VODItem[] = [];
      const cat = !categoryId || categoryId === "all" || categoryId === "*" ? undefined : categoryId;
      const targetCatId = categoryId ?? "all";

      if (activePortal.type === "m3u" || activePortal.type === "xtream") {
        let allItems = allVodCacheRef.current;
        if (allItems.length === 0) {
          if (storeVodItems.length > 0) {
            allItems = storeVodItems;
            allVodCacheRef.current = storeVodItems;
          } else {
            if (!vodFetchPromiseRef.current) {
              vodFetchPromiseRef.current = (async () => {
                try {
                  let fetched: VODItem[] = [];
                  if (activePortal.type === "m3u") {
                    fetched = await new M3UApi({ url: activePortal.config.url }).getVodItems(undefined);
                  } else if (activePortal.type === "xtream") {
                    fetched = await xtreamApiRef.current!.getVodItems(undefined, 1, 100000);
                  }
                  if (Array.isArray(fetched) && fetched.length > 0) {
                    allVodCacheRef.current = fetched;
                    setVodItems(fetched, activePortal.id);
                    return fetched;
                  } else {
                    reportLoadFailure();
                    return [];
                  }
                } finally {
                  vodFetchPromiseRef.current = null;
                }
              })();
            }
            const fetched = await vodFetchPromiseRef.current;
            allItems = fetched || [];
          }
        }

        if (allItems.length === 0) return;

        // Always filter for the user's currently active selectedCategoryRef
        const activeCat = selectedCategoryRef.current || selectedCategory || sidebarCategories[0]?.id;
        if (!activeCat) return;
        const filtered = filterByCategory(allItems, activeCat, categories);

        fullListRef.current = filtered;
        if (!reset) trapFocusBriefly();
        setLoadFailed(false);
        setDisplayVodItems(filtered);
        if (reset && filtered.length > 0) restoreFocusPosition(filtered);
      } else {
        const fresh = await portalApi.getVodItems(activePortal, cat, 1);
        if (requestId !== vodRequestIdRef.current || selectedCategoryRef.current !== targetCatId) return;

        items = Array.isArray(fresh) ? fresh : [];
        if (reset && items.length === 0) {
          reportLoadFailure();
          return;
        }
        if (!reset) trapFocusBriefly();
        setLoadFailed(false);
        setDisplayVodItems(items);
        setVodItems(items, activePortal.id);
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
    vodFetchPromiseRef.current = null;
    if (activePortal?.type === "xtream" || activePortal?.type === "m3u") {
      allVodCacheRef.current = [];
      fullListRef.current = [];
    }
    await loadCategories(true);
    await loadVodItems(selectedCategory, true);
    setRefreshing(false);
  }, [selectedCategory, activePortal, loadCategories]);

  const handleVodPress = useCallback(async (vod: VODItem) => {
    setSelectedVod(vod);
    selectedVodIdRef.current = String(vod.id);
    setVodMeta({ cast: vod.cast, director: vod.director, tags: vod.tags, plot: vod.plot, country: vod.country });

    if (parentalControl.isLocked("vod", vod)) {
      setPinTarget(vod);
      return;
    }
    setPlayModalVisible(true);

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
  }, [activePortal]);

  const currentGridTopRowRef = useRef(0);

  const handleVodFocus = useCallback((vod: VODItem, index?: number) => {
    focusedIdRef.current = String(vod.id);
    isSidebarFocusedRef.current = false;

    if (bgUpdateTimerRef.current) clearTimeout(bgUpdateTimerRef.current);
    bgUpdateTimerRef.current = setTimeout(() => {
      updateCinematicBackground(vod.logo || null);
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

  // Restore focus and viewport scroll position
  const restoreFocusPosition = useCallback((items: VODItem[]) => {
    if (!focusedIdRef.current || !flatListRef.current) return;
    const idx = items.findIndex(v => String(v.id) === focusedIdRef.current);
    if (idx >= 0) {
      const rowIndex = Math.floor(idx / numColumns);
      currentGridTopRowRef.current = rowIndex;
      const targetOffset = rowIndex * ROW_HEIGHT;
      setTimeout(() => {
        try {
          flatListRef.current?.scrollToOffset({ offset: targetOffset, animated: false });
        } catch { /* ignore */ }
      }, 120);
    }
  }, [numColumns, ROW_HEIGHT]);

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

    if (!isExternal && latestPortal) {
      playbackQueue.start(
        queueFromVod(selectedVod),
        0,
        selectedVod.name,
        latestPortal.id,
        false
      );
    }

    startPlayback(streamUrl, isExternal, titleSnapshot, contentIdSnapshot);
  };


  const isXtreamOrM3U = activePortal?.type === "xtream" || activePortal?.type === "m3u";

  // Remote search for non-Xtream/M3U portals
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
      if (isXtreamOrM3U) {
        const needle = debouncedQuery.toLowerCase();
        const pool =
          allVodCacheRef.current.length > 0
            ? allVodCacheRef.current
            : storeVodItems.length > 0
              ? storeVodItems
              : displayVodItems;
        return pool
          .filter((v) => (v.name || "").toLowerCase().includes(needle))
          .slice(0, 100);
      }
      return searchResults;
    }

    return displayVodItems;
  }, [displayVodItems, debouncedQuery, isXtreamOrM3U, searchResults, storeVodItems]);

  const busy = isLoading || ((isLoading || syncing) && filteredMovies.length === 0);

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

  const renderRow = useCallback(
    ({ item: row, index: rowIndex }: { item: { id: string; items: VODItem[] }; index: number }) => (
      <MovieRow
        row={row}
        rowIndex={rowIndex}
        totalRows={chunkedMovies.length}
        numColumns={numColumns}
        itemWidth={itemWidth}
        tileWidth={tileWidth}
        posterHeight={posterHeight}
        rowHeight={ROW_HEIGHT}
        onPress={handleVodPress}
        onFocus={handleVodFocus}
        onFavoritePress={handleFavoritePress}
        favorites={favorites.vod}
        resumeVersion={resumeVersion}
        parentalVersion={parentalVersion}
      />
    ),
    [chunkedMovies.length, numColumns, itemWidth, tileWidth, posterHeight, ROW_HEIGHT, handleVodPress, handleVodFocus, handleFavoritePress, favorites.vod, resumeVersion, parentalVersion]
  );



  const sidebarCategories: Category[] = useMemo(
    () => [
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

  useEffect(() => {
    if (sidebarCategories.length === 0) return;
    if (selectedCategory && sidebarCategories.some(c => isSameCat(c.id, selectedCategory))) {
      return;
    }
    if (hasInitializedCategoryRef.current) return;
    hasInitializedCategoryRef.current = true;

    const remembered = FocusMemory.get("category-sidebar");
    const matchRemembered = remembered && sidebarCategories.find(c => isSameCat(c.id, remembered));
    const defaultCat = matchRemembered ? matchRemembered.id : sidebarCategories[0].id;
    setSelectedCategory(defaultCat);
  }, [sidebarCategories, selectedCategory, isSameCat]);

  const focusSidebar = useInitialFocusPulse(sidebarCategories.length > 0);

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
      if (!isScreenFocused) return false;
      if (playModalVisible) {
        setPlayModalVisible(false);
        return true;
      }
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
  }, [isScreenFocused, playModalVisible, pinTarget, isSearchOpen]);

  /*
   * The play sheet's synopsis and credits, hoisted so the two layouts can put
   * them in different places without the element being written twice.
   *
   * On TV and tablet they belong inside the details column, beside the poster.
   * On a phone that column is only wide enough for the badge, the title and the
   * meta row, so the description drops to its own full-width block underneath —
   * see `modalDescBlock`. Only one of the two ever renders.
   */
  const vodMetaPanel = (
    <MediaMetaPanel
      meta={vodMeta}
      fallbackPlot={selectedVod?.description}
      plotLines={5}
      emptyText="No description available for this title."
    />
  );

  return (
    <View style={[S.container, { paddingTop: isPortrait ? Math.max(insets.top, 24) + 8 : insets.top }]}>
      <CinematicBackground />

      <View
        style={{ flex: 1 }}
        accessible={!playModalVisible}
        importantForAccessibility={playModalVisible ? "no-hide-descendants" : "auto"}
      >
        <CinematicBackground />

        <View style={S.header}>
          <View style={{ width: 38 }} />

          <View style={S.headerCenterTitleWrapper}>
            <Text style={S.headerTitle}>Movies</Text>
          </View>

          <View style={S.headerRight}>
            {isSearchOpen ? (
              <View style={S.searchOpenBar}>
                <Pressable onPress={() => commitSearch()} style={{ padding: 2 }}>
                  <Search size={ps(1.8)} color="rgba(255,255,255,0.75)" style={{ marginRight: pw(0.8) }} />
                </Pressable>
                <TextInput
                  ref={searchInputRef}
                  style={S.searchInput}
                  placeholder="Search movies..."
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
                  focusKey="vod-search-close-btn"
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
                focusKey="vod-search-btn"
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
              data={chunkedMovies}
              renderItem={renderRow}
              keyExtractor={(item) => item.id}
              getItemLayout={getItemLayout}
              style={isPortrait ? { flex: 1 } : { height: EXACT_GRID_HEIGHT, overflow: "hidden" }}
              contentContainerStyle={[S.list, { paddingBottom: insets.bottom + 24 }, (isLoading || chunkedMovies.length === 0) && { flexGrow: 1 }]}
              removeClippedSubviews={false}
              extraData={filteredMovies.length}
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
                    <Text style={[S.loadingText, { marginTop: 10 }]}>Brewing cinematic magic...</Text>
                  </View>
                ) : (
                  <View style={S.emptyState}>
                    <DynamicIcon
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
                              <RefreshCw size={ps(1.1)} color={focused ? "#000" : "#fff"} />
                              <Text style={[S.retryText, focused && { color: "#000" }]}>Retry</Text>
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
      </View>

      <Overlay
        visible={playModalVisible}
        onClose={() => setPlayModalVisible(false)}
        style={{ justifyContent: 'flex-end', backgroundColor: 'transparent' }}
        contentStyle={{ width: '100%', maxWidth: '100%', margin: 0, padding: 0 }}
      >
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
          {/* The sheet sits flush to the bottom edge, so on a phone the last
              button would otherwise land under the gesture bar. */}
          <View style={[S.modalBody, isPhone && { paddingBottom: 10 + insets.bottom }]}>
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
                  <Film size={ps(3.2)} color="rgba(255,255,255,0.3)" />
                </View>
              )}
              {selectedVod?.rating && parseFloat(String(selectedVod.rating)) > 0 ? (
                <View style={S.cornerRatingBadge}>
                  <Text style={S.cornerRatingText}>
                    {(() => {
                      const num = parseFloat(String(selectedVod.rating));
                      return Number.isInteger(num) ? num.toFixed(1) : String(Math.round(num * 10) / 10);
                    })()}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Details */}
            <View style={S.modalLeft}>
              <View style={S.modalTypeBadge}>
                <Text style={S.modalTypeBadgeText}>MOVIE</Text>
              </View>
              <Text style={S.modalTitle} numberOfLines={2}>{selectedVod?.name}</Text>
              <View style={S.modalMetaRow}>
                {(() => {
                  const r = selectedVod?.rating;
                  if (!r) return null;
                  const s = String(r).trim();
                  const lower = s.toLowerCase();
                  if (lower === "0" || lower === "0.0" || lower === "null" || lower === "undefined" || lower === "n/a") return null;
                  const num = parseFloat(s);
                  const formatted = !isNaN(num) && num > 0
                    ? (Number.isInteger(num) ? num.toFixed(1) : String(Math.round(num * 10) / 10))
                    : s;
                  return formatted ? (
                    <>
                      <View style={S.modalRatingBadge}>
                        <Text style={S.modalRatingBadgeText}>{formatted}</Text>
                      </View>
                      <Text style={S.modalMetaDot}>·</Text>
                    </>
                  ) : null;
                })()}
                <MetaFacts
                  facts={[
                    { text: selectedVod?.year },
                    { text: formatRuntime(selectedVod?.duration) },
                  ]}
                />
              </View>
              {!isPhone && vodMetaPanel}
            </View>

            {/* Description — its own full-width row on a phone. */}
            {isPhone && <View style={S.modalDescBlock}>{vodMetaPanel}</View>}

            {/* Actions */}
            <View style={S.modalRight}>
              <Focusable
                hasTVPreferredFocus
                ringOnFocus={false}
                onPress={() => handleModalAction(false)}
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
                onPress={() => handleModalAction(true)}
                style={S.modalBtnWrapper}
              >
                {(focused) => (
                  <View style={[S.modalBtnPill, focused && S.modalBtnPillFocused]}>
                    <ExternalLink size={ps(1.15)} color={focused ? "#000000" : "#FFFFFF"} />
                    <Text style={[S.modalBtnText, focused && S.modalBtnTextFocused]}>EXTERNAL PLAYER</Text>
                  </View>
                )}
              </Focusable>
              {/*
                * No Close button on a phone — the sheet already has two ways
                * out that a handset user reaches for first. `Overlay` defaults
                * `closeOnBack` to true and this one does not override it, so
                * both the backdrop tap and the hardware back dismiss it. The
                * button stays on TV, where neither of those exists: a remote
                * has no backdrop to tap, and back is the one it needs a target
                * for.
                */}
              {!isPhone && (
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
              )}
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
