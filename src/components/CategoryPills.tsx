import React, { useRef, useEffect, useState, useCallback } from 'react';
import { View, TouchableOpacity, StyleSheet, FlatList, Animated, StyleProp, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Category } from '../store/portalStore';
import { THEME } from '../theme/tokens';
import { isPhone } from '../utils/phoneUtils';
import { Text } from './Text';


interface CategoryPillsProps {
  categories: Category[];
  selectedId: string;
  onSelect: (id: string) => void;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

const PillItem = React.memo(({ item, isActive, isFocused, onSelect, onFocus, onBlur, index }: {
  item: Category;
  isActive: boolean;
  isFocused: boolean;
  onSelect: (id: string) => void;
  onFocus: (id: string, index: number) => void;
  onBlur: () => void;
  index: number;
}) => {
  const handleSelect = useCallback(() => {
    onSelect(item.id);
  }, [onSelect, item.id]);

  const handleFocus = useCallback(() => {
    onFocus(item.id, index);
  }, [onFocus, item.id, index]);

  // Scale animation for focus
  const scaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: isFocused ? 1.1 : 1,
      friction: 5,
      tension: 40,
      useNativeDriver: true,
    }).start();
  }, [isFocused]);

  // OK is delivered via TouchableOpacity.onPress when focused.

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={[
          styles.pill,
          isActive && styles.pillActive,
          isFocused && styles.pillFocused,
        ]}
        onPress={handleSelect}
        activeOpacity={1}
        onFocus={handleFocus}
        onBlur={onBlur}
      >
        {item.logo ? (
          <Image
            source={{ uri: item.logo }}
            style={styles.pillLogo}
            contentFit="contain"
            cachePolicy="memory-disk"
          />
        ) : null}
        <Text
          style={[
            styles.pillText,
            isActive && styles.pillTextActive,
            isFocused && styles.pillTextFocused,
          ]}
          numberOfLines={1}
        >
          {String(item.name)}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.item.name === nextProps.item.name &&
    prevProps.item.logo === nextProps.item.logo &&
    prevProps.isActive === nextProps.isActive &&
    prevProps.isFocused === nextProps.isFocused &&
    prevProps.index === nextProps.index
  );
});

PillItem.displayName = "PillItem";

export default function CategoryPills({
  categories,
  selectedId,
  onSelect,
  style,
  contentContainerStyle,
}: CategoryPillsProps) {
  const flatListRef = useRef<FlatList>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focusedIdRef = useRef<string | null>(null);

  useEffect(() => {
    focusedIdRef.current = focusedId;
  }, [focusedId]);

  const categoriesRef = useRef(categories);
  const isMounted = useRef(true);

  useEffect(() => {
    categoriesRef.current = categories;
  }, [categories]);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  const scrollToIndex = useCallback((index: number) => {
    if (isMounted.current && flatListRef.current && index >= 0 && index < categoriesRef.current.length) {
      try {
        flatListRef.current.scrollToIndex({
          index,
          animated: true,
          viewOffset: 0,
          viewPosition: 0.5,
        });
      } catch (err) {
        console.warn("Pills scrollToIndex failed:", err);
      }
    }
  }, []);

  // Auto-scroll to selected item on mount/update (only if not focusing manually to avoid fighting)
  useEffect(() => {
    if (categories.length > 0 && selectedId && !focusedId) {
      const index = categories.findIndex((c) => c.id === selectedId);
      if (index !== -1) {
        // Delay slightly to ensure layout
        setTimeout(() => {
          if (isMounted.current) scrollToIndex(index);
        }, 200);
      }
    }
  }, [selectedId, categories, focusedId, scrollToIndex]);



  const handleFocus = useCallback((id: string, idx: number) => {
    setFocusedId(id);
    scrollToIndex(idx);
  }, [scrollToIndex]);

  const handleBlur = useCallback(() => {
    setFocusedId(null);
  }, []);

  return (
    <View style={[styles.container, style]}>
      <FlatList
        ref={flatListRef}
        data={categories}
        renderItem={useCallback(({ item, index }: { item: Category; index: number }) => (
          <PillItem
            item={item}
            index={index}
            isActive={selectedId === item.id}
            isFocused={focusedId === item.id}
            onSelect={onSelect}
            onFocus={handleFocus}
            onBlur={handleBlur}
          />
        ), [selectedId, focusedId, onSelect, handleFocus, handleBlur])}
        keyExtractor={(item) => String(item.id)}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.content, contentContainerStyle]}
        initialNumToRender={10}
        maxToRenderPerBatch={8}
        windowSize={5}
        updateCellsBatchingPeriod={50}
        removeClippedSubviews={false}
        onScrollToIndexFailed={(info) => {
          setTimeout(() => {
            try {
              flatListRef.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 0.5 });
            } catch {}
          }, 100);
        }}
      />
    </View>
  );
}

export { CategoryPills };

const styles = StyleSheet.create({
  /*
   * The phone tier runs about a quarter smaller throughout.
   *
   * This component is shared — live-tv, vod, series and epg all swap their
   * sidebar for it in portrait — so these numbers set the pill row on every one
   * of those screens, not just the one they were tuned on. That is intended:
   * the rail should read the same wherever it appears.
   *
   * `height` is the lever rather than `paddingVertical`, because the pill fixes
   * its height and centres its children, so the padding never decides the size.
   */
  container: {
    backgroundColor: "transparent",
    minHeight: isPhone ? 40 : 46,
  },

  content: {
    paddingHorizontal: isPhone ? 12 : 16,
    paddingVertical: isPhone ? 4 : 6,
    alignItems: "center",
  },

  pill: {
    flexDirection: "row",
    paddingHorizontal: isPhone ? 13 : 16,
    paddingVertical: isPhone ? 6 : 8,
    borderRadius: isPhone ? 17 : 20,
    height: isPhone ? 34 : 40,
    backgroundColor: "#111827",
    marginRight: isPhone ? 8 : 10,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },

  pillLogo: {
    width: isPhone ? 18 : 20,
    height: isPhone ? 18 : 20,
    marginRight: isPhone ? 7 : 8,
    borderRadius: 4,
  },

  pillActive: {
    backgroundColor: THEME.colors.primary,
  },

  pillFocused: {
    borderColor: THEME.colors.primary,
    backgroundColor: "#1f2937",
    zIndex: 10,
  },

  pillText: {
    color: "#888",
    fontSize: isPhone ? 13.5 : 15,
    fontWeight: "500",
    lineHeight: isPhone ? 16 : 18,
  },

  /**
   * The active pill's ink: dark, because `pillActive` fills it with
   * `THEME.colors.primary` -- which is #F5F5F5. This was #fff on that white
   * fill, so the selected category was legible only by its silhouette.
   */
  pillTextActive: {
    color: THEME.colors.selectedText,
  },

  /** The focused pill is filled #1f2937 instead, so its ink stays light. */
  pillTextFocused: {
    color: "#fff",
  },
});

