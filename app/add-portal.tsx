import React, { useState, useCallback, useRef, useEffect } from "react";
import { View, StyleSheet, ScrollView, Image, BackHandler, Keyboard, Platform, useWindowDimensions } from 'react-native';
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Server, Cloud, List } from "lucide-react-native";
import { usePortalStore } from "../src/store/portalStore";
import { portalApi, formatMac } from "../src/services/portalApi";
import { M3UApi } from "../src/services/m3uApi";
import { XtreamApi } from "../src/services/xtreamApi";
import LoadingOverlay from "../src/components/LoadingOverlay";
import { useDialog } from "../src/components/ConfirmDialog";
import { safeBack } from "../src/services/safeNavigation";
import { Focusable } from "../src/tv";
import { isPhone, PHONE_H_PAD } from "../src/utils/phoneUtils";
import { isTouch } from "../src/utils/tabletUtils";

import { pw, ph, ps } from "../src/theme/tokens";
import { Text } from '../src/components/Text';
import { TextInput } from '../src/components/TextInput';



// ─── Card with focus state (reduced border radius, borderless #17181c) ───────
type CardType = "m3u" | "xtream" | "mag";

const GradientBorderCard = ({
  id,
  focusedField,
  preferred,
  onPress,
  onFocus,
  onBlur,
  children,
  style,
}: {
  id: string;
  focusedField: string | null;
  /** Claims the screen's initial focus. Pulsed, never latched — see the caller. */
  preferred?: boolean;
  onPress: () => void;
  onFocus: () => void;
  onBlur: () => void;
  children: React.ReactNode;
  style?: any;
}) => {
  const focused = focusedField === id;
  const RADIUS = 18;

  return (
    <Focusable
      onPress={onPress}
      onFocus={onFocus}
      onBlur={onBlur}
      hasTVPreferredFocus={preferred}
      ringOnFocus={false}
      style={[
        {
          width: "30%",
          aspectRatio: 1,
          borderRadius: RADIUS,
          backgroundColor: focused ? "#FFFFFF" : "#17181c",
          borderWidth: 0,
          borderColor: "transparent",
          overflow: "hidden",
        },
        style,
        focused && {
          transform: [{ scale: 1.05 }],
        },
      ]}
    >
      <View
        style={{
          flex: 1,
          borderRadius: RADIUS,
          alignItems: "center",
          justifyContent: "center",
          padding: pw(2.8),
        }}
      >
        {children}
      </View>
    </Focusable>
  );
};

// ─── Input with focus ring (reduced border radius) ──────────────────────────
const ThemedInput = ({
  isFocused,
  children,
  style,
}: {
  isFocused: boolean;
  children: React.ReactNode;
  style?: any;
}) => {
  return (
    <View
      style={[
        S.inputBox,
        isFocused && S.inputBoxFocused,
        style,
      ]}
    >
      {children}
    </View>
  );
};

