import React, { useRef, useEffect, useState, useCallback } from 'react';
import { View, TouchableOpacity, Text, StyleSheet, FlatList, Platform, Animated } from 'react-native';
import { Category } from '../store/portalStore';
import { THEME, fw, ps } from '../theme/tokens';
import { isTV } from '../utils/tvUtils';
import { MIN_TOUCH } from '../theme/responsive';

interface CategoryPillsProps {
  categories: Category[];
  selectedId: string;
  onSelect: (id: string) => void;
}

// 48dp touch minimum on phone/tablet; scales up on TV for the 10-ft UI.
const PILL_HEIGHT = isTV ? ps(4) : MIN_TOUCH;

const PillItem = React.memo(({ item, selectedId, focusedId, onSelect, onFocus, onBlur, index }: {
  item: Category;
  selectedId: string;
  focusedId: string | null;
  onSelect: (id: string) => void;
  onFocus: (id: string, index: number) => void;
  onBlur: () => void;
  index: number;
}) => {
  const isActive = selectedId === item.id;
  const isFocused = focusedId === item.id;

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
        onPress={() => onSelect(item.id)}
        activeOpacity={1}
        onFocus={() => onFocus(item.id, index)}
        onBlur={onBlur}
      >
        <Text
          style={[
            styles.pillText,
            isActive && styles.pillTextActive,
            isFocused && styles.pillTextActive,
          ]}
          numberOfLines={1}
        >
          {String(item.name)}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
});

export default function CategoryPills({ categories, selectedId, onSelect }: CategoryPillsProps) {
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



  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={categories}
        renderItem={({ item, index }) => (
          <PillItem
            item={item}
            index={index}
            selectedId={selectedId}
            focusedId={focusedId}
            onSelect={onSelect}
            onFocus={(id, idx) => {
              setFocusedId(id);
              scrollToIndex(idx);
            }}
            onBlur={() => setFocusedId(null)}
          />
        )}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
        removeClippedSubviews={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "transparent",
    minHeight: PILL_HEIGHT + 20,
  },

  content: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
  },

  pill: {
    paddingHorizontal: isTV ? ps(1.6) : 18,
    borderRadius: PILL_HEIGHT / 2,
    height: PILL_HEIGHT,
    minWidth: MIN_TOUCH,
    backgroundColor: "#111827",
    marginRight: 12,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "transparent",
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
    fontSize: isTV ? ps(1.1) : 15,
    fontWeight: fw("500"),
  },

  pillTextActive: {
    color: "#000000",
    fontWeight: fw("800"),
  },
});

