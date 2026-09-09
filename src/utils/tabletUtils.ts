import { Platform, Dimensions } from 'react-native';

import { isPhone, PHONE_SIDEBAR_WIDTH } from './phoneUtils';

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

const screenDims = Dimensions.get('screen');
const windowDims = Dimensions.get('window');

/** Shortest side of the physical display, in dp. */
export const shortestSide = Math.min(
    screenDims.width || windowDims.width,
    screenDims.height || windowDims.height
);

/** Android's tablet breakpoints, in dp of shortest side. */
export const TABLET_BREAKPOINT = 600;
export const LARGE_TABLET_BREAKPOINT = 1000;

/**
 * True on phones/tablets that are tablet-sized. Never true on a TV: a box
 * reports a large display too, and letting it answer `true` here is exactly the
 * conflation this file exists to avoid.
 */
export const isTablet =
    !Platform.isTV &&
    (Platform.OS === 'android' || Platform.OS === 'ios') &&
    shortestSide >= TABLET_BREAKPOINT;

/** 12"-class tablets (iPad Pro, Tab S Ultra) — shortest side ≥ 1000dp. */
export const isLargeTablet = isTablet && shortestSide >= LARGE_TABLET_BREAKPOINT;


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
 * An absolute dp cap rather than a percentage, deliberately: a tile has an
 * intrinsic physical size, and percentage sizing that reads well on one panel
 * is exactly what blows it up on a larger one.
 */
export const TABLET_TILE_MAX_WIDTH = 168;

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
 * 240dp on the box. On tablets, reduced to 200dp so that the category sidebar
 * remains compact and leaves ample room for the channel/media grid.
 *
 * The phone tier lives in `phoneUtils` with the reason it is only a fallback;
 * this is the one place that chooses between the three.
 */
export const SIDEBAR_WIDTH = isPhone
  ? PHONE_SIDEBAR_WIDTH
  : isTablet
    ? 200
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
