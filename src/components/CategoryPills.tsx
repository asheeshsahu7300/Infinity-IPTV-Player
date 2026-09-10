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
          /*
           * The pill grows with the text now, but only so far before a row of
           * them stops being a row. Small accessibility font settings are
           * honoured; the extremes are not.
           */
          maxFontSizeMultiplier={1.2}
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
   * `minHeight` is the lever rather than `paddingVertical`, because the pill
   * sets its own height and centres its children, so the padding never decides
   * the size.
   *
   * It is `minHeight` and not `height` because a fixed height does not clip an
   * overlong child, it lets it paint outside the rounded rect -- the pill kept
   * its 34dp and the label sat across the border. There were only about 2dp of
   * vertical slack (34 - 4 border - 12 padding = 18, against an 16dp line), so
   * anything that grew the line box at all spilled: the OS "large text" setting
   * first of all. Below, the line box is given room to be its natural size and
   * the pill grows to meet it instead of being overrun.
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
    minHeight: isPhone ? 34 : 40,
    /*
     * The guide's pills are channels, not categories -- "128. Sky Sports Main
     * Event HD" rather than "Sports" -- and nothing upstream bounds them, so a
     * single pill could run wider than the screen. The label truncates at this
     * width instead. Categories are short and never reach it.
     */
    maxWidth: isPhone ? 210 : 280,
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
    // Against `maxWidth` above, the label yields and the logo does not.
    flexShrink: 0,
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
    /*
     * 16/18 was below Inter's own line box (about 1.21x the font size, so 16.4
     * and 18.2 are the minimums here) and clipped the descenders of g, y and p
     * from underneath. Set at 1.3x, which clears the metrics and still fits the
     * pill exactly: 18 + 12 padding + 4 border is the 34 above.
     */
    lineHeight: isPhone ? 18 : 20,
    /*
     * The actual reason the label sat outside the pill on Android.
     *
     * RN Android leaves `includeFontPadding` on by default, which adds the
     * font's own ascent/descent padding *on top of* the line box. The measured
     * Text is then several dp taller than the `lineHeight` above says it is,
     * and it is not symmetric -- so in a container this tight the glyphs are
     * both pushed past the pill's edge and knocked off centre while doing it.
     * With it off the line box is exactly `lineHeight`, which is what every
     * number here was worked out against. iOS never had the padding.
     */
    includeFontPadding: false,
    textAlignVertical: "center",
    /*
     * RN defaults flexShrink to 0, unlike the web. Without this the label is
     * laid out at its full natural width and simply paints past the pill's
     * right edge once `maxWidth` bounds the parent -- numberOfLines never gets
     * the chance to ellipsize, because nothing ever tells the text it is short
     * of room. minWidth undoes the implicit auto floor that would otherwise
     * stop the shrink at the longest unbreakable word.
     */
    flexShrink: 1,
    minWidth: 0,
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

