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
import { ScrollView, StyleSheet, View } from 'react-native';
import { Image } from "expo-image";
import { Focusable, FocusGroup, Overlay } from "../tv";
import { THEME, ph, ps, pw } from "../theme/tokens";
import { epgService } from "../services/epgService";
import { parentalControl } from "../services/parentalControl";
import type { Channel } from "../store/portalStore";
import { Lock, Tv, Volume2, CornerDownLeft } from 'lucide-react-native';
import { Text } from './Text';


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
    onFocus,
    epgVersion,
  }: {
    channel: Channel;
    index: number;
    isCurrent: boolean;
    preferFocus: boolean;
    onSelect: (channel: Channel, index: number) => void;
    onFocus: (index: number) => void;
    epgVersion: number;
  }) {
    const nowNext = useMemo(
      () => epgService.nowNext(channel),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [channel?.id, epgVersion]
    );
    const locked = channel ? parentalControl.isChannelRestricted(channel) : false;

    const handlePress = useCallback(() => onSelect(channel, index), [onSelect, channel, index]);

    if (!channel) return null;

    const displayName = channel.name?.trim() || (channel.num != null ? `Channel ${channel.num}` : `Channel ${index + 1}`);
    const displayNum = channel.num != null ? channel.num : index + 1;

    return (
      <Focusable
        onPress={handlePress}
        onFocus={() => onFocus(index)}
        hasTVPreferredFocus={preferFocus}
        ringOnFocus={false}
        style={S.rowWrapper}
        accessibilityLabel={`Channel ${displayNum} ${displayName}`}
      >
        {(focused) => (
          <View style={[S.row, isCurrent && S.rowCurrent, focused && S.rowFocused]}>
            <Text style={[S.rowNumber, (focused || isCurrent) && S.rowTextFocused]}>
              {displayNum}
            </Text>

            <View style={S.rowLogo}>
              {locked ? (
                <Lock
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
                <Tv
                  size={ps(1.1)}
                  color={focused ? "rgba(0,0,0,0.4)" : "rgba(255,255,255,0.2)"}
                />
              )}
            </View>

            <View style={S.rowText}>
              <Text style={[S.rowName, (focused || isCurrent) && S.rowTextActive]} numberOfLines={1}>
                {displayName}
              </Text>
              {nowNext?.now?.title ? (
                <Text style={[S.rowNow, (focused || isCurrent) && S.rowNowActive]} numberOfLines={1}>
                  {nowNext.now.title}
                </Text>
              ) : null}
            </View>

            {isCurrent ? (
              <View style={S.playingDot}>
                <Volume2 size={ps(1)} color={(focused || isCurrent) ? "#111" : "#fff"} />
              </View>
            ) : null}
          </View>
        )}
      </Focusable>
    );
  },
  (prev, next) =>
    prev.channel?.id === next.channel?.id &&
    prev.channel?.name === next.channel?.name &&
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
  const scrollRef = useRef<ScrollView>(null);
  const [epgVersion, setEpgVersion] = useState(0);

  useEffect(() => {
    if (!visible) return;
    return epgService.subscribe(() => setEpgVersion((v) => v + 1));
  }, [visible]);

  const countRef = useRef(channels.length);
  countRef.current = channels.length;
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  const safeIndex = useMemo(() => {
    if (!channels || channels.length === 0) return -1;
    if (currentIndex >= 0 && currentIndex < channels.length) return currentIndex;
    return 0;
  }, [currentIndex, channels]);

  // Focus anchored at Slot 0 (Top of the sidebar / list, exactly like CategorySidebar)
  const scrollToIndex = useCallback((index: number, immediate = false) => {
    if (!scrollRef.current || index < 0 || index >= countRef.current) return;
    const targetOffset = index * ROW_HEIGHT;

    if (immediate) {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      try {
        scrollRef.current?.scrollTo({ y: targetOffset, animated: false });
      } catch { /* ignore */ }
    } else {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        try {
          scrollRef.current?.scrollTo({ y: targetOffset, animated: true });
        } catch { /* ignore */ }
      }, 16);
    }
  }, []);

  const handleItemFocus = useCallback(
    (index: number) => {
      scrollToIndex(index, false);
    },
    [scrollToIndex]
  );

  // Open onto the channel that is playing, anchored at Slot 0
  useEffect(() => {
    if (!visible || safeIndex < 0 || channels.length === 0) return;
    const timer = setTimeout(() => {
      scrollToIndex(safeIndex, true);
    }, 60);
    return () => clearTimeout(timer);
  }, [visible, safeIndex, channels.length, scrollToIndex]);

  if (!visible) return null;

  return (
    <Overlay
      visible={visible}
      axis="vertical"
      onClose={onClose}
      style={S.overlayBackdrop}
      contentStyle={S.overlayContent}
    >
      <View style={S.panel}>
        <View style={S.header}>
          <Text style={S.headerTitle} numberOfLines={1}>
            {categoryName || "Channels"}
          </Text>
          <Text style={S.headerCount}>{channels.length}</Text>
        </View>

        {channels.length === 0 ? (
          <View style={S.emptyContainer}>
            <Tv size={ps(2.5)} color="rgba(255,255,255,0.2)" />
            <Text style={S.emptyText}>No channels in this category</Text>
          </View>
        ) : (
          <FocusGroup trapLeft trapRight style={S.list}>
            <ScrollView
              ref={scrollRef}
              style={S.list}
              contentContainerStyle={[
                S.listContent,
                { paddingBottom: Math.max(0, ph(82) - ROW_HEIGHT) },
              ]}
              showsVerticalScrollIndicator={false}
            >
              {channels.map((channel, index) => (
                <ZapRow
                  key={channel?.id ? `zap-${channel.id}-${index}` : `zap-${index}`}
                  channel={channel}
                  index={index}
                  isCurrent={index === safeIndex}
                  preferFocus={index === safeIndex}
                  onSelect={onSelect}
                  onFocus={handleItemFocus}
                  epgVersion={epgVersion}
                />
              ))}
            </ScrollView>
          </FocusGroup>
        )}

        <View style={S.footer}>
          <CornerDownLeft size={ps(1)} color="rgba(255,255,255,0.4)" style={{ marginRight: ps(0.4) }} />
          <Text style={S.footerHint}>OK to tune · BACK to close</Text>
        </View>
      </View>
    </Overlay>
  );
}

