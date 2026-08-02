import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Alert,
  ScrollView,
  Dimensions,
  TouchableOpacity,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePortalStore } from "../src/store/portalStore";
import { portalApi } from "@/src/services/portalApi";
import { M3UApi } from "../src/services/m3uApi";
import { XtreamApi } from "../src/services/xtreamApi";
import LoadingOverlay from "../src/components/LoadingOverlay";
import { CinematicBackground } from "../src/components/CinematicBackground";
import { isTV } from "../src/utils/tvUtils";
import { Focusable } from "../src/tv";

import { THEME, pw, ph, fw, isTablet, isPhone } from '../src/theme/tokens';

// Touch screens use a tighter scale; TV keeps the original 1.3× so the
// TV layout is unchanged.
const PS_SCALE = isTV ? 1.3 : isPhone ? 1.55 : 1.35;
const ps = (pct: number) => ((pw(pct) + ph(pct)) / 2) * PS_SCALE;

// ─── Glass surface ────────────────────────────────────────────────────────────
// iOS gets a real frosted blur; Android's expo-blur renders poorly, so it falls
// back to a clean solid translucent surface (the `style` may carry a faint white
// tint for iOS — we override it with a readable dark fill on Android).
const GlassView = ({
  intensity = 30,
  style,
  children,
}: {
  intensity?: number;
  style?: any;
  children?: React.ReactNode;
}) => {
  if (Platform.OS === "ios") {
    return (
      <BlurView intensity={intensity} tint="dark" style={style}>
        {children}
      </BlurView>
    );
  }
  return <View style={[style, { backgroundColor: "rgba(24,24,30,0.96)" }]}>{children}</View>;
};

