import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  FlatList,
  Alert,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from 'expo-linear-gradient';

import { usePortalStore } from "../src/store/portalStore";
import { portalApi } from "../src/services/portalApi";
import { M3UApi } from "../src/services/m3uApi";
import { XtreamApi } from "../src/services/xtreamApi";
import { isTV } from "../src/utils/tvUtils";
import { useResponsive } from "../src/theme/responsive";
import { CinematicBackground } from "../src/components/CinematicBackground";
import { Focusable, FocusGroup, Overlay } from "../src/tv";
import { THEME , fw, isPhone } from '../src/theme/tokens';
import { launchExternalPlayer } from "../src/utils/externalPlayer";

const { width: W, height: H } = Dimensions.get("window");
const pw = (pct: number) => (W * pct) / 100;
const ph = (pct: number) => (H * pct) / 100;
// Font scale by device — TV stays 1× (unchanged), phone 2.2×, tablet 1.5× —
// so this screen's text is no longer undersized on touch devices.
const PS_SCALE = isTV ? 1.3 : isPhone ? 2.2 : 1.5;
const ps = (pct: number) => ((pw(pct) + ph(pct)) / 2) * PS_SCALE;

// ─────────────────────────────────────────────
// Metadata Pick Helpers
// ─────────────────────────────────────────────
const pickRating = (v: any) => {
  const r = v?.rating ?? v?.rating_imdb ?? v?.imdb_rating ?? v?.rating_tmdb ?? v?.score;
  if (r == null) return "";
  const s = String(r).trim();
  const lower = s.toLowerCase();
  if (
    !s ||
    lower === "n/a" ||
    lower === "na" ||
    lower === "0" ||
    lower === "0.0" ||
    lower === "0.00" ||
    lower === "null" ||
    lower === "undefined"
  ) {
    return "";
  }
  return s;
};

const pickYear = (v: any) => {
  const y = v?.year ?? v?.production_year ?? v?.release_year ?? v?.first_air_date ?? (v?.release_date ? v?.release_date.slice(0, 4) : "");
  if (y == null) return "";
  const s = String(y).trim();
  const lower = s.toLowerCase();
  if (
    !s ||
    lower === "n/a" ||
    lower === "na" ||
    lower === "0" ||
    lower === "null" ||
    lower === "undefined"
  ) {
    return "";
  }
  const match = s.match(/(19|20)\d{2}/);
  return match ? match[0] : s;
};

