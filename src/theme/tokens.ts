import { Dimensions, Platform } from 'react-native';

import { isPhone } from "../utils/phoneUtils";
import { isTablet, remoteFocusEnabled } from "../utils/tabletUtils";
import * as P from "./palette";
import { FOCUS, MATERIALS, RADIUS, focusGlowShadow } from "./materials";

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
const LARGE_SCREEN = IS_TV || isTablet;

const TV_SCALE = LARGE_SCREEN ? 1.3 : 1;

/**
 * The reference canvas every `ps`/`psRaw` literal in this app was tuned against.
 *
 * An Android TV box reports 960x540dp for a 1080p panel, so `(960+540)/2` is the
 * unit `ps(1)` was sized in. It is a constant rather than a live measurement
 * because it describes the *design*, not the device.
 */
const REF_UNIT = (960 + 540) / 2;

/**
 * The phone tier: `ps` is renormalised so a phone renders the reference dp.
 *
 * `ps` is viewport-relative, which is the right behaviour between a TV and a
 * tablet — both are landscape canvases of comparable dp, so a percentage keeps
 * proportion. A phone is neither. Its `(W+H)/2` is roughly 633 against the
 * box's 750, and it takes no TV bump, so every `ps` literal in the app landed a
 * third small: `ps(1.05)`, the live-tv card label, rendered **6.6dp**, and the
 * `ps(0.72)` badge **4.6dp**. That is not a tuning problem, it is illegible —
 * and it is invisible from the code, because the same expression reads fine on
 * the two device classes that had been tested.
 *
 * Scaling to reference dp rather than to some phone-specific ideal is the point:
 * it means every hand-tuned `ps` value in the app keeps the physical size it was
 * given, instead of the whole type scale needing to be re-picked for a third
 * device. Reference dp is also generous on a handset rather than merely
 * adequate — 10dp of TV canvas subtends about 0.24 degrees from a sofa, and
 * 10dp of phone about 0.34 degrees at arm's length.
 *
 * Deriving the factor from this device's own `(W+H)/2` rather than fixing a
 * constant is what makes it hold across the phone range: a 740x360 handset
 * needs 1.77 where a 915x412 needs 1.47, and a single constant would leave one
 * end of that range wrong. The consequence is that `ps` is effectively a fixed
 * dp on phones — deliberately, since text must not shrink on a smaller handset.
 *
 * Exactly 1 on TV and on tablets, so this cannot move either of them.
 *
 * There are **two** of these and not one, which is the easy thing to get wrong:
 * `ps` and `psRaw` are 1.3 apart on the reference canvas (9.75 against 7.50 per
 * percent), and `TV_SCALE` is 1 on a phone, so a single normaliser lands both
 * on 7.50 and leaves every `ps` value 23% short — a `ps(0.72)` badge at 5.4dp
 * instead of 7.0dp, which is the illegibility this tier exists to fix, not
 * quite fixed. Each function gets the normaliser for its own reference value.
 */
/**
 * A deliberate size bump on top of the normalisation above — phone text and
 * icons read too small at reference dp.
 *
 * The normalisers restore the *reference* size, which is the size these values
 * were designed at on a TV canvas viewed from a sofa. That is the right
 * starting point but not the right finish: the same dp at arm's length on a
 * handset is a much smaller angular size than the reference tier assumes, and
 * a phone is also the one tier where the viewer cannot lean back.
 *
 * Kept as its own factor rather than folded into `REF_UNIT` so that what is
 * "correct normalisation" stays separable from what is "a judgement about
 * legibility" — change this number, not the reference canvas, to retune.
 *
 * This is one of two places the bump is applied, and both have to move
 * together or the phone type scale comes out mixed. Roughly 165 call sites
 * size text and icons through `ps`/`psRaw` and are covered here; another ~75
 * hardcode a phone number (e.g. `fontSize: isPhone ? 16.1 : ps(1.5)`, which was
 * 14 before this bump) and were scaled
 * by the same 1.15 in place. A new hardcoded phone size should be written
 * already-scaled, or better, expressed through `ps`.
 *
 * Exactly 1 on TV and tablet, like the normalisers it multiplies.
 */
const PHONE_UI_SCALE = 1.15;

