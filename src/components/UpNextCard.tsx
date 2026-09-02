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
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";

import { Focusable, FocusGroup } from "../tv";
import { THEME, ph, ps, pw } from "../theme/tokens";
import type { QueueItem } from "../services/playbackQueue";

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
    const timer = setInterval(() => {
      setRemaining((left) => {
        if (left <= 1) {
          clearInterval(timer);
          onPlayNowRef.current();
          return 0;
        }
        return left - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [visible, seconds]);

  if (!visible || !item) return null;

  const progress = seconds > 0 ? 1 - remaining / seconds : 1;

  return (
    <View style={S.host}>
      <View style={S.card}>
        <View style={S.thumb}>
          {item.poster ? (
            <Image
              source={{ uri: item.poster }}
              style={S.thumbImage}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : (
            <Ionicons name="film-outline" size={ps(2)} color="rgba(255,255,255,0.2)" />
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

          <FocusGroup style={S.actions}>
            {/* Cancel takes focus: playing already happens on its own, so the
                button worth having under the cursor is the one that stops it. */}
            <Focusable
              ringOnFocus={false}
              hasTVPreferredFocus
              onPress={onCancel}
              style={S.actionWrapper}
              accessibilityLabel="Stay on this episode"
            >
              {(focused) => (
                <View style={[S.action, focused && S.actionFocused]}>
                  <Ionicons name="close" size={ps(1.2)} color={focused ? "#000" : "#fff"} />
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
                  <Ionicons name="play" size={ps(1.2)} color={focused ? "#000" : "#fff"} />
                  <Text style={[S.actionText, focused && S.actionTextFocused]}>PLAY NOW</Text>
                </View>
              )}
            </Focusable>
          </FocusGroup>
        </View>
      </View>
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
    borderRadius: ps(1.2),
    backgroundColor: "rgba(10,11,16,0.96)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  thumb: {
    width: ps(6),
    height: ps(8),
    borderRadius: ps(0.6),
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  thumbImage: { width: "100%", height: "100%" },

  body: { flex: 1, gap: ph(0.4) },
  eyebrow: {
    color: THEME.colors.textDim,
    fontSize: ps(0.8),
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  title: { color: "#fff", fontSize: ps(1.3), fontWeight: "800" },
  subtitle: { color: "rgba(255,255,255,0.45)", fontSize: ps(0.9), fontWeight: "600" },

  track: {
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.14)",
    overflow: "hidden",
    marginVertical: ph(0.8),
  },
  fill: { height: "100%", backgroundColor: "#fff" },

  actions: { flexDirection: "row", gap: pw(1) },
  actionWrapper: { borderRadius: ps(0.8) },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(0.6),
    paddingHorizontal: pw(1.6),
    paddingVertical: ph(0.9),
    borderRadius: ps(0.8),
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "transparent",
  },
  actionPrimary: { backgroundColor: "rgba(255,255,255,0.16)" },
  actionFocused: { backgroundColor: "#fff", borderColor: "#fff" },
  actionText: { color: "#fff", fontSize: ps(0.9), fontWeight: "900", letterSpacing: 1 },
  actionTextFocused: { color: "#000" },
});

export default UpNextCard;
