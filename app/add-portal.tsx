import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
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
import { useDialog } from "../src/components/ConfirmDialog";
import { isTV } from "../src/utils/tvUtils";
import { Focusable } from "../src/tv";

import { THEME, pw, ph, ps } from "../src/theme/tokens";

/** Breathing room left between a focused field and the top of the keyboard. */
const KEYBOARD_GAP = ph(3);

const { height: WINDOW_H } = Dimensions.get("window");

/**
 * Share of the screen the IME is assumed to cover when the platform reports no
 * keyboard metrics.
 *
 * Android derives `keyboardDidShow` from the root view's height changing, and
 * under Android 15 edge-to-edge the window is never resized — so on this app
 * the event does not fire at all and `endCoordinates` is never available. The
 * fields still have to get out from under the IME, so when there are no real
 * metrics we assume a generously tall keyboard instead. A too-large assumption
 * only over-scrolls slightly; a too-small one leaves the field hidden.
 */
const ASSUMED_KEYBOARD_FRACTION = 0.55;

/** Focus targets that raise the IME. Buttons in the same form must not. */
const TEXT_FIELDS = new Set(["name", "url", "username", "password", "mac"]);

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
  return <Text style={[style, { color: "#fff", textShadowColor: "rgba(255,255,255,0.5)", textShadowRadius: 8 }]}>{text}</Text>;
};

// ─── Card with gradient border on focus ──────────────────────────────────────
type CardType = "m3u" | "xtream" | "mag";

