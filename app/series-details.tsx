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
import { THEME, pw, ph, ps, HEADER, SELECTION, selectionRung } from "../src/theme/tokens";
import { FOCUS, MATERIALS, RADIUS, focusGlowShadow, sheetShadow } from "../src/theme/materials";
import { isPhone, PHONE_GRID_COLUMNS, PHONE_H_PAD } from "../src/utils/phoneUtils";
import { isTouch, isTablet, TABLET_TILE_MAX_WIDTH } from "../src/utils/tabletUtils";
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
import * as P from "../src/theme/palette";


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
                <View style={[StyleSheet.absoluteFill, S.posterFallback]}>
                  <Tv size={ps(3.5)} color={P.tertiaryLabel} />
                </View>
              )}

              <View style={S.epNumBadge}>
                <Text style={S.epNumBadgeText}>{`E${epNum}`}</Text>
              </View>

              {watched ? (
                <View style={S.epWatchedBadge}>
                  <Check size={ps(1.0)} color={P.label} />
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
      {(focused) => {
        /*
         * The same three-rung ladder the category pills use — this is the same
         * control, and it had drifted into its own treatment: a BlurView
         * wrapper faking a border, a `#fff` fill and black ink.
         *
         * Dropping the BlurView costs nothing. Its intensity was already 0 in
         * every state but one, and on Android it was rendering flat regardless
         * for want of a blur target (see GlassRoot) — so it was a wrapper view
         * doing a border's job.
         */
        const rung = selectionRung(isActive, focused);
        return (
          <View style={[S.seasonPill, SELECTION[rung], focused && S.seasonPillFocused]}>
            <Text
              style={[
                S.seasonPillText,
                rung === "rest"
                  ? SELECTION.restInk
                  : rung === "marked"
                    ? SELECTION.markedInk
                    : SELECTION.filledInk,
              ]}
            >
              {season.name || `Season ${season.seasonNumber}`}
            </Text>
          </View>
        );
      }}
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
  const CARD_SPACING = 12;
  const GRID_H_PADDING = CONTENT_H_PAD * 2;

  /*
   * Tablets derive the count from the tile cap rather than naming it.
   *
   * The old branch was `SCREEN_WIDTH < 768 ? 4 : 5`, i.e. five columns on every
   * tablet from 768dp upwards, with the tile taking whatever width fell out of
   * that. On a 1506dp panel that is a 265x370 episode tile — against the 196dp
   * cap the series grid two screens back applies to the very same artwork — and
   * a single row of them is most of the viewport, so the row below the fold was
   * cut through its titles.
   *
   * `TABLET_TILE_MAX_WIDTH` is the cap live-tv, vod and series already size
   * their grids against, so asking how many of those fit keeps an episode tile
   * and a series tile the same size. `Math.max(5, ...)` holds the old floor, so
   * a 853x533 tablet still comes out at five columns and the identical 144dp
   * tile it has now; only the panels the fixed 5 was never chosen for move.
   */
  const numColumns = isPhone
    ? PHONE_GRID_COLUMNS
    : isTablet
      ? Math.max(
          5,
          Math.ceil((SCREEN_WIDTH - GRID_H_PADDING) / (TABLET_TILE_MAX_WIDTH + CARD_SPACING))
        )
      : isTouch
        ? SCREEN_WIDTH < 768
          ? 4
          : 5
        : 7;
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
                <Tv size={ps(4)} color={P.quaternaryLabel} />
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
        {/* The same plain ground every other page stands on. This passed the
            series backdrop once, which wore blurred artwork where the rest of
            the app is flat — strongest right behind the hero, which is where
            it showed as a band of another colour across the top. */}
        <CinematicBackground />

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
                  <MonitorOff size={ps(4)} color={P.tertiaryLabel} />
                  <Text style={{ color: P.secondaryLabel, fontSize: ps(1.2), marginTop: 10 }}>No Episodes Available</Text>
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
              style={[StyleSheet.absoluteFill, { opacity: 0.22 }]}
              blurRadius={50}
              contentFit="cover"
            />
          ) : null}
          <LinearGradient
            colors={['rgba(0,0,0,0.78)', 'rgba(0,0,0,0.94)', P.systemBackground]}
            style={StyleSheet.absoluteFill}
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
                  <Library size={ps(3.2)} color={P.tertiaryLabel} />
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
                          iconColor: P.systemGreen,
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
                    <Play size={ps(1.15)} color={focused ? P.onTint : P.label} />
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
                    <ExternalLink size={ps(1.15)} color={focused ? P.onTint : P.label} />
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
                      <X size={ps(1.15)} color={focused ? P.onTint : P.label} />
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
   * gutter, matched by `epListContent` and by `GRID_H_PADDING` so
   * the hero, the season pills and the episode grid share one left edge.
   */
  // Vertical padding only on a phone — `epListContent` above owns the gutter,
  // and this sits inside it.
  /*
   * No horizontal padding of its own — the gutter is CONTENT_H_PAD, applied
   * once by the list.
   *
   * The hero and the season pills are the episode list's ListHeaderComponent,
   * so epListContent's paddingHorizontal already wraps them. This added pw(4)
   * on top of it, and so did episodesSection below — which on TV and tablet is
   * the *same* pw(4) twice, putting the hero and the pills at double the gutter
   * while the episode rows stayed at one. The grid then began further left than
   * everything above it.
   *
   * It read as correct on a handset and only there, because both branches
   * collapse to 0 when isPhone.
   *
   * CONTENT_H_PAD's own docblock is explicit that the hero, the season pills
   * and the episode grid share one left edge; these two paddings were what
   * quietly broke that. GRID_H_PADDING divides by CONTENT_H_PAD * 2, so the
   * tile width was being computed against the gutter the grid actually had
   * rather than the one the header was drawing at.
   */
  heroSection: {
    paddingVertical: isPhone ? PHONE_H_PAD : pw(4),
    marginBottom: ph(2),
  },
  // The same round control the grid screens use for search, so a viewer moving
  // between this screen and those sees one button rather than two.
  backBtn: { ...HEADER.iconButton, marginBottom: ph(3) },
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
  posterWrapper: { width: isPhone ? 100 : pw(18), aspectRatio: 2 / 3, borderRadius: RADIUS.lg, borderCurve: "continuous", overflow: "hidden", ...sheetShadow },
  poster: { ...StyleSheet.absoluteFill },
  posterPlaceholder: { backgroundColor: P.tertiaryElevatedSystemBackground, alignItems: "center", justifyContent: "center" },
  infoArea: { flex: 1, justifyContent: "flex-end", paddingBottom: ph(0.8) },
  title: { color: P.label, fontSize: ps(2.2), fontFamily: THEME.fonts.bold, letterSpacing: -0.5, marginBottom: ph(1.5), textAlign: "left" },
  badgesRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: ph(2.5),
    justifyContent: "flex-start",
  },
  ratingBadge: {
    backgroundColor: P.tint,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: RADIUS.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  // Dark ink, because the badge is filled with the off-white tint.
  ratingBadgeText: {
    color: P.onTint,
    fontSize: ps(0.85),
    fontFamily: THEME.fonts.bold,
    letterSpacing: 0.2,
  },
  // Deliberately brighter than `secondaryLabel`: this is the synopsis, which
  // is body copy meant to be read rather than a caption supporting something
  // else. Same value `MediaMetaPanel` uses for the same reason.
  description: { color: "rgba(235, 235, 245, 0.85)", fontSize: ps(1.15), lineHeight: ps(1.8), marginBottom: ph(4), textAlign: "left" },
  favoriteBtnInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: RADIUS.card,
    borderCurve: "continuous",
    borderWidth: 2,
    borderColor: "transparent",
  },
  favoriteBtnFocused: {
    borderColor: P.tintStrong,
    ...focusGlowShadow,
  },
  favoriteText: { color: P.label, fontSize: ps(0.9), fontFamily: THEME.fonts.semibold },

  // Gutter comes from the list — see the note on heroSection.
  episodesSection: {},
  sectionHeader: { marginBottom: ph(2) },
  // The `opacity: 0.9` this carried was doing `secondaryLabel`'s job by hand,
  // and doing it to the whole node rather than to the colour.
  sectionTitle: { color: P.label, fontSize: ps(1.5), fontFamily: THEME.fonts.semibold, letterSpacing: -0.3, marginBottom: ph(1.5) },
  seasonsList: { gap: 12, paddingVertical: 10, paddingBottom: ph(2), paddingRight: pw(10) },

  // ── Season pill: gradient acts as the border ──
  seasonPillWrapper: {
    borderRadius: THEME.radius.full,
    overflow: "hidden",
  },
  // One box where there were two. The fill, edge and ink all come from
  // `SELECTION`; only the shape and the focus lift are this screen's own.
  seasonPill: {
    paddingHorizontal: 28,
    paddingVertical: 10,
    borderRadius: THEME.radius.full,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  // `focusGlowShadow` is iOS-only by construction — on Android an elevated
  // pill shadows the pills beside it in the row, the same constraint
  // `TILE_FRAME_FOCUSED` documents. Taking it from the theme rather than
  // hand-rolling the Platform.select keeps this bloom the same colour and
  // radius as every other focused surface.
  seasonPillFocused: {
    transform: [{ scale: FOCUS.scale }],
    ...focusGlowShadow,
  },
  seasonPillText: { fontSize: ps(1), fontFamily: THEME.fonts.medium, letterSpacing: 0.3 },

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
    borderRadius: RADIUS.lg,
    overflow: "visible",
  },
  episodeCardContainerFocused: {},
  posterFrame: {
    width: "100%",
    borderRadius: RADIUS.lg,
    borderCurve: "continuous",
    overflow: "hidden",
    backgroundColor: P.secondaryElevatedSystemBackground,
    borderWidth: 1,
    borderColor: MATERIALS.thin.edge,
  },
  // No `elevation` — these sit in a grid, and on Android a lifted card draws
  // its shadow over the cards beside it. The same constraint TILE_FRAME_FOCUSED
  // documents; the edge and the lift carry focus on their own.
  posterFrameFocused: {
    borderColor: FOCUS.edge,
    borderWidth: 1,
    transform: [{ scale: FOCUS.scale }],
    ...focusGlowShadow,
  },
  posterImage: { width: "100%", height: "100%", borderRadius: RADIUS.lg, overflow: "hidden" },
  posterFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: P.secondaryElevatedSystemBackground,
  },
  episodeTitleText: {
    color: P.secondaryLabel,
    fontSize: ps(0.92),
    fontFamily: THEME.fonts.medium,
    marginTop: 8,
    lineHeight: 20,
  },
  // The card is not filled on focus — only its frame lights up — so this stays
  // light ink and simply comes up to full strength.
  episodeTitleTextFocused: {
    color: P.label,
    fontFamily: THEME.fonts.semibold,
  },
  epNumBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    backgroundColor: P.scrimHeavy,
    borderRadius: RADIUS.xs,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
  },
  epNumBadgeText: {
    color: P.label,
    fontSize: ps(0.8),
    fontFamily: THEME.fonts.bold,
    letterSpacing: 0.2,
  },
  epWatchedBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: P.scrimHeavy,
    borderRadius: RADIUS.full,
    padding: 5,
  },
  resumeBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 3.5,
    backgroundColor: P.scrim,
  },
  resumeProgress: { height: "100%", backgroundColor: P.tint },

  // Modal Styles
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", justifyContent: "center", alignItems: "center" },
  modalContainer: { width: ps(65), borderRadius: RADIUS.xl, borderCurve: "continuous", padding: ps(2), borderWidth: 1, borderColor: P.glassEdge, overflow: "hidden" },
  modalSurface: {
    width: '100%',
    borderTopLeftRadius: ps(2),
    borderTopRightRadius: ps(2),
    overflow: 'hidden',
    borderWidth: 0,
    // The `thick` material's own fill, so this sheet and every sheet built
    // from `GlassSurface` are the same surface. It is still a hand-styled
    // BlurView here because the modal predates the primitive.
    backgroundColor: P.elevatedSystemBackground,
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
    borderRadius: RADIUS.sm,
    borderCurve: "continuous",
    overflow: "hidden",
    backgroundColor: P.quaternarySystemFill,
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
    backgroundColor: P.quaternarySystemFill,
  },
  cornerRatingBadge: {
    position: "absolute",
    bottom: 6,
    right: 6,
    backgroundColor: P.scrimHeavy,
    borderWidth: 0,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: RADIUS.xs,
    elevation: 4,
  },
  cornerRatingText: {
    color: P.label,
    fontSize: ps(0.85),
    fontFamily: THEME.fonts.bold,
    letterSpacing: 0.2,
  },
  modalTypeBadge: {
    alignSelf: "flex-start",
    backgroundColor: P.tertiarySystemFill,
    paddingHorizontal: ps(0.6),
    paddingVertical: ps(0.2),
    borderRadius: RADIUS.xs,
    marginBottom: ps(0.5),
  },
  modalTypeBadgeText: {
    color: P.secondaryLabel,
    fontSize: ps(0.7),
    fontFamily: THEME.fonts.bold,
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
    color: P.label,
    fontSize: ps(1.6),
    fontFamily: THEME.fonts.semibold,
    letterSpacing: -0.3,
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
    backgroundColor: P.tint,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: RADIUS.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  modalRatingBadgeText: {
    color: P.onTint,
    fontSize: ps(0.85),
    fontFamily: THEME.fonts.bold,
    letterSpacing: 0.2,
  },
  modalMetaDot: {
    color: P.quaternaryLabel,
    fontSize: ps(1.05),
    fontFamily: THEME.fonts.semibold,
    marginHorizontal: pw(0.8),
  },
  modalBtnWrapper: {
    borderRadius: RADIUS.sm,
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
    borderRadius: RADIUS.sm,
    borderCurve: "continuous",
    borderWidth: 0,
    borderColor: "transparent",
    backgroundColor: P.tertiarySystemFill,
  },
  modalBtnPillFocused: {
    backgroundColor: P.tint,
    borderColor: "transparent",
    borderWidth: 0,
    elevation: 8,
    transform: [{ scale: 1.05 }],
  },
  modalBtnText: {
    color: P.label,
    fontSize: ps(1.0),
    fontFamily: THEME.fonts.semibold,
    letterSpacing: 0.3,
  },
  // Dark, because `modalBtnPillFocused` fills with the off-white tint.
  modalBtnTextFocused: {
    color: P.onTint,
    fontSize: ps(1.0),
    fontFamily: THEME.fonts.semibold,
    letterSpacing: 0.3,
  },
});