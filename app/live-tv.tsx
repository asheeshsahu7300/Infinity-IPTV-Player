import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { View, StyleSheet, ActivityIndicator, FlatList, Platform, InteractionManager, BackHandler, Pressable , TextInput as RNTextInput, useWindowDimensions } from 'react-native';
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsFocused } from "@react-navigation/native";

import { usePortalStore, Channel, Category } from "../src/store/portalStore";
import { portalApi } from "../src/services/portalApi";
import { M3UApi } from "../src/services/m3uApi";
import { XtreamApi } from "../src/services/xtreamApi";
import { StreamManager } from "../src/services/StreamManager";
import { cacheManager } from "../src/services/cacheManager";
import { THEME, pw, ph, ps } from "../src/theme/tokens";
import { TABLET_TILE_MAX_WIDTH, TILE_MAX_WIDTH, isTablet, SIDEBAR_WIDTH } from "../src/utils/tabletUtils";
import {
  isPhone,
  PHONE_GRID_COLUMNS,
  PHONE_NOTICE_MAX_WIDTH,
  PHONE_SEARCH_BAR_WIDTH,
} from "../src/utils/phoneUtils";
import CategorySidebar from "../src/components/CategorySidebar";
import CategoryPills from "../src/components/CategoryPills";
import { Focusable, FocusGroup, FocusMemory, STB_PRIORITY, useInitialFocusPulse, useStbKeys, useIsFocusTrapped } from "../src/tv";
import { useNetworkActivity } from "../src/services/networkActivity";
import { AppBootManager } from "../src/services/AppBootManager";
import { filterByCategory, useAdoptStoreContent } from "../src/hooks/useCategoryContent";
import { epgService } from "../src/services/epgService";
import { parentalControl } from "../src/services/parentalControl";
import { hiddenCategories } from "../src/services/hiddenCategories";
import { stbEnvironment } from "../src/services/stbEnvironment";
import { safeBack } from "../src/services/safeNavigation";
import { buildChannelNumbers, liveChannelSession, withChannelNumbers } from "../src/services/liveChannelSession";
import { useChannelTuner } from "../src/hooks/useChannelTuner";
import { ChannelTunerReadout } from "../src/components/ChannelTunerOverlay";
import PinPrompt from "../src/components/PinPrompt";
import { Info, Lock, RefreshCw, Search, Tv, X } from 'lucide-react-native';
import { DynamicIcon } from '../src/components/DynamicIcon';
import { Text } from '../src/components/Text';
import { TextInput } from '../src/components/TextInput';



/** Namespace for this screen's focus memory. */
const SCREEN_KEY = "live-tv";
const VISIBLE_ROWS = 3;

// ─────────────────────────────────────────────
// Styles Defined at Top
// ─────────────────────────────────────────────
const S = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },

  // ── Header ──
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

  // ── Body ──
  body: {
    flexDirection: "row",
    marginTop: 10,
  },
  portraitPillsWrapper: {
    paddingVertical: 4,
    marginBottom: 6,
  },
  /** Pills above the grid instead of a sidebar beside it. */
  gridArea: {
    flex: 1,
    overflow: "hidden",
  },

  // ── Cards ──
  gridContent: {
    paddingHorizontal: pw(1.2),
    paddingTop: isPhone ? 4 : 8,
    paddingBottom: isPhone ? 4 : 8,
  },
  gridRow: {
    flexDirection: "row",
    overflow: "visible",
  },
  cardWrapper: {
    paddingHorizontal: 5,
    // Halved on a phone: this padding is doubled up between rows, so 4 here is
    // 8dp of gap between tiles.
    paddingTop: isPhone ? 1 : 4,
    paddingBottom: isPhone ? 1 : 4,
  },
  cardBorder: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: "#17181c",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  cardBorderFocused: {
    borderColor: "#ffffff",
    borderWidth: 1,
    transform: [{ scale: 1.03 }],
    elevation: 12,
  },
  cardLogoWrapper: {
    width: "75%",
    flex: 1,
    maxHeight: "62%",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: ph(0.2),
  },
  cardLogo: {
    width: "100%",
    height: "100%",
  },
  cardFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    borderRadius: 8,
  },
  cardInfo: {
    alignItems: "center",
    width: "100%",
    paddingHorizontal: 6,
    // Trimmed on a phone so the row can shorten without the label losing room.
    paddingBottom: isPhone ? 0 : 6,
  },
  cardTitle: {
    color: "#FFFFFF",
    fontSize: ps(0.9),
    fontWeight: "700",
    textAlign: "center",
    // Explicit leading on the phone so the label's height is a number we know
    // rather than whatever the font's metrics produce. The row height is fixed
    // through `getItemLayout`, so the tighter the row gets the less the gap can
    // afford to be an estimate — with these pinned, the label is exactly 20dp
    // (11 + 9) and the remaining slack is real.
    ...(isPhone ? { lineHeight: 11 } : null),
  },
  cardTitleFocused: {
    fontWeight: "900",
  },
  cardCategory: {
    color: "#B8B8B8",
    fontSize: ps(0.72),
    fontWeight: "600",
    textAlign: "center",
    marginTop: isPhone ? 0 : 2,
    ...(isPhone ? { lineHeight: 9 } : null),
  },
  cardNumber: {
    position: "absolute",
    top: ps(0.4),
    left: ps(0.4),
    minWidth: ps(1.6),
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    alignItems: "center",
    zIndex: 2,
  },
  cardNumberText: {
    color: "#FFFFFF",
    fontSize: ps(0.7),
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  cardLock: {
    position: "absolute",
    top: ps(0.4),
    right: ps(0.4),
    zIndex: 2,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    borderRadius: 4,
    padding: 2,
  },

  // ── States ──
  loadingCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: ph(2),
  },
  loadingText: {
    color: "#B8B8B8",
    fontSize: ps(1),
    fontWeight: "600",
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: ph(8),
    gap: ph(1.2),
  },
  emptyTitle: {
    color: "#FFFFFF",
    fontSize: ps(1.4),
    fontWeight: "800",
  },
  emptySubtitle: {
    color: "#B8B8B8",
    fontSize: ps(1.05),
  },
  retryBtn: {
    marginTop: ph(2),
    borderRadius: 16,
    overflow: "visible",
  },
  retryInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(0.8),
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
  retryText: {
    color: "#FFFFFF",
    fontSize: ps(1.05),
    fontWeight: "800",
    marginLeft: pw(0.6),
  },

  // ── Notice ──
  notice: {
    position: "absolute",
    top: ph(10),
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: pw(0.8),
    paddingHorizontal: pw(2),
    paddingVertical: ph(1),
    borderRadius: ps(1),
    backgroundColor: "rgba(21, 21, 18, 0.95)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.16)",
    maxWidth: isPhone ? PHONE_NOTICE_MAX_WIDTH : pw(60),
    zIndex: 70,
  },
  noticeText: {
    color: "#FFFFFF",
    fontSize: ps(1),
    fontWeight: "700",
  },
});

