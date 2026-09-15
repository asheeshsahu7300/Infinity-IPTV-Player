import { Platform } from 'react-native';

import { isTV } from '../utils/tvUtils';
import {
  glassEdge,
  glassEdgeFocused,
  glassEdgeHighlight,
  glassEdgeSoft,
  tintStrong,
  tintGlow,
} from './palette';

/**
 * The material system: what "glass" means on each device this app ships to.
 *
 * Apple's materials are a *backdrop* effect — the surface samples what is
 * behind it, blurs it, and tints the result. React Native can do that natively
 * on iOS and tvOS, where `UIVisualEffectView` is a compositor primitive and
 * costs essentially nothing. Android has no equivalent, and that asymmetry is
 * what this file exists to manage.
 *
 * Every surface in the app goes through `GlassSurface`, which reads the specs
 * below. Nothing should construct a blur by hand.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * The blur policy
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * Android's API level, or 0 elsewhere. `Platform.Version` is the API integer on
 * Android and a version *string* on iOS, hence the guard rather than a cast at
 * the use site.
 */
const androidApiLevel = Platform.OS === 'android' ? (Platform.Version as number) : 0;

/**
 * Whether this device gets a real backdrop blur.
 *
 * Three cases, and the middle one is the one worth explaining:
 *
 *  - **iOS and tvOS** — yes, always. `UIVisualEffectView` is composited by the
 *    system and is the cheapest way to draw these surfaces, not the dearest.
 *
 *  - **Android phones and tablets on API 31+** — yes. expo-blur's
 *    `dimezisBlurViewSdk31Plus` is built on `RenderEffect`, which landed in
 *    Android 12 and is GPU-backed. Below 31 the library falls back to a plain
 *    translucent view *silently*, so this flag tracks the same 31 rather than
 *    letting the surface quietly change character on an older handset — the
 *    fallback fills below are a full stop heavier than the with-blur ones, and
 *    picking between them needs to be a decision, not an accident. `minSdk` is
 *    26, so devices on the false branch here are real.
 *
 *  - **Android TV and STB boxes** — never, at any API level. A set-top box is
 *    a phone SoC from several years ago driving a 1080p or 4K panel, and a
 *    backdrop blur is a full-screen read-back-and-resample every frame. The
 *    grid screens would pay it once per visible tile.
 *
 * The user-visible consequence on a box is smaller than it sounds, and that is
 * the reason this trade is acceptable rather than merely necessary: the app's
 * ground is pure black, so there is very little *behind* a surface for a blur
 * to reveal. What sells the glass at that point is the edge treatment and the
 * sheen, and those are free — see `GlassSurface`.
 */
export const BLUR_ENABLED =
  Platform.OS === 'ios'
    ? true
    : Platform.OS === 'android'
      ? !isTV && androidApiLevel >= 31
      : false;

/**
 * The Android blur implementation to request.
 *
 * Always the SDK-31-gated variant, never plain `dimezisBlurView`: the ungated
 * one runs its own software-ish path on older releases, which is exactly the
 * performance cliff Expo's docs warn about. `BLUR_ENABLED` already keeps us
 * off Android below 31, so this is a second belt on the same trousers —
 * deliberately, because the two could otherwise drift apart.
 */
export const ANDROID_BLUR_METHOD = 'dimezisBlurViewSdk31Plus' as const;

/**
 * Divisor applied to `intensity` on Android so it reads like iOS.
 *
 * expo-blur's default is 4 and produces a noticeably stronger blur than the
 * same intensity on iOS. 4.5 lands the two close enough that a screenshot from
 * either platform can be used to judge the other.
 */
export const ANDROID_BLUR_REDUCTION = 4.5;

/* ────────────────────────────────────────────────────────────────────────────
 * The materials
 * ──────────────────────────────────────────────────────────────────────────*/

export type MaterialName =
  | 'ultraThin'
  | 'thin'
  | 'regular'
  | 'thick'
  | 'chrome';

export interface MaterialSpec {
  /** expo-blur intensity, 1–100. Ignored when `BLUR_ENABLED` is false. */
  intensity: number;
  /** iOS/tvOS vibrancy tint. The system materials, so iOS renders Apple's own. */
  tint:
    | 'systemUltraThinMaterialDark'
    | 'systemThinMaterialDark'
    | 'systemMaterialDark'
    | 'systemThickMaterialDark'
    | 'systemChromeMaterialDark';
  /**
   * Fill drawn *over* a live blur. Light, because the blur is already supplying
   * most of the surface's body and doubling up turns glass into plastic.
   */
  fill: string;
  /**
   * Fill drawn *instead of* a blur. Much heavier, and opaque enough to read as
   * a surface on its own — this is the whole surface on an STB.
   *
   * These land near Apple's elevated backgrounds on purpose: with nothing
   * behind them to sample, the honest thing for a material to converge to is
   * the flat colour Apple would have used for the same surface.
   */
  fillNoBlur: string;
  /** All-round hairline. */
  edge: string;
  /**
   * Opacity of the top specular highlight. Thicker materials catch less light,
   * the way a thicker pane of real glass does.
   */
  sheen: number;
}

