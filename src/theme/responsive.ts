import { Platform, useWindowDimensions } from 'react-native';
import { BREAKPOINTS, DeviceClass } from '../utils/tvUtils';

/**
 * Minimum interactive (touch) target size per Material Design / Android
 * accessibility guidelines. Any pressable on a touch device should be at least
 * this many dp in both dimensions.
 */
export const MIN_TOUCH = 48;

export interface Responsive {
  width: number;
  height: number;
  /** Orientation-invariant smallest dimension (Android `sw` concept). */
  shortestSide: number;
  isLandscape: boolean;
  isTV: boolean;
  isTablet: boolean;
  isPhone: boolean;
  /** Material window size class by width: compact | medium | expanded. */
  sizeClass: 'compact' | 'medium' | 'expanded';
  deviceClass: DeviceClass;
}

/**
 * Reactive companion to the static flags in `utils/tvUtils`. Recomputes on
 * rotation / window-resize so layouts (grid columns, panes, paddings) update
 * live. Use this inside components; use the static `isTV/isTablet/isPhone`
 * consts for module-level StyleSheet decisions that don't need to react.
 */
export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();
  const shortestSide = Math.min(width, height);
  const isLandscape = width >= height;

  const isTV =
    Platform.isTV ||
    (Platform.OS === 'android' && shortestSide > BREAKPOINTS.TV_MIN) ||
    (Platform.OS === 'web' && shortestSide > 800);
  const isTablet = !isTV && shortestSide >= BREAKPOINTS.TABLET_MIN;
  const isPhone = !isTV && !isTablet;

  const sizeClass =
    width < 600 ? 'compact' : width < BREAKPOINTS.EXPANDED_MIN ? 'medium' : 'expanded';

  return {
    width,
    height,
    shortestSide,
    isLandscape,
    isTV,
    isTablet,
    isPhone,
    sizeClass,
    deviceClass: isTV ? 'tv' : isTablet ? 'tablet' : 'phone',
  };
}

/**
 * Adaptive column count for a media grid. Mirrors Material's
 * `GridCells.Adaptive(minSize)` — fits as many columns of at least `minItem` dp
 * as the available width allows, then clamps to sane per-device bounds so the
 * TV layout stays dense and phones never go below 2 tiles.
 */
export function gridColumns(
  availableWidth: number,
  opts: { minItem?: number; isTV?: boolean; isTablet?: boolean; max?: number } = {}
): number {
  const { minItem = 180, isTV = false, isTablet = false, max } = opts;
  const fitted = Math.max(1, Math.floor(availableWidth / minItem));
  const ceiling = max ?? (isTV ? 7 : isTablet ? 5 : 3);
  const floor = isTV ? 4 : 2;
  return Math.min(ceiling, Math.max(floor, fitted));
}
