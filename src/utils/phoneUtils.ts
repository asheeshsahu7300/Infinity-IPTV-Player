import { Platform, Dimensions } from 'react-native';

/**
 * Shared handset detection, and the dimensions a phone needs in its own right.
 *
 * One module per device class, the same separation `tvUtils` and `tabletUtils`
 * already keep: a phone is not a small tablet and must not be reported as one.
 * `isTablet` gates the touch layout at tablet proportions; this file answers
 * only "is this a handset", and the values below are the ones that had to
 * differ because a portrait phone is *narrow*, not merely smaller.
 *
 * Standalone, with its own `Dimensions` read, because that is how the other two
 * device-class modules are built and because `tabletUtils` imports `isPhone`
 * from here — the dependency runs tablet -> phone, and a read of its own is
 * what keeps that from being a cycle.
 *
 * Detection is by **shortest side**, Android's `sw600dp` convention, so the
 * class is the same number in portrait and landscape and cannot flip under
 * rotation. Measured against `screen` rather than `window` because system-bar
 * insets are not a property of the device; `window` is the fallback only
 * because that is all react-native-web populates.
 */

const screenDims = Dimensions.get('screen');
const windowDims = Dimensions.get('window');

/** First value that is an actual measurement rather than a zero placeholder. */
const firstPositive = (...values: (number | undefined)[]): number =>
    values.find((v) => typeof v === 'number' && v > 0) ?? 0;

const displayWidth = firstPositive(screenDims.width, windowDims.width);
const displayHeight = firstPositive(screenDims.height, windowDims.height);

/**
 * Shortest side of the physical display in dp, or 0 when it could not be read.
 *
 * The zero matters. This module is evaluated as the bundle loads, and if
 * neither `screen` nor `window` has been populated yet both axes come back 0 —
 * so the previous `Math.min(screen.width || window.width, ...)` produced 0, and
 * every "is it small" test below answered *yes*. A tablet then classified as a
 * handset: phone styles on every screen, and `app/_layout` locking it to
 * portrait so it could not be turned. Distinguishing "small" from "unknown" is
 * the whole point of keeping the 0 rather than folding it into the comparison.
 */
export const shortestSide =
    displayWidth > 0 && displayHeight > 0 ? Math.min(displayWidth, displayHeight) : 0;

/**
 * Longest side of the physical display in dp, or 0 when it could not be read.
 *
 * In landscape — which is where tablets are locked — this is the width, so it
 * is what anything sized against the panel's breadth should scale from.
 */
export const longestSide =
    displayWidth > 0 && displayHeight > 0 ? Math.max(displayWidth, displayHeight) : 0;

/** False when the display reported nothing, so callers can refuse to guess. */
export const hasMeasuredDisplay = shortestSide > 0;

/** A hand-held platform: phone or tablet, never a TV and never the web. */
export const isTouchPlatform =
    !Platform.isTV && (Platform.OS === 'android' || Platform.OS === 'ios');

/**
 * The handset ceiling, in dp of shortest side.
 *
 * 480, not Android's usual 600. `sw600dp` is measured in *dp*, so it is a
 * statement about density as much as size: a 1920x1200 tablet at ~2.25 density
 * reports 853x533dp and falls under 600, and Android itself then treats it as
 * phone-class. One did exactly that here — every screen took the phone tier
 * and `app/_layout` locked it upright, so the tablet could not go landscape.
 *
 * 480 separates the two populations with room on both sides: the largest
 * handsets sit around 412-430dp and the tablet above is 533. It is also
 * Android's own `sw480dp` "large screen" bucket rather than an invented number.
 * A device between 480 and 600 is therefore a tablet here even though
 * `sw600dp` resources would call it a phone — deliberately, because this app's
 * tablet layout fits it and its phone layout does not.
 *
 * This value, `tabletUtils.TABLET_BREAKPOINT`, and
 * `withHandsetPortrait`'s `smallestScreenWidthDp <` test must agree. The
 * native pin decides that a device *launches* portrait and `isPhone` decides
 * that it is *laid out* for portrait; a device only one of them called a phone
 * would be pinned to an orientation it was not sized for, or sized for one it
 * was not pinned to. That is not hypothetical — it is the bug this comment
 * exists because of.
 */
export const PHONE_MAX_SHORTEST_SIDE = 480;

/**
 * A handset: a touch device below the tablet breakpoint. Never true on a TV —
 * a box reports its own display and must not be turned upright.
 */
export const isPhone =
    isTouchPlatform &&
    hasMeasuredDisplay &&
    shortestSide < PHONE_MAX_SHORTEST_SIDE;

/**
 * Horizontal page padding on a handset, in dp.
 *
 * An absolute value rather than `pw()`, and this is the recurring phone trap
 * rather than a style preference: `theme/tokens` normalises `W` to the *long*
 * edge so that the metrics do not change under rotation, which means `pw(4.2)`
 * is 37dp of a 393dp portrait screen — near 10% a side — where it is 4.2% of a
 * TV. Anything spanning the width of a portrait phone wants a dp.
 */
export const PHONE_H_PAD = 8;

/**
 * Columns in a poster or channel grid on a handset.
 *
 * Three, against five on the box and four on a portrait tablet. At 393dp with
 * `PHONE_H_PAD` a side this gives a ~115dp tile — a 2:3 poster at 115x172,
 * which is the smallest a cover reads at.
 *
 * Episode grids of 16:9 stills use this too. They were briefly given their own
 * count of two, on the reasoning that a landscape still needs more width than a
 * portrait cover, but three is what was wanted and one constant is better than
 * two that must both be three.
 */
export const PHONE_GRID_COLUMNS = 3;


/**
 * Width of the header's open search field on a handset, in dp.
 *
 * The grids size this `pw(36)`, which is 314dp on a phone against 341dp of
 * header inside its padding — and the header already carries a 38dp spacer, so
 * the field overflowed the row. 260 leaves that comfortably.
 */
export const PHONE_SEARCH_BAR_WIDTH = 260;

/** Ceiling for the floating notice/toast, in dp. Its `pw(60)` is 524dp on a
 *  handset — wider than the screen, so the cap never bound and a long notice
 *  ran edge to edge. */
export const PHONE_NOTICE_MAX_WIDTH = 320;

/** Width of one tile in a horizontally scrolling rail, in dp. Sized so a rail
 *  shows part of a fourth tile and so reads as scrollable. */
export const PHONE_RAIL_ITEM_WIDTH = 104;

/**
 * Category sidebar width on a handset, in dp — see `tabletUtils.SIDEBAR_WIDTH`,
 * which selects it.
 *
 * A fallback rather than a layout: phones are pinned portrait and every grid
 * screen swaps the sidebar for `CategoryPills` in portrait, so this is only
 * reachable in the frames before the pin applies. It is here so that window is
 * not 240dp of a 393dp screen.
 */
export const PHONE_SIDEBAR_WIDTH = 160;
