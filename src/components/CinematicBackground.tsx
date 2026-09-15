import React, { useEffect, useState } from 'react';
import { DeviceEventEmitter, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';

import { DURATION } from '../theme/materials';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReducedMotion } from '../tv/useReducedMotion';

// This file sits two levels down, so the project-root assets folder is `../../`
// from here — not the `../` that screens in app/ use.

/**
 * CinematicBackground — the ambient backdrop the whole app sits on.
 *
 * Whatever the viewer is looking at, blown up, blurred past recognition and
 * dimmed until it is atmosphere rather than an image. It is what gives the
 * glass above it something to be glass *over*: against a flat black ground a
 * translucent surface has nothing to reveal, and every material in this app
 * collapses to a grey rectangle.
 *
 * ── Why this is not a BlurView ──
 * This is the one full-screen blurred surface in the app, and it is also the
 * one that must work on an STB, where `materials.ts` disables live blur
 * entirely. The two are reconciled by blurring a *bitmap* rather than a
 * backdrop: `expo-image`'s `blurRadius` is applied once, when the image is
 * decoded, and the result is then an ordinary texture the compositor draws for
 * free. A `BlurView` would re-sample the framebuffer every frame to achieve a
 * worse-looking version of the same thing.
 *
 * That is also why the artwork is drawn at a fraction of its natural size and
 * scaled back up: a smaller decode is cheaper, and the upscale multiplies the
 * blur for nothing, so a modest `blurRadius` buys a much softer result than the
 * number suggests.
 *
 * ── Two ways in, and the default is neither ──
 * The `uri` prop, for a screen that knows its backdrop declaratively, and
 * `updateCinematicBackground()` behind `followsFocus`, for the grids, which
 * change it as focus moves across a list and have no sensible place to hold it
 * in state. The prop still wins over the channel where both are present.
 *
 * A bare `<CinematicBackground />` shows **no artwork at all**. That used to
 * mean "defer to the event channel", which was wrong in a way nothing on the
 * receiving screen could see: the emitter is global, `vod` and `series` fire
 * one per focus move right up until they unmount, and thirteen screens
 * rendered the component bare. So arriving at the dashboard — or settings, or
 * the guide — from a poster grid left that poster blurred behind it, and the
 * screen had no way to know it had happened.
 *
 * Opting in rather than opting out is what makes the quiet case the safe one:
 * a screen that says nothing gets nothing.
 */

/**
 * A remote URL, or the module id `require()` returns for a bundled asset —
 * expo-image accepts both forms directly.
 */
export type CinematicSource = string | number | null;

export interface CinematicBackgroundProps {
  /** Remote URL or a `require()`d local image. */
  uri?: CinematicSource;
  /**
   * How strongly the artwork reads. The default is deliberately low: this is a
   * backdrop, and the moment it becomes legible it competes with the content.
   */
  intensity?: number;
  /**
   * Darkens the left edge, for screens with a category sidebar over it. Off by
   * default because it is wrong on a full-bleed grid.
   */
  sidebarScrim?: boolean;
  /**
   * Subscribe to `updateCinematicBackground()`, so the backdrop tracks whatever
   * the viewer has focused. For the poster grids only — see the note above on
   * why this is opt-in.
   */
  followsFocus?: boolean;
}

export const CINEMATIC_EVENT = 'UPDATE_CINEMATIC_BACKGROUND';

/** Payload for the imperative channel. */
interface CinematicEventPayload {
  uri?: CinematicSource;
  blurRadius?: number;
}

/**
 * How hard the bitmap is blurred, before the upscale below multiplies it.
 *
 * Tuned together with `ARTWORK_SCALE`: at 2.2x upscale this lands somewhere
 * around an effective 130px radius, which is past the point where any feature
 * of the original image survives. That matters for more than looks — a
 * recognisable backdrop behind a grid of posters reads as a rendering bug.
 */
const BLUR_RADIUS = 60;

/**
 * Upscale applied to the artwork layer.
 *
 * Above 1 for two reasons. It multiplies the blur, as described above; and a
 * blurred bitmap has soft, sampled edges, so drawn at exactly screen size it
 * shows a pale border where the blur runs out. Overscanning past the bounds
 * pushes that artefact off-screen.
 */
const ARTWORK_SCALE = 2.2;

/**
 * How far the backdrop is pushed out past its parent, in dp.
 *
 * **An absolutely positioned child is laid out inside its parent's padding in
 * Yoga** — unlike CSS, where the containing block is the padding box. Every
 * screen roots itself as
 *
 *     <View style={[S.container, { paddingTop: insets.top }]}>
 *       <CinematicBackground />
 *
 * so `StyleSheet.absoluteFill` here begins *below* the status bar, and that
 * strip shows the container's own flat `backgroundColor` instead. It was
 * invisible while the backdrop was also flat black; against artwork, or against
 * a field that lifts off black, it is a hard line across the top of the screen.
 *
 * Bleeding outwards is the fix that does not require this component to know
 * what padding each screen used — and they differ: `search` and
 * `series-details` pad by `insets.top`, while `vod` and `series` pad by
 * `Math.max(insets.top, 24) + 8`, which on a handset in portrait is about
 * 67dp of black above the artwork.
 *
 * Deliberately generous rather than exact. Overshooting is free — the extra is
 * clipped by the screen and the backdrop is decorative, blurred and already
 * overscanned 2.2x — whereas undershooting by even a few dp puts the seam
 * straight back. The insets are added on top of it so a tall notch cannot
 * outrun the constant.
 */
const BLEED = 64;

