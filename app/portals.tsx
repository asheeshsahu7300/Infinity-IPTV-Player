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
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
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
import { Focusable, FocusGroup } from "../src/tv";
import { useDialog } from "../src/components/ConfirmDialog";
// Sized against the un-bumped scale — see psRaw in tokens.ts.
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

  const getPortalTypeInfo = (type: string): { icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'] } => {
    switch (type) {
      case "m3u": return { icon: "format-list-bulleted" };
      case "xtream": return { icon: "cloud-sync" };
      case "mag": return { icon: "router-wireless" };
      default: return { icon: "server-network" };
    }
  };

  // ── Card ───────────────────────────────────────────────────────────────────
  const renderCardContent = (item: Portal, isActive: boolean, isFocused: boolean) => {
    const config = item.config || {};
    const detail = (config as any).url || (config as any).mac || "--";

    return (
      <LinearGradient
        colors={
          isFocused
            ? ["rgba(255,255,255,0.10)", "rgba(255,255,255,0.04)", "rgba(255,255,255,0.01)"]
            : ["rgba(255,255,255,0.04)", "rgba(255,255,255,0.02)", "rgba(255,255,255,0.0)"]
        }
        locations={[0, 0.5, 1]}
        style={S.portalCardGradient}
      >
        <View style={S.cardHeader}>
          <View style={[S.cardIconBox, isActive && S.cardIconBoxActive, isFocused && S.cardIconBoxFocused]}>
            <MaterialCommunityIcons
              name={getPortalTypeInfo(item.type).icon}
              size={isTV ? ps(2.6) : 28}
              color={isFocused ? "#FFFFFF" : isActive ? "#FFFFFF" : "rgba(255,255,255,0.7)"}
            />
          </View>
          {isActive && (
            <View style={[S.activeBadge, isFocused && S.activeBadgeFocused]}>
              <View style={[S.badgeDot, isFocused && S.badgeDotFocused]} />
              <Text style={[S.activeBadgeText, isFocused && S.activeBadgeTextFocused]}>ACTIVE</Text>
            </View>
          )}
        </View>

        <View style={S.cardMain}>
          <Text style={[S.cardName, isFocused && { color: "#FFFFFF" }]} numberOfLines={1}>{item.name}</Text>
          <Text style={[S.cardDetailText, isFocused && { color: "rgba(255,255,255,0.85)" }]} numberOfLines={1}>{detail}</Text>
          <Text style={[S.cardTypeLabel, isFocused && { color: "#FFFFFF" }]}>
            {item.type === "m3u"
              ? "M3U PLAYLIST"
              : item.type === "xtream"
                ? "XTREAM CODES API"
                : "MAC PORTAL"}
          </Text>
        </View>
      </LinearGradient>
    );
  };

  const renderPortal = ({ item, index }: { item: Portal; index: number }) => {
    const isColFocused = focusedPortalId === item.id;
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
            transform: [{ scale: useStaticFocus ? (isColFocused ? 1.04 : 1) : (isTV ? scale : isColFocused ? 1.04 : 1) }],
            opacity: useStaticFocus ? (isColFocused ? 1 : 0.85) : (isTV ? opacity : 1),
            zIndex: isColFocused ? 100 : index,
          },
        ]}
      >
        <FocusGroup style={{ flex: 1 }}>
          <Focusable
            hasTVPreferredFocus={shouldFocus}
            screenKey="portals"
            focusKey={`card-${item.id}`}
            onFocus={() => {
              setFocusedPortalId(item.id);
              if (isTV) flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
            }}
            onPress={() => connectToPortal(item)}
            ringOnFocus={false}
            style={S.pressable}
          >
            {(focused) => (
              <View style={[
                S.portalCard,
                focused && S.portalCardFocused,
                isActive && S.portalCardActive,
                isActive && focused && S.portalCardActiveFocused,
              ]}>
                {renderCardContent(item, isActive, focused)}
              </View>
            )}
          </Focusable>

          <Focusable
            screenKey="portals"
            focusKey={`delete-${item.id}`}
            onFocus={() => {
              setFocusedPortalId(item.id);
            }}
            onPress={() => handleDeletePortal(item)}
            style={S.deleteBtnWrapper}
            ringOnFocus={false}
          >
            {(focusedBtn) => (
              <View style={[
                S.deleteBtn,
                focusedBtn && S.deleteBtnFocused,
              ]}>
                <Text style={[S.deleteBtnText, focusedBtn && S.deleteBtnTextFocused]}>
                  DELETE PORTAL
                </Text>
              </View>
            )}
          </Focusable>
        </FocusGroup>
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
    <FocusGroup style={S.actionArea}>
      <Focusable
        screenKey="portals"
        focusKey="add-portal-btn"
        ringOnFocus={false}
        onPress={() => router.push("/add-portal")}
        style={{ borderRadius: ps(1), overflow: "visible" }}
      >
        {(focused) => (
          <View
            style={[
              S.addBtn,
              focused && S.addBtnFocused,
            ]}
          >
            <Ionicons name="add" size={ps(1.6)} color={focused ? "#000000" : "#F5F5F7"} />
            <Text style={[S.addBtnText, focused && S.addBtnTextFocused]}>ADD NEW PORTAL</Text>
          </View>
        )}
      </Focusable>
    </FocusGroup>
  );

  // ── Empty state ────────────────────────────────────────────────────────────
  const renderEmptyState = () => (
    <View style={S.introRow}>
      <View style={S.introCopy}>
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
                focused && S.addButtonLargeFocused,
              ]}
            >
              <Text style={[S.addButtonText, focused && { color: "#000" }]}>GET STARTED</Text>
            </View>
          )}
        </Focusable>
      </View>

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
        <CinematicBackground />
        {isLoading && <LoadingOverlay message={loadingMessage} />}
        {renderEmptyState()}
        {dialogNode}
      </View>
    );
  }

  return (
    <View style={S.container}>


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

      {dialogNode}
    </View>
  );
}

