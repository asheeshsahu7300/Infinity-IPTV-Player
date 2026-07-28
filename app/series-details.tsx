import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Linking,
  Platform,
  TouchableOpacity,
  Dimensions,
  StatusBar,
  ActivityIndicator,
  FlatList,
} from "react-native";
import { Image } from "expo-image";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import * as IntentLauncher from "expo-intent-launcher";

import { usePortalStore, Season, Episode } from "../src/store/portalStore";
import { portalApi } from "../src/services/portalApi";
import { M3UApi } from "../src/services/m3uApi";
import { XtreamApi } from "../src/services/xtreamApi";
import { THEME, pw, ph, ps } from "../src/theme/tokens";
import { isTV } from "../src/utils/tvUtils";
import { CinematicBackground } from "../src/components/CinematicBackground";
import { Focusable, FocusGroup, Overlay } from "../src/tv";
import { launchExternalPlayer } from "../src/utils/externalPlayer";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

// ─────────────────────────────────────────────
// Episode Tile Component
// ─────────────────────────────────────────────
const EpisodeTile = React.memo(function EpisodeTile({
  item,
  index,
  onPress,
  isFocusedItem,
  seriesLogo,
  itemWidth,
}: {
  item: Episode;
  index: number;
  onPress: () => void;
  isFocusedItem?: boolean;
  seriesLogo?: string;
  itemWidth: number;
}) {
  const epNum = item.episodeNum || index + 1;
  const epName = item.name ? item.name.trim() : "";
  const isGeneric =
    !epName ||
    epName.toLowerCase() === `episode ${epNum}`.toLowerCase() ||
    epName.toLowerCase() === `episode ${item.episodeNum}`.toLowerCase() ||
    epName.toLowerCase() === `e${epNum}`.toLowerCase() ||
    epName.toLowerCase() === `${epNum}`.toLowerCase();



  return (
    <Focusable
      onPress={onPress}
      hasTVPreferredFocus={isFocusedItem}
      ringOnFocus={false}
      style={[S.epTileWrapper, { width: itemWidth }]}
    >
      {(focused) => (
        <LinearGradient
          colors={focused
            ? [THEME.colors.primary, THEME.colors.secondary]
            : ["transparent", "transparent"]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            S.epTileBorder,
            focused && S.epTileBorderFocused,
            focused && {
              transform: [{ scale: 1.06 }],
              shadowColor: THEME.colors.primary,
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.6,
              shadowRadius: 10,
              elevation: 14,
            }
          ]}
        >
          <View style={S.epTileInner}>
            <View style={S.epTilePosterContainer}>
              {seriesLogo ? (
                <Image
                  source={{ uri: seriesLogo }}
                  style={S.epTilePoster}
                  contentFit="cover"
                />
              ) : (
                <View style={S.epTilePosterPlaceholder}>
                  <Ionicons name="tv-outline" size={ps(3)} color="rgba(255,255,255,0.15)" />
                </View>
              )}
            </View>
            <View style={S.epTileContent}>
              {!isGeneric && (
                <Text style={S.epTileNum}>EPISODE {epNum}</Text>
              )}
              <Text style={S.epTileTitle} numberOfLines={1}>
                {isGeneric ? `Episode ${epNum}` : epName}
              </Text>
              <View style={S.epTileMetaRow}>
                <Ionicons
                  name="play-circle"
                  size={ps(0.9)}
                  color={focused ? THEME.colors.primary : "rgba(255,255,255,0.3)"}
                />
                {item.duration ? (
                  <>
                    <View style={S.epTileMetaDot} />
                    <Text style={S.epTileMetaText}>{item.duration}</Text>
                  </>
                ) : (
                  <>
                    <View style={S.epTileMetaDot} />
                    <Text style={S.epTileMetaText}>Play Stream</Text>
                  </>
                )}
              </View>
            </View>
          </View>
        </LinearGradient>
      )}
    </Focusable>
  );
});

