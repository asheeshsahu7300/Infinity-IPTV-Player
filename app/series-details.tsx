import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,  Linking,
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

import { usePortalStore, Season, Episode, MediaMeta } from "../src/store/portalStore";
import { portalApi } from "../src/services/portalApi";
import { M3UApi } from "../src/services/m3uApi";
import { XtreamApi } from "../src/services/xtreamApi";
import { THEME, pw, ph, ps } from "../src/theme/tokens";
import { isTV } from "../src/utils/tvUtils";
import { CinematicBackground } from "../src/components/CinematicBackground";
import { Focusable, FocusGroup, Overlay } from "../src/tv";
import { useDialog } from "../src/components/ConfirmDialog";
import { parentalControl } from "../src/services/parentalControl";
import { playbackQueue, queueFromEpisodes } from "../src/services/playbackQueue";
import { resumeIndex } from "../src/services/resumeIndex";
import PinPrompt from "../src/components/PinPrompt";
import MediaMetaPanel from "../src/components/MediaMetaPanel";
import MetaFacts from "../src/components/MetaFacts";
import { mergeMeta } from "../src/services/metaText";
import { formatRuntime } from "../src/utils/duration";
import { launchExternalPlayer } from "../src/utils/externalPlayer";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

const cleanMeta = (s?: string | null) => {
  if (!s) return "";
  const lower = s.trim().toLowerCase();
  if (lower === "n/a" || lower === "na" || lower === "null" || lower === "undefined" || lower === "0") return "";
  return s.trim();
};

