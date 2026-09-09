import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { View, StyleSheet, ScrollView, Linking, Platform, TouchableOpacity, Dimensions, StatusBar, ActivityIndicator, FlatList, useWindowDimensions } from 'react-native';
import { Image } from "expo-image";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import * as IntentLauncher from "expo-intent-launcher";

import { usePortalStore, Season, Episode, MediaMeta } from "../src/store/portalStore";
import { portalApi } from "../src/services/portalApi";
import { M3UApi } from "../src/services/m3uApi";
import { XtreamApi } from "../src/services/xtreamApi";
import { THEME, pw, ph, ps } from "../src/theme/tokens";
import { isPhone, PHONE_GRID_COLUMNS, PHONE_H_PAD } from "../src/utils/phoneUtils";
import { isTouch } from "../src/utils/tabletUtils";
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
import { Check, ExternalLink, Library, Play, Star, Tv, MonitorOff, X , PlayCircle} from 'lucide-react-native';
import { Text } from '../src/components/Text';


/**
 * The screen's horizontal gutter, in dp.
 *
 * One constant because three separate things have to agree on it and they are
 * far apart in the file: `epListContent` (the loaded state's padding),
 * `loadingWrap` (the loading state's), and `GRID_H_PADDING` (the number
 * `itemWidth` divides by). They were literals, and every time one moved the
 * others did not — the grid overflowed once because the padding and the width
 * calculation disagreed, and the hero shifted sideways when the spinner gave
 * way to the list because the two render branches disagreed.
 */
const CONTENT_H_PAD = isPhone ? PHONE_H_PAD : pw(4);

const cleanMeta = (s?: string | null) => {
  if (!s) return "";
  const lower = s.trim().toLowerCase();
  if (lower === "n/a" || lower === "na" || lower === "null" || lower === "undefined" || lower === "0") return "";
  return s.trim();
};