export const CinematicBackground = React.memo(function CinematicBackground({
  uri,
  intensity = 0.32,
  sidebarScrim = false,
  followsFocus = false,
}: CinematicBackgroundProps = {}) {
  const [eventSource, setEventSource] = useState<CinematicSource>(null);
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();

  // Negative insets, so every layer below — ground, artwork, scrims and wash —
  // covers the padded strip too. With the parent's background never visible
  // there is nothing for a seam to form against, whatever the screen padded by.
  const bleed = {
    top: -(insets.top + BLEED),
    bottom: -(insets.bottom + BLEED),
    left: -(insets.left + BLEED),
    right: -(insets.right + BLEED),
  };

  useEffect(() => {
    if (!followsFocus) return;
    const sub = DeviceEventEmitter.addListener(
      CINEMATIC_EVENT,
      (payload: CinematicEventPayload) => {
        setEventSource(payload?.uri ?? null);
      }
    );
    return () => sub.remove();
  }, [followsFocus]);

  // The prop wins over the channel, and a screen that asked for neither gets
  // nothing — `eventSource` cannot be anything but null without followsFocus,
  // since the listener above is never attached.
  const source = uri !== undefined ? uri : eventSource;

  return (
    <View style={[StyleSheet.absoluteFill, bleed]} pointerEvents="none">
      {/* The ground. Painted unconditionally so there is never a frame of
          whatever the navigator was showing underneath. */}
      <View style={styles.ground} />

      {source ? (
        <Image
          // Keyed on the source so expo-image treats a change of artwork as a
          // new image to cross-fade to, rather than recycling the view and
          // swapping the texture in place — which reads as a hard cut.
          recyclingKey={typeof source === 'string' ? source : String(source)}
          source={typeof source === 'string' ? { uri: source } : source}
          style={styles.artwork}
          contentFit="cover"
          blurRadius={BLUR_RADIUS}
          // Slow on purpose: this is atmosphere, and a backdrop that snaps
          // draws the eye to exactly the layer that should never have it.
          transition={reducedMotion ? 0 : { duration: DURATION.ambient, effect: 'cross-dissolve' }}
          // The backdrop is decoration and must never be announced or focused.
          accessible={false}
          // Memory only. This artwork is already on disk via the grid that
          // showed it, and a second cached copy per backdrop is pure cost.
          cachePolicy="memory"
        />
      ) : null}

      {source ? (
        <>
          {/* Dim the artwork to atmosphere. A flat scrim rather than folding
              the value into the image's own opacity, so the artwork keeps its
              full tonal range and only the whole layer is turned down — fading
              the image instead washes it toward the ground and turns blacks
              grey. */}
          <View style={[styles.dim, { opacity: 1 - intensity }]} />

          {/* Vertical falloff. Content sits in the middle third of most
              screens, so the ends are where legibility has to be bought back.
              Drawn only over artwork — with nothing behind it, a black scrim
              on a black ground is two full-screen layers composited for no
              visible result, which on an STB is not free.

              Both ends go to *fully* opaque black, for the same reason the
              ambient field does: this layer is clipped by the screen's
              `paddingTop`, so its first row has to be the same colour as the
              container behind the status bar or the join shows as a line. The
              0.08 and 0.92 stops keep the falloff itself where it was — only
              the outermost pixels changed. */}
          <LinearGradient
            colors={[
              'rgba(0,0,0,1)',
              'rgba(0,0,0,0.82)',
              'rgba(0,0,0,0.25)',
              'rgba(0,0,0,0.92)',
              'rgba(0,0,0,1)',
            ]}
            locations={[0, 0.08, 0.45, 0.92, 1]}
            style={StyleSheet.absoluteFill}
          />
        </>
      ) : (
        /**
         * No artwork: the ground alone, and nothing else.
         *
         * This briefly carried an ambient gradient — a soft lift off black, on
         * the reasoning that translucent materials over a flat ground have
         * nothing to reveal and collapse to grey rectangles. That reasoning is
         * sound and the result was still not wanted: on a television app the
         * black has to be black, because the chrome sits beside letterboxed
         * video and any lift in the surround shows up as the picture's frame
         * not matching its own letterbox.
         *
         * So the glass earns its depth from its edge, sheen and specular
         * highlight rather than from the ground, and the one place a real
         * backdrop appears is behind artwork, above.
         */
        null
      )}

      {sidebarScrim ? (
        <LinearGradient
          colors={['rgba(0,0,0,0.92)', 'rgba(0,0,0,0)']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 0.45, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}


    </View>
  );
});

/**
 * Set the backdrop from anywhere, without threading a prop.
 *
 * For the grids, which change the backdrop as focus moves and would otherwise
 * need to hoist that into screen state and re-render the list to show it.
 * Screens that know their artwork should pass the `uri` prop instead — it is
 * ordinary React and it cannot be clobbered by another screen's events.
 *
 * `blurRadius` is accepted and ignored. The blur is a property of the effect
 * rather than of the picture, and letting individual call sites set it is how
 * the backdrop ends up differing screen to screen; the parameter is kept only
 * so existing callers do not have to change.
 */
export const updateCinematicBackground = (uri?: CinematicSource, _blurRadius?: number) => {
  DeviceEventEmitter.emit(CINEMATIC_EVENT, { uri: uri ?? null });
};

const styles = StyleSheet.create({
  ground: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000000',
  },
  artwork: {
    ...StyleSheet.absoluteFill,
    transform: [{ scale: ARTWORK_SCALE }],
  },
  dim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000000',
  },
});

export default CinematicBackground;
