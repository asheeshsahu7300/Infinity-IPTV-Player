// ─────────────────────────────────────────────────────────────────────────────
// ChannelZapList — the channel list a set-top box slides over live video.
//
// The point is that the video keeps playing behind it. Leaving the player to
// pick a channel and coming back is a screen transition and a fresh connection;
// on a box it is a list on top of the picture and a single OK press.
//
// Rows carry the same three things the banner does — number, logo, what is on
// now — because that is what a viewer chooses between, and a bare list of
// channel names makes them tune in to find out.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";

import { Focusable } from "../tv";
import { THEME, ph, ps, pw } from "../theme/tokens";
import { epgService } from "../services/epgService";
import { parentalControl } from "../services/parentalControl";
import type { Channel } from "../store/portalStore";

export interface ChannelZapListProps {
  visible: boolean;
  channels: Channel[];
  /** Index of the channel currently tuned — highlighted and focused first. */
  currentIndex: number;
  categoryName?: string;
  onSelect: (channel: Channel, index: number) => void;
  onClose: () => void;
}

const ROW_HEIGHT = ph(9);

const ZapRow = React.memo(
  function ZapRow({
    channel,
    index,
    isCurrent,
    preferFocus,
    onSelect,
    epgVersion,
  }: {
    channel: Channel;
    index: number;
    isCurrent: boolean;
    preferFocus: boolean;
    onSelect: (channel: Channel, index: number) => void;
    epgVersion: number;
  }) {
    const nowNext = useMemo(
      () => epgService.nowNext(channel),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [channel.id, epgVersion]
    );
    const locked = parentalControl.isChannelRestricted(channel);

    const handlePress = useCallback(() => onSelect(channel, index), [onSelect, channel, index]);

    return (
      <Focusable
        onPress={handlePress}
        hasTVPreferredFocus={preferFocus}
        ringOnFocus={false}
        style={S.rowWrapper}
        accessibilityLabel={`Channel ${channel.num ?? ""} ${channel.name}`}
      >
        {(focused) => (
          <View style={[S.row, isCurrent && S.rowCurrent, focused && S.rowFocused]}>
            <Text style={[S.rowNumber, focused && S.rowTextFocused]}>{channel.num ?? "—"}</Text>

            <View style={S.rowLogo}>
              {locked ? (
                <Ionicons
                  name="lock-closed"
                  size={ps(1.1)}
                  color={focused ? "#000" : "rgba(255,255,255,0.5)"}
                />
              ) : channel.logo ? (
                <Image
                  source={{ uri: channel.logo }}
                  style={S.rowLogoImage}
                  contentFit="contain"
                  cachePolicy="memory-disk"
                />
              ) : (
                <Ionicons
                  name="tv-outline"
                  size={ps(1.1)}
                  color={focused ? "rgba(0,0,0,0.4)" : "rgba(255,255,255,0.2)"}
                />
              )}
            </View>

            <View style={S.rowText}>
              <Text style={[S.rowName, focused && S.rowTextFocused]} numberOfLines={1}>
                {channel.name}
              </Text>
              <Text
                style={[S.rowNow, focused && { color: "rgba(0,0,0,0.65)" }]}
                numberOfLines={1}
              >
                {nowNext.now ? nowNext.now.title : "No guide data"}
              </Text>
            </View>

            {isCurrent ? (
              <View style={S.playingDot}>
                <Ionicons name="volume-high" size={ps(1)} color={focused ? "#000" : "#fff"} />
              </View>
            ) : null}
          </View>
        )}
      </Focusable>
    );
  },
  (prev, next) =>
    prev.channel.id === next.channel.id &&
    prev.isCurrent === next.isCurrent &&
    prev.preferFocus === next.preferFocus &&
    prev.epgVersion === next.epgVersion
);

