import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Dimensions,
  Animated,
  Platform,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePortalStore, Portal } from "../src/store/portalStore";
import { portalApi } from "../src/services/portalApi";
import { M3UApi } from "../src/services/m3uApi";
import { XtreamApi } from "../src/services/xtreamApi";
import LoadingOverlay from "../src/components/LoadingOverlay";
import { CinematicBackground } from "../src/components/CinematicBackground";
import { isTV } from "../src/utils/tvUtils";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { Focusable } from "../src/tv";
import { useDialog } from "../src/components/ConfirmDialog";
// This screen is sized against the un-bumped scale — see psRaw in tokens.ts.
import { THEME, pw, ph, psRaw as ps, CARD_FRAME } from "../src/theme/tokens";

const { width: W } = Dimensions.get("window");

// ─── Carousel geometry (all percentage-based) ────────────────────────────────
const CARD_WIDTH = isTV ? pw(28) : pw(85);
const CARD_MARGIN = pw(1.5);
const ITEM_SIZE = CARD_WIDTH + CARD_MARGIN * 2;
const SPACER_WIDTH = (W - ITEM_SIZE) / 2;

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function PortalsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Selectors — see the note in live-tv.tsx. This screen is often mounted while
  // a background refresh is writing content it does not display.
  const portals = usePortalStore((s) => s.portals);
  const activePortal = usePortalStore((s) => s.activePortal);
  const loadPortals = usePortalStore((s) => s.loadPortals);
  const setActivePortal = usePortalStore((s) => s.setActivePortal);
  const updatePortal = usePortalStore((s) => s.updatePortal);
  const deletePortal = usePortalStore((s) => s.deletePortal);

  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [focusedPortalId, setFocusedPortalId] = useState<string | null>(null);
  const [focusedHeader, setFocusedHeader] = useState<"back" | "add" | null>(null);

  // `Alert.alert` is not usable on Android TV release builds — the delete
  // confirmation never surfaced, so the D-pad could not reach its buttons.
  const { open: openDialog, notify, close: closeDialog, node: dialogNode } = useDialog();

  const scrollX = useRef(new Animated.Value(0)).current;
  const flatListRef = useRef<any>(null);

  const focusedPortalIdRef = useRef<string | null>(null);
  const focusedHeaderRef = useRef<"back" | "add" | null>(null);

  // Temporary state to ensure TV preferred focus only happens on initial mount
  const [shouldAutoTargetFirstPortal, setShouldAutoTargetFirstPortal] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setShouldAutoTargetFirstPortal(false), 500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => { focusedPortalIdRef.current = focusedPortalId; }, [focusedPortalId]);
  useEffect(() => { focusedHeaderRef.current = focusedHeader; }, [focusedHeader]);
  useEffect(() => { loadPortals(); }, []);

  // ── Connect ────────────────────────────────────────────────────────────────
  const connectToPortal = async (portal: Portal) => {
    if (activePortal?.id === portal.id) { router.replace("/dashboard"); return; }

    setIsLoading(true);
    setLoadingMessage("Connecting...");
    try {
      if (portal.type === "m3u") {
        const api = new M3UApi({ url: portal.config.url });
        const result = await api.login();
        if (!result.ok) throw new Error(result.error);
        await setActivePortal(portal);
        router.replace("/dashboard");
        return;
      }
      if (portal.type === "xtream") {
        const api = new XtreamApi({
          url: portal.config.url,
          username: portal.config.username!,
          password: portal.config.password!,
        });
        await api.login();
        await setActivePortal(portal);
        router.replace("/dashboard");
        return;
      }
      const { token, serverInfo } = await portalApi.authenticate(portal);
      await updatePortal(portal.id, { config: { ...portal.config, token, serverInfo } });
      await setActivePortal({ ...portal, config: { ...portal.config, token, serverInfo } });
      router.replace("/dashboard");
    } catch (e: any) {
      notify("Connection Failed", e?.message || "Unable to connect to this portal.", "danger");
    } finally {
      setIsLoading(false);
    }
  };

  // OK/select is handled natively by each focusable's onPress — no global
  // listener needed (and a global one would double-fire on Android TV).

  // ── Helpers ────────────────────────────────────────────────────────────────
  const handleDeletePortal = useCallback(
    (portal: Portal) => {
      openDialog({
        id: `delete-portal:${portal.id}`,
        tone: "danger",
        icon: "trash-outline",
        title: "Delete Portal",
        message: `"${portal.name}" will be removed from this device. This cannot be undone.`,
        confirmLabel: "Delete",
        onConfirm: async () => {
          await deletePortal(portal.id);
          closeDialog();
        },
      });
    },
    [deletePortal, openDialog, closeDialog]
  );

  const getPortalTypeInfo = (type: string) => {
    switch (type) {
      case "m3u": return { icon: "play-circle-outline", color: "#10b981" };
      case "xtream": return { icon: "cloud-download-outline", color: "#3b82f6" };
      case "mag": return { icon: "tv-outline", color: "#f59e0b" };
      default: return { icon: "server-outline", color: THEME.colors.primary };
    }
  };

  // ── Card ───────────────────────────────────────────────────────────────────
  const renderCardContent = (item: Portal, isActive: boolean) => {
    const config = item.config || {};
    const detail = (config as any).url || (config as any).mac || "--";

    return (
      <>
        <View style={S.cardHeader}>
          <View style={[S.cardIconBox, { backgroundColor: isActive ? THEME.colors.primary + '20' : "rgba(255,255,255,0.03)" }]}>
            <Ionicons
              name={getPortalTypeInfo(item.type).icon as any}
              size={ps(3.5)}
              color={isActive ? THEME.colors.primary : "#9ca3af"}
            />
          </View>
          {isActive && (
            <View style={S.activeBadge}>
              <View style={S.badgeDot} />
              <Text style={S.activeBadgeText}>ACTIVE</Text>
            </View>
          )}
        </View>

        <View style={S.cardMain}>
          <MaskedView maskElement={<Text style={S.cardName} numberOfLines={1}>{item.name}</Text>}>
            <LinearGradient
              colors={["#fff", "rgba(255,255,255,0.4)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <Text style={[S.cardName, { opacity: 0 }]} numberOfLines={1}>{item.name}</Text>
            </LinearGradient>
          </MaskedView>
          <Text style={S.cardDetailText} numberOfLines={1}>{detail}</Text>
          <Text style={S.cardTypeLabel}>
            {item.type === "m3u"
              ? "M3U PLAYLIST"
              : item.type === "xtream"
                ? "XTREAM CODES API"
                : "MAC PORTAL"}
          </Text>
        </View>
      </>
    );
  };

  const renderPortal = ({ item, index }: { item: Portal; index: number }) => {
    const isFocused = focusedPortalId === item.id;
    const isActive = activePortal?.id === item.id;

    // Disable TV preferred focus after initial mount to prevent stealing focus on re-renders
    const shouldFocus = index === 0 && shouldAutoTargetFirstPortal;

    const inputRange = [(index - 1) * ITEM_SIZE, index * ITEM_SIZE, (index + 1) * ITEM_SIZE];
    const scale = scrollX.interpolate({ inputRange, outputRange: [0.95, 1.05, 0.95], extrapolate: "clamp" });
    const opacity = scrollX.interpolate({ inputRange, outputRange: [0.7, 1, 0.7], extrapolate: "clamp" });

    const useStaticFocus = portals.length <= 3;

    return (
      <Animated.View
        key={item.id}
        style={[
          S.cardWrapper,
          {
            transform: [{ scale: useStaticFocus ? (isFocused ? 1.05 : 1) : (isTV ? scale : isFocused ? 1.05 : 1) }],
            opacity: useStaticFocus ? (isFocused ? 1 : 0.8) : (isTV ? opacity : 1),
            zIndex: isFocused ? 100 : index,
          },
        ]}
      >
        <Focusable
          hasTVPreferredFocus={shouldFocus}
          onFocus={() => {
            setFocusedPortalId(item.id);
            if (isTV) flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
          }}
          onBlur={() => setFocusedPortalId(null)}
          onPress={() => connectToPortal(item)}
          ringOnFocus={false}
          style={S.pressable}
        >
          <View style={[S.portalCard, isFocused && S.portalCardFocused, isActive && S.portalCardActive]}>
            {renderCardContent(item, isActive)}
          </View>
        </Focusable>

        <Focusable
          onPress={() => handleDeletePortal(item)}
          style={{ marginTop: ph(1.5) }}
          ringOnFocus={false}
        >
          {(focusedBtn) => (
            <View style={[
              { height: ph(5.5), backgroundColor: "rgba(255,0,0,0.1)", borderRadius: ps(1), alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,0,0,0.2)" },
              focusedBtn && { borderColor: "#591111", backgroundColor: "rgba(255,0,0,0.2)", transform: [{ scale: 1.02 }] }
            ]}>
              <Text style={{ color: "#ff4444", fontSize: ps(1.2), fontWeight: "bold", letterSpacing: 1 }}>
                DELETE PORTAL
              </Text>
            </View>
          )}
        </Focusable>
      </Animated.View>
    );
  };

  // ── Header ─────────────────────────────────────────────────────────────────
  const renderHeader = () => (
    <View style={S.header}>
      <Image source={require("../assets/images/TV.png")} style={S.headerLogoImage} resizeMode="contain" />

    </View>
  );

  // ── Add Button ─────────────────────────────────────────────────────────────
  const renderAddButton = () => (
    <View style={S.actionArea}>
      <Focusable
        ringOnFocus={false}
        onPress={() => router.push("/add-portal")}
        style={{ borderRadius: ps(1), overflow: "visible" }}
      >
        {(focused) => (
          <View
            style={[
              { borderRadius: ps(1), overflow: "hidden", borderWidth: focused ? 1.5 : 1, borderColor: focused ? "#fff" : "rgba(255,255,255,0.1)" },
              !focused && { backgroundColor: "rgba(255,255,255,0.05)" },
              focused && {
                backgroundColor: "#fff",
                transform: [{ scale: 1.06 }],
                shadowColor: "#fff",
                shadowOpacity: 0.6,
                shadowRadius: 12,
                elevation: 0,
              },
            ]}
          >
            <View style={S.addBtn}>
              <Ionicons name="add" size={ps(1.8)} color={focused ? "#000" : "#fff"} />
              <Text style={[S.addBtnText, focused && { color: "#000" }]}>ADD NEW PORTAL</Text>
            </View>
          </View>
        )}
      </Focusable>
    </View>
  );

  // ── Empty state ────────────────────────────────────────────────────────────
  // Two columns: branding and the call to action on the left, artwork on the
  // right. It owns its own logo, so the shared header is not rendered alongside
  // it — that would put the lockup on screen twice. Phones stack the columns.
  const renderEmptyState = () => (
    <View style={S.introRow}>
      <View style={S.introCopy}>
        {/* favicon.png, not TV.png: the latter is 62% transparent padding, which
            is why the header has to scale it 3x. This one is tightly cropped
            with a near-black background that disappears against the screen. */}
        <Image source={require("../assets/images/TV.png")} style={S.introLogo} resizeMode="cover" />

        <Text style={S.introTitle}>Unlimited Entertainment</Text>
        <Text style={S.introBody}>
          Connect your first streaming source to reach thousands of channels, global movies and exclusive series —
          all on this screen.
        </Text>

        <Focusable
          hasTVPreferredFocus
          ringOnFocus={false}
          onPress={() => router.push("/add-portal")}
          style={S.getStartedWrapper}
        >
          {(focused) => (
            <View
              style={[
                S.addButtonLarge,
                { overflow: "hidden", borderWidth: focused ? 1.5 : 1, borderColor: focused ? "#fff" : "rgba(255,255,255,0.1)" },
                !focused && { backgroundColor: "rgba(255,255,255,0.05)" },
                focused && { backgroundColor: "#fff", transform: [{ scale: 1.06 }], shadowColor: "#fff", shadowOpacity: 0, shadowRadius: 2, elevation: 0 },
              ]}
            >
              <Text style={[S.addButtonText, focused && { color: "#000" }]}>GET STARTED</Text>
            </View>
          )}
        </Focusable>
      </View>

      {/* A fanned stack of the three library artworks, back to front. Order in
          the tree is the paint order, so Live TV is last and sits on top. */}
      <View style={S.introArt}>
        <Image
          source={require("../assets/images/series.png")}
          style={[S.introArtLayer, S.introArtBack]}
          resizeMode="cover"
        />
        <Image
          source={require("../assets/images/movies.png")}
          style={[S.introArtLayer, S.introArtMid]}
          resizeMode="cover"
        />
        <Image
          source={require("../assets/images/livetv.png")}
          style={[S.introArtLayer, S.introArtFront]}
          resizeMode="cover"
        />
      </View>
    </View>
  );

  // ── Root ───────────────────────────────────────────────────────────────────
  if (portals.length === 0) {
    return (
      <View style={S.container}>
        {/* First child, so it layers behind the rest of the screen. */}
        <CinematicBackground />
        {isLoading && <LoadingOverlay message={loadingMessage} />}
        {renderEmptyState()}
        {dialogNode}
      </View>
    );
  }

  return (
    <View style={S.container}>
      {/* First child, so it layers behind the rest of the screen. */}
      <CinematicBackground />

      {isLoading && <LoadingOverlay message={loadingMessage} />}

      {renderHeader()}

      <View style={S.carouselContainer}>
        {portals.length <= 3 ? (
          <View style={S.centeredGrid}>
            {portals.map((item, index) => renderPortal({ item, index }))}
          </View>
        ) : (
          <Animated.FlatList
            ref={flatListRef}
            data={portals}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={ITEM_SIZE}
            decelerationRate="fast"
            contentContainerStyle={[
              S.carouselList,
              { paddingHorizontal: SPACER_WIDTH, flexGrow: 1 }
            ]}
            onScroll={Animated.event(
              [{ nativeEvent: { contentOffset: { x: scrollX } } }],
              { useNativeDriver: true }
            )}
            renderItem={renderPortal}
            keyExtractor={(item) => item.id}
            getItemLayout={(_, index) => ({ length: ITEM_SIZE, offset: ITEM_SIZE * index, index })}
          />
        )}
      </View>
      {portals.length > 0 && renderAddButton()}

      {/* Last in the tree so the overlay layers above the carousel. */}
      {dialogNode}
    </View>
  );
}

// ─── StyleSheet ───────────────────────────────────────────────────────────────
// Rules:
//   • All layout sizes  → pw() / ph() / ps()
//   • borderWidth 1–2   → absolute hairlines
//   • elevation         → absolute Android Z
//   • letterSpacing     → small absolute sub-pixel values
//   • opacity / scale   → unitless ratios
const S = StyleSheet.create({

  // ── Root ──────────────────────────────────────────────────────────────────
  container: {
    flex: 1,
    backgroundColor: "rgba(15, 15, 15, 0.03)",
  },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    alignItems: "center",
    paddingTop: ph(8),
    marginBottom: ph(5),
  },
  brandingText: {
    fontSize: isTV ? ps(2.5) : ps(2.2),
    fontWeight: "500",
    color: "#fff",
    letterSpacing: 5,
    marginBottom: ph(1),
  },
  headerLogoImage: {
    width: pw(50),
    height: ph(8),
    transform: [{ scale: 3 }],
    marginBottom: ph(1),
  },
  headerSubtitle: {
    fontSize: isTV ? ps(1.2) : ps(0.9),
    color: "rgba(255,255,255,0.4)",
    fontWeight: "400",
    letterSpacing: 1.5,
    textAlign: "center",
    marginBottom: ph(0.5),
  },
  headerSubtitleAccent: {
    fontSize: isTV ? ps(1.2) : ps(0.9),
    color: THEME.colors.primary,
    fontWeight: '600',
    letterSpacing: 2,
    textAlign: 'center',
  },
  actionArea: {
    alignItems: "center",
    paddingBottom: ph(10), // Vertical spacing at bottom
  },
  addBtnWrapper: {
    borderRadius: ps(1),
    overflow: "hidden",
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
    paddingHorizontal: pw(2.5),
    paddingVertical: ph(1.5),
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    gap: pw(1),
    borderRadius: ps(1),
  },
  addBtnText: {
    color: "rgba(255,255,255,0.8)",
    fontSize: ps(1.1),
    fontWeight: "500",
    letterSpacing: 2,
  },

  // ── Carousel ──────────────────────────────────────────────────────────────
  carouselContainer: {
    flex: 1,
    paddingVertical: ph(4),
    justifyContent: "center",
  },
  carouselList: {
    alignItems: "center",
  },
  centeredGrid: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
  },
  cardWrapper: {
    width: CARD_WIDTH,
    height: isTV ? ph(46) : ph(51),
    marginHorizontal: CARD_MARGIN,
  },
  pressable: {
    flex: 1,
    borderRadius: ps(1.5),
    overflow: "hidden",
  },
  gradientBorder: {
    flex: 1,
    padding: 1, // Razor-thin border
    borderRadius: ps(1.5),
  },

  // ── Portal card ───────────────────────────────────────────────────────────
  portalCard: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: ps(2),
    padding: ps(1.8),
    justifyContent: "space-between",
  },
  portalCardFocused: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1.5,
    borderColor: "#fff",
    ...Platform.select({
      ios: {
        shadowColor: "#fff",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.6,
        shadowRadius: 15,
      },
      android: {
        elevation: 0,
      }
    })
  },
  portalCardActive: {
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.39)",
    backgroundColor: "rgba(255, 255, 255, 0.12)",
  },

  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardIconBox: {
    width: ps(7),
    height: ps(7),
    borderRadius: ps(2),
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Active badge ──────────────────────────────────────────────────────────
  activeBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
    paddingHorizontal: pw(1.2),
    paddingVertical: ph(0.7),
    borderRadius: pw(5),          // pill
    gap: pw(0.6),
  },
  badgeDot: {
    width: pw(0.6),
    height: pw(0.6),
    borderRadius: pw(0.3),
    backgroundColor: "#70de5b",
  },
  activeBadgeText: {
    color: "#fff",
    fontSize: ps(0.8),
    fontWeight: "600",
    letterSpacing: 1,
  },

  // ── Card body ─────────────────────────────────────────────────────────────
  cardMain: {
    flex: 1.5,
    justifyContent: "center",
  },
  cardName: {
    fontSize: ps(3.2),
    fontWeight: "300",
    color: "#fff",
    marginBottom: ph(0.5),
    letterSpacing: 2,
  },
  cardDetailText: {
    fontSize: ps(1.4),
    color: "rgba(255,255,255,0.3)",
    fontWeight: "300",
    marginBottom: ph(1.5),
    letterSpacing: 1,
  },
  cardTypeLabel: {
    fontSize: ps(1.6),
    color: THEME.colors.primary,
    fontWeight: "500",
    letterSpacing: 4,
  },

  // ── Card actions ──────────────────────────────────────────────────────────
  cardActionsRow: {
    flexDirection: "row",
    gap: pw(1.2),
  },
  exploreBtn: {
    flex: 1,
    height: ph(5.5),
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: ps(0.8),
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.08)",
  },
  exploreBtnFocused: {
    borderColor: THEME.colors.primary,
    backgroundColor: "rgba(255,255,255,0.1)",
    transform: [{ scale: 1.05 }],
  },
  exploreBtnText: {
    color: "#fff",
    fontSize: ps(1.1),
    fontWeight: "700",
    letterSpacing: 1,
  },
  settingsBtn: {
    width: ph(5.5),
    height: ph(5.5),
    borderRadius: ps(0.8),
    backgroundColor: "rgba(255,255,255,0.03)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.05)",
  },

  // ── Empty state ───────────────────────────────────────────────────────────
  // ── Empty state (two-column intro) ────────────────────────────────────────
  introRow: {
    flex: 1,
    flexDirection: isTV ? "row" : "column",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: pw(6),
    paddingVertical: ph(4),
    gap: isTV ? pw(5) : ph(4),
  },
  /** Left column. `flex-start` keeps every line ragged-right against the edge
   *  the artwork does not occupy. */
  introCopy: {
    flex: isTV ? 1 : undefined,
    alignItems: "flex-start",
  },
  /** favicon.png is a tight 3.31:1 crop, so the box is sized to that ratio and
   *  `contain` leaves no dead space around it. */
  introLogo: {
    width: pw(20),
    height: pw(20) / 3.31,
    marginBottom: ph(3),
  },
  introTitle: {
    fontSize: isTV ? ps(3) : ps(2.4),
    color: "#fff",
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  introBody: {
    fontSize: isTV ? ps(1.4) : ps(1.15),
    lineHeight: isTV ? ps(2.2) : ps(1.8),
    color: "rgba(255,255,255,0.5)",
    marginTop: ph(2),
    maxWidth: pw(38),
  },
  getStartedWrapper: {
    borderRadius: ps(1),
    overflow: "visible",
    alignSelf: "flex-start",
    marginTop: ph(5),
  },
  /** Right column: the stage the three artworks are stacked on. No border or
   *  clipping of its own — each layer carries its own frame, and clipping here
   *  would cut the offsets off. */
  introArt: {
    flex: isTV ? 1.1 : undefined,
    width: isTV ? undefined : "100%",
    aspectRatio: 16 / 10,
  },
  /** Every layer is the same size; only the offset and depth differ. 88% × 80%
   *  of a 16:10 stage works out to roughly 16:9, which matches the artwork. */
  introArtLayer: {
    position: "absolute",
    width: "88%",
    height: "80%",
    ...CARD_FRAME,
  },
  /** Depth comes from fading the layers behind rather than from shadows, which
   *  Android will not draw outside a rounded, clipped view anyway. The three
   *  offsets add up to exactly the stage, so nothing spills out of it. */
  introArtBack: {
    top: 0,
    left: "12%",
    opacity: 0.45,
  },
  introArtMid: {
    top: "10%",
    left: "6%",
    opacity: 0.75,
  },
  introArtFront: {
    top: "20%",
    left: 0,
  },
  addButtonLarge: {
    paddingHorizontal: pw(2),
    paddingVertical: ph(1.5),
    alignItems: "center",
    justifyContent: "center",
    borderRadius: ps(1),
  },
  addButtonText: {
    color: "#fff",
    fontSize: ps(1.4),
    fontWeight: "700",
    letterSpacing: 1.5,
  },



});