const formatRating = (val?: string | number | null) => {
  if (!val) return "";
  const s = String(val).trim();
  const lower = s.toLowerCase();
  if (lower === "0" || lower === "0.0" || lower === "null" || lower === "undefined" || lower === "n/a") return "";
  const num = parseFloat(s);
  return !isNaN(num) && num > 0
    ? (Number.isInteger(num) ? num.toFixed(1) : String(Math.round(num * 10) / 10))
    : s;
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
  const posterHeight = Math.round((itemWidth - 10) * 1.45);

  return (
    <View style={[S.episodeItemWrapper, { width: itemWidth }]}>
      <Focusable
        onPress={onPress}
        onFocus={() => onFocus?.(item)}
        hasTVPreferredFocus={isFocusedItem}
        ringOnFocus={false}
        accessibilityLabel={titleText}
      >
        {(focused) => (
          <View style={[S.episodeCardContainer, focused && S.episodeCardContainerFocused]}>
            <View
              style={[
                S.posterFrame,
                { height: posterHeight },
                focused && S.posterFrameFocused,
              ]}
            >
              {artwork ? (
                <Image
                  source={{ uri: artwork }}
                  style={S.posterImage}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={200}
                />
              ) : (
                <View style={[StyleSheet.absoluteFillObject, S.posterFallback]}>
                  <Tv size={ps(3.5)} color="rgba(255,255,255,0.32)" />
                </View>
              )}

              <View style={S.epNumBadge}>
                <Text style={S.epNumBadgeText}>{`E${epNum}`}</Text>
              </View>

              {watched ? (
                <View style={S.epWatchedBadge}>
                  <Check size={ps(1.0)} color="#ffffff" />
                </View>
              ) : null}

              {progress > 0 && !watched ? (
                <View style={S.resumeBar}>
                  <View style={[S.resumeProgress, { width: `${Math.round(progress * 100)}%` }]} />
                </View>
              ) : null}

              {rating ? (
                <View style={S.cornerRatingBadge}>
                  <Text style={S.cornerRatingText}>{rating}</Text>
                </View>
              ) : null}
            </View>

            <Text
              style={[S.episodeTitleText, focused && S.episodeTitleTextFocused]}
              numberOfLines={1}
            >
              {titleText}
            </Text>
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

  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const currentSeason = seasons.find((s) => s.id === selectedSeasonId);
  const isFavorite = favorites.series.includes(params.id || "");
  // Three on a phone, the same count the poster grids use. The touch branch
  // keys off `SCREEN_WIDTH < 768`, which a handset satisfies, so left alone it
  // would ask for four.
  const numColumns = isPhone
    ? PHONE_GRID_COLUMNS
    : isTouch
      ? SCREEN_WIDTH < 768
        ? 4
        : 5
      : 7;

  const CARD_SPACING = 12;
  const GRID_H_PADDING = CONTENT_H_PAD * 2;
  /*
   * `itemWidth` is the tile's *outer* width, and the tile separates itself with
   * `episodeItemWrapper`'s own `paddingHorizontal` rather than a margin — so on
   * a phone there is nothing outside the tiles for the `CARD_SPACING` term to
   * pay for, and subtracting it just left 38dp of dead space at the end of each
   * row. Three tiles now divide the full content width.
   *
   * The term stays for TV and tablet, whose grids were laid out against it.
   */
  const itemWidth = Math.floor(
    isPhone
      ? (SCREEN_WIDTH - GRID_H_PADDING) / numColumns
      : (SCREEN_WIDTH - GRID_H_PADDING - (numColumns * CARD_SPACING)) / numColumns
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

  /*
   * The hero's synopsis and credits, hoisted so the two layouts can place them
   * differently without the element existing twice.
   *
   * Credits come from the series either way — episodes do not carry their own
   * cast — but the synopsis prefers the focused episode's, falling back to the
   * series'. Same rule as the episode sheet and the player's episode list.
   *
   * On TV and tablet this sits in the column beside the poster. On a phone that
   * column is far too narrow for it (see `metaContent`), so it drops to a
   * full-width band underneath. Only one of the two ever renders.
   */
  const seriesMetaPanel = (
    <MediaMetaPanel
      meta={{
        ...seriesMeta,
        plot: focusedEpisode?.description || seriesMeta?.plot,
      }}
      fallbackPlot={params.description}
      plotLines={5}
      emptyText={
        focusedEpisode
          ? "No description available for this episode."
          : "No description available for this series."
      }
    />
  );

  /*
   * The play sheet's synopsis and credits — the episode's plot where it has
   * one, the series' otherwise. Hoisted for the same reason as
   * `seriesMetaPanel` above: the phone puts it in a full-width band below the
   * poster row, TV keeps it in the column beside the poster, and only one of
   * the two renders.
   */
  const episodeMetaPanel = (
    <MediaMetaPanel
      meta={{
        ...seriesMeta,
        plot: selectedEpisode?.description || seriesMeta?.plot,
      }}
      fallbackPlot={params.description}
      plotLines={5}
      emptyText="No description available for this episode."
    />
  );

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
                <Tv size={ps(4)} color="rgba(255,255,255,0.1)" />
              </View>
            )}
          </View>

          <View style={S.infoArea}>
            <Text style={S.title}>{params.name}</Text>

            <View style={S.badgesRow}>
              {(() => {
                const r = formatRating(focusedEpisode?.rating || params.rating);
                return r ? (
                  <View style={S.ratingBadge}>
                    <Text style={S.ratingBadgeText}>{r}</Text>
                  </View>
                ) : null;
              })()}
              <MetaFacts
                facts={[
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

            {!isPhone && seriesMetaPanel}

          </View>

          {/* Description — its own full-width band on a phone. */}
          {isPhone && <View style={S.heroDescBlock}>{seriesMetaPanel}</View>}
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
            <View style={S.loadingWrap}>
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
                  <MonitorOff size={ps(4)} color="#fff" />
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
          <View style={[S.modalTVContent, S.modalBody, isPhone && { paddingBottom: 10 + insets.bottom }]}>
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
                  <Library size={ps(3.2)} color="rgba(255,255,255,0.3)" />
                </View>
              )}
              {(selectedEpisode?.rating || params.rating) && parseFloat(String(selectedEpisode?.rating || params.rating)) > 0 ? (
                <View style={S.cornerRatingBadge}>
                  <Text style={S.cornerRatingText}>
                    {(() => {
                      const num = parseFloat(String(selectedEpisode?.rating || params.rating));
                      return Number.isInteger(num) ? num.toFixed(1) : String(Math.round(num * 10) / 10);
                    })()}
                  </Text>
                </View>
              ) : null}
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
                {(() => {
                  const formatted = formatRating(selectedEpisode?.rating || params.rating);
                  return formatted ? (
                    <>
                      <View style={S.modalRatingBadge}>
                        <Text style={S.modalRatingBadgeText}>{formatted}</Text>
                      </View>
                      <Text style={S.modalMetaDot}>·</Text>
                    </>
                  ) : null;
                })()}
                <MetaFacts
                  facts={[
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

              {!isPhone && episodeMetaPanel}
            </View>

            {/* Description — its own full-width band on a phone. */}
            {isPhone && <View style={S.modalDescBlock}>{episodeMetaPanel}</View>}

            {/* Actions */}
            <View style={S.modalRight}>
              <Focusable
                hasTVPreferredFocus
                ringOnFocus={false}
                onPress={() => handleModalAction(false)}
                style={S.modalBtnWrapper}
              >
                {(focused) => (
                  <View style={[S.modalBtnPill, focused && S.modalBtnPillFocused]}>
                    <Play size={ps(1.15)} color={focused ? "#000000" : "#FFFFFF"} />
                    <Text style={[S.modalBtnText, focused && S.modalBtnTextFocused]}>WATCH NOW</Text>
                  </View>
                )}
              </Focusable>
              <Focusable
                ringOnFocus={false}
                onPress={() => handleModalAction(true)}
                style={S.modalBtnWrapper}
              >
                {(focused) => (
                  <View style={[S.modalBtnPill, focused && S.modalBtnPillFocused]}>
                    <ExternalLink size={ps(1.15)} color={focused ? "#000000" : "#FFFFFF"} />
                    <Text style={[S.modalBtnText, focused && S.modalBtnTextFocused]}>EXTERNAL PLAYER</Text>
                  </View>
                )}
              </Focusable>
              {/* No Close on a phone — `Overlay` leaves `closeOnBack` at its
                  default, so the backdrop tap and hardware back both dismiss.
                  It stays on TV, where a remote has neither. Same as vod. */}
              {!isPhone && (
                <Focusable
                  ringOnFocus={false}
                  onPress={() => setPlayModalVisible(false)}
                  style={S.modalBtnWrapper}
                >
                  {(focused) => (
                    <View style={[S.modalBtnPill, focused && S.modalBtnPillFocused]}>
                      <X size={ps(1.15)} color={focused ? "#000000" : "#FFFFFF"} />
                      <Text style={[S.modalBtnText, focused && S.modalBtnTextFocused]}>CLOSE</Text>
                    </View>
                  )}
                </Focusable>
              )}
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
  /*
   * `pw` is a percentage of the *long* edge, so `pw(4)` is 35dp a side on a
   * portrait handset — 70 of 393, before anything is laid out. An absolute
   * gutter on a phone, matched by `episodesSection` and by `GRID_H_PADDING` so
   * the hero, the season pills and the episode grid share one left edge.
   */
  // Vertical padding only on a phone — `epListContent` above owns the gutter,
  // and this sits inside it.
  heroSection: {
    paddingHorizontal: isPhone ? 0 : pw(4),
    paddingVertical: isPhone ? PHONE_H_PAD : pw(4),
    marginBottom: ph(2),
  },
  backBtn: { width: ps(3.5), height: ps(3.5), borderRadius: 20, backgroundColor: "rgba(255,255,255,0.05)", alignItems: "center", justifyContent: "center", marginBottom: ph(3) },
  /*
   * On a phone this wraps into two bands: poster beside the title, then the
   * description full width beneath.
   *
   * Unwrapped it gave the info column 131dp — 323 of content less a 157dp
   * poster and a 35dp gap — and a five-line synopsis at 11dp in 131dp of width
   * is about ten characters a line. The poster comes down to 100 as well, since
   * it now only has to stand beside the title and the badges.
   */
  metaContent: {
    flexDirection: "row",
    flexWrap: isPhone ? "wrap" : "nowrap",
    alignItems: "flex-end",
    gap: isPhone ? 14 : pw(4),
  },
  /** The synopsis and credits as their own full-width band, phones only. */
  heroDescBlock: { width: "100%" },
  posterWrapper: { width: isPhone ? 100 : pw(18), aspectRatio: 2 / 3, borderRadius: 20, overflow: "hidden", elevation: 20, shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 20 },
  poster: { ...StyleSheet.absoluteFillObject },
  posterPlaceholder: { backgroundColor: "#1a1a20", alignItems: "center", justifyContent: "center" },
  infoArea: { flex: 1, justifyContent: "flex-end", paddingBottom: ph(0.8) },
  title: { color: "#fff", fontSize: ps(2.2), fontWeight: "900", marginBottom: ph(1.5), textAlign: "left" },
  badgesRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: ph(2.5),
    justifyContent: "flex-start",
  },
  ratingBadge: {
    backgroundColor: "#F5F5F5",
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  ratingBadgeText: {
    color: "#000000",
    fontSize: ps(0.85),
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  description: { color: "rgba(255,255,255,0.45)", fontSize: ps(1.15), lineHeight: ps(1.8), marginBottom: ph(4), textAlign: "left" },
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

  episodesSection: { paddingHorizontal: isPhone ? 0 : pw(4) },
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
  /*
   * The one horizontal gutter on this screen, and on a phone the only one.
   *
   * The hero and the seasons row are this list's `ListHeaderComponent`, so this
   * padding wraps them too — and they were each adding their own on top of it.
   * The left inset was `pw(4)` here plus `PHONE_H_PAD` in `heroSection`: 43dp
   * of a 393dp screen before anything was drawn. Those two now contribute 0
   * horizontally on a phone and this is the whole gutter.
   */
  epListContent: { paddingBottom: ph(5), paddingHorizontal: CONTENT_H_PAD },

  /**
   * The loading state's wrapper.
   *
   * It renders the same `heroAndSeasons` as the list's header does, but it is
   * not the list — so it has to carry the gutter itself. Without it the hero
   * sat flush against the screen edge while the spinner showed and then jumped
   * inwards the moment the episodes arrived.
   */
  loadingWrap: { flex: 1, paddingHorizontal: CONTENT_H_PAD },

  // ── Episode tile: styled identically to VOD Movie tile ──
  episodeItemWrapper: {
    paddingHorizontal: 5,
    paddingTop: 4,
    paddingBottom: 4,
    overflow: "visible",
  },
  episodeCardContainer: {
    borderRadius: 16,
    overflow: "visible",
  },
  episodeCardContainerFocused: {},
  posterFrame: {
    width: "100%",
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#17181c",
    borderWidth: 1,
    borderColor: "transparent",
  },
  posterFrameFocused: {
    borderColor: "#ffffff",
    borderWidth: 1,
    transform: [{ scale: 1.03 }],
    elevation: 12,
  },
  posterImage: { width: "100%", height: "100%" },
  posterFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#17181c",
  },
  episodeTitleText: {
    color: "rgba(255,255,255,0.75)",
    fontSize: ps(0.92),
    fontWeight: "700",
    marginTop: 8,
    lineHeight: 20,
  },
  episodeTitleTextFocused: {
    color: "#ffffff",
    fontWeight: "900",
  },
  epNumBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    borderRadius: 7,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
  },
  epNumBadgeText: {
    color: "#FFFFFF",
    fontSize: ps(0.8),
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  epWatchedBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    borderRadius: 12,
    padding: 5,
  },
  resumeBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 3.5,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  resumeProgress: { height: "100%", backgroundColor: "#F5F5F5" },

  // Modal Styles
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", justifyContent: "center", alignItems: "center" },
  modalContainer: { width: ps(65), borderRadius: 24, padding: ps(2), borderWidth: 1, borderColor: "rgba(255,255,255,0.05)", overflow: "hidden" },
  modalSurface: {
    width: '100%',
    borderTopLeftRadius: ps(2),
    borderTopRightRadius: ps(2),
    overflow: 'hidden',
    borderWidth: 0,
    backgroundColor: 'rgba(10, 12, 18, 0.95)',
  },
  modalBody: {
    padding: isPhone ? PHONE_H_PAD : ps(2.2),
  },
  /*
   * Three stacked bands on a phone, exactly as the vod sheet: poster beside the
   * title, then the description, then the actions. The lower two take
   * `width: "100%"`, which cannot share a wrap line, so they break onto their
   * own. Unwrapped, the 1.4/0.65 split left the actions column too narrow for
   * "EXTERNAL PLAYER" and its icon.
   */
  modalTVContent: {
    flexDirection: "row",
    flexWrap: isPhone ? "wrap" : "nowrap",
    alignItems: isPhone ? "flex-start" : "center",
  },
  /** Synopsis and credits as their own full-width band, phones only. */
  modalDescBlock: { width: "100%", marginTop: 14 },
  modalPosterWrapper: {
    width: isPhone ? 72 : pw(11),
    aspectRatio: 2 / 3,
    borderRadius: ps(0.8),
    overflow: "hidden",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    marginRight: isPhone ? 12 : pw(2),
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
  cornerRatingBadge: {
    position: "absolute",
    bottom: 6,
    right: 6,
    backgroundColor: "rgba(0, 0, 0, 0.78)",
    borderWidth: 0,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 7,
    elevation: 4,
  },
  cornerRatingText: {
    color: "#FFFFFF",
    fontSize: ps(0.85),
    fontWeight: "900",
    letterSpacing: 0.2,
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
    paddingRight: isPhone ? 0 : ps(1.5),
    justifyContent: "center",
    alignSelf: isPhone ? "center" : "auto",
  },
  modalRight: {
    // `flex: 0` with a full width is what forces the wrap onto its own line.
    flex: isPhone ? 0 : 0.65,
    width: isPhone ? "100%" : undefined,
    paddingLeft: isPhone ? 0 : ps(1.5),
    marginTop: isPhone ? 32 : 0,
    justifyContent: "center",
    gap: isPhone ? 10 : ps(0.8),
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
  modalRatingBadge: {
    backgroundColor: "#F5F5F5",
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  modalRatingBadgeText: {
    color: "#000000",
    fontSize: ps(0.85),
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  modalMetaDot: {
    color: "rgba(255,255,255,0.28)",
    fontSize: ps(1.05),
    fontWeight: "700",
    marginHorizontal: pw(0.8),
  },
  modalBtnWrapper: {
    borderRadius: 10,
    overflow: "visible",
    width: "100%",
  },
  modalBtnPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: ps(0.6),
    paddingVertical: ps(0.95),
    paddingHorizontal: ps(1.5),
    borderRadius: 10,
    borderWidth: 0,
    borderColor: "transparent",
    backgroundColor: "#17181c",
  },
  modalBtnPillFocused: {
    backgroundColor: "#F5F5F5",
    borderColor: "transparent",
    borderWidth: 0,
    elevation: 8,
    transform: [{ scale: 1.05 }],
  },
  modalBtnText: {
    color: "#FFFFFF",
    fontSize: ps(1.0),
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  modalBtnTextFocused: {
    color: "#000000",
    fontSize: ps(1.0),
    fontWeight: "900",
    letterSpacing: 0.3,
  },
});