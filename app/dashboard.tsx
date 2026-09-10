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
import { isPhone, PHONE_H_PAD } from "../src/utils/phoneUtils";
import { isTablet, TABLET_PANEL_SCALE as TPS } from "../src/utils/tabletUtils";

/*
 * Every `isTablet ? N : M` below used to end at a flat N, all of them picked
 * on an 853x533 panel. `ps()` will not rescale them — the tablet type scale is
 * panel-independent by design — so on a 1506x941 they were the same physical
 * size on a screen three times the area, which is the whole of what "too small
 * on a large tablet" means here. `tps` is 1 on the 853, so every one of those
 * numbers is preserved exactly where it was chosen.
 */
const tps = (n: number) => Math.round(n * TPS);

/*
 * Vertical chrome above the browse row, interpolated across the tablet range
 * instead of fixed.
 *
 * The browse cards are `flex: 1` in landscape — they get whatever height the
 * header and hero leave them. Those margins were flat dp, so they cost the
 * same 300-odd dp on every tablet: 58% of an 853x533 panel and 43% of a
 * 1506x941 one, which is why the cards look squat on the small tablet and
 * generous on the large one for identical code.
 *
 * `small` is the 853x533 value and `large` the 1506x941 one, TPS being 1 and
 * 1.45 at those two points. Every `large` below is what the screen renders
 * today, so the big panel does not move; the small one reclaims about 50dp.
 */