// ─────────────────────────────────────────────
// Channel Card — single Focusable
// ─────────────────────────────────────────────
const ChannelCard = React.memo(function ChannelCard({
  item,
  index,
  onPress,
  onLongPress,
  onFocus,
  isFocusedItem,
  itemWidth,
  tileWidth,
  cardHeight,
  channelNumber,
  locked,
  trapFocusDown,
}: {
  item: Channel;
  index?: number;
  onPress: (item: Channel) => void;
  onLongPress?: (item: Channel) => void;
  onFocus?: (item: Channel, index?: number) => void;
  isFocusedItem?: boolean;
  itemWidth: number;
  tileWidth: number;
  cardHeight: number;
  channelNumber?: number;
  locked?: boolean;
  trapFocusDown?: boolean;
}) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [item.logo]);

  const handlePress = useCallback(() => {
    onPress(item);
  }, [onPress, item]);

  const handleFocus = useCallback(() => {
    onFocus?.(item, index);
  }, [onFocus, item, index]);

  const handleLongPress = useCallback(() => {
    onLongPress?.(item);
  }, [onLongPress, item]);

  return (
    <View style={[S.cardWrapper, { width: itemWidth }]}>
      <Focusable
        onPress={handlePress}
        onLongPress={handleLongPress}
        onFocus={handleFocus}
        hasTVPreferredFocus={isFocusedItem}
        trapFocusDown={trapFocusDown}
        ringOnFocus={false}
        screenKey={SCREEN_KEY}
        focusKey={String(item.id)}
        accessibilityLabel={item.category ? `${item.name}, ${item.category}` : item.name}
      >
        {(focused) => (
          <View
            style={[
              S.cardBorder,
              {
                height: cardHeight,
                // Capped and centred on a tablet, as with the poster grids.
                width: tileWidth,
                alignSelf: "center",
              },
              focused && S.cardBorderFocused,
            ]}
          >
            {channelNumber ? (
              <View style={S.cardNumber}>
                <Text style={S.cardNumberText}>{channelNumber}</Text>
              </View>
            ) : null}

            {locked ? (
              <View style={S.cardLock}>
                <Lock size={ps(0.85)} color="#ffffff" />
              </View>
            ) : null}

            <View style={S.cardLogoWrapper}>
              {item.logo && !imgError ? (
                <Image
                  source={{ uri: item.logo }}
                  recyclingKey={item.logo}
                  style={S.cardLogo}
                  contentFit="contain"
                  cachePolicy="memory-disk"
                  transition={200}
                  onError={() => setImgError(true)}
                />
              ) : (
                <View style={S.cardFallback}>
                  <Tv size={ps(2.5)} color="rgba(255,255,255,0.28)" />
                </View>
              )}
            </View>

            <View style={S.cardInfo}>
              <Text
                style={[S.cardTitle, focused && S.cardTitleFocused]}
                numberOfLines={1}
              >
                {item.name}
              </Text>
              {item.category ? (
                <Text style={S.cardCategory} numberOfLines={1}>
                  {item.category}
                </Text>
              ) : null}
            </View>
          </View>
        )}
      </Focusable>
    </View>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.item.logo === nextProps.item.logo &&
    prevProps.item.name === nextProps.item.name &&
    prevProps.isFocusedItem === nextProps.isFocusedItem &&
    prevProps.itemWidth === nextProps.itemWidth &&
    prevProps.tileWidth === nextProps.tileWidth &&
    prevProps.cardHeight === nextProps.cardHeight &&
    prevProps.channelNumber === nextProps.channelNumber &&
    prevProps.locked === nextProps.locked &&
    prevProps.trapFocusDown === nextProps.trapFocusDown
  );
});

// ─────────────────────────────────────────────
// Memoized Channel Row
// ─────────────────────────────────────────────
interface ChannelRowProps {
  row: { id: string; items: Channel[] };
  rowIndex: number;
  totalRows: number;
  numColumns: number;
  itemWidth: number;
  tileWidth: number;
  cardHeight: number;
  rowHeight: number;
  focusedId: string;
  isSidebarFocused: boolean;
  tunedFocusId: string | null;
  onPress: (item: Channel) => void;
  onLongPress: (item: Channel) => void;
  onFocus: (item: Channel, index?: number) => void;
  channelNumbers: Map<string, number>;
  parentalVersion: number;
}

