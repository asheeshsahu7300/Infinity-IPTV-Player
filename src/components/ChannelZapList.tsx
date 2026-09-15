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
import { Platform, ScrollView, StyleSheet, View, Pressable, useWindowDimensions } from 'react-native';
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Focusable, FocusGroup, Overlay } from "../tv";
import { THEME, ph, phoneDp, ps, pw } from "../theme/tokens";
import { isTouch } from "../utils/tabletUtils";
import { epgService } from "../services/epgService";
import { parentalControl } from "../services/parentalControl";
import type { Channel } from "../store/portalStore";
import { Lock, Tv, Volume2, CornerDownLeft } from 'lucide-react-native';
import { Text } from './Text';
import { GlassSurface } from './GlassSurface';
import { RADIUS } from '../theme/materials';
import * as P from "../theme/palette";


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
    rowHeight,
  }: {
    channel: Channel;
    index: number;
    isCurrent: boolean;
    preferFocus: boolean;
    onSelect: (channel: Channel, index: number) => void;
    onFocus: (index: number) => void;
    epgVersion: number;
    rowHeight?: number;
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
        style={[S.rowWrapper, rowHeight != null && { height: rowHeight }]}
        accessibilityLabel={`Channel ${displayNum} ${displayName}`}
      >
        {(focused) => (
          <View style={[
            S.row,
            isTouch && { paddingVertical: 6, paddingHorizontal: 10, gap: 8 },
            isCurrent && S.rowCurrent,
            focused && S.rowFocused
          ]}>
            <Text style={[
              S.rowNumber,
              isTouch && { fontSize: 11, minWidth: 20 },
              (focused || isCurrent) && S.rowTextFocused
            ]}>
              {displayNum}
            </Text>

            <View style={[S.rowLogo, isTouch && { width: 32, height: 24 }]}>
              {locked ? (
                <Lock
                  size={isTouch ? phoneDp(14) : ps(1.1)}
                  color={focused || isCurrent ? P.onTint : P.secondaryLabel}
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
                  size={isTouch ? phoneDp(14) : ps(1.1)}
                  color={focused || isCurrent ? P.onTintSecondary : P.quaternaryLabel}
                />
              )}
            </View>

            <View style={S.rowText}>
              <Text style={[S.rowName, isTouch && { fontSize: 13 }, (focused || isCurrent) && S.rowTextActive]} numberOfLines={1}>
                {displayName}
              </Text>
              {nowNext?.now?.title ? (
                <Text style={[S.rowNow, isTouch && { fontSize: 10.5 }, (focused || isCurrent) && S.rowNowActive]} numberOfLines={1}>
                  {nowNext.now.title}
                </Text>
              ) : null}
            </View>

            {isCurrent ? (
              <View style={S.playingDot}>
                {/* The row this sits in is filled with the tint whenever it is
                    current, so this glyph is always on an off-white ground. */}
                <Volume2 size={isTouch ? phoneDp(14) : ps(1)} color={P.onTint} />
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
    prev.rowHeight === next.rowHeight &&
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

  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // The same expression every other screen uses. This read `isTablet && ...`,
  // which is never true on a phone, so a handset took the landscape branch.
  const isPortrait = !Platform.isTV && windowHeight > windowWidth;
  const panelWidth = isTouch
    ? (isPortrait ? Math.min(320, windowWidth * 0.8) : Math.min(320, windowWidth * 0.35))
    : pw(23);
  const rowHeight = isTouch ? 54 : ROW_HEIGHT;

  if (!visible) return null;

  return (
    <Overlay
      visible={visible}
      axis="vertical"
      onClose={onClose}
      style={S.overlayBackdrop}
      contentStyle={S.overlayContent}
    >
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityLabel="Close channel list"
      />
      {/* `thick`, because this slides over live video: the picture should stay
          perceptible behind it without ever competing with the channel names. */}
      <GlassSurface
        material="thick"
        radius={0}
        bordered={false}
        style={[S.panel, isTouch && { width: panelWidth, minWidth: undefined, maxWidth: 360 }]}
      >
        <View style={[S.header, isTouch && { paddingTop: Math.max(16, insets.top + 8) }]}>
          <Text style={S.headerTitle} numberOfLines={1}>
            {categoryName || "Channels"}
          </Text>
          <Text style={S.headerCount}>{channels.length}</Text>
        </View>

        {channels.length === 0 ? (
          <View style={S.emptyContainer}>
            <Tv size={ps(2.5)} color={P.quaternaryLabel} />
            <Text style={S.emptyText}>No channels in this category</Text>
          </View>
        ) : (
          <FocusGroup trapLeft trapRight style={S.list}>
            <ScrollView
              ref={scrollRef}
              style={S.list}
              contentContainerStyle={[
                S.listContent,
                { paddingBottom: isTouch ? insets.bottom + 20 : Math.max(0, ph(82) - ROW_HEIGHT) },
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
                  rowHeight={rowHeight}
                />
              ))}
            </ScrollView>
          </FocusGroup>
        )}

        <View style={[S.footer, isTouch && { paddingBottom: Math.max(16, insets.bottom + 8) }]}>
          <CornerDownLeft size={ps(1)} color={P.tertiaryLabel} style={{ marginRight: ps(0.4) }} />
          <Text style={S.footerHint}>OK to tune · BACK to close</Text>
        </View>
      </GlassSurface>
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
    ...StyleSheet.absoluteFill,
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
    // Fill and edge belong to the `thick` material now.
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
    color: P.label,
    fontSize: ps(1.15),
    fontFamily: THEME.fonts.semibold,
    letterSpacing: -0.2,
  },
  headerCount: { color: P.tertiaryLabel, fontSize: ps(0.95), fontVariant: ["tabular-nums"] },
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
    color: P.tertiaryLabel,
    fontSize: ps(1.05),
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: pw(1.5),
    paddingVertical: ph(1.2),
    borderTopWidth: 0,
  },
  footerHint: {
    color: P.tertiaryLabel,
    fontSize: ps(0.8),
  },

  rowWrapper: { height: ROW_HEIGHT, paddingHorizontal: pw(0.8), paddingVertical: ph(0.35), justifyContent: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(0.8),
    paddingHorizontal: pw(1.0),
    paddingVertical: ph(1.2),
    borderRadius: RADIUS.lg,
    borderCurve: "continuous",
    borderWidth: 0,
    borderColor: "transparent",
    // A fill rather than a material — this is a dense list of rows, and glass
    // per row would stack forty sets of edges down the overlay.
    backgroundColor: P.tertiarySystemFill,
  },
  rowCurrent: {
    backgroundColor: P.tint,
    borderWidth: 0,
    borderColor: "transparent",
  },
  rowFocused: {
    backgroundColor: P.tint,
    borderWidth: 0,
    borderColor: "transparent",
    elevation: 8,
  },
  rowNumber: {
    minWidth: ps(2.2),
    color: P.secondaryLabel,
    fontSize: ps(1.05),
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
  rowName: { color: P.label, fontSize: ps(1.2), fontFamily: THEME.fonts.medium, letterSpacing: 0.1 },
  rowNow: { color: P.tertiaryLabel, fontSize: ps(0.85) },
  /**
   * The secondary line once the row is filled with the tint.
   *
   * Dark at reduced alpha, because the filled row is an off-white — the same
   * ink as the row's title above it, turned down, exactly as `rowNow` is a
   * turned-down `rowName` on a resting row. Both levels come from the palette
   * so the pair moves together.
   */
  rowNowActive: { color: P.onTintSecondary },
  rowTextFocused: { color: P.onTint },
  rowTextActive: { color: THEME.colors.selectedText },
  playingDot: { paddingLeft: pw(0.5) },
});

export default ChannelZapList;
