import { Platform, Dimensions } from 'react-native';

/**
 * Shared device detection utilities.
 *
 * Detection is based on the device's *smallest width* (the shorter of the two
 * screen dimensions), which is orientation-invariant — exactly how Android's
 * `sw600dp` resource qualifier distinguishes phones from tablets. This means a
 * phone rotated to landscape stays a phone, and a tablet stays a tablet in both
 * orientations, instead of flipping device class on rotation.
 *
 * TV is authoritative via `Platform.isTV` (react-native-tvos sets this on
 * Android TV / Fire TV / tvOS). The smallest-width fallback (> 1000dp) only
 * catches genuine large displays (1080p+), so real TVs are always detected and
 * touch tablets are never misclassified as TV.
 */
const screen = Dimensions.get('screen');
const SHORTEST_SIDE = Math.min(screen.width, screen.height);

// Material 3 window-size-class breakpoints (dp).
export const BREAKPOINTS = {
  /** < 600dp smallest-width → phone (compact). */
  TABLET_MIN: 600,
  /** 600–840dp → tablet portrait / foldable (medium). */
  EXPANDED_MIN: 840,
  /** Treated as TV when no Platform.isTV signal is present. */
  TV_MIN: 1000,
} as const;

export const isTV =
  Platform.isTV ||
  (Platform.OS === 'android' && SHORTEST_SIDE > BREAKPOINTS.TV_MIN) ||
  (Platform.OS === 'web' && SHORTEST_SIDE > 800);

/** Tablet: any non-TV device with a smallest width ≥ 600dp (Android `sw600dp`). */
export const isTablet = !isTV && SHORTEST_SIDE >= BREAKPOINTS.TABLET_MIN;

/** Phone: any non-TV device with a smallest width < 600dp. */
export const isPhone = !isTV && !isTablet;

export type DeviceClass = 'phone' | 'tablet' | 'tv';

export const deviceClass: DeviceClass = isTV ? 'tv' : isTablet ? 'tablet' : 'phone';
