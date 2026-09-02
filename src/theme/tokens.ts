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

/**
 * The shared artwork-card frame: radius, hairline and wash.
 *
 * Used by the dashboard's browse cards and the stacked artwork on the portals
 * intro screen. It lives here because those two were duplicated literals that
 * had already drifted apart once — a card has to read the same in both places.
 *
 * Sized against `psRaw`, not `ps`: both screens predate the TV_SCALE tier, so
 * the bumped `ps` would render the radius a third larger on TV than the rest of
 * their metrics.
 */
export const CARD_FRAME = {
  borderRadius: psRaw(1.6),
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.12)",
  backgroundColor: "rgba(255,255,255,0.03)",
};

/** Radius for content clipped one pixel inside `CARD_FRAME`, so the corners nest
 *  instead of leaving a sliver of the frame showing through. */
export const CARD_FRAME_INNER_RADIUS = psRaw(1.5);

export const THEME = {
  colors: {
    background: "#000000",          // Pure deep black background
    surface: "#0c0d12",             // Deep surface card
    surfaceLight: "rgba(255, 255, 255, 0.06)",

    primary: "#ffffff",             // Pure white primary
    secondary: "#e0e0e0",           // Crisp silver secondary
    accent: "#ffffff",              // Pure white accent

    text: "#FFFFFF",
    textMuted: "rgba(255, 255, 255, 0.70)",
    textDim: "rgba(255, 255, 255, 0.45)",

    border: "rgba(255, 255, 255, 0.12)",
    borderLight: "rgba(255, 255, 255, 0.06)",

    overlay: "rgba(0, 0, 0, 0.85)",

    // TV focus colors - strict monochrome white ring / glow
    focusRing: "#FFFFFF",
    focusGlow: "rgba(255, 255, 255, 0.25)",

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
  /**
   * Only families registered by useFonts() render; anything else silently
   * falls back to the system font.
   *
   * All three aliases point at the same family because Tenor Sans **is** a
   * single-weight typeface — only `TenorSans_400Regular` is loaded, and no
   * bold cut exists to load.
   *
   * `fontWeight` does NOT make up the difference, which is the trap here.
   * Pairing `fontFamily: THEME.fonts.bold` with a heavy `fontWeight` asks
   * Android for a bold cut of a family that has none, and it answers with a
   * synthesised one — doubled, smeared glyphs with wrong metrics. It showed up
   * first on the player's seek indicator at weight 900.
   *
   * So: use these for text at its natural weight, and for anything that needs
   * real weight omit `fontFamily` entirely and let the system font carry it.
   * `bold` and `medium` are kept as distinct names only so call sites can say
   * what they meant; they are not different faces.
   */
  fonts: {
    regular: FONT_FAMILY,
    medium: FONT_FAMILY,
    bold: FONT_FAMILY,
  }
};
