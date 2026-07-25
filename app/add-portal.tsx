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
  KeyboardAvoidingView,
  Image,
  BackHandler,
  Keyboard,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePortalStore } from "../src/store/portalStore";
import { portalApi, formatMac } from "../src/services/portalApi";
import { M3UApi } from "../src/services/m3uApi";
import { XtreamApi } from "../src/services/xtreamApi";
import LoadingOverlay from "../src/components/LoadingOverlay";
import { CinematicBackground } from "../src/components/CinematicBackground";
import { isTV } from "../src/utils/tvUtils";
import { Focusable } from "../src/tv";

import { THEME, pw, ph, ps } from "../src/theme/tokens";

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
  return <Text style={[style, { color: "#000" }]}>{text}</Text>;
};

// ─── Card with gradient border on focus ──────────────────────────────────────
type CardType = "m3u" | "xtream" | "mag";

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
  const RADIUS = pw(2);
  const BORDER = pw(0.2); // ~2 px on a 1080p TV

  return (
    <Focusable
      onPress={onPress}
      onFocus={onFocus}
      onBlur={onBlur}
      ringOnFocus={false}
      style={[
        {
          width: isTV ? "30%" : "100%",
          aspectRatio: isTV ? 1 : undefined,
          minHeight: isTV ? undefined : ph(28),
          borderRadius: RADIUS,
        },
        focused && {
          transform: [{ scale: 1.05 }],
          ...Platform.select({
            ios: {
              shadowColor: "#fff",
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.55,
              shadowRadius: pw(1.2),
            },
            android: {
              elevation: 0,
            }
          })
        },
      ]}
    >
      <BlurView
        intensity={focused ? 70 : 30}
        tint={focused ? "light" : "dark"}
        style={{
          flex: 1,
          borderRadius: RADIUS,
          borderWidth: focused ? BORDER : 0,
          borderColor: focused ? "rgba(255,255,255,0.8)" : "transparent",
          overflow: "hidden",
        }}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: focused ? "rgba(255,255,255,0.3)" : THEME.colors.surface,
            borderRadius: RADIUS,
            alignItems: "center",
            justifyContent: "center",
            padding: pw(2.8),
          }}
        >
          {children}
        </View>
      </BlurView>
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
  const RADIUS = pw(1.2);
  const BORDER = 1.5;

  return (
    <View
      style={[{
        borderRadius: RADIUS,
        borderWidth: isFocused ? BORDER : 0,
        borderColor: isFocused ? "#fff" : "transparent",
        overflow: "hidden",
        width: "100%",
      }, style]}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: "#141318",
          borderRadius: isFocused ? RADIUS - BORDER : RADIUS,
          paddingHorizontal: pw(2),
          width: "100%",
        }}
      >
        {children}
      </View>
    </View>
  );
};

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function AddPortalScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { addPortal, setActivePortal, deletePortal } = usePortalStore();

  const [step, setStep] = useState<1 | 2>(1);
  const [type, setType] = useState<CardType>("m3u");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mac, setMac] = useState("00:1A:79");
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
  }, [name, url, type, username, password, mac]);

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
        const { token, expiry, serverInfo } = await portalApi.authenticate(base);
        portal = {
          id, name, type,
          config: { url: url.trim(), mac: formattedMac, token, expiry, serverInfo },
        };
      }
      await addPortal(portal);
      await setActivePortal(portal);
      setLoadingMessage("Fetching categories...");
      await portalApi.refreshPortalData(portal);

      const store = usePortalStore.getState();
      const hasContent = store.categories.length > 0 || store.channels.length > 0 || store.vodItems.length > 0 || store.series.length > 0;

      if (!hasContent) {
        await deletePortal(portal.id);
        throw new Error("This playlist contains no content.");
      }

      setIsLoading(false);
      router.replace("/dashboard");
    } catch (e: any) {
      setIsLoading(false);
      Alert.alert("Error", e.message || "Failed to connect");
    }
  }, [validateInputs, type, url, username, password, name, mac, addPortal, setActivePortal, deletePortal, router]);

  const handleBack = useCallback(() => {
    if (step === 2) {
      setStep(1);
      return true;
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/portals");
    }
    return true;
  }, [step, router]);

  // Track whether the software keyboard is currently visible so that
  // hardware-back while the keyboard is open is NOT intercepted — Android
  // will dismiss the keyboard first (its default behaviour).  Only once the
  // keyboard is gone do we intercept the next back press for step/nav logic.
  const keyboardVisibleRef = useRef(false);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => { keyboardVisibleRef.current = true; });
    const hide = Keyboard.addListener("keyboardDidHide", () => { keyboardVisibleRef.current = false; });
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Register hardware back handler for Android TV / Android
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      // If keyboard is visible, let Android dismiss it naturally — don't intercept
      if (keyboardVisibleRef.current) return false;
      return handleBack();
    });
    return () => sub.remove();
  }, [handleBack]);

  // OK is delivered via each Pressable's onPress when focused.

  // ── STEP 1 ──────────────────────────────────────────────────────────────────
  const renderStep1 = () => (
    <View style={S.step1Container}>
      <View style={S.logoRow}>
        <Image source={require("../assets/images/TV.png")} style={S.mainLogoImage} resizeMode="contain" />
      </View>

      <Text style={S.step1Subtitle}>
        Select your preferred connection method to begin your{"\n"}
      </Text>

      <View style={S.cardsContainer}>
        {(
          [
            {
              id: "select-type-m3u",
              icon: "format-list-bulleted",
              title: "M3U Playlist",
              desc: "Upload an M3U file or provide a remote URL to load your channel lists.",
              t: "m3u",
            },
            {
              id: "select-type-xtream",
              icon: "cloud-sync",
              title: "Xtream Codes API",
              desc: "Log in with your server URL, username, and password for a fully synced experience.",
              t: "xtream",
            },
            {
              id: "select-type-mag",
              icon: "router-wireless",
              title: "MAC Portal",
              desc: "Connect via MAC address and portal URL. Optimised for legacy STB setups.",
              t: "mag",
            },
          ] as { id: string; icon: any; title: string; desc: string; t: CardType }[]
        ).map(({ id, icon, title, desc, t }) => (
          <GradientBorderCard
            key={id}
            id={id}
            focusedField={focusedField}
            onPress={() => { setType(t); setStep(2); }}
            onFocus={() => setFocusedField(id)}
            onBlur={() => setFocusedField(null)}
          >
            <View style={S.darkCardIconWrapper}>
              <MaterialCommunityIcons name={icon} size={ps(2.4)} color={focusedField === id ? "#000" : "rgba(255,255,255,0.7)"} />
            </View>
            <GradientText
              text={title}
              isActive={focusedField === id}
              style={S.darkCardTitle}
            />
            <Text style={[S.darkCardDesc, focusedField === id && { color: "rgba(0,0,0,0.6)" }]}>{desc}</Text>
          </GradientBorderCard>
        ))}
      </View>
    </View>
  );

  // ── STEP 2 ──────────────────────────────────────────────────────────────────
  const renderStep2 = () => {
    const titleMap = { m3u: "M3U Playlist", xtream: "Xtream Codes API", mag: "MAC Portal" };
    return (
      <View style={S.premiumStep2Container}>
        <View style={S.premiumFormCard}>
          <Text style={S.premiumFormTitle}>Connect via {titleMap[type]}</Text>
          <Text style={S.premiumFormSubtitle}>
            Enter your streaming credentials
            {type === "m3u" ? " or import a playlist file" : ""} to access your personalised library.
          </Text>

          {/* Name */}
          <View style={S.premiumInputGroup}>
            <Text style={S.premiumLabel}>{type === "m3u" ? "PLAYLIST NAME" : "PORTAL NAME"}</Text>
            <GradientBorderInput isFocused={focusedField === "name"}>
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
          </View>

          {/* URL */}
          <View style={S.premiumInputGroup}>
            <Text style={S.premiumLabel}>{type === "m3u" ? "M3U URL" : "PORTAL URL"}</Text>
            <GradientBorderInput isFocused={focusedField === "url"}>
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
                autoCorrect={false}
                autoCapitalize="none"
                spellCheck={false}
                autoComplete="off"
              />
              <Ionicons
                name="link"
                size={ps(1.8)}
                color={focusedField === "url" ? "#fff" : "#555"}
                style={{ marginLeft: pw(1) }}
              />
            </GradientBorderInput>
          </View>

          {/* Xtream */}
          {type === "xtream" &&
            (["username", "password"] as const).map((field) => {
              const ref = field === "username" ? userInputRef : passInputRef;
              return (
                <View key={field} style={S.premiumInputGroup}>
                  <Text style={S.premiumLabel}>{field.toUpperCase()}</Text>
                  <GradientBorderInput isFocused={focusedField === field}>
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
                      autoCorrect={false}
                      autoCapitalize="none"
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </GradientBorderInput>
                </View>
              );
            })}

          {/* MAG */}
          {type === "mag" && (
            <View style={S.premiumInputGroup}>
              <Text style={S.premiumLabel}>MAC ADDRESS</Text>
                <GradientBorderInput isFocused={focusedField === "mac"}>
                  <TextInput
                    ref={macInputRef}
                    style={S.premiumInput}
                    placeholder="00:1A:79:XX:XX:XX"
                    placeholderTextColor="#555"
                    value={mac}
                    onChangeText={setMac}
                    onFocus={() => setFocusedField("mac")}
                    onBlur={() => {
                      setFocusedField(null);
                      setMac((prev) => formatMac(prev));
                    }}
                    autoCorrect={false}
                    autoCapitalize="characters"
                    spellCheck={false}
                    autoComplete="off"
                  />
                </GradientBorderInput>
            </View>
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
              {(focused) => (
                <BlurView
                  intensity={focused ? 0 : 40}
                  tint="dark"
                  style={[S.connectBtnGradient, focused && { backgroundColor: "#fff" }]}
                >
                  <Text style={[S.connectBtnText, focused && { color: "#000" }]}>Connect Playlist</Text>
                </BlurView>
              )}
            </Focusable>

          </View>

          <Text style={S.premiumFooterWarning}>
            INFINITY IPTV PLAYER DOES NOT HOST ANY CONTENT. ENSURE YOU HAVE THE LEGAL RIGHT TO USE YOUR PLAYLIST.
          </Text>
        </View>
      </View>
    );
  };

  // ── Root ─────────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView 
      style={[S.container, { paddingTop: insets.top }]} 
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <CinematicBackground />

      {isLoading && <LoadingOverlay message={loadingMessage} />}

      {step === 2 && (
        <View style={S.premiumHeader}>
          <Image source={require("../assets/images/TV.png")} style={S.headerLogoImage} resizeMode="contain" />
        </View>
      )}

      {step === 1 && !isTV && (
        <TouchableOpacity style={S.step1BackButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={ps(2.4)} color="#fff" />
        </TouchableOpacity>
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
    </KeyboardAvoidingView>
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
    justifyContent: "center",
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
    marginTop: ph(4),
    width: "100%",
    maxWidth: isTV ? pw(90) : "100%",
    alignSelf: "center",
    paddingBottom: ph(2),
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(1),
    marginBottom: ph(1.8),
  },
  logoTitle: {
    color: "#fff",
    fontSize: ps(2.5),
    fontWeight: "500",
    letterSpacing: 2,
  },
  mainLogoImage: {
    width: pw(55),
    aspectRatio: 5,
  },
  headerLogoImage: {
    width: pw(25),
    aspectRatio: 5,
  },
  step1Subtitle: {
    fontSize: ps(1.6),
    color: "#a0a4b8",
    textAlign: "center",
    marginBottom: ph(6),
    lineHeight: ph(3.2),
  },
  premiumText: {
    color: THEME.colors.primary,
    fontWeight: "800",
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
    width: pw(7),
    height: pw(7),
    borderRadius: pw(3.5),
    backgroundColor: "rgba(255,255,255,0.04)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: ph(3),
  },
  darkCardTitle: {
    fontSize: isTV ? ps(2.2) : ps(1.8),
    fontWeight: "500",
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

  // ── Premium header (step 2) ──────────────────────────────────────────────
  premiumHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: pw(3),
    paddingVertical: ph(2),
  },
  premiumHeaderTitle: {
    fontSize: ps(2.2),
    fontWeight: "500",
    color: "#fff",
    letterSpacing: 5,
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
    fontWeight: "600",
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
    backgroundColor: "#1D1B20",
    borderRadius: pw(2),
    padding: pw(4.5),
    width: "100%",
    maxWidth: isTV ? pw(45) : pw(90),
  },
  premiumFormTitle: {
    fontSize: isTV ? ps(2.0) : ps(1.8),
    fontWeight: "700",
    color: "#e2e2e2",
    marginBottom: ph(0.4),
  },
  premiumFormSubtitle: {
    fontSize: isTV ? ps(1.3) : ps(1.0),
    color: "#9ca3af",
    lineHeight: ph(3.0),
    marginTop: ph(2.0),
    marginBottom: ph(2.0),
  },
  premiumInputGroup: {
    marginBottom: ph(1.5),
  },
  premiumLabel: {
    fontSize: ps(1.1),
    fontWeight: "700",
    color: "#b0b0b0",
    letterSpacing: 1.2,
    marginBottom: ph(1),
  },
  premiumInput: {
    flex: 1,
    paddingVertical: isTV ? ph(1.6) : ph(1.4),
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
    fontWeight: "700",
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
    borderRadius: pw(1.2),
    paddingVertical: isTV ? ph(1.6) : ph(1.4),
  },
  premiumBrowseBtnText: {
    color: "#e2e2e2",
    fontSize: isTV ? ps(1.5) : ps(1.3),
    fontWeight: "600",
  },
  premiumInputWrapperFocused: {
    borderColor: "#ff1b8a",
    backgroundColor: "rgba(255,255,255,0.08)",
  },

  // ── Action buttons ───────────────────────────────────────────────────────
  actionRow: {
    flexDirection: "column",
    gap: ph(1),
    marginTop: ph(2.5),
    alignItems: "stretch",
  },
  saveOnlyBtn: {
    paddingVertical: ph(1.2),
    borderRadius: pw(1.2),
    alignItems: "center",
    justifyContent: "center",
    marginTop: ph(1),
  },
  saveOnlyBtnFocused: {
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  saveOnlyBtnText: {
    color: "#777",
    fontSize: ps(1.3),
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  connectBtnWrapper: {
    borderRadius: pw(1.2),
    overflow: "hidden",
  },
  connectBtnGradient: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: isTV ? ph(2.0) : ph(1.6),
  },
  connectBtnText: {
    color: "#fff",
    fontSize: isTV ? ps(1.8) : ps(1.5),
    fontWeight: "700",
    letterSpacing: 0.5,
  },

  // ── Footer ───────────────────────────────────────────────────────────────
  premiumFooterWarning: {
    color: "#555",
    fontSize: ps(1.0),
    textAlign: "center",
    marginTop: ph(4),
    fontWeight: "600",
    letterSpacing: 0.8,
  },
});