const ChannelRow = React.memo(function ChannelRow({
  row,
  rowIndex,
  totalRows,
  numColumns,
  itemWidth,
  tileWidth,
  cardHeight,
  rowHeight,
  focusedId,
  isSidebarFocused,
  tunedFocusId,
  onPress,
  onLongPress,
  onFocus,
  channelNumbers,
}: ChannelRowProps) {
  const isLastRow = rowIndex >= totalRows - 1;

  return (
    <View style={[S.gridRow, { height: rowHeight }]}>
      {row.items.map((channel, colIndex) => {
        const itemIndex = rowIndex * numColumns + colIndex;
        const id = String(channel.id);
        const isTargetFocus = tunedFocusId === id;

        return (
          <ChannelCard
            key={channel.id}
            item={channel}
            index={itemIndex}
            itemWidth={itemWidth}
            tileWidth={tileWidth}
            cardHeight={cardHeight}
            channelNumber={channel.num && channel.num > 0 ? channel.num : channelNumbers.get(id)}
            locked={parentalControl.isChannelRestricted(channel)}
            isFocusedItem={isTargetFocus}
            trapFocusDown={isLastRow}
            onPress={onPress}
            onLongPress={onLongPress}
            onFocus={onFocus}
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
  if (prev.cardHeight !== next.cardHeight) return false;
  if (prev.rowHeight !== next.rowHeight) return false;
  if (prev.parentalVersion !== next.parentalVersion) return false;
  if (prev.tunedFocusId !== next.tunedFocusId) return false;

  const wasFocused = next.row.items.some((c) => String(c.id) === prev.focusedId);
  const isFocused = next.row.items.some((c) => String(c.id) === next.focusedId);
  if (wasFocused || isFocused) {
    if (prev.focusedId !== next.focusedId || prev.isSidebarFocused !== next.isSidebarFocused) {
      return false;
    }
  }
  return true;
});

// ─────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────
export default function LiveTVScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isScreenFocused = useIsFocused();
  const isFocusTrapped = useIsFocusTrapped();

  const safeGoBack = useCallback(() => {
    safeBack();
  }, []);

  const storeChannels = usePortalStore((s) => s.channels);
  const storeCategories = usePortalStore((s) => s.categories);
  const activePortal = usePortalStore((s) => s.activePortal);
  const setChannels = usePortalStore((s) => s.setChannels);
  const setCategories = usePortalStore((s) => s.setCategories);

  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [displayChannels, setDisplayChannels] = useState<Channel[]>([]);
  const displayChannelsRef = useRef<Channel[]>([]);
  displayChannelsRef.current = displayChannels;
  const selectedCategoryRef = useRef(selectedCategory);
  selectedCategoryRef.current = selectedCategory;

  const [isLoading, setIsLoading] = useState(storeChannels.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const syncing = useNetworkActivity();
  const [loadFailed, setLoadFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [trappingFocus, setTrappingFocus] = useState(false);
  const trapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<RNTextInput>(null);
  const focusedIdRef = useRef<string>("");
  const isSidebarFocusedRef = useRef(true);
  const flatListRef = useRef<FlatList>(null);
  const currentGridTopRowRef = useRef(0);
  const gridScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasInitializedCategoryRef = useRef(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchQueryRef = useRef("");
  searchQueryRef.current = searchQuery;

  const commitSearch = useCallback((overrideText?: string) => {
    const candidate = (typeof overrideText === "string" && overrideText.trim().length > 0)
      ? overrideText
      : (searchQueryRef.current || searchQuery);
    const q = (candidate || "").trim();
    console.log(`[LiveTV] commitSearch called with: "${q}"`);
    setDebouncedQuery(q);
    if (!q) {
      setIsSearchOpen(false);
    }
  }, [searchQuery]);

  const { width: SCREEN_WIDTH_VAL, height: SCREEN_HEIGHT_VAL } = useWindowDimensions();
  const isPortrait = !Platform.isTV && SCREEN_HEIGHT_VAL > SCREEN_WIDTH_VAL;

  // Sizing: In landscape 5 columns. In portrait: 4 columns for tablets, 3 for
  // phones. `isPhone` rather than a second `>= 600` literal — in portrait
  // `SCREEN_WIDTH_VAL` is the shortest side, so the two are the same test, and
  // the device class is the one that says why.
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

  // On TV, VISIBLE_ROWS (3) rows fill the viewport.
  // In landscape, 3 rows fit cleanly. In portrait, allow channel cards to scroll naturally.
  const targetVisibleRows = isTablet ? 3 : VISIBLE_ROWS;
  // The portrait row is the tile plus room for its two label lines.
  //
  // The gap a viewer sees between tiles is simply `extra - label`: the wrapper
  // padding and the leftover slack add up to whatever the label does not use.
  //
  // On a phone the label is pinned to exactly 20dp — `cardTitle` and
  // `cardCategory` carry explicit `lineHeight`s (11 + 9), the category's top
  // margin is 0 and `cardInfo`'s bottom padding is 0 — so 24 leaves 4dp of air
  // between one tile's label and the next tile, down from ~18 at the original
  // 48. Every dp of that came from making the label smaller or more certain,
  // not from letting the row overlap it.
  //
  // 24 is close to the floor. The row height is fixed through `getItemLayout`,
  // so anything the label overruns is clipped rather than scrolled, and only
  // ~2dp of slack is left. Below this, shorten the label first.
  /*
   * The channel card keeps its shape on every panel.
   *
   * Landscape took the row height from `AVAILABLE / rows` while the tile width
   * was capped at `TABLET_TILE_MAX_WIDTH`, so a taller tablet made a taller
   * card against a fixed width: 168x274 on a 1506x941 panel, against 129x140
   * on the box. Bounding the row by the card's own proportion instead keeps
   * the shape and turns the extra height into more rows.
   *
   * 1.085 is the ratio the box already renders (140 over 129), so the two
   * bounds are equal there and this changes nothing on TV.
   */
  const CARD_ASPECT = 1.085;
  const ROW_HEIGHT = isPortrait
    ? Math.floor(tileWidth + (isPhone ? 24 : 48))
    : Math.min(
        Math.floor(AVAILABLE_VIEWPORT_HEIGHT / targetVisibleRows),
        Math.round(tileWidth * CARD_ASPECT) + 12
      );
  // Fills the viewport even when the rows no longer divide it exactly, so a
  // shorter row cannot reopen the black band at the foot of the screen.
  const EXACT_GRID_HEIGHT = isPortrait
    ? ROW_HEIGHT * targetVisibleRows + GRID_V_PADDING
    : AVAILABLE_VIEWPORT_HEIGHT + GRID_V_PADDING;
  const cardHeight = isPortrait
    ? Math.floor(tileWidth)
    : Math.floor(ROW_HEIGHT - 12);

  const PAGE_SIZE = numColumns * Math.ceil(28 / numColumns);

  // STB layer
  const [epgVersion, setEpgVersion] = useState(0);
  const [focusedChannel, setFocusedChannel] = useState<Channel | null>(null);
  const [tunedFocusId, setTunedFocusId] = useState<string | null>(null);
  const [pinTarget, setPinTarget] = useState<Channel | null>(null);
  const [lockTarget, setLockTarget] = useState<Channel | null>(null);
  const [parentalVersion, setParentalVersion] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [hiddenVersion, setHiddenVersion] = useState(0);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleChannelPressRef = useRef<(channel: Channel) => void>(() => { });
  const numberedListRef = useRef<(list: Channel[]) => Channel[]>((l) => l);

  const xtreamApiRef = useRef<XtreamApi | null>(null);
  const allChannelsCacheRef = useRef<Channel[]>([]);
  const fullListRef = useRef<Channel[]>([]);
  const prevCategoryIdRef = useRef<string | undefined>(undefined);

  const trapFocusBriefly = useCallback(() => {
    setTrappingFocus(true);
    if (trapTimeoutRef.current) clearTimeout(trapTimeoutRef.current);
    trapTimeoutRef.current = setTimeout(() => setTrappingFocus(false), 800);
  }, []);

  useEffect(() => () => {
    if (trapTimeoutRef.current) clearTimeout(trapTimeoutRef.current);
    if (gridScrollTimeoutRef.current) clearTimeout(gridScrollTimeoutRef.current);
    if (focusedChannelTimerRef.current) clearTimeout(focusedChannelTimerRef.current);
    if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
  }, []);

  useEffect(() => {
    const unsubscribeEpg = epgService.subscribe(() => setEpgVersion((v) => v + 1));
    const unsubscribeLock = parentalControl.subscribe(() => setParentalVersion((v) => v + 1));
    parentalControl.load().then(() => setParentalVersion((v) => v + 1));
    hiddenCategories.load().then(() => setHiddenVersion((v) => v + 1));
    const unsubscribeHidden = hiddenCategories.subscribe(() =>
      setHiddenVersion((v) => v + 1)
    );
    stbEnvironment.load();
    return () => {
      unsubscribeEpg();
      unsubscribeLock();
      unsubscribeHidden();
    };
  }, []);

  useEffect(() => {
    if (!activePortal) return;
    liveChannelSession.clear();
    epgService
      .loadBulk(activePortal, { allowLargeXmltv: stbEnvironment.snapshot.fullXmltvGuide })
      .catch(() => { });
  }, [activePortal?.id]);

  const localCategories = useMemo(
    () => (storeCategories || []).filter(c => c.type === "live"),
    [storeCategories]
  );

  const loadCategories = useCallback(async (force = false) => {
    const portal = usePortalStore.getState().activePortal;
    if (!portal) return;
    try {
      if (force) {
        await cacheManager.removeByPrefix(`portal:${portal.id}:live:categories`);
        await cacheManager.removeByPrefix(`portal:${portal.id}:categories`);
      }
      let cats: Category[] = [];
      if (portal.type === "m3u") {
        const api = new M3UApi({ url: portal.config.url, portalId: portal.id });
        cats = ((await api.getLiveCategories()) || []) as Category[];
      } else if (portal.type === "xtream") {
        const raw = (await xtreamApiRef.current!.getitvCategories()) || [];
        cats = raw.map((c: any) => ({ id: c.id, name: c.name, type: "live" as const }));
      } else {
        cats = (await portalApi.getLiveCategories(portal)) || [];
      }

      if (cats.length === 0 && allChannelsCacheRef.current.length > 0) {
        const seen = new Set<string>();
        cats = [];
        for (const item of allChannelsCacheRef.current) {
          const cId = item.categoryId || item.category;
          const cName = item.category || item.categoryId;
          if (cId && !seen.has(cId) && cId !== "all" && cId !== "*") {
            seen.add(cId);
            cats.push({
              id: cId,
              name: cName || cId,
              type: "live" as const,
            });
          }
        }
      }

      const currentCategories = usePortalStore.getState().categories || [];
      const others = currentCategories.filter(c => c.type !== "live");
      if (cats.length > 0) {
        setCategories([...others, ...cats]);
      }
    } catch (e) {
      console.warn("loadCategories error:", e);
    }
  }, [setCategories]);

  const fetchAllChannels = useCallback(async (): Promise<Channel[]> => {
    if (!activePortal) return [];
    let all: Channel[] = [];

    if (activePortal.type === "m3u") {
      const api = new M3UApi({ url: activePortal.config.url, portalId: activePortal.id });
      const raw = (await api.getLiveChannels(undefined, 1, 100000)) || [];
      if (Array.isArray(raw)) {
        all = raw.map((c: any) => ({
          id: String(c.id),
          name: c.name,
          logo: c.logo,
          category: c.category,
          categoryId: c.categoryId ?? c.category,
          streamUrl: c.streamUrl,
        }));
      }
    } else if (activePortal.type === "xtream") {
      all = (await xtreamApiRef.current!.getitvChannels(undefined, 1, 100000)) || [];
    }

    if (all.length > 0) setChannels(all, activePortal.id);
    return all;
  }, [activePortal, setChannels]);

  const fetchAllChannelsInBackground = useCallback(() => {
    InteractionManager.runAfterInteractions(() => {
      fetchAllChannels()
        .then((all) => {
          if (all.length > 0) allChannelsCacheRef.current = all;
        })
        .catch((e) => console.warn("Background channel refresh failed:", e));
    });
  }, [fetchAllChannels]);

  const resyncRequestedRef = useRef(false);
  const reportLoadFailure = useCallback(() => {
    setLoadFailed(true);
    setHasMore(false);
    if (resyncRequestedRef.current || !activePortal) return;
    resyncRequestedRef.current = true;
    AppBootManager.triggerBackgroundSync(activePortal, true).catch(() => { });
  }, [activePortal]);

  const applyAdopted = useCallback((slice: Channel[], filteredTotal: number) => {
    setDisplayChannels(slice);
    setHasMore(filteredTotal > slice.length);
    setLoadFailed(false);
    setIsLoading(false);
    setPage(1);
  }, []);

  useAdoptStoreContent<Channel>({
    storeItems: storeChannels,
    cacheRef: allChannelsCacheRef,
    fullListRef,
    displayRef: displayChannelsRef,
    categoryRef: selectedCategoryRef,
    categories: storeCategories,
    pageSize: PAGE_SIZE,
    slicesFullList: activePortal?.type === "xtream" || activePortal?.type === "m3u",
    onAdopt: applyAdopted,
  });

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

      if (activePortal.type === "m3u" || activePortal.type === "xtream") {
        if (allChannelsCacheRef.current.length === 0) {
          if (storeChannels.length > 0) {
            allChannelsCacheRef.current = storeChannels;
            fetchAllChannelsInBackground();
          } else {
            const fetched = await fetchAllChannels();
            if (fetched.length > 0) {
              allChannelsCacheRef.current = fetched;
            } else {
              reportLoadFailure();
              return;
            }
          }
        }
        const filtered = filterByCategory(
          allChannelsCacheRef.current,
          cat,
          usePortalStore.getState().categories
        );
        fullListRef.current = filtered;
        list = filtered.slice(0, pageNum * PAGE_SIZE);
        setHasMore(filtered.length > list.length);
      } else {
        const fresh = (await portalApi.getLiveChannels(activePortal, cat, pageNum)) || [];
        const current = reset ? [] : displayChannelsRef.current;
        if (reset) {
          list = fresh.length > 0 || displayChannelsRef.current.length === 0
            ? fresh
            : displayChannelsRef.current;
        } else {
          list = [...current, ...fresh.filter(i => !current.find(c => c.id === i.id))];
        }
        if (reset && fresh.length === 0 && list.length === 0) {
          reportLoadFailure();
          return;
        }
        fullListRef.current = list;
        setHasMore(fresh.length > 0);
      }

      list = Array.isArray(list) ? list : [];
      setLoadFailed(false);
      setDisplayChannels(list);
      setPage(pageNum);
      if (reset) restoreFocusPosition(list);
    } catch (err) {
      console.warn("Live TV Data Fetch Error:", err);
    } finally {
      setIsLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
    }
  }, [activePortal, loadingMore, hasMore, fetchAllChannels, fetchAllChannelsInBackground, reportLoadFailure]);

  // Initial load
  useEffect(() => {
    if (!activePortal) { router.replace("/"); return; }
    hasInitializedCategoryRef.current = false;
    if (activePortal.type === "xtream") {
      xtreamApiRef.current = new XtreamApi({
        url: activePortal.config.url,
        username: activePortal.config.username!,
        password: activePortal.config.password!,
      });
    }
    loadCategories();
  }, [activePortal?.id]);

  // Category change
  useEffect(() => {
    if (!activePortal || prevCategoryIdRef.current === selectedCategory || !selectedCategory) return;
    setIsLoading(true);
    setPage(1);
    prevCategoryIdRef.current = selectedCategory;
    focusedIdRef.current = "";
    currentGridTopRowRef.current = 0;
    isSidebarFocusedRef.current = true;
    FocusMemory.set("category-sidebar", selectedCategory);
    if (gridScrollTimeoutRef.current) clearTimeout(gridScrollTimeoutRef.current);
    flatListRef.current?.scrollToOffset({ offset: 0, animated: false });

    if (activePortal.type === "xtream" || activePortal.type === "m3u") {
      if (allChannelsCacheRef.current.length > 0) {
        const filtered = filterByCategory(
          allChannelsCacheRef.current,
          selectedCategory,
          storeCategories
        );
        fullListRef.current = filtered;
        const sliced = filtered.slice(0, PAGE_SIZE);
        setDisplayChannels(sliced);
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
  }, [selectedCategory]);

  const openChannel = useCallback(async (channel: Channel) => {
    if (!activePortal || !channel.streamUrl) return;

    const categoryId = selectedCategoryRef.current;
    const categoryName =
      categoryId && categoryId !== "all"
        ? (usePortalStore.getState().categories || []).find((c) => c.id === categoryId)?.name ?? "Live TV"
        : "All Channels";

    const source = fullListRef.current.length ? fullListRef.current : displayChannelsRef.current;
    let zapList = numberedListRef.current(source);
    let index = zapList.findIndex((c) => String(c.id) === String(channel.id));

    const pool = allChannelsCacheRef.current.length > 0
      ? allChannelsCacheRef.current
      : (storeChannels.length > 0 ? storeChannels : displayChannelsRef.current);
    const allNumbered = numberedListRef.current(pool);

    let activeCatName = categoryName;
    if (index < 0) {
      zapList = allNumbered;
      index = Math.max(0, zapList.findIndex((c) => String(c.id) === String(channel.id)));
      if (channel.categoryId) {
        const foundCat = (usePortalStore.getState().categories || []).find((c) => c.id === channel.categoryId);
        if (foundCat) activeCatName = foundCat.name;
      }
    }

    liveChannelSession.start(zapList, index, activeCatName, activePortal.id, allNumbered);
    liveChannelSession.rememberLastChannel(zapList[index] ?? channel, activePortal.id).catch(() => { });

    try {
      let url = channel.streamUrl;
      if (activePortal.type === "mag") {
        const result = await StreamManager.getStreamUrl(channel, activePortal, "itv");
        if (result.success && result.url) url = result.url;
      }
      router.push({ pathname: "/player", params: { url, title: channel.name, type: "live", contentId: channel.id, cmd: channel.streamUrl, logo: channel.logo || "" } });
    } catch {
      router.push({ pathname: "/player", params: { url: channel.streamUrl || "", title: channel.name, type: "live", logo: channel.logo || "" } });
    }
  }, [activePortal, router]);

  const handleChannelPress = useCallback((channel: Channel) => {
    if (parentalControl.isChannelLocked(channel)) {
      setPinTarget(channel);
      return;
    }
    openChannel(channel);
  }, [openChannel]);

  handleChannelPressRef.current = handleChannelPress;

  const flashNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 2600);
  }, []);

  useEffect(() => () => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
  }, []);

  const applyLockToggle = useCallback(async (channel: Channel) => {
    const nowLocked = await parentalControl.toggleChannel(String(channel.id));
    setParentalVersion((v) => v + 1);
    flashNotice(nowLocked ? `Locked ${channel.name}` : `Unlocked ${channel.name}`);
  }, [flashNotice]);

  const handleChannelLongPress = useCallback((channel: Channel) => {
    if (parentalControl.requiresPin("settings")) {
      setLockTarget(channel);
      return;
    }
    if (!parentalControl.isEnabled) {
      flashNotice("Turn on Parental Control in Settings to use channel locks");
      return;
    }
    applyLockToggle(channel);
  }, [applyLockToggle, flashNotice]);

  const totalCountRef = useRef(0);
  const onEndReachedRef = useRef<() => void>(() => { });
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusedChannelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChannelFocus = useCallback((channel: Channel, index?: number) => {
    focusedIdRef.current = String(channel.id);
    isSidebarFocusedRef.current = false;
    setTunedFocusId((prev) => (prev === String(channel.id) ? null : prev));

    if (focusedChannelTimerRef.current) clearTimeout(focusedChannelTimerRef.current);
    focusedChannelTimerRef.current = setTimeout(() => {
      setFocusedChannel(channel);
    }, 80);

    // Keep focus fixed on scrolling — smoothly animated when row changes
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

    if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
    prefetchTimerRef.current = setTimeout(() => {
      const portal = usePortalStore.getState().activePortal;
      if (portal && index !== undefined) {
        const source = fullListRef.current.length ? fullListRef.current : displayChannelsRef.current;
        epgService.prefetch(portal, source.slice(Math.max(0, index - 4), index + 12));
      }
    }, 250);

    if (index !== undefined && totalCountRef.current > 0 && index >= totalCountRef.current - 12) {
      InteractionManager.runAfterInteractions(() => onEndReachedRef.current());
    }
  }, [numColumns, ROW_HEIGHT]);

  const restoreFocusPosition = useCallback((list: Channel[]) => {
    if (!focusedIdRef.current || !flatListRef.current) return;
    const idx = list.findIndex(c => String(c.id) === focusedIdRef.current);
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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(1);
    setHasMore(true);
    resyncRequestedRef.current = false;
    if (activePortal?.type === "xtream" || activePortal?.type === "m3u") {
      allChannelsCacheRef.current = [];
      fullListRef.current = [];
    }
    await loadCategories(true);
    await loadChannels(selectedCategory, 1, true);
    setRefreshing(false);
  }, [selectedCategory, activePortal, loadChannels, loadCategories]);

  const onEndReached = useCallback(() => {
    if (isLoading || loadingMore || !hasMore) return;
    trapFocusBriefly();

    if (activePortal?.type === "xtream" || activePortal?.type === "m3u") {
      const nextPage = page + 1;
      const sliced = fullListRef.current.slice(0, nextPage * PAGE_SIZE);
      setDisplayChannels(sliced);
      setPage(nextPage);
      setHasMore(fullListRef.current.length > sliced.length);
      return;
    }

    loadChannels(selectedCategory, page + 1, false);
  }, [isLoading, loadingMore, hasMore, selectedCategory, page, loadChannels, activePortal, trapFocusBriefly, PAGE_SIZE]);

  useEffect(() => {
    onEndReachedRef.current = onEndReached;
  }, [onEndReached]);

  // Numeric tuner
  const allChannelsPool = useMemo(() => {
    if (allChannelsCacheRef.current && allChannelsCacheRef.current.length > 0) {
      return allChannelsCacheRef.current;
    }
    if (storeChannels && storeChannels.length > 0) {
      return storeChannels;
    }
    return displayChannels;
  }, [storeChannels.length, displayChannels.length]);

  const channelNumbers = useMemo(
    () => buildChannelNumbers(allChannelsPool),
    [allChannelsPool]
  );

  numberedListRef.current = useCallback(
    (list: Channel[]) => withChannelNumbers(list, channelNumbers),
    [channelNumbers]
  );

  const numberToChannel = useMemo(() => {
    const map = new Map<number, Channel>();
    for (const c of allChannelsPool) {
      const num = c.num && c.num > 0 ? c.num : channelNumbers.get(String(c.id));
      if (num && !map.has(num)) map.set(num, c);
    }
    return map;
  }, [allChannelsPool, channelNumbers]);

  const tunerMaxDigits = useMemo(() => {
    let widest = 1;
    numberToChannel.forEach((_c, num) => {
      widest = Math.max(widest, String(num).length);
    });
    return Math.min(5, widest);
  }, [numberToChannel]);

  const hasNumberPrefix = useCallback(
    (prefix: number) => {
      const asText = String(prefix);
      for (const num of numberToChannel.keys()) {
        if (String(num).startsWith(asText)) return true;
      }
      return false;
    },
    [numberToChannel]
  );

  const handleTune = useCallback((num: number) => {
    const target = numberToChannel.get(num);
    if (!target) {
      flashNotice(`Channel ${num} not found`);
      return;
    }

    setFocusedChannel(target);
    setTunedFocusId(String(target.id));

    const idx = displayChannelsRef.current.findIndex((c) => String(c.id) === String(target.id));
    if (idx >= 0 && flatListRef.current) {
      try {
        const rowIndex = Math.floor(idx / numColumns);
        currentGridTopRowRef.current = rowIndex;
        flatListRef.current.scrollToOffset({
          offset: rowIndex * ROW_HEIGHT,
          animated: true,
        });
      } catch { /* row not measured yet */ }
    }

    handleChannelPressRef.current(target);
  }, [numberToChannel, numColumns, flashNotice, ROW_HEIGHT]);

  const tuner = useChannelTuner({
    onCommit: handleTune,
    hasPrefix: hasNumberPrefix,
    maxDigits: tunerMaxDigits,
    enabled: !pinTarget,
  });

  useStbKeys(
    {
      onDigit: tuner.pushDigit,
      onGuide: () => router.push("/epg"),
    },
    { enabled: !pinTarget, priority: STB_PRIORITY.SCREEN }
  );

  // Back button handler: matches VOD and Series
  useEffect(() => {
    const handleBack = () => {
      if (!isScreenFocused) return false;
      if (pinTarget || lockTarget) {
        setPinTarget(null);
        setLockTarget(null);
        return true;
      }
      if (tuner.entry) {
        tuner.cancel();
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
  }, [isScreenFocused, pinTarget, lockTarget, tuner, isSearchOpen]);

  const tunerName = tuner.entry ? numberToChannel.get(Number(tuner.entry))?.name ?? null : null;

  // Filter channels
  const filteredChannels = useMemo(() => {
    if (debouncedQuery) {
      const needle = debouncedQuery.toLowerCase();
      const pool = allChannelsPool.length > 0 ? allChannelsPool : displayChannels;
      return pool.filter((c) => c.name.toLowerCase().includes(needle));
    }

    return displayChannels;
  }, [displayChannels, debouncedQuery, allChannelsPool]);

  const chunkedChannels = useMemo(() => {
    const chunks = [];
    for (let i = 0; i < filteredChannels.length; i += numColumns) {
      const slice = filteredChannels.slice(i, i + numColumns);
      const rowKey = slice[0]?.id ? `r-${slice[0].id}` : `row-${i}`;
      chunks.push({
        id: rowKey,
        items: slice,
      });
    }
    return chunks;
  }, [filteredChannels, numColumns]);

  useEffect(() => {
    totalCountRef.current = filteredChannels.length;
  }, [filteredChannels.length]);

  // Sidebar categories (no 'All Channels' placeholder, exactly matching VOD & Series)
  const sidebarCategories: Category[] = useMemo(
    () => [
      ...hiddenCategories.filter(
        "live",
        (localCategories || []).filter((c) => {
          if (!c.name) return false;
          const lower = c.name.trim().toLowerCase();
          const idLower = String(c.id).trim().toLowerCase();
          return (
            lower !== "all" &&
            lower !== "all channels" &&
            lower !== "all live" &&
            lower !== "all live channels" &&
            idLower !== "all" &&
            idLower !== "all channels" &&
            idLower !== "*"
          );
        })
      ),
    ],
    [localCategories, hiddenVersion]
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
    if (
      selectedCategory &&
      selectedCategory !== "all" &&
      sidebarCategories.some((c) => isSameCat(c.id, selectedCategory))
    ) {
      return;
    }
    if (hasInitializedCategoryRef.current && selectedCategory && selectedCategory !== "all") return;
    hasInitializedCategoryRef.current = true;

    const remembered = FocusMemory.get("category-sidebar");
    const matchRemembered =
      remembered && remembered !== "all" && sidebarCategories.find((c) => isSameCat(c.id, remembered));
    const defaultCat = matchRemembered ? matchRemembered.id : sidebarCategories[0].id;
    setSelectedCategory(defaultCat);
  }, [sidebarCategories, selectedCategory, isSameCat]);

  const focusSidebar = useInitialFocusPulse(sidebarCategories.length > 0);

  const getItemLayout = useCallback((_: any, index: number) => ({
    length: ROW_HEIGHT,
    offset: index * ROW_HEIGHT,
    index,
  }), [ROW_HEIGHT]);

  const busy = isLoading || (syncing && filteredChannels.length === 0);

  const renderRow = useCallback(
    ({ item: row, index: rowIndex }: { item: { id: string; items: Channel[] }; index: number }) => (
      <ChannelRow
        row={row}
        rowIndex={rowIndex}
        totalRows={chunkedChannels.length}
        numColumns={numColumns}
        itemWidth={itemWidth}
        tileWidth={tileWidth}
        cardHeight={cardHeight}
        rowHeight={ROW_HEIGHT}
        focusedId={focusedIdRef.current}
        isSidebarFocused={isSidebarFocusedRef.current}
        tunedFocusId={tunedFocusId}
        onPress={handleChannelPress}
        onLongPress={handleChannelLongPress}
        onFocus={handleChannelFocus}
        channelNumbers={channelNumbers}
        parentalVersion={parentalVersion}
      />
    ),
    [chunkedChannels.length, numColumns, itemWidth, tileWidth, cardHeight, ROW_HEIGHT, handleChannelPress, handleChannelLongPress, handleChannelFocus, channelNumbers, tunedFocusId, parentalVersion]
  );



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

  return (
    <View style={[S.container, { paddingTop: isPortrait ? Math.max(insets.top, 24) + 8 : insets.top }]}>
      {/* ─── Header ─── */}
      <View style={S.header}>
        {/* Left spacer matching VOD & Series */}
        <View style={{ width: 38 }} />

        <View style={S.headerCenterTitleWrapper}>
          <Text style={S.headerTitle}>Live TV</Text>
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
                placeholder="Search channels..."
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
                focusKey="live-search-close-btn"
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
              focusKey="live-search-btn"
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

      {/* ─── Body: Sidebar + Grid ─── */}
      <View style={[S.body, isPortrait ? { flex: 1, height: undefined, flexDirection: "column", marginTop: 2 } : { height: EXACT_GRID_HEIGHT }]}>
        {/* Left sidebar (Landscape only) */}
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

        {/* Right channel grid */}
        <View style={[S.gridArea, isPortrait ? { flex: 1, height: undefined } : { height: EXACT_GRID_HEIGHT }]}>
          <FlatList
            ref={flatListRef}
            data={chunkedChannels}
            keyExtractor={(item) => item.id}
            getItemLayout={getItemLayout}
            onEndReached={onEndReached}
            onEndReachedThreshold={0.5}
            removeClippedSubviews={false}
            showsVerticalScrollIndicator={false}
            style={isPortrait ? { flex: 1 } : { height: EXACT_GRID_HEIGHT, overflow: "hidden" }}
            contentContainerStyle={[
              S.gridContent,
              { paddingBottom: insets.bottom + 24 },
              (isLoading || chunkedChannels.length === 0) && { flexGrow: 1 },
            ]}
            extraData={filteredChannels.length}
            initialNumToRender={6}
            maxToRenderPerBatch={6}
            windowSize={5}
            updateCellsBatchingPeriod={16}
            scrollEventThrottle={16}
            decelerationRate="fast"
            renderItem={renderRow}
            ListEmptyComponent={
              busy ? (
                <View style={{ flex: 1, paddingVertical: ph(8), justifyContent: "center", alignItems: "center" }}>
                  <ActivityIndicator color={THEME.colors.primary} size="large" />
                  <Text style={[S.loadingText, { marginTop: 10 }]}>Loading live channels...</Text>
                </View>
              ) : (
                <View style={S.emptyState}>
                  <DynamicIcon
                    name={loadFailed ? "cloud-off-outline" : "television-play"}
                    size={ps(4)}
                    color="rgba(255,255,255,0.05)"
                  />
                  <Text style={S.emptyTitle}>
                    {loadFailed ? "Couldn't Load Channels" : "No Channels Found"}
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
                  ) : (
                    <Text style={S.emptySubtitle}>
                      {searchQuery
                        ? "Try a different search term"
                        : "No channels in this category"}
                    </Text>
                  )}
                </View>
              )
            }
          />
        </View>
      </View>



      {/* ─── Numeric tuner readout ─── */}
      <ChannelTunerReadout
        entry={tuner.entry}
        resolvedName={tunerName}
        width={tunerMaxDigits}
      />

      {/* ─── Transient feedback notice ─── */}
      {notice ? (
        <View style={S.notice} pointerEvents="none">
          <Info size={ps(1.1)} color="#fff" />
          <Text style={S.noticeText} numberOfLines={1}>{notice}</Text>
        </View>
      ) : null}

      {/* ─── Parental lock PIN prompt ─── */}
      <PinPrompt
        visible={!!pinTarget}
        title="Channel Locked"
        message={pinTarget ? `Enter your PIN to watch ${pinTarget.name}.` : ""}
        onSubmit={(pin) => parentalControl.unlock(pin)}
        onCancel={() => setPinTarget(null)}
        onSuccess={() => {
          const target = pinTarget;
          setPinTarget(null);
          if (target) openChannel(target);
        }}
      />

      <PinPrompt
        visible={!!lockTarget}
        title="Parental Control"
        message={
          lockTarget
            ? `Enter your PIN to ${parentalControl.isChannelRestricted(lockTarget) ? "unlock" : "lock"} ${lockTarget.name}.`
            : ""
        }
        onSubmit={(pin) => parentalControl.unlock(pin)}
        onCancel={() => setLockTarget(null)}
        onSuccess={() => {
          const target = lockTarget;
          setLockTarget(null);
          if (target) applyLockToggle(target);
        }}
      />
    </View>
  );
}