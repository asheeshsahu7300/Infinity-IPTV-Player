import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Image,
  Dimensions,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePortalStore } from "../src/store/portalStore";
import { portalApi } from "../src/services/portalApi";
import { XtreamApi } from "../src/services/xtreamApi";
import { M3UApi } from "../src/services/m3uApi";
import { launchExternalPlayer } from "../src/utils/externalPlayer";
import LoadingOverlay from "../src/components/LoadingOverlay";
import { isTV } from "../src/utils/tvUtils";
import { Focusable, Overlay, useInitialFocusPulse } from "../src/tv";
import { useDialog } from "../src/components/ConfirmDialog";
import { useNetworkActivity } from "../src/services/networkActivity";
import { CinematicBackground, updateCinematicBackground } from "../src/components/CinematicBackground";
// This screen is sized against the un-bumped scale — see psRaw in tokens.ts.
import { THEME, pw, ph, psRaw as ps, CARD_FRAME, CARD_FRAME_INNER_RADIUS, TILE_FRAME, TILE_FRAME_FOCUSED } from "../src/theme/tokens";

const RAIL_H_PAD = pw(isTV ? 5 : 4);

// ─── Components ───────────────────────────────────────────────────────────────

const HeroPill = ({
  icon,
  text,
  onPress,
  iconType = "ionicons",
  autoFocus = false,
}: {
  icon: string;
  text: string;
  onPress: () => void;
  iconType?: "ionicons" | "material";
  autoFocus?: boolean;
}) => {
  const [shouldFocus, setShouldFocus] = useState(autoFocus);
  useEffect(() => {
    if (autoFocus) {
      setShouldFocus(true);
      const timer = setTimeout(() => setShouldFocus(false), 500);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Focusable
      hasTVPreferredFocus={shouldFocus}
      onPress={onPress}
      ringOnFocus={false}
      style={S.heroPillWrapper}
    >
      {(focused) => (
        <View style={[
          S.heroPillContainer,
          focused && S.heroPillContainerFocused,
          focused && { transform: [{ scale: 1.08 }] }
        ]}>
          <View
            style={[
              S.heroPillGradient,
              !focused && { backgroundColor: "rgba(255,255,255,0.05)" },
              focused && { backgroundColor: "#fff" }
            ]}
          >
            {iconType === "material" ? (
              <MaterialCommunityIcons name={icon as any} size={ps(1.8)} color={focused ? "#000" : "#fff"} style={{ marginRight: pw(0.8) }} />
            ) : (
              <Ionicons name={icon as any} size={ps(1.8)} color={focused ? "#000" : "#fff"} style={{ marginRight: pw(0.8) }} />
            )}
            <Text style={[S.heroPillText, focused && { color: "#000" }]}>{text}</Text>
          </View>
        </View>
      )}
    </Focusable>
  );
};

export default function DashboardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Errors surface through an in-tree overlay — Alert.alert does not
  // reliably appear on an Android TV release build.
  const { notify, node: dialogNode } = useDialog();
  // Selectors, not whole-store destructuring — the dashboard stays mounted
  // behind pushed screens and was re-rendering on every content write.
  const activePortal = usePortalStore((s) => s.activePortal);
  const loadFavorites = usePortalStore((s) => s.loadFavorites);

  const [isLoading, setIsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // True while any portal request is in flight, including the boot sync and the
  // periodic refresh that this screen never started.
  const syncing = useNetworkActivity();

  // Hands initial focus to the Live TV tile once the screen has a portal.
  const focusLiveTile = useInitialFocusPulse(!!activePortal);

  // ── Play Modal ──────────────────────────────────────────────────────────────
  const [playModalVisible, setPlayModalVisible] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);

  // Load favorites & stats
  useEffect(() => {
    if (!activePortal) {
      router.replace("/portals");
      return;
    }
    loadFavorites();
  }, [activePortal]);

  const handleFullRefresh = useCallback(async () => {
    if (!activePortal) return;
    setIsLoading(true);
    try {
      await portalApi.refreshPortalData(activePortal, true);
    } catch (e: any) {
      console.warn("Refresh failed:", e);
      notify("Refresh Failed", e?.message || "Unable to refresh portal data.", "danger");
    } finally {
      setIsLoading(false);
    }
  }, [activePortal, notify]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await handleFullRefresh();
    setRefreshing(false);
  }, [handleFullRefresh]);

  // Handle VOD play action (Watch Now or External)
  const handleVodAction = useCallback(async (isExternal: boolean) => {
    if (!selectedItem || !activePortal) return;
    let streamUrl: string | undefined = selectedItem.streamUrl;

    const latestPortal = usePortalStore.getState().activePortal ?? activePortal;
    try {
      if (latestPortal.type === "xtream") {
        const xtream = new XtreamApi({
          url: latestPortal.config.url,
          username: latestPortal.config.username!,
          password: latestPortal.config.password!,
        });
        streamUrl = xtream.buildMovieUrl(String(selectedItem.id), "mp4");
      } else if (latestPortal.type === "m3u") {
        const m3uApi = new M3UApi({ url: latestPortal.config.url });
        streamUrl = await m3uApi.getStreamUrl(String(selectedItem.id));
      } else if (latestPortal.type === "mag") {
        const cmd = selectedItem.streamUrl;
        if (cmd) {
          const resolved = await portalApi.getStreamUrl(latestPortal, cmd, "vod");
          if (resolved) streamUrl = resolved;
        }
      }
    } catch (e) {
      console.warn("Stream resolution failed:", e);
    }

    if (!streamUrl) {
      notify("Playback Unavailable", "No stream URL was found for this content.", "danger");
      return;
    }

    setPlayModalVisible(false);
    if (isExternal) {
      launchExternalPlayer({ url: streamUrl, title: selectedItem.name });
    } else {
      router.push({
        pathname: "/player",
        params: {
          url: streamUrl,
          title: selectedItem.name,
          type: "vod",
          contentId: `vod:${selectedItem.id}`,
        },
      });
    }
  }, [selectedItem, activePortal, router, notify]);

  // ── Render ──────────────────────────────────────────────────────────────────

  const dashboardContent = (
    <>
      {/* Cinematic Header Branding */}
      <View style={S.headerBranding}>
        <View style={S.logoRow}>
          <Image source={require("../assets/images/TV.png")} style={S.headerLogoImage} resizeMode="contain" />
        </View>
        <View style={S.headerActions}>
          {/* Doubles as the sync indicator. A background refresh must not raise
              the blocking LoadingOverlay — that is reserved for a refresh the
              user asked for — so in-flight traffic surfaces here instead. */}
          <Focusable ringOnFocus={false} focusStyle={S.roundBtnFocused} onPress={handleFullRefresh} style={S.roundBtn}>
            {(focused) => syncing ? (
              <ActivityIndicator size="small" color={focused ? "#000" : "#fff"} />
            ) : (
              <Ionicons name="refresh" size={isTV ? ps(1.8) : ps(2.2)} color={focused ? "#000" : "#fff"} />
            )}
          </Focusable>
          <Focusable ringOnFocus={false} focusStyle={S.roundBtnFocused} onPress={() => router.push("/portals")} style={S.roundBtn}>
            {(focused) => <Ionicons name="apps" size={isTV ? ps(1.8) : ps(2.2)} color={focused ? "#000" : "#fff"} />}
          </Focusable>
          <Focusable ringOnFocus={false} focusStyle={S.roundBtnFocused} onPress={() => router.push("/settings")} style={S.roundBtn}>
            {(focused) => <Ionicons name="settings-sharp" size={isTV ? ps(1.8) : ps(2.2)} color={focused ? "#000" : "#fff"} />}
          </Focusable>
        </View>
      </View>

      {/* Cinematic Hero Section */}
      <View style={S.heroSection}>
        <LinearGradient
          colors={["rgba(8, 8, 12, 0.75)", "rgba(8, 8, 12, 0.35)", "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={S.heroGradientOverlay}
        />
        <Text style={S.heroTitle}>Unlimited Entertainment</Text>
        <Text style={S.heroDesc}>
          Access thousands of channels, global movies and exclusive series directly on your screen.
        </Text>
        <View style={S.heroButtons}>
          {/* Initial focus belongs to the Live TV tile below, not here. */}
          <HeroPill icon="search" text="Search Content" onPress={() => router.push("/search")} />
          {/* The guide lives here rather than behind a button in the Live TV
              header. It is a place you go, like Search — not a control on the
              channel grid — and from the remote it is still one GUIDE press
              away from anywhere. */}
          <HeroPill icon="calendar-outline" text="TV Guide" onPress={() => router.push("/epg")} />
        </View>
      </View>

      {/* Browse Category Cards */}
      <View style={S.browseSection}>
        <View style={S.browseContainer}>
          {(
            [
              // Bundled rather than fetched: these three are the first thing on
              // screen, and a cold TV start used to show empty cards until the
              // remote images arrived.
              { id: "cat-live", title: "Live TV", icon: "tv", img: require("../assets/images/livetv.png"), route: "/live-tv" },
              { id: "cat-movies", title: "Movies", icon: "film", img: require("../assets/images/movies.png"), route: "/vod" },
              { id: "cat-series", title: "Series", icon: "albums", img: require("../assets/images/series.png"), route: "/series" },
            ]
          ).map((cat) => (
            <Focusable
              key={cat.id}
              // Live TV is where most sessions start, so it owns the
              // dashboard's initial focus.
              hasTVPreferredFocus={focusLiveTile && cat.id === "cat-live"}
              onFocus={() => updateCinematicBackground(cat.img, .5)}
              onPress={() => router.push(cat.route as any)}
              ringOnFocus={false}
              // TV: no fixed height — `flex: 1` shares the row's width and
              // the height comes from the parent stretching, so the row fits
              // whatever space is left instead of overflowing the screen.
              style={S.browseCard}
            >
              {(focused) => (
                <View
                  style={[
                    S.cardBorder,
                    focused && S.cardBorderFocused,
                    focused && { transform: [{ scale: 1.04 }] }
                  ]}
                >
                  <View style={S.browseCardInner}>
                    <Image source={cat.img} resizeMode="cover" style={{ width: undefined, height: undefined, flex: 1, backgroundColor: '#0000' }} />

                    {/* Dark gradient overlay to soften poster collage and ensure maximum legibility */}
                    <LinearGradient
                      colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.35)", "rgba(8,8,12,0.92)"]}
                      locations={[0, 0.5, 1]}
                      style={StyleSheet.absoluteFillObject}
                    />

                    {/* Text container sitting on top at the bottom */}
                    <View style={S.browseCardContent}>
                      <View style={[S.browseCardIconWrap, focused && S.browseCardIconWrapFocused]}>
                        <Ionicons name={cat.icon as any} size={ps(2.2)} color={focused ? "#fff" : "#d8dce8"} />
                      </View>
                      <Text style={[S.browseCardTitle, focused && S.browseCardTitleFocused]}>{cat.title}</Text>
                    </View>
                  </View>
                </View>
              )}
            </Focusable>
          ))}
        </View>
      </View>
    </>
  );

  return (
    <View style={S.container}>
      <View
        style={{ flex: 1 }}
        accessibilityElementsHidden={playModalVisible}
        importantForAccessibility={playModalVisible ? "no-hide-descendants" : "auto"}
      >
        {/* Cinematic Background */}
        <View style={S.backgroundArea}>
          <CinematicBackground />
        </View>

        {isLoading && <LoadingOverlay message="Refreshing your library..." />}

        {/* On TV the dashboard is a single screen — the browse row absorbs
            whatever height is left over, so there is nothing to scroll and the
            D-pad never drags the view around. Touch layouts stack the three
            cards vertically and genuinely cannot fit, so they keep the
            ScrollView (and with it pull-to-refresh). */}
        {isTV ? (
          <View style={[S.body, { paddingTop: insets.top + ph(2) }]}>{dashboardContent}</View>
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingTop: insets.top + ph(2), paddingBottom: ph(10) }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#ff1b8a" />}
          >
            {dashboardContent}
          </ScrollView>
        )}
      </View>

      {/* ── Play Modal ────────────────────────────────────────────────────── */}
      <Overlay
        visible={playModalVisible}
        onClose={() => setPlayModalVisible(false)}
        contentStyle={S.modalContainer}
      >
        <View style={[isTV ? S.modalTVContent : null, { padding: ps(3) }]}>
          <View style={S.modalLeft}>
            <Text style={S.modalTitle} numberOfLines={2}>{selectedItem?.name}</Text>
            <Text style={S.modalDescription} numberOfLines={isTV ? 8 : 5}>
              {selectedItem?.description || "No description available for this content."}
            </Text>
            <View style={S.modalMetaRow}>
              {selectedItem?.rating ? (
                <View style={S.modalBadge}>
                  <Ionicons name="star" size={ps(1)} color="#FFD700" />
                  <Text style={S.modalBadgeText}>{selectedItem.rating}</Text>
                </View>
              ) : null}
              {selectedItem?.subtitle ? (
                <View style={S.modalBadge}>
                  <Ionicons name="calendar-outline" size={ps(1)} color="#fff" />
                  <Text style={S.modalBadgeText}>{selectedItem.subtitle}</Text>
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
                  colors={focused ? ["#fff", "#fff"] : ["rgba(255,255,255,0.05)", "rgba(255,255,255,0.05)"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[S.modalBtnBorder, focused && S.modalBtnBorderFocused]}
                >
                  <View style={S.modalBtnPrimaryInner}>
                    <Text style={[S.modalBtnPrimaryText, focused && { color: "#000" }]}>WATCH NOW</Text>
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
                    ? ["#fff", "#fff"]
                    : ["rgba(255,255,255,0.18)", "rgba(255,255,255,0.04)"]
                  }
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[S.modalBtnBorder, focused && S.modalBtnBorderFocused]}
                >
                  <View style={S.modalBtnSecondaryInner}>
                    <Text style={[S.modalBtnSecondaryText, focused && { color: "#000" }]}>EXTERNAL PLAYER</Text>
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
                    ? ["#fff", "#fff"]
                    : ["rgba(255,255,255,0.18)", "rgba(255,255,255,0.04)"]
                  }
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[S.modalBtnBorder, focused && S.modalBtnBorderFocused]}
                >
                  <View style={S.modalBtnSecondaryInner}>
                    <Text style={[S.modalBtnSecondaryText, focused && { color: "#000" }]}>CLOSE</Text>
                  </View>
                </LinearGradient>
              )}
            </Focusable>
          </View>
        </View>
      </Overlay>

      {dialogNode}
    </View>
  );
}

