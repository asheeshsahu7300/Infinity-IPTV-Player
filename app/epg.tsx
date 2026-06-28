import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Animated,
  ScrollView,
  FlatList,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { FlashList } from "@shopify/flash-list";
import { format, addHours, startOfHour } from "date-fns";

import { usePortalStore, Channel, EPGProgram } from "../src/store/portalStore";
import { portalApi } from "../src/services/portalApi";
import LoadingOverlay from "../src/components/LoadingOverlay";
import { CinematicBackground } from "../src/components/CinematicBackground";
import { THEME, pw, ph, ps , fw } from '../src/theme/tokens';
import { isTV } from "../src/utils/tvUtils";
import { Focusable, FocusGroup } from "../src/tv";

// ─── Constants ───────────────────────────────────────────────────────────────
const HOUR_WIDTH = pw(40); // 40vw per hour
// pw(12) collapses to ~48px on a phone (unreadable channel names) — give touch
// devices a usable minimum. ROW_HEIGHT likewise stays ≥ the 48dp touch target.
const CHANNEL_SIDEBAR_WIDTH = Math.max(pw(12), isTV ? 0 : 110);
const ROW_HEIGHT = Math.max(ph(10), isTV ? 0 : 64);
const HEADER_HEIGHT = ph(35);

const TIME_SLOTS = 24; // Show 24 hours starting from now

const FlashListAny = FlashList as any;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const safeFormat = (date: any, formatStr: string, fallback = "--:--") => {
  try {
    if (!date) return fallback;
    const d = new Date(date);
    if (isNaN(d.getTime())) return fallback;
    return format(d, formatStr);
  } catch {
    return fallback;
  }
};
const getTimeSlots = () => {
  const start = startOfHour(new Date());
  return Array.from({ length: TIME_SLOTS }).map((_, i) => addHours(start, i));
};

// ─── Components ───────────────────────────────────────────────────────────────

// ── Program Block — TV-compliant Focusable ────────────────────────────────────
const ProgramBlock = ({
  program,
  onFocusProgram,
  onPress,
  autoFocus = false,
}: any) => {
  const start = new Date(program.start);
  const end = new Date(program.end);
  const durationMin = (end.getTime() - start.getTime()) / (1000 * 60);
  const width = (durationMin / 60) * HOUR_WIDTH;

  return (
    <View style={{ width: width - pw(0.5), paddingVertical: ph(0.75), paddingHorizontal: pw(0.25), overflow: "visible" }}>
      <Focusable
        onFocus={onFocusProgram}
        onPress={onPress}
        hasTVPreferredFocus={autoFocus}
        ringOnFocus={false}
        style={{ overflow: "visible" }}
      >
        {(focused) => (
          <LinearGradient
            colors={focused ? [THEME.colors.primary, THEME.colors.secondary] : ["transparent", "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[
              S.programBorder,
              focused && {
                transform: [{ scale: 1.04 }],
                shadowColor: THEME.colors.primary,
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.6,
                shadowRadius: 10,
                elevation: 10,
              },
            ]}
          >
            <View style={[
              S.programBlock,
              program.isLive && S.programBlockLive,
            ]}>
              <View style={S.programContent}>
                <Text style={S.programTitle} numberOfLines={1}>{program.title}</Text>
                <Text style={S.programTime}>
                  {safeFormat(program.start, "HH:mm")} - {safeFormat(program.end, "HH:mm")}
                </Text>
              </View>
              {program.isLive && (
                <View style={S.liveBadge}>
                  <Text style={S.liveBadgeText}>LIVE</Text>
                </View>
              )}
            </View>
          </LinearGradient>
        )}
      </Focusable>
    </View>
  );
};