/**
 * The five materials, thinnest to thickest.
 *
 * Choosing between them is a question about *what is behind the surface*, not
 * about how prominent you want it to look:
 *
 *  - `ultraThin` — over video or artwork that must stay readable. Player
 *    controls, the channel info bar.
 *  - `thin`      — over artwork that is decorative. Card and tile frames, pills.
 *  - `regular`   — the default. Rows, panels, sidebars, fields.
 *  - `thick`     — sheets and modals, where the screen behind must recede.
 *  - `chrome`    — headers, tab bars and anything pinned over scrolling
 *    content, which needs to stay legible as arbitrary content passes under it.
 */
export const MATERIALS: Record<MaterialName, MaterialSpec> = {
  ultraThin: {
    intensity: 22,
    tint: 'systemUltraThinMaterialDark',
    fill: 'rgba(255, 255, 255, 0.03)',
    fillNoBlur: 'rgba(28, 28, 30, 0.52)',
    edge: glassEdgeSoft,
    sheen: 0.10,
  },
  thin: {
    intensity: 38,
    tint: 'systemThinMaterialDark',
    fill: 'rgba(255, 255, 255, 0.045)',
    fillNoBlur: 'rgba(28, 28, 30, 0.68)',
    /**
     * `glassEdge`, not the `glassEdgeSoft` this had.
     *
     * `thin` is the artwork material — poster tiles, channel cards, the
     * dashboard's browse cards — and artwork is the one thing an edge has to
     * hold its own against. At 7% white it was invisible over a bright still:
     * the cards read as pictures lying loose on the page rather than as tiles
     * with a frame, which is exactly what they were reported as.
     *
     * `ultraThin` keeps the softer edge because it sits over *video*, where a
     * stronger line is a distraction rather than a boundary.
     */
    edge: glassEdge,
    sheen: 0.09,
  },
  regular: {
    intensity: 55,
    tint: 'systemMaterialDark',
    fill: 'rgba(255, 255, 255, 0.05)',
    fillNoBlur: 'rgba(28, 28, 30, 0.82)',
    edge: glassEdge,
    sheen: 0.08,
  },
  thick: {
    intensity: 75,
    tint: 'systemThickMaterialDark',
    fill: 'rgba(255, 255, 255, 0.055)',
    fillNoBlur: 'rgba(24, 24, 26, 0.93)',
    edge: glassEdge,
    sheen: 0.07,
  },
  chrome: {
    intensity: 92,
    tint: 'systemChromeMaterialDark',
    fill: 'rgba(255, 255, 255, 0.04)',
    fillNoBlur: 'rgba(18, 18, 20, 0.96)',
    edge: glassEdge,
    sheen: 0.05,
  },
};

/**
 * The top specular gradient, as a colour pair for `LinearGradient`.
 *
 * Two stops rather than three, and it fades to fully transparent well before
 * the bottom of the surface — a sheen that reaches the lower edge reads as a
 * gradient *fill*, which is the thing that most reliably makes fake glass look
 * like a nineties button.
 */
export const sheenColors = (opacity: number): [string, string] => [
  `rgba(255, 255, 255, ${opacity})`,
  'rgba(255, 255, 255, 0)',
];

/* ────────────────────────────────────────────────────────────────────────────
 * Focus
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * What focus does to a glass surface.
 *
 * Kept here beside the materials because focus is a *material* change in this
 * system — the surface brightens and its edge lights up — rather than a ring
 * drawn around an unchanged surface.
 *
 * The accent is achromatic, which makes focus cheaper to read and more awkward
 * to distinguish at the same time. Cheaper, because a white edge against black
 * is the highest-contrast thing this display can draw, and that is exactly what
 * a focus indicator wants from across a room. More awkward, because white is
 * also what every *label* in the app is made of, so a focused surface has to
 * separate itself from its own contents rather than from a neutral field.
 *
 * Three things move together to do that, and none of them is sufficient alone:
 * the edge goes to a solid, undimmed white, the fill beneath it brightens to a
 * clear wash, and the sheen roughly doubles. That reads as a pane catching the
 * light, which is the tvOS idiom and is legible at a distance where a coloured
 * ring is not.
 *
 * Note these fills stay *washes* rather than becoming the near-solid tint used
 * for a focused row or pill. A glass surface that fills opaque stops being
 * glass; components that want the full inverted treatment reach for `tint` and
 * `onTint` directly.
 */
