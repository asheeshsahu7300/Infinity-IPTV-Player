import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  StatusBar,
  TextInput,
  RefreshControl,
  FlatList,
  Platform,
  InteractionManager,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";

import { usePortalStore, Channel, Category } from "../src/store/portalStore";
import { portalApi } from "../src/services/portalApi";
import { M3UApi } from "../src/services/m3uApi";
import { XtreamApi } from "../src/services/xtreamApi";
import { StreamManager } from "../src/services/StreamManager";
import { cacheManager } from "../src/services/cacheManager";
import { THEME, pw, ph, ps } from "../src/theme/tokens";
import { isTV } from "../src/utils/tvUtils";
import { CinematicBackground, updateCinematicBackground } from "../src/components/CinematicBackground";
import CategorySidebar from "../src/components/CategorySidebar";
import { Focusable, FocusGroup, FocusMemory, STB_PRIORITY, useInitialFocusPulse, useStbKeys } from "../src/tv";
import { useNetworkActivity } from "../src/services/networkActivity";
import { AppBootManager } from "../src/services/AppBootManager";
import { filterByCategory, useAdoptStoreContent } from "../src/hooks/useCategoryContent";
import { epgService, NowNext } from "../src/services/epgService";
import { parentalControl } from "../src/services/parentalControl";
import { hiddenCategories } from "../src/services/hiddenCategories";
import { stbEnvironment } from "../src/services/stbEnvironment";
import { buildChannelNumbers, liveChannelSession, withChannelNumbers } from "../src/services/liveChannelSession";
import { useChannelTuner } from "../src/hooks/useChannelTuner";
import { useNowNext } from "../src/hooks/useNowNext";
import ChannelInfoBar from "../src/components/ChannelInfoBar";
import { ChannelTunerReadout } from "../src/components/ChannelTunerOverlay";
import PinPrompt from "../src/components/PinPrompt";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

/** Namespace for this screen's focus memory. */
const SCREEN_KEY = "live-tv";

// ─────────────────────────────────────────────
// Channel Card — single Focusable, no per-item TVEventHandler
// ─────────────────────────────────────────────
const ChannelCard = React.memo(function ChannelCard({
  item,
  index,
  onPress,
  onLongPress,
  onFocus,
  isFocusedItem,
  itemWidth,
  channelNumber,
  locked,
  epgVersion,
}: {
  item: Channel;
  index?: number;
  onPress: (item: Channel) => void;
  onLongPress?: (item: Channel) => void;
  onFocus?: (item: Channel, index?: number) => void;
  isFocusedItem?: boolean;
  itemWidth: number;
  channelNumber?: number;
  locked?: boolean;
  /**
   * Bumped by the screen whenever the guide index changes. The card reads
   * now/next synchronously below rather than subscribing: a hundred tiles each
   * holding their own EPG subscription is a hundred listeners firing on every
   * guide update, for data one shared read already has.
   */
  epgVersion: number;
}) {
  const handlePress = useCallback(() => {
    onPress(item);
  }, [onPress, item]);

  const handleFocus = useCallback(() => {
    onFocus?.(item, index);
  }, [onFocus, item, index]);

  const handleLongPress = useCallback(() => {
    onLongPress?.(item);
  }, [onLongPress, item]);

  const nowNext: NowNext = useMemo(
    () => epgService.nowNext(item),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item.id, epgVersion]
  );



  return (
    <View style={{ width: itemWidth, padding: pw(0.6) }}>
      <Focusable
        onPress={handlePress}
        onLongPress={handleLongPress}
        onFocus={handleFocus}
        hasTVPreferredFocus={isFocusedItem}
        ringOnFocus={false}
        style={S.cardWrapper}
        screenKey={SCREEN_KEY}
        focusKey={String(item.id)}
        accessibilityLabel={item.category ? `${item.name}, ${item.category}` : item.name}
      >
        {(focused) => (
          <View
            style={[
              S.cardBorder,
              { height: Math.floor(itemWidth / 0.85) },
              focused && S.cardBorderFocused,
              focused && { transform: [{ scale: 1.06 }], backgroundColor: "#fff", borderColor: "#fff", borderWidth: 1 }
            ]}
          >
            <LinearGradient
              colors={
                focused
                  ? ["transparent", "transparent"] // Background is handled by wrapper when focused
                  : ["rgba(255,255,255,0.05)", "rgba(255,255,255,0.01)"]
              }
              style={[
                S.card,
                focused && { backgroundColor: "transparent" },
                { overflow: "hidden" }
              ]}
            >
              {/* Channel number — what the numeric tuner dials. */}
              {channelNumber ? (
                <View style={[S.cardNumber, focused && S.cardNumberFocused]}>
                  <Text style={[S.cardNumberText, focused && { color: "#000" }]}>{channelNumber}</Text>
                </View>
              ) : null}

              {locked ? (
                <View style={S.cardLock}>
                  <Ionicons name="lock-closed" size={ps(0.85)} color={focused ? "#000" : "#fff"} />
                </View>
              ) : null}

              <View style={S.cardLogoWrapper}>
                {item.logo ? (
                  <Image source={{ uri: item.logo }} style={S.cardLogo} contentFit="contain" cachePolicy="memory-disk" />
                ) : (
                  <Ionicons name="tv-outline" size={ps(2)} color="rgba(255,255,255,0.15)" />
                )}
              </View>
              <View style={S.cardInfo}>
                <Text style={[S.cardTitle, focused && { color: "#000" }]} numberOfLines={1}>{item.name}</Text>

                {/* What is on now, with how far through it is. The category is
                    only worth the line when there is no guide to show. */}
                {nowNext.now ? (
                  <>
                    <Text
                      style={[S.cardNow, focused && { color: "rgba(0,0,0,0.75)" }]}
                      numberOfLines={1}
                    >
                      {nowNext.now.title}
                    </Text>
                    <View style={[S.cardProgressTrack, focused && { backgroundColor: "rgba(0,0,0,0.15)" }]}>
                      <View
                        style={[
                          S.cardProgressFill,
                          focused && { backgroundColor: "#000" },
                          { width: `${Math.round(nowNext.progress * 100)}%` },
                        ]}
                      />
                    </View>
                  </>
                ) : item.category ? (
                  <Text style={[S.cardCategory, focused && { color: "rgba(0,0,0,0.6)" }]} numberOfLines={1}>{item.category}</Text>
                ) : null}
              </View>
            </LinearGradient>
          </View>
        )}
      </Focusable>
    </View>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.isFocusedItem === nextProps.isFocusedItem &&
    prevProps.itemWidth === nextProps.itemWidth &&
    prevProps.channelNumber === nextProps.channelNumber &&
    prevProps.locked === nextProps.locked &&
    prevProps.epgVersion === nextProps.epgVersion
  );
});

