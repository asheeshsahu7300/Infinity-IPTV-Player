import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Pressable,
  Dimensions,
  Animated,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePortalStore, Portal } from "../src/store/portalStore";
import { portalApi } from "../src/services/portalApi";
import { M3UApi } from "../src/services/m3uApi";
import { XtreamApi } from "../src/services/xtreamApi";
import LoadingOverlay from "../src/components/LoadingOverlay";
import { isTV } from "../src/utils/tvUtils";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { Focusable } from "../src/tv";
import { THEME } from "../src/theme/tokens";

// ─── Percentage helpers ───────────────────────────────────────────────────────
const { width: W, height: H } = Dimensions.get("window");

/** % of screen width  */
const pw = (pct: number) => (W * pct) / 100;
/** % of screen height */
const ph = (pct: number) => (H * pct) / 100;
/** averaged scale — good for font sizes */
const ps = (pct: number) => (pw(pct) + ph(pct)) / 2;

// ─── Carousel geometry (all percentage-based) ────────────────────────────────
const CARD_WIDTH = isTV ? pw(28) : pw(85);
const CARD_MARGIN = pw(1.5);
const ITEM_SIZE = CARD_WIDTH + CARD_MARGIN * 2;
const SPACER_WIDTH = (W - ITEM_SIZE) / 2;

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function PortalsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { portals, activePortal, loadPortals, setActivePortal, updatePortal, deletePortal } =
    usePortalStore();

  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [focusedPortalId, setFocusedPortalId] = useState<string | null>(null);
  const [focusedHeader, setFocusedHeader] = useState<"back" | "add" | null>(null);

  const scrollX = useRef(new Animated.Value(0)).current;
  const flatListRef = useRef<any>(null);

  const focusedPortalIdRef = useRef<string | null>(null);
  const focusedHeaderRef = useRef<"back" | "add" | null>(null);

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
      Alert.alert("Connection Failed", e.message || "Unable to connect");
    } finally {
      setIsLoading(false);
    }
  };

  // OK/select is handled natively by each focusable's onPress — no global
  // listener needed (and a global one would double-fire on Android TV).

  // ── Helpers ────────────────────────────────────────────────────────────────
  const handleDeletePortal = useCallback(
    (portal: Portal) => {
      Alert.alert("Delete Portal", `Delete "${portal.name}"?`, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => deletePortal(portal.id) },
      ]);
    },
    [deletePortal]
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
    const [shouldFocus, setShouldFocus] = useState(index === 0);
    useEffect(() => {
      if (index === 0) {
        setShouldFocus(true);
        const timer = setTimeout(() => setShouldFocus(false), 500);
        return () => clearTimeout(timer);
      }
    }, [index === 0]);

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
          {isFocused ? (
            <LinearGradient
              colors={[THEME.colors.primary, THEME.colors.secondary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={S.gradientBorder}
            >
              <View style={[S.portalCard, S.portalCardFocused, isActive && S.portalCardActive]}>
                {renderCardContent(item, isActive)}
              </View>
            </LinearGradient>
          ) : (
            <View style={[S.portalCard, isActive && S.portalCardActive]}>
              {renderCardContent(item, isActive)}
            </View>
          )}
        </Focusable>
      </Animated.View>
    );
  };

  // ── Header ─────────────────────────────────────────────────────────────────
  const renderHeader = () => (
    <View style={S.header}>
      <Text style={S.brandingText}>IPTV HUB</Text>
      <Text style={S.headerSubtitle}>SELECT YOUR PREFERRED CONNECTION TO BEGIN YOUR</Text>
      <Text style={S.headerSubtitleAccent}>PREMIUM STREAMING EXPERIENCE</Text>
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
          <LinearGradient
            colors={focused ? [THEME.colors.primary, THEME.colors.secondary] : ["transparent", "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[
              { padding: focused ? 1.5 : 0, borderRadius: ps(1) },
              focused && {
                transform: [{ scale: 1.06 }],
                shadowColor: THEME.colors.primary,
                shadowOpacity: 0.6,
                shadowRadius: 12,
                elevation: 12,
              },
            ]}
          >
            <View style={S.addBtn}>
              <Ionicons name="add" size={ps(1.8)} color="#fff" />
              <Text style={S.addBtnText}>ADD NEW PORTAL</Text>
            </View>
          </LinearGradient>
        )}
      </Focusable>
    </View>
  );

  // ── Root ───────────────────────────────────────────────────────────────────
  return (
    <View style={S.container}>
      {/* Background gradients */}
      <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
        <LinearGradient
          colors={["#2a0845", "transparent"]}
          start={{ x: 1, y: 0 }}
          end={{ x: 0.5, y: 0.5 }}
          style={{ position: "absolute", top: 0, right: 0, width: "100%", height: "100%", opacity: 0.3 }}
        />
        <LinearGradient
          colors={["#6441a5", "transparent"]}
          start={{ x: 0, y: 1 }}
          end={{ x: 0.3, y: 0.7 }}
          style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: "100%", opacity: 0.15 }}
        />
      </View>

      {isLoading && <LoadingOverlay message={loadingMessage} />}

      {renderHeader()}

      <View style={S.carouselContainer}>
        {portals.length === 0 ? (
          <View style={S.emptyState}>
            <Ionicons name="tv-outline" size={ps(8)} color="rgba(255,255,255,0.1)" />
            <Text style={S.emptyTitle}>Securely connect your first streaming source</Text>
            <Focusable
              hasTVPreferredFocus
              ringOnFocus={false}
              onPress={() => router.push("/add-portal")}
              style={{ borderRadius: ps(1), overflow: "visible", marginTop: ph(3) }}
            >
              {(focused) => (
                <LinearGradient
                  colors={[THEME.colors.primary, THEME.colors.secondary]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[
                    S.addButtonLarge,
                    focused && { transform: [{ scale: 1.06 }], shadowColor: THEME.colors.primary, shadowOpacity: 0.7, shadowRadius: 14, elevation: 14 },
                  ]}
                >
                  <Text style={S.addButtonText}>GET STARTED</Text>
                </LinearGradient>
              )}
            </Focusable>
          </View>
        ) : portals.length <= 3 ? (
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
    backgroundColor: "#08080a",
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
    height: isTV ? ph(40) : ph(45),
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
    backgroundColor: "#1D1B20",
    borderRadius: ps(1.4),
    padding: ps(1.8),
    justifyContent: "space-between",
    // Base shadow
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 8,
  },
  portalCardFocused: {
    backgroundColor: "#222026",
    // Intense focus glow
    shadowColor: THEME.colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 25,
    elevation: 15,
  },
  portalCardActive: {
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.2)",
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
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    fontSize: ps(2),
    color: "rgba(255,255,255,0.4)",
    textAlign: "center",
    width: pw(40),
    marginVertical: ph(4),
  },
  addButtonWrapper: {
    borderRadius: ps(4),
    overflow: "hidden",
    marginTop: ph(4),
  },
  addButtonLarge: {
    paddingHorizontal: pw(4),
    paddingVertical: ph(2),
    alignItems: "center",
    justifyContent: "center",
    borderRadius: ps(1),
  },
  addButtonText: {
    color: "#fff",
    fontSize: ps(1.5),
    fontWeight: "700",
    letterSpacing: 2,
  },



});