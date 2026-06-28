import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Dimensions,
  Animated,
  ScrollView,
  Platform,
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
import { Focusable } from "../src/tv";
import { THEME, fw, isTablet, isPhone } from '../src/theme/tokens';

const { width: W, height: H } = Dimensions.get("window");
const pw = (pct: number) => (W * pct) / 100;
const ph = (pct: number) => (H * pct) / 100;
const PS_SCALE = isTV ? 1.3 : isPhone ? 1.55 : 1.35;
const ps = (pct: number) => ((pw(pct) + ph(pct)) / 2) * PS_SCALE;

const CONTENT_MAX = isTV ? 880 : isTablet ? 620 : 560;

// Per-card icon accents so stacked portals are easy to tell apart.
const ACCENTS: [string, string][] = [
  [THEME.colors.primary, THEME.colors.secondary], // brand red → blue
  ["#3B82F6", "#06B6D4"], // blue → cyan
  ["#F59E0B", "#EF4444"], // amber → red
  ["#10B981", "#3B82F6"], // emerald → blue
];

const TYPE_INFO = (type: string) => {
  switch (type) {
    case "m3u": return { icon: "play-circle", label: "M3U Playlist" };
    case "xtream": return { icon: "cloud-download", label: "Xtream Codes" };
    case "mag": return { icon: "tv", label: "MAC Portal" };
    default: return { icon: "server", label: "Portal" };
  }
};

const getDomain = (url?: string) => {
  if (!url) return "";
  try {
    const s = url.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    return s.split("/")[0] || url;
  } catch {
    return url;
  }
};

