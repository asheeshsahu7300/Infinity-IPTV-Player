import React, { useRef, useEffect, useState, useCallback } from 'react';
import { View, TouchableOpacity, StyleSheet, FlatList, Animated, StyleProp, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Category } from '../store/portalStore';
import { bareCategoryId } from '../hooks/useCategoryContent';
import { SELECTION, selectionRung, THEME } from '../theme/tokens';
import * as P from '../theme/palette';
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

  const rung = selectionRung(isActive, isFocused);

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={[
          styles.pill,
          rung === "marked" && styles.pillMarked,
          rung === "filled" && styles.pillFilled,
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
            rung === "marked" && styles.pillTextMarked,
            rung === "filled" && styles.pillTextFilled,
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
  /**
   * Compare category ids the way the rest of the app does, not with `===`.
   *
   * The same category travels under two spellings — a bare `"123"` and a
   * type-prefixed `"live:123"` — which is why `bareCategoryId` and
   * `isAllCategory` exist, and why `live-tv` validates its selection with an
   * `isSameCat` that strips the prefix. This component was the one place
   * still comparing raw strings, so a selection every other check agreed was
   * valid could match no pill: live-tv saw its stored category in the list
   * and left it alone, and the row rendered with nothing highlighted. Most
   * visible on first open, where there has been no tap to resolve it.
   */
  const activeId = bareCategoryId(selectedId);
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
      const index = categories.findIndex((c) => bareCategoryId(c.id) === activeId);
      if (index !== -1) {
        // Delay slightly to ensure layout
        setTimeout(() => {
          if (isMounted.current) scrollToIndex(index);
        }, 200);
      }
    }
  }, [activeId, selectedId, categories, focusedId, scrollToIndex]);



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
            isActive={bareCategoryId(item.id) === activeId}
            isFocused={focusedId === item.id}
            onSelect={onSelect}
            onFocus={handleFocus}
            onBlur={handleBlur}
          />
        ), [activeId, focusedId, onSelect, handleFocus, handleBlur])}
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
    // A resting pill is a fill, not a surface: Apple's segmented controls and
    // filter chips sit on `tertiarySystemFill` rather than on a material,
    // because a row of a dozen glass panes is a dozen sets of edges and sheens
    // competing for the same strip of screen. The glass here is the bar the
    // row sits in, not the pills themselves.
    backgroundColor: P.tertiarySystemFill,
    marginRight: isPhone ? 8 : 10,
    justifyContent: "center",
    alignItems: "center",
    // One hairline, matching the sidebar and the season pills — the three share
    // SELECTION, so they should share the weight of the edge it hands them.
    // Two was sized for a light ring on a dark pill; the focused edge is a dark
    // ring on a white one now, which is far more visible and needs less of it.
    borderWidth: 1,
    borderColor: "transparent",
    borderCurve: "continuous",
  },

  pillLogo: {
    width: isPhone ? 18 : 20,
    height: isPhone ? 18 : 20,
    marginRight: isPhone ? 7 : 8,
    borderRadius: 4,
    // Against `maxWidth` above, the label yields and the logo does not.
    flexShrink: 0,
  },

  /**
   * Selected, with the cursor elsewhere: the wash rung.
   *
   * These two used to be the other way round — the selected pill filled solid
   * and the focused one took the wash — which is the opposite of what the
   * sidebar did with the same two states. They are the same control in two
   * orientations, so they now share one ladder; see `SELECTION` in
   * theme/tokens.
   */
  pillMarked: {
    ...SELECTION.marked,
    zIndex: 10,
  },

  /** Under the cursor, or selected on a device that has no cursor. */
  pillFilled: {
    ...SELECTION.filled,
    zIndex: 10,
  },

  pillText: {
    // `secondaryLabel`, not the flat `#888` it was. A resting pill's label has
    // to read as the same white as the selected one, turned down — a grey
    // reads as a different colour against a translucent fill, which is what
    // made the unselected pills look disabled rather than merely unselected.
    color: P.secondaryLabel,
    fontSize: isPhone ? 15.5 : 15,
    fontFamily: THEME.fonts.medium,
    /*
     * 16/18 was below Inter's own line box (about 1.21x the font size, so 16.4
     * and 18.2 are the minimums here) and clipped the descenders of g, y and p
     * from underneath. Set at 1.3x, which clears the metrics and still fits the
     * pill exactly: 18 + 12 padding + 4 border is the 34 above.
     */
    lineHeight: isPhone ? 20.7 : 20,
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

  /** Ink on the wash: full strength white, since the wash only lightens. */
  pillTextMarked: SELECTION.markedInk,

  /**
   * Ink on the solid fill: dark, because the fill is an off-white.
   *
   * This value has now been inverted twice — dark for the original ivory
   * accent, white while the accent was systemBlue, dark again now. Both times
   * the failure mode was the same and invisible in review: ink and fill the
   * same colour. It comes from `SELECTION` rather than from a literal here
   * precisely so the pair cannot be moved one at a time a third time.
   */
  pillTextFilled: SELECTION.filledInk,
});