// ─── Original Brand Logo Header ──────────────────────────────────────────────
const BrandHeader = () => (
  <View style={S.brandHeader}>
    <Image
      source={require("../assets/images/TV.png")}
      style={S.brandLogoImage}
      resizeMode="contain"
    />
  </View>
);

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function AddPortalScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // `!Platform.isTV`, not `isTablet` — the same expression every other screen
  // uses. Gated on `isTablet` this was false on every phone, so a handset held
  // upright rendered the two-column landscape form off the side of the screen.
  const isPortrait = !Platform.isTV && windowHeight > windowWidth;

  // Selectors — see the note in live-tv.tsx.
  const addPortal = usePortalStore((s) => s.addPortal);
  const setActivePortal = usePortalStore((s) => s.setActivePortal);
  const deletePortal = usePortalStore((s) => s.deletePortal);

  const [step, setStep] = useState<1 | 2>(1);
  const [type, setType] = useState<CardType>("mag");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mac, setMac] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");

  const [focusedField, setFocusedField] = useState<string | null>(null);

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

  // `Alert.alert` is unusable here: on an Android TV release build it does not
  // reliably surface, and the D-pad cannot reach its buttons — so a failed
  // validation looked like the Connect button was simply dead.
  const { notify, node: dialogNode } = useDialog();

  /** Surfaces a blocking message. */
  const showError = useCallback(
    (message: string, title = "Check Your Details") => {
      notify(title, message, "danger");
    },
    [notify]
  );

  const validateInputs = useCallback(() => {
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
  }, [url, type, username, password, mac, showError]);

  const handleSaveAndConnect = useCallback(async () => {
    if (!validateInputs()) return;
    try {
      setIsLoading(true);
      setLoadingMessage("Connecting...");
      const id = Date.now().toString();
      const portalName = name.trim() || "TV";
      let portal: any;
      if (type === "m3u") {
        const api = new M3UApi({ url });
        const result = await api.login();
        if (!result.ok) throw new Error(result.error || "Invalid M3U playlist");
        portal = { id, name: portalName, type, config: { url } };
      } else if (type === "xtream") {
        const api = new XtreamApi({ url, username, password });
        await api.login();
        portal = { id, name: portalName, type, config: { url, username, password } };
      } else {
        const formattedMac = formatMac(mac);
        const base = {
          id, name: portalName, type: "mag" as const,
          config: { url: url.trim(), mac: formattedMac },
        };
        const { token, expiry, serverInfo } = await portalApi.authenticate(base);
        portal = {
          id, name: portalName, type,
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
    return safeBack();
  }, [step]);

  // ── Keyboard & Back Handling ───────────────────────────────────────────────
  // Track whether the software keyboard is currently visible so that
  // hardware-back while the keyboard is open is NOT intercepted — Android
  // will dismiss the keyboard first (its default behaviour).
  const keyboardVisibleRef = useRef(false);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => {
      keyboardVisibleRef.current = true;
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      keyboardVisibleRef.current = false;
    });
    return () => { show.remove(); hide.remove(); };
  }, []);

  const handleInputFocus = useCallback((field: string) => {
    setFocusedField(field);
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
      <BrandHeader />

      {/* The same 10 the step-2 form takes, so the type cards and the fields
          that follow them sit on one left edge rather than stepping inward
          between the two pages. */}
      <View style={[S.cardsContainer, isPortrait && { flexDirection: "column", gap: 16, paddingHorizontal: 10 }]}>
        {(
          [
            {
              id: "select-type-mag",
              icon: Server,
              title: "STB Portal",
              desc: "Connect via MAC address and portal URL. Optimised for legacy STB setups.",
              t: "mag",
            },
            {
              id: "select-type-xtream",
              icon: Cloud,
              title: "Xtream Codes",
              desc: "Log in with your server URL, username, and password for a fully synced experience.",
              t: "xtream",
            },
            {
              id: "select-type-m3u",
              icon: List,
              title: "M3U Playlist",
              desc: "Upload an M3U file or provide a remote URL to load your channel lists.",
              t: "m3u",
            },
          ] as { id: string; icon: any; title: string; desc: string; t: CardType }[]
        ).map(({ id, icon: IconComponent, title, desc, t }) => {
          const isFocused = focusedField === id;
          return (
            <GradientBorderCard
              key={id}
              id={id}
              focusedField={focusedField}
              preferred={focusFirstCard && t === "mag"}
              style={isPortrait ? { width: "100%", aspectRatio: undefined, minHeight: 110 } : undefined}
              onPress={() => { setType(t); setStep(2); }}
              onFocus={() => setFocusedField(id)}
              onBlur={() => setFocusedField(null)}
            >
              <View style={S.darkCardIconWrapper}>
                <IconComponent size={ps(3)} color={isFocused ? "#000000" : "rgba(255,255,255,0.75)"} />
              </View>
              <Text style={[S.darkCardTitle, isFocused && { color: "#000000" }]}>
                {title}
              </Text>
              <Text style={[S.darkCardDesc, isFocused && { color: "rgba(0,0,0,0.65)" }]}>{desc}</Text>
            </GradientBorderCard>
          );
        })}
      </View>
    </View>
  );

  // ── STEP 2 ──────────────────────────────────────────────────────────────────
  const renderStep2 = () => {
    const portalTitleMap: Record<CardType, string> = {
      mag: "STB Portal",
      xtream: "Xtream Codes",
      m3u: "M3U Playlist",
    };

    return (
      <View style={S.ventoxStep2Container}>
        {/* Top Header with original logo */}
        <BrandHeader />

        {/* 2-Column Split Layout */}
        {/* A little more inset than the 8dp page gutter — the fields read as
            cramped sitting almost flush to the screen edge. Applied to the row
            rather than the field column so the headline stays aligned with the
            inputs beneath it. */}
        <View style={[S.ventoxTwoColRow, isPortrait && { flexDirection: "column", alignItems: "stretch", maxWidth: "100%", paddingHorizontal: 10 }]}>
          {/* Left Column */}
          <View style={[S.ventoxLeftCol, isPortrait && { paddingRight: 0, marginBottom: 20 }]}>
            <Text style={S.ventoxHeadlinePre}>Start watching with</Text>
            <Text style={S.ventoxHeadlineMain}>{portalTitleMap[type]}</Text>
          </View>

          {/* Right Column */}
          <View style={[S.ventoxRightCol, isPortrait && { width: "100%" }]}>
            {/* Name input */}
            <ThemedInput isFocused={focusedField === "name"}>
              <TextInput
                style={S.textInput}
                placeholder="TV"
                placeholderTextColor="rgba(255, 255, 255, 0.65)"
                value={name}
                onChangeText={setName}
                onFocus={() => handleInputFocus("name")}
                onBlur={() => setFocusedField((cur) => (cur === "name" ? null : cur))}
                autoCorrect={false}
                autoCapitalize="words"
              />
            </ThemedInput>

            {/* URL input */}
            <ThemedInput isFocused={focusedField === "url"}>
              <TextInput
                style={S.textInput}
                placeholder={type === "m3u" ? "http://livebox.pro/playlist.m3u" : "http://livebox.pro/"}
                placeholderTextColor="rgba(255, 255, 255, 0.65)"
                value={url}
                onChangeText={setUrl}
                onFocus={() => handleInputFocus("url")}
                onBlur={() => setFocusedField((cur) => (cur === "url" ? null : cur))}
                autoCorrect={false}
                autoCapitalize="none"
              />
            </ThemedInput>

            {/* Xtream specific inputs */}
            {type === "xtream" && (
              <>
                <ThemedInput isFocused={focusedField === "username"}>
                  <TextInput
                    style={S.textInput}
                    placeholder="Username"
                    placeholderTextColor="rgba(255, 255, 255, 0.65)"
                    value={username}
                    onChangeText={setUsername}
                    onFocus={() => handleInputFocus("username")}
                    onBlur={() => setFocusedField((cur) => (cur === "username" ? null : cur))}
                    autoCorrect={false}
                    autoCapitalize="none"
                  />
                </ThemedInput>

                <ThemedInput isFocused={focusedField === "password"}>
                  <TextInput
                    style={S.textInput}
                    placeholder="Password"
                    placeholderTextColor="rgba(255, 255, 255, 0.65)"
                    secureTextEntry
                    value={password}
                    onChangeText={setPassword}
                    onFocus={() => handleInputFocus("password")}
                    onBlur={() => setFocusedField((cur) => (cur === "password" ? null : cur))}
                    autoCorrect={false}
                    autoCapitalize="none"
                  />
                </ThemedInput>
              </>
            )}

            {/* MAG specific MAC input */}
            {type === "mag" && (
              <ThemedInput isFocused={focusedField === "mac"}>
                <TextInput
                  style={S.textInput}
                  placeholder="00:1a:79:bc:ad:4a"
                  placeholderTextColor="rgba(255, 255, 255, 0.65)"
                  value={mac}
                  onChangeText={setMac}
                  onFocus={() => handleInputFocus("mac")}
                  onBlur={() => {
                    setFocusedField((cur) => (cur === "mac" ? null : cur));
                    setMac((prev) => (prev ? formatMac(prev) : ""));
                  }}
                  autoCorrect={false}
                  autoCapitalize="characters"
                />
              </ThemedInput>
            )}

            {/* Add Button - Black & White Theme */}
            <Focusable
              onPress={handleSaveAndConnect}
              onFocus={() => setFocusedField("save-connect")}
              onBlur={() => setFocusedField(null)}
              ringOnFocus={false}
              style={[
                S.themeAddBtn,
                focusedField === "save-connect" && S.themeAddBtnFocused,
              ]}
            >
              <Text
                style={[
                  S.themeAddBtnText,
                  focusedField === "save-connect" && S.themeAddBtnTextFocused,
                ]}
              >
                Add
              </Text>
            </Focusable>
          </View>
        </View>
      </View>
    );
  };

  // ── Root ─────────────────────────────────────────────────────────────────────
  const inner = (
    <>
      {isLoading && <LoadingOverlay message={loadingMessage} />}

      <ScrollView
        style={S.content}
        contentContainerStyle={[S.scrollContent, isTouch && { paddingBottom: insets.bottom + 36 }]}
        showsVerticalScrollIndicator={false}
      >
        {step === 1 ? renderStep1() : renderStep2()}
      </ScrollView>

      {/* Last in the tree so the overlay layers above the form. */}
      {dialogNode}
    </>
  );

  return (
    <View style={[S.container, { paddingTop: insets.top }]}>{inner}</View>
  );
}

