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
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
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
          shadowColor: THEME.colors.primary,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.55,
          shadowRadius: pw(1.2),
          elevation: 10,
        },
      ]}
    >
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
        <View
          style={{
            flex: 1,
            backgroundColor: THEME.colors.surface,
            borderRadius: focused ? RADIUS - BORDER : RADIUS,
            alignItems: "center",
            justifyContent: "center",
            padding: pw(2.8),
          }}
        >
          {children}
        </View>
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
  const RADIUS = pw(1.2);
  const BORDER = 1.5;

  return (
    <LinearGradient
      colors={isFocused ? [THEME.colors.primary, THEME.colors.secondary] : ["transparent", "transparent"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={[{ borderRadius: RADIUS, padding: isFocused ? BORDER : 0 }, style]}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: "#141318",
          borderRadius: isFocused ? RADIUS - BORDER : RADIUS,
          paddingHorizontal: pw(2),
        }}
      >
        {children}
      </View>
    </LinearGradient>
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
      await addPortal(portal);
      await setActivePortal(portal);
      setLoadingMessage("Fetching categories...");
      await portalApi.refreshPortalData(portal);
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
  const renderStep1 = () => (
    <View style={S.step1Container}>
      <View style={S.logoRow}>
        <Text style={S.logoTitle}>IPTV HUB</Text>
      </View>

      <Text style={S.step1Subtitle}>
        Select your preferred connection method to begin your{"\n"}
        <Text style={S.premiumText}>premium streaming experience</Text>.
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
              <MaterialCommunityIcons name={icon} size={ps(2.4)} color="#f0b6d5" />
            </View>
            <GradientText
              text={title}
              isActive={focusedField === id}
              style={S.darkCardTitle}
            />
            <Text style={S.darkCardDesc}>{desc}</Text>
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
            <Text style={S.premiumLabel}>{type === "m3u" ? "M3U URL" : "PORTAL URL"}</Text>
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
                  <Ionicons
                    name="link"
                    size={ps(1.8)}
                    color="#555"
                    style={{ marginLeft: pw(1) }}
                  />
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
                  <Text style={S.premiumLabel}>{field.toUpperCase()}</Text>
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
              <Text style={S.premiumLabel}>MAC ADDRESS</Text>
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
                  color="#f0b6d5"
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
              {(focused) => (
                <LinearGradient
                  colors={[THEME.colors.primary, THEME.colors.secondary]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0.5 }}
                  style={S.connectBtnGradient}
                >
                  <Text style={S.connectBtnText}>Connect Playlist</Text>
                </LinearGradient>
              )}
            </Focusable>

            {/* Save Only (Secondary) */}
            <Focusable
              onPress={handleSave}
              onFocus={() => setFocusedField("save")}
              onBlur={() => setFocusedField(null)}
              ringOnFocus={false}
              style={[S.saveOnlyBtn, focusedField === "save" && S.saveOnlyBtnFocused]}
            >
              {(focused) => (
                <Text style={S.saveOnlyBtnText}>Save Configuration</Text>
              )}
            </Focusable>
          </View>

          <Text style={S.premiumFooterWarning}>
            IPTV HUB DOES NOT HOST ANY CONTENT. ENSURE YOU HAVE THE LEGAL RIGHT TO USE YOUR PLAYLIST.
          </Text>
        </View>
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
          <Focusable
            onPress={handleBack}
            onFocus={() => setFocusedField("back")}
            onBlur={() => setFocusedField(null)}
            ringOnFocus={false}
            style={[
              S.premiumTopActionBtn,
              focusedField === "back" && S.premiumTopActionBtnFocused,
            ]}
          >
            {(focused) => (
              <Ionicons name="arrow-back" size={ps(2.2)} color="#fff" />
            )}
          </Focusable>

          <Text style={S.premiumHeaderTitle}>IPTV HUB</Text>

          <Focusable
            onPress={() => Alert.alert("Support", "Please visit our website for support.")}
            onFocus={() => setFocusedField("support")}
            onBlur={() => setFocusedField(null)}
            ringOnFocus={false}
            style={[
              S.premiumSupportBtn,
              focusedField === "support" && S.premiumSupportBtnFocused,
            ]}
          >
            {(focused) => (
              <>
                <Ionicons
                  name="help-circle"
                  size={ps(1.8)}
                  color={focusedField === "support" ? "#fff" : "#b0b0b0"}
                  style={{ marginRight: pw(0.5) }}
                />
                <Text style={[S.premiumSupportText, focusedField === "support" && { color: "#fff" }]}>SUPPORT</Text>
              </>
            )}
          </Focusable>
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
    fontSize: ps(3.2),
    fontWeight: "500",
    letterSpacing: 5,
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
    fontWeight: "700",
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
    justifyContent: "space-between",
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
    padding: pw(2.2),
    width: "100%",
    maxWidth: isTV ? pw(40) : pw(90),
  },
  premiumFormTitle: {
    fontSize: isTV ? ps(2.0) : ps(1.8),
    fontWeight: "700",
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