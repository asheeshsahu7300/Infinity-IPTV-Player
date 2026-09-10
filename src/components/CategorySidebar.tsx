import React, { useRef, useEffect, useCallback, useMemo } from "react";
import { View, StyleSheet, FlatList, Dimensions, Animated } from 'react-native';
import { pw, ps, THEME } from "../theme/tokens";
import { Focusable } from "../tv";
import { remoteFocusEnabled, SIDEBAR_WIDTH } from "../utils/tabletUtils";
import { Text } from './Text';


interface Category {
  id: string;
  name: string;
}

interface CategorySidebarProps {
  categories: Category[];
  selectedId: string;
  onSelect: (id: string) => void;
  onFocus?: (id: string) => void;
  width?: number;
  height?: number;
  autoFocusFirst?: boolean;
}

const { height: SCREEN_H } = Dimensions.get("window");
const DEFAULT_SIDEBAR_H = SCREEN_H - 64;

// ─────────────────────────────────────────────
// Styles Defined at Top to Prevent Hoisting Issues
// ─────────────────────────────────────────────
const S = StyleSheet.create({
  container: {
    backgroundColor: "transparent",
    paddingTop: 0,
    overflow: "hidden",
  },
  listContent: {
    paddingHorizontal: pw(1.2),
    paddingTop: 2,
    paddingBottom: 2,
  },
  itemInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  itemText: {
    color: "#FFFFFF",
    fontSize: ps(1.1),
    fontWeight: "800",
    letterSpacing: 0.2,
    textAlign: "center",
  },
  itemTextActive: {
    color: "#111111",
    fontSize: ps(1.15),
    fontWeight: "900",
    letterSpacing: 0.3,
  },
});

const CategoryItem = React.memo(
  function CategoryItem({
    item,
    index,
    isActive,
    hasTVPreferredFocus,
    onSelect,
    onItemFocus,
    itemTotalHeight,
    pillHeight,
    trapFocusUp,
    trapFocusDown,
  }: {
    item: Category;
    index: number;
    isActive: boolean;
    hasTVPreferredFocus?: boolean;
    onSelect: (id: string) => void;
    onItemFocus: (id: string, index: number) => void;
    itemTotalHeight: number;
    pillHeight: number;
    trapFocusUp?: boolean;
    trapFocusDown?: boolean;
  }) {
    const scaleAnim = useRef(new Animated.Value(1)).current;

    const handleSelect = useCallback(() => {
      onSelect(item.id);
    }, [onSelect, item.id]);

    const handleFocus = useCallback(() => {
      onItemFocus(item.id, index);
    }, [onItemFocus, item.id, index]);

    return (
      <View style={{ height: itemTotalHeight, justifyContent: "center", overflow: "visible" }}>
        <Focusable
          screenKey="category-sidebar"
          focusKey={String(item.id)}
          hasTVPreferredFocus={hasTVPreferredFocus}
          trapFocusUp={trapFocusUp}
          trapFocusDown={trapFocusDown}
          onPress={handleSelect}
          onFocus={handleFocus}
          ringOnFocus={false}
          style={{ overflow: "visible" }}
        >
          {(focused) => {
            Animated.spring(scaleAnim, {
              toValue: focused ? 1.05 : 1,
              friction: 7,
              tension: 100,
              useNativeDriver: true,
            }).start();

            return (
              <Animated.View
                style={[
                  {
                    height: pillHeight,
                    // The 90/100 split is a focus affordance: the focused pill
                    // grows out to meet the edge while its neighbours sit
                    // inset. With no remote there is no focus to signal, so
                    // the split degrades into a ragged column with the active
                    // pill merely wider than the rest -- every pill takes the
                    // full width there. The active one is still distinguished,
                    // by its background, not its size.
                    width:
                      !remoteFocusEnabled || focused || isActive ? "100%" : "90%",
                    alignSelf: "center",
                    borderRadius: 18,
                    justifyContent: "center",
                    alignItems: "center",
                    paddingHorizontal: pw(1.2),
                    overflow: "hidden",
                    borderWidth: 0,
                    borderColor: "transparent",
                    backgroundColor: "#17181c",
                    transform: [{ scale: scaleAnim }],
                  },
                  isActive && !focused && {
                    backgroundColor: "#F5F5F5",
                    borderColor: "transparent",
                  },
                  focused && {
                    borderColor: "transparent",
                    backgroundColor: "#F5F5F5",
                    elevation: 8,
                  },
                ]}
              >
                <View style={S.itemInner}>
                  <Text
                    style={[
                      S.itemText,
                      (focused || isActive)
                        ? { color: THEME.colors.selectedText, fontWeight: "900", fontSize: ps(1.15) }
                        : { color: THEME.colors.text },
                    ]}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                </View>
              </Animated.View>
            );
          }}
        </Focusable>
      </View>
    );
  },
  (prev, next) => {
    return (
      prev.item.id === next.item.id &&
      prev.item.name === next.item.name &&
      prev.isActive === next.isActive &&
      prev.hasTVPreferredFocus === next.hasTVPreferredFocus &&
      prev.itemTotalHeight === next.itemTotalHeight &&
      prev.pillHeight === next.pillHeight &&
      prev.index === next.index &&
      prev.trapFocusUp === next.trapFocusUp &&
      prev.trapFocusDown === next.trapFocusDown
    );
  }
);