const S = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#08080a",
  },
  /** TV: the non-scrolling column. */
  body: {
    flex: 1,
  },
  backgroundArea: {
    // Full-bleed. The old ph(70) cap ended the backdrop 70% down the screen and
    // left a hard seam with the flat container colour below it.
    ...StyleSheet.absoluteFillObject,
  },
  bgImage: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.45,
  },
  bgGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  bgBottomFade: {
    position: "absolute",
    bottom: 0,
    width: "100%",
    height: ph(30),
  },

  // ── Branding ──
  headerBranding: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: RAIL_H_PAD,
    // Tighter on TV so everything fits one screen without scrolling.
    marginBottom: isTV ? ph(1.8) : ph(4),
    marginTop: isTV ? ph(1.5) : ph(4),
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(1.5),
  },
  logoTitle: {
    color: "#fff",
    fontSize: ps(2.8),
    fontWeight: "500",
    letterSpacing: 5,
  },
  headerLogoImage: {
    width: isTV ? pw(22) : pw(38),
    height: isTV ? ph(7.2) : ph(6.5),
    transform: [{ scale: isTV ? 2.1 : 2.2 }],
    marginLeft: isTV ? -pw(4.2) : -pw(3),
  },
  headerActions: {
    flexDirection: "row",
    gap: isTV ? pw(1.2) : pw(2),
    alignItems: "center",
  },
  roundBtn: {
    width: isTV ? pw(3.8) : pw(9.5),
    height: isTV ? pw(3.8) : pw(9.5),
    borderRadius: isTV ? pw(1.9) : pw(4.75),
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    justifyContent: "center",
    alignItems: "center",
  },
  roundBtnFocused: {
    backgroundColor: "#FFFFFF",
    borderColor: "#FFFFFF",
    transform: [{ scale: 1.12 }],
    ...Platform.select({
      ios: {
        shadowColor: "#fff",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.85,
        shadowRadius: 14,
      },
      android: {
        elevation: 12,
      },
    }),
  },

  // ── Hero ──
  heroSection: {
    paddingHorizontal: RAIL_H_PAD,
    maxWidth: pw(72),
    position: "relative",
    // TV: this band absorbs the leftover height instead of the browse row, so
    // the cards keep their landscape shape (their artwork is landscape — letting
    // them stretch to fill crops the sides off) and the slack becomes breathing
    // room around the hero text rather than a dead black strip under the cards.
    ...(isTV
      ? { flex: 1, justifyContent: "center" as const, marginBottom: ph(1.5) }
      : { marginBottom: ph(8) }),
  },
  heroGradientOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: ps(2),
    zIndex: -1,
  },
  heroTagline: {
    fontSize: ps(1.1),
    fontWeight: "900",
    letterSpacing: 2.5,
  },
  heroTitle: {
    fontSize: isTV ? ps(3.2) : ps(2.6),
    color: "#FFFFFF",
    fontWeight: "600",
    letterSpacing: 0.4,
    marginVertical: ph(1.5),
    textShadowColor: "rgba(0, 0, 0, 0.75)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  heroDesc: {
    fontSize: isTV ? ps(1.3) : ps(1.1),
    color: "#A2A7BD",
    lineHeight: isTV ? ph(2.8) : ph(2.3),
    marginBottom: ph(3.5),
    maxWidth: isTV ? pw(58) : "100%",
  },
  heroButtons: {
    flexDirection: "row",
    gap: pw(1.2),
  },
  heroPillWrapper: {
    borderRadius: 100,
    overflow: "hidden",
  },
  heroPillContainer: {
    borderRadius: 100,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    overflow: "hidden",
  },
  heroPillContainerFocused: {
    borderColor: "#FFFFFF",
    ...Platform.select({
      ios: {
        shadowColor: "#fff",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.75,
        shadowRadius: pw(1.5),
      },
      android: {
        elevation: 8,
      },
    }),
  },
  heroPillGradient: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: isTV ? pw(2.2) : pw(4.5),
    paddingVertical: isTV ? ph(1.2) : ph(1.6),
    borderRadius: 100,
    overflow: "hidden",
  },
  heroPillText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: isTV ? ps(1.2) : ps(1.1),
    letterSpacing: 0.5,
  },

  // Browse Section ──
  browseSection: {
    paddingHorizontal: RAIL_H_PAD,
    // A flex *weight*, not a ph() height. `ph()` derives from the window size
    // captured when tokens.ts was imported; if that reading is short of the real
    // display the whole column ends above the bottom edge. A weight is resolved
    // against the parent's actual laid-out height, so the column always reaches
    // the bottom, and the 1 : 1.6 split against heroSection keeps the cards
    // roughly landscape.
    ...(isTV
      ? { flex: 1.6, marginBottom: ph(3.5) }
      : { marginBottom: ph(6) }),
  },
  browseContainer: {
    flexDirection: isTV ? "row" : "column",
    // Expanded gap for breathing room as recommended by TV design feedback
    gap: isTV ? pw(2.8) : pw(2.2),
    ...(isTV ? { flex: 1 } : null),
  },
  browseCard: {
    flex: 1,
    paddingHorizontal: pw(0.3),
    paddingVertical: pw(0.8),
    overflow: "visible",
    // Touch layouts stack these vertically inside a ScrollView, so they still
    // need an explicit height; on TV the row stretches them.
    height: ph(42),
    minHeight: ph(42),
  },
  cardBorder: {
    ...TILE_FRAME,
    flex: 1,
    borderRadius: CARD_FRAME.borderRadius,
  },
  // Was a pure #FFFFFF edge over a transparent fill with an elevation-14 lift
  // — the heaviest focus treatment in the app, on the first cards anyone sees.
  cardBorderFocused: { ...TILE_FRAME_FOCUSED },
  browseCardInner: {
    flex: 1,
    backgroundColor: THEME.colors.background,
    borderRadius: CARD_FRAME_INNER_RADIUS,
    overflow: "hidden",
  },
  browseCardContent: {
    position: "absolute",
    bottom: 0,
    width: "100%",
    left: 0,
    right: 0,
    padding: ps(1.6),
    borderBottomLeftRadius: ps(1.1),
    borderBottomRightRadius: ps(1.1),
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    gap: pw(1),
  },
  browseCardIconWrap: {
    width: ps(3.2),
    height: ps(3.2),
    borderRadius: ps(1.6),
    backgroundColor: "rgba(255,255,255,0.06)",
    justifyContent: "center",
    alignItems: "center",
  },
  browseCardIconWrapFocused: {
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  browseCardTitle: {
    color: "#D8DCE8",
    fontSize: isTV ? ps(1.8) : ps(1.5),
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  browseCardTitleFocused: {
    color: "#FFFFFF",
  },

  // ── Rails ──
  railsPadding: {
    paddingHorizontal: 0,
  },
  section: {
    marginBottom: ph(4),
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: RAIL_H_PAD,
    marginBottom: ph(1.5),
  },
  sectionTitle: {
    color: "#fff",
    fontSize: ps(1.8),
    fontWeight: "600",
  },
  viewAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(0.5),
  },
  viewAllText: {
    color: "#888",
    fontSize: ps(1.2),
  },
  sectionScroll: {
    paddingLeft: RAIL_H_PAD,
    paddingRight: pw(5),
  },

  // ── Items ──
  railItem: {
    borderRadius: pw(1.2),
    overflow: "visible",
  },
  railInner: {
    flex: 1,
    backgroundColor: "transparent",
    borderRadius: ps(1.1),
    overflow: "hidden",
  },
  imageWrapper: {
    flex: 1,
  },
  railItemImage: {
    width: "100%",
    height: "100%",
  },
  placeholderBg: {
    backgroundColor: "#16181d",
    justifyContent: "center",
    alignItems: "center",
  },
  cardOver: {
    ...StyleSheet.absoluteFillObject,
  },
  cardContent: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: ps(1),
  },
  cardTitle: {
    color: "#fff",
    fontSize: ps(1.15),
    fontWeight: "700",
  },
  cardSubtitle: {
    color: "rgba(255,255,255,0.6)",
    fontSize: ps(0.85),
    marginTop: 2,
  },
  focusBorder: {
    ...StyleSheet.absoluteFillObject,
    padding: pw(0.4),
    borderWidth: 0,
    backgroundColor: "transparent",
  },
  borderFill: {
    ...StyleSheet.absoluteFillObject,
    opacity: 1,
    borderRadius: pw(1.2),
    borderWidth: 3,
    borderColor: "transparent",
  },

  // ── Play Modal ── (identical to vod.tsx)
  modalContainer: { backgroundColor: "#111", width: isTV ? ps(65) : "92%", borderRadius: 24, padding: ps(.8), borderWidth: 1, borderColor: "rgba(255,255,255,0.05)", overflow: "hidden" },
  modalTVContent: { flexDirection: "row" },
  modalLeft: { flex: 1.4, padding: ps(1.5) },
  modalRight: { flex: 0.6, padding: ps(2), paddingRight: isTV ? ps(4) : ps(2), justifyContent: "center", gap: 12 },
  modalTitle: { color: "#fff", fontSize: ps(1.9), fontWeight: "900", marginBottom: 12 },
  modalDescription: { color: "rgba(255,255,255,0.5)", fontSize: ps(1.2), lineHeight: ps(1.4), marginBottom: 18 },
  modalMetaRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  modalBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.05)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  modalBadgeText: { color: "#fff", fontSize: ps(0.85), fontWeight: "700" },
  modalBtnWrapper: { borderRadius: 8, overflow: "visible", width: "100%", maxWidth: 380, alignSelf: "flex-end" },
  modalBtnBorder: { padding: 1, borderRadius: 8 },
  modalBtnBorderFocused: {
    padding: 1,
    shadowColor: "#fff",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 16,
    elevation: 14,
  },
  modalBtnPrimaryInner: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: "transparent" },
  modalBtnSecondaryInner: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.3)" },
  modalBtnPrimaryText: { color: "#fff", fontSize: ps(0.95), fontWeight: "900", letterSpacing: 1 },
  modalBtnSecondaryText: { color: "rgba(255,255,255,0.85)", fontSize: ps(0.9), fontWeight: "700", letterSpacing: 0.5 },
});