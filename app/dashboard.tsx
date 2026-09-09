import { DynamicIcon } from '../src/components/DynamicIcon';
import React, { useEffect, useState, useCallback } from "react";
import { View, ScrollView, StyleSheet, Image, Platform, ActivityIndicator, useWindowDimensions } from 'react-native';
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePortalStore } from "../src/store/portalStore";
import { portalApi } from "../src/services/portalApi";
import { XtreamApi } from "../src/services/xtreamApi";
import { M3UApi } from "../src/services/m3uApi";
import { launchExternalPlayer } from "../src/utils/externalPlayer";
import LoadingOverlay from "../src/components/LoadingOverlay";
import { Focusable, Overlay, useInitialFocusPulse } from "../src/tv";
import { useDialog } from "../src/components/ConfirmDialog";
import { useNetworkActivity } from "../src/services/networkActivity";
import { CinematicBackground } from "../src/components/CinematicBackground";
import { safeNavigate } from "../src/services/safeNavigation";
import { isTablet, isPhone } from "../src/utils/tabletUtils";
// This screen is sized against the un-bumped scale — see psRaw in tokens.ts.
import { THEME, pw, ph, psRaw as ps, CARD_FRAME, CARD_FRAME_INNER_RADIUS, TILE_FRAME, TILE_FRAME_FOCUSED } from "../src/theme/tokens";
import { Calendar, ExternalLink, Film, Layers, LayoutGrid, LucideIcon, Play, RefreshCw, Search, Settings, Star, Tv, X } from 'lucide-react-native';
import { Text } from '../src/components/Text';


const RAIL_H_PAD = pw(5);

// ─── Components ───────────────────────────────────────────────────────────────

const HeroPill = ({
  icon,
  text,
  onPress,
  autoFocus = false,
  isPortrait = false,
}: {
  icon: string;
  text: string;
  onPress: () => void;
  autoFocus?: boolean;
  isPortrait?: boolean;
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

  const pillIconSize = !Platform.isTV ? (isPortrait ? 15 : 16) : ps(2.2);

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
          focused && { transform: [{ scale: 1.06 }] }
        ]}>
          <View
            style={[
              S.heroPillGradient,
              !Platform.isTV && {
                paddingHorizontal: isPortrait ? 14 : (isTablet ? 18 : 14),
                paddingVertical: isPortrait ? 9 : (isTablet ? 10 : 9),
              },
              !focused && { backgroundColor: "#17181c" },
              focused && { backgroundColor: "#fff" }
            ]}
          >
            <DynamicIcon
              name={icon}
              size={pillIconSize}
              color={focused ? "#000" : "#fff"}
              style={{ marginRight: !Platform.isTV ? 8 : pw(1.0) }}
            />
            <Text style={[
              S.heroPillText,
              !Platform.isTV && {
                fontSize: isPortrait ? 13 : (isTablet ? 13 : 12),
              },
              focused && { color: "#000" }
            ]}>
              {text}
            </Text>
          </View>
        </View>
      )}
    </Focusable>
  );
};

