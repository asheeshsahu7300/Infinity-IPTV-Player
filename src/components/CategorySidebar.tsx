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
  onFocus?: (id: string) => void;
  width?: number;
  autoFocusFirst?: boolean;
}

// ─────────────────────────────────────────────
// Styles Defined at Top to Prevent Hoisting Issues
// ─────────────────────────────────────────────
const S = StyleSheet.create({
  container: {
    flex: 1,
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
    paddingBottom: ph(8),
  },
  itemWrapper: {
    marginBottom: ph(1),
  },
  itemContainer: {
    height: ph(6),
    borderRadius: ps(1),
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: pw(1.5),
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
    justifyContent: "center",
  },
  itemText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: ps(1.15),
    fontWeight: "600",
    letterSpacing: 0.3,
    textAlign: "center",
  },
  itemTextActive: {
    color: "#fff",
    fontSize: ps(1.25),
    fontWeight: "800",
    letterSpacing: 0.5,
  },
});



const CategoryItem = React.memo(function CategoryItem({
  item,
  isActive,
  hasTVPreferredFocus,
  onSelect,
  onFocus,
  index,
}: {
  item: Category;
  isActive: boolean;
  hasTVPreferredFocus?: boolean;
  onSelect: (id: string) => void;
  onFocus?: (id: string) => void;
  index: number;
}) {
  const handleSelect = useCallback(() => {
    onSelect(item.id);
  }, [onSelect, item.id]);

  const handleFocus = useCallback(() => {
    onFocus?.(item.id);
  }, [onFocus, item.id]);

  return (
    <View style={[S.itemWrapper, { overflow: "visible" }]}>
      <Focusable
        screenKey="category-sidebar"
        focusKey={String(item.id)}
        hasTVPreferredFocus={hasTVPreferredFocus}
        onPress={handleSelect}
        onFocus={handleFocus}
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
              <View style={S.itemInner}>
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
    prevProps.item.name === nextProps.item.name &&
    prevProps.isActive === nextProps.isActive &&
    prevProps.hasTVPreferredFocus === nextProps.hasTVPreferredFocus &&
    prevProps.index === nextProps.index &&
    prevProps.onFocus === nextProps.onFocus
  );
});

export default function CategorySidebar({
  categories,
  selectedId,
  onSelect,
  onFocus,
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
        if (index <= 2) {
          flatListRef.current.scrollToOffset({ offset: 0, animated });
        } else {
          flatListRef.current.scrollToIndex({ index, animated, viewPosition: 0.2 });
        }
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

  const ITEM_HEIGHT = ph(7);

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
        onFocus={onFocus}
        index={index}
      />
    ),
    [selectedId, preferredIndex, onSelect, onFocus]
  );

  return (
    <View style={[S.container, { width }]}>
      <View style={S.sidebarHeader}>
        <Text style={S.sidebarLabel}>CATEGORIES</Text>
      </View>

      <View style={{ flex: 1 }}>
        <FlatList
          ref={flatListRef}
          data={categories}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={S.listContent}
          removeClippedSubviews={false}
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          windowSize={3}
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