const PHONE_PS_NORM = isPhone ? (PHONE_UI_SCALE * REF_UNIT * 1.3) / ((W + H) / 2) : 1;
const PHONE_PSRAW_NORM = isPhone ? (PHONE_UI_SCALE * REF_UNIT) / ((W + H) / 2) : 1;

/**
 * The canvas the tablet tier was tuned against: a 1280x800 panel.
 *
 * That is the size every tablet value in this app was chosen on — it is the
 * number `tabletClamp` cites when it explains why tablet metrics needed
 * capping ("1280x800 against 960x540").
 */
const TABLET_REF_UNIT = (1280 + 800) / 2;

/**
 * The tablet tier, normalised the same way the phone tier is.
 *
 * `ps` is viewport-relative, so "tablet" was never one size: a 1280x800 panel
 * gives 13.52 per percent while an 853x533 one — a common 10" tablet at ~2.25
 * density — gives 9.01, a third smaller, and *below* even the 9.75 of the TV
 * canvas. Every tablet value in the app was picked on the larger panel, so on
 * the smaller one the whole type scale reads shrunken.
 *
 * `Math.max(1, ...)` makes this a floor rather than a rescale: a small tablet
 * is brought up to the canvas its values were designed for, and a tablet at or
 * above 1280x800 is left exactly as it was. Nothing gets smaller than it is
 * today, on any device.
 *
 * Exactly 1 on phones and TV.
 */
const TABLET_PS_NORM = isTablet
  ? Math.max(1, TABLET_REF_UNIT / ((W + H) / 2))
  : 1;

export const FONT_FAMILY = "Inter";

export const pw = (pct: number) => (W * pct) / 100;
export const ph = (pct: number) => (H * pct) / 100;
export const ps = (pct: number) =>
  ((pw(pct) + ph(pct)) / 2) * TV_SCALE * PHONE_PS_NORM * TABLET_PS_NORM;
/**
 * `ps` without the TV bump. Screens that predate the TV_SCALE tier are sized
 * against this — import it rather than redeclaring a local `ps`, otherwise the
 * same call renders at two different sizes depending on the file.
 */
export const psRaw = (pct: number) =>
  ((pw(pct) + ph(pct)) / 2) * PHONE_PSRAW_NORM * TABLET_PS_NORM;

/**
 * A raw dp value that still takes the phone bump. Unchanged on TV and tablet.
 *
 * `ps`/`psRaw` carry `PHONE_UI_SCALE` for everything sized as a percentage of
 * the canvas, and hardcoded `isPhone ? 14 : ...` values were scaled in place.
 * Neither covers the third case: a size written as a bare number for *every*
 * tier, like `<DynamicIcon size={24} />` in the shared header. Those silently
 * sat out the bump and ended up small next to text that had grown — which is
 * how the dashboard's icons stayed put while its labels did not.
 *
 * Use this for a raw dp that should track the phone type scale — chrome sized
 * to sit beside text. Not for hero graphics (a 52dp offline glyph, a spinner):
 * those are pictures, not legibility, and they are already large.
 */
export const phoneDp = (dp: number) =>
  isPhone ? Math.round(dp * PHONE_UI_SCALE * 10) / 10 : dp;

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
  borderRadius: RADIUS.card,
  borderWidth: 1,
  // Matched to TILE_FRAME below. These were 0.12 and 0.03 against the tiles'
  // 0.05 and 0.04 — a visibly heavier edge on the dashboard and the portals
  // intro than on every grid the same eye moves between.
  //
  // Now the `thin` material's own edge and fill, so a card styled by hand here
  // and a card built from `GlassSurface` are the same surface. The radius moved
  // from `psRaw(1.6)` to the fixed ladder for the reason given on
  // `THEME.radius` above.
  borderColor: MATERIALS.thin.edge,
  backgroundColor: MATERIALS.thin.fillNoBlur,
};

/** Radius for content clipped one pixel inside `CARD_FRAME`, so the corners nest
 *  instead of leaving a sliver of the frame showing through. */
export const CARD_FRAME_INNER_RADIUS = RADIUS.card - 1;

