import {
  hasMeasuredDisplay,
  isPhone,
  isTouchPlatform,
  longestSide,
  PHONE_MAX_SHORTEST_SIDE,
  PHONE_SIDEBAR_WIDTH,
  shortestSide,
} from './phoneUtils';

/**
 * Shared tablet detection utility.
 *
 * Kept deliberately separate from `tvUtils` — a tablet is not a TV and must not
 * be reported as one. `isTV` gates *behaviour* that only a box has (remote key
 * handling, overscan, the "Android TV" line in system info); this file answers
 * only "is this a tablet", and screens that want the TV *look* on a tablet ask
 * for both flags at the point of use.
 *
 * Detection is by **shortest side**, Android's `sw600dp` convention, rather
 * than by width. That is the same number in portrait and landscape, so the
 * device class cannot flip under rotation — a width test would call a tablet a
 * phone the moment it was turned upright.
 *
 * Measured against `screen` and not `window` because system-bar insets are not
 * a property of the device; `window` is the fallback only because that is all
 * react-native-web populates.
 */

/**
 * Re-exported from `phoneUtils`, which owns the one measurement of the display.
 * It used to be derived again here from its own `Dimensions` read, which is how
 * the two could disagree.
 */
export { shortestSide };

/** Android's tablet breakpoints, in dp of shortest side. */
/** Must equal `phoneUtils.PHONE_MAX_SHORTEST_SIDE` — see the note there. */
export const TABLET_BREAKPOINT = PHONE_MAX_SHORTEST_SIDE;
export const LARGE_TABLET_BREAKPOINT = 1000;


/**
 * True on tablets. Never true on a TV: a box reports a large display too, and
 * letting it answer `true` here is exactly the conflation this file exists to
 * avoid.
 *
 * Defined as "a touch device that is not a handset" rather than as
 * `shortestSide >= 600`, which makes tablet the **fallback** of the pair. When
 * the display cannot be measured — `Dimensions` not yet populated as the bundle
 * evaluates — the old form answered false here and true in `isPhone`, so an
 * unmeasurable tablet became a phone. Now neither a missing measurement nor a
 * future change to the breakpoint can leave a touch device classified as
 * something it is not, and the two flags stay mutually exclusive by
 * construction rather than by both being kept in step.
 */
export const isTablet = isTouchPlatform && !isPhone;

/** 12"-class tablets (iPad Pro, Tab S Ultra) — shortest side ≥ 1000dp. */
export const isLargeTablet =
  isTablet && hasMeasuredDisplay && shortestSide >= LARGE_TABLET_BREAKPOINT;


/**
 * Any hand-held touch device — a tablet or a phone, never a box.
 *
 * Composed here rather than in `phoneUtils` so that the dependency stays
 * one-directional — `tabletUtils` reaches into `phoneUtils`, never the other
 * way — and so every consumer of `isTouch` and `remoteFocusEnabled` keeps the
 * import it already has.
 *
 * The branch point for "touch layout or TV layout", and it exists because
 * several screens were using `isTablet` for that question. That reads as a
 * synonym only while the two touch classes are one, which they no longer are:
 * `isTablet ? 10 : pw(1.2)` and `isTablet ? (isPortrait ? 5 : 7) : 7` silently
 * routed every phone down the *TV* branch, so a handset asked for a 7-column
 * result grid at 56dp a column. Use `isTouch` for the touch/TV question and
 * keep `isTablet` for what is genuinely tablet-only sizing.
 */
export const isTouch = isTablet || isPhone;

/**
 * How much bigger this tablet's panel is than the one the layouts were drawn
 * against, for the raw-dp numbers that `ps()` deliberately will not scale.
 *
 * The tablet type scale is panel-independent on purpose — `TABLET_PS_TARGET`
 * in theme/tokens hands every tablet the same 11.5dp per percent — so a screen
 * built from `ps()` reads identically on an 853x533 and a 1506x941 panel. That
 * is right for body copy and wrong for chrome: header marks, hero titles,
 * pills and round icon buttons were each given a flat dp number tuned on the
 * 853, and on a panel three times the area they read as having shrunk.
 *
 * 533 is that reference short edge, so this is exactly 1 there and every
 * existing number survives untouched. Damped to 0.75 of the true ratio and
 * capped, because chrome should grow *with* the panel, not *like* it — at the
 * full ratio a hero title on a large tablet ends up TV-sized.
 *
 * Short edge, like `isTablet` itself, so it cannot flip under rotation. Must
 * stay below `isTablet`'s own declaration: these are `const`, so reading it
 * from higher up the file is a TDZ error at module load, not a compile one.
 */
export const TABLET_PANEL_SCALE = isTablet
  ? Math.min(1.45, Math.max(1, 1 + (shortestSide / 533 - 1) * 0.75))
  : 1;

