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
import { THEME, pw, ph, ps , fw } from '../theme/tokens';
import { isTV } from "../utils/tvUtils";
import { MIN_TOUCH } from "../theme/responsive";
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
  mode?: "vertical" | "horizontal";
}

// ─────────────────────────────────────────────
// Styles Defined at Top to Prevent Hoisting Issues
// ─────────────────────────────────────────────
const auto: any = "auto";

const S = StyleSheet.create({
  container: {
    backgroundColor: "transparent",
    paddingTop: ph(1),
  },
  containerHorizontal: {
    paddingTop: ph(0.5),
    paddingBottom: ph(0.5),
    flexDirection: "row",
  },
  sidebarHeader: {
    paddingHorizontal: pw(3),
    paddingVertical: ph(1.2),
    marginBottom: ph(1),
  },
  sidebarLabel: {
    color: "rgba(255,255,255,0.25)",
    fontSize: ps(0.95),
    fontWeight: fw("900"),
    letterSpacing: 2,
  },
  listContent: {
    paddingHorizontal: pw(1),
    paddingBottom: ph(4),
  },
  listContentHorizontal: {
    paddingHorizontal: pw(2),
    paddingBottom: 0,
    alignItems: "center",
    gap: pw(2),
  },
  itemWrapper: {
    marginBottom: ph(0.8),
  },
  itemWrapperHorizontal: {
    marginBottom: 0,
    marginRight: pw(1),
  },
  itemContainer: {
    // ph(6.4) is generous on TV/tablet; clamp to the 48dp touch minimum so the
    // row stays tappable on short viewports (e.g. tablet/phone in landscape).
    height: Math.max(ph(6.4), isTV ? 0 : MIN_TOUCH),
    borderTopRightRadius: ps(2),
    borderBottomRightRadius: ps(2),
    justifyContent: "center",
    paddingLeft: pw(2),
    overflow: "visible",
  },
  itemContainerHorizontal: {
    // Phone/tablet category chips — compact (~40px) but kept off the tiny end
    // (ph is height-based and collapses in landscape).
    height: Math.max(ph(4.5), isTV ? 0 : 40),
    minHeight: isTV ? undefined : 40,
    borderRadius: 100,
    paddingHorizontal: pw(2.2),
    justifyContent: "center",
    borderTopRightRadius: 100,
    borderBottomRightRadius: 100,
    paddingLeft: pw(2.2),
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  itemGradient: {
    ...StyleSheet.absoluteFillObject,
    borderTopRightRadius: ps(2),
    borderBottomRightRadius: ps(2),
    justifyContent: "center",
    paddingLeft: pw(2),
  },
  itemGradientHorizontal: {
    borderRadius: 100,
    borderTopRightRadius: 100,
    borderBottomRightRadius: 100,
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
  iconWrapperHorizontal: {
    marginRight: pw(0.8),
    width: "auto",
  },
  itemText: {
    color: "rgba(255,255,255,0.45)",
    fontSize: ps(1.25),
    fontWeight: fw("600"),
    letterSpacing: 0.3,
  },
  itemTextHorizontal: {
    fontSize: ps(1.0),
  },
  itemTextActive: {
    color: "#fff",
    fontSize: ps(1.35),
    fontWeight: fw("800"),
    letterSpacing: 0.5,
  },
  itemTextActiveHorizontal: {
    fontSize: ps(1.1),
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
  focusIndicatorHorizontal: {
    top: auto,
    bottom: -4,
    left: "20%",
    right: "20%",
    width: "60%",
    height: 3,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 0,
    borderTopLeftRadius: 2,
  }
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
  mode,
}: {
  item: Category;
  isActive: boolean;
  onSelect: () => void;
  onFocus: (index: number) => void;
  index: number;
  mode: "vertical" | "horizontal";
}) {
  const iconData = useMemo(() => getCategoryIcon(item.name), [item.name]);
  const IconLib = iconData.lib;
  const isHorz = mode === "horizontal";

  return (
    <View style={[S.itemWrapper, isHorz && S.itemWrapperHorizontal, { overflow: "visible" }]}>
      <Focusable
        onPress={onSelect}
        onFocus={() => onFocus(index)}
        ringOnFocus={false}
        style={{ overflow: "visible" }}
      >
        {(focused) => {
          const containerStyle = [
            S.itemContainer,
            isHorz && S.itemContainerHorizontal,
            focused && {
              transform: [{ scale: 1.05 }],
              backgroundColor: "rgba(255,255,255,0.08)",
            },
            isActive && {
              backgroundColor: "transparent",
            },
            focused && isHorz && { borderColor: "#6b6b6bff" }
          ];

          return (
            <View style={containerStyle}>
              {isActive && (
                <LinearGradient
                  colors={[THEME.colors.primary, THEME.colors.secondary]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[S.itemGradient, isHorz && S.itemGradientHorizontal]}
                />
              )}
              {focused && (
                <View style={[S.focusIndicatorBar, isHorz && S.focusIndicatorHorizontal]} />
              )}
              <View style={[S.itemInner, { paddingLeft: focused && !isHorz ? pw(0.5) : 0 }]}>
                {/* Icons only in the vertical sidebar; horizontal chip bar is text-only. */}
                {!isHorz && (
                  <View style={S.iconWrapper}>
                    <IconLib
                      name={iconData.name}
                      size={ps(1.3)}
                      color={isActive || focused ? "#fff" : "rgba(255,255,255,0.3)"}
                    />
                  </View>
                )}
                <Text
                  style={[
                    S.itemText,
                    isHorz && S.itemTextHorizontal,
                    (isActive || focused) && S.itemTextActive,
                    (isActive || focused) && isHorz && S.itemTextActiveHorizontal
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
  mode = "vertical",
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
  const isHorz = mode === "horizontal";

  return (
    <View style={[S.container, isHorz && S.containerHorizontal, !isHorz && { width }]}>
      {!isHorz && (
        <View style={S.sidebarHeader}>
          <Text style={S.sidebarLabel}>CATEGORIES</Text>
        </View>
      )}

      <View style={isHorz ? { flex: 1, height: Math.max(ph(6), isTV ? 0 : 52) } : { height: ITEM_HEIGHT * 10 }}>
        <FlatList
          horizontal={isHorz}
          ref={flatListRef}
          data={categories}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[S.listContent, isHorz && S.listContentHorizontal]}
          removeClippedSubviews={false}
          initialNumToRender={20}
          maxToRenderPerBatch={10}
          windowSize={5}
          updateCellsBatchingPeriod={50}
          keyboardShouldPersistTaps="always"
          getItemLayout={isHorz ? undefined : (_, index) => ({ length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index, index })}
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
              mode={mode}
            />
          )}
        />
      </View>
    </View>
  );
}