// ─── Gradient text ────────────────────────────────────────────────────────────
const GradientText = ({
  text,
  isActive,
  style,
}: {
  text: string;
  isActive: boolean;
  style: any;
}) => {
  if (!isActive) return <Text style={style}>{text}</Text>;
  return (
    <MaskedView
      maskElement={
        <Text style={[style, { backgroundColor: "transparent" }]}>{text}</Text>
      }
    >
      <LinearGradient
        colors={[THEME.colors.primary, THEME.colors.secondary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
      >
        <Text style={[style, { opacity: 0 }]}>{text}</Text>
      </LinearGradient>
    </MaskedView>
  );
};

// ─── Card with gradient border on focus ──────────────────────────────────────
type CardType = "m3u" | "xtream" | "mag";

// Per-type accent (icon only) so the three connection methods are easy to tell
// apart; the primary action gradient stays the brand red→blue everywhere else.
const TYPE_ACCENT: Record<CardType, string> = {
  m3u: "#8B5CF6",    // purple
  xtream: "#3B82F6", // blue
  mag: "#ff002b",    // red
};

const GradientBorderCard = ({
  id,
  focusedField,
  onPress,
  onFocus,
  onBlur,
  children,
}: {
  id: string;
  focusedField: string | null;
  onPress: () => void;
  onFocus: () => void;
  onBlur: () => void;
  children: React.ReactNode;
}) => {
  const focused = focusedField === id;
  const RADIUS = isTV ? pw(2) : 24;
  const BORDER = pw(0.2); // ~2 px on a 1080p TV

  return (
    <Focusable
      onPress={onPress}
      onFocus={onFocus}
      onBlur={onBlur}
      ringOnFocus={false}
      style={[
        {
          width: isTV ? "30%" : isTablet ? "60%" : "100%",
          aspectRatio: isTV ? 1 : undefined,
          // Phone cards were forced to ~236px (ph(28)) leaving big empty space
          // and pushing the 3rd option off-screen — let content drive height.
          minHeight: isTV ? undefined : isPhone ? ph(11) : ph(16),
          borderRadius: RADIUS,
        },
        focused && {
          transform: [{ scale: 1.05 }],
          // iOS gets a soft native glow; Android uses the colored halo layers
          // below (elevation can't reliably tint on a transparent view).
          ...Platform.select({
            ios: {
              shadowColor: THEME.colors.primary,
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.55,
              shadowRadius: pw(1.2),
            },
            default: {},
          }),
        },
      ]}
    >
      {focused && (
        <>
          <View
            pointerEvents="none"
            style={{ position: "absolute", top: -14, left: -14, right: -14, bottom: -14, borderRadius: RADIUS + 14, backgroundColor: THEME.colors.primary, opacity: 0.16 }}
          />
          <View
            pointerEvents="none"
            style={{ position: "absolute", top: -6, left: -6, right: -6, bottom: -6, borderRadius: RADIUS + 6, backgroundColor: THEME.colors.primary, opacity: 0.3 }}
          />
        </>
      )}
      <LinearGradient
        colors={
          focused ? [THEME.colors.primary, THEME.colors.secondary] : ["transparent", "transparent"]
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          flex: 1,
          borderRadius: RADIUS,
          padding: focused ? BORDER : 0,
        }}
      >
        <GlassView
          intensity={focused ? 45 : 28}
          style={{
            flex: 1,
            backgroundColor: "rgba(255,255,255,0.05)",
            borderRadius: focused ? RADIUS - BORDER : RADIUS,
            borderWidth: focused ? 0 : 1,
            borderColor: "rgba(255,255,255,0.1)",
            alignItems: isTV ? "center" : "stretch",
            justifyContent: "center",
            padding: pw(2.8),
            overflow: "hidden",
          }}
        >
          {children}
        </GlassView>
      </LinearGradient>
    </Focusable>
  );
};

// ─── Input with gradient border on focus ─────────────────────────────────────
const GradientBorderInput = ({
  isFocused,
  children,
  style,
}: {
  isFocused: boolean;
  children: React.ReactNode;
  style?: any;
}) => {
  const RADIUS = 16;

  return (
    <GlassView
      intensity={isFocused ? 40 : 24}
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: "rgba(255,255,255,0.05)",
          borderRadius: RADIUS,
          paddingHorizontal: pw(2),
          borderWidth: 1,
          borderColor: isFocused ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.1)",
          overflow: "hidden",
        },
        style,
      ]}
    >
      {children}
    </GlassView>
  );
};

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function AddPortalScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { addPortal, setActivePortal } = usePortalStore();

  const [step, setStep] = useState<1 | 2>(1);
  const [type, setType] = useState<CardType>("m3u");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mac, setMac] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");

  const [focusedField, setFocusedField] = useState<string | null>(null);
  const focusedFieldRef = useRef<string | null>(null);

  const nameInputRef = useRef<TextInput>(null);
  const urlInputRef = useRef<TextInput>(null);
  const userInputRef = useRef<TextInput>(null);
  const passInputRef = useRef<TextInput>(null);
  const macInputRef = useRef<TextInput>(null);

  useEffect(() => {
    focusedFieldRef.current = focusedField;
  }, [focusedField]);

  const formatMac = useCallback((t: string) => {
    const cleaned = t.replace(/[^a-fA-F0-9]/g, "").toUpperCase();
    return (cleaned.match(/.{1,2}/g)?.join(":") ?? cleaned).slice(0, 17);
  }, []);

  const validateInputs = useCallback(() => {
    if (!name.trim()) { Alert.alert("Error", "Enter portal name"); return false; }
    if (!url.trim()) { Alert.alert("Error", "Enter portal URL"); return false; }
    if (type === "xtream" && (!username.trim() || !password.trim())) {
      Alert.alert("Error", "Xtream requires username & password");
      return false;
    }
    if (type === "mag") {
      const formatted = formatMac(mac);
      if (!formatted.trim() || formatted.replace(/:/g, "").length !== 12) {
        Alert.alert("Error", "Enter valid MAC address");
        return false;
      }
    }
    return true;
  }, [name, url, type, username, password, mac, formatMac]);

  const handleSave = useCallback(async () => {
    if (!validateInputs()) return;
    const formattedMac = formatMac(mac);
    const portal = {
      id: Date.now().toString(),
      name,
      type,
      config:
        type === "m3u"
          ? { url }
          : type === "xtream"
            ? { url, username, password }
            : { url: url.trim(), mac: formattedMac },
    };
    try {
      await addPortal(portal);
      router.back();
    } catch (e: any) {
      Alert.alert("Error", e.message);
    }
  }, [validateInputs, name, type, url, username, password, mac, formatMac, addPortal, router]);

  const handleSaveAndConnect = useCallback(async () => {
    if (!validateInputs()) return;
    try {
      setIsLoading(true);
      setLoadingMessage("Connecting...");
      const id = Date.now().toString();
      let portal: any;
      if (type === "m3u") {
        const api = new M3UApi({ url });
        const result = await api.login();
        if (!result.ok) throw new Error(result.error || "Invalid M3U playlist");
        portal = { id, name, type, config: { url } };
      } else if (type === "xtream") {
        const api = new XtreamApi({ url, username, password });
        await api.login();
        portal = { id, name, type, config: { url, username, password } };
      } else {
        const formattedMac = formatMac(mac);
        const base = {
          id, name, type: "mag" as const,
          config: { url: url.trim(), mac: formattedMac },
        };
        const { token, serverInfo } = await portalApi.authenticate(base);
        portal = {
          id, name, type,
          config: { url: url.trim(), mac: formattedMac, token, serverInfo },
        };
      }
      // Fetch the portal's content first. If it has nothing, don't save or
      // proceed — just tell the user there's no content.
      setLoadingMessage("Loading content...");
      await portalApi.refreshPortalData(portal);
      const s = usePortalStore.getState();
      const total = (s.channels?.length || 0) + (s.vodItems?.length || 0) + (s.series?.length || 0);
      if (total === 0) {
        setIsLoading(false);
        Alert.alert("No Content", "This portal returned no channels, movies, or series.");
        return;
      }

      await addPortal(portal);
      await setActivePortal(portal);
      setIsLoading(false);
      router.replace("/dashboard");
    } catch (e: any) {
      setIsLoading(false);
      Alert.alert("Error", e.message || "Failed to connect");
    }
  }, [validateInputs, type, url, username, password, name, mac, formatMac, addPortal, setActivePortal, router]);

  const handleBack = useCallback(() => {
    if (step === 2) setStep(1);
    else router.back();
  }, [step, router]);

  // OK is delivered via each Pressable's onPress when focused.

  // ── STEP 1 ──────────────────────────────────────────────────────────────────
  const renderStep1 = () => {
    const items: { id: string; icon: any; title: string; desc: string; t: CardType }[] = [
      { id: "select-type-m3u", icon: "format-list-bulleted", title: "M3U Playlist", desc: "Upload an M3U file or provide a remote URL.", t: "m3u" },
      { id: "select-type-xtream", icon: "cloud-sync", title: "Xtream Codes API", desc: "Log in with your server URL, username and password.", t: "xtream" },
      { id: "select-type-mag", icon: "router-wireless", title: "MAC Portal", desc: "Connect via MAC address and portal URL.", t: "mag" },
    ];
    return (
      <View style={S.step1Container}>
        <View style={S.logoRow}>
          <Text style={S.logoTitle}>INFINITY IPTV PLAYER</Text>
        </View>

        <Text style={S.step1Subtitle}>
          Choose the connection method that matches your IPTV provider.
        </Text>

        <View style={S.cardsContainer}>
          {items.map(({ id, icon, title, desc, t }) => {
            const accent = TYPE_ACCENT[t];
            return (
              <GradientBorderCard
                key={id}
                id={id}
                focusedField={focusedField}
                onPress={() => { setType(t); setStep(2); }}
                onFocus={() => setFocusedField(id)}
                onBlur={() => setFocusedField(null)}
              >
                {isTV ? (
                  <>
                    <View style={[S.darkCardIconWrapper, { backgroundColor: accent + "22" }]}>
                      <MaterialCommunityIcons name={icon} size={ps(2.4)} color={accent} />
                    </View>
                    <GradientText text={title} isActive={focusedField === id} style={S.darkCardTitle} />
                    <Text style={S.darkCardDesc}>{desc}</Text>
                  </>
                ) : (
                  <View style={S.cardRow}>
                    <View style={[S.cardRowIcon, { backgroundColor: accent + "22" }]}>
                      <MaterialCommunityIcons name={icon} size={ps(2.4)} color={accent} />
                    </View>
                    <View style={S.cardRowText}>
                      <Text style={S.cardRowTitle} numberOfLines={1}>{title}</Text>
                      <Text style={S.cardRowDesc} numberOfLines={2}>{desc}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={ps(2)} color="#6b7280" />
                  </View>
                )}
              </GradientBorderCard>
            );
          })}
        </View>
      </View>
    );
  };

  // ── STEP 2 ──────────────────────────────────────────────────────────────────
  const renderStep2 = () => {
    const titleMap = { m3u: "M3U Playlist", xtream: "Xtream Codes API", mag: "MAC Portal" };
    return (
      <View style={S.premiumStep2Container}>
        <GlassView intensity={50} style={S.premiumFormCard}>
          <Text style={S.premiumFormTitle}>Connect via {titleMap[type]}</Text>
          <Text style={S.premiumFormSubtitle}>
            Enter your streaming credentials
            {type === "m3u" ? " or import a playlist file" : ""} to access your personalised library.
          </Text>

          {/* Name */}
          <View style={S.premiumInputGroup}>
            <Text style={S.premiumLabel}>{type === "m3u" ? "Playlist name" : "Portal name"}</Text>
            <Focusable
              onPress={() => nameInputRef.current?.focus()}
              ringOnFocus={false}
              onFocus={() => setFocusedField("name")}
              onBlur={() => setFocusedField(null)}
            >
              {(focused) => (
                <GradientBorderInput isFocused={focused || focusedField === "name"}>
                  <TextInput
                    ref={nameInputRef}
                    style={S.premiumInput}
                    placeholder={type === "m3u" ? "e.g. My Premium Streams" : "My IPTV Portal"}
                    placeholderTextColor="#555"
                    value={name}
                    onChangeText={setName}
                    onFocus={() => setFocusedField("name")}
                    onBlur={() => setFocusedField(null)}
                  />
                </GradientBorderInput>
              )}
            </Focusable>
          </View>

          {/* URL */}
          <View style={S.premiumInputGroup}>
            <Text style={S.premiumLabel}>{type === "m3u" ? "M3U URL" : "Portal URL"}</Text>
            <Focusable
              onPress={() => urlInputRef.current?.focus()}
              ringOnFocus={false}
              onFocus={() => setFocusedField("url")}
              onBlur={() => setFocusedField(null)}
            >
              {(focused) => (
                <GradientBorderInput isFocused={focused || focusedField === "url"}>
                  <TextInput
                    ref={urlInputRef}
                    style={S.premiumInput}
                    placeholder={
                      type === "m3u"
                        ? "http://example.com/playlist.m3u"
                        : "http://example.com:8080"
                    }
                    placeholderTextColor="#555"
                    value={url}
                    onChangeText={setUrl}
                    onFocus={() => setFocusedField("url")}
                    onBlur={() => setFocusedField(null)}
                  />
                  <View style={S.urlIconBtn}>
                    <Ionicons name="link" size={ps(1.6)} color="#9ca3af" />
                  </View>
                </GradientBorderInput>
              )}
            </Focusable>
          </View>

          {/* Xtream */}
          {type === "xtream" &&
            (["username", "password"] as const).map((field) => {
              const ref = field === "username" ? userInputRef : passInputRef;
              return (
                <View key={field} style={S.premiumInputGroup}>
                  <Text style={S.premiumLabel}>{field === "username" ? "Username" : "Password"}</Text>
                  <Focusable
                    onPress={() => ref.current?.focus()}
                    ringOnFocus={false}
                    onFocus={() => setFocusedField(field)}
                    onBlur={() => setFocusedField(null)}
                  >
                    {(focused) => (
                      <GradientBorderInput isFocused={focused || focusedField === field}>
                        <TextInput
                          ref={ref}
                          style={S.premiumInput}
                          placeholder={field}
                          placeholderTextColor="#555"
                          secureTextEntry={field === "password"}
                          value={field === "username" ? username : password}
                          onChangeText={field === "username" ? setUsername : setPassword}
                          onFocus={() => setFocusedField(field)}
                          onBlur={() => setFocusedField(null)}
                        />
                      </GradientBorderInput>
                    )}
                  </Focusable>
                </View>
              );
            })}

          {/* MAG */}
          {type === "mag" && (
            <View style={S.premiumInputGroup}>
              <Text style={S.premiumLabel}>MAC address</Text>
              <Focusable
                onPress={() => macInputRef.current?.focus()}
                ringOnFocus={false}
                onFocus={() => setFocusedField("mac")}
                onBlur={() => {
                  setFocusedField(null);
                  setMac((prev) => formatMac(prev));
                }}
              >
                {(focused) => (
                  <GradientBorderInput isFocused={focused || focusedField === "mac"}>
                    <TextInput
                      ref={macInputRef}
                      style={S.premiumInput}
                      placeholder="00:1A:79:XX:XX:XX"
                      placeholderTextColor="#555"
                      value={mac}
                      onChangeText={(t) => setMac(t.replace(/[^a-fA-F0-9:]/g, "").toUpperCase())}
                      onFocus={() => setFocusedField("mac")}
                      onBlur={() => {
                        setFocusedField(null);
                        setMac((prev) => formatMac(prev));
                      }}
                    />
                  </GradientBorderInput>
                )}
              </Focusable>
            </View>
          )}

          {/* M3U — OR divider + browse */}
          {type === "m3u" && (
            <>
              <View style={S.premiumDividerRow}>
                <View style={S.premiumDividerLine} />
                <Text style={S.premiumDividerText}>OR</Text>
                <View style={S.premiumDividerLine} />
              </View>
              <Focusable
                onPress={() => Alert.alert("Browse", "Feature coming soon!")}
                onFocus={() => setFocusedField("browse")}
                onBlur={() => setFocusedField(null)}
                ringOnFocus={false}
                style={[
                  S.premiumBrowseBtn,
                  focusedField === "browse" && S.premiumInputWrapperFocused,
                ]}
              >
                <MaterialCommunityIcons
                  name="file-upload"
                  size={ps(1.8)}
                  color="#8B5CF6"
                  style={{ marginRight: pw(1) }}
                />
                <Text style={S.premiumBrowseBtnText}>Browse Playlist File</Text>
              </Focusable>
            </>
          )}

          {/* Action buttons */}
          <View style={S.actionRow}>
            {/* Save & Connect */}
            <Focusable
              onPress={handleSaveAndConnect}
              onFocus={() => setFocusedField("save-connect")}
              onBlur={() => setFocusedField(null)}
              ringOnFocus={false}
              style={[
                S.connectBtnWrapper,
                focusedField === "save-connect" && { transform: [{ scale: 1.04 }] },
              ]}
            >
              {() => (
                <View style={S.connectBtnGradient}>
                  <Text style={S.connectBtnText}>
                    {type === "m3u" ? "Connect Playlist" : type === "mag" ? "Connect Portal" : "Connect"}
                  </Text>
                </View>
              )}
            </Focusable>

            {/* Save Only (Secondary) */}
            <Focusable
              onPress={handleSave}
              onFocus={() => setFocusedField("save")}
              onBlur={() => setFocusedField(null)}
              ringOnFocus={false}
              style={S.saveOnlyBtnWrapper}
            >
              {(focused) => (
                <View style={[S.saveOnlyBtn, focused && S.saveOnlyBtnFocused]}>
                  <Ionicons name="save-outline" size={ps(1.5)} color="#cbd5e1" style={{ marginRight: pw(1.2) }} />
                  <Text style={S.saveOnlyBtnText}>Save Configuration</Text>
                </View>
              )}
            </Focusable>
          </View>

          <View style={S.disclaimer}>
            <Text style={S.disclaimerTitle}>Content Responsibility</Text>
            <Text style={S.disclaimerText}>
              Infinity IPTV Player does not provide or host media. Please ensure you have permission to access your content.
            </Text>
          </View>
        </GlassView>
      </View>
    );
  };

  // ── Root ─────────────────────────────────────────────────────────────────────
  return (
    <View style={[S.container, { paddingTop: insets.top }]}>
      <CinematicBackground />

      {isLoading && <LoadingOverlay message={loadingMessage} />}

      {step === 2 && (
        <View style={S.premiumHeader}>
          <Text style={S.premiumHeaderTitle}>INFINITY IPTV PLAYER</Text>
        </View>
      )}



      <ScrollView
        style={S.content}
        contentContainerStyle={S.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        removeClippedSubviews={false}
      >
        {step === 1 ? renderStep1() : renderStep2()}
      </ScrollView>
    </View>
  );
}