export default function CategorySidebar({
  categories,
  selectedId,
  onSelect,
  onFocus,
  width = SIDEBAR_WIDTH,
  height,
  autoFocusFirst = false,
}: CategorySidebarProps) {
  const flatListRef = useRef<FlatList>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const totalHeight = height && height > 0 ? height : DEFAULT_SIDEBAR_H;
  /*
   * A row is a fixed height, not a fraction of the panel.
   *
   * This was `totalHeight / 8.3` — always 8.3 rows on screen, whatever the
   * screen. On the box that is a 57dp row, which is what the pill was designed
   * at; on a 1506x941 tablet the same expression gives 105, so every category
   * became a 91dp pill with the label floating in the middle of it. The
   * sidebar looked stretched because it was.
   *
   * Bounding it means a taller panel shows *more* categories rather than
   * taller ones — the same correction the channel grid needed, and what
   * `tabletClamp` says the surplus space is for.
   *
   * A range rather than a single cap, and the ceiling took two goes to place.
   * Pinned at 58 — the box's own row — a large tablet got a 44dp pill, which
   * read undersized against a 1506dp-wide panel; 72 gave 58 and still read
   * small. 88 gives a 74dp pill, near the 91 the unbounded
   * `totalHeight / 8.3` produced before any of this, but reached by a bound
   * rather than by scaling with the panel — so it stops there instead of
   * growing again on a 1920.
   *
   * The floor keeps a short panel from collapsing the row. TV (57) and the
   * 853dp tablet (56) fall inside the range untouched; only panels tall enough
   * to inflate the row are affected.
   */
  const MIN_ITEM_HEIGHT = 56;
  const MAX_ITEM_HEIGHT = 88;
  const itemTotalHeight = Math.min(
    MAX_ITEM_HEIGHT,
    Math.max(MIN_ITEM_HEIGHT, Math.floor(totalHeight / 8.3))
  );
  const itemGap = Math.max(14, Math.floor(itemTotalHeight * 0.12));
  const pillHeight = itemTotalHeight - itemGap;

  const countRef = useRef(categories.length);
  countRef.current = categories.length;
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  const currentScrollIndexRef = useRef(0);

  const scrollToIndex = useCallback((index: number, immediate = false) => {
    if (!flatListRef.current || index < 0 || index >= countRef.current) return;
    currentScrollIndexRef.current = index;

    // Focus anchored at Slot 0 (Top of the sidebar)
    const targetOffset = index * itemTotalHeight;

    if (immediate) {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      try {
        flatListRef.current?.scrollToOffset({ offset: targetOffset, animated: false });
      } catch { /* ignore */ }
    } else {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        try {
          flatListRef.current?.scrollToOffset({ offset: targetOffset, animated: true });
        } catch { /* ignore */ }
      }, 16);
    }
  }, [itemTotalHeight]);

  const isCategoryActive = useCallback((catId: string) => {
    if (catId === selectedId) return true;
    const sA = String(catId).trim();
    const sB = String(selectedId).trim();
    if (sA === sB) return true;
    const rawA = sA.includes(":") ? sA.split(":")[1] : sA;
    const rawB = sB.includes(":") ? sB.split(":")[1] : sB;
    return rawA === rawB;
  }, [selectedId]);

  const lastScrolledIdRef = useRef<string | null>(null);
  const didInitialScrollRef = useRef(false);
  useEffect(() => {
    if (!selectedId || categories.length === 0) return;
    if (lastScrolledIdRef.current === selectedId) return;
    lastScrolledIdRef.current = selectedId;

    const index = categories.findIndex((c) => isCategoryActive(c.id));
    if (index === -1) return;

    /**
     * With a remote, every selection change re-anchors the list: selection
     * follows the D-pad, and the focused pill belongs at slot 0.
     *
     * On touch only the *first* positioning is wanted -- it reveals the
     * category restored from a previous session. After that a tap must not
     * move the list: the viewer scrolled it there themselves and the pill they
     * tapped is under their finger, so re-anchoring it to the top drags the
     * whole column away from the tap. This effect, not the focus handler, is
     * the path a tap takes -- it fires because `selectedId` changed.
     */
    if (!remoteFocusEnabled) {
      if (didInitialScrollRef.current) return;
      didInitialScrollRef.current = true;
    }

    const timer = setTimeout(() => scrollToIndex(index, true), 100);
    return () => clearTimeout(timer);
  }, [selectedId, categories.length, scrollToIndex, isCategoryActive]);

  const preferredIndex = useMemo(() => {
    if (!autoFocusFirst) return -1;
    const selected = categories.findIndex((c) => isCategoryActive(c.id));
    return selected >= 0 ? selected : 0;
  }, [autoFocusFirst, categories, isCategoryActive]);

  const handleItemFocus = useCallback(
    (id: string, index: number) => {
      // Anchoring the focused pill at slot 0 is a D-pad affordance. Guarded
      // rather than assumed unreachable: the row stays natively focusable, so
      // a keyboard or stray Android focus could still land here.
      if (remoteFocusEnabled) scrollToIndex(index, false);
      onFocus?.(id);
    },
    [scrollToIndex, onFocus]
  );

  const renderItem = useCallback(
    ({ item, index }: { item: Category; index: number }) => (
      <CategoryItem
        item={item}
        index={index}
        isActive={isCategoryActive(item.id)}
        hasTVPreferredFocus={index === preferredIndex}
        onSelect={onSelect}
        onItemFocus={handleItemFocus}
        itemTotalHeight={itemTotalHeight}
        pillHeight={pillHeight}
        trapFocusUp={index === 0}
        trapFocusDown={index === categories.length - 1}
      />
    ),
    [isCategoryActive, preferredIndex, onSelect, handleItemFocus, itemTotalHeight, pillHeight, categories.length]
  );

  return (
    <View style={[S.container, { width, height: totalHeight }]}>
      <FlatList
        ref={flatListRef}
        data={categories}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[S.listContent, { paddingBottom: Math.max(0, totalHeight - itemTotalHeight) }]}
        removeClippedSubviews={false}
        initialNumToRender={20}
        maxToRenderPerBatch={16}
        windowSize={11}
        updateCellsBatchingPeriod={16}
        scrollEventThrottle={16}
        decelerationRate="fast"
        keyboardShouldPersistTaps="always"
        style={{ height: totalHeight, overflow: "hidden" }}
        getItemLayout={(_, index) => ({ length: itemTotalHeight, offset: itemTotalHeight * index, index })}
        onScrollToIndexFailed={(info) => {
          setTimeout(() => {
            if (isMounted.current && flatListRef.current) {
              try {
                flatListRef.current.scrollToIndex({ index: info.index, animated: false });
              } catch { /* list shrank in the meantime */ }
            }
          }, 100);
        }}
        renderItem={renderItem}
      />
    </View>
  );
}