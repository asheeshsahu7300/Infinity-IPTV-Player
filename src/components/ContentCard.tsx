/**
 * ContentCard — TV-optimised shared card component
 * Aspect ratios: 16:9 (channels), 2:3 (VOD/Series), 1:1 (logos)
 * Implements: focus scale 1.06×, gradient border, glow shadow, 3 states
 */
import React, { useState, useEffect } from "react";
import { View, StyleSheet, Animated } from 'react-native';
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Focusable } from "../tv";
import { pw, ps, THEME } from "../theme/tokens";
import * as P from "../theme/palette";
import { FOCUS, RADIUS } from "../theme/materials";
import { Heart } from 'lucide-react-native';
import { DynamicIcon } from '../components/DynamicIcon';
import { GlassSurface } from './GlassSurface';
import { Text } from './Text';


export type CardAspectRatio = "16:9" | "2:3" | "1:1";
export type CardType = "channel" | "vod" | "series";

interface ContentCardProps {
  title: string;
  subtitle?: string;
  image?: string;
  isFavorite?: boolean;
  onPress: () => void;
  onFavorite?: () => void;
  type?: CardType;
  aspectRatio?: CardAspectRatio;
  itemWidth?: number;
  autoFocus?: boolean;
}

const RATIO_MAP: Record<CardAspectRatio, number> = {
  "16:9": 16 / 9,
  "2:3": 3 / 4,
  "1:1": 1,
};

const PLACEHOLDER_ICON: Record<CardType, string> = {
  channel: "tv",
  vod: "film",
  series: "layers",
};

export const ContentCard = React.memo(function ContentCard({
  title,
  subtitle,
  image,
  isFavorite,
  onPress,
  onFavorite,
  type = "channel",
  aspectRatio = "16:9",
  itemWidth,
  autoFocus = false,
}: ContentCardProps) {
  const [shouldFocus, setShouldFocus] = useState(autoFocus);
  useEffect(() => {
    if (autoFocus) {
      setShouldFocus(true);
      const timer = setTimeout(() => setShouldFocus(false), 500);
      return () => clearTimeout(timer);
    }
  }, [autoFocus]);

  return (
    <View style={[S.outer, itemWidth ? { width: itemWidth } : {}]}>
      <Focusable
        onPress={onPress}
        onLongPress={onFavorite}
        hasTVPreferredFocus={shouldFocus}
        ringOnFocus={false}
        style={{ overflow: "visible" }}
      >
        {(focused) => {
          const cardContent = (
            <View style={S.card}>
              {/* ── Image / Thumbnail ── */}
              <View style={[S.imageContainer, { aspectRatio: RATIO_MAP[aspectRatio] }]}>
                {image ? (
                  <Image
                    source={{ uri: image }}
                    style={S.image}
                    contentFit={aspectRatio === "16:9" ? "cover" : "contain"}
                  />
                ) : (
                  <View style={S.placeholder}>
                    <DynamicIcon
                      name={PLACEHOLDER_ICON[type]}
                      size={ps(2)}
                      color={P.quaternaryLabel}
                    />
                  </View>
                )}

                {/* Compact card gradient overlay for text legibility */}
                {image && (
                  <LinearGradient
                    colors={["transparent", "rgba(0,0,0,0.55)"]}
                    style={S.imageOverlay}
                  />
                )}

                {/* Favourite badge */}
                {isFavorite && (
                  <View style={S.favBadge}>
                    <Heart size={ps(1)} color={P.systemPink} />
                  </View>
                )}
              </View>

              {/* ── Content Block ── */}
              <View style={S.info}>
                <Text style={S.title} numberOfLines={1}>
                  {title}
                </Text>
                {subtitle ? (
                  <Text style={S.subtitle} numberOfLines={1}>
                    {subtitle}
                  </Text>
                ) : null}
              </View>
            </View>
          );

          // One frame, both states — the same wrapper the VOD poster uses.
          //
          // Focus used to swap this whole branch for a LinearGradient filling a
          // `padding: 1.5` box: a fake border, in the app's accent colours, and
          // the reason this card never matched the poster grids it sits next to.
          // The resting branch was the same box left transparent, so at rest
          // there was no border at all.
          //
          // The frame is now a `thin` material rather than a hand-styled box.
          // `thin` because a card sits over decorative artwork: it wants enough
          // body to separate from the backdrop and not so much that it looks
          // like a panel. The focused edge, wash, sheen and iOS bloom all come
          // from the material, so this call site no longer describes focus at
          // all beyond passing the flag through.
          return (
            <GlassSurface
              material="thin"
              radius={RADIUS.card}
              focused={focused}
              style={[
                S.frame,
                focused && { transform: [{ scale: FOCUS.scale }] },
              ]}
            >
              {cardContent}
            </GlassSurface>
          );
        }}
      </Focusable>
    </View>
  );
});

export default ContentCard;

const S = StyleSheet.create({
  outer: {
    padding: pw(0.8),
    overflow: "visible",
  },
  // The frame lives out here, on the card's outermost box. Putting it on
  // `card` below instead would draw a border inside a border — the same
  // box-in-a-box the settings rows ended up with.
  //
  // Only the padding now: the radius, border, fill and every focus treatment
  // belong to the `GlassSurface` this is spread onto. The `padding: 1` is what
  // holds the artwork one pixel inside the border so the corners nest, and it
  // is the one part of the old `TILE_FRAME` that is a layout concern rather
  // than a material one.
  frame: { padding: 1, overflow: "visible" },
  // Inner content, clipped one step inside `frame` so the corners nest
  // instead of leaving a sliver of frame showing through. Transparent, because
  // the frame carries the wash — this used to be an opaque #161622 slab.
  card: {
    backgroundColor: "transparent",
    borderRadius: RADIUS.card - 1,
    overflow: "hidden",
  },
  imageContainer: {
    width: "100%",
    // The placeholder behind artwork that has not decoded yet. Apple's
    // tertiary elevated background rather than the blue-tinged `#1c1c2b` it
    // was, so an un-decoded tile reads as an empty surface rather than as a
    // tile of a slightly different colour.
    backgroundColor: P.tertiaryElevatedSystemBackground,
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  imageOverlay: {
    ...StyleSheet.absoluteFill,
  },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  favBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: P.scrim,
    borderRadius: RADIUS.full,
    padding: 5,
  },
  info: {
    padding: ps(0.7),
  },
  title: {
    color: P.label,
    fontSize: ps(1.15),
    fontFamily: THEME.fonts.semibold,
    // Apple tightens tracking as type gets larger and loosens it as it gets
    // smaller. A card title is small enough to want none of either, but the
    // subtitle below is small enough to want the loosening.
    letterSpacing: -0.1,
  },
  subtitle: {
    color: P.secondaryLabel,
    fontSize: ps(0.9),
    marginTop: 4,
    letterSpacing: 0.1,
  },
});