const S = StyleSheet.create({
  overlayBackdrop: {
    backgroundColor: "transparent",
    alignItems: "stretch",
    justifyContent: "flex-start",
  },
  overlayContent: {
    ...StyleSheet.absoluteFillObject,
    maxWidth: "100%",
    maxHeight: "100%",
  },
  panel: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: pw(23),
    minWidth: 260,
    maxWidth: 340,
    backgroundColor: "rgba(8,9,13,0.96)",
    borderRightWidth: 0,
    borderRightColor: "transparent",
    zIndex: 90,
    elevation: 20,
    flexDirection: "column",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: pw(1.5),
    paddingVertical: ph(1.6),
    borderBottomWidth: 0,
  },
  headerTitle: {
    flex: 1,
    color: "#fff",
    fontSize: ps(1.15),
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  headerCount: { color: THEME.colors.textDim, fontSize: ps(0.95), fontWeight: "700" },
  list: { flex: 1 },
  listContent: {
    paddingVertical: ps(0.6),
    paddingBottom: ps(2.0),
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: ph(5),
    gap: ps(0.8),
  },
  emptyText: {
    color: "rgba(255,255,255,0.4)",
    fontSize: ps(1.05),
    fontWeight: "700",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: pw(1.5),
    paddingVertical: ph(1.2),
    borderTopWidth: 0,
  },
  footerHint: {
    color: "rgba(255,255,255,0.4)",
    fontSize: ps(0.8),
    fontWeight: "700",
  },

  rowWrapper: { height: ROW_HEIGHT, paddingHorizontal: pw(0.8), paddingVertical: ph(0.35), justifyContent: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(0.8),
    paddingHorizontal: pw(1.0),
    paddingVertical: ph(1.2),
    borderRadius: 16,
    borderWidth: 0,
    borderColor: "transparent",
    backgroundColor: "#17181c",
  },
  rowCurrent: {
    backgroundColor: "#F5F5F5",
    borderWidth: 0,
    borderColor: "transparent",
  },
  rowFocused: {
    backgroundColor: "#F5F5F5",
    borderWidth: 0,
    borderColor: "transparent",
    elevation: 8,
  },
  rowNumber: {
    minWidth: ps(2.2),
    color: "rgba(255,255,255,0.5)",
    fontSize: ps(1.05),
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  rowLogo: {
    width: ps(3.4),
    height: ps(2.6),
    alignItems: "center",
    justifyContent: "center",
  },
  rowLogoImage: { width: "100%", height: "100%" },
  rowText: { flex: 1 },
  rowName: { color: "#fff", fontSize: ps(1.2), fontWeight: "800", letterSpacing: 0.2 },
  rowNow: { color: "rgba(255,255,255,0.42)", fontSize: ps(0.85), fontWeight: "600" },
  rowNowActive: { color: "rgba(0,0,0,0.55)" },
  rowTextFocused: { color: "#000" },
  rowTextActive: { color: THEME.colors.selectedText, fontWeight: "900" },
  playingDot: { paddingLeft: pw(0.5) },
});

export default ChannelZapList;
