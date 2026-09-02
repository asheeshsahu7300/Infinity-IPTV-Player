// ─────────────────────────────────────────────────────────────────────────────
// QueueList — the episode list, over the running video.
//
// Same job as ChannelZapList and the same chrome, because they are the same
// gesture: see what else there is without unloading what is playing. The rows
// differ because the choice differs — an episode is picked by number, title and
// how much of it you have already seen, not by what is on now.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";

import { Focusable, FocusGroup } from "../tv";
import { THEME, ph, ps, pw } from "../theme/tokens";
import { resumeIndex } from "../services/resumeIndex";
import type { QueueItem } from "../services/playbackQueue";

export interface QueueListProps {
  visible: boolean;
  items: QueueItem[];
  /** Index of the item playing — highlighted and focused first. */
  currentIndex: number;
  title?: string;
  onSelect: (item: QueueItem, index: number) => void;
  onClose: () => void;
}

const ROW_HEIGHT = ps(5.8);
/** Past this, an episode reads as watched rather than in progress. */
const WATCHED_THRESHOLD = 0.92;

const QueueRow = React.memo(
  function QueueRow({
    item,
    index,
    isCurrent,
    preferFocus,
    onSelect,
    resumeVersion,
  }: {
    item: QueueItem;
    index: number;
    isCurrent: boolean;
    preferFocus: boolean;
    onSelect: (item: QueueItem, index: number) => void;
    resumeVersion: number;
  }) {
    const progress = useMemo(
      () => (item?.id ? resumeIndex.progressFor(item.id) : 0),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [item?.id, resumeVersion]
    );
    const watched = progress >= WATCHED_THRESHOLD;

    const handlePress = useCallback(() => onSelect(item, index), [onSelect, item, index]);

    if (!item) return null;

    return (
      <Focusable
        onPress={handlePress}
        hasTVPreferredFocus={preferFocus}
        ringOnFocus={false}
        style={S.rowWrapper}
        accessibilityLabel={`${item.title || "Episode"}${watched ? ", watched" : ""}`}
      >
        {(focused) => (
          <View style={[S.row, isCurrent && S.rowCurrent, focused && S.rowFocused]}>
            <View style={S.numberCol}>
              <Text style={[S.number, focused && S.onFocus]}>
                {item.episodeNum ?? index + 1}
              </Text>
              {watched && !isCurrent ? (
                <Ionicons
                  name="checkmark-circle"
                  size={ps(1)}
                  color={focused ? "rgba(0,0,0,0.5)" : "#34c759"}
                />
              ) : null}
            </View>

            <View style={S.thumb}>
              {item.poster ? (
                <Image
                  source={{ uri: item.poster }}
                  style={S.thumbImage}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : (
                <Ionicons
                  name="film-outline"
                  size={ps(1.4)}
                  color={focused ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.3)"}
                />
              )}
            </View>

            <View style={S.text}>
              <Text
                style={[S.title, focused && S.onFocus, watched && !focused && S.dimmed]}
                numberOfLines={1}
              >
                {item.episodeName || (item.kind === "episode" ? `Episode ${item.episodeNum ?? index + 1}` : item.title)}
              </Text>
              {item.description || item.subtitle ? (
                <Text
                  style={[S.description, focused && { color: "rgba(0,0,0,0.6)" }]}
                  numberOfLines={1}
                >
                  {item.description || item.subtitle}
                </Text>
              ) : null}

              {/* Only drawn while partway through */}
              {progress > 0 && !watched ? (
                <View style={[S.track, focused && { backgroundColor: "rgba(0,0,0,0.18)" }]}>
                  <View
                    style={[
                      S.fill,
                      focused && { backgroundColor: "#000" },
                      { width: `${Math.round(progress * 100)}%` },
                    ]}
                  />
                </View>
              ) : null}
            </View>

            {isCurrent ? (
              <Ionicons name="play" size={ps(1.2)} color={focused ? "#000" : "#fff"} />
            ) : null}
          </View>
        )}
      </Focusable>
    );
  },
  (prev, next) =>
    prev.item?.id === next.item?.id &&
    prev.isCurrent === next.isCurrent &&
    prev.preferFocus === next.preferFocus &&
    prev.resumeVersion === next.resumeVersion
);

export function QueueList({
  visible,
  items,
  currentIndex,
  title,
  onSelect,
  onClose,
}: QueueListProps) {
  const scrollRef = useRef<ScrollView>(null);
  const [resumeVersion, setResumeVersion] = useState(0);

  useEffect(() => {
    if (!visible) return;
    resumeIndex.load();
    return resumeIndex.subscribe(() => setResumeVersion((v) => v + 1));
  }, [visible]);

  // Open onto what is playing
  useEffect(() => {
    if (!visible || currentIndex < 0 || items.length === 0) return;
    const timer = setTimeout(() => {
      try {
        scrollRef.current?.scrollTo({
          y: Math.max(0, currentIndex * ROW_HEIGHT - 60),
          animated: false,
        });
      } catch {
        /* not measured yet */
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [visible, currentIndex, items.length]);

  const renderItem = useCallback(
    ({ item, index }: { item: QueueItem; index: number }) => (
      <QueueRow
        key={item.id || `queue-${index}`}
        item={item}
        index={index}
        isCurrent={index === currentIndex}
        preferFocus={index === currentIndex}
        onSelect={onSelect}
        resumeVersion={resumeVersion}
      />
    ),
    [currentIndex, onSelect, resumeVersion]
  );

  if (!visible) return null;

  return (
    <View style={S.panel}>
      <View style={S.header}>
        <Text style={S.headerTitle} numberOfLines={2}>
          {title || "Up Next"}
        </Text>
        <View style={S.badge}>
          <Text style={S.headerCount}>{items.length}</Text>
        </View>
      </View>

      <FocusGroup autoFocus trapLeft trapRight style={S.list}>
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={S.listContent}
          showsVerticalScrollIndicator={true}
        >
          {items.map((item, index) => renderItem({ item, index }))}
        </ScrollView>
      </FocusGroup>

      <View style={S.footer}>
        <Ionicons name="return-down-back" size={ps(1)} color="rgba(255,255,255,0.4)" style={{ marginRight: ps(0.4) }} />
        <Text style={S.footerHint}>OK to play · BACK to close</Text>
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  panel: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: "28%",
    minWidth: 280,
    maxWidth: 380,
    backgroundColor: "rgba(10, 12, 18, 0.96)",
    zIndex: 90,
    elevation: 20,
    flexDirection: "column",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: ps(1.1),
    paddingVertical: ps(1.1),
  },
  headerTitle: {
    flex: 1,
    color: "#ffffff",
    fontSize: ps(1.2),
    fontWeight: "900",
    letterSpacing: 0.5,
    marginRight: ps(0.6),
  },
  badge: {
    paddingHorizontal: ps(0.6),
    paddingVertical: ps(0.22),
    borderRadius: ps(0.4),
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  headerCount: {
    color: THEME.colors.textDim,
    fontSize: ps(0.95),
    fontWeight: "700",
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingVertical: ps(0.8),
    paddingBottom: ps(2.0),
    flexGrow: 1,
  },

  rowWrapper: {
    height: ROW_HEIGHT,
    paddingHorizontal: ps(0.7),
    paddingVertical: ps(0.2),
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: ps(0.8),
    paddingHorizontal: ps(0.8),
    paddingVertical: ps(1.0),
    borderRadius: ps(0.65),
    backgroundColor: "rgba(255, 255, 255, 0.03)",
  },
  rowCurrent: {
    backgroundColor: "rgba(255, 255, 255, 0.12)",
  },
  rowFocused: {
    backgroundColor: "#ffffff",
  },

  numberCol: {
    minWidth: ps(1.8),
    alignItems: "center",
    justifyContent: "center",
  },
  number: {
    color: "rgba(255, 255, 255, 0.55)",
    fontSize: ps(1.1),
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },

  thumb: {
    width: ps(4.2),
    height: ps(2.6),
    borderRadius: ps(0.45),
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  thumbImage: {
    width: "100%",
    height: "100%",
  },

  text: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: "#ffffff",
    fontSize: ps(1.05),
    fontWeight: "700",
  },
  description: {
    color: "rgba(255, 255, 255, 0.5)",
    fontSize: ps(0.85),
  },
  onFocus: {
    color: "#000000",
  },
  dimmed: {
    opacity: 0.6,
  },

  track: {
    height: ps(0.25),
    borderRadius: ps(0.15),
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    marginTop: 4,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    backgroundColor: THEME.colors.primary,
  },

  footer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: ps(1.1),
    paddingVertical: ps(0.85),
    backgroundColor: "rgba(6, 8, 12, 0.98)",
    marginTop: "auto",
  },
  footerHint: {
    color: "rgba(255, 255, 255, 0.4)",
    fontSize: ps(0.85),
    fontWeight: "700",
    letterSpacing: 0.5,
  },
});

export default QueueList;