// ─────────────────────────────────────────────
// Episode Tile Component (Styled identically to VOD Movie Tile)
// ─────────────────────────────────────────────
const EpisodeTile = React.memo(function EpisodeTile({
  item,
  index,
  onPress,
  onFocus,
  isFocusedItem,
  seriesLogo,
  itemWidth,
  contentId,
  resumeVersion,
}: {
  item: Episode;
  index: number;
  onPress: () => void;
  onFocus?: (item: Episode) => void;
  isFocusedItem?: boolean;
  seriesLogo?: string;
  itemWidth: number;
  /** Stable content id, so the tile can read its own resume position. */
  contentId: string;
  /** Bumped when a resume position is written — see the note in vod.tsx. */
  resumeVersion: number;
}) {
  const epNum = item.episodeNum || index + 1;

  // Half-watched episodes carry a bar; watched ones carry a tick.
  const progress = useMemo(
    () => resumeIndex.progressFor(contentId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contentId, resumeVersion]
  );

  const runtime = useMemo(() => {
    const r = formatRuntime(item.duration);
    return cleanMeta(r);
  }, [item.duration]);

  const airDate = useMemo(() => cleanMeta(item.airDate), [item.airDate]);
  const rating = useMemo(() => cleanMeta(item.rating), [item.rating]);
  const artwork = item.still || seriesLogo;

  const watched = progress >= 0.92;
  const epName = item.name ? item.name.trim() : "";
  const isGeneric =
    !epName ||
    epName.toLowerCase() === `episode ${epNum}`.toLowerCase() ||
    epName.toLowerCase() === `episode ${item.episodeNum}`.toLowerCase() ||
    epName.toLowerCase() === `e${epNum}`.toLowerCase() ||
    epName.toLowerCase() === `${epNum}`.toLowerCase();

  const titleText = isGeneric ? `Episode ${epNum}` : epName;
  const subtitleText = [runtime, airDate].filter(Boolean).join(" · ") || (isGeneric ? "" : `Episode ${epNum}`);

  return (
    <View style={{ width: itemWidth, padding: pw(0.8), overflow: "visible" }}>
      <Focusable
        onPress={onPress}
        onFocus={() => onFocus?.(item)}
        hasTVPreferredFocus={isFocusedItem}
        ringOnFocus={false}
        accessibilityLabel={titleText}
      >
        {(focused) => (
          <View
            style={[
              S.cardBorder,
              { height: Math.round(itemWidth * 1.45) },
              focused && S.cardBorderFocused,
              focused && { transform: [{ scale: 1.06 }] },
            ]}
          >
            <View style={S.vodItem}>
              <View style={S.posterContainer}>
                {artwork ? (
                  <Image
                    source={{ uri: artwork }}
                    style={S.poster}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                ) : (
                  <View style={S.posterPlaceholder}>
                    <Ionicons name="tv-outline" size={ps(3)} color="rgba(255,255,255,0.15)" />
                  </View>
                )}

                <View style={S.epNumBadge}>
                  <Text style={S.epNumBadgeText}>{`E${epNum}`}</Text>
                </View>

                {watched ? (
                  <View style={S.epWatchedBadge}>
                    <Ionicons name="checkmark" size={ps(0.9)} color="#fff" />
                  </View>
                ) : null}

                {progress > 0 && !watched ? (
                  <View style={S.resumeTrack}>
                    <View style={[S.resumeFill, { width: `${Math.round(progress * 100)}%` }]} />
                  </View>
                ) : null}
              </View>

              <LinearGradient
                colors={
                  focused
                    ? ["transparent", "rgba(0,0,0,0.65)", "rgba(0,0,0,0.96)"]
                    : ["transparent", "rgba(0,0,0,0.5)", "rgba(0,0,0,0.9)"]
                }
                style={S.cardContent}
              >
                <Text style={S.vodTitle} numberOfLines={1}>{titleText}</Text>
                {(subtitleText || rating) ? (
                  <View style={S.metaRow}>
                    {subtitleText ? (
                      <Text style={S.vodMetaText} numberOfLines={1}>
                        {subtitleText}
                      </Text>
                    ) : null}
                    {subtitleText && rating ? <View style={S.metaDot} /> : null}
                    {rating ? (
                      <View style={S.ratingWrapper}>
                        <Ionicons name="star" size={ps(0.7)} color="#FFD700" style={{ marginRight: 2 }} />
                        <Text style={S.ratingText}>{rating}</Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </LinearGradient>
            </View>
          </View>
        )}
      </Focusable>
    </View>
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
  // Errors surface through an in-tree overlay — Alert.alert does not
  // reliably appear on an Android TV release build.
  const { notify, node: dialogNode } = useDialog();
  const params = useLocalSearchParams<{
    id: string;
    name: string;
    logo: string;
    description: string;
    year: string;
    rating: string;
  }>();

  const { activePortal, favorites, toggleFavorite } = usePortalStore();
  // The library row for this series — until get_series_info answers, it is the
  // only place its cast, director and genre live. See seriesMeta below.
  const storeSeries = usePortalStore((s) => s.series);

  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [focusedEpisode, setFocusedEpisode] = useState<Episode | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [playModalVisible, setPlayModalVisible] = useState(false);
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  // Trap focus down for ~600ms when switching seasons so the focus engine
  // doesn't fall back upward to the season pills (or the back button) while
  // the episode FlatList reconciles to the new season's data.
  const [trappingUp, setTrappingUp] = useState(false);
  /** Episode held behind the parental PIN; the prompt reopens the play sheet. */
  const [pinTarget, setPinTarget] = useState<Episode | null>(null);
  const [resumeVersion, setResumeVersion] = useState(0);

  useEffect(() => {
    parentalControl.load();
    resumeIndex.load();
    return resumeIndex.subscribe(() => setResumeVersion((v) => v + 1));
  }, []);
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
      notify("Could Not Load Series", "The series library failed to load. Please try again.", "danger");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEpisodeClick = useCallback((episode: Episode) => {
    // The parental lock sits on the series, not on individual episodes: a show
    // locked because of what it is does not become watchable at episode four.
    if (parentalControl.isLocked("series", { id: params.id, name: params.name })) {
      setSelectedEpisode(episode);
      setPinTarget(episode);
      return;
    }
    setSelectedEpisode(episode);
    setPlayModalVisible(true);
  }, [params.id, params.name]);

  const handleModalAction = async (isExternal: boolean) => {
    const latestPortal = usePortalStore.getState().activePortal ?? activePortal;
    if (!selectedEpisode || !latestPortal) return;

    const episodeSnapshot = selectedEpisode;
    const seriesName = params.name;
    let streamUrl: string | undefined = episodeSnapshot.streamUrl;

    const currentSeason = seasons.find((s) => s.id === selectedSeasonId);
    const cmd = episodeSnapshot.cmd || currentSeason?.cmd;

    try {
      if (latestPortal.type === "mag" && cmd) {
        const resolved = await portalApi.getStreamUrl(latestPortal, cmd, "vod", episodeSnapshot.episodeNum);
        if (resolved) streamUrl = resolved;
      }
    } catch (e) {
      console.warn("Episode stream resolution failed:", e);
    }

    if (!streamUrl) {
      notify("Playback Unavailable", "Could not resolve a playable stream URL for this episode.", "danger");
      return;
    }

    setPlayModalVisible(false);

    const playTitle = `${seriesName} - ${episodeSnapshot.name || `E${episodeSnapshot.episodeNum}`}`;
    const contentId = `episode:${params.id}:${episodeSnapshot.id}`;

    // The rest of the season goes with it, so the player can move between
    // episodes and roll into the next one without coming back here. External
    // players get nothing to queue into, so they are left alone.
    if (!isExternal) {
      const currentSeason = seasons.find((s) => s.id === selectedSeasonId);
      const items = queueFromEpisodes(
        currentSeason?.episodes ?? [],
        params.id,
        seriesName,
        currentSeason?.name ?? "Season",
        currentSeason?.cmd,
        params.logo
      );
      const index = Math.max(0, items.findIndex((i) => i.id === contentId));
      playbackQueue.start(
        items,
        index,
        `${seriesName} · ${currentSeason?.name ?? "Season"}`,
        latestPortal.id,
        // Episodes roll on; that is the whole reason for the queue.
        true
      );
    }

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
            contentId,
            cmd: cmd || streamUrl,
            logo: params.logo || "",
          },
        });
      }
    } catch (err) {
      console.error("Episode playback launch error:", err);
      notify("Playback Failed", "Failed to start streaming. Make sure a video player app is installed.", "danger");
    }
  };

  /**
   * The series' credits, from two sources layered together.
   *
   * The screen is reached by route params, which are strings — so the cast,
   * director and genre the *library row* already carried could not travel with
   * it. That is why this hero showed a plot (it arrives as `description`) and
   * nothing else. So the row is looked up again from the store by id, and the
   * richer `get_series_info` block layered over it where a portal supplies one.
   *
   * Order matters, and so does using `mergeMeta` rather than a spread: the
   * readers return every key with the absent ones `undefined`, so a plain
   * spread of the detail call would erase whatever the row did know.
   */
  const seriesMeta = useMemo(() => {
    const fromRow = storeSeries.find((s) => String(s.id) === String(params.id));
    const fromInfo = seasons.find((s) => s.seriesMeta)?.seriesMeta;
    const rowMeta: MediaMeta | null = fromRow
      ? {
        cast: fromRow.cast,
        director: fromRow.director,
        tags: fromRow.tags,
        plot: fromRow.plot,
        country: fromRow.country,
        releaseDate: fromRow.releaseDate,
        backdrop: fromRow.backdrop,
        trailer: fromRow.trailer,
      }
      : null;

    if (!rowMeta && !fromInfo) return null;
    return mergeMeta<MediaMeta>(rowMeta, fromInfo);
  }, [storeSeries, params.id, seasons]);

  /** Total across every season, for the hero badge. */
  const episodeCount = useMemo(
    () => seasons.reduce((total, s) => total + (s.episodes?.length ?? 0), 0),
    [seasons]
  );

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
      onFocus={(ep) => setFocusedEpisode(ep)}
      contentId={`episode:${params.id}:${item.id}`}
      resumeVersion={resumeVersion}
      isFocusedItem={index === 0}
      seriesLogo={params.logo}
      itemWidth={itemWidth}
    />
  );

  /**
   * What the hero shows beside the title.
   *
   * Episode-level where the provider has it, series-level otherwise. Only
   * Xtream publishes per-episode stills; on MAG this is always the series
   * poster, which is why the fallback matters more than the preference.
   */
  const heroArtwork = focusedEpisode?.still || params.logo || undefined;

  const heroAndSeasons = (
    <>
      {/* --- Header Section --- */}
      <View style={S.heroSection}>
        <View style={S.metaContent}>
          {/* The focused episode's own still, falling back to the series
              poster — the same rule the episode sheet and the player's episode
              list follow. This was the one place still pinned to the series
              image, so moving along the row updated the title, the facts and
              the plot beside it while the artwork stayed put. */}
          <View style={S.posterWrapper}>
            {heroArtwork ? (
              <Image
                source={{ uri: heroArtwork }}
                style={S.poster}
                contentFit="cover"
                transition={140}
              />
            ) : (
              <View style={[S.poster, S.posterPlaceholder]}>
                <Ionicons name="tv-outline" size={ps(4)} color="rgba(255,255,255,0.1)" />
              </View>
            )}
          </View>

          <View style={S.infoArea}>
            <Text style={S.title}>{params.name}</Text>

            {focusedEpisode ? (
              <View style={S.focusedEpBanner}>
                <Text style={S.focusedEpTitle} numberOfLines={1}>
                  {`S${currentSeason?.seasonNumber || 1}:E${focusedEpisode.episodeNum || 1} · ${focusedEpisode.name || `Episode ${focusedEpisode.episodeNum}`}`}
                </Text>
                <View style={S.badgesRow}>
                  <MetaFacts
                    facts={[
                      { icon: "star", iconColor: "#fbbf24", text: focusedEpisode.rating || params.rating },
                      { text: focusedEpisode.videoQuality },
                      { text: focusedEpisode.audioLanguage },
                      { text: formatRuntime(focusedEpisode.duration) },
                      { text: focusedEpisode.airDate },
                      (() => {
                        const seen = resumeIndex.progressFor(`episode:${params.id}:${focusedEpisode.id}`);
                        return seen > 0
                          ? {
                              icon: "play-circle-outline" as const,
                              iconColor: "#4ade80",
                              text: `${Math.round(seen * 100)}% watched`,
                              tone: "accent" as const,
                            }
                          : null;
                      })(),
                    ]}
                  />
                </View>
              </View>
            ) : (
              <View style={S.badgesRow}>
                <MetaFacts
                  facts={[
                    { icon: "star", iconColor: "#fbbf24", text: params.rating },
                    { text: params.year || seriesMeta?.releaseDate?.slice(0, 4) },
                    {
                      text: seasons.length
                        ? `${seasons.length} ${seasons.length === 1 ? "Season" : "Seasons"}`
                        : null,
                    },
                    {
                      text: episodeCount
                        ? `${episodeCount} ${episodeCount === 1 ? "Episode" : "Episodes"}`
                        : null,
                    },
                    { text: seriesMeta?.country },
                  ]}
                />
              </View>
            )}

            {/* Credits come from the series either way — episodes do not carry
                their own cast — but the synopsis prefers the focused episode's,
                falling back to the series'. Same rule as the episode sheet and
                the player's episode list. */}
            <MediaMetaPanel
              meta={{
                ...seriesMeta,
                plot: focusedEpisode?.description || seriesMeta?.plot,
              }}
              fallbackPlot={params.description}
              plotLines={isTV ? 5 : 4}
              emptyText={
                focusedEpisode
                  ? "No description available for this episode."
                  : "No description available for this series."
              }
            />

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
      >
        <CinematicBackground uri={seriesMeta?.backdrop || params.logo} />

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
              initialNumToRender={numColumns * 2}
              maxToRenderPerBatch={numColumns}
              windowSize={3}
              updateCellsBatchingPeriod={30}
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
        <BlurView intensity={120} tint="dark" style={S.modalSurface}>
          {(selectedEpisode?.still || params.logo) ? (
            <Image
              source={{ uri: selectedEpisode?.still || params.logo }}
              style={[StyleSheet.absoluteFillObject, { opacity: 0.22 }]}
              blurRadius={50}
              contentFit="cover"
            />
          ) : null}
          <LinearGradient
            colors={['rgba(10,12,18,0.78)', 'rgba(8,8,12,0.96)', '#08080a']}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={[isTV ? S.modalTVContent : null, S.modalBody]}>
            {/* Poster / Episode Still thumbnail */}
            <View style={S.modalPosterWrapper}>
              {(selectedEpisode?.still || params.logo) ? (
                <Image
                  source={{ uri: selectedEpisode?.still || params.logo }}
                  style={S.modalPosterImg}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : (
                <View style={S.modalPosterFallback}>
                  <Ionicons name="albums-outline" size={ps(3.2)} color="rgba(255,255,255,0.3)" />
                </View>
              )}
            </View>

            {/* Details */}
            <View style={S.modalLeft}>
              <View style={S.modalTypeBadge}>
                <Text style={S.modalTypeBadgeText}>
                  {`S${currentSeason?.seasonNumber || 1} · E${selectedEpisode?.episodeNum || 1}`}
                </Text>
              </View>
              <Text style={S.modalTitle} numberOfLines={2}>
                {selectedEpisode?.name || `Episode ${selectedEpisode?.episodeNum || ""}`}
              </Text>
              <View style={S.modalMetaRow}>
                <MetaFacts
                  facts={[
                    {
                      icon: "star",
                      iconColor: "#FFD700",
                      text: selectedEpisode?.rating || params.rating,
                    },
                    { text: selectedEpisode?.videoQuality },
                    { text: selectedEpisode?.audioLanguage },
                    { text: formatRuntime(selectedEpisode?.duration) },
                    { text: selectedEpisode?.airDate },
                    (() => {
                      const seen = resumeIndex.progressFor(
                        `episode:${params.id}:${selectedEpisode?.id}`
                      );
                      return seen > 0
                        ? {
                          icon: "play-circle-outline" as const,
                          iconColor: "#4ade80",
                          text: `${Math.round(seen * 100)}% watched`,
                          tone: "accent" as const,
                        }
                        : null;
                    })(),
                  ]}
                />
              </View>

              <MediaMetaPanel
                meta={{
                  ...seriesMeta,
                  plot: selectedEpisode?.description || seriesMeta?.plot,
                }}
                fallbackPlot={params.description}
                plotLines={isTV ? 5 : 3}
                emptyText="No description available for this episode."
              />
            </View>

            {/* Actions */}
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
                      <Ionicons name="play" size={ps(1.1)} color="#000" />
                      <Text style={S.modalBtnPrimaryText}>WATCH NOW</Text>
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
                    <View style={[S.modalBtnSecondaryInner, focused && { backgroundColor: "#fff" }]}>
                      <Ionicons name="open-outline" size={ps(1.1)} color={focused ? "#000" : "#fff"} />
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
                    <View style={[S.modalBtnSecondaryInner, focused && { backgroundColor: "#fff" }]}>
                      <Ionicons name="close" size={ps(1.1)} color={focused ? "#000" : "#fff"} />
                      <Text style={[S.modalBtnSecondaryText, focused && { color: "#000" }]}>CLOSE</Text>
                    </View>
                  </View>
                )}
              </Focusable>
            </View>
          </View>
        </BlurView>
      </Overlay>

      <PinPrompt
        visible={!!pinTarget}
        title="Series Locked"
        message={`Enter your PIN to watch ${params.name}.`}
        onSubmit={(pin) => parentalControl.unlock(pin)}
        onCancel={() => setPinTarget(null)}
        onSuccess={() => {
          setPinTarget(null);
          setPlayModalVisible(true);
        }}
      />

      {dialogNode}
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

  // ── Episode tile: styled identically to VOD Movie tile ──
  cardBorder: {
    borderRadius: ps(1.1),
    overflow: "visible",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  cardBorderFocused: {
    padding: 1,
    borderColor: THEME.colors.glassBorderFocus,
    backgroundColor: THEME.colors.glassBgFocus,
    ...Platform.select({
      ios: {
        shadowColor: "#fff",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.6,
        shadowRadius: 16,
      },
      android: {
        elevation: 0,
      }
    })
  },
  vodItem: { flex: 1, backgroundColor: "transparent", borderRadius: ps(1.1), overflow: "hidden" },
  posterContainer: { flex: 1, backgroundColor: "rgba(255,255,255,0.03)" },
  cardContent: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    width: "100%",
    paddingHorizontal: ps(0.65),
    paddingBottom: ps(0.45),
    paddingTop: ps(1.2),
    borderBottomLeftRadius: ps(1.1),
    borderBottomRightRadius: ps(1.1),
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  vodTitle: {
    color: "#fff",
    fontSize: ps(0.92),
    fontWeight: "700",
    textShadowColor: "rgba(0, 0, 0, 0.95)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  vodMetaText: { color: "rgba(255,255,255,0.7)", fontSize: ps(0.78), fontWeight: "600" },
  metaDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: "rgba(255,255,255,0.4)", marginHorizontal: 5 },
  ratingWrapper: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255, 215, 0, 0.15)", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  ratingText: { color: "#FFD700", fontSize: ps(0.75), fontWeight: "800", marginLeft: 2 },
  epWatchedBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    width: ps(1.8),
    height: ps(1.8),
    borderRadius: ps(0.9),
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    alignItems: "center",
    justifyContent: "center",
  },
  epNumBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    paddingHorizontal: ps(0.5),
    paddingVertical: ps(0.2),
    borderRadius: ps(0.4),
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    borderWidth: 0.5,
    borderColor: "rgba(255, 255, 255, 0.2)",
  },
  epNumBadgeText: {
    color: "#fff",
    fontSize: ps(0.7),
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  focusedEpBanner: {
    marginTop: ph(0.5),
    marginBottom: ph(0.5),
  },
  focusedEpTitle: {
    color: "#fff",
    fontSize: ps(1.2),
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  resumeTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  resumeFill: { height: "100%", backgroundColor: "#e50914" },

  // Modal Styles
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", justifyContent: "center", alignItems: "center" },
  modalContainer: { width: isTV ? ps(65) : "92%", borderRadius: 24, padding: ps(2), borderWidth: 1, borderColor: "rgba(255,255,255,0.05)", overflow: "hidden" },
  modalSurface: {
    width: '100%',
    borderTopLeftRadius: ps(2),
    borderTopRightRadius: ps(2),
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.2)",
    borderBottomWidth: 0,
    backgroundColor: 'rgba(10, 12, 18, 0.95)',
  },
  modalBody: {
    padding: ps(2.2),
  },
  modalTVContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  modalPosterWrapper: {
    width: isTV ? pw(11) : pw(22),
    aspectRatio: 2 / 3,
    borderRadius: ps(0.8),
    overflow: "hidden",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    marginRight: isTV ? pw(2) : pw(3),
  },
  modalPosterImg: {
    width: "100%",
    height: "100%",
  },
  modalPosterFallback: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
  },
  modalTypeBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    paddingHorizontal: ps(0.6),
    paddingVertical: ps(0.2),
    borderRadius: ps(0.3),
    marginBottom: ps(0.5),
  },
  modalTypeBadgeText: {
    color: "#FFFFFF",
    fontSize: ps(0.7),
    fontWeight: "800",
    letterSpacing: 1,
  },
  modalLeft: {
    flex: 1.4,
    paddingRight: ps(1.5),
    justifyContent: "center",
  },
  modalRight: {
    flex: 0.65,
    paddingLeft: ps(1.5),
    justifyContent: "center",
    gap: ps(0.8),
  },
  modalTitle: {
    color: "#FFFFFF",
    fontSize: ps(1.6),
    fontWeight: "800",
    marginBottom: ps(0.6),
  },
  modalMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: ps(0.6),
    marginBottom: ps(0.4),
    flexWrap: "wrap",
  },
  modalBtnWrapper: {
    borderRadius: ps(0.6),
    overflow: "visible",
    width: "100%",
  },
  modalBtnBorder: {
    padding: 1,
    borderRadius: ps(0.6),
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
  },
  modalBtnBorderFocused: {
    borderColor: "#FFFFFF",
    backgroundColor: "#FFFFFF",
  },
  modalBtnPrimaryInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: ps(0.4),
    paddingVertical: ps(0.7),
    paddingHorizontal: ps(1.2),
    borderRadius: ps(0.5),
    backgroundColor: "#FFFFFF",
  },
  modalBtnSecondaryInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: ps(0.4),
    paddingVertical: ps(0.7),
    paddingHorizontal: ps(1.2),
    borderRadius: ps(0.5),
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  modalBtnPrimaryText: {
    color: "#000000",
    fontSize: ps(0.88),
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  modalBtnSecondaryText: {
    color: "#FFFFFF",
    fontSize: ps(0.88),
    fontWeight: "700",
    letterSpacing: 0.5,
  },
});