const vGap = (small: number, large: number) =>
  Math.round(small + (large - small) * Math.min(1, Math.max(0, (TPS - 1) / 0.45)));
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

  // The phone pill is deliberately under the 44dp touch minimum — compactness
  // was asked for over the guideline, and `Focusable` has no `hitSlop` to keep
  // the tap area while shrinking the paint. Noted so it is a decision, not a
  // drift.
  const pillIconSize = !Platform.isTV ? (isPhone ? 12 : isPortrait ? 15 : isTablet ? tps(18) : 16) : ps(2.2);

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
                paddingHorizontal: isPhone ? 8 : isPortrait ? 14 : (isTablet ? tps(22) : 14),
                paddingVertical: isPhone ? 0 : isPortrait ? 9 : (isTablet ? vGap(10, 20) : 9),
              },
              // Pin the height rather than deriving it from padding plus the
              // line box, so the pill keeps matching the 36dp header circle
              // however the label and icon are sized. `heroPillGradient`
              // already centres its children, so the padding just goes to 0.
              isPhone && { height: 36 },
              !focused && { backgroundColor: "#17181c" },
              focused && { backgroundColor: "#fff" }
            ]}
          >
            <DynamicIcon
              name={icon}
              size={pillIconSize}
              color={focused ? "#000" : "#fff"}
              style={{ marginRight: isPhone ? 5 : !Platform.isTV ? 8 : pw(1.0) }}
            />
            <Text style={[
              S.heroPillText,
              !Platform.isTV && {
                fontSize: isPhone ? 10 : isPortrait ? 13 : (isTablet ? tps(15) : 12),
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
  // `hPad` is the dashboard's side margin — the header, the hero and the browse
  // section all take it, so this is the one number that sets the page gutter.
  const hPad = !Platform.isTV ? (isPhone ? 14 : isPortrait ? 20 : (isTablet ? tps(32) : 24)) : RAIL_H_PAD;
  // The phone tier is its own branch rather than a smaller `isPortrait` value,
  // because a tablet held upright takes `isPortrait` too and its header has the
  // width to keep the larger control.
  //
  // 36 to match the hero pill, which pins the same 36 explicitly — the two
  // control families read as one size on a phone. 28 was tried first and read
  // as too small. If this moves, move the pill's pinned `height` with it.
  //
  // Still under the 44dp touch minimum, deliberately: compactness was chosen
  // over the guideline, and `Focusable` exposes no `hitSlop`, so the tap area
  // shrinks with the paint. Recorded so it stays a decision rather than drift.
  const actionBtnSize = !Platform.isTV ? (isPhone ? 36 : isPortrait ? 50 : (isTablet ? tps(54) : 50)) : pw(4.6);
  const actionIconSize = !Platform.isTV ? (isPhone ? 17 : isPortrait ? 22 : (isTablet ? tps(24) : 22)) : ps(2.3);

  // Portrait card height: tall enough to look cinematic, capped so 3 fit comfortably.
  // ScrollView handles any overflow on unusually small screens.
  //
  // Lifted out of the clamp because the phone and the tablet now want different
  // bands from the same measurement, and repeating the expression is how the
  // two would drift.
  const portraitCardSpace = Math.floor(
    (windowHeight - insets.top - insets.bottom - 290) / 3
  );
  // The phone band is lower at both ends. On a ~873dp-tall handset the
  // measurement lands around 174, so the old floor of 180 was what the card
  // actually took — the clamp, not the space, was setting the height. A 150
  // ceiling is the reduction; the 120 floor keeps a small handset from
  // collapsing the artwork to a strip.
  const portraitCardHeight = isPortrait
    ? isPhone
      ? Math.max(185, Math.min(290, portraitCardSpace))
      : Math.max(180, Math.min(290, portraitCardSpace))
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
        isPortrait
          ? { marginTop: isPhone ? 0 : 6, marginBottom: isPhone ? 4 : 18 }
          : (!Platform.isTV && { marginTop: 4, marginBottom: isTablet ? vGap(6, 10) : 10 })
      ]}>
        <View style={S.logoRow}>
          <Image
            source={require("../assets/images/TV.png")}
            style={[
              S.headerLogoImage,
              /*
               * A 3:2 box at scale 1, so the box is what actually renders.
               *
               * This was a 155x50 box (140x50 in portrait) at scale 2.1.
               * `resizeMode="contain"` fits the 3:2 asset inside the box
               * *before* the transform, so 155x50 was height-limited to 75x50
               * and the scale blew that up to 158x105 — while the row still
               * reserved only the 50dp box. The mark overlapped whatever sat
               * beneath it, by 55dp. Same trap as the phone block below and as
               * the portals and add-portal headers.
               *
               * 150x100 keeps the size it was visually rendering at; the
               * difference is that the layout now knows about it.
               */
              !Platform.isTV && {
                // 3:2 like the asset, so `contain` fills the box exactly and
                // these stay the rendered numbers — scaling them together is
                // what keeps that true.
                width: tps(150),
                height: tps(100),
                marginLeft: 0,
                transform: [{ scale: 1 }],
              },
              /*
               * The phone logo is sized so that the layout box and the rendered
               * image are the same thing.
               *
               * TV.png is 3:2, and `resizeMode="contain"` fits it inside the
               * box before the transform applies — so a 140x50 box rendered the
               * mark at 75x50 (height-limited), and `scale: 2.0` then blew that
               * up to **150x100 visual** while the row still reserved only 50dp
               * of height. The logo overflowed its own row, which is what read
               * as "too big" far more than the width did.
               *
               * A 100x66 box is 3:2 already, so `contain` fills it exactly and
               * `scale: 1` leaves layout and paint in agreement — nothing
               * overflows and the mark is a third smaller. `marginLeft` goes to
               * 0 with it; the -6 existed to claw back space the oversized
               * scale was stealing.
               */
              isPhone && {
                // 120x80 is 3:2, the asset's own ratio, so `contain` fills the
                // box and these stay the rendered numbers.
                width: 120,
                height: 80,
                marginLeft: 0,
                transform: [{ scale: 1 }],
              },
            ]}
            resizeMode="contain"
          />
        </View>
        <View style={[S.headerActions, !Platform.isTV && { gap: isPhone ? 8 : 10 }]}>
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
          marginTop: isPhone ? 0 : 10,
          marginBottom: isPhone ? 10 : 20,
        } : (!Platform.isTV && {
          flex: 0,
          flexGrow: 0,
          maxWidth: "100%",
          marginTop: isTablet ? vGap(2, 6) : 6,
          marginBottom: isTablet ? vGap(10, 18) : 18,
        })
      ]}>
        {/*
          * No hero card on a phone.
          *
          * This gradient is the hero's container — `absoluteFillObject` behind
          * the copy and the pills, rounded, at `zIndex: -1`. On a handset it
          * reads as a boxed panel inset from a background that is already
          * cinematic, so the hero is drawn straight onto `CinematicBackground`
          * instead. `heroSection` keeps `hPad`, so the copy still lines up with
          * the browse tiles below rather than floating loose.
          */}
        {!isPhone && (
          <LinearGradient
            colors={["rgba(8, 8, 12, 0.75)", "rgba(8, 8, 12, 0.35)", "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={S.heroGradientOverlay}
          />
        )}
       <Text style={[
          S.heroTitle,
          !Platform.isTV && {
            // Keep the title compact — the TV_SCALE=1.3 bump already made ps(3.2) ≈ 44dp
            // on tablet, which overpowers the rest of the layout on a handheld screen.
            // These `!Platform.isTV` overrides were written for handsets and
            // then applied to every non-TV device, so a 1506dp tablet was
            // reading the same 20dp title as a 393dp phone. The tablet gets its
            // own step now.
            fontSize: isPhone ? 15 : isPortrait ? 18 : (isTablet ? tps(28) : 20),
            marginVertical: isPhone ? 0 : isTablet && !isPortrait ? vGap(2, 6) : 6,
          }
        ]}>
          Unlimited Entertainment
        </Text>
        <Text
          numberOfLines={isPortrait ? 1 : 3}
          style={[
            S.heroDesc,
            !Platform.isTV && {
              fontSize: isPhone ? 11 : isPortrait ? 12 : (isTablet ? tps(15) : 13),
              lineHeight: isPhone ? 14 : isPortrait ? 15 : (isTablet ? tps(22) : 19),
              marginBottom: isPhone ? 10 : isPortrait ? 18 : (isTablet ? vGap(10, 26) : 14),
              // A measure, not a width: 560 was chosen against a 1280 panel and
              // is a short line on a 1506 one.
              maxWidth: isPortrait ? "100%" : (isTablet ? tps(680) : 480),
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
          marginBottom: isPhone ? 0 : 16,
        } : (!Platform.isTV && {
          flex: 1,
          // No `insets.bottom` here: the body this sits inside already pads by
          // it (see the landscape branch below). Adding it again reserved the
          // safe area twice and left a black band across the foot of the
          // screen with the browse cards squeezed to make room — the same
          // double-count the grid screens had.
          marginBottom: isTablet ? vGap(0, 15) : 12,
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
                        size={!Platform.isTV ? (isPortrait ? 20 : (isTablet ? tps(22) : 20)) : ps(2.2)}
                        color={focused ? "#FFFFFF" : "rgba(255,255,255,0.75)"}
                      />
                      <Text style={[
                        S.browseCardTitle,
                        !Platform.isTV && {
                          fontSize: isPortrait ? 16 : (isTablet ? tps(18) : 16),
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
                // Below `insets.bottom` there is already the gesture bar or the
                // nav bar, so this is decoration on top of a gap the system has
                // reserved. On a phone it is 0: the safe-area inset is the whole
                // bottom margin, and this is the floor — anything less would
                // put the last card under the nav bar rather than above it.
                paddingBottom: insets.bottom + (isPhone ? 0 : 20),
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
                paddingTop: insets.top + (!Platform.isTV ? (isTablet ? vGap(8, 12) : 8) : ph(2)),
                paddingBottom: insets.bottom + (!Platform.isTV ? (isTablet ? vGap(8, 12) : 8) : 10),
              }
            ]}
          >
            {dashboardContent}
          </View>
        )}
      </View>

      {/* ── Play Modal ────────────────────────────────────────────────────── */}
      {/*
        * A bottom sheet on a phone, the centred dialog everywhere else — the
        * same shape the vod, series and search sheets use.
        *
        * `modalContainer` is genuinely in use here, unlike in those three where
        * it is dead code, and its `width: ps(65)` is 634dp: a dialog two thirds
        * wider than the 393dp screen it is centred on.
        */}
      <Overlay
        visible={playModalVisible}
        onClose={() => setPlayModalVisible(false)}
        style={isPhone ? { justifyContent: "flex-end", backgroundColor: "transparent" } : undefined}
        contentStyle={isPhone ? S.modalSheet : S.modalContainer}
      >
        <View
          style={[
            S.modalTVContent,
            { padding: ps(3) },
            isPhone && { padding: PHONE_H_PAD, paddingBottom: 10 + insets.bottom },
          ]}
        >
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
            {/* No Close on a phone — the backdrop tap and hardware back both
                dismiss. It stays on TV, where a remote has neither. */}
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
  /**
   * The phone sheet: full width, seated on the bottom edge, top corners only.
   * Same silhouette as the other three sheets; `modalContainer`'s own colours.
   */
  modalSheet: {
    width: "100%",
    maxWidth: "100%",
    margin: 0,
    padding: 0,
    backgroundColor: "#111",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: "rgba(255,255,255,0.05)",
    overflow: "hidden",
  },
  /*
   * Two bands on a phone — details, then actions — since this sheet has no
   * poster to sit beside the title. `width: "100%"` cannot share a wrap line,
   * so the actions break onto their own row. Unwrapped, the 1.4/0.6 split left
   * them ~42dp once their own padding was taken, for "EXTERNAL PLAYER".
   */
  modalTVContent: { flexDirection: "row", flexWrap: isPhone ? "wrap" : "nowrap" },
  modalLeft: { flex: 1.4, padding: isPhone ? 0 : ps(1.5), width: isPhone ? "100%" : undefined },
  modalRight: {
    flex: isPhone ? 0 : 0.6,
    width: isPhone ? "100%" : undefined,
    padding: isPhone ? 0 : ps(2),
    paddingRight: isPhone ? 0 : ps(4),
    marginTop: isPhone ? 24 : 0,
    justifyContent: "center",
    gap: isPhone ? 10 : 12,
  },
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