// ── Channel Row ───────────────────────────────────────────────────────────────
const ChannelRow = ({ item, onFocusProgram, onProgramPress, timeSlots, isFirst }: any) => {
  const startTime = timeSlots[0].getTime();

  return (
    <View style={S.channelRow}>
      {/* Channel Sidebar Info */}
      <View style={S.channelCell}>
        <View style={S.channelLogoWrapper}>
          {item.logo ? (
            <Image source={{ uri: item.logo }} style={S.channelLogo} contentFit="contain" />
          ) : (
            <Ionicons name="tv" size={ps(1.5)} color={THEME.colors.textDim} />
          )}
        </View>
        <Text style={S.channelLabel} numberOfLines={1}>{item.name}</Text>
      </View>

      {/* Programs List */}
      <View style={S.programsContainer}>
        {item.programs.length > 0 ? (
          item.programs.map((prog: any, idx: number) => {
            const start = new Date(prog.start).getTime();
            const offset = ((start - startTime) / (1000 * 60 * 60)) * HOUR_WIDTH;
            return (
              <View key={prog.id} style={{ position: "absolute", left: offset }}>
                <ProgramBlock
                  program={prog}
                  onFocusProgram={() => onFocusProgram(prog)}
                  onPress={() => onProgramPress(item, prog)}
                  autoFocus={isFirst && idx === 0}
                />
              </View>
            );
          })
        ) : (
          <View style={{ position: "absolute", left: 0 }}>
            <ProgramBlock
              program={{ title: "No EPG Data", description: "No EPG available", start: Date.now(), end: Date.now() + 86400000 }}
              onFocusProgram={() => onFocusProgram({ title: "No EPG Data", description: "This channel does not have any EPG information available." })}
              onPress={() => {}}
              autoFocus={isFirst}
            />
          </View>
        )}
      </View>
    </View>
  );
};