// ─────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────
export default function LiveTVScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const safeGoBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/dashboard");
  }, [router]);

  // Per-field selectors. Destructuring the whole store re-rendered this entire
  // screen — grid included — on every unrelated store write, and a background
  // refresh performs several in a row. That is the navigation stutter.
  const storeChannels = usePortalStore((s) => s.channels);
  const storeCategories = usePortalStore((s) => s.categories);
  const activePortal = usePortalStore((s) => s.activePortal);
  const setChannels = usePortalStore((s) => s.setChannels);
  const setCategories = usePortalStore((s) => s.setCategories);

  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [displayChannels, setDisplayChannels] = useState<Channel[]>([]);
  // Read inside async loaders so appending a page never depends on a stale
  // closure — and so pagination doesn't have to round-trip through the store.
  const displayChannelsRef = useRef<Channel[]>([]);
  displayChannelsRef.current = displayChannels;
  const selectedCategoryRef = useRef(selectedCategory);
  selectedCategoryRef.current = selectedCategory;

  const [isLoading, setIsLoading] = useState(storeChannels.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  // True while *any* portal request is in flight, including ones this screen did
  // not start — the boot sync, the periodic refresh, the empty-body retry. An
  // empty grid should read as "loading" whenever something is still fetching.
  const syncing = useNetworkActivity();
  // An empty response is a load failure, not "this portal has no channels".
  // Conflating them showed "No Channels Found" for what was actually a stale
  // session token, and the user had no way to tell the difference.
  const [loadFailed, setLoadFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // While appending more rows, FlatList briefly detaches the focused cell
  // during reconciliation. The native focus engine then falls back to the
  // nearest focusable ancestor — i.e. the sidebar, which sits to the left in
  // the row layout. We trap leftward focus for ~600ms so focus stays inside
  // the grid until the new cells settle.
  const [trappingFocus, setTrappingFocus] = useState(false);
  const trapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<TextInput>(null);
  // Track last focused channel id so we can restore focus after refresh
  const focusedIdRef = useRef<string>("");
  const flatListRef = useRef<FlatList>(null);

  // ── Set-top-box layer ─────────────────────────────────────────────────────
  // Bumped whenever the guide index changes, so tiles re-read now/next without
  // each holding a subscription of its own. See ChannelCard.
  const [epgVersion, setEpgVersion] = useState(0);
  // The channel the info bar is describing — whatever the cursor is on.
  const [focusedChannel, setFocusedChannel] = useState<Channel | null>(null);
  // Set by the numeric tuner so the matched tile claims focus on next render.
  const [tunedFocusId, setTunedFocusId] = useState<string | null>(null);
  // Channel waiting behind the parental PIN; playback resumes once it is right.
  const [pinTarget, setPinTarget] = useState<Channel | null>(null);
  // Distinct from pinTarget: that one plays a channel after the PIN, this one
  // changes its lock state. Conflating them would have a mistyped long-press
  // start playback.
  const [lockTarget, setLockTarget] = useState<Channel | null>(null);
  const [parentalVersion, setParentalVersion] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  /** Bumped when the hidden-category set changes, to rebuild the sidebar. */
  const [hiddenVersion, setHiddenVersion] = useState(0);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Reached through a ref because the numeric tuner is built above the press
   * handler but has to call it. Assigned where that handler is defined.
   */
  const handleChannelPressRef = useRef<(channel: Channel) => void>(() => { });
  // Rebuilt on every render, read from callbacks that must stay stable.
  const numberedListRef = useRef<(list: Channel[]) => Channel[]>((l) => l);

  const trapFocusBriefly = useCallback(() => {
    setTrappingFocus(true);
    if (trapTimeoutRef.current) clearTimeout(trapTimeoutRef.current);
    trapTimeoutRef.current = setTimeout(() => setTrappingFocus(false), 800);
  }, []);

  useEffect(() => () => {
    if (trapTimeoutRef.current) clearTimeout(trapTimeoutRef.current);
  }, []);



  // The guide, the lock and the box settings are all read synchronously later
  // on, so they are warmed once here rather than awaited at each use site.
  useEffect(() => {
    const unsubscribeEpg = epgService.subscribe(() => setEpgVersion((v) => v + 1));
    const unsubscribeLock = parentalControl.subscribe(() => setParentalVersion((v) => v + 1));
    parentalControl.load().then(() => setParentalVersion((v) => v + 1));
    hiddenCategories.load().then(() => setHiddenVersion((v) => v + 1));
    const unsubscribeHidden = hiddenCategories.subscribe(() =>
      setHiddenVersion((v) => v + 1)
    );
    stbEnvironment.load();
    return () => {
      unsubscribeEpg();
      unsubscribeLock();
      unsubscribeHidden();
    };
  }, []);

  // Pull whatever guide the portal serves in one go. Single-flighted and
  // rate-limited inside the service, so re-entering the screen costs nothing.
  useEffect(() => {
    if (!activePortal) return;
    // A zap list belongs to the portal it came from. Carrying one across a
    // portal switch would have the player tuning to channels that no longer
    // exist, so it is dropped before the new guide is fetched.
    liveChannelSession.clear();
    epgService
      .loadBulk(activePortal, { allowLargeXmltv: stbEnvironment.snapshot.fullXmltvGuide })
      .catch(() => { });
  }, [activePortal?.id]);

  const localCategories = useMemo(
    () => (storeCategories || []).filter(c => c.type === "live"),
    [storeCategories]
  );

  const numColumns = isTV ? 5 : (SCREEN_WIDTH >= 1024 ? 5 : (SCREEN_WIDTH >= 768 ? 4 : 3));
  const PAGE_SIZE = numColumns * Math.ceil(28 / numColumns);

  const xtreamApiRef = useRef<XtreamApi | null>(null);
  // Raw, unfiltered cache (Xtream / M3U).
  const allChannelsCacheRef = useRef<Channel[]>([]);
  // The current category's full filtered list — store/FlatList only see the
  // first N pages of this.
  const fullListRef = useRef<Channel[]>([]);
  const prevCategoryIdRef = useRef<string | undefined>(undefined);

  const loadCategories = useCallback(async (force = false) => {
    const portal = usePortalStore.getState().activePortal;
    if (!portal) return;
    try {
      if (force) {
        await cacheManager.removeByPrefix(`portal:${portal.id}:live:categories`);
        await cacheManager.removeByPrefix(`portal:${portal.id}:categories`);
      }
      let cats: Category[] = [];
      if (portal.type === "m3u") {
        const api = new M3UApi({ url: portal.config.url, portalId: portal.id });
        cats = ((await api.getLiveCategories()) || []) as Category[];
      } else if (portal.type === "xtream") {
        const raw = (await xtreamApiRef.current!.getitvCategories()) || [];
        cats = raw.map((c: any) => ({ id: c.id, name: c.name, type: "live" as const }));
      } else {
        cats = (await portalApi.getLiveCategories(portal)) || [];
      }

      // Fallback: If API returned empty categories, try deriving categories from cached/store Channel items
      if (cats.length === 0 && allChannelsCacheRef.current.length > 0) {
        const seen = new Set<string>();
        cats = [];
        for (const item of allChannelsCacheRef.current) {
          const cId = item.categoryId || item.category;
          const cName = item.category || item.categoryId;
          if (cId && !seen.has(cId) && cId !== "all" && cId !== "*") {
            seen.add(cId);
            cats.push({
              id: cId,
              name: cName || cId,
              type: "live" as const,
            });
          }
        }
      }

      // Read live state at call-time to avoid stale closure wiping non-live categories
      const currentCategories = usePortalStore.getState().categories || [];
      const others = currentCategories.filter(c => c.type !== "live");
      if (cats.length > 0) {
        setCategories([...others, ...cats]);
      }
    } catch (e) {
      console.warn("loadCategories error:", e);
    }
  }, [setCategories]);

  // ── Fetch the complete channel list (Xtream / M3U) ──
  // Both portal types serve everything in one request, so the whole list is
  // fetched once and every category view is a slice of it.
  const fetchAllChannels = useCallback(async (): Promise<Channel[]> => {
    if (!activePortal) return [];
    let all: Channel[] = [];

    if (activePortal.type === "m3u") {
      const api = new M3UApi({ url: activePortal.config.url, portalId: activePortal.id });
      const raw = (await api.getLiveChannels(undefined, 1, 100000)) || [];
      if (Array.isArray(raw)) {
        all = raw.map((c: any) => ({
          id: String(c.id),
          name: c.name,
          logo: c.logo,
          category: c.category,
          categoryId: c.categoryId ?? c.category,
          streamUrl: c.streamUrl,
        }));
      }
    } else if (activePortal.type === "xtream") {
      all = (await xtreamApiRef.current!.getitvChannels(undefined, 1, 100000)) || [];
    }

    // The store holds the complete channel list, never a page of it — search and
    // EPG read it, and it is what gets persisted for the next cold start.
    if (all.length > 0) setChannels(all, activePortal.id);
    return all;
  }, [activePortal, setChannels]);

  /** Refresh the full list without blocking what is already on screen. */
  const fetchAllChannelsInBackground = useCallback(() => {
    InteractionManager.runAfterInteractions(() => {
      fetchAllChannels()
        .then((all) => {
          if (all.length > 0) allChannelsCacheRef.current = all;
        })
        .catch((e) => console.warn("Background channel refresh failed:", e));
    });
  }, [fetchAllChannels]);

  // Marks the screen as failed-to-load and asks the portal to resync once.
  //
  // The resync path performs a fresh handshake and retries endpoints that answer
  // 200-with-an-empty-body, so it recovers from the stale-token case that a plain
  // fetch silently reads as "this portal has nothing". When it lands, the
  // adoption hook below picks the content up without the user navigating away.
  const resyncRequestedRef = useRef(false);
  const reportLoadFailure = useCallback(() => {
    setLoadFailed(true);
    setHasMore(false);
    if (resyncRequestedRef.current || !activePortal) return;
    resyncRequestedRef.current = true;
    AppBootManager.triggerBackgroundSync(activePortal, true).catch(() => { });
  }, [activePortal]);

  const applyAdopted = useCallback((slice: Channel[], filteredTotal: number) => {
    setDisplayChannels(slice);
    setHasMore(filteredTotal > slice.length);
    setLoadFailed(false);
    setIsLoading(false);
    setPage(1);
  }, []);

  // Pick up channels that reach the store after this screen mounted.
  useAdoptStoreContent<Channel>({
    storeItems: storeChannels,
    cacheRef: allChannelsCacheRef,
    fullListRef,
    displayRef: displayChannelsRef,
    categoryRef: selectedCategoryRef,
    categories: storeCategories,
    pageSize: PAGE_SIZE,
    slicesFullList: activePortal?.type === "xtream" || activePortal?.type === "m3u",
    onAdopt: applyAdopted,
  });

  // ── Load Channels (mirrors VOD/Series pattern) ──
  const loadChannels = useCallback(async (
    categoryId?: string,
    pageNum: number = 1,
    reset: boolean = false
  ) => {
    if (!activePortal) return;
    if (loadingMore && !reset) return;
    if (!hasMore && !reset) return;

    try {
      reset ? setIsLoading(true) : setLoadingMore(true);
      let list: Channel[] = [];
      const cat = !categoryId || categoryId === "all" || categoryId === "*" ? undefined : categoryId;

      if (activePortal.type === "m3u" || activePortal.type === "xtream") {
        if (allChannelsCacheRef.current.length === 0) {
          if (storeChannels.length > 0) {
            // Cache hit: render from it and let the refresh happen in the
            // background. This branch used to await the network even with a full
            // store, so opening Live TV always paid for a 100k-item download
            // before drawing a single tile.
            allChannelsCacheRef.current = storeChannels;
            fetchAllChannelsInBackground();
          } else {
            const fetched = await fetchAllChannels();
            if (fetched.length > 0) {
              allChannelsCacheRef.current = fetched;
            } else {
              // Empty response and nothing cached. Report it as a failure and
              // let the portal sync retry with a fresh session — it detects the
              // empty-body case that a bare fetch reads as "no content".
              reportLoadFailure();
              return;
            }
          }
        }
        const filtered = filterByCategory(
          allChannelsCacheRef.current,
          cat,
          usePortalStore.getState().categories
        );
        fullListRef.current = filtered;
        list = filtered.slice(0, pageNum * PAGE_SIZE);
        setHasMore(filtered.length > list.length);
      } else {
        const fresh = (await portalApi.getLiveChannels(activePortal, cat, pageNum)) || [];
        const current = reset ? [] : displayChannelsRef.current;
        if (reset) {
          // A failed/empty refresh should never blank a screen that already has data.
          list = fresh.length > 0 || displayChannelsRef.current.length === 0
            ? fresh
            : displayChannelsRef.current;
        } else {
          list = [...current, ...fresh.filter(i => !current.find(c => c.id === i.id))];
        }
        if (reset && fresh.length === 0 && list.length === 0) {
          reportLoadFailure();
          return;
        }
        fullListRef.current = list;
        setHasMore(fresh.length > 0);
      }

      list = Array.isArray(list) ? list : [];
      setLoadFailed(false);
      setDisplayChannels(list);
      setPage(pageNum);
      // Restore scroll position after a reset-load so focus doesn't snap to top
      if (reset) restoreFocusPosition(list);
    } catch (err) {
      console.warn("Live TV Data Fetch Error:", err);
    } finally {
      setIsLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
    }
  }, [activePortal, loadingMore, hasMore, fetchAllChannels, fetchAllChannelsInBackground, reportLoadFailure]);

  // Initial load
  useEffect(() => {
    if (!activePortal) { router.replace("/"); return; }
    if (activePortal.type === "xtream") {
      xtreamApiRef.current = new XtreamApi({
        url: activePortal.config.url,
        username: activePortal.config.username!,
        password: activePortal.config.password!,
      });
    }
    loadCategories();
  }, [activePortal?.id]);

  // Category change — Xtream/M3U slice the cached full list; MAG hits the API.
  useEffect(() => {
    if (!activePortal || prevCategoryIdRef.current === selectedCategory) return;
    setIsLoading(true);
    setPage(1);
    prevCategoryIdRef.current = selectedCategory;
    focusedIdRef.current = "";
    // A remembered tile from the previous category is not in the new list.
    FocusMemory.forget(SCREEN_KEY);
    // Focus stays in the sidebar on a category switch, so nothing else scrolls
    // the grid back up — do it here, or the new category renders half-scrolled
    // at wherever the previous one was left.
    flatListRef.current?.scrollToOffset({ offset: 0, animated: false });

    const timer = setTimeout(() => {
      if (activePortal.type === "xtream" || activePortal.type === "m3u") {
        if (allChannelsCacheRef.current.length > 0) {
          const filtered = filterByCategory(
            allChannelsCacheRef.current,
            selectedCategory,
            storeCategories
          );
          fullListRef.current = filtered;
          const sliced = filtered.slice(0, PAGE_SIZE);
          setDisplayChannels(sliced);
          setHasMore(filtered.length > sliced.length);
          setIsLoading(false);
        } else {
          setHasMore(true);
          loadChannels(selectedCategory, 1, true);
        }
      } else {
        setHasMore(true);
        loadChannels(selectedCategory, 1, true);
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [selectedCategory]);

  /**
   * Opens a channel.
   *
   * Two things happen before navigating that did not before: the parental lock
   * gets a chance to interpose, and the ordered channel list is handed to
   * liveChannelSession so the player can zap without coming back here.
   */
  const openChannel = useCallback(async (channel: Channel) => {
    if (!activePortal || !channel.streamUrl) return;

    // The list the viewer is actually looking at becomes the zap order, so
    // CH+/CH- in the player walks the same category they were browsing.
    const categoryId = selectedCategoryRef.current;
    const categoryName =
      categoryId && categoryId !== "all"
        ? (usePortalStore.getState().categories || []).find((c) => c.id === categoryId)?.name ?? "Live TV"
        : "All Channels";

    const source = fullListRef.current.length ? fullListRef.current : displayChannelsRef.current;
    let zapList = numberedListRef.current(source);
    let index = zapList.findIndex((c) => String(c.id) === String(channel.id));

    // Prepare full numbered portal list so player knows all channels
    const pool = allChannelsCacheRef.current.length > 0
      ? allChannelsCacheRef.current
      : (storeChannels.length > 0 ? storeChannels : displayChannelsRef.current);
    const allNumbered = numberedListRef.current(pool);

    let activeCatName = categoryName;
    if (index < 0) {
      // Channel is outside current category view (e.g. tuned via numpad)!
      zapList = allNumbered;
      index = Math.max(0, zapList.findIndex((c) => String(c.id) === String(channel.id)));
      if (channel.categoryId) {
        const foundCat = (usePortalStore.getState().categories || []).find((c) => c.id === channel.categoryId);
        if (foundCat) activeCatName = foundCat.name;
      }
    }

    liveChannelSession.start(zapList, index, activeCatName, activePortal.id, allNumbered);
    liveChannelSession.rememberLastChannel(zapList[index] ?? channel, activePortal.id).catch(() => { });

    try {
      let url = channel.streamUrl;
      if (activePortal.type === "mag") {
        const result = await StreamManager.getStreamUrl(channel, activePortal, "itv");
        if (result.success && result.url) url = result.url;
      }
      router.push({ pathname: "/player", params: { url, title: channel.name, type: "live", contentId: channel.id, cmd: channel.streamUrl, logo: channel.logo || "" } });
    } catch {
      router.push({ pathname: "/player", params: { url: channel.streamUrl || "", title: channel.name, type: "live", logo: channel.logo || "" } });
    }
  }, [activePortal, router]);

  const handleChannelPress = useCallback((channel: Channel) => {
    // A locked channel never reaches the player until the PIN is entered; the
    // prompt calls back into openChannel on success.
    if (parentalControl.isChannelLocked(channel)) {
      setPinTarget(channel);
      return;
    }
    openChannel(channel);
  }, [openChannel]);

  handleChannelPressRef.current = handleChannelPress;

  const flashNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 2600);
  }, []);

  useEffect(() => () => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
  }, []);

  const applyLockToggle = useCallback(async (channel: Channel) => {
    const nowLocked = await parentalControl.toggleChannel(String(channel.id));
    setParentalVersion((v) => v + 1);
    flashNotice(nowLocked ? `Locked ${channel.name}` : `Unlocked ${channel.name}`);
  }, [flashNotice]);

  /**
   * Long-press locks or unlocks a channel.
   *
   * It sits on the tile rather than in a settings list because that is where
   * the decision is made — you notice a channel should be locked while looking
   * at it, not while scrolling a separate menu of ten thousand names.
   */
  const handleChannelLongPress = useCallback((channel: Channel) => {
    if (parentalControl.requiresPin("settings")) {
      // Changing what is locked is itself a parental action, so it is behind
      // the same PIN as the settings screen when that scope is on.
      setLockTarget(channel);
      return;
    }
    if (!parentalControl.isEnabled) {
      flashNotice("Turn on Parental Control in Settings to use channel locks");
      return;
    }
    applyLockToggle(channel);
  }, [applyLockToggle, flashNotice]);

  const totalCountRef = useRef(0);
  const onEndReachedRef = useRef<() => void>(() => { });

  const handleChannelFocus = useCallback((channel: Channel, index?: number) => {
    updateCinematicBackground(channel.logo || null);
    focusedIdRef.current = String(channel.id);
    setFocusedChannel(channel);
    // The pulse has done its job once the tile it named actually has focus.
    setTunedFocusId((prev) => (prev === String(channel.id) ? null : prev));

    // Warm the guide around the cursor rather than for the whole list: on
    // Xtream each channel is its own request, and prefetching ten thousand of
    // them would be a denial-of-service against the provider.
    //
    // Read live rather than captured — this callback deliberately keeps empty
    // deps so the grid is not rebuilt on every focus change, and a captured
    // portal would still be null from the first render.
    const portal = usePortalStore.getState().activePortal;
    if (portal && index !== undefined) {
      const source = fullListRef.current.length ? fullListRef.current : displayChannelsRef.current;
      epgService.prefetch(portal, source.slice(Math.max(0, index - 4), index + 12));
    }

    // Growing the list synchronously inside a focus handler makes React commit
    // new cells while the native focus engine is still resolving the key press,
    // and focus lands somewhere unrelated. Let the focus event finish first.
    if (index !== undefined && totalCountRef.current > 0 && index >= totalCountRef.current - 12) {
      InteractionManager.runAfterInteractions(() => onEndReachedRef.current());
    }
  }, []);

  // After a refresh/reset, scroll the list back to the previously focused item
  const restoreFocusPosition = useCallback((list: Channel[]) => {
    if (!focusedIdRef.current || !flatListRef.current) return;
    const idx = list.findIndex(c => String(c.id) === focusedIdRef.current);
    if (idx > 0) {
      setTimeout(() => {
        try {
          flatListRef.current?.scrollToIndex({ index: idx, animated: false, viewPosition: 0.3 });
        } catch { /* ignore if out of range */ }
      }, 120);
    }
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(1);
    setHasMore(true);
    // An explicit refresh re-arms the one-shot resync so a repeat failure can
    // ask the portal for a fresh session again.
    resyncRequestedRef.current = false;
    // M3U caches the full list the same way Xtream does, so pull-to-refresh has
    // to drop it too or the refresh returns the same stale list.
    if (activePortal?.type === "xtream" || activePortal?.type === "m3u") {
      allChannelsCacheRef.current = [];
      fullListRef.current = [];
    }
    await loadCategories(true);
    await loadChannels(selectedCategory, 1, true);
    setRefreshing(false);
  }, [selectedCategory, activePortal, loadChannels, loadCategories]);

  const onEndReached = useCallback(() => {
    if (isLoading || loadingMore || !hasMore) return;

    // Hold focus inside the grid while the new cells reconcile so the focus
    // engine doesn't fall back to the sidebar.
    trapFocusBriefly();

    if (activePortal?.type === "xtream" || activePortal?.type === "m3u") {
      // Grow the slice from the cached full list — no network, and no store
      // write: pushing each page into the store re-rendered every subscriber
      // mid-scroll for data only this list uses.
      const nextPage = page + 1;
      const sliced = fullListRef.current.slice(0, nextPage * PAGE_SIZE);
      setDisplayChannels(sliced);
      setPage(nextPage);
      setHasMore(fullListRef.current.length > sliced.length);
      return;
    }

    // MAG: fetch the next server page.
    loadChannels(selectedCategory, page + 1, false);
  }, [isLoading, loadingMore, hasMore, selectedCategory, page, loadChannels, activePortal, trapFocusBriefly]);

  useEffect(() => {
    onEndReachedRef.current = onEndReached;
  }, [onEndReached]);

  // ── Numeric tuner ─────────────────────────────────────────────────────────
  // Numbers span the whole portal, not the visible slice, so dialling 102 finds
  // channel 102 whichever category happens to be on screen.
  const allChannelsPool = useMemo(() => {
    if (allChannelsCacheRef.current && allChannelsCacheRef.current.length > 0) {
      return allChannelsCacheRef.current;
    }
    if (storeChannels && storeChannels.length > 0) {
      return storeChannels;
    }
    return displayChannels;
  }, [storeChannels, displayChannels]);

  const channelNumbers = useMemo(
    () => buildChannelNumbers(allChannelsPool),
    [allChannelsPool]
  );

  numberedListRef.current = useCallback(
    (list: Channel[]) => withChannelNumbers(list, channelNumbers),
    [channelNumbers]
  );

  const numberToChannel = useMemo(() => {
    const map = new Map<number, Channel>();
    for (const c of allChannelsPool) {
      const num = c.num && c.num > 0 ? c.num : channelNumbers.get(String(c.id));
      if (num && !map.has(num)) map.set(num, c);
    }
    return map;
  }, [allChannelsPool, channelNumbers]);

  const tunerMaxDigits = useMemo(() => {
    let widest = 1;
    numberToChannel.forEach((_c, num) => {
      widest = Math.max(widest, String(num).length);
    });
    return Math.min(5, widest);
  }, [numberToChannel]);

  const hasNumberPrefix = useCallback(
    (prefix: number) => {
      const asText = String(prefix);
      for (const num of numberToChannel.keys()) {
        if (String(num).startsWith(asText)) return true;
      }
      return false;
    },
    [numberToChannel]
  );

  /**
   * A dialled number tunes and plays, the way a set-top box does.
   *
   * The tuner does not commit on the first digit — it waits out the multi-digit
   * window and only fires when no longer number could match (see
   * useChannelTuner) — so by the time this runs the viewer has finished
   * dialling and a channel is what they asked for. The grid highlight is moved
   * too, so backing out of the player lands on the channel just watched rather
   * than wherever the cursor was before.
   *
   * The parental gate is deliberately not bypassed here: a locked channel
   * reached by number is as locked as one reached by pressing OK on its tile.
   */
  const handleTune = useCallback((num: number) => {
    const target = numberToChannel.get(num);
    if (!target) {
      flashNotice(`Channel ${num} not found`);
      return;
    }

    setFocusedChannel(target);
    setTunedFocusId(String(target.id));

    // Scroll the grid to it before leaving, so it is under the cursor on the
    // way back. Best-effort: a row that is not measured yet simply is not
    // scrolled to, and the focus pulse still lands when the list catches up.
    const idx = displayChannelsRef.current.findIndex((c) => String(c.id) === String(target.id));
    if (idx >= 0 && flatListRef.current) {
      try {
        flatListRef.current.scrollToIndex({
          index: Math.floor(idx / numColumns),
          animated: true,
          viewPosition: 0.3,
        });
      } catch { /* row not measured yet */ }
    }

    handleChannelPressRef.current(target);
  }, [numberToChannel, numColumns, flashNotice]);

  const tuner = useChannelTuner({
    onCommit: handleTune,
    hasPrefix: hasNumberPrefix,
    maxDigits: tunerMaxDigits,
    enabled: !pinTarget,
  });

  // The number pad and GUIDE key, straight off the remote — the only way to
  // dial a channel from this screen, by design.
  useStbKeys(
    {
      onDigit: tuner.pushDigit,
      onGuide: () => router.push("/epg"),
    },
    { enabled: !pinTarget, priority: STB_PRIORITY.SCREEN }
  );

  const tunerName = tuner.entry ? numberToChannel.get(Number(tuner.entry))?.name ?? null : null;

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);


  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // ── Filter ──
  // When searching on Xtream/M3U: search across fullListRef (uncapped).
  // Otherwise: show displayChannels (local category-filtered state).
  const filteredChannels = useMemo(() => {
    const isXtreamOrM3U = activePortal?.type === "xtream" || activePortal?.type === "m3u";

    if (debouncedQuery) {
      if (isXtreamOrM3U) {
        return allChannelsCacheRef.current
          .filter(c => c.name.toLowerCase().includes(debouncedQuery.toLowerCase()))
          .slice(0, 100);
      }
    }

    return displayChannels;
  }, [displayChannels, debouncedQuery, activePortal?.type]);

  const chunkedChannels = useMemo(() => {
    const chunks = [];
    for (let i = 0; i < filteredChannels.length; i += numColumns) {
      chunks.push({
        id: `row-${i}`,
        items: filteredChannels.slice(i, i + numColumns),
      });
    }
    return chunks;
  }, [filteredChannels, numColumns]);

  useEffect(() => {
    totalCountRef.current = filteredChannels.length;
  }, [filteredChannels.length]);

  // Build sidebar categories with "All" at top.
  // Memoised: a fresh array on every render made CategorySidebar's FlatList
  // treat the data as changed each time, re-running its scroll effect.
  const sidebarCategories: Category[] = useMemo(
    () => [
      { id: "all", name: "All Channels", type: "live" as const },
      // Categories the viewer hid in Settings are dropped from the sidebar but
      // not from the library — "All Channels" still shows everything, which is
      // what keeps hiding a tidying tool rather than a filter.
      ...hiddenCategories.filter(
        "live",
        localCategories.filter(c =>
          c.type === "live" &&
          c.name.toLowerCase() !== "all" &&
          c.name.toLowerCase() !== "all channels"
        )
      ),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [localCategories, hiddenVersion]
  );

  // The sidebar owns focus on this screen: it takes the initial focus on entry
  // and keeps it when the category changes. No grid tile claims
  // `hasTVPreferredFocus`, so the user moves right into the grid deliberately.
  const focusSidebar = useInitialFocusPulse(sidebarCategories.length > 0);

  const SIDEBAR_WIDTH = isTV ? 260 : 220;
  const GRID_H_PADDING = pw(1.5) * 2;
  const SAFETY_MARGIN = 4;
  const itemWidth = Math.floor(
    (SCREEN_WIDTH - SIDEBAR_WIDTH - GRID_H_PADDING - SAFETY_MARGIN) / numColumns
  );
  const ROW_HEIGHT = Math.floor(itemWidth / 0.85) + pw(1.2);
  // FlatList already accounts for contentContainerStyle padding, so the extra
  // pw(1.5) here offset every row by one pad — scrollToIndex landed short and
  // the restored item sat half off-screen.
  const getItemLayout = useCallback((_: any, index: number) => ({
    length: ROW_HEIGHT,
    offset: index * ROW_HEIGHT,
    index,
  }), [ROW_HEIGHT]);

  // Only relevant while the grid has nothing to show; a background refresh must
  // never replace content that is already on screen with a spinner.
  const busy = isLoading || (syncing && filteredChannels.length === 0);

  const renderRow = useCallback(
    ({ item: row, index: rowIndex }: { item: { id: string; items: Channel[] }; index: number }) => (
      <FocusGroup style={S.gridRow}>
        {row.items.map((channel, colIndex) => {
          const itemIndex = rowIndex * numColumns + colIndex;
          const id = String(channel.id);
          return (
            <ChannelCard
              key={channel.id}
              item={channel}
              index={itemIndex}
              itemWidth={itemWidth}
              channelNumber={channel.num && channel.num > 0 ? channel.num : channelNumbers.get(id)}
              locked={parentalControl.isChannelRestricted(channel)}
              epgVersion={epgVersion}
              isFocusedItem={tunedFocusId === id}
              onPress={handleChannelPress}
              onLongPress={handleChannelLongPress}
              onFocus={handleChannelFocus}
            />
          );
        })}
      </FocusGroup>
    ),
    // parentalVersion is read through parentalControl rather than passed, so it
    // has to be a dependency or toggling a lock leaves stale padlocks on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itemWidth, numColumns, handleChannelPress, handleChannelLongPress, handleChannelFocus, channelNumbers, epgVersion, tunedFocusId, parentalVersion]
  );

  // The info bar tracks the cursor. Passing the portal opts this one channel
  // into an on-demand guide fetch — the tiles deliberately do not.
  const focusedNowNext = useNowNext(focusedChannel, activePortal);
  const focusedNumber = focusedChannel
    ? (focusedChannel.num && focusedChannel.num > 0
      ? focusedChannel.num
      : channelNumbers.get(String(focusedChannel.id)))
    : undefined;
  const infoBarChannel = useMemo(
    () => (focusedChannel ? { ...focusedChannel, num: focusedNumber } : null),
    [focusedChannel, focusedNumber]
  );

  return (
    <View style={[S.container, { paddingTop: insets.top }]}>
      <CinematicBackground />
      <StatusBar hidden />

      {/* ─── Header ─── */}
      <View style={S.header}>
        <Text style={S.headerTitle}>Live TV</Text>

        <FocusGroup style={S.searchWrapper}>
          <Focusable
            onPress={() => searchInputRef.current?.focus()}
            ringOnFocus={false}
            style={{ flex: 1 }}
          >
            {(focused) => (
              <View style={[S.searchGradient, (focused || searchFocused) && S.searchFocused]}>
                <LinearGradient
                  colors={["rgba(255,255,255,0.12)", "rgba(255,255,255,0.06)"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[StyleSheet.absoluteFill, { borderRadius: 25 }]}
                />
                {(focused || searchFocused) && (
                  <LinearGradient
                    colors={[THEME.colors.primary, THEME.colors.secondary]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[StyleSheet.absoluteFill, { borderRadius: 25 }]}
                  />
                )}
                <View style={[
                  S.searchInner,
                  { borderRadius: (focused || searchFocused) ? 25 - 1.5 : 25 },
                  (focused || searchFocused) && { backgroundColor: "#0b0b10" }
                ]}>
                  <Ionicons name="search" size={ps(1.1)} color={(focused || searchFocused) ? "#fff" : "rgba(255,255,255,0.3)"} style={{ marginRight: pw(1) }} />
                  <TextInput
                    ref={searchInputRef}
                    style={S.searchInput}
                    placeholder="Search channels..."
                    placeholderTextColor="rgba(255,255,255,0.2)"
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    autoCapitalize="none"
                    autoCorrect={false}
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => setSearchFocused(false)}
                  />
                </View>
              </View>
            )}
          </Focusable>
        </FocusGroup>

        {/* No on-screen number pad and no guide button.
            react-native-tvos forwards KEYCODE_0..9 and KEYCODE_GUIDE to JS
            itself (see the note at the top of src/tv/stbKeys.ts), so the remote
            is the number pad — dialling a channel needs no UI beyond the
            readout that shows the digits landing. The guide is a destination
            rather than a control on this grid, and lives on the dashboard next
            to Search. */}
        <View style={S.countBadge}>
          <Text style={S.countText}>
            {busy ? "..." : String(filteredChannels.length)}
          </Text>
        </View>
      </View>

      {/* ─── Body: Sidebar + Grid ─── */}
      <View style={S.body}>
        {/* Left sidebar */}
        <FocusGroup style={{ width: SIDEBAR_WIDTH }}>
          <CategorySidebar
            categories={sidebarCategories}
            selectedId={selectedCategory || "all"}
            onSelect={setSelectedCategory}
            width={SIDEBAR_WIDTH}
            autoFocusFirst={focusSidebar}
          />
        </FocusGroup>

        {/* Right channel grid */}
        <FocusGroup style={S.gridArea} trapLeft={trappingFocus} trapUp={trappingFocus}>
          <FlatList
            data={chunkedChannels}
            keyExtractor={(item) => item.id}
            getItemLayout={getItemLayout}
            onEndReached={onEndReached}
            onEndReachedThreshold={0.5}
            removeClippedSubviews={Platform.OS === "android" && !isTV}
            contentContainerStyle={[S.gridContent, (isLoading || chunkedChannels.length === 0) && { flexGrow: 1 }]}
            extraData={filteredChannels.length}
            initialNumToRender={isTV ? 8 : 6}
            maxToRenderPerBatch={isTV ? 6 : 4}
            windowSize={5}
            updateCellsBatchingPeriod={50}
            ref={flatListRef}
            renderItem={renderRow}
            ListEmptyComponent={
              busy ? (
                <View style={{ flex: 1, paddingVertical: ph(10), justifyContent: "center", alignItems: "center" }}>
                  <ActivityIndicator color={THEME.colors.primary} size="large" />
                  <Text style={[S.loadingText, { marginTop: 10 }]}>Loading channels...</Text>
                </View>
              ) : (
                <View style={S.emptyState}>
                  <Ionicons
                    name={loadFailed ? "cloud-offline-outline" : "tv-outline"}
                    size={64}
                    color="rgba(255,255,255,0.08)"
                  />
                  <Text style={S.emptyTitle}>
                    {loadFailed ? "Couldn't Load Channels" : "No Channels Found"}
                  </Text>
                  <Text style={S.emptySubtitle}>
                    {loadFailed
                      ? "The portal returned no data. Retrying in the background…"
                      : searchQuery
                        ? "Try a different search term"
                        : "No channels in this category"}
                  </Text>
                  {loadFailed ? (
                    <Focusable onPress={onRefresh} ringOnFocus={false} style={S.retryBtn}>
                      {(focused) => (
                        <View style={[S.retryInner, focused && S.retryInnerFocused]}>
                          <Ionicons name="refresh" size={ps(1.1)} color={focused ? "#000" : "#fff"} />
                          <Text style={[S.retryText, focused && { color: "#000" }]}>Retry</Text>
                        </View>
                      )}
                    </Focusable>
                  ) : null}
                </View>
              )
            }
            ListFooterComponent={
              loadingMore && filteredChannels.length > 0 ? (
                <View style={S.loadingMore}>
                  <ActivityIndicator color={THEME.colors.primary} size="small" />
                  <Text style={S.loadingMoreText}>Loading more...</Text>
                </View>
              ) : null
            }
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={THEME.colors.primary}
              />
            }
          />
        </FocusGroup>
      </View>

      {/* ─── STB channel banner ─── */}
      {infoBarChannel ? (
        <ChannelInfoBar
          channel={infoBarChannel}
          nowNext={focusedNowNext}
          locked={parentalControl.isChannelRestricted(focusedChannel)}
          badges={[{ label: "LIVE", tone: "live" }]}
          hint={
            parentalControl.isChannelRestricted(focusedChannel)
              ? "Locked — a PIN is needed to watch this channel"
              : undefined
          }
        />
      ) : null}

      {/* ─── Numeric tuner ─── */}
      <ChannelTunerReadout
        entry={tuner.entry}
        resolvedName={tunerName}
        width={tunerMaxDigits}
      />

      {/* ─── Transient feedback ─── */}
      {notice ? (
        <View style={S.notice} pointerEvents="none">
          <Ionicons name="information-circle-outline" size={ps(1.1)} color="#fff" />
          <Text style={S.noticeText} numberOfLines={1}>{notice}</Text>
        </View>
      ) : null}

      {/* ─── Parental lock ─── */}
      <PinPrompt
        visible={!!pinTarget}
        title="Channel Locked"
        message={pinTarget ? `Enter your PIN to watch ${pinTarget.name}.` : ""}
        onSubmit={(pin) => parentalControl.unlock(pin)}
        onCancel={() => setPinTarget(null)}
        onSuccess={() => {
          const target = pinTarget;
          setPinTarget(null);
          if (target) openChannel(target);
        }}
      />

      <PinPrompt
        visible={!!lockTarget}
        title="Parental Control"
        message={
          lockTarget
            ? `Enter your PIN to ${parentalControl.isChannelRestricted(lockTarget) ? "unlock" : "lock"} ${lockTarget.name}.`
            : ""
        }
        onSubmit={(pin) => parentalControl.unlock(pin)}
        onCancel={() => setLockTarget(null)}
        onSuccess={() => {
          const target = lockTarget;
          setLockTarget(null);
          if (target) applyLockToggle(target);
        }}
      />
    </View>
  );
}

