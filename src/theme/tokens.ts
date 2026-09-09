import { Dimensions, Platform } from 'react-native';

import { isTablet } from "../utils/tabletUtils";

const winDims = Dimensions.get("window");

// Baseline reference dimensions:
// Design system tokens (pw, ph, ps) are calibrated for a landscape reference canvas (TV / tablet).
// When the app is launched in portrait on a tablet or phone, winDims.width is the short edge and
// winDims.height is the long edge.
// Normalizing W to the long edge and H to the short edge ensures that launching in portrait produces
// the exact same design-token metrics as launching in landscape, preventing layout distortion.
const W = Math.max(winDims.width, winDims.height);
const H = Math.min(winDims.width, winDims.height);

const IS_TV =
  Platform.isTV ||
  (Platform.OS === 'android' && W > 1000) ||
  (Platform.OS === 'web' && W > 800);

/**
 * The TV bump, worn by tablets too.
 *
 * `IS_TV` keys off `W > 1000` on Android only, so on its own it misses every
 * iPad and every ~960dp Android tablet — those took the phone tier and
 * rendered a third smaller than the box, for no reason a viewer could see.
 * `isTablet` (shortest-side, so orientation-stable) covers them without
 * teaching `IS_TV` to claim a tablet is a TV; see `utils/tabletUtils`.
 *
 * The multiplier is deliberately the *same* 1.3 on a tablet as on a box
 * rather than a tablet-specific value. `ps` is viewport-relative, so an
 * identical multiplier is precisely what makes a tablet a scaled-down TV
 * rather than a differently-proportioned screen.
 */
const TV_SCALE = IS_TV || isTablet ? 1.3 : 1;

export const FONT_FAMILY = "Inter";

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
  // Matched to TILE_FRAME below. These were 0.12 and 0.03 against the tiles'
  // 0.05 and 0.04 — a visibly heavier edge on the dashboard and the portals
  // intro than on every grid the same eye moves between. The radius stays put
  // for the psRaw reason above.
  borderColor: "rgba(255, 255, 255, 0.05)",
  backgroundColor: "rgba(255, 255, 255, 0.04)",
};

/** Radius for content clipped one pixel inside `CARD_FRAME`, so the corners nest
 *  instead of leaving a sliver of the frame showing through. */
export const CARD_FRAME_INNER_RADIUS = psRaw(1.5);

export const THEME = {
  colors: {
    background: "#000000",          // Pure black main background
    surface: "#151512ED",             // Dark charcoal sidebar / surface
    surfaceLight: "#161613CC",       // Transparent black normal sidebar

    primary: "#F5F5F5",             // Cinema Gold primary accent
    secondary: "#16161672",           // Soft gray secondary text
    accent: "#F5F5F5",              // Cinema Gold primary accent

    text: "#FFFFFF",                // White main text
    textMuted: "#B8B8B8",           // Soft gray secondary text
    textDim: "rgba(184, 184, 184, 0.60)",

    border: "rgba(255, 255, 255, 0.10)",
    borderLight: "rgba(255, 255, 255, 0.06)",

    overlay: "rgba(8, 8, 6, 0.85)",

    // Focus & Category Selection
    selectedCategory: "#F9F4EA",    // Warm ivory selected category
    selectedText: "#111111",        // Black selected text
    focusRing: "#F4F2EF",           // Gold focus border
    focusGlow: "rgba(232, 231, 228, 0.35)",

    // Rating Badge
    ratingBadge: "#C58D00",         // Dark gold rating badge

    // Glassmorphism
    glassBg: "#161613CC",
    glassBgFocus: "#FFF7E6",
    glassBorder: "rgba(255, 255, 255, 0.08)",
    glassBorderFocus: "#FFC857",
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
    regular: "Inter_400Regular",
    medium: "Inter_500Medium",
    bold: "Inter_700Bold",
  }
};

/**
 * The tile frame — one definition of the border every tile, field and row wears.
 *
 * These are the VOD/Series poster values, because that poster is the frame the
 * rest of the app is being matched to. They were duplicated across three
 * screens and had already drifted: Live TV carried a 1.2 radius against the
 * other two at 1.4. That is the same drift `CARD_FRAME` above was extracted to
 * stop, one component family later.
 *
 * `padding: 1` belongs to the frame rather than to the layout: it holds content
 * one pixel inside the border so the corners nest, instead of the border
 * sitting on top of the artwork.
 *
 * Spread it, and override `borderRadius` where the shape demands it — the pill
 * search fields keep their own radius and take only the border treatment.
 * Always apply `TILE_FRAME` unconditionally and layer `TILE_FRAME_FOCUSED` on
 * top; the focused half deliberately omits everything the resting half already
 * establishes.
 */
export const TILE_FRAME = {
  padding: 1,
  borderRadius: ps(1.4),
  backgroundColor: THEME.colors.glassBg,
  borderWidth: 1,
  borderColor: "rgba(255, 255, 255, 0.05)",
};

/**
 * The focused half of `TILE_FRAME`: brighter edge, brighter wash, and on iOS a
 * white bloom. Android takes no elevation — a lifted tile draws its shadow over
 * its neighbours in a grid, so the border carries focus there on its own.
 */
export const TILE_FRAME_FOCUSED = {
  borderColor: THEME.colors.glassBorderFocus,
  backgroundColor: THEME.colors.glassBgFocus,
  ...Platform.select({
    ios: {
      shadowColor: "#fff",
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.6,
      shadowRadius: 16,
    },
    android: {
      elevation: 0,
    },
  }),
};
