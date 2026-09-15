import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { BlurTargetView, BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';

import {
  ANDROID_BLUR_METHOD,
  ANDROID_BLUR_REDUCTION,
  BLUR_ENABLED,
  FOCUS,
  MATERIALS,
  RADIUS,
  focusGlowShadow,
  popoverShadow,
  sheetShadow,
  sheenColors,
  type MaterialName,
} from '../theme/materials';
import { glassEdgeHighlight } from '../theme/palette';

/**
 * GlassSurface — the one way this app draws a translucent surface.
 *
 * Every card, row, panel, sheet, pill and bar goes through here. That is worth
 * insisting on for a reason beyond consistency: "glass" is four layers, not
 * one, and a surface that skips any of them stops reading as glass without it
 * being obvious which layer is missing. The layers, bottom to top, are
 *
 *   1. the blurred backdrop (or, where there is none, a heavier flat fill),
 *   2. a tint wash over it,
 *   3. a specular sheen falling off from the top edge,
 *   4. a hairline border, brighter along the top than around the rest.
 *
 * Hand-rolled glass in the wild almost always has (1) and (4) and neither of
 * the middle two, which is why it looks like a tinted rectangle.
 *
 * ── Which material ──
 * See the table in `theme/materials.ts`. Briefly: `ultraThin` over video,
 * `thin` over artwork, `regular` for most chrome, `thick` for sheets, `chrome`
 * for anything pinned over scrolling content.
 *
 * ── Android needs a target ──
 * See `GlassRoot` below. Without one, Android gets no blur — silently.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * GlassRoot
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * The view Android blurs, published to every `GlassSurface` beneath it.
 *
 * The context carries a ref *object* rather than the view itself because that
 * is the shape `BlurView` takes, and it is rebuilt whenever the view resolves
 * so that consumers actually re-render — a bare `useRef` mutation would leave
 * every `BlurView` holding the null it first saw.
 */
const GlassTargetContext = createContext<React.RefObject<View | null> | null>(null);

export interface GlassRootProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Wraps a subtree so that glass inside it can blur what is behind it.
 *
 * This exists because of a genuine trap in expo-blur 57: on Android a
 * `BlurView` blurs the contents of a nominated `BlurTargetView`, and if none is
 * nominated the native side **falls back to no blur at all** and logs a warning
 * (see `_maybeWarnAboutBlurMethod` in the library). There is no error and no
 * visual clue beyond the surface looking flat, so a missing root is the single
 * most likely way this design system quietly stops working on Android.
 *
 * Mounted once, in `app/_layout.tsx`, around the navigator — so every screen is
 * inside one and no screen has to think about it. A screen that renders glass
 * outside that tree (a portalled modal, say) needs its own.
 *
 * On iOS and tvOS `BlurTargetView` is a plain `View` and the whole thing is
 * inert; on a device where `BLUR_ENABLED` is false it is skipped entirely
 * rather than rendered and ignored, so an STB does not pay for a native view it
 * will never blur into.
 */
export function GlassRoot({ children, style }: GlassRootProps) {
  const [target, setTarget] = useState<View | null>(null);

  // Rebuilt on every change of `target` precisely so the identity changes:
  // BlurView compares `prevProps.blurTarget?.current` and only re-reads the
  // native handle when it differs.
  const targetRef = useMemo(() => ({ current: target }), [target]);

  if (!BLUR_ENABLED || Platform.OS !== 'android') {
    return (
      <GlassTargetContext.Provider value={null}>
        <View style={[styles.root, style]}>{children}</View>
      </GlassTargetContext.Provider>
    );
  }

  return (
    <GlassTargetContext.Provider value={targetRef}>
      <BlurTargetView ref={setTarget as unknown as React.RefObject<View | null>} style={[styles.root, style]}>
        {children}
      </BlurTargetView>
    </GlassTargetContext.Provider>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * GlassSurface
 * ──────────────────────────────────────────────────────────────────────────*/

export type GlassShadow = 'none' | 'popover' | 'sheet';

export interface GlassSurfaceProps extends Omit<ViewProps, 'style'> {
  /** Which material. Defaults to `regular`. See `theme/materials.ts`. */
  material?: MaterialName;
  /** Corner radius in dp. Defaults to `RADIUS.card`. */
  radius?: number;
  /**
   * Focused surfaces brighten and take a tinted edge. Pass the `focused` the
   * `Focusable` render prop hands you — it is already gated on
   * `remoteFocusEnabled`, so a tablet never lights up.
   */
  focused?: boolean;
  /** Draw the hairline border. Off for surfaces that butt against each other. */
  bordered?: boolean;
  /** Draw the top specular. Off for very small surfaces, where it only muddies. */
  sheen?: boolean;
  /** Drop shadow. Sheets and popovers only — see the note on `focusGlowShadow`. */
  shadow?: GlassShadow;
  /**
   * Replaces the material's own fill. For the rare surface that must carry a
   * colour — a destructive row, a "live now" badge — while keeping the glass.
   */
  tint?: string;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

export const GlassSurface = React.memo(function GlassSurface({
  material = 'regular',
  radius = RADIUS.card,
  focused = false,
  bordered = true,
  sheen = true,
  shadow = 'none',
  tint,
  style,
  children,
  ...rest
}: GlassSurfaceProps) {
  const blurTarget = useContext(GlassTargetContext);
  const spec = MATERIALS[material];

  // Android only blurs into a nominated target. Asking for a blur method
  // without one earns a console warning per surface and no blur, so the honest
  // thing is to ask for 'none' and take the heavier fallback fill.
  const androidHasTarget = Platform.OS !== 'android' || Boolean(blurTarget?.current);
  const blurring = BLUR_ENABLED && androidHasTarget;

  const fill = tint
    ? tint
    : focused
      ? blurring
        ? FOCUS.fill
        : FOCUS.fillNoBlur
      : blurring
        ? spec.fill
        : spec.fillNoBlur;

  const sheenOpacity = focused ? FOCUS.sheen : spec.sheen;
  const edge = focused ? FOCUS.edge : spec.edge;

  const shadowStyle =
    shadow === 'sheet' ? sheetShadow : shadow === 'popover' ? popoverShadow : undefined;

  return (
    <View
      {...rest}
      style={[
        {
          borderRadius: radius,
          // iOS 13+ draws Apple's actual squircle for this; Android ignores it
          // and keeps the circular corner it would have had anyway. Free where
          // it works, harmless where it does not.
          borderCurve: 'continuous',
          borderWidth: bordered ? StyleSheet.hairlineWidth * 2 : 0,
          borderColor: bordered ? edge : 'transparent',
          // With no blur the fill lives on the outer view rather than on an
          // inner layer. Two reasons: it is one view fewer on the device class
          // that can least afford them, and Android derives an `elevation`
          // shadow from the view's background — a transparent one casts
          // nothing, so a sheet on an STB would have lost its shadow too.
          backgroundColor: blurring ? 'transparent' : fill,
        },
        shadowStyle,
        focused && focusGlowShadow,
        style,
      ]}
    >
      <View
        style={[
          StyleSheet.absoluteFill,
          // One step inside the border so the corners nest instead of leaving a
          // sliver of the frame showing through — the same trick `TILE_FRAME`
          // uses with its `padding: 1`.
          { borderRadius: Math.max(0, radius - 1), overflow: 'hidden' },
        ]}
        pointerEvents="none"
      >
        {blurring ? (
          <>
            <BlurView
              intensity={spec.intensity}
              tint={spec.tint}
              blurTarget={blurTarget ?? undefined}
              blurMethod={ANDROID_BLUR_METHOD}
              blurReductionFactor={ANDROID_BLUR_REDUCTION}
              style={StyleSheet.absoluteFill}
            />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: fill }]} />
          </>
        ) : null}

        {sheen ? (
          <LinearGradient
            colors={sheenColors(sheenOpacity)}
            // Stopping at 0.55 rather than at the bottom edge is what keeps
            // this reading as light catching a pane instead of as a gradient
            // fill. A sheen that reaches the lower edge looks like a button
            // from 1998.
            locations={[0, 0.55]}
            style={StyleSheet.absoluteFill}
          />
        ) : null}

        {/* The specular top edge. Apple's glass is not lit evenly: the top
            catches light and the rest falls away, and a single uniform border
            is the most reliable way to make hand-rolled glass look flat. */}
        {bordered ? <View style={[styles.topHighlight, focused && styles.topHighlightFocused]} /> : null}
      </View>

      {children}
    </View>
  );
});

/* ────────────────────────────────────────────────────────────────────────────
 * Convenience wrappers
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * A full-bleed glass bar — headers, tab bars, bottom action rows.
 *
 * Square ends and no side or top border, because a bar spans the screen and a
 * rounded corner mid-edge reads as a mistake. It keeps only the rule along the
 * edge that faces the content.
 */
export function GlassBar({
  edge = 'bottom',
  material = 'chrome',
  style,
  children,
  ...rest
}: GlassSurfaceProps & { edge?: 'top' | 'bottom' }) {
  return (
    <GlassSurface
      {...rest}
      material={material}
      radius={0}
      bordered={false}
      style={[
        edge === 'bottom' ? styles.barBottom : styles.barTop,
        style,
      ]}
    >
      {children}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth * 2,
    backgroundColor: glassEdgeHighlight,
    opacity: 0.55,
  },
  topHighlightFocused: {
    backgroundColor: glassEdgeHighlight,
    opacity: 0.9,
  },
  barBottom: {
    borderBottomWidth: StyleSheet.hairlineWidth * 2,
    borderBottomColor: 'rgba(255, 255, 255, 0.10)',
  },
  barTop: {
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderTopColor: 'rgba(255, 255, 255, 0.10)',
  },
});

export default GlassSurface;