const formatLastConnected = (ts?: number): string | null => {
  if (!ts) return null;
  try {
    const d = new Date(ts);
    const now = new Date();
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (d.toDateString() === now.toDateString()) return `Today • ${time}`;
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return `Yesterday • ${time}`;
    return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} • ${time}`;
  } catch {
    return null;
  }
};

export default function PortalsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { portals, activePortal, loadPortals, setActivePortal, updatePortal, deletePortal } =
    usePortalStore();

  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");

  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => { loadPortals(); }, [loadPortals]);

  useEffect(() => {
    enter.setValue(0);
    Animated.timing(enter, { toValue: 1, duration: 420, useNativeDriver: true }).start();
  }, [portals.length, enter]);

  const goDashboard = useCallback((portal: Portal) => {
    
    router.replace("/dashboard");
  }, [router, updatePortal]);

  const connectToPortal = async (portal: Portal) => {
    if (activePortal?.id === portal.id) { goDashboard(portal); return; }

    setIsLoading(true);
    setLoadingMessage("Connecting...");
    try {
      let connected: Portal = portal;
      if (portal.type === "m3u") {
        const api = new M3UApi({ url: portal.config.url });
        const result = await api.login();
        if (!result.ok) throw new Error(result.error);
      } else if (portal.type === "xtream") {
        const api = new XtreamApi({
          url: portal.config.url,
          username: portal.config.username!,
          password: portal.config.password!,
        });
        await api.login();
      } else {
        const { token, serverInfo } = await portalApi.authenticate(portal);
        await updatePortal(portal.id, { config: { ...portal.config, token, serverInfo } });
        connected = { ...portal, config: { ...portal.config, token, serverInfo } };
      }

      // Fetch the portal's content (also primes the store the dashboard reads).
      // If it has no channels, movies or series, don't proceed.
      setLoadingMessage("Loading content...");
      await portalApi.refreshPortalData(connected);
      const s = usePortalStore.getState();
      const total = (s.channels?.length || 0) + (s.vodItems?.length || 0) + (s.series?.length || 0);
      if (total === 0) {
        Alert.alert("No Content", "This portal returned no channels, movies, or series.");
        return;
      }

      await setActivePortal(connected);
      goDashboard(connected);
    } catch (e: any) {
      Alert.alert("Connection Failed", e.message || "Unable to connect");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeletePortal = useCallback((portal: Portal) => {
    Alert.alert("Delete Portal", `Delete "${portal.name}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deletePortal(portal.id) },
    ]);
  }, [deletePortal]);

  // ── Header ──
  const headerIcon = (icon: any, onPress: () => void) => (
    <Focusable ringOnFocus={false} onPress={onPress} style={S.headerIcon} focusStyle={S.headerIconFocused}>
      {() => <Ionicons name={icon} size={ps(1.6)} color="#fff" />}
    </Focusable>
  );

  // ── Card ──
  const renderCard = (item: Portal, index: number) => {
    const isActive = activePortal?.id === item.id;
    const info = TYPE_INFO(item.type);
    const accent = ACCENTS[index % ACCENTS.length];
    const detail = getDomain(item.config?.url) || item.config?.mac || "--";

    return (
      <Focusable
        key={item.id}
        hasTVPreferredFocus={index === 0}
        ringOnFocus={false}
        onPress={() => connectToPortal(item)}
        onLongPress={() => handleDeletePortal(item)}
        style={S.cardPressable}
      >
        {(focused: boolean) => (
          <View style={[S.cardBorder, focused && S.cardBorderFocused]}>
            <View style={S.card}>
              {/* Top row: icon + active badge */}
              <View style={S.cardTop}>
                <View style={S.iconCircle}>
                  <Ionicons name={info.icon as any} size={ps(2.4)} color={THEME.colors.secondary} />
                </View>
                {isActive && (
                  <View style={S.activeBadge}>
                    <View style={S.activeDot} />
                    <Text style={S.activeText}>Active</Text>
                  </View>
                )}
              </View>

              {/* Info */}
              <Text style={S.cardName} numberOfLines={1}>{item.name}</Text>
              <Text style={S.cardUrl} numberOfLines={1}>{detail}</Text>
              <Text style={[S.cardType, { color: accent[1] }]}>{info.label}</Text>

            

              <View style={S.cardDivider} />

              {/* Connect affordance (whole card is tappable) */}
              <View style={S.connectBtn}>
                <Text style={S.connectText}>{isActive ? "Continue" : "Connect"}</Text>
                <Ionicons name="arrow-forward" size={ps(1.5)} color="#000" />
              </View>
            </View>
          </View>
        )}
      </Focusable>
    );
  };

  const isEmpty = portals.length === 0;

  return (
    <View style={S.container}>
      <CinematicBackground />

      {isLoading && <LoadingOverlay message={loadingMessage} />}

      {/* Header */}
      <View style={[S.header, { paddingTop: insets.top + (isPhone ? 10 : ph(1.5)) }]}>
        <View style={S.headerText}>
          <Text style={S.title}>IPTV Hub</Text>
          <Text style={S.subtitle}>Choose a portal to continue</Text>
        </View>
        {!isEmpty && (
          <View style={S.headerActions}>
            {headerIcon("settings", () => router.push("/settings"))}
          </View>
        )}
      </View>

      {isEmpty ? (
        <View style={S.emptyWrap}>
          <Animated.View style={[S.emptyInner, { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }]}>
            <View style={S.emptyIcon}>
              <Ionicons name="tv-outline" size={ps(5)} color="rgba(255,255,255,0.5)" />
            </View>
            <Text style={S.emptyTitle}>No portals yet</Text>
            <Text style={S.emptySubtitle}>Add your first IPTV portal to start watching.</Text>
            <Focusable
              hasTVPreferredFocus
              ringOnFocus={false}
              onPress={() => router.push("/add-portal")}
              style={S.emptyBtnPressable}
            >
              {(focused: boolean) => (
                <View style={[S.ctaBtn, focused && S.ctaBtnFocused]}>
                  <Ionicons name="add" size={ps(1.8)} color="#000" />
                  <Text style={S.ctaText}>Add Portal</Text>
                </View>
              )}
            </Focusable>
          </Animated.View>
        </View>
      ) : (
        <>
          <ScrollView
            style={S.scroll}
            horizontal={isTV}
            contentContainerStyle={isTV ? S.scrollContentTV : S.scrollContent}
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
          >
            <Animated.View
              style={[
                isTV ? S.listTV : S.list,
                { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] },
              ]}
            >
              {portals.map((item, index) => renderCard(item, index))}
            </Animated.View>
          </ScrollView>

          {/* Floating Add CTA */}
          <View style={[S.addBar, { paddingBottom: insets.bottom + ph(1.5) }]}>
            <Focusable
              ringOnFocus={false}
              onPress={() => router.push("/add-portal")}
              style={S.addPressable}
            >
              {(focused: boolean) => (
                <View style={[S.ctaBtn, focused && S.ctaBtnFocused]}>
                  <Ionicons name="add" size={ps(1.8)} color="#000" />
                  <Text style={S.ctaText}>Add Portal</Text>
                </View>
              )}
            </Focusable>
          </View>
        </>
      )}
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#09090B" },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: pw(5),
    paddingBottom: ph(1.5),
    gap: pw(3),
  },
  headerText: { flex: 1 },
  title: {
    fontSize: isTV ? ps(2) : ps(2.4),
    fontWeight: fw("500"),
    color: "#fff",
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: isTV ? ps(1) : ps(1.2),
    color: "#9CA3AF",
    marginTop: 3,
  },
  headerActions: { flexDirection: "row", gap: pw(2.5) },
  headerIcon: {
    width: ps(4.4),
    height: ps(4.4),
    borderRadius: ps(2.2),
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerIconFocused: {
    borderColor: "#fff",
    backgroundColor: "rgba(255,255,255,0.14)",
    transform: [{ scale: 1.08 }],
  },

  // List
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: pw(5),
    paddingTop: ph(1.5),
    paddingBottom: ph(3),
    alignItems: "center",
  },
  list: {
    width: "100%",
    maxWidth: CONTENT_MAX,
    gap: ph(2.2),
  },
  // TV: a centered horizontal row of cards (10-foot friendly, D-pad left/right).
  scrollContentTV: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: pw(5),
  },
  listTV: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: pw(2.5),
  },

  // Card
  cardPressable: {
    width: isTV ? pw(26) : "100%",
    borderRadius: 28,
  },
  cardBorder: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    padding: 0,
    overflow: "hidden",
  },
  cardBorderFocused: {
    // Focus cue that's identical on both platforms: brighter border + scale.
    // The soft colored glow is iOS-only (Android elevation can't tint and would
    // draw a mismatched grey box).
    borderColor: THEME.colors.secondary,
    transform: [{ scale: 1.01 }],
    ...Platform.select({
      ios: {
        shadowColor: THEME.colors.primary,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.5,
        shadowRadius: 20,
      },
      default: {},
    }),
  },
  card: {
    borderRadius: 28,
    padding: ps(2.4),
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: ph(2),
  },
  iconCircle: {
    width: ps(6),
    height: ps(6),
    borderRadius: ps(3),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },

  // Active badge
  activeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(1.4),
    paddingHorizontal: pw(3),
    paddingVertical: ph(0.9),
    borderRadius: 999,
    backgroundColor: "rgba(52,211,153,0.14)",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.35)",
  },
  activeDot: {
    width: ps(0.8),
    height: ps(0.8),
    borderRadius: ps(0.8),
    backgroundColor: "#34D399",
    ...Platform.select({
      ios: {
        shadowColor: "#34D399",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.9,
        shadowRadius: 6,
      },
      default: {},
    }),
  },
  activeText: {
    color: "#34D399",
    fontSize: ps(1),
    fontWeight: fw("700"),
    letterSpacing: 0.5,
  },

  // Card text
  cardName: {
    fontSize: isTV ? ps(2) : ps(2.4),
    fontWeight: fw("800"),
    color: "#fff",
    letterSpacing: 0.2,
  },
  cardUrl: {
    fontSize: ps(1.3),
    color: "#9CA3AF",
    marginTop: 4,
  },
  cardType: {
    fontSize: ps(1.2),
    fontWeight: fw("700"),
    letterSpacing: 1,
    marginTop: ph(1),
    textTransform: "uppercase",
  },
  lastRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(1.4),
    marginTop: ph(1.2),
  },
  lastText: {
    fontSize: ps(1.05),
    color: "#6B7280",
  },
  cardDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.07)",
    marginVertical: ph(2),
  },
  connectBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: pw(1.6),
    paddingVertical: ph(1.6),
    borderRadius: 16,
    backgroundColor: "#E6E6EB",
  },
  connectText: {
    color: "#000",
    fontSize: ps(1.4),
    fontWeight: fw("800"),
    letterSpacing: 0.5,
  },

  // Add CTA (shared by floating bar + empty state)
  addBar: {
    paddingHorizontal: pw(5),
    paddingTop: ph(1.2),
  },
  addPressable: {
    alignSelf: "center",
    width: "100%",
    maxWidth: CONTENT_MAX,
    borderRadius: 18,
  },
  ctaBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: pw(1.6),
    paddingVertical: ph(2),
    borderRadius: 18,
    backgroundColor: "#E6E6EB",
    borderWidth: 2,
    borderColor: "transparent",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 12,
  },
  ctaBtnFocused: {
    transform: [{ scale: 1.03 }],
    borderColor: "#000",
  },
  ctaText: {
    color: "#000",
    fontSize: ps(1.5),
    fontWeight: fw("800"),
    letterSpacing: 0.5,
  },

  // Empty state
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: pw(8),
  },
  emptyInner: {
    alignItems: "center",
    width: "100%",
    maxWidth: CONTENT_MAX,
  },
  emptyIcon: {
    width: ps(11),
    height: ps(11),
    borderRadius: ps(5.5),
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: ph(3),
  },
  emptyTitle: {
    fontSize: ps(2.2),
    fontWeight: fw("800"),
    color: "#fff",
    marginBottom: ph(1),
  },
  emptySubtitle: {
    fontSize: ps(1.3),
    color: "#9CA3AF",
    textAlign: "center",
    marginBottom: ph(4),
    lineHeight: ps(1.9),
  },
  emptyBtnPressable: {
    width: "100%",
    borderRadius: 18,
  },
});