export default function EPGScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activePortal, channels } = usePortalStore();

  const [epgData, setEpgData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedProgram, setSelectedProgram] = useState<any>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const timeSlots = useMemo(() => getTimeSlots(), []);
  const scrollX = useRef(new Animated.Value(0)).current;

  const loadEPG = async () => {
    if (!activePortal) return;
    try {
      setIsLoading(true);
      const programs: EPGProgram[] = await portalApi.getEpg(activePortal);
      
      const epgMap = new Map<string, any[]>();
      const now = Date.now();

      programs.forEach(p => {
        const cid = String(p.channelId);
        if (!epgMap.has(cid)) epgMap.set(cid, []);
        
        const isLive = now >= p.start && now < p.end;
        epgMap.get(cid)!.push({ ...p, isLive });
      });

      const processed = channels.map(c => ({
        ...c,
        programs: epgMap.get(String(c.id)) || epgMap.get(String(c.epgId)) || []
      }));

      setEpgData(processed.slice(0, 100)); // Limit for performance
      if (processed.length > 0) {
        if (processed[0].programs.length > 0) {
          setSelectedProgram(processed[0].programs[0]);
        } else {
          setSelectedProgram({ title: "No EPG Data", description: "This channel does not have any EPG information available." });
        }
      }
    } catch (error) {
      console.error("EPG Load error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadEPG();
  }, [activePortal]);

  const handleProgramPress = (channel: any, program: any) => {
    router.push({
      pathname: "/player",
      params: { url: channel.streamUrl, title: channel.name, type: "live" }
    });
  };

  return (
    <View style={[S.container, { paddingTop: insets.top }]}>
      <CinematicBackground />

      {/* 1. Header: Hero Program Info */}
      <View style={S.heroSection}>
        <View style={S.heroContent}>
          <Text style={S.heroTitle} numberOfLines={1}>
            {selectedProgram?.title || "Select a program"}
          </Text>
          <View style={S.heroMeta}>
            <Text style={S.heroMetaText}>
              {safeFormat(selectedProgram?.start, "HH:mm")} - {safeFormat(selectedProgram?.end, "HH:mm")}
            </Text>
            <View style={S.badge}><Text style={S.badgeText}>4K HDR</Text></View>
            <Text style={S.heroMetaText}>Action, Sci-Fi</Text>
          </View>
          <Text style={S.heroDesc} numberOfLines={3}>
            {selectedProgram?.description || "Select a program below to see details and schedule information."}
          </Text>
          <FocusGroup>
            <View style={S.heroActions}>
              <Focusable
                ringOnFocus={false}
                onPress={() => selectedProgram?.streamUrl && handleProgramPress(selectedProgram, selectedProgram)}
                style={{ borderRadius: ps(0.5), overflow: "visible" }}
              >
                {(focused) => (
                  <LinearGradient
                    colors={focused ? [THEME.colors.primary, THEME.colors.secondary] : [THEME.colors.primary, THEME.colors.accent]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={[
                      S.heroBtnActive,
                      focused && { transform: [{ scale: 1.06 }], shadowColor: THEME.colors.primary, shadowOpacity: 0.7, shadowRadius: 12, elevation: 12 },
                    ]}
                  >
                    <Ionicons name="play" size={ps(1.4)} color="#fff" />
                    <Text style={S.heroBtnText}>WATCH NOW</Text>
                  </LinearGradient>
                )}
              </Focusable>
              <Focusable
                ringOnFocus={false}
                onPress={() => {}}
                style={{ borderRadius: ps(0.5), overflow: "visible" }}
              >
                {(focused) => (
                  <View style={[
                    S.heroBtn,
                    focused && { backgroundColor: "rgba(255,255,255,0.18)", transform: [{ scale: 1.06 }] },
                  ]}>
                    <Ionicons name="radio-button-on" size={ps(1.4)} color="#fff" />
                    <Text style={S.heroBtnText}>SCHEDULE</Text>
                  </View>
                )}
              </Focusable>
            </View>
          </FocusGroup>
        </View>

        {/* Video Preview / Poster area */}
        <View style={S.heroPreview}>
            <LinearGradient colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.8)"]} style={StyleSheet.absoluteFillObject} />
            <Ionicons name="play-circle" size={ps(4)} color="rgba(255,255,255,0.6)" />
        </View>
      </View>

      {/* 2. Timeline Grid */}
      <View style={S.gridContainer}>
        {/* Timeline Header */}
        <View style={S.timelineHeaderRow}>
            <View style={S.channelsLabelCell}>
                <Text style={S.channelsLabel}>CHANNELS</Text>
            </View>
            <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false}
                scrollEnabled={false} // Sync with main grid scroll
                contentOffset={{ x: 0, y: 0 }}
            >
                <View style={S.timeSlotsRow}>
                    {timeSlots.map((ts, i) => (
                        <View key={i} style={S.timeSlotCell}>
                            <Text style={S.timeSlotText}>{format(ts, "hh:mm a")}</Text>
                        </View>
                    ))}
                </View>
            </ScrollView>
        </View>

        {/* Main Grid: Channels & Programs */}
        <FlashListAny
            data={epgData}
            estimatedItemSize={ROW_HEIGHT}
            keyExtractor={(item: any) => item.id}
            renderItem={({ item, index }: any) => (
                <ChannelRow
                    item={item}
                    isFirst={index === 0}
                    timeSlots={timeSlots}
                    onFocusProgram={(prog: any) => {
                        setSelectedProgram(prog);
                    }}
                    onProgramPress={handleProgramPress}
                />
            )}
            ListEmptyComponent={isLoading ? <LoadingOverlay /> : null}
        />
        
        {/* Time Progress Indicator Line */}
        <View style={[S.currentTimeLine, { left: CHANNEL_SIDEBAR_WIDTH + pw(10) }]} />
      </View>

      {/* Bottom Shortcuts */}
      <View style={S.bottomBar}>
        <View style={S.statusItem}><View style={[S.dot, {backgroundColor: THEME.colors.primary}]} /><Text style={S.statusText}>LIVE NOW</Text></View>
        <View style={S.statusItem}><View style={[S.dot, {backgroundColor: '#7e8299'}]} /><Text style={S.statusText}>RECORDED</Text></View>
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },
  
  // Hero Section
  heroSection: {
    height: HEADER_HEIGHT,
    flexDirection: "row",
    padding: pw(5),
    paddingBottom: ph(2),
  },
  heroContent: {
    flex: 1.5,
    justifyContent: "center",
  },
  heroTitle: {
    color: "#fff",
    fontSize: ps(3.5),
    fontWeight: fw("800"),
    marginBottom: ph(1),
  },
  heroMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(1.2),
    marginBottom: ph(2),
  },
  heroMetaText: {
    color: THEME.colors.accent,
    fontSize: ps(1.2),
    fontWeight: fw("700"),
  },
  heroDesc: {
    color: THEME.colors.textMuted,
    fontSize: ps(1.4),
    lineHeight: ph(2.8),
    maxWidth: pw(50),
    marginBottom: ph(3),
  },
  heroActions: {
    flexDirection: "row",
    gap: pw(1),
  },
  heroBtnActive: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: THEME.colors.primary,
    paddingHorizontal: pw(2),
    paddingVertical: ph(1.2),
    borderRadius: ps(0.5),
    gap: pw(0.5),
  },
  heroBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: pw(2),
    paddingVertical: ph(1.2),
    borderRadius: ps(0.5),
    gap: pw(0.5),
  },
  heroBtnText: {
    color: "#fff",
    fontSize: ps(1),
    fontWeight: fw("800"),
    letterSpacing: 1,
  },
  heroPreview: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: ps(1.5),
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },

  // Grid
  gridContainer: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.02)",
    marginHorizontal: pw(2),
    borderRadius: ps(1.5),
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  timelineHeaderRow: {
    flexDirection: "row",
    height: ph(8),
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  channelsLabelCell: {
    width: CHANNEL_SIDEBAR_WIDTH,
    justifyContent: "center",
    alignItems: "center",
    borderRightWidth: 1,
    borderRightColor: "rgba(255,255,255,0.05)",
  },
  channelsLabel: {
    color: THEME.colors.textDim,
    fontSize: ps(1),
    fontWeight: fw("800"),
    letterSpacing: 1,
  },
  timeSlotsRow: {
    flexDirection: "row",
  },
  timeSlotCell: {
    width: HOUR_WIDTH,
    justifyContent: "center",
    paddingLeft: pw(1.5),
  },
  timeSlotText: {
    color: THEME.colors.textMuted,
    fontSize: ps(1.2),
    fontWeight: fw("600"),
  },

  // Channel & Program Rows
  channelRow: {
    flexDirection: "row",
    height: ROW_HEIGHT,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.03)",
  },
  channelCell: {
    width: CHANNEL_SIDEBAR_WIDTH,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.1)",
    borderRightWidth: 1,
    borderRightColor: "rgba(255,255,255,0.05)",
  },
  channelLogoWrapper: {
    width: ps(3),
    height: ps(3),
    borderRadius: ps(0.5),
    backgroundColor: "rgba(255,255,255,0.03)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: ph(0.5),
  },
  channelLogo: {
    width: "70%",
    height: "70%",
  },
  channelLabel: {
    color: THEME.colors.textMuted,
    fontSize: ps(0.8),
    fontWeight: fw("600"),
  },
  programsContainer: {
    flex: 1,
    overflow: "hidden",
  },
  programBorder: {
    padding: 1.5,
    borderRadius: ps(0.8),
    height: ROW_HEIGHT - ph(1.5),
  },
  programBlock: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: ps(0.8) - 1.5,
    padding: ps(0.8),
    justifyContent: "center",
  },
  programBlockLive: {
    backgroundColor: "rgba(255,25,138,0.05)",
    borderColor: "rgba(255,25,138,0.2)",
  },
  programContent: {
    flex: 1,
  },
  programTitle: {
    color: "#fff",
    fontSize: ps(1.3),
    fontWeight: fw("700"),
    marginBottom: 2,
  },
  programTime: {
    color: THEME.colors.textDim,
    fontSize: ps(1),
  },
  noEpgText: {
    color: THEME.colors.textDim,
    fontSize: ps(1.1),
    fontStyle: 'italic',
  },
  liveBadge: {
    position: "absolute",
    top: ps(0.8),
    right: ps(0.8),
    backgroundColor: THEME.colors.primary,
    paddingHorizontal: pw(0.6),
    paddingVertical: ph(0.2),
    borderRadius: 4,
  },
  liveBadgeText: {
    color: "#fff",
    fontSize: ps(0.7),
    fontWeight: fw("900"),
  },

  // Extras
  badge: {
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: pw(0.8),
    paddingVertical: ph(0.4),
    borderRadius: 4,
  },
  badgeText: {
    color: "#fff",
    fontSize: ps(0.8),
    fontWeight: fw("800"),
  },
  currentTimeLine: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: THEME.colors.primary,
    shadowColor: THEME.colors.primary,
    shadowRadius: 10,
    elevation: 10,
    zIndex: 100,
  },
  bottomBar: {
    flexDirection: "row",
    height: ph(6),
    alignItems: "center",
    paddingHorizontal: pw(4),
    gap: pw(3),
  },
  statusItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(0.5),
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    color: THEME.colors.textMuted,
    fontSize: ps(1),
    fontWeight: fw("700"),
    letterSpacing: 1,
  },
});