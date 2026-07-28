import React, { useRef, useEffect, useState, useCallback } from 'react';
import { View, TouchableOpacity, Text, StyleSheet, FlatList, Animated } from 'react-native';
import { Category } from '../store/portalStore';
import { THEME } from '../theme/tokens';

interface CategoryPillsProps {
  categories: Category[];
  selectedId: string;
  onSelect: (id: string) => void;
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
}, (prevProps, nextProps) => {
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.isActive === nextProps.isActive &&
    prevProps.isFocused === nextProps.isFocused &&
    prevProps.index === nextProps.index
  );
});

PillItem.displayName = "PillItem";

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



  const handleFocus = useCallback((id: string, idx: number) => {
    setFocusedId(id);
    scrollToIndex(idx);
  }, [scrollToIndex]);

  const handleBlur = useCallback(() => {
    setFocusedId(null);
  }, []);

  return (
    <View style={styles.container}>
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
        keyExtractor={(item) => item.id}
        horizontal
        contentContainerStyle={styles.content}
        initialNumToRender={8}
        maxToRenderPerBatch={6}
        windowSize={5}
        updateCellsBatchingPeriod={50}
        removeClippedSubviews={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "transparent",
    minHeight: 60,
  },

  content: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
  },

  pill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    height: 40,
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
    fontSize: 15,
    fontWeight: "500",
    lineHeight: 18,
  },

  pillTextActive: {
    color: "#fff",
  },
});