/**
 * The semantic layer over `palette.ts`.
 *
 * Names here say what a colour is *for*; `palette.ts` says what it *is*. The
 * indirection earns its keep in exactly one way — retinting the app is an edit
 * to two files rather than to forty — and that claim has now been tested: the
 * accent has moved twice through this block, from the old warm ivory/gold
 * "cinema" scheme to systemBlue and back out to an achromatic off-white, and
 * the second move was a handful of lines here rather than a second sweep.
 *
 * The app's structure is Apple's — materials, the label hierarchy, the radius
 * ladder, the type ramp — and its *accent* is tvOS's rather than iOS's. See
 * `tint` in `palette.ts` for why a television app takes the achromatic one.
 *
 * Every key the previous scheme had is still here and still means the same
 * thing, so no call site had to change to pick up the new palette. Several are
 * aliases of one another (`primary` and `accent` are both the tint); they are
 * kept distinct so a call site can still say which idea it meant.
 *
 * The one rule this block enforces that a call site cannot see: **anything
 * filled with the tint takes `P.onTint` for its ink.** See `selectedCategory`
 * and `selectedText` below, which are the named instance of that pair.
 */
export const THEME = {
  colors: {
    background: P.systemBackground,
    /** Raised container — sheets, sidebars. Apple lightens rather than shadows. */
    surface: P.elevatedSystemBackground,
    surfaceLight: P.secondaryElevatedSystemBackground,

    primary: P.tint,
    secondary: P.secondarySystemFill,
    accent: P.tint,

    text: P.label,
    textMuted: P.secondaryLabel,
    textDim: P.tertiaryLabel,

    border: P.glassEdge,
    borderLight: P.glassEdgeSoft,

    overlay: P.scrim,

    /**
     * Selection — and these two are **one value in two halves**, not two
     * values that happen to sit together.
     *
     * `selectedCategory` fills the capsule and `selectedText` is the ink on
     * top of it. The fill is off-white, so the ink is dark; invert one without
     * the other and the selected category becomes either white-on-white or
     * dark-on-dark, which is invisible in a diff and total on screen. That is
     * not hypothetical — it has happened once in each direction in this file's
     * short history, which is why they are adjacent and why this note exists.
     *
     * Anything else that fills with the tint takes `P.onTint` for its ink by
     * the same rule; these two are just the pair with a name.
     *
     * The pairing is also what makes the achromatic accent work on a
     * television: `#F5F5F7` against `#1C1C1E` is roughly 15:1, which is the
     * most contrast this palette can produce and exactly what the one control
     * you are pointing at should have from across a room.
     */
    selectedCategory: P.tint,
    selectedText: P.onTint,

    /**
     * The focus ring. See `FOCUS` in `materials.ts` for why focus is carried
     * by a solid white edge, a brightened fill and a doubled sheen together
     * rather than by any one of the three.
     */
    focusRing: P.tintStrong,
    focusGlow: P.tintGlow,

    /** Rating badges. systemYellow, not the gold this used to be. */
    ratingBadge: P.systemYellow,

    /* ── Status ────────────────────────────────────────────────────────────
     * Aliases onto the system colours so screens stop reaching for Tailwind
     * defaults. There were six of these in the codebase doing three jobs.
     * ────────────────────────────────────────────────────────────────────*/
    success: P.systemGreen,
    warning: P.systemOrange,
    danger: P.systemRed,
    live: P.systemRed,

    /* ── Glass ────────────────────────────────────────────────────────────
     * Retained for the call sites that style a surface by hand rather than
     * through `GlassSurface`. Prefer the component: these three values are the
     * fill and the edge, and a surface built from them alone is missing the
     * sheen and the specular top edge that make the material read as glass.
     * ────────────────────────────────────────────────────────────────────*/
    glassBg: MATERIALS.regular.fillNoBlur,
    glassBgFocus: FOCUS.fillNoBlur,
    glassBorder: P.glassEdgeSoft,
    glassBorderFocus: FOCUS.edge,
  },
  spacing: {
    xs: pw(1),
    sm: pw(2),
    md: pw(3),
    lg: pw(5),
    xl: pw(8),
  },
  /**
   * Now fixed dp from Apple's ladder rather than `ps()` percentages.
   *
   * A corner radius describes how physically soft a shape is and should not
   * grow with the viewport: the same card ought to look equally rounded on a
   * handset and on a 4K box, and a viewport-relative radius makes the box's
   * corners read as markedly blunter than the phone's.
   *
   * The values land close to what `ps()` produced on the reference canvas — the
   * old `md` was about 9dp against `RADIUS.card`'s 12 — so this is a small
   * softening everywhere rather than a reshuffle. See `RADIUS` in
   * `materials.ts` for the full ladder and for the note on continuous corners.
   */
  radius: {
    sm: RADIUS.sm,
    md: RADIUS.card,
    lg: RADIUS.lg,
    sheet: RADIUS.sheet,
    full: RADIUS.full,
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
   * Only families registered by `useFonts()` render; anything else silently
   * falls back to the system font.
   *
   * ── This docblock used to describe a different typeface ──
   * It said all three aliases were the same family, because Tenor Sans is
   * single-weight and only `TenorSans_400Regular` was loaded. That has not
   * been true since the app moved to Inter: `app/_layout.tsx` registers
   * 400, 500, 600, 700, 800 and 900, and these are four genuinely distinct
   * faces. Tenor Sans survives only as an unused entry in `package.json`.
   *
   * The advice it gave was the harmful part. It said that anything needing
   * real weight should omit `fontFamily` and let the system font carry it —
   * which drops that string off Inter onto Roboto or SF. Mixed families
   * within one screen is exactly what a type system is for preventing, and it
   * is why a few headings in this app have never quite matched the body copy
   * under them.
   *
   * ── The rule that is still true ──
   * Never pair one of these with a `fontWeight`. Asking Android for a bold cut
   * of a face that is already bold gets a *synthesised* one on top — doubled,
   * smeared glyphs with wrong metrics, first seen on the player's seek
   * indicator at weight 900. `components/Text` strips `fontWeight` for
   * exactly this reason, which is also why setting it has no effect at all:
   * weight comes from the family here, and only from the family.
   */
  fonts: {
    /**
     * ── On TV and tablet, all four aliases are Regular ──
     *
     * Asked for directly, and done here rather than as a sweep through the
     * screens: every `fontFamily` in the app resolves through these four names
     * — the `TEXT` ramp above included — so this is the one place the rule can
     * be stated, and the one place it can be lifted again.
     *
     * The aliases are kept rather than collapsed to a single token because the
     * phone tier still uses all four, and because the call sites still record
     * what the design *intends*: `TEXT.title1` asking for `bold` is
     * information worth keeping even on a tier that currently renders it at
     * 400.
     *
     * Worth knowing what this costs: `components/Text` strips `fontWeight`,
     * so weight comes from the family and only from the family. With all four
     * the same face, weight stops carrying hierarchy on the large screens
     * entirely — a heading, a channel name and a badge are the same stroke,
     * and size, colour and spacing are all that separate them. That is the
     * intended look here; it is not an oversight to fix by reintroducing a
     * bold somewhere downstream.
     *
     * 500/600/700 stay registered in `app/_layout.tsx` — the phone still
     * renders them.
     */
    regular: "Inter_400Regular",
    medium: LARGE_SCREEN ? "Inter_400Regular" : "Inter_500Medium",
    semibold: LARGE_SCREEN ? "Inter_400Regular" : "Inter_600SemiBold",
    bold: LARGE_SCREEN ? "Inter_400Regular" : "Inter_700Bold",
  }
};

/**
 * Apple's type ramp, as ready-made text styles.
 *
 * Apple's hierarchy is carried by **weight and tracking**, not by size alone:
 * a headline and a body line are the same size and differ only in that one is
 * semibold. That is the part a hand-built dark theme usually loses, and in
 * this app it was lost structurally — `components/Text` strips `fontWeight`,
 * so the hundreds of `fontWeight: "700"` and `"900"` declarations across these
 * screens have never rendered as anything but Regular.
 *
 * Spread one of these instead of writing a size and a weight:
 *
 *     <Text style={[TEXT.headline, { color: P.label }]}>Sky Sports</Text>
 *
 * Sizes go through `ps()` so they keep the device-tier scaling the rest of
 * this file establishes; tracking is in dp and deliberately does not scale,
 * because tracking is a property of the letterforms rather than of the canvas.
 *
 * Negative tracking on the large styles and positive on the small ones is
 * Apple's own optical correction, not a stylistic preference — type set large
 * looks loose at its natural spacing and type set small looks cramped.
 */
export const TEXT = {
  /** Screen titles. One per screen, at most. */
  largeTitle: { fontSize: ps(3.2), fontFamily: THEME.fonts.bold, letterSpacing: -0.8 },
  title1: { fontSize: ps(2.4), fontFamily: THEME.fonts.bold, letterSpacing: -0.6 },
  title2: { fontSize: ps(1.9), fontFamily: THEME.fonts.semibold, letterSpacing: -0.4 },
  title3: { fontSize: ps(1.6), fontFamily: THEME.fonts.semibold, letterSpacing: -0.3 },
  /** Body size, semibold — the row title, the card name, the thing being named. */
  headline: { fontSize: ps(1.3), fontFamily: THEME.fonts.semibold, letterSpacing: -0.2 },
  /** Body size, regular. Everything that is read rather than scanned. */
  body: { fontSize: ps(1.3), fontFamily: THEME.fonts.regular, letterSpacing: 0 },
  callout: { fontSize: ps(1.2), fontFamily: THEME.fonts.regular, letterSpacing: 0 },
  /** Supporting line under a headline. */
  subhead: { fontSize: ps(1.1), fontFamily: THEME.fonts.medium, letterSpacing: 0 },
  footnote: { fontSize: ps(1.0), fontFamily: THEME.fonts.regular, letterSpacing: 0.1 },
  caption: { fontSize: ps(0.9), fontFamily: THEME.fonts.regular, letterSpacing: 0.2 },
  /** Uppercase eyebrows and badge text. The wide tracking is what makes
   *  all-caps legible at this size; without it the letters collide. */
  caption2: { fontSize: ps(0.8), fontFamily: THEME.fonts.medium, letterSpacing: 0.6 },
} as const;

/**
 * The three-state ladder for a selectable row, pill or capsule.
 *
 * An achromatic accent has to say two different things with one colour —
 * "this is the category you are in" and "this is the category the cursor is
 * over" — and those are frequently both on screen at once. With a blue accent
 * they could differ by hue; here both are white, and what separates them is
 * the *edge*:
 *
 *   rest    — a neutral grey fill, secondary ink. Not selected, not focused.
 *   marked  — a solid off-white fill and dark ink, no edge. Selected, but the
 *             cursor is somewhere else.
 *   filled  — pure white with a soft dark ring. Selected or pointed at; the one
 *             thing on the screen the OK button acts on.
 *
 * ── Why `marked` is a solid fill and not a wash ──
 * It was a translucent wash, on the reasoning that selection and focus needed
 * to differ in *weight*. That is a defensible design and it was not the one
 * wanted: being in a category is a persistent state the viewer scans for at a
 * glance from across a room, and a 16%-white wash is not what "you are here"
 * looks like. Selection is now unambiguously the white pill it reads as
 * everywhere else in the app.
 *
 * That leaves focus needing a second signal, since it can no longer be a
 * different *kind* of fill. It gets one and a half: pure white against the
 * off-white of `marked`, and a soft dark ring. Both are needed — the two
 * whites are two points apart and would not carry it alone, and the ring at
 * full strength looked like a defect on a capsule (see `filled`). A lighter
 * edge is invisible on the tint and the iOS-only bloom does nothing on the
 * boxes this most matters for, so those were never options. The components add
 * a scale on top, but scale alone is about 5% and reads as nothing at sofa
 * distance.
 *
 * ── Why `filled` is not simply "focused" ──
 * On a tablet or a phone there is no cursor at all (`remoteFocusEnabled` is
 * false, see `tabletUtils`), so `focused` is permanently false there. Keying
 * the edged rung off focus alone would mean a touch device never draws it —
 * which is correct, and is why `selectionRung` folds the input model in rather
 * than leaving each call site to remember.
 *
 * Extracted here rather than written twice because `CategorySidebar` and
 * `CategoryPills` are the same control in two orientations, and they had
 * already drifted into opposite conventions once — the sidebar filling solid
 * on selection while the pills filled solid on focus.
 */
export const SELECTION = {
  rest: { backgroundColor: P.tertiarySystemFill, borderColor: "transparent" },
  restInk: { color: P.secondaryLabel },

  marked: { backgroundColor: THEME.colors.selectedCategory, borderColor: "transparent" },
  markedInk: { color: THEME.colors.selectedText },

  /**
   * Focus is a *brighter white plus a soft ring*, not a hard dark outline.
   *
   * The ring was solid `onTint`, and on a capsule it looked wrong in a way a
   * flat colour swatch does not show: `borderRadius: 9999` with a 1px border is
   * where React Native's corner rendering is least even, so a full-strength
   * line picks out every bit of that unevenness along the curve. The season
   * pills are the worst case because they are the most rounded thing in the
   * app.
   *
   * At 38% the ring still reads as an outline and the aliasing stops being
   * legible as a defect. The fill going to pure `tintStrong` against `marked`'s
   * off-white `tint` carries the rest of the difference — two steps of white
   * where there used to be one, so focus does not depend on the ring alone.
   */
  filled: {
    backgroundColor: P.tintStrong,
    borderColor: "rgba(28, 28, 30, 0.38)",
  },
  filledInk: { color: THEME.colors.selectedText },
};

/**
 * Which rung of `SELECTION` a given item is on.
 *
 * `remoteFocusEnabled` is read here rather than at the call sites so the
 * touch/remote distinction above cannot be got wrong in one component and
 * right in the other.
 */
export const selectionRung = (
  isActive: boolean,
  focused: boolean
): "rest" | "marked" | "filled" => {
  if (focused || (isActive && !remoteFocusEnabled)) return "filled";
  return isActive ? "marked" : "rest";
};

/**
 * The grid screens' header bar — one definition of a block that existed in
 * three byte-identical copies.
 *
 * `live-tv`, `vod` and `series` each carried their own `header`,
 * `headerCenterTitleWrapper`, `headerTitle`, `headerRight`, `searchCircleBtn`,
 * `searchOpenBar` and `searchInput`, all the same. That is the third time this
 * file has had to absorb a duplicated block — `CARD_FRAME` and `TILE_FRAME`
 * were the first two — and the failure mode is always the same: the copies do
 * not drift while anyone is looking, they drift during a palette change, when
 * one of them is updated and the others are not.
 *
 * `series-details` deliberately does not take the bar (it has a hero, not a
 * title row) but does take `iconButton`, so its back button and the grids'
 * search button are the same control.
 *
 * Spread these into the screen's own `StyleSheet.create` under the names the
 * JSX already uses, so no markup has to change:
 *
 *     header: HEADER.bar,
 *     headerTitle: HEADER.title,
 */
/**
 * A data tile — the grouped cell on an information page.
 *
 * **Flat, not glass, and that is the point.** These went through
 * `GlassSurface material="thin"` first and came out wrong on a phone, for a
 * reason worth recording because it is easy to repeat:
 *
 *  - Apple's materials *lighten* what is behind them. On iOS the thin material
 *    is a real `UIVisualEffectView`, and over this app's near-black page it
 *    resolves to a washed mid-grey rather than to a dark card.
 *  - The material's own `fill` then adds more white on top of that.
 *  - The sheen is a gradient across the top 55% of the surface. On a large
 *    panel that reads as light catching a pane; on a 62dp tile it reads as a
 *    two-tone band, which is exactly the "muddy plastic" look.
 *
 * The deeper point is a distinction the material system does not make on its
 * own: **glass is for surfaces that float over content** — sheets, bars, the
 * channel list over video. A tile sitting on a page background is not floating
 * over anything, and Apple renders that case opaque
 * (`secondarySystemGroupedBackground`) in its own settings and information
 * screens. Reaching for a material here is applying the effect where there is
 * nothing for it to sample.
 *
 * Flat also means iOS and an STB render the same thing, which nothing built on
 * `BLUR_ENABLED` can promise.
 */
export const DATA_TILE = {
  /**
   * Separation comes from the fill alone — no border.
   *
   * A fill against the page's `#000000` is how Apple separates a grouped cell
   * from its page: by being a different colour, not by being outlined. A
   * hairline on top of that is a second statement of the same thing, and on a
   * grid of a dozen tiles it is a dozen drawn rectangles competing with the
   * values inside them.
   *
   * `secondaryElevatedSystemBackground` (`#2C2C2E`) rather than
   * `secondarySystemBackground` (`#1C1C1E`), which this first used. The
   * elevated value is what every other surface in the app already stands on —
   * settings' grouped cards, the category rows, the dashboard tiles, the EPG
   * rows, parental-control's groups — so the darker one made these two screens
   * the only place a card sat lower than the rest. Being *consistently* raised
   * matters more here than the half-step of extra contrast, and Apple's own
   * rule points the same way: a cell on a plain page is elevated, and the
   * non-elevated value is for content already inside a raised container.
   */
  backgroundColor: P.secondaryElevatedSystemBackground,
  borderRadius: RADIUS.card,
  borderCurve: "continuous" as const,
};

/**
 * The *page* header — a stacked title and subtitle, left aligned.
 *
 * The app has two header shapes and this is the other one. `HEADER` below is
 * the grid bar: a centred title with actions either side, on the screens whose
 * content is a grid. This one belongs to the pages you arrive at from a menu —
 * settings, the two diagnostics screens, parental control, privacy, categories.
 *
 * Six screens were wearing it and no two agreed. Collected, with the scale each
 * file's local `ps` actually resolves to:
 *
 *     screen             padH    padTop   title         tracking
 *     settings           pw(8)   ph(5)    psRaw(2.6)    +0.5
 *     privacy-policy     pw(8)   ph(5)    psRaw(2.6)    +0.5
 *     parental-control   pw(8)   ph(5.5)  psRaw(2.6)    +0.5
 *     categories         pw(8)   ph(5)    psRaw(2.2)    +0.5
 *     speed-test         pw(8)   ph(5)    psRaw(2.2)    -0.4
 *     system-info        pw(4)   ph(2)    ps(2.0)       -0.4
 *
 * That last column is the part worth reading twice. Five of these files import
 * `psRaw as ps`; `system-info` imports the real, TV-bumped `ps`. The two are
 * 1.3x apart on a box, so an identical-looking `ps(2.x)` means two different
 * sizes depending on which file it is written in — the trap `psRaw`'s own
 * docblock warns about. `system-info`'s `ps(2.0)` was therefore the *largest*
 * of the six, not the smallest as the number suggests.
 *
 * So this block is built on **`psRaw`**, matching the five, which lands
 * `psRaw(2.6)`: settings, privacy-policy and parental-control are unchanged to
 * the pixel, categories and speed-test come up from 2.2, and system-info stays
 * exactly where it was. Using the bumped `ps` here would have looked tidier in
 * this file and grown five titles by a third.
 *
 * `system-info` was also on half the gutter and under half the top padding, so
 * it began further up and further out than every page beside it in the same
 * menu. Its scroll padding had to move with the header or the two would no
 * longer align.
 *
 * Tracking goes negative, reversing what five of the six had. Apple tightens
 * type as it grows; +0.5 at display size reads loose, and it was almost
 * certainly inherited from the uppercase labels elsewhere in these files, where
 * wide tracking is correct.
 */
export const PAGE_HEADER = {
  /**
   * The gap below the bar is generous, and it has to be.
   *
   * These headers used to carry a subtitle, and every screen set its own small
   * `paddingBottom` underneath it — 4, 6 or 8dp on a handset. That worked
   * because the *subtitle* was doing the separating: a dimmer second line is
   * itself a gap between the title and whatever follows. With the bylines gone
   * the title sat almost directly on the content, and the six little overrides
   * turned out to be measuring the wrong thing.
   *
   * So the space is stated once, here, and the screens no longer set it.
   */
  bar: {
    paddingHorizontal: pw(8),
    paddingTop: ph(2),
    // `ph` is a percentage of the *short* edge, which on a portrait handset is
    // its width — so `ph(3.5)` is about 14dp there against 19 on the box. A
    // phone needs more separation than that and not less, hence the explicit
    // value rather than letting the percentage decide.
    paddingBottom: isPhone ? 22 : ph(3.5),
  },
  title: {
    color: P.label,
    // The phone value is the reference 18dp carrying `PHONE_UI_SCALE`, which is
    // the convention documented on `phoneDp` — not a separately-chosen number.
    fontSize: isPhone ? 20.7 : psRaw(2.6),
    fontFamily: THEME.fonts.bold,
    letterSpacing: -0.5,
  },
  subtitle: {
    color: P.secondaryLabel,
    fontSize: isPhone ? 14.4 : psRaw(1.1),
    marginTop: ph(0.6),
  },

  /**
   * The uppercase heading above a group of rows or tiles.
   *
   * Three screens had one and all three disagreed — on a phone,
   * `parental-control` set 15.5, `settings` 12 and `system-info` about 11. The
   * first of those is within a point of that screen's own *row titles*, which
   * is why its sections read as headings of the content rather than as labels
   * on it.
   *
   * Small is the point. This is a caption naming what follows, not a title;
   * the uppercase and the tracking are what give it presence, and size on top
   * of those is what makes it shout. Medium rather than the bold two of them
   * used, for the same reason — uppercase, widely tracked *and* bold is three
   * kinds of emphasis on a word like "DEVICE".
   */
  sectionLabel: {
    color: P.secondaryLabel,
    fontSize: isPhone ? 12.1 : psRaw(1.2),
    fontFamily: THEME.fonts.medium,
    letterSpacing: 2,
    textTransform: "uppercase" as const,
  },
};

export const HEADER = {
  bar: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingHorizontal: pw(3),
    height: 56,
  },

  /**
   * The title is centred against the *screen*, not against the space left over
   * between the leading spacer and the trailing actions — so it stays put when
   * the search field opens and the right-hand side changes width.
   */
  centerTitleWrapper: {
    position: "absolute" as const,
    left: 0,
    right: 0,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    pointerEvents: "none" as const,
  },

  title: {
    color: P.label,
    fontSize: ps(1.6),
    // Real weight from the family. This was `fontWeight: "900"`, which
    // `components/Text` strips — so all three of these headings had been
    // rendering as Regular, which is most of why they read as a different
    // screen from everything they sit beside.
    fontFamily: THEME.fonts.semibold,
    letterSpacing: -0.3,
  },

  right: { flexDirection: "row" as const, alignItems: "center" as const },

  /** Clips the focus scale to the capsule. */
  iconButtonWrapper: { borderRadius: RADIUS.full, overflow: "hidden" as const },

  /**
   * The round 44dp control — search on the grids, back on the details screen.
   *
   * `#17181c` before, a near-black a shade off every other surface in the app.
   * It is a fill rather than a material: at 44dp round there is not enough area
   * for a sheen and a specular edge to read as anything but noise.
   */
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.full,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: P.tertiarySystemFill,
    borderWidth: 1,
    borderColor: P.glassEdgeSoft,
    overflow: "hidden" as const,
  },

  /** Fills with the tint — so the glyph inside must invert to `onTint`. */
  iconButtonFocused: {
    borderRadius: RADIUS.full,
    backgroundColor: P.tint,
    borderColor: P.tint,
    borderWidth: 1,
    transform: [{ scale: 1.12 }],
    overflow: "hidden" as const,
  },

  /** The expanded search field. Same fill and edge as the button it replaces. */
  searchBar: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    backgroundColor: P.tertiarySystemFill,
    borderRadius: RADIUS.full,
    paddingHorizontal: pw(1.4),
    height: 44,
    borderWidth: 1,
    borderColor: P.glassEdgeSoft,
  },

  searchInput: {
    flex: 1,
    color: P.label,
    fontSize: ps(1.15),
    fontFamily: THEME.fonts.medium,
    paddingVertical: 0,
    textAlignVertical: "center" as const,
  },
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
  borderRadius: RADIUS.card,
  // The `thin` material: tiles sit over artwork that is decorative rather than
  // load-bearing, so the surface can afford some body. A tile built from
  // `GlassSurface material="thin"` is the same surface as one built from this.
  backgroundColor: MATERIALS.thin.fillNoBlur,
  borderWidth: 1,
  borderColor: MATERIALS.thin.edge,
};

/**
 * The focused half of `TILE_FRAME`: a solid white edge, a brightened wash, and
 * on iOS a white bloom. Android takes no elevation — a lifted tile draws its
 * shadow over its neighbours in a grid, so the edge and the fill carry focus
 * there on their own. That constraint is why `FOCUS.edge` is solid rather than
 * translucent; see the note on it in `materials.ts`.
 *
 * Deliberately a *wash* and not the solid tint fill a focused row or pill
 * takes. A tile is mostly artwork, and filling it would paint over the poster
 * that is the whole reason the tile exists — so here focus lights the frame
 * and leaves the picture alone.
 */
export const TILE_FRAME_FOCUSED = {
  borderColor: FOCUS.edge,
  backgroundColor: FOCUS.fillNoBlur,
  ...focusGlowShadow,
};