/**
 * Largest a grid tile may get on a tablet, in dp.
 *
 * The grids keep their 5 columns everywhere; this caps how big each tile may
 * grow, and the leftover width becomes gap. Without a cap, tile width is
 * `available / 5` -- 139dp on the box but 201dp on a tablet -- and tile height
 * was in turn derived from the *viewport*, so an 800dp panel produced a 359dp
 * row against the 229dp row of a 540dp TV. Those two compounding is what made
 * the posters fill half the screen.
 *
 * 168 is the search page's own card width, the reference for how big a tile
 * should read on a touch screen; at a 2:3 poster that lands on 168x252, which
 * matches its 167.5x251 almost exactly.
 *
 * It is now a *bounded* share of the panel rather than a flat 168, because a
 * flat cap has the opposite failure at the other end: on a 1506dp panel it
 * held tiles at 152 while the sidebar and type had both grown, so the artwork
 * read undersized. The bounds are what keep the original objection true —
 * percentage sizing alone is what blows a tile up on a larger panel, so the
 * 240 ceiling stops it, and the 168 floor holds every tablet at or above the
 * size this comment describes.
 *
 * 853 and 1280 panels sit on the floor and are unchanged; only panels wide
 * enough to leave the tile looking small are affected.
 */
export const TABLET_TILE_MAX_WIDTH = Math.round(
  Math.min(240, Math.max(168, longestSide * 0.13))
);

/**
 * Tile-width cap for this device. Only a tablet is capped.
 *
 * A phone stays uncapped on purpose. The cap answers a surplus-width problem —
 * a tablet's viewport divided by the same column count yields a tile larger
 * than it should be — and a phone has the opposite one: three columns of a
 * ~393dp portrait viewport already give a ~115dp tile, well under the ceiling,
 * so a cap could only ever shrink it further.
 */
export const TILE_MAX_WIDTH = isTablet ? TABLET_TILE_MAX_WIDTH : Infinity;

/**
 * Clamp a viewport-derived size to a ceiling, on tablets only.
 *
 * The recurring tablet problem in one function. Every metric in this app is a
 * percentage of the viewport, and a tablet's viewport is larger in dp than a
 * TV's in both axes -- 1280x800 against 960x540 -- so the identical percentage
 * lands 33% wider and 48% taller. That is right for *proportion* and wrong for
 * anything with an intrinsic physical size: a logo, a text row, a padding.
 * Those read as bloated, because dp on a TV is already inflated for the sofa
 * and a tablet is held at arm's length.
 *
 * `maxDp` should be roughly the value the metric renders at on the box, so the
 * element keeps its physical density and the tablet's surplus space turns into
 * *more content* rather than bigger content.
 *
 * Identity on a TV, so passing a clamp through cannot change the box.
 */
export const tabletClamp = (value: number, maxDp: number): number =>
  isTablet ? Math.min(value, maxDp) : value;

/**
 * Category sidebar width, in dp.
 *
 * 240dp on the box. On tablets it is a share of the panel's breadth rather
 * than a fixed 200: 200 was picked against a 1280x800 tablet, where it is 16%
 * of the width, but the same number is 13% of a 1506dp panel — the sidebar
 * looked squeezed and the category names ran out of room, while on an 853dp
 * tablet it was a roomy 23%.
 *
 * 22%, raised from a first pass at 18% which still read narrow on a large
 * panel. The pill inside is `width: "100%"` less the list's `pw(1.2)` gutter
 * either side, so this number is what the pill's width follows.
 *
 * The floor keeps the small tablet exactly where it is today (0.22 x 853 is
 * under 200, so it clamps up) and the ceiling stops a very wide panel from
 * spending a third of itself on a list of genre names.
 *
 * The phone tier lives in `phoneUtils` with the reason it is only a fallback;
 * this is the one place that chooses between the three.
 */
export const SIDEBAR_WIDTH = isPhone
  ? PHONE_SIDEBAR_WIDTH
  : isTablet
    ? Math.round(Math.min(360, Math.max(200, longestSide * 0.22)))
    : 240;

/**
 * Whether the D-pad focus system should be live.
 *
 * A tablet has no remote, so the focus ring, the auto-grab of initial focus and
 * the focus-memory restore pulse all fire for an input device that is not
 * there — which shows up as a white ring around a tile nobody selected. Touch
 * drives `onPress` through `Pressable` regardless of focus, so switching this
 * off costs no interaction.
 *
 * Deliberately scoped to *focus*, not to key handling: screens subscribe to
 * `useDPad`/`useStbKeys` directly for global keys, and a tablet can still have
 * a Bluetooth keyboard or remote attached, so those stay listening.
 *
 * `!isTouch`, not `!isTablet`: a phone has no remote either, and while it was
 * only tablets that were excluded a handset drew the focus ring, grabbed
 * initial focus and fired the focus-memory restore pulse — plus `Focusable`'s
 * 350ms global press debounce, which exists to swallow a remote's duplicate
 * DPAD_CENTER and on a touch screen just eats quick taps.
 */
export const remoteFocusEnabled = !isTouch;