export function ChannelZapList({
  visible,
  channels,
  currentIndex,
  categoryName,
  onSelect,
  onClose,
}: ChannelZapListProps) {
  const listRef = useRef<FlatList<Channel>>(null);
  const [epgVersion, setEpgVersion] = useState(0);

  useEffect(() => {
    if (!visible) return;
    return epgService.subscribe(() => setEpgVersion((v) => v + 1));
  }, [visible]);

  // Open onto the channel that is playing, not onto row zero: the list exists
  // to move away from where you are, and it has to show where that is.
  useEffect(() => {
    if (!visible || currentIndex < 0) return;
    const timer = setTimeout(() => {
      try {
        listRef.current?.scrollToIndex({ index: currentIndex, animated: false, viewPosition: 0.4 });
      } catch {
        /* not measured yet — the preferred-focus pulse still lands */
      }
    }, 60);
    return () => clearTimeout(timer);
  }, [visible, currentIndex]);

  const renderItem = useCallback(
    ({ item, index }: { item: Channel; index: number }) => (
      <ZapRow
        channel={item}
        index={index}
        isCurrent={index === currentIndex}
        preferFocus={index === currentIndex}
        onSelect={onSelect}
        epgVersion={epgVersion}
      />
    ),
    [currentIndex, onSelect, epgVersion]
  );

  const getItemLayout = useCallback(
    (_: any, index: number) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index }),
    []
  );

  if (!visible) return null;

  return (
    <View style={S.panel}>
      <View style={S.header}>
        <Text style={S.headerTitle} numberOfLines={1}>
          {categoryName || "Channels"}
        </Text>
        <Text style={S.headerCount}>{channels.length}</Text>
      </View>

      {/* flex: 1 is load-bearing — see the matching note in QueueList.tsx. */}
      <FlatList
        style={S.list}
        ref={listRef}
        data={channels}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        initialScrollIndex={currentIndex > 0 ? currentIndex : undefined}
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={5}
        removeClippedSubviews={false}
        showsVerticalScrollIndicator={false}
        onScrollToIndexFailed={(info) => {
          setTimeout(() => {
            try {
              listRef.current?.scrollToIndex({ index: info.index, animated: false });
            } catch {
              /* list shrank in the meantime */
            }
          }, 80);
        }}
      />

      <View style={S.footer}>
        <Text style={S.footerHint}>OK to watch · BACK to close</Text>
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
    width: pw(34),
    backgroundColor: "rgba(8,9,13,0.94)",
    borderRightWidth: 1,
    borderRightColor: "rgba(255,255,255,0.1)",
    zIndex: 80,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: pw(2),
    paddingVertical: ph(1.6),
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.07)",
  },
  headerTitle: {
    flex: 1,
    color: "#fff",
    fontSize: ps(1.2),
    fontWeight: "900",
    letterSpacing: 1,
  },
  headerCount: { color: THEME.colors.textDim, fontSize: ps(1), fontWeight: "700" },
  list: { flex: 1 },

  rowWrapper: { height: ROW_HEIGHT, paddingHorizontal: pw(1), justifyContent: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(1),
    paddingHorizontal: pw(1),
    paddingVertical: ph(1),
    borderRadius: ps(0.8),
    borderWidth: 1,
    borderColor: "transparent",
  },
  rowCurrent: { backgroundColor: "rgba(255,255,255,0.09)" },
  rowFocused: { backgroundColor: "#fff", borderColor: "#fff" },
  rowNumber: {
    minWidth: ps(2.2),
    color: "rgba(255,255,255,0.45)",
    fontSize: ps(1),
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  rowLogo: {
    width: ps(2.8),
    height: ps(2),
    alignItems: "center",
    justifyContent: "center",
  },
  rowLogoImage: { width: "100%", height: "100%" },
  rowText: { flex: 1 },
  rowName: { color: "#fff", fontSize: ps(1.05), fontWeight: "700" },
  rowNow: { color: "rgba(255,255,255,0.42)", fontSize: ps(0.85), fontWeight: "600" },
  rowTextFocused: { color: "#000" },
  playingDot: { paddingLeft: pw(0.5) },

  footer: {
    paddingHorizontal: pw(2),
    paddingVertical: ph(1.2),
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.07)",
  },
  footerHint: {
    color: "rgba(255,255,255,0.3)",
    fontSize: ps(0.8),
    fontWeight: "700",
    letterSpacing: 0.5,
  },
});

export default ChannelZapList;
