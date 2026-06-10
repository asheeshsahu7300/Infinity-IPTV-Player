import React, { useRef, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
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
    paddingHorizontal: pw(3),
    paddingVertical: ph(1.2),
    marginBottom: ph(1),
  },
  sidebarLabel: {
    color: "rgba(255,255,255,0.25)",
    fontSize: ps(0.95),
    fontWeight: "900",
    letterSpacing: 2,
  },
  listContent: {
    paddingHorizontal: pw(1),
    paddingBottom: ph(4),
  },
  itemWrapper: {
    marginBottom: ph(0.8),
  },
  itemContainer: {
    height: ph(6.4),
    borderTopRightRadius: ps(2),
    borderBottomRightRadius: ps(2),
    justifyContent: "center",
    paddingLeft: pw(2),
    overflow: "visible",
  },
  itemActiveContainer: {
    // shadow styling if needed
  },
  itemGradient: {
    ...StyleSheet.absoluteFillObject,
    borderTopRightRadius: ps(2),
    borderBottomRightRadius: ps(2),
    justifyContent: "center",
    paddingLeft: pw(2),
  },
  itemInner: {
    flexDirection: "row",
    alignItems: "center",
  },
  iconWrapper: {
    marginRight: pw(1.2),
    width: ps(2),
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  itemText: {
    color: "rgba(255,255,255,0.45)",
    fontSize: ps(1.25),
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  itemTextActive: {
    color: "#fff",
    fontSize: ps(1.35),
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  focusIndicatorBar: {
    position: "absolute",
    left: 0,
    top: "22%",
    bottom: "22%",
    width: 4,
    backgroundColor: "#fff",
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
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
  onSelect,
  onFocus,
  index,
}: {
  item: Category;
  isActive: boolean;
  onSelect: () => void;
  onFocus: (index: number) => void;
  index: number;
}) {
  const iconData = useMemo(() => getCategoryIcon(item.name), [item.name]);
  const IconLib = iconData.lib;

  return (
    <View style={[S.itemWrapper, { overflow: "visible" }]}>
      <Focusable
        onPress={onSelect}
        onFocus={() => onFocus(index)}
        ringOnFocus={false}
        style={{ overflow: "visible" }}
      >
        {(focused) => {
          const containerStyle = [
            S.itemContainer,
            focused && {
              transform: [{ scale: 1.05 }],
              backgroundColor: "rgba(255,255,255,0.08)",
            },
            isActive && {
              backgroundColor: "transparent",
            }
          ];

          return (
            <View style={containerStyle}>
              {isActive && (
                <LinearGradient
                  colors={[THEME.colors.primary, THEME.colors.secondary]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={S.itemGradient}
                />
              )}
              {focused && (
                <View style={S.focusIndicatorBar} />
              )}
              <View style={[S.itemInner, { paddingLeft: focused ? pw(0.5) : 0 }]}>
                <View style={S.iconWrapper}>
                  <IconLib
                    name={iconData.name}
                    size={ps(1.3)}
                    color={isActive || focused ? "#fff" : "rgba(255,255,255,0.3)"}
                  />
                </View>
                <Text
                  style={[
                    S.itemText,
                    (isActive || focused) && S.itemTextActive
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
});

export default function CategorySidebar({
  categories,
  selectedId,
  onSelect,
  width = 240,
}: CategorySidebarProps) {
  const flatListRef = useRef<FlatList>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const scrollToIndex = useCallback((index: number) => {
    if (flatListRef.current && index >= 0 && index < categories.length) {
      try {
        flatListRef.current.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
      } catch { /* ignore */ }
    }
  }, [categories.length]);

  useEffect(() => {
    if (categories.length > 0 && selectedId) {
      const index = categories.findIndex((c) => c.id === selectedId);
      if (index !== -1) {
        const timer = setTimeout(() => scrollToIndex(index), 100);
        return () => clearTimeout(timer);
      }
    }
  }, [selectedId, categories, scrollToIndex]);

  const ITEM_HEIGHT = ph(7.2);

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
                flatListRef.current.scrollToIndex({ index: info.index, animated: false });
              }
            }, 100);
          }}
          renderItem={({ item, index }) => (
            <CategoryItem
              item={item}
              isActive={selectedId === item.id}
              onSelect={() => onSelect(item.id)}
              onFocus={(i) => scrollToIndex(i)}
              index={index}
            />
          )}
        />
      </View>
    </View>
  );
}