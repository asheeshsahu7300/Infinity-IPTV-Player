// ─────────────────────────────────────────────────────────────────────────────
// UpNextCard — what a set-top box shows between episodes.
//
// The card is the whole point of a queue: an episode ending is the moment the
// viewer is least willing to pick up a remote, so the next one starts on its
// own and the card exists to say so and to offer a way out.
//
// Two rules it follows because getting either wrong is worse than not having
// the card at all:
//
//   • the cancel action takes focus, not the play action. The default already
//     happens by itself; the button that needs to be reachable in a hurry is
//     the one that stops it.
//   • the countdown is visible and continuous, so it never fires unannounced.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from 'react-native';
import { Image } from "expo-image";
import { Focusable, FocusGroup } from "../tv";
import { THEME, ph, ps, pw } from "../theme/tokens";
import type { QueueItem } from "../services/playbackQueue";
import { Film, Play, X } from 'lucide-react-native';
import { Text } from './Text';
import { GlassSurface } from './GlassSurface';
import { RADIUS } from '../theme/materials';
import * as P from '../theme/palette';


export interface UpNextCardProps {
  visible: boolean;
  item: QueueItem | null;
  /** Seconds before it plays on its own. */
  seconds?: number;
  onPlayNow: () => void;
  onCancel: () => void;
}

export function UpNextCard({
  visible,
  item,
  seconds = 10,
  onPlayNow,
  onCancel,
}: UpNextCardProps) {
  const [remaining, setRemaining] = useState(seconds);

  // Read through refs so the one-second tick does not restart every time the
  // parent re-renders and hands down fresh callbacks.
  const onPlayNowRef = useRef(onPlayNow);
  onPlayNowRef.current = onPlayNow;

  useEffect(() => {
    if (!visible) {
      setRemaining(seconds);
      return;
    }

    setRemaining(seconds);

    // The countdown is kept outside state so the tick can decide whether to
    // fire without doing it from inside a setState updater.
    //
    // It used to call onPlayNow from within a setRemaining updater, and
    // React runs updater functions during the render phase — so starting the
    // next episode happened mid-render, which is the same
    // "Cannot update a component while rendering a different component"
    // warning PinPrompt had. Updaters must also be pure, and React may invoke
    // them twice, which could have advanced two episodes at once.
    let left = seconds;
    const timer = setInterval(() => {
      left -= 1;
      setRemaining(left > 0 ? left : 0);
      if (left <= 0) {
        clearInterval(timer);
        onPlayNowRef.current();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [visible, seconds]);

  if (!visible || !item) return null;

  const progress = seconds > 0 ? 1 - remaining / seconds : 1;

  return (
    <View style={S.host}>
      {/* `thick` over live video: the picture stays visible behind the card
          without ever competing with the title of what is coming next. */}
      <GlassSurface material="thick" radius={RADIUS.lg} shadow="popover" style={S.card}>
        <View style={S.thumb}>
          {item.poster ? (
            <Image
              source={{ uri: item.poster }}
              style={S.thumbImage}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : (
            <Film size={ps(2)} color={P.quaternaryLabel} />
          )}
        </View>

        <View style={S.body}>
          <Text style={S.eyebrow}>UP NEXT IN {remaining}s</Text>
          <Text style={S.title} numberOfLines={1}>
            {item.title}
          </Text>
          {item.subtitle ? (
            <Text style={S.subtitle} numberOfLines={1}>
              {item.subtitle}
            </Text>
          ) : null}

          <View style={S.track}>
            <View style={[S.fill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>

          <FocusGroup style={S.actions} trapDown trapUp trapLeft trapRight>
            {/* Cancel takes focus: playing already happens on its own, so the
                button worth having under the cursor is the one that stops it. */}
            <Focusable
              ringOnFocus={false}
              hasTVPreferredFocus={true}
              onPress={onCancel}
              style={S.actionWrapper}
              accessibilityLabel="Stay on this episode"
            >
              {(focused) => (
                <View style={[S.action, focused && S.actionFocused]}>
                  <X size={ps(1.2)} color={focused ? P.onTint : P.label} />
                  <Text style={[S.actionText, focused && S.actionTextFocused]}>CANCEL</Text>
                </View>
              )}
            </Focusable>

            <Focusable
              ringOnFocus={false}
              onPress={onPlayNow}
              style={S.actionWrapper}
              accessibilityLabel={`Play ${item.title} now`}
            >
              {(focused) => (
                <View style={[S.action, S.actionPrimary, focused && S.actionFocused]}>
                  <Play size={ps(1.2)} color={focused ? P.onTint : P.label} />
                  <Text style={[S.actionText, focused && S.actionTextFocused]}>PLAY NOW</Text>
                </View>
              )}
            </Focusable>
          </FocusGroup>
        </View>
      </GlassSurface>
    </View>
  );
}

const S = StyleSheet.create({
  host: {
    position: "absolute",
    right: pw(4),
    bottom: ph(6),
    zIndex: 90,
  },
  card: {
    flexDirection: "row",
    gap: pw(1.6),
    padding: pw(1.6),
    width: pw(42),
    // Radius, fill and edge belong to the `thick` material now.
  },
  thumb: {
    width: ps(6),
    height: ps(8),
    borderRadius: RADIUS.sm,
    borderCurve: "continuous",
    backgroundColor: P.quaternarySystemFill,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  thumbImage: { width: "100%", height: "100%" },

  body: { flex: 1, gap: ph(0.4) },
  // The countdown eyebrow. Uppercase with wide tracking is Apple's own
  // treatment for a caption that labels what follows rather than one that is
  // read as a sentence — and it is the one place on this card where the
  // tracking is deliberately loose rather than tight.
  eyebrow: {
    color: P.tertiaryLabel,
    fontSize: ps(0.8),
    fontFamily: THEME.fonts.medium,
    letterSpacing: 1.5,
  },
  title: { color: P.label, fontSize: ps(1.3), fontFamily: THEME.fonts.semibold, letterSpacing: -0.2 },
  subtitle: { color: P.secondaryLabel, fontSize: ps(0.9) },

  track: {
    height: 3,
    borderRadius: RADIUS.full,
    backgroundColor: P.quaternarySystemFill,
    overflow: "hidden",
    marginVertical: ph(0.8),
  },
  // The countdown bar carries the tint: it is the one element on this card
  // about elapsing time rather than about content, and the tint is what the
  // rest of the app uses to mean "this is the thing that is happening".
  fill: { height: "100%", backgroundColor: P.tint },

  actions: { flexDirection: "row", gap: pw(1) },
  actionWrapper: { borderRadius: RADIUS.sm },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(0.6),
    paddingHorizontal: pw(1.6),
    paddingVertical: ph(0.9),
    borderRadius: RADIUS.sm,
    borderCurve: "continuous",
    backgroundColor: P.quaternarySystemFill,
    borderWidth: 1,
    borderColor: "transparent",
  },
  actionPrimary: { backgroundColor: P.tertiarySystemFill },
  // Focus fills with the tint rather than with white. The label and glyph stay
  // white through both states, so focus is a change of ground rather than an
  // inversion — which is what let the icon colours above stop branching.
  actionFocused: { backgroundColor: P.tint, borderColor: P.tint },
  actionText: { color: P.label, fontSize: ps(0.9), fontFamily: THEME.fonts.semibold, letterSpacing: 0.8 },
  actionTextFocused: { color: P.onTint },
});

export default UpNextCard;