// ─── StyleSheet ───────────────────────────────────────────────────────────────
const S = StyleSheet.create({

  // ── Root ──────────────────────────────────────────────────────────────────
  container: {
    flex: 1,
    backgroundColor: "#050608",
  },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    alignItems: "center",
    paddingTop: ph(8),
    marginBottom: ph(5),
  },
  headerLogoImage: {
    width: pw(50),
    height: ph(8),
    transform: [{ scale: 3 }],
    marginBottom: ph(1),
  },
  actionArea: {
    alignItems: "center",
    paddingBottom: ph(10),
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    paddingHorizontal: pw(2.5),
    paddingVertical: ph(1.4),
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    gap: pw(0.8),
    borderRadius: ps(1.5),
  },
  addBtnFocused: {
    backgroundColor: "#FFFFFF",
    borderColor: "#FFFFFF",
    borderWidth: 1.5,
    transform: [{ scale: 1.05 }],
    ...Platform.select({
      ios: {
        shadowColor: "#FFFFFF",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.6,
        shadowRadius: 14,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  addBtnText: {
    color: "#F5F5F7",
    fontSize: ps(1.1),
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  addBtnTextFocused: {
    color: "#000000",
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
    borderRadius: ps(2),
    overflow: "hidden",
  },

  // ── Portal card ───────────────────────────────────────────────────────────
  portalCard: {
    flex: 1,
    borderRadius: ps(2.5),
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    backgroundColor: "rgba(255, 255, 255, 0.03)",
  },
  portalCardFocused: {
    borderColor: "rgba(255, 255, 255, 0.9)",
    borderWidth: 1.5,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    ...Platform.select({
      ios: {
        shadowColor: "#FFFFFF",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.55,
        shadowRadius: 16,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  portalCardActive: {
    borderColor: "rgba(255, 255, 255, 0.2)",
  },
  portalCardActiveFocused: {
    borderColor: "#FFFFFF",
    borderWidth: 1.5,
  },
  portalCardGradient: {
    flex: 1,
    padding: ps(2.6),
    justifyContent: "space-between",
  },

  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardIconBox: {
    width: ps(6.2),
    height: ps(6.2),
    borderRadius: ps(3.1),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  cardIconBoxFocused: {
    backgroundColor: "rgba(255, 255, 255, 0.10)",
    borderColor: "rgba(255, 255, 255, 0.25)",
  },
  cardIconBoxActive: {
    backgroundColor: "rgba(255, 255, 255, 0.07)",
    borderColor: "rgba(255, 255, 255, 0.16)",
  },

  // ── Active badge ──────────────────────────────────────────────────────────
  activeBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    paddingHorizontal: pw(1.2),
    paddingVertical: ph(0.6),
    borderRadius: 100,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.18)",
    gap: pw(0.5),
  },
  activeBadgeFocused: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    borderColor: "rgba(255, 255, 255, 0.5)",
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#FFFFFF",
  },
  badgeDotFocused: {
    backgroundColor: "#FFFFFF",
  },
  activeBadgeText: {
    color: "#FFFFFF",
    fontSize: ps(0.85),
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  activeBadgeTextFocused: {
    color: "#FFFFFF",
  },

  // ── Card body ─────────────────────────────────────────────────────────────
  cardMain: {
    flex: 1.5,
    justifyContent: "center",
  },
  cardName: {
    fontSize: ps(2.8),
    fontWeight: "600",
    color: "#F5F5F7",
    marginBottom: ph(0.5),
    letterSpacing: 1,
  },
  cardDetailText: {
    fontSize: ps(1.25),
    color: "#9A9DA5",
    fontWeight: "400",
    marginBottom: ph(1.2),
    letterSpacing: 0.5,
  },
  cardTypeLabel: {
    fontSize: ps(1.1),
    color: "#666A73",
    fontWeight: "700",
    letterSpacing: 2.5,
  },

  // ── Delete Button ─────────────────────────────────────────────────────────
  deleteBtnWrapper: {
    marginTop: ph(1.5),
    borderRadius: ps(1.5),
    overflow: "visible",
  },
  deleteBtn: {
    height: ph(5.5),
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderRadius: ps(1.5),
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  deleteBtnFocused: {
    backgroundColor: "#FFFFFF",
    borderColor: "#FFFFFF",
    borderWidth: 1.5,
    transform: [{ scale: 1.03 }],
    ...Platform.select({
      ios: {
        shadowColor: "#FFFFFF",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.5,
        shadowRadius: 10,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  deleteBtnText: {
    color: "#9A9DA5",
    fontSize: ps(1.1),
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  deleteBtnTextFocused: {
    color: "#000000",
  },

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
  introCopy: {
    flex: isTV ? 1 : undefined,
    alignItems: "flex-start",
  },
  introLogo: {
    width: pw(20),
    height: pw(20) / 3.31,
    marginBottom: ph(3),
  },
  introTitle: {
    fontSize: isTV ? ps(3) : ps(2.4),
    color: "#F5F5F7",
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  introBody: {
    fontSize: isTV ? ps(1.4) : ps(1.15),
    lineHeight: isTV ? ps(2.2) : ps(1.8),
    color: "#9A9DA5",
    marginTop: ph(2),
    maxWidth: pw(38),
  },
  getStartedWrapper: {
    borderRadius: ps(1),
    overflow: "visible",
    alignSelf: "flex-start",
    marginTop: ph(5),
  },
  introArt: {
    flex: isTV ? 1.1 : undefined,
    width: isTV ? undefined : "100%",
    aspectRatio: 16 / 10,
  },
  introArtLayer: {
    position: "absolute",
    width: "88%",
    height: "80%",
    ...CARD_FRAME,
  },
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
    paddingHorizontal: pw(2.5),
    paddingVertical: ph(1.5),
    alignItems: "center",
    justifyContent: "center",
    borderRadius: ps(1),
    backgroundColor: "#17191D",
    borderWidth: 1,
    borderColor: "#3A3D43",
  },
  addButtonLargeFocused: {
    backgroundColor: "#FFFFFF",
    borderColor: "#FFFFFF",
    borderWidth: 1.5,
    transform: [{ scale: 1.06 }],
    ...Platform.select({
      ios: {
        shadowColor: "#FFFFFF",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.6,
        shadowRadius: 14,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  addButtonText: {
    color: "#F5F5F7",
    fontSize: ps(1.4),
    fontWeight: "700",
    letterSpacing: 1.5,
  },
});