// ─── StyleSheet ───────────────────────────────────────────────────────────────
// Rules:
//   • All layout sizes  → pw() / ph() / ps()
//   • borderWidth 1–2   → kept absolute (hairlines; scaling would break them)
//   • elevation         → kept absolute (Android Z-axis; unitless)
//   • letterSpacing     → kept small absolute (sub-pixel fine-tuning)
//   • opacity / scale   → unitless ratios, kept as-is
const S = StyleSheet.create({

  // ── Root ──────────────────────────────────────────────────────────────────
  container: {
    flex: 1,
    backgroundColor: "#08080a",
  },
  content: {
    flex: 1,
    paddingHorizontal: pw(2.4),
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "flex-start",
    alignItems: "center",
    paddingBottom: ph(4),
    width: "100%",
  },

  // ── Step-1 back (mobile) ─────────────────────────────────────────────────
  step1BackButton: {
    position: "absolute",
    top: ph(5),
    left: pw(2),
    zIndex: 10,
    width: pw(5),
    height: pw(5),
    justifyContent: "center",
    alignItems: "center",
  },

  // ── Step 1 ───────────────────────────────────────────────────────────────
  step1Container: {
    alignItems: "center",
    marginTop: ph(3),
    width: "100%",
    maxWidth: isTV ? pw(90) : isTablet ? pw(80) : "100%",
    alignSelf: "center",
    paddingBottom: ph(2),
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    gap: pw(1),
    marginBottom: ph(0.6),
  },
  logoTitle: {
    color: "#fff",
    fontSize: ps(2.2),
    fontWeight: fw("600"),
    letterSpacing: 3,
    textAlign: "center",
  },
  step1Subtitle: {
    fontSize: ps(1),
    color: "#9ca3af",
    textAlign: "center",
    marginBottom: isPhone ? ph(2.5) : ph(5),
    lineHeight: ph(2.6),
    paddingHorizontal: pw(6),
  },
  premiumText: {
    color: THEME.colors.primary,
    fontWeight: fw("800"),
  },
  cardsContainer: {
    flexDirection: isTV ? "row" : "column",
    gap: pw(2.5),
    width: "100%",
    justifyContent: "center",
    alignItems: isTV ? "stretch" : "center",
    paddingHorizontal: isTV ? pw(5) : 0,
  },

  // ── Card internals ───────────────────────────────────────────────────────
  darkCardIconWrapper: {
    // pw(7) (~28px) was smaller than the ps(2.4) icon (~33px) on phone, so the
    // icon overflowed its circle. Give touch devices a circle that fits.
    width: Math.max(pw(7), isTV ? 0 : 60),
    height: Math.max(pw(7), isTV ? 0 : 60),
    borderRadius: Math.max(pw(7), isTV ? 0 : 60) / 2,
    backgroundColor: "rgba(255,255,255,0.04)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: isPhone ? ph(1.5) : ph(3),
  },
  darkCardTitle: {
    fontSize: isTV ? ps(2.2) : ps(1.8),
    fontWeight: fw("700"),
    color: "#fff",
    marginBottom: ph(1.2),
    textAlign: "center",
  },
  darkCardDesc: {
    fontSize: isTV ? ps(1.4) : ps(1.2),
    color: "#7e8299",
    textAlign: "center",
    lineHeight: isTV ? ph(3) : ph(2.4),
    paddingHorizontal: pw(1),
  },

  // Phone/tablet: row card (icon · text · trailing chevron)
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(3.5),
    width: "100%",
  },
  cardRowIcon: {
    width: Math.max(pw(8), 56),
    height: Math.max(pw(8), 56),
    borderRadius: Math.max(pw(8), 56) / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  cardRowText: {
    flex: 1,
  },
  cardRowTitle: {
    fontSize: ps(1.7),
    fontWeight: fw("700"),
    color: "#fff",
    marginBottom: ph(0.4),
  },
  cardRowDesc: {
    fontSize: ps(1.15),
    color: "#7e8299",
    lineHeight: ph(2.2),
  },

  // ── Premium header (step 2) ──────────────────────────────────────────────
  premiumHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    paddingHorizontal: pw(3),
    paddingVertical: ph(2),
  },
  premiumHeaderTitle: {
    fontSize: ps(2.2),
    fontWeight: fw("500"),
    color: "#fff",
    letterSpacing: 5,
    textAlign: "center",
  },
  premiumSupportBtnFocused: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: pw(1),
    paddingHorizontal: pw(1),
  },
  premiumTopActionBtn: {
    width: pw(5),
    height: pw(5),
    borderRadius: pw(2.5),
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  premiumTopActionBtnFocused: {
    borderWidth: 2,
    borderColor: THEME.colors.primary,
  },
  premiumSupportBtn: {
    flexDirection: "row",
    alignItems: "center",
  },
  premiumSupportText: {
    color: "#b0b0b0",
    fontSize: ps(1.2),
    fontWeight: fw("600"),
    letterSpacing: 1,
  },

  // ── Step 2 form ──────────────────────────────────────────────────────────
  premiumStep2Container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: ph(4),
    width: "100%",
  },
  premiumFormCard: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    padding: pw(4.5),
    width: "100%",
    maxWidth: isTV ? pw(40) : isTablet ? pw(60) : pw(92),
    overflow: "hidden",
  },
  premiumFormTitle: {
    fontSize: isTV ? ps(2.0) : ps(1.8),
    fontWeight: fw("700"),
    color: "#e2e2e2",
    marginBottom: ph(0.4),
  },
  premiumFormSubtitle: {
    fontSize: isTV ? ps(1.2) : ps(1.0),
    color: "#9ca3af",
    lineHeight: ph(2.0),
    marginBottom: ph(2.0),
  },
  premiumInputGroup: {
    marginBottom: ph(2.2),
  },
  premiumLabel: {
    fontSize: ps(1.1),
    fontWeight: fw("600"),
    color: "#9ca3af",
    letterSpacing: 0.3,
    marginBottom: ph(0.8),
  },
  urlIconBtn: {
    width: ps(3.4),
    height: ps(3.4),
    borderRadius: pw(1),
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: pw(1),
  },
  premiumInput: {
    flex: 1,
    paddingVertical: isTV ? ph(2) : ph(1.9),
    color: "#fff",
    fontSize: isTV ? ps(1.5) : ps(1.3),
  },

  // ── OR divider ───────────────────────────────────────────────────────────
  premiumDividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: ph(2.5),
  },
  premiumDividerLine: {
    flex: 1,
    height: 1,                               // hairline — intentionally absolute
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  premiumDividerText: {
    color: "#555",
    fontSize: ps(1.1),
    fontWeight: fw("700"),
    paddingHorizontal: pw(2),
  },

  // ── Browse button ────────────────────────────────────────────────────────
  premiumBrowseBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 16,
    paddingVertical: isTV ? ph(1.6) : ph(1.4),
  },
  premiumBrowseBtnText: {
    color: "#e2e2e2",
    fontSize: isTV ? ps(1.5) : ps(1.3),
    fontWeight: fw("600"),
  },
  premiumInputWrapperFocused: {
    borderColor: THEME.colors.primary,
    backgroundColor: "rgba(255,255,255,0.08)",
  },

  // ── Action buttons ───────────────────────────────────────────────────────
  actionRow: {
    flexDirection: "column",
    gap: ph(1),
    marginTop: ph(2.5),
    alignItems: "stretch",
  },
  saveOnlyBtnWrapper: {
    borderRadius: 16,
  },
  saveOnlyBtn: {
    flexDirection: "row",
    paddingVertical: isTV ? ph(1.8) : ph(1.5),
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  saveOnlyBtnFocused: {
    borderColor: "#fff",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  saveOnlyBtnText: {
    color: "#cbd5e1",
    fontSize: ps(1.3),
    fontWeight: fw("700"),
  },
  connectBtnWrapper: {
    borderRadius: 18,
    overflow: "hidden",
  },
  connectBtnGradient: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: isTV ? ph(2.0) : ph(1.6),
    borderRadius: 18,
    backgroundColor: "#E6E6EB",
  },
  connectBtnText: {
    color: "#000",
    fontSize: isTV ? ps(1.8) : ps(1.5),
    fontWeight: fw("700"),
    letterSpacing: 0.5,
  },

  // ── Footer ───────────────────────────────────────────────────────────────
  disclaimer: {
    marginTop: ph(3),
    alignItems: "center",
    paddingHorizontal: pw(2),
  },
  disclaimerTitle: {
    color: "rgba(255,255,255,0.5)",
    fontSize: ps(1.05),
    fontWeight: fw("700"),
    marginBottom: ph(0.5),
  },
  disclaimerText: {
    color: "rgba(255,255,255,0.3)",
    fontSize: ps(0.95),
    textAlign: "center",
    lineHeight: ph(2),
  },
});