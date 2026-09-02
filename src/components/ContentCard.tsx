/**
 * ContentCard — TV-optimised shared card component
 * Aspect ratios: 16:9 (channels), 2:3 (VOD/Series), 1:1 (logos)
 * Implements: focus scale 1.06×, gradient border, glow shadow, 3 states
 */
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Focusable } from "../tv";
import { THEME, pw, ph, ps } from "../theme/tokens";

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

const PLACEHOLDER_ICON: Record<CardType, keyof typeof MaterialCommunityIcons.glyphMap> = {
  channel: "television-play",
  vod: "movie-outline",
  series: "television-classic",
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
                    <MaterialCommunityIcons
                      name={PLACEHOLDER_ICON[type]}
                      size={ps(2)}
                      color="rgba(255,255,255,0.15)"
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
                    <Ionicons name="heart" size={ps(1)} color="#ff2d55" />
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

          if (focused) {
            return (
              <LinearGradient
                colors={[THEME.colors.primary, THEME.colors.secondary]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[
                  S.gradientBorder,
                  {
                    transform: [{ scale: 1.06 }],
                    shadowColor: THEME.colors.primary,
                    shadowOffset: { width: 0, height: 6 },
                    shadowOpacity: 0.6,
                    shadowRadius: 10,
                    elevation: 14,
                  },
                ]}
              >
                {cardContent}
              </LinearGradient>
            );
          }

          return (
            <View style={[S.gradientBorder, { backgroundColor: "transparent" }]}>
              {cardContent}
            </View>
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
  gradientBorder: {
    padding: 1.5,
    borderRadius: ps(1.2),
  },
  card: {
    backgroundColor: "#161622",
    borderRadius: ps(1.1),
    overflow: "hidden",
  },
  imageContainer: {
    width: "100%",
    backgroundColor: "#1c1c2b",
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
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
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 10,
    padding: 5,
  },
  info: {
    padding: ps(0.7),
  },
  title: {
    color: "#fff",
    fontSize: ps(1.15),
    fontWeight: "700",
  },
  subtitle: {
    color: "rgba(255,255,255,0.5)",
    fontSize: ps(0.9),
    marginTop: 4,
    fontFamily: THEME.fonts.regular,
  },
});