// ─────────────────────────────────────────────
// Season Pill Component
// ─────────────────────────────────────────────
const SeasonPill = React.memo(function SeasonPill({
  season,
  isActive,
  onPress,
  isFocusedItem,
}: {
  season: Season;
  isActive: boolean;
  onPress: () => void;
  isFocusedItem?: boolean;
}) {


  return (
    <Focusable
      onPress={onPress}
      hasTVPreferredFocus={isFocusedItem}
      ringOnFocus={false}
      style={S.seasonPillWrapper}
    >
      {(focused) => (
        <BlurView
          intensity={isActive && !focused ? 80 : 0}
          tint={isActive ? "light" : "dark"}
          style={[
            S.seasonPillBorder,
            focused && S.seasonPillBorderFocused,
            (focused || isActive) && { backgroundColor: "#fff" }
          ]}
        >
          <View style={[S.seasonPillInner, isActive && S.seasonPillInnerActive, (focused || isActive) && { backgroundColor: "transparent" }]}>
            <Text style={[S.seasonPillText, (isActive || focused) && S.seasonPillTextActive, (isActive || focused) && { color: "#000" }]}>
              {season.name || `Season ${season.seasonNumber}`}
            </Text>
          </View>
        </BlurView>
      )}
    </Focusable>
  );
});