// ─── StyleSheet ───────────────────────────────────────────────────────────────
const S = StyleSheet.create({

  // ── Root ──────────────────────────────────────────────────────────────────
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  content: {
    flex: 1,
    // The one gutter on a phone: `pw(2.4)` is 21dp a side and the step
    // containers were each adding another 16 on top of it. Those now
    // contribute 0 and this is the whole margin.
    paddingHorizontal: isPhone ? PHONE_H_PAD : pw(2.4),
  },
  scrollContent: {
    flexGrow: 1,
    // Top-aligned on a phone. Centring is right on a TV, where the form is a
    // short block on a wide canvas — but on a handset it pushed the brand mark
    // into the middle of the screen with the fields trailing off the bottom.
    justifyContent: isPhone ? "flex-start" : "center",
    alignItems: "center",
    paddingBottom: ph(4),
    width: "100%",
  },

  // ── Brand Header (Original Theme) ─────────────────────────────────────────
  /*
   * The phone logo is a 3:2 box at scale 1, so `contain` fills it exactly and
   * the numbers here are the rendered ones.
   *
   * They were not before. `contain` fits the image inside the box *before* the
   * transform, and a 349x47 box is far wider than the asset's 3:2 — so it was
   * height-limited to 70x47 and `scale: 2.6` blew that to 184x123 inside a
   * 47dp header: a 75dp overflow, on top of a -20dp margin already pulling the
   * whole thing upward. Same trap as the portals and dashboard headers.
   */
  brandHeader: {
    alignItems: "center",
    justifyContent: "center",
    height: isPhone ? 100 : ph(12),
    marginTop: isPhone ? 0 : -ph(5),
    marginBottom: isPhone ? 16 : ph(6),
  },
  brandLogoImage: {
    width: isPhone ? 150 : pw(40),
    height: isPhone ? 100 : ph(12),
    transform: [{ scale: isPhone ? 1 : 2.6 }],
  },

  // ── Step 1 ───────────────────────────────────────────────────────────────
  step1Container: {
    alignItems: "center",
    marginTop: ph(2),
    width: "100%",
    maxWidth: pw(90),
    alignSelf: "center",
    paddingBottom: ph(2),
  },
  cardsContainer: {
    flexDirection: "row",
    gap: pw(2.5),
    width: "100%",
    justifyContent: "center",
    alignItems: "stretch",
    paddingHorizontal: pw(5),
    marginTop: ph(2),
  },

  // ── Card internals ───────────────────────────────────────────────────────
  darkCardIconWrapper: {
    justifyContent: "center",
    alignItems: "center",
    marginBottom: ph(2),
  },
  darkCardTitle: {
    fontSize: ps(1.6),
    fontWeight: "600",
    color: "#fff",
    marginBottom: 8,
    textAlign: "center",
  },
  /*
   * Leading is a multiple of the font size, not `ph()`.
   *
   * `ps` is normalised to the reference canvas on a phone and `ph` is not, so a
   * `ph()` leading against a `ps()` font size holds only on the canvas it was
   * measured on. Here it was 1.38x the font on the box and 1.01x on a handset;
   * the two headlines below were worse — leading *below* the font size, which
   * clips the glyphs rather than merely crowding them. The multipliers are the
   * ratios the box already renders, so this is identical on TV and tablet.
   */
  darkCardDesc: {
    fontSize: ps(1.2),
    color: "#7e8299",
    textAlign: "center",
    lineHeight: ps(1.2) * 1.3846,
    paddingHorizontal: 8,
  },

  // ── Step 2 Layout ─────────────────────────────────────────────────────────
  ventoxStep2Container: {
    /*
     * Top-aligned on a phone.
     *
     * `scrollContent` was switched to `flex-start` for this, but it had no
     * effect on step 2: this container is `flex: 1` inside it and centres its
     * own children, so it stretched to the full height and re-centred the form
     * — brand mark in the middle of the screen, fields running off the bottom.
     * Both have to agree, so this one sizes to its content on a phone.
     */
    flex: isPhone ? 0 : 1,
    width: "100%",
    alignItems: "center",
    justifyContent: isPhone ? "flex-start" : "center",
    paddingVertical: isPhone ? 0 : ph(2),
  },
  ventoxTwoColRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    maxWidth: pw(84),
    marginTop: ph(1),
  },
  ventoxLeftCol: {
    flex: 1,
    paddingRight: pw(5),
    marginBottom: 0,
    alignItems: "flex-start",
  },
  /*
   * Real leading on a phone, not the box's ratio.
   *
   * When these were converted off `ph()` the multipliers were chosen to
   * reproduce exactly what the box rendered — 1.01x the font size here and
   * 0.96x below. Preserving TV was right, but those ratios are too tight to be
   * *correct*: a leading at or under the font size leaves no room under the
   * baseline, and "Start watching with" has a descender, so the tail of the g
   * was cut off. Android's `includeFontPadding` normally absorbs that, and an
   * explicit `lineHeight` this small overrides it.
   *
   * TV and tablet keep the ratios they were verified at; only the phone gets
   * the descender room.
   */
  ventoxHeadlinePre: {
    color: "#FFFFFF",
    fontSize: ps(2.3),
    fontWeight: "700",
    lineHeight: ps(2.3) * (isPhone ? 1.3 : 1.0114),
    textAlign: "left",
  },
  ventoxHeadlineMain: {
    color: "#FFFFFF",
    fontSize: ps(3.0),
    fontWeight: "900",
    lineHeight: ps(3.0) * (isPhone ? 1.25 : 0.96),
    marginTop: ph(0.6),
    textAlign: "left",
  },
  ventoxRightCol: {
    width: pw(48),
  },
  inputBox: {
    width: "100%",
    // `ph` is a percentage of the *short* edge, so `ph(9.8)` is 53dp on a TV
    // but 39 on a handset — under the touch minimum for the one control on
    // this screen you have to hit accurately.
    height: isPhone ? 46 : ph(9.8),
    backgroundColor: "#17181c",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "transparent",
    // `pw(2.5)` is 22dp a side on a phone, against a field only 361 wide.
    paddingHorizontal: isPhone ? 14 : pw(2.5),
    justifyContent: "center",
    marginBottom: isPhone ? 12 : ph(2.2),
  },
  inputBoxFocused: {
    borderColor: "#FFFFFF",
    backgroundColor: "#17181c",
  },
  textInput: {
    color: "#FFFFFF",
    fontSize: ps(1.6),
    fontWeight: "500",
    paddingVertical: 0,
    width: "100%",
  },
  themeAddBtn: {
    width: "100%",
    height: isPhone ? 46 : ph(9.8),
    backgroundColor: "#F5F5F5",
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginTop: ph(0.6),
    borderWidth: 0,
    borderColor: "transparent",
  },
  themeAddBtnFocused: {
    backgroundColor: "#F5F5F5",
    borderColor: "transparent",
    borderWidth: 0,
    transform: [{ scale: 1.02 }],
  },
  themeAddBtnText: {
    color: "#000000",
    fontSize: ps(1.7),
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  themeAddBtnTextFocused: {
    color: "#000000",
    fontWeight: "900",
  },
});