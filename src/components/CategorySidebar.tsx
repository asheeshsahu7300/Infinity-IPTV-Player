import React, { useRef, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { THEME, pw, ph, ps } from "../theme/tokens";
import { Focusable } from "../tv";

interface Category {
  id: string;
  name: string;
}

interface CategorySidebarProps {
  categories: Category[];
  selectedId: string;
  onSelect: (id: string) => void;
  width?: number;
  autoFocusFirst?: boolean;
}

// ─────────────────────────────────────────────
// Styles Defined at Top to Prevent Hoisting Issues
// ─────────────────────────────────────────────
const S = StyleSheet.create({
  container: {
    backgroundColor: "transparent",
    paddingTop: ph(1),
  },
  sidebarHeader: {
    paddingHorizontal: pw(2),
    paddingVertical: ph(1.2),
    marginBottom: ph(1),
  },
  sidebarLabel: {
    color: "rgba(255,255,255,0.4)",
    fontSize: ps(0.95),
    fontWeight: "900",
    letterSpacing: 2,
  },
  listContent: {
    paddingHorizontal: pw(1.5),
    paddingBottom: ph(4),
  },
  itemWrapper: {
    marginBottom: ph(1),
  },
  itemContainer: {
    height: ph(6),
    borderRadius: ps(2),
    justifyContent: "center",
    paddingLeft: pw(2),
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "transparent",
  },
  itemContainerFocused: {
    borderColor: "rgba(255,255,255,0.4)",
    backgroundColor: "rgba(255,255,255,0.1)",
    ...Platform.select({
      ios: {
        shadowColor: "#fff",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.8,
        shadowRadius: 12,
      },
      android: {
        elevation: 0,
      }
    })
  },
  itemInner: {
    flexDirection: "row",
    alignItems: "center",
  },
  itemText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: ps(1.15),
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  itemTextActive: {
    color: "#fff",
    fontSize: ps(1.25),
    fontWeight: "800",
    letterSpacing: 0.5,
  },
});

// ─────────────────────────────────────────────
// Icon Mapping Utility
// ─────────────────────────────────────────────
const getCategoryIcon = (name: string): any => {
  const n = (name || "").toLowerCase();
  if (n.includes("all")) return { lib: MaterialCommunityIcons, name: "movie-open-play-outline" };
  if (n.includes("oscar")) return { lib: MaterialCommunityIcons, name: "trophy-variant-outline" };
  if (n.includes("trending") || n.includes("top")) return { lib: MaterialCommunityIcons, name: "trending-up" };
  if (n.includes("new")) return { lib: MaterialCommunityIcons, name: "new-box" };
  if (n.includes("genre") || n.includes("category")) return { lib: MaterialCommunityIcons, name: "shape-outline" };
  if (n.includes("action")) return { lib: MaterialCommunityIcons, name: "sword-cross" };
  if (n.includes("comedy")) return { lib: MaterialCommunityIcons, name: "emoticon-happy-outline" };
  if (n.includes("horror")) return { lib: MaterialCommunityIcons, name: "ghost-outline" };
  if (n.includes("drama")) return { lib: MaterialCommunityIcons, name: "drama-masks" };
  if (n.includes("animation") || n.includes("kids")) return { lib: MaterialCommunityIcons, name: "robot-happy-outline" };
  if (n.includes("sci-fi")) return { lib: MaterialCommunityIcons, name: "alien-outline" };
  if (n.includes("documentary")) return { lib: MaterialCommunityIcons, name: "camera-outline" };
  
  return { lib: Ionicons, name: "chevron-forward-outline" };
};

const CategoryItem = React.memo(function CategoryItem({
  item,
  isActive,
  hasTVPreferredFocus,
  onSelect,
  index,
}: {
  item: Category;
  isActive: boolean;
  hasTVPreferredFocus?: boolean;
  onSelect: (id: string) => void;
  index: number;
}) {
  const handleSelect = useCallback(() => {
    onSelect(item.id);
  }, [onSelect, item.id]);

  return (
    <View style={[S.itemWrapper, { overflow: "visible" }]}>
      <Focusable
        hasTVPreferredFocus={hasTVPreferredFocus}
        onPress={handleSelect}
        ringOnFocus={false}
        style={{ overflow: "visible" }}
      >
        {(focused) => {
          return (
            <View 
              style={[
                S.itemContainer, 
                focused && S.itemContainerFocused,
                isActive && !focused && { backgroundColor: "rgba(255,255,255,0.15)" },
                focused && { backgroundColor: "#fff", transform: [{ scale: 1.05 }] }
              ]}
            >
              <View style={[S.itemInner, { paddingLeft: focused ? pw(0.5) : 0 }]}>
                <Text
                  style={[
                    S.itemText,
                    (isActive || focused) && S.itemTextActive,
                    (isActive || focused) && { color: focused ? "#000" : "#fff" }
                  ]}
                  numberOfLines={1}
                >
                  {item.name}
                </Text>
              </View>
            </View>
          );
        }}
      </Focusable>
    </View>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.isActive === nextProps.isActive &&
    prevProps.hasTVPreferredFocus === nextProps.hasTVPreferredFocus &&
    prevProps.index === nextProps.index
  );
});

export default function CategorySidebar({
  categories,
  selectedId,
  onSelect,
  width = 240,
  autoFocusFirst = false,
}: CategorySidebarProps) {
  const flatListRef = useRef<FlatList>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const countRef = useRef(categories.length);
  countRef.current = categories.length;

  const scrollToIndex = useCallback((index: number, animated: boolean) => {
    if (flatListRef.current && index >= 0 && index < countRef.current) {
      try {
        flatListRef.current.scrollToIndex({ index, animated, viewPosition: 0.5 });
      } catch { /* ignore */ }
    }
  }, []);

  // Only scroll on an actual selection change.
  //
  // This used to depend on the `categories` array itself, which callers rebuild
  // on every render — so the effect re-fired continuously and kept animating the
  // list under the focus engine. `animated: false` for the same reason: a moving
  // container is what makes D-pad focus land on the wrong row.
  const lastScrolledIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedId || categories.length === 0) return;
    if (lastScrolledIdRef.current === selectedId) return;
    lastScrolledIdRef.current = selectedId;

    const index = categories.findIndex((c) => c.id === selectedId);
    if (index === -1) return;
    const timer = setTimeout(() => scrollToIndex(index, false), 100);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, categories.length, scrollToIndex]);

  const ITEM_HEIGHT = ph(7.2);

  // Exactly one row may claim initial focus. The old condition
  // (`selectedId === item.id || index === 0`) matched two rows whenever the
  // selection was not the first one, leaving which of them won up to the
  // native focus engine.
  const preferredIndex = useMemo(() => {
    if (!autoFocusFirst) return -1;
    const selected = categories.findIndex((c) => c.id === selectedId);
    return selected >= 0 ? selected : 0;
  }, [autoFocusFirst, categories, selectedId]);

  // The native focus engine already scrolls a focused child into view. Doing it
  // again from onFocus meant every D-pad press animated the list, which is what
  // made focus feel like it was skipping rows.
  const renderItem = useCallback(
    ({ item, index }: { item: Category; index: number }) => (
      <CategoryItem
        item={item}
        isActive={selectedId === item.id}
        hasTVPreferredFocus={index === preferredIndex}
        onSelect={onSelect}
        index={index}
      />
    ),
    [selectedId, preferredIndex, onSelect]
  );

  return (
    <View style={[S.container, { width }]}>
      <View style={S.sidebarHeader}>
        <Text style={S.sidebarLabel}>CATEGORIES</Text>
      </View>

      <View style={{ height: ITEM_HEIGHT * 10 }}>
        <FlatList
          ref={flatListRef}
          data={categories}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={S.listContent}
          removeClippedSubviews={false}
          initialNumToRender={20}
          maxToRenderPerBatch={10}
          windowSize={5}
          updateCellsBatchingPeriod={50}
          keyboardShouldPersistTaps="always"
          getItemLayout={(_, index) => ({ length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index, index })}
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
    </View>
  );
}