const GradientBorderCard = ({
  id,
  focusedField,
  preferred,
  onPress,
  onFocus,
  onBlur,
  children,
}: {
  id: string;
  focusedField: string | null;
  /** Claims the screen's initial focus. Pulsed, never latched — see the caller. */
  preferred?: boolean;
  onPress: () => void;
  onFocus: () => void;
  onBlur: () => void;
  children: React.ReactNode;
}) => {
  const focused = focusedField === id;
  const RADIUS = pw(2);
  const BORDER = 1.5; // ~2 px on a 1080p TV

  return (
    <Focusable
      onPress={onPress}
      onFocus={onFocus}
      onBlur={onBlur}
      hasTVPreferredFocus={preferred}
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
        intensity={focused ? 40 : 20}
        tint="dark"
        style={{
          flex: 1,
          borderRadius: RADIUS,
          borderWidth: focused ? BORDER : 1,
          borderColor: focused ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.05)",
          overflow: "hidden",
        }}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: focused ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.02)",
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
          backgroundColor: "rgba(20, 19, 24, 0.6)",
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
  // Selectors — see the note in live-tv.tsx.
  const addPortal = usePortalStore((s) => s.addPortal);
  const setActivePortal = usePortalStore((s) => s.setActivePortal);
  const deletePortal = usePortalStore((s) => s.deletePortal);

  const [step, setStep] = useState<1 | 2>(1);
  const [type, setType] = useState<CardType>("m3u");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mac, setMac] = useState("00:1A:79:");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");

  const [focusedField, setFocusedField] = useState<string | null>(null);
  const focusedFieldRef = useRef<string | null>(null);

  // Hands step 1's initial focus to the M3U card. Seeded from `step` rather than
  // raised in the effect, because the native focus engine reads the tree as the
  // screen appears — a flag arriving one render later is already too late.
  //
  // A pulse, not a latch: `hasTVPreferredFocus` left permanently true re-claims
  // focus every time the card remounts, which would drag the user back here from
  // wherever they had navigated. Re-pulsing on `step` also restores focus to the
  // card when they come back from step 2.
  const [focusFirstCard, setFocusFirstCard] = useState(step === 1);
  useEffect(() => {
    if (step !== 1) return;
    setFocusFirstCard(true);
    const timer = setTimeout(() => setFocusFirstCard(false), 400);
    return () => clearTimeout(timer);
  }, [step]);

  const nameInputRef = useRef<TextInput>(null);
  const urlInputRef = useRef<TextInput>(null);
  const userInputRef = useRef<TextInput>(null);
  const passInputRef = useRef<TextInput>(null);
  const macInputRef = useRef<TextInput>(null);

  // `Alert.alert` is unusable here: on an Android TV release build it does not
  // reliably surface, and the D-pad cannot reach its buttons — so a failed
  // validation looked like the Connect button was simply dead.
  const { notify, node: dialogNode } = useDialog();

  useEffect(() => {
    focusedFieldRef.current = focusedField;
  }, [focusedField]);

  /** Surfaces a blocking message. The keyboard is dismissed first so the
   *  dialog is not hidden behind it on phones. */
  const showError = useCallback(
    (message: string, title = "Check Your Details") => {
      Keyboard.dismiss();
      notify(title, message, "danger");
    },
    [notify]
  );

  const validateInputs = useCallback(() => {
    if (!name.trim()) { showError("Enter a name for this portal."); return false; }
    if (!url.trim()) { showError("Enter the portal URL."); return false; }
    if (type === "xtream" && (!username.trim() || !password.trim())) {
      showError("Xtream Codes requires both a username and a password.");
      return false;
    }
    if (type === "mag") {
      const formatted = formatMac(mac);
      if (!formatted.trim() || formatted.replace(/:/g, "").length !== 12) {
        showError("Enter a valid 12-digit MAC address.");
        return false;
      }
    }
    return true;
  }, [name, url, type, username, password, mac, showError]);

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
      await portalApi.refreshPortalData(portal, true);

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
      showError(e?.message || "Failed to connect. Check the details and try again.", "Connection Failed");
    }
  }, [validateInputs, type, url, username, password, name, mac, addPortal, setActivePortal, deletePortal, router, showError]);

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

  // ── Keyboard ───────────────────────────────────────────────────────────────
  // The IME is handled entirely off *focus*, not off keyboard events, because
  // on this app there are none to work with (see ASSUMED_KEYBOARD_FRACTION).
  // Two things are needed and neither happens by itself:
  //   1. scroll range — the form is vertically centred, so the content exactly
  //      fills the viewport and nothing can be scrolled anywhere;
  //   2. the scroll itself — `adjustResize` no longer resizes the window, so
  //      the system never lifts the focused input above the keyboard.
  // So while a text field holds focus the form is top-aligned with the
  // keyboard's height reserved beneath it, and the field is scrolled up by its
  // measured overlap with the keyboard. Real keyboard metrics are still used
  // when the platform provides them; they just aren't required.

  // Track whether the software keyboard is currently visible so that
  // hardware-back while the keyboard is open is NOT intercepted — Android
  // will dismiss the keyboard first (its default behaviour).  Only once the
  // keyboard is gone do we intercept the next back press for step/nav logic.
  const keyboardVisibleRef = useRef(false);
  /** Top edge of the keyboard in screen coordinates, when the platform says. */
  const keyboardTopRef = useRef<number | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const scrollRef = useRef<ScrollView>(null);
  const scrollOffsetRef = useRef(0);
  /** The TextInput holding focus, so the effect below can still reach it. */
  const activeInputRef = useRef<TextInput | null>(null);

  const textFieldFocused = focusedField !== null && TEXT_FIELDS.has(focusedField);
  // iOS is exempt: the root KeyboardAvoidingView already shrinks the layout.
  const liftForKeyboard = Platform.OS !== "ios" && textFieldFocused;
  const keyboardReserve = keyboardHeight > 0 ? keyboardHeight : WINDOW_H * ASSUMED_KEYBOARD_FRACTION;

  const ensureInputVisible = useCallback(() => {
    const input = activeInputRef.current;
    if (!input) return;
    const keyboardTop = keyboardTopRef.current ?? WINDOW_H * (1 - ASSUMED_KEYBOARD_FRACTION);

    // A frame's grace so native layout has picked up the reserved bottom
    // padding — until it has, `scrollTo` is clamped to the old content size.
    requestAnimationFrame(() => {
      input.measureInWindow?.((_x, y, _w, height) => {
        const overlap = y + height + KEYBOARD_GAP - keyboardTop;
        if (overlap <= 0) return;
        scrollRef.current?.scrollTo({ y: scrollOffsetRef.current + overlap, animated: true });
      });
    });
  }, []);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => {
      keyboardVisibleRef.current = true;
      const height = e.endCoordinates?.height ?? 0;
      keyboardTopRef.current = e.endCoordinates?.screenY ?? WINDOW_H - height;
      setKeyboardHeight(height);
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      keyboardVisibleRef.current = false;
      keyboardTopRef.current = null;
      setKeyboardHeight(0);
      // The IME can be dismissed while its field keeps focus (its own ✓ or Back
      // key). Dropping focus as well routes that through the same un-lift path
      // below, so the layout never disagrees with what is on screen.
      activeInputRef.current?.blur?.();
    });
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Post-commit, so the reserved padding — and the scroll range it creates —
  // already exists. Keyed on the focused field so moving between fields
  // re-scrolls, and on keyboardHeight so real metrics refine the result on
  // platforms that report them.
  useEffect(() => {
    if (focusedField === null || !TEXT_FIELDS.has(focusedField)) return;
    ensureInputVisible();
  }, [focusedField, keyboardHeight, ensureInputVisible]);

  // Keyboard gone: undo the lift. Without this the form stays parked wherever
  // the last field scrolled it to, and re-centring alone would not bring it
  // back — the reserved padding disappears, but the scroll offset does not.
  // Guarded on the lifted→not-lifted transition so it never fights the user on
  // mount or when stepping between screens.
  const wasLiftedRef = useRef(false);
  useEffect(() => {
    if (textFieldFocused) {
      wasLiftedRef.current = true;
      return;
    }
    if (!wasLiftedRef.current) return;
    wasLiftedRef.current = false;
    scrollOffsetRef.current = 0;
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, [textFieldFocused]);

  /** Records which input holds focus; the effect above does the scrolling. */
  const handleInputFocus = useCallback((field: string, input: TextInput | null) => {
    setFocusedField(field);
    activeInputRef.current = input;
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
            // M3U is the most common connection method, so it owns step 1's
            // initial focus.
            preferred={focusFirstCard && t === "m3u"}
            onPress={() => { setType(t); setStep(2); }}
            onFocus={() => setFocusedField(id)}
            onBlur={() => setFocusedField(null)}
          >
            <View style={S.darkCardIconWrapper}>
              <MaterialCommunityIcons name={icon} size={isTV ? ps(2.4) : 28} color={focusedField === id ? "#fff" : "rgba(255,255,255,0.7)"} />
            </View>
            <GradientText
              text={title}
              isActive={focusedField === id}
              style={S.darkCardTitle}
            />
            <Text style={[S.darkCardDesc, focusedField === id && { color: "#fff" }]}>{desc}</Text>
          </GradientBorderCard>
        ))}
      </View>
    </View>
  );

  // ── STEP 2 ──────────────────────────────────────────────────────────────────
  const renderStep2 = () => {
    const titleMap = { m3u: "M3U Playlist", xtream: "Xtream Codes API", mag: "MAC Portal" };
    return (
      <View style={[S.premiumStep2Container, liftForKeyboard && S.premiumStep2ContainerLifted]}>
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
                onFocus={() => handleInputFocus("name", nameInputRef.current)}
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
                onFocus={() => handleInputFocus("url", urlInputRef.current)}
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
                      onFocus={() => handleInputFocus(field, ref.current)}
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
                  onFocus={() => handleInputFocus("mac", macInputRef.current)}
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
            Infinity IPTV Player TV DOES NOT HOST ANY CONTENT. ENSURE YOU HAVE THE LEGAL RIGHT TO USE YOUR PLAYLIST.
          </Text>
        </View>
      </View>
    );
  };

  // ── Root ─────────────────────────────────────────────────────────────────────
  // On Android, KeyboardAvoidingView with behavior="height" physically shrinks
  // the container when the keyboard opens, and does NOT reliably restore its
  // height when the keyboard dismisses — causing a blank-screen layout. Android
  // instead reserves the keyboard's height inside the ScrollView (see the
  // keyboard section above), which leaves the root layout untouched.
  const rootStyle = [S.container, { paddingTop: insets.top }];
  const inner = (
    <>
      <CinematicBackground />

      {isLoading && <LoadingOverlay message={loadingMessage} />}

      {step === 2 && (
        <View style={S.premiumHeader}>
          <Image source={require("../assets/images/TV.png")} style={S.headerLogoImage} resizeMode="contain" />
        </View>
      )}

      <ScrollView
        ref={scrollRef}
        style={S.content}
        contentContainerStyle={[
          S.scrollContent,
          // Centred content gives the ScrollView zero scroll range, so while the
          // keyboard is up the form is top-aligned and the keyboard's height is
          // reserved below it.
          liftForKeyboard && { justifyContent: "flex-start", paddingBottom: keyboardReserve + ph(4) },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onScroll={(e) => { scrollOffsetRef.current = e.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={16}
      >
        {step === 1 ? renderStep1() : renderStep2()}
      </ScrollView>

      {/* Last in the tree so the overlay layers above the form. */}
      {dialogNode}
    </>
  );

  return Platform.OS === "ios" ? (
    <KeyboardAvoidingView style={rootStyle} behavior="padding">
      {inner}
    </KeyboardAvoidingView>
  ) : (
    <View style={rootStyle}>{inner}</View>
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
    backgroundColor: "transparent",
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
    width: pw(30),
    height: ph(20),
    transform: [{ scale: 1.5 }],
  },
  headerLogoImage: {
    width: pw(25),
    height: ph(8),
    transform: [{ scale: 2.5 }],
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
    fontSize: isTV ? ps(1.6) : 20,
    fontWeight: "500",
    color: "#fff",
    marginBottom: 8,
    textAlign: "center",
  },
  darkCardDesc: {
    fontSize: isTV ? ps(1.2) : 13,
    color: "#7e8299",
    textAlign: "center",
    lineHeight: isTV ? ph(3) : 20,
    paddingHorizontal: 8,
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
    borderWidth: 1,
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
  /** Keyboard open: drop the vertical centring so the form starts at the top
   *  and the fields sit as high as possible above the IME. */
  premiumStep2ContainerLifted: {
    flex: 0,
    justifyContent: "flex-start",
    paddingVertical: ph(2),
  },
  premiumFormCard: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: pw(2),
    padding: 24,
    width: "100%",
    maxWidth: isTV ? pw(45) : 380,
  },
  premiumFormTitle: {
    fontSize: isTV ? ps(1.8) : 20,
    fontWeight: "700",
    color: "#e2e2e2",
    marginBottom: ph(0.2),
  },
  premiumFormSubtitle: {
    fontSize: isTV ? ps(1.2) : 12,
    color: "#9ca3af",
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 16,
  },
  premiumInputGroup: {
    marginBottom: 12,
  },
  premiumLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#b0b0b0",
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  premiumInput: {
    flex: 1,
    paddingVertical: isTV ? ph(1.6) : 10,
    color: "#fff",
    fontSize: isTV ? ps(1.5) : 12,
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
    paddingVertical: isTV ? ph(2.0) : 12,
  },
  connectBtnText: {
    color: "#fff",
    fontSize: isTV ? ps(1.6) : 14,
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