const S = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },

  // ── Header ──
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: pw(3),
    paddingVertical: ph(1.2),
    gap: pw(2),
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.03)",
  },
  headerTitle: { color: "#fff", fontSize: ps(1.8), fontWeight: "900", minWidth: pw(10) },
  backBtn: {
    width: ps(3.2),
    height: ps(3.2),
    borderRadius: ps(1.6),
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  backBtnFocused: {
    backgroundColor: "#fff",
    transform: [{ scale: 1.1 }],
  },
  searchWrapper: {
    flex: 1,
    height: ph(6.5),
  },
  searchGradient: {
    flex: 1,
    borderRadius: 25,
    padding: 1.5,
  },
  searchFocused: {
    shadowColor: THEME.colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 12,
    elevation: 12,
  },
  searchInner: {
    flex: 1,
    backgroundColor: "rgba(10, 10, 16, 0.61)",
    borderRadius: 25 - 1.5,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: pw(1.6),
  },
  searchInput: { flex: 1, color: "#fff", fontSize: ps(1.1) },
  iconBtn: { padding: ps(0.6), borderRadius: 12, backgroundColor: "rgba(255,255,255,0.05)" },
  countBadge: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 10,
    paddingHorizontal: pw(1.5),
    paddingVertical: ph(0.6),
  },
  countText: { color: THEME.colors.primary, fontSize: ps(1), fontWeight: "800" },
  notice: {
    position: "absolute",
    top: ph(10),
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: pw(0.8),
    paddingHorizontal: pw(2),
    paddingVertical: ph(1),
    borderRadius: ps(1),
    backgroundColor: "rgba(10,10,16,0.94)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    maxWidth: pw(60),
    zIndex: 70,
  },
  noticeText: { color: "#fff", fontSize: ps(1), fontWeight: "700" },
  headerBtn: { borderRadius: ps(1) },
  headerBtnInner: {
    width: ps(2.8),
    height: ps(2.8),
    borderRadius: ps(1.4),
    backgroundColor: "rgba(255,255,255,0.07)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  headerBtnFocused: {
    backgroundColor: "#fff",
    borderColor: "#fff",
    transform: [{ scale: 1.08 }],
  },

  // ── Body ──
  body: {
    flex: 1,
    flexDirection: "row",
  },
  gridArea: {
    flex: 1,
  },

  // ── Cards ──
  gridContent: {
    padding: pw(1.5),
    paddingBottom: ph(4),
  },
  gridRow: {
    flexDirection: "row",
    justifyContent: "flex-start",
  },
  cardWrapper: {
    aspectRatio: 0.85,
  },
  cardBorder: {
    flex: 1,
    padding: 1,
    borderRadius: ps(1.2),
    backgroundColor: THEME.colors.glassBg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  cardBorderFocused: {
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
  card: {
    flex: 1,
    backgroundColor: "transparent",
    borderRadius: ps(1.1),
    paddingHorizontal: ps(0.5),
    paddingTop: ps(0.5),
    paddingBottom: ps(0.5),
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  cardLogoWrapper: {
    width: "70%",
    flex: 1,
    maxHeight: "65%",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: ph(0.2),
  },
  cardLogo: {
    width: "100%",
    height: "100%",
  },
  cardInfo: {
    alignItems: "center",
    width: "100%",
    paddingHorizontal: 4,
  },
  cardTitle: {
    color: "#fff",
    fontSize: ps(0.9),
    fontWeight: "700",
    textAlign: "center",
  },
  cardCategory: {
    color: "rgba(255,255,255,0.28)",
    fontSize: ps(0.72),
    fontWeight: "600",
    textAlign: "center",
    marginTop: 2,
  },
  cardNow: {
    color: "rgba(255,255,255,0.6)",
    fontSize: ps(0.72),
    fontWeight: "600",
    textAlign: "center",
    marginTop: 2,
  },
  cardProgressTrack: {
    height: 2,
    width: "80%",
    borderRadius: 1,
    backgroundColor: "rgba(255,255,255,0.16)",
    marginTop: 4,
    overflow: "hidden",
  },
  cardProgressFill: { height: "100%", backgroundColor: "#fff" },
  cardNumber: {
    position: "absolute",
    top: ps(0.4),
    left: ps(0.4),
    minWidth: ps(1.6),
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    zIndex: 2,
  },
  cardNumberFocused: { backgroundColor: "rgba(0,0,0,0.12)" },
  cardNumberText: {
    color: "#fff",
    fontSize: ps(0.7),
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  cardLock: {
    position: "absolute",
    top: ps(0.4),
    right: ps(0.4),
    zIndex: 2,
  },

  // ── States ──
  loadingCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: ph(2),
  },
  loadingText: {
    color: "rgba(255,255,255,0.35)",
    fontSize: ps(1),
    fontWeight: "600",
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: ph(12),
    gap: ph(1.5),
  },
  emptyTitle: {
    color: "rgba(255,255,255,0.45)",
    fontSize: ps(1.4),
    fontWeight: "700",
  },
  emptySubtitle: {
    color: "rgba(255,255,255,0.22)",
    fontSize: ps(0.95),
  },
  retryBtn: {
    marginTop: ph(2),
  },
  retryInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(0.8),
    paddingHorizontal: pw(3),
    paddingVertical: ph(1.2),
    borderRadius: ps(1),
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  retryInnerFocused: {
    backgroundColor: "#fff",
  },
  retryText: {
    color: "#fff",
    fontSize: ps(1),
    fontWeight: "800",
    marginLeft: pw(0.6),
  },
  loadingMore: {
    width: "100%",
    paddingVertical: ph(3),
    alignItems: "center",
    gap: ph(0.8),
    flexDirection: "row",
    justifyContent: "center",
  },
  loadingMoreText: {
    color: "rgba(255,255,255,0.3)",
    fontSize: ps(0.9),
    marginLeft: pw(1),
  },
  loadMoreFooter: {
    paddingVertical: ph(3),
    alignItems: "center",
    justifyContent: "center",
  },
  loadMoreBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(0.8),
    paddingHorizontal: pw(3),
    paddingVertical: ph(1.4),
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: ps(1),
    borderWidth: 2,
    borderColor: "transparent",
  },
  loadMoreBtnFocused: {
    borderColor: "#fff",
    backgroundColor: THEME.colors.primary,
    shadowColor: THEME.colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 12,
    elevation: 12,
  },
  loadMoreBtnText: {
    color: "#fff",
    fontSize: ps(1),
    fontWeight: "900",
    letterSpacing: 1.5,
  },
});