// ─────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────
export default function SeriesDetailsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    id: string;
    name: string;
    logo: string;
    description: string;
    year: string;
    rating: string;
  }>();

  const { activePortal, favorites, toggleFavorite } = usePortalStore();

  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [playModalVisible, setPlayModalVisible] = useState(false);
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  // Trap focus down for ~600ms when switching seasons so the focus engine
  // doesn't fall back upward to the season pills (or the back button) while
  // the episode FlatList reconciles to the new season's data.
  const [trappingUp, setTrappingUp] = useState(false);
  const trapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trapUpBriefly = useCallback(() => {
    setTrappingUp(true);
    if (trapTimeoutRef.current) clearTimeout(trapTimeoutRef.current);
    trapTimeoutRef.current = setTimeout(() => setTrappingUp(false), 600);
  }, []);
  useEffect(() => () => {
    if (trapTimeoutRef.current) clearTimeout(trapTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (!activePortal) { router.replace("/"); return; }
    loadSeriesInfo();
  }, [activePortal?.id, params.id]);

  const loadSeriesInfo = async () => {
    if (!activePortal || !params.id) return;
    try {
      setIsLoading(true);
      let seasonsData: Season[] = [];

      if (activePortal.type === "m3u") {
        const episodes = await new M3UApi({ url: activePortal.config.url }).getSeriesEpisodes(params.id);
        const seasonMap = new Map<number, Season>();
        episodes.forEach((ep) => {
          if (!seasonMap.has(ep.season)) {
            seasonMap.set(ep.season, { id: `S${ep.season}`, name: `Season ${ep.season}`, seasonNumber: ep.season, episodes: [] });
          }
          seasonMap.get(ep.season)!.episodes.push({
            id: ep.id, name: ep.name, episodeNum: ep.episode, seasonNum: ep.season, streamUrl: ep.streamUrl, duration: ep.duration
          });
        });
        seasonsData = [...seasonMap.values()];
      } else if (activePortal.type === "xtream") {
        seasonsData = await new XtreamApi({
          url: activePortal.config.url, username: activePortal.config.username!, password: activePortal.config.password!
        }).getSeriesInfo(params.id);
      } else {
        seasonsData = await portalApi.getSeriesInfo(activePortal, params.id);
      }

      setSeasons(seasonsData);
      if (seasonsData.length > 0) setSelectedSeasonId(seasonsData[0].id);
    } catch (error) {
      console.error(error);
      Alert.alert("Error", "Failed to load series library");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEpisodeClick = useCallback((episode: Episode) => {
    setSelectedEpisode(episode);
    setPlayModalVisible(true);
  }, []);

  const handleModalAction = async (isExternal: boolean) => {
    if (!selectedEpisode || !activePortal) return;

    const episodeSnapshot = selectedEpisode;
    const seriesName = params.name;
    let streamUrl: string | undefined = episodeSnapshot.streamUrl;

    try {
      const currentSeason = seasons.find(s => s.id === selectedSeasonId);
      if (activePortal.type === "mag" && currentSeason?.cmd) {
        const resolved = await portalApi.getStreamUrl(activePortal, currentSeason.cmd, "vod", episodeSnapshot.episodeNum);
        if (resolved) streamUrl = resolved;
      }
    } catch (e) {
      console.warn("Episode stream resolution failed:", e);
    }

    if (!streamUrl) {
      Alert.alert("Error", "Could not resolve a playable stream URL for this episode.");
      return;
    }

    setPlayModalVisible(false);

    const playTitle = `${seriesName} - ${episodeSnapshot.name || `E${episodeSnapshot.episodeNum}`}`;

    try {
      if (isExternal) {
        launchExternalPlayer({ url: streamUrl, title: playTitle });
      } else {
        router.push({
          pathname: "/player",
          params: {
            url: streamUrl,
            title: playTitle,
            type: "vod",
            // Scoped to the series so the same episode number in a different
            // show cannot collide in the resume store.
            contentId: `episode:${params.id}:${episodeSnapshot.id}`,
          },
        });
      }
    } catch (err) {
      console.error("Episode playback launch error:", err);
      Alert.alert("Error", "Failed to start streaming. Make sure a video player app is installed.");
    }
  };

  const getDisplayDescription = (desc: string | undefined | null) => {
    if (!desc) return "No description available for this content.";
    const lower = desc.trim().toLowerCase();
    if (lower === "n/a" || lower === "na" || lower === "undefined" || lower === "null" || lower === "") {
      return "No description available for this content.";
    }
    return desc.trim();
  };

  const currentSeason = seasons.find((s) => s.id === selectedSeasonId);
  const isFavorite = favorites.series.includes(params.id || "");
  const numColumns = isTV ? 7 : 3;

  const CARD_SPACING = 12;
  const GRID_H_PADDING = pw(4) * 2;
  const itemWidth = Math.floor(
    (SCREEN_WIDTH - GRID_H_PADDING - (numColumns * CARD_SPACING)) / numColumns
  );

  const renderEpisode = ({ item, index }: { item: Episode; index: number }) => (
    <EpisodeTile
      item={item}
      index={index}
      onPress={() => handleEpisodeClick(item)}
      isFocusedItem={index === 0}
      seriesLogo={params.logo}
      itemWidth={itemWidth}
    />
  );

  const heroAndSeasons = (
    <>
      {/* --- Header Section --- */}
      <View style={S.heroSection}>
        <Focusable style={S.backBtn} ringOnFocus={false} focusStyle={{ borderColor: "#fff", borderWidth: 2 }} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={ps(1.8)} color="#fff" />
        </Focusable>

        <View style={S.metaContent}>
          <View style={S.posterWrapper}>
            {params.logo ? (
              <Image source={{ uri: params.logo }} style={S.poster} contentFit="cover" />
            ) : (
              <View style={[S.poster, S.posterPlaceholder]}>
                <Ionicons name="tv-outline" size={ps(4)} color="rgba(255,255,255,0.1)" />
              </View>
            )}
          </View>

          <View style={S.infoArea}>
            <Text style={S.title}>{params.name}</Text>

            <View style={S.badgesRow}>
              {params.year && (
                <View style={S.metaBadge}>
                  <Text style={S.metaBadgeText}>{params.year}</Text>
                </View>
              )}
              {params.rating && (
                <View style={[S.metaBadge, { backgroundColor: "rgba(251,191,36,0.15)" }]}>
                  <Ionicons name="star" size={ps(0.9)} color="#fbbf24" style={{ marginRight: 4 }} />
                  <Text style={[S.metaBadgeText, { color: "#fbbf24" }]}>{params.rating}</Text>
                </View>
              )}
              <View style={S.metaBadge}>
                <Text style={S.metaBadgeText}>{seasons.length} Seasons</Text>
              </View>
            </View>

            <Text style={S.description} numberOfLines={isTV ? 8 : 6}>
              {getDisplayDescription(params.description)}
            </Text>

          </View>
        </View>
      </View>

      {/* --- Seasons row --- */}
      <View style={S.episodesSection}>
        <View style={S.sectionHeader}>
          <Text style={S.sectionTitle}>Episodes</Text>
        </View>

        <FocusGroup>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={S.seasonsList}
          >
            {seasons.map((s, i) => (
              <SeasonPill
                key={s.id}
                season={s}
                isActive={selectedSeasonId === s.id}
                isFocusedItem={i === 0 && !selectedSeasonId}
                onPress={() => {
                  if (s.id !== selectedSeasonId) trapUpBriefly();
                  setSelectedSeasonId(s.id);
                }}
              />
            ))}
          </ScrollView>
        </FocusGroup>
      </View>
    </>
  );

  return (
    <View style={[S.container, { paddingTop: insets.top }]}>
      <View
        style={{ flex: 1 }}
        accessibilityElementsHidden={playModalVisible}
        importantForAccessibility={playModalVisible ? "no-hide-descendants" : "auto"}
        pointerEvents={playModalVisible ? "none" : "auto"}
      >
        <CinematicBackground uri={params.logo} />
        <StatusBar hidden />

        {/* Single root VirtualizedList — hero + season pills are the header,
          episodes are the data. Avoids the "VirtualizedLists should never be
          nested inside plain ScrollViews" warning. */}
        <FocusGroup style={S.listArea} trapUp={trappingUp}>
          {isLoading ? (
            <View style={{ flex: 1 }}>
              {heroAndSeasons}
              <ActivityIndicator color={THEME.colors.primary} size="large" style={{ marginTop: ph(5) }} />
            </View>
          ) : (
            <FlatList
              data={currentSeason?.episodes || []}
              renderItem={renderEpisode}
              keyExtractor={(item) => String(item.id)}
              numColumns={numColumns}
              key={`ep-grid-${numColumns}-${selectedSeasonId}`}
              ListHeaderComponent={heroAndSeasons}
              contentContainerStyle={[S.epListContent, { paddingBottom: ph(10) }]}
              removeClippedSubviews={Platform.OS === "android"}
              initialNumToRender={numColumns * 3}
              maxToRenderPerBatch={numColumns * 2}
              windowSize={5}
              updateCellsBatchingPeriod={50}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <View style={{ alignItems: "center", justifyContent: "center", paddingTop: ph(5), opacity: 0.3 }}>
                  <MaterialCommunityIcons name="television-off" size={ps(4)} color="#fff" />
                  <Text style={{ color: "#fff", fontSize: ps(1.2), marginTop: 10 }}>No Episodes Available</Text>
                </View>
              }
            />
          )}
        </FocusGroup>
      </View>

      {/* --- Playback Overlay --- */}
      <Overlay
        visible={playModalVisible}
        onClose={() => setPlayModalVisible(false)}
        style={{ justifyContent: 'flex-end', backgroundColor: 'transparent' }}
        contentStyle={{ width: '100%', maxWidth: '100%', margin: 0, padding: 0 }}
      >
        <BlurView intensity={120} tint="dark" style={{ width: '100%', borderTopLeftRadius: 36, borderTopRightRadius: 36, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.25)", borderBottomWidth: 0 }}>
          {params.logo && (
            <Image
              source={{ uri: params.logo }}
              style={[StyleSheet.absoluteFillObject, { opacity: 0.4 }]}
              blurRadius={40}
              contentFit="cover"
            />
          )}
          <LinearGradient
            colors={['rgba(255,255,255,0.1)', 'rgba(0,0,0,0.5)', '#000']}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={[isTV ? S.modalTVContent : null, { padding: ps(3) }]}>
            <View style={S.modalLeft}>
              <Text style={S.modalTitle} numberOfLines={2}>
                {`S${currentSeason?.seasonNumber || ""} E${selectedEpisode?.episodeNum || ""} : ${selectedEpisode?.name || ""}`}
              </Text>
              <Text style={S.modalDescription} numberOfLines={isTV ? 8 : 5}>
                {getDisplayDescription(selectedEpisode?.description) !== "No description available for this content."
                  ? getDisplayDescription(selectedEpisode?.description)
                  : getDisplayDescription(params.description)}
              </Text>
              <View style={S.modalMetaRow}>
                {selectedEpisode?.duration && (
                  <View style={S.modalBadge}>
                    <Ionicons name="time-outline" size={ps(1)} color="#fff" />
                    <Text style={S.modalBadgeText}>{selectedEpisode.duration}</Text>
                  </View>
                )}
                <View style={S.modalBadge}>
                  <Ionicons name="film-outline" size={ps(1)} color="#fff" />
                  <Text style={S.modalBadgeText}>HD Ready</Text>
                </View>
              </View>
            </View>

            <View style={S.modalRight}>
              <Focusable
                hasTVPreferredFocus
                ringOnFocus={false}
                onPress={() => handleModalAction(false)}
                style={S.modalBtnWrapper}
              >
                {(focused) => (
                  <View style={[S.modalBtnBorder, focused && S.modalBtnBorderFocused]}>
                    <View style={S.modalBtnPrimaryInner}>
                      <Text style={[S.modalBtnPrimaryText, focused && { color: "#000" }]}>WATCH NOW</Text>
                    </View>
                  </View>
                )}
              </Focusable>
              <Focusable
                ringOnFocus={false}
                onPress={() => handleModalAction(true)}
                style={S.modalBtnWrapper}
              >
                {(focused) => (
                  <View style={[S.modalBtnBorder, focused && S.modalBtnBorderFocused]}>
                    <View style={S.modalBtnSecondaryInner}>
                      <Text style={[S.modalBtnSecondaryText, focused && { color: "#000" }]}>EXTERNAL PLAYER</Text>
                    </View>
                  </View>
                )}
              </Focusable>
              <Focusable
                ringOnFocus={false}
                onPress={() => setPlayModalVisible(false)}
                style={S.modalBtnWrapper}
              >
                {(focused) => (
                  <View style={[S.modalBtnBorder, focused && S.modalBtnBorderFocused]}>
                    <View style={S.modalBtnSecondaryInner}>
                      <Text style={[S.modalBtnSecondaryText, focused && { color: "#000" }]}>CLOSE</Text>
                    </View>
                  </View>
                )}
              </Focusable>
            </View>
          </View>
        </BlurView>
      </Overlay>
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.colors.background },
  heroSection: { padding: pw(4), marginBottom: ph(2) },
  backBtn: { width: ps(3.5), height: ps(3.5), borderRadius: 20, backgroundColor: "rgba(255,255,255,0.05)", alignItems: "center", justifyContent: "center", marginBottom: ph(3) },
  metaContent: { flexDirection: isTV ? "row" : "column", alignItems: isTV ? "flex-start" : "center", gap: pw(4) },
  posterWrapper: { width: isTV ? pw(18) : pw(45), aspectRatio: 2 / 3, borderRadius: 20, overflow: "hidden", elevation: 20, shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 20 },
  poster: { ...StyleSheet.absoluteFillObject },
  posterPlaceholder: { backgroundColor: "#1a1a20", alignItems: "center", justifyContent: "center" },
  infoArea: { flex: 1, paddingTop: isTV ? ph(2) : 0 },
  title: { color: "#fff", fontSize: ps(2.2), fontWeight: "900", marginBottom: ph(1.5), textAlign: isTV ? "left" : "center" },
  badgesRow: { flexDirection: "row", gap: 10, marginBottom: ph(2.5), justifyContent: isTV ? "flex-start" : "center" },
  metaBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.05)", flexDirection: "row", alignItems: "center" },
  metaBadgeText: { color: "rgba(255,255,255,0.7)", fontSize: ps(0.9), fontWeight: "700" },
  description: { color: "rgba(255,255,255,0.45)", fontSize: ps(1.15), lineHeight: ps(1.8), marginBottom: ph(4), textAlign: isTV ? "left" : "center" },
  favoriteBtnInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "transparent",
  },
  favoriteBtnFocused: {
    borderColor: "#fff",
    ...Platform.select({
      ios: {
        shadowColor: "#fff",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.6,
        shadowRadius: 12,
      },
      android: {
        elevation: 0,
      }
    })
  },
  favoriteText: { color: "#fff", fontSize: ps(0.9), fontWeight: "800" },

  episodesSection: { paddingHorizontal: pw(4) },
  sectionHeader: { marginBottom: ph(2) },
  sectionTitle: { color: "#fff", fontSize: ps(1.5), fontWeight: "900", opacity: 0.9, marginBottom: ph(1.5) },
  seasonsList: { gap: 12, paddingVertical: 10, paddingBottom: ph(2), paddingRight: pw(10) },

  // ── Season pill: gradient acts as the border ──
  seasonPillWrapper: {
    borderRadius: THEME.radius.full,
    overflow: "visible",
  },
  seasonPillBorder: {
    padding: 1.5,
    borderRadius: THEME.radius.full,
    overflow: "hidden",
  },
  seasonPillBorderFocused: {
    padding: 2.5,
    ...Platform.select({
      ios: {
        shadowColor: "#fff",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.6,
        shadowRadius: 12,
      },
      android: {
        elevation: 0,
      }
    })
  },
  seasonPillInner: {
    paddingHorizontal: 28,
    paddingVertical: 10,
    borderRadius: THEME.radius.full,
    backgroundColor: "#0d0d12",
    justifyContent: "center",
    alignItems: "center",
  },
  seasonPillInnerActive: {
    backgroundColor: "transparent",
  },
  seasonPillText: { color: "rgba(255,255,255,0.5)", fontSize: ps(1), fontWeight: "900", letterSpacing: 0.5 },
  seasonPillTextActive: { color: "#fff" },

  listArea: { flex: 1, minHeight: ph(40), marginTop: ph(2) },
  epListContent: { paddingBottom: ph(5), paddingHorizontal: pw(4) },

  // ── Episode tile: gradient acts as the border ──
  epTileWrapper: {
    margin: 6,
    borderRadius: ps(1.4),
    overflow: "visible",
  },
  epTileBorder: {
    padding: 1,
    borderRadius: ps(1.4),
    backgroundColor: "transparent",
  },
  epTileBorderFocused: {
    padding: 2,
    shadowColor: THEME.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  epTileInner: {
    backgroundColor: "#161622",
    borderRadius: ps(1.2),
    overflow: "hidden",
  },
  epTilePosterContainer: {
    width: "100%",
    aspectRatio: 4 / 5,
    backgroundColor: "#1c1c2b",
    overflow: "hidden",
    borderTopLeftRadius: ps(1.2),
    borderTopRightRadius: ps(1.2),
  },
  epTilePoster: {
    width: "100%",
    height: "100%",
  },
  epTilePosterPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1c1c2b",
  },
  epTileContent: {
    padding: ps(0.7),
    backgroundColor: "#161622",
    borderBottomLeftRadius: ps(1.2),
    borderBottomRightRadius: ps(1.2),
  },
  epTileNum: {
    color: THEME.colors.primary,
    fontSize: ps(0.8),
    fontWeight: "800",
    fontFamily: THEME.fonts.bold,
  },
  epTileTitle: {
    color: "#fff",
    fontSize: ps(0.95),
    fontWeight: "700",
    fontFamily: THEME.fonts.bold,
    marginTop: 2,
  },
  epTileMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    gap: 4,
  },
  epTileMetaText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: ps(0.8),
    fontWeight: "600",
    fontFamily: THEME.fonts.medium,
  },
  epTileMetaDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: "rgba(255,255,255,0.3)",
    marginHorizontal: 4,
  },

  // Modal
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", justifyContent: "center", alignItems: "center" },
  modalContainer: { backgroundColor: "#111", width: isTV ? ps(65) : "92%", borderRadius: 24, padding: ps(2), borderWidth: 1, borderColor: "rgba(255,255,255,0.05)", overflow: "hidden" },
  modalTVContent: { flexDirection: "row" },
  modalLeft: { flex: 1.4, padding: ps(1.5) },
  modalRight: { flex: 0.6, padding: ps(2), paddingRight: isTV ? ps(4) : ps(2), justifyContent: "center", gap: 12 },
  modalTitle: { color: "#fff", fontSize: ps(1.9), fontWeight: "900", marginBottom: 12 },
  modalDescription: { color: "rgba(255,255,255,0.5)", fontSize: ps(1.2), lineHeight: ps(1.4), marginBottom: 18 },
  modalMetaRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  modalBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.05)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  modalBadgeText: { color: "#fff", fontSize: ps(0.85), fontWeight: "700" },
  // ── Play-modal buttons: gradient acts as the border ──
  modalBtnWrapper: { borderRadius: 8, overflow: "visible", width: "100%", maxWidth: 380, alignSelf: "flex-end" },
  modalBtnBorder: { padding: 1, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  modalBtnBorderFocused: {
    padding: 1,
    borderWidth: 0,
    backgroundColor: "#fff",
    ...Platform.select({
      ios: {
        shadowColor: "#fff",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.8,
        shadowRadius: 16,
      },
      android: {
        elevation: 0,
      }
    })
  },
  modalBtnPrimaryInner: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: "transparent", overflow: "hidden" },
  modalBtnSecondaryInner: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.4)", overflow: "hidden" },
  modalBtnPrimaryText: { color: "#fff", fontSize: ps(0.95), fontWeight: "900", letterSpacing: 1 },
  modalBtnSecondaryText: { color: "rgba(255,255,255,0.85)", fontSize: ps(0.9), fontWeight: "700", letterSpacing: 0.5 },
});