const ResultCard = ({ item, onPress, onFocus, cardWidth }: any) => (
  <Focusable
    onPress={onPress}
    onFocus={onFocus}
    ringOnFocus={false}
    style={[S.cardWrapper, cardWidth ? { width: cardWidth, maxWidth: cardWidth } : null, { overflow: "visible" }]}
  >
    {(focused) => (
      <LinearGradient
        colors={focused ? [THEME.colors.primary, THEME.colors.secondary] : ["transparent", "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          { flex: 1, borderRadius: ps(1.2), padding: focused ? 1.5 : 0 },
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
        <View style={[S.card, { borderRadius: focused ? ps(1.2) - 1.5 : ps(1.2) }]}>
          <View style={S.cardImgContainer}>
            <Image source={{ uri: item.logo }} style={S.cardImg} contentFit="cover" />
            {item.quality && <View style={S.badge}><Text style={S.badgeText}>{item.quality}</Text></View>}
          </View>
          <View style={S.cardInfo}>
            <Text style={S.cardTitle} numberOfLines={1}>{item.name}</Text>
            <Text style={S.cardSub}>{item.year ? `${item.year} • ` : ""}{item.type.toUpperCase()}</Text>
          </View>
        </View>
      </LinearGradient>
    )}
  </Focusable>
);

export default function SearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, isPhone, isLandscape } = useResponsive();
  const isMobile = isPhone;
  const { activePortal, channels, vodItems, series } = usePortalStore();
  const searchTimeout = useRef<any>(null);

  const [query, setQuery] = useState("");
  const [activeType, setActiveType] = useState<string>("all");
  const [results, setResults] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [focusedImage, setFocusedImage] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  // VOD Modal
  const [playModalVisible, setPlayModalVisible] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);

  // Search Logic
  const performSearch = useCallback(async (q: string, type: string) => {
    if (!q.trim() || !activePortal) {
      setResults([]);
      return;
    }

    setIsLoading(true);
    const term = q.toLowerCase();

    try {
      let finalResults: any[] = [];

      // ================= M3U (LOCAL ONLY) =================
      if (activePortal.type === "m3u") {
        if (type === "all" || type === "live") {
          finalResults = [...finalResults, ...channels.filter(c => c.name.toLowerCase().includes(term)).map(c => ({ ...c, type: 'live' }))];
        }
        if (type === "all" || type === "vod") {
          finalResults = [...finalResults, ...vodItems.filter(v => v.name.toLowerCase().includes(term)).map(v => ({ ...v, type: 'vod' }))];
        }
        if (type === "all" || type === "series") {
          finalResults = [...finalResults, ...series.filter(s => s.name.toLowerCase().includes(term)).map(s => ({ ...s, type: 'series' }))];
        }
      }

      // ================= XTREAM =================
      else if (activePortal.type === "xtream") {
        // Live is usually preloaded or fast to filter
        if (type === "all" || type === "live") {
          const live = channels.length > 0 ? channels : await portalApi.getLiveChannels(activePortal);
          finalResults = [...finalResults, ...live.filter(c => c.name.toLowerCase().includes(term)).map(c => ({ ...c, type: 'live' }))];
        }

        // VOD/Series -> API Search is better for Xtream
        if (type === "all" || type === "vod" || type === "series") {
          const searchTypes = type === "all" ? ["vod", "series"] : [type];
          for (const st of searchTypes) {
            const apiResults = await portalApi.search(activePortal, q, st as any);
            const mapped = apiResults.map(i => ({
              ...i,
              id: String(i.id || i.stream_id || i.series_id || i.movie_id || i.cmd),
              name: i.name || i.title,
              logo: i.cover || i.stream_icon || i.screenshot_uri || i.logo || "",
              type: st,
              year: pickYear(i),
              quality: i.quality || (i.container_extension ? i.container_extension.toUpperCase() : ""),
              description: i.plot || i.description || i.descr || i.info || "",
              rating: pickRating(i),
              streamUrl: i.cmd || i.url || "",
            }));
            finalResults = [...finalResults, ...mapped];
          }
        }
      }

      // ================= MAG / STALKER =================
      else if (activePortal.type === "mag") {
        const searchTypes = type === "all" ? ["live", "vod", "series"] : [type];
        for (const st of searchTypes) {
          const apiResults = await portalApi.search(activePortal, q, st as any);
          const mapped = apiResults.map(i => ({
            ...i,
            id: String(i.id || i.cmd || ""),
            streamUrl: i.cmd || "",
            name: i.name || i.title,
            logo: i.screenshot_uri || i.logo || "",
            type: st,
            year: pickYear(i),
            description: i.description || i.descr || i.plot || "",
            rating: pickRating(i),
          }));
          finalResults = [...finalResults, ...mapped];
        }
      }

      // Dedup and slice
      const seen = new Set();
      const unique = finalResults.filter(item => {
        const key = `${item.type}-${item.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      setResults(unique.slice(0, 50));
    } catch (error) {
      console.error("Search error:", error);
    } finally {
      setIsLoading(false);
    }
  }, [activePortal, channels, vodItems, series]);

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    
    searchTimeout.current = setTimeout(() => {
      performSearch(query, activeType);
    }, 400); // 400ms debounce

    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, [query, activeType, performSearch]);

  const handleResultPress = (item: any) => {
    if (item.type === 'live') {
      router.push({ pathname: "/player", params: { url: item.streamUrl, title: item.name, type: "live" } });
      return;
    }
    if (item.type === 'series') {
      // Series have seasons/episodes — route to the series-details screen.
      router.push({
        pathname: "/series-details",
        params: {
          id: item.id,
          name: item.name,
          logo: item.logo,
          description: item.description,
          year: item.year,
          rating: item.rating,
        },
      });
      return;
    }
    // VOD — open the action panel.
    setSelectedItem(item);
    setPlayModalVisible(true);
  };



  const handleVodAction = async (isExternal: boolean) => {
    if (!selectedItem || !activePortal) return;

    let streamUrl: string | undefined = selectedItem.streamUrl;

    try {
      if (activePortal.type === "xtream") {
        const xtream = new XtreamApi({
          url: activePortal.config.url,
          username: activePortal.config.username!,
          password: activePortal.config.password!,
        });
        streamUrl = xtream.buildMovieUrl(String(selectedItem.id), selectedItem.quality?.toLowerCase() || "mp4");
      } else if (activePortal.type === "m3u") {
        const m3uApi = new M3UApi({ url: activePortal.config.url });
        streamUrl = await m3uApi.getStreamUrl(String(selectedItem.id));
      } else if (activePortal.type === "mag") {
        const cmd = streamUrl || selectedItem.streamUrl;
        if (cmd) {
          const resolved = await portalApi.getStreamUrl(activePortal, cmd, "vod");
          if (resolved) streamUrl = resolved;
        }
      }
    } catch (e) {
      console.warn("Search VOD stream resolution failed:", e);
    }

    if (!streamUrl) {
      Alert.alert("Error", "No stream URL found for this content.");
      return;
    }

    setPlayModalVisible(false);
    if (isExternal) {
      launchExternalPlayer({ url: streamUrl, title: selectedItem.name });
    } else {
      router.push({ pathname: "/player", params: { url: streamUrl, title: selectedItem.name, type: "vod" } });
    }
  };
  // TV unchanged (6). Phone: 3 portrait / 5 landscape; tablet: 4 / 6.
  const RESULT_COLUMNS = isTV ? 6 : isMobile ? (isLandscape ? 5 : 3) : (isLandscape ? 6 : 4);
  // Reserve the outer padding and the inter-tile gaps so every tile is sized to
  // leave a real gap between neighbours instead of butting up against them.
  const GRID_PAD = pw(2);
  const TILE_GAP = isTV ? pw(1.2) : pw(2);
  const CARD_WIDTH = (width - GRID_PAD * 2 - TILE_GAP * (RESULT_COLUMNS - 1)) / RESULT_COLUMNS;

  return (
    <View style={[S.container, { paddingTop: insets.top }]}>
      <CinematicBackground uri={focusedImage} />

      {/* Header Bar */}
      <FocusGroup>
        <View style={S.headerRow}>
          {!isMobile && (
            <Focusable
              ringOnFocus={false}
              focusStyle={{ borderWidth: 2, borderColor: "rgba(255,255,255,0.5)", borderRadius: ps(2) }}
              onPress={() => router.back()}
              style={[S.settingsBtn, { marginRight: 8 }]}
            >
              {() => <Ionicons name="chevron-back" size={ps(1.8)} color="#fff" />}
            </Focusable>
          )}
          <Focusable
            hasTVPreferredFocus
            onPress={() => inputRef.current?.focus()}
            ringOnFocus={false}
            style={S.searchBarWrapper}
          >
            {(focused) => (
              <View
                style={[
                  S.searchBarInner,
                  { borderWidth: 1.5, borderColor: (focused || searchFocused) ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.12)" },
                  (focused || searchFocused) && S.searchBarFocused,
                ]}
              >
                  <Ionicons name="search" size={ps(1.1)} color="rgba(255,255,255,0.5)" />
                  <TextInput
                    ref={inputRef}
                    style={S.searchInput}
                    placeholder="Search movies, shows, and more..."
                    placeholderTextColor="rgba(255,255,255,0.3)"
                    value={query}
                    onChangeText={setQuery}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => setSearchFocused(false)}
                  />
                  {query.length > 0 && (
                    <TouchableOpacity onPress={() => setQuery("")} style={{ padding: 8 }}>
                      <Ionicons name="close-circle" size={ps(1.2)} color="rgba(255,255,255,0.5)" />
                    </TouchableOpacity>
                  )}
              </View>
            )}
          </Focusable>
        </View>
      </FocusGroup>

      {/* Filter row */}
      <FocusGroup>
        <View style={S.filterRow}>
          {[
            { id: "all", label: "All" },
            { id: "live", label: "Live TV" },
            { id: "vod", label: "Movies" },
            { id: "series", label: "Series" }
          ].map((filter) => {
            const isActive = activeType === filter.id;
            return (
              <Focusable
                key={filter.id}
                onPress={() => setActiveType(filter.id)}
                ringOnFocus={false}
                style={S.filterPillWrapper}
              >
                {(focused) => (
                  <View style={[
                    S.filterPill,
                    focused && S.filterPillFocused,
                    isActive && S.filterPillActive
                  ]}>
                    <Text style={[S.filterText, (isActive || focused) && S.filterTextActive]}>
                      {filter.label}
                    </Text>
                  </View>
                )}
              </Focusable>
            );
          })}
        </View>
      </FocusGroup>

      {/* Results below */}
      <FocusGroup style={S.resultsArea}>
        {isLoading && (
          <View style={S.loadingInline}>
            <ActivityIndicator color={THEME.colors.primary} />
          </View>
        )}
        <FlatList
          data={results}
          numColumns={RESULT_COLUMNS}
          key={`results-${RESULT_COLUMNS}`}
          keyExtractor={(item: any) => `${item.type}-${item.id}`}
          contentContainerStyle={{ paddingHorizontal: GRID_PAD, paddingBottom: ph(6) }}
          columnWrapperStyle={{ gap: TILE_GAP, marginBottom: TILE_GAP }}
          removeClippedSubviews={false}
          initialNumToRender={RESULT_COLUMNS * 4}
          maxToRenderPerBatch={RESULT_COLUMNS * 4}
          renderItem={({ item }: any) => (
            <ResultCard
              item={item}
              cardWidth={CARD_WIDTH}
              onPress={() => handleResultPress(item)}
              onFocus={() => item.logo && setFocusedImage(item.logo)}
            />
          )}
          ListEmptyComponent={
            !isLoading ? (
              <View style={S.emptyState}>
                <Ionicons name="search-outline" size={ps(5)} color="rgba(255,255,255,0.08)" />
                <Text style={S.emptyText}>
                  {query.trim() ? "No matches found" : "Start typing to discover content"}
                </Text>
              </View>
            ) : null
          }
        />
      </FocusGroup>

      <Overlay
        visible={playModalVisible}
        onClose={() => setPlayModalVisible(false)}
        contentStyle={S.modalContainer}
        position={isMobile ? "bottom" : "center"}
      >
        <View style={isTV ? S.modalTVContent : null}>
          <View style={S.modalLeft}>
            <Text style={S.modalTitle} numberOfLines={2}>{selectedItem?.name}</Text>
            <Text style={S.modalDescription} numberOfLines={isTV ? 8 : 5}>
              {selectedItem?.description || "Experience this cinematic masterpiece. Dive into a world of high-quality streaming entertainment."}
            </Text>
            <View style={S.modalMetaRow}>
              {selectedItem?.rating ? (
                <View style={S.modalBadge}>
                  <Ionicons name="star" size={ps(1)} color="#FFD700" />
                  <Text style={S.modalBadgeText}>{selectedItem.rating}</Text>
                </View>
              ) : null}
              {selectedItem?.year ? (
                <View style={S.modalBadge}>
                  <Ionicons name="calendar-outline" size={ps(1)} color="#fff" />
                  <Text style={S.modalBadgeText}>{selectedItem.year}</Text>
                </View>
              ) : null}
            </View>
          </View>

          <View style={S.modalRight}>
            <Focusable
              hasTVPreferredFocus
              ringOnFocus={false}
              onPress={() => handleVodAction(false)}
              style={S.modalBtnWrapper}
            >
              {(focused) => (
                <LinearGradient
                  colors={[THEME.colors.primary, THEME.colors.secondary]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[S.modalBtnBorder, focused && S.modalBtnBorderFocused]}
                >
                  <View style={S.modalBtnPrimaryInner}>
                    <Text style={S.modalBtnPrimaryText}>WATCH NOW</Text>
                  </View>
                </LinearGradient>
              )}
            </Focusable>
            <Focusable
              ringOnFocus={false}
              onPress={() => handleVodAction(true)}
              style={S.modalBtnWrapper}
            >
              {(focused) => (
                <LinearGradient
                  colors={focused
                    ? [THEME.colors.primary, THEME.colors.secondary]
                    : ["rgba(255,255,255,0.18)", "rgba(255,255,255,0.04)"]
                  }
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[S.modalBtnBorder, focused && S.modalBtnBorderFocused]}
                >
                  <View style={S.modalBtnSecondaryInner}>
                    <Text style={S.modalBtnSecondaryText}>EXTERNAL PLAYER</Text>
                  </View>
                </LinearGradient>
              )}
            </Focusable>
            <Focusable
              ringOnFocus={false}
              onPress={() => setPlayModalVisible(false)}
              style={S.modalBtnWrapper}
            >
              {(focused) => (
                <LinearGradient
                  colors={focused
                    ? [THEME.colors.primary, THEME.colors.secondary]
                    : ["rgba(255,255,255,0.18)", "rgba(255,255,255,0.04)"]
                  }
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[S.modalBtnBorder, focused && S.modalBtnBorderFocused]}
                >
                  <View style={S.modalBtnSecondaryInner}>
                    <Text style={S.modalBtnSecondaryText}>CLOSE</Text>
                  </View>
                </LinearGradient>
              )}
            </Focusable>
          </View>
        </View>
      </Overlay>
    </View>
  );
}

const S = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#08080a",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: pw(5),
    paddingVertical: ph(2),
    gap: pw(1.5),
  },
  searchBarWrapper: {
    flex: 1,
    height: ph(5),
  },
  searchBarGradient: {
    flex: 1,
    borderRadius: 999,
    padding: 1.5,
  },
  searchBarFocused: {
    shadowColor: THEME.colors.primary,
    shadowOpacity: 0.7,
    shadowRadius: 16,
    elevation: 12,
  },
  searchBarInner: {
    flex: 1,
    backgroundColor: "rgba(10,10,16,0.61)",
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: pw(2),
  },
  searchInput: {
    flex: 1,
    color: "#fff",
    fontSize: ps(0.95),
    marginLeft: 8,
    paddingVertical: 0,
    paddingLeft: 4,
    textAlignVertical: "center",
    fontWeight: fw("400"),
  },
  settingsBtn: {
    padding: ps(1),
  },

  resultsArea: {
    flex: 1,
  },
  loadingInline: {
    paddingVertical: ph(2),
    alignItems: "center",
  },

  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: isTV ? pw(0.8) : pw(2.5),
    paddingHorizontal: pw(5),
    paddingVertical: ph(1),
  },
  filterPillWrapper: {
    paddingVertical: ph(0.5),
  },
  filterPill: {
    paddingHorizontal: isTV ? pw(1.6) : pw(3),
    paddingVertical: isTV ? ph(1) : ph(0.6),
    borderRadius: 100,
    borderWidth: 1.2,
    borderColor: "rgba(255,255,255,0.12)",
    overflow: "hidden",
    minHeight: isTV ? undefined : 38,
    justifyContent: "center",
    alignItems: "center",
  },
  filterPillFocused: {
    borderColor: "#fff",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  filterPillActive: {
    backgroundColor: THEME.colors.primary,
    borderColor: "transparent",
  },
  filterText: {
    color: "rgba(255,255,255,0.4)",
    fontSize: ps(1.0),
    fontWeight: fw("600"),
    letterSpacing: 0.3,
  },
  filterTextActive: {
    color: "#fff",
  },

  cardWrapper: {
    width: (W - pw(4)) / (isTV ? 6 : 3),
    maxWidth: (W - pw(4)) / (isTV ? 6 : 3),
  },
  card: {
    flex: 1,
    borderRadius: ps(1.2),
    overflow: "hidden",
    backgroundColor: "#161622",
  },
  cardImgContainer: {
    width: "100%",
    aspectRatio: 3/4,
    backgroundColor: "#1c1c2b",
    overflow: "hidden",
  },
  cardImg: {
    width: "100%",
    height: "100%",
  },
  cardInfo: {
    padding: ps(0.7),
  },
  cardTitle: {
    color: "#fff",
    fontSize: isTV ? ps(1.0) : ps(0.9),
    fontWeight: fw("700"),
  },
  cardSub: {
    color: "rgba(255,255,255,0.5)",
    fontSize: isTV ? ps(0.8) : ps(0.62),
    marginTop: 3,
  },
  badge: {
    position: "absolute",
    top: isTV ? ps(0.4) : ps(0.8),
    right: isTV ? ps(0.4) : ps(0.8),
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: isTV ? pw(0.5) : pw(1),
    paddingVertical: isTV ? ph(0.25) : ph(0.5),
    borderRadius: 3,
  },
  badgeText: {
    color: "#fff",
    fontSize: isTV ? ps(0.55) : ps(0.7),
    fontWeight: fw("800"),
  },

  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: ph(20),
  },
  emptyText: {
    color: "rgba(255,255,255,0.2)",
    fontSize: ps(1.4),
    marginTop: ph(2),
    textAlign: "center",
  },

  // ── Action overlay (identical to vod.tsx) ──
  modalContainer: { backgroundColor: "#111", width: isTV ? ps(65) : "92%", borderRadius: 24, padding: ps(2), borderWidth: 1, borderColor: "rgba(255,255,255,0.05)", overflow: "hidden" },
  modalTVContent: { flexDirection: "row" },
  modalLeft: { flex: 1.4, padding: ps(1.5) },
  modalRight: { flex: 0.6, backgroundColor: "rgba(255,255,255,0.015)", padding: ps(2), borderRadius: 20, justifyContent: "center", gap: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.03)" },
  modalTitle: { color: "#fff", fontSize: ps(1.8), fontWeight: fw("900"), marginBottom: 12 },
  modalDescription: { color: "rgba(255,255,255,0.5)", fontSize: ps(0.95), lineHeight: ps(1.4), marginBottom: 18 },
  modalMetaRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  modalBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.05)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  modalBadgeText: { color: "#fff", fontSize: ps(0.85), fontWeight: fw("700") },
  modalBtnWrapper: { borderRadius: 12, overflow: "visible" },
  modalBtnBorder: { padding: 1.5, borderRadius: 12 },
  modalBtnBorderFocused: {
    padding: 2.5,
    shadowColor: THEME.colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 14,
    elevation: 14,
  },
  modalBtnPrimaryInner: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "transparent" },
  modalBtnSecondaryInner: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#0d0d12" },
  modalBtnPrimaryText: { color: "#fff", fontSize: ps(0.95), fontWeight: fw("900"), letterSpacing: 1 },
  modalBtnSecondaryText: { color: "rgba(255,255,255,0.85)", fontSize: ps(0.9), fontWeight: fw("700"), letterSpacing: 0.5 },
});