export default function DashboardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isPortrait = !Platform.isTV && windowHeight > windowWidth;
  const hPad = !Platform.isTV ? (isPortrait ? 20 : (isTablet ? 32 : 24)) : RAIL_H_PAD;
  const actionBtnSize = !Platform.isTV ? (isPortrait ? 50 : (isTablet ? 54 : 50)) : pw(4.6);
  const actionIconSize = !Platform.isTV ? (isPortrait ? 22 : (isTablet ? 24 : 22)) : ps(2.3);

  // Portrait card height: tall enough to look cinematic, capped so 3 fit comfortably.
  // ScrollView handles any overflow on unusually small screens.
  const portraitCardHeight = isPortrait
    ? Math.max(180, Math.min(290, Math.floor((windowHeight - insets.top - insets.bottom - 290) / 3)))
    : undefined;
  // Errors surface through an in-tree overlay — Alert.alert does not
  // reliably appear on an Android TV release build.
  const { notify, node: dialogNode } = useDialog();
  // Selectors, not whole-store destructuring — the dashboard stays mounted
  // behind pushed screens and was re-rendering on every content write.
  const activePortal = usePortalStore((s) => s.activePortal);
  const loadFavorites = usePortalStore((s) => s.loadFavorites);

  const [isLoading, setIsLoading] = useState(false);

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
      <View style={[
        S.headerBranding,
        { paddingHorizontal: hPad },
        isPortrait ? { marginTop: 6, marginBottom: 18 } : (!Platform.isTV && { marginTop: 4, marginBottom: 10 })
      ]}>
        <View style={S.logoRow}>
          <Image
            source={require("../assets/images/TV.png")}
            style={[
              S.headerLogoImage,
              !Platform.isTV && {
                // Prominent logo — large layout box + scale for visual weight
                width: isPortrait ? 140 : (isTablet ? 155 : 135),
                height: isPortrait ? 50 : 50,
                marginLeft: isPortrait ? -6 : -6,
                transform: [{ scale: isPortrait ? 2.0 : 2.1 }],
              }
            ]}
            resizeMode="contain"
          />
        </View>
        <View style={[S.headerActions, !Platform.isTV && { gap: 10 }]}>
          {/* Doubles as the sync indicator. A background refresh must not raise
              the blocking LoadingOverlay — that is reserved for a refresh the
              user asked for — so in-flight traffic surfaces here instead. */}
          <Focusable
            ringOnFocus={false}
            focusStyle={S.roundBtnFocused}
            onPress={handleFullRefresh}
            style={[
              S.roundBtn,
              !Platform.isTV && { width: actionBtnSize, height: actionBtnSize, borderRadius: actionBtnSize / 2 }
            ]}
          >
            {(focused) => syncing ? (
              <ActivityIndicator size="small" color={focused ? "#000" : "#fff"} />
            ) : (
              <RefreshCw size={actionIconSize} color={focused ? "#000" : "#fff"} />
            )}
          </Focusable>
          <Focusable
            ringOnFocus={false}
            focusStyle={S.roundBtnFocused}
            onPress={() => safeNavigate("/portals")}
            style={[
              S.roundBtn,
              !Platform.isTV && { width: actionBtnSize, height: actionBtnSize, borderRadius: actionBtnSize / 2 }
            ]}
          >
            {(focused) => <LayoutGrid size={actionIconSize} color={focused ? "#000" : "#fff"} />}
          </Focusable>
          <Focusable
            ringOnFocus={false}
            focusStyle={S.roundBtnFocused}
            onPress={() => safeNavigate("/settings")}
            style={[
              S.roundBtn,
              !Platform.isTV && { width: actionBtnSize, height: actionBtnSize, borderRadius: actionBtnSize / 2 }
            ]}
          >
            {(focused) => <Settings size={actionIconSize} color={focused ? "#000" : "#fff"} />}
          </Focusable>
        </View>
      </View>

      {/* Cinematic Hero Section */}
      <View style={[
        S.heroSection,
        { paddingHorizontal: hPad },
        isPortrait ? {
          flex: 0,
          flexGrow: 0,
          maxWidth: "100%",
          marginTop: 10,
          marginBottom: 20,
        } : (!Platform.isTV && {
          flex: 0,
          flexGrow: 0,
          maxWidth: "100%",
          marginTop: 6,
          marginBottom: 18,
        })
      ]}>
        <LinearGradient
          colors={["rgba(8, 8, 12, 0.75)", "rgba(8, 8, 12, 0.35)", "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={S.heroGradientOverlay}
        />
        {isPortrait && <Text style={[
          S.heroTitle,
          !Platform.isTV && {
            // Keep the title compact — the TV_SCALE=1.3 bump already made ps(3.2) ≈ 44dp
            // on tablet, which overpowers the rest of the layout on a handheld screen.
            fontSize: isPortrait ? 18 : (isTablet ? 18 : 20),
            marginVertical: isPortrait ? 6 : 6,
          }
        ]}>
          Unlimited Entertainment
        </Text>}
        <Text
          numberOfLines={isPortrait ? 1 : 3}
          style={[
            S.heroDesc,
            !Platform.isTV && {
              fontSize: isPortrait ? 12 : 13,
              lineHeight: isPortrait ? 15 : 19,
              marginBottom: isPortrait ? 18 : 14,
              maxWidth: isPortrait ? "100%" : (isTablet ? 560 : 480),
            }
          ]}
        >
          Access thousands of channels, global movies and exclusive series directly on your screen.
        </Text>
        <View style={[S.heroButtons, !Platform.isTV && { gap: isPortrait ? 10 : 12 }]}>
          {/* Initial focus belongs to the Live TV tile below, not here. */}
          <HeroPill icon="search" text="Search Content" onPress={() => safeNavigate("/search")} isPortrait={isPortrait} />
          {/* The guide lives here rather than behind a button in the Live TV
              header. It is a place you go, like Search — not a control on the
              channel grid — and from the remote it is still one GUIDE press
              away from anywhere. */}
          <HeroPill icon="calendar" text="TV Guide" onPress={() => safeNavigate("/epg")} isPortrait={isPortrait} />
        </View>
      </View>

      {/* Browse Category Cards */}
      <View style={[
        S.browseSection,
        { paddingHorizontal: hPad },
        isPortrait ? {
          flex: 0,
          flexGrow: 0,
          marginBottom: 16,
        } : (!Platform.isTV && {
          flex: 1,
          marginBottom: insets.bottom + (isTablet ? 16 : 12),
        })
      ]}>
        <View style={[
          S.browseContainer,
          isPortrait ? { flexDirection: "column", gap: 12 } : (!Platform.isTV && { gap: 16 })
        ]}>
          {(
            [
              // Bundled rather than fetched: these three are the first thing on
              // screen, and a cold TV start used to show empty cards until the
              // remote images arrived.
              { id: "cat-live", title: "Live TV", icon: "tv", img: require("../assets/images/livetv.png"), route: "/live-tv" },
              { id: "cat-movies", title: "Movies", icon: "film", img: require("../assets/images/movies.png"), route: "/vod" },
              { id: "cat-series", title: "Series", icon: "layers", img: require("../assets/images/series.png"), route: "/series" },
            ]
          ).map((cat) => (
            <Focusable
              key={cat.id}
              // Live TV is where most sessions start, so it owns the
              // dashboard's initial focus.
              hasTVPreferredFocus={focusLiveTile && cat.id === "cat-live"}
              onPress={() => safeNavigate(cat.route)}
              ringOnFocus={false}
              // TV: no fixed height — `flex: 1` shares the row's width and
              // the height comes from the parent stretching, so the row fits
              // whatever space is left instead of overflowing the screen.
              style={[
                S.browseCard,
                isPortrait && {
                  flex: 0,
                  height: portraitCardHeight,
                  paddingHorizontal: 0,
                  paddingVertical: 0,
                },
                !isPortrait && !Platform.isTV && {
                  paddingHorizontal: 0,
                  paddingVertical: 0,
                }
              ]}
            >
              {(focused) => (
                <View
                  style={[
                    S.cardBorder,
                    !Platform.isTV && { borderRadius: 16 },
                    focused && S.cardBorderFocused,
                    focused && { transform: [{ scale: 1.03 }] }
                  ]}
                >
                  <View style={[
                    S.browseCardInner,
                    !Platform.isTV && { borderRadius: 16 }
                  ]}>
                    <Image source={cat.img} resizeMode="cover" style={{ width: "100%", height: "100%", flex: 1, backgroundColor: '#0000' }} />

                    {/* Dark gradient overlay to soften poster collage and ensure maximum legibility */}
                    <LinearGradient
                      colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.35)", "rgba(8,8,12,0.92)"]}
                      locations={[0, 0.45, 1]}
                      style={StyleSheet.absoluteFillObject}
                    />

                    {/* Text container sitting on top at the bottom with NO icon background */}
                    <View style={[
                      S.browseCardContent,
                      !Platform.isTV && {
                        padding: isPortrait ? 14 : 16,
                        paddingBottom: isPortrait ? 14 : 16,
                        gap: 8,
                      }
                    ]}>
                      <DynamicIcon name={cat.icon}
                        size={!Platform.isTV ? (isPortrait ? 20 : (isTablet ? 22 : 20)) : ps(2.2)}
                        color={focused ? "#FFFFFF" : "rgba(255,255,255,0.75)"}
                      />
                      <Text style={[
                        S.browseCardTitle,
                        !Platform.isTV && {
                          fontSize: isPortrait ? 16 : (isTablet ? 18 : 16),
                        },
                        focused && S.browseCardTitleFocused
                      ]}>
                        {cat.title}
                      </Text>
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
        {/* Pure Black Screensaver & Background */}
        <View style={S.backgroundArea}>
          <CinematicBackground />
        </View>

        {isLoading && <LoadingOverlay message="Refreshing your library..." />}

        {isPortrait ? (
          <ScrollView
            style={S.body}
            contentContainerStyle={[
              S.scrollContent,
              {
                paddingTop: Math.max(insets.top, 14),
                paddingBottom: insets.bottom + 20,
              }
            ]}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {dashboardContent}
          </ScrollView>
        ) : (
          <View
            style={[
              S.body,
              {
                paddingTop: insets.top + (!Platform.isTV ? (isTablet ? 12 : 8) : ph(2)),
                paddingBottom: insets.bottom + (!Platform.isTV ? (isTablet ? 12 : 8) : 10),
              }
            ]}
          >
            {dashboardContent}
          </View>
        )}
      </View>

      {/* ── Play Modal ────────────────────────────────────────────────────── */}
      <Overlay
        visible={playModalVisible}
        onClose={() => setPlayModalVisible(false)}
        contentStyle={S.modalContainer}
      >
        <View style={[S.modalTVContent, { padding: ps(3) }]}>
          <View style={S.modalLeft}>
            <Text style={S.modalTitle} numberOfLines={2}>{selectedItem?.name}</Text>
            <Text style={S.modalDescription} numberOfLines={8}>
              {selectedItem?.description || "No description available for this content."}
            </Text>
            <View style={S.modalMetaRow}>
              {selectedItem?.rating ? (
                <View style={S.modalBadge}>
                  <Star size={ps(1)} color="#FFD700" />
                  <Text style={S.modalBadgeText}>{selectedItem.rating}</Text>
                </View>
              ) : null}
              {selectedItem?.subtitle ? (
                <View style={S.modalBadge}>
                  <Calendar size={ps(1)} color="#fff" />
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
                <View style={[S.modalBtnPill, focused && S.modalBtnPillFocused]}>
                  <Play size={ps(1.15)} color={focused ? "#000000" : "#FFFFFF"} />
                  <Text style={[S.modalBtnText, focused && S.modalBtnTextFocused]}>WATCH NOW</Text>
                </View>
              )}
            </Focusable>
            <Focusable
              ringOnFocus={false}
              onPress={() => handleVodAction(true)}
              style={S.modalBtnWrapper}
            >
              {(focused) => (
                <View style={[S.modalBtnPill, focused && S.modalBtnPillFocused]}>
                  <ExternalLink size={ps(1.15)} color={focused ? "#000000" : "#FFFFFF"} />
                  <Text style={[S.modalBtnText, focused && S.modalBtnTextFocused]}>EXTERNAL PLAYER</Text>
                </View>
              )}
            </Focusable>
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
    backgroundColor: "#000000",
  },
  /** TV: the non-scrolling column. On mobile portrait it becomes the ScrollView container. */
  body: {
    flex: 1,
  },
  /** Flex column used as ScrollView contentContainerStyle in portrait. */
  scrollContent: {
    flexGrow: 1,
    flexDirection: "column",
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
    // paddingHorizontal is applied dynamically in render (hPad) to respond to orientation
    marginBottom: ph(1.8),
    marginTop: ph(1.5),
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
    width: pw(22),
    height: ph(7.2),
    transform: [{ scale: 2.1 }],
    marginLeft: -pw(4.2),
  },
  headerActions: {
    flexDirection: "row",
    gap: pw(1.4),
    alignItems: "center",
  },
  roundBtn: {
    width: pw(4.6),
    height: pw(4.6),
    borderRadius: pw(2.3),
    backgroundColor: "#17181c",
    borderWidth: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  roundBtnFocused: {
    backgroundColor: "#F5F5F5",
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
    // paddingHorizontal is applied dynamically in render (hPad)
    maxWidth: pw(72),
    position: "relative",
    flex: 1,
    justifyContent: "center",
    marginBottom: ph(1.5),
  },
  heroGradientOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: ps(2),
    zIndex: -1,
  },
  heroTitle: {
    fontSize: ps(3.2),
    color: "#FFFFFF",
    fontWeight: "600",
    letterSpacing: 0.4,
    marginVertical: ph(1.5),
    textShadowColor: "rgba(0, 0, 0, 0.75)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  heroDesc: {
    fontSize: ps(1.3),
    color: "#A2A7BD",
    lineHeight: ph(2.8),
    marginBottom: ph(3.5),
    maxWidth: pw(58),
  },
  heroButtons: {
    flexDirection: "row",
    gap: pw(1.5),
  },
  heroPillWrapper: {
    borderRadius: 100,
    overflow: "hidden",
  },
  heroPillContainer: {
    borderRadius: 100,
    borderWidth: 0,
    overflow: "hidden",
  },
  heroPillContainerFocused: {
    borderWidth: 1,
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
    paddingHorizontal: pw(2.8),
    paddingVertical: ph(1.5),
    borderRadius: 100,
    overflow: "hidden",
  },
  heroPillText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: ps(1.4),
    letterSpacing: 0.5,
  },

  // Browse Section ──
  browseSection: {
    // paddingHorizontal is applied dynamically in render (hPad)
    flex: 1.6,
    marginBottom: ph(3.5),
  },
  browseContainer: {
    flexDirection: "row",
    gap: pw(2.6),
    flex: 1,
  },
  browseCard: {
    flex: 1,
    paddingHorizontal: pw(0.3),
    paddingVertical: pw(0.8),
    overflow: "visible",
  },
  cardBorder: {
    flex: 1,
    borderRadius: CARD_FRAME.borderRadius,
    borderWidth: 1,
    borderColor: "transparent",
    overflow: "hidden",
  },
  cardBorderFocused: {
    borderColor: "#FFFFFF",
  },
  browseCardInner: {
    flex: 1,
    backgroundColor: "#000000",
    borderRadius: CARD_FRAME.borderRadius,
    overflow: "hidden",
  },
  browseCardContent: {
    position: "absolute",
    bottom: 0,
    width: "100%",
    left: 0,
    right: 0,
    padding: ps(1.6),
    paddingBottom: ps(1.8),
    borderBottomLeftRadius: ps(1.1),
    borderBottomRightRadius: ps(1.1),
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    gap: pw(0.8),
  },
  browseCardTitle: {
    color: "#D8DCE8",
    fontSize: ps(1.8),
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  browseCardTitleFocused: {
    color: "#FFFFFF",
    fontWeight: "800",
  },

  // ── Play Modal ──
  modalContainer: { backgroundColor: "#111", width: ps(65), borderRadius: 24, padding: ps(.8), borderWidth: 1, borderColor: "rgba(255,255,255,0.05)", overflow: "hidden" },
  modalTVContent: { flexDirection: "row" },
  modalLeft: { flex: 1.4, padding: ps(1.5) },
  modalRight: { flex: 0.6, padding: ps(2), paddingRight: ps(4), justifyContent: "center", gap: 12 },
  modalTitle: { color: "#fff", fontSize: ps(1.9), fontWeight: "900", marginBottom: 12 },
  modalDescription: { color: "rgba(255,255,255,0.5)", fontSize: ps(1.2), lineHeight: ps(1.4), marginBottom: 18 },
  modalMetaRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  modalBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.05)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  modalBadgeText: { color: "#fff", fontSize: ps(0.85), fontWeight: "700" },
  modalBtnWrapper: { borderRadius: 10, overflow: "visible", width: "100%", maxWidth: 380, alignSelf: "flex-end" },
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