export const FOCUS = {
  edge: glassEdgeFocused,
  /** Brightened fill under a focused surface — over blur. */
  fill: 'rgba(255, 255, 255, 0.20)',
  /** Brightened fill under a focused surface — no blur. */
  fillNoBlur: 'rgba(255, 255, 255, 0.26)',
  /** Sheen opacity when focused: light catches a raised surface harder. */
  sheen: 0.18,
  /** Scale applied to a focused tile. Apple's own tvOS lift is ~1.06. */
  scale: 1.06,
  glow: tintGlow,
};

/**
 * The focus glow, as a shadow.
 *
 * iOS only, and that restriction is inherited rather than invented: Android's
 * `elevation` draws a shadow that is painted over neighbouring views, so in a
 * grid a lifted tile shadows the tiles beside it. `TILE_FRAME_FOCUSED` in
 * `tokens.ts` learnt this the hard way and the note there is the long version.
 *
 * On Android the focused edge and fill carry focus by themselves, which is why
 * `FOCUS.edge` is a solid colour rather than a translucent one.
 */
export const focusGlowShadow = Platform.select({
  ios: {
    shadowColor: tintStrong,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 14,
  },
  default: {},
});

/* ────────────────────────────────────────────────────────────────────────────
 * Elevation
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * Sheet and popover shadow.
 *
 * Unlike the focus glow this *is* given to Android, because a modal has no
 * neighbours to shadow — it is the only thing at its layer. `elevation` and the
 * iOS shadow are tuned to read alike rather than to the same numbers; Android's
 * elevation is a single scalar driving both blur and offset.
 */
export const sheetShadow = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.55,
    shadowRadius: 32,
  },
  android: { elevation: 24 },
  default: {},
});

/** A softer version of the above, for popovers and menus rather than sheets. */
export const popoverShadow = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 18,
  },
  android: { elevation: 12 },
  default: {},
});

/* ────────────────────────────────────────────────────────────────────────────
 * Corner radii
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * Apple's radius ladder, in dp.
 *
 * Fixed dp rather than `ps()` percentages, which is a deliberate departure from
 * the rest of this theme. A corner radius is a statement about the *physical*
 * softness of a shape and does not want to grow with the viewport: a card on a
 * 4K box and the same card on a phone should look equally rounded, and scaling
 * the radius with the canvas makes the box's corners read as much blunter.
 *
 * These are the values Apple uses, so `card` matching the 12 of a UIKit grouped
 * cell and `sheet` the 20 of a presented sheet is not a coincidence.
 *
 * Note that React Native cannot draw Apple's *continuous* (squircle) corners —
 * `borderCurve: 'continuous'` is honoured on iOS 13+ only and is a no-op on
 * Android. `GlassSurface` sets it anyway, so iOS gets the real shape for free
 * and Android gets the circular approximation it would have had regardless.
 */
export const RADIUS = {
  /** Badges, small tags. */
  xs: 6,
  /** Fields, compact buttons. */
  sm: 10,
  /** The default: cards, rows, tiles. */
  card: 12,
  /** Larger panels, grouped sections. */
  lg: 16,
  /** Presented sheets and modals. */
  sheet: 20,
  /** Full-screen glass panels. */
  xl: 28,
  /** Capsules — pills, segmented controls, round icon buttons. */
  full: 9999,
} as const;

/* ────────────────────────────────────────────────────────────────────────────
 * Motion
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * Apple's durations, in ms.
 *
 * The house style here is that UI motion is *fast* — long enough to be seen as
 * motion rather than a cut, short enough never to be waited on. `standard` is
 * the one to reach for; the others exist for things that move a long way
 * (`emphasised`) or barely move at all (`quick`).
 *
 * Anything driving these must respect `useReducedMotion` from `src/tv`, which
 * several screens already consult — a focus-driven scale that ignores it is an
 * accessibility regression, not a nicety.
 */
export const DURATION = {
  quick: 120,
  standard: 220,
  emphasised: 350,
  /** Cross-fades of full-screen artwork. Slow on purpose: this is atmosphere. */
  ambient: 600,
} as const;

/**
 * Bezier control points matching Apple's curves, for `Easing.bezier(...)`.
 *
 * Exported as tuples rather than as `Easing` objects so that this module stays
 * free of a react-native `Animated` import — it is read by style code that has
 * no business pulling the animation runtime in.
 */
export const EASING = {
  /** Apple's default. Ease in and out, weighted to the out. */
  standard: [0.4, 0.0, 0.2, 1.0] as const,
  /** Entering the screen — starts fast, settles. */
  decelerate: [0.0, 0.0, 0.2, 1.0] as const,
  /** Leaving the screen — starts slow, accelerates away. */
  accelerate: [0.4, 0.0, 1.0, 1.0] as const,
  /** A slight overshoot, for focus lifts and taps. */
  spring: [0.34, 1.26, 0.64, 1.0] as const,
};

/**
 * Re-exported so a call site that only wants the highlight colour does not have
 * to import from two theme modules to style one surface.
 */
export { glassEdge, glassEdgeSoft, glassEdgeHighlight, glassEdgeFocused };
