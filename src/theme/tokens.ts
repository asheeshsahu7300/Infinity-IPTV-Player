import { Dimensions, Platform } from 'react-native';

const { width: W, height: H } = Dimensions.get("window");

const IS_TV =
  Platform.isTV ||
  (Platform.OS === 'android' && W > 1000) ||
  (Platform.OS === 'web' && W > 800);

const TV_SCALE = IS_TV ? 1.3 : 1;

/** The one custom family app/_layout.tsx actually loads via useFonts(). */
export const FONT_FAMILY = "Tenor Sans";

export const pw = (pct: number) => (W * pct) / 100;
export const ph = (pct: number) => (H * pct) / 100;
export const ps = (pct: number) => ((pw(pct) + ph(pct)) / 2) * TV_SCALE;
/**
 * `ps` without the TV bump. Screens that predate the TV_SCALE tier are sized
 * against this — import it rather than redeclaring a local `ps`, otherwise the
 * same call renders at two different sizes depending on the file.
 */
export const psRaw = (pct: number) => (pw(pct) + ph(pct)) / 2;

export const THEME = {
  colors: {
    background: "#0E0F14",          // softer than pure black
    surface: "#171923",             // elevated card surface
    surfaceLight: "rgba(255,255,255,0.07)",

    primary: "#ffffff",                 // monochrome primary
    secondary: "#aaaaaa",               // monochrome secondary
    accent: "#ffffff",                  // monochrome accent

    text: "#FFFFFF",
    textMuted: "#C5C9D6",           // better readability at distance
    textDim: "#8E93A8",

    border: "rgba(255,255,255,0.10)",
    borderLight: "rgba(255,255,255,0.05)",

    overlay: "rgba(0,0,0,0.72)",

    // optional TV focus colors
    focusRing: "#FFFFFF",
    focusGlow: "rgba(255, 77, 116, 0.45)",

    // Glassmorphism
    glassBg: "rgba(255, 255, 255, 0.04)",
    glassBgFocus: "rgba(255, 255, 255, 0.12)",
    glassBorder: "rgba(255, 255, 255, 0.18)",
    glassBorderFocus: "rgba(255, 255, 255, 0.6)",
  },
  spacing: {
    xs: pw(1),
    sm: pw(2),
    md: pw(3),
    lg: pw(5),
    xl: pw(8),
  },
  radius: {
    sm: ps(0.8),
    md: ps(1.2),
    lg: ps(2),
    full: 9999,
  },
  typography: {
    h1: ps(3.2),
    h2: ps(2.4),
    title: ps(1.8),
    body: ps(1.4),
    caption: ps(1.1),
    tiny: ps(0.8),
  },
  // Only families registered by useFonts() render; anything else silently
  // falls back to the system font. Weight is carried by `fontWeight`, so all
  // three aliases point at the single loaded family.
  fonts: {
    regular: FONT_FAMILY,
    medium: FONT_FAMILY,
    bold: FONT_FAMILY,
  }
};
