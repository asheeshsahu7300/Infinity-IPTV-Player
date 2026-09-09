// ─────────────────────────────────────────────────────────────────────────────
// Categories — choose which ones appear in the sidebars.
//
// A portal with four hundred categories is normal, and most households use a
// dozen. This is the screen that makes the other three hundred and eighty go
// away.
//
// Hidden is not locked: everything here is reversible without a PIN, and the
// count at the top always says how many are hidden so a category cannot go
// missing without explanation. Anything genuinely restrictive belongs in
// Parental Control instead — see src/services/hiddenCategories.ts.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, StatusBar, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePortalStore, Category } from "../src/store/portalStore";
import { hiddenCategories } from "../src/services/hiddenCategories";
import type { MediaKind } from "../src/services/parentalControl";
import { CinematicBackground } from "../src/components/CinematicBackground";
import { THEME, ph, psRaw as ps, pw, TILE_FRAME } from "../src/theme/tokens";
import { isTablet } from "../src/utils/tabletUtils";
import { Focusable, FocusGroup } from "../src/tv";
import { Eye, FolderOpen , LucideIcon} from 'lucide-react-native';
import { DynamicIcon } from '../src/components/DynamicIcon';
import { Text } from '../src/components/Text';


const KINDS: { key: MediaKind; label: string; icon: string }[] = [
  { key: "live", label: "LIVE TV", icon: "tv-outline" },
  { key: "vod", label: "MOVIES", icon: "film-outline" },
  { key: "series", label: "SERIES", icon: "albums-outline" },
];

const ROW_HEIGHT = ph(9.5);

const CategoryRow = React.memo(
  function CategoryRow({
    category,
    hidden,
    preferFocus,
    onToggle,
  }: {
    category: Category;
    hidden: boolean;
    preferFocus: boolean;
    onToggle: (category: Category) => void;
  }) {
    const handlePress = useCallback(() => onToggle(category), [onToggle, category]);

    return (
      <Focusable
        onPress={handlePress}
        hasTVPreferredFocus={preferFocus}
        ringOnFocus={false}
        style={S.rowWrapper}
        accessibilityRole="switch"
        selected={!hidden}
        accessibilityLabel={category.name}
        accessibilityHint={hidden ? "Hidden. Select to show" : "Shown. Select to hide"}
      >
        {(focused) => (
          <View style={[S.row, focused && S.rowFocused]}>
            <DynamicIcon
              name={hidden ? "eye-off-outline" : "eye-outline"}
              size={ps(1.5)}
              color={focused ? "#000" : hidden ? "rgba(255,255,255,0.3)" : "#fff"}
            />
            <Text
              style={[
                S.rowName,
                focused && S.onFocus,
                hidden && !focused && S.rowNameHidden,
              ]}
              numberOfLines={1}
            >
              {category.name}
            </Text>
            {/* The focused row is white, so the switch needs its own colours
                there: an off track at 16% white and a white knob were both
                invisible against it, and the row read as having no control at
                all. The "on" state stays green because green on white is
                still legible — only the off state and the knob have to flip. */}
            <View
              style={[
                S.switchTrack,
                focused && S.switchTrackFocused,
                !hidden && S.switchTrackOn,
              ]}
            >
              <View
                style={[
                  S.switchKnob,
                  focused && S.switchKnobFocused,
                  !hidden && S.switchKnobOn,
                ]}
              />
            </View>
          </View>
        )}
      </Focusable>
    );
  },
  (prev, next) =>
    prev.category.id === next.category.id &&
    prev.hidden === next.hidden &&
    prev.preferFocus === next.preferFocus
);

export default function CategoriesScreen() {
  const insets = useSafeAreaInsets();
  const storeCategories = usePortalStore((s) => s.categories);

  const [kind, setKind] = useState<MediaKind>("live");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    hiddenCategories.load().then(() => setVersion((v) => v + 1));
    return hiddenCategories.subscribe(() => setVersion((v) => v + 1));
  }, []);

  const categories = useMemo(
    () =>
      (storeCategories || []).filter(
        (c) => c.type === kind && String(c.id) !== "all" && !String(c.id).endsWith(":all")
      ),
    [storeCategories, kind]
  );

  const hiddenCount = useMemo(
    () => hiddenCategories.countFor(kind),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, version]
  );

  const handleToggle = useCallback(
    (category: Category) => {
      hiddenCategories.toggle(kind, String(category.id));
    },
    [kind]
  );

  const renderItem = useCallback(
    ({ item, index }: { item: Category; index: number }) => (
      <CategoryRow
        category={item}
        hidden={hiddenCategories.isHidden(kind, String(item.id))}
        preferFocus={index === 0}
        onToggle={handleToggle}
      />
    ),
    // version is read through the service rather than passed, so it has to be a
    // dependency or a toggled row keeps its old eye icon.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, handleToggle, version]
  );

  return (
    <View style={[S.container, { paddingTop: insets.top }]}>
      <CinematicBackground />

      <View style={[S.header, isTablet && { paddingHorizontal: 24, paddingTop: ph(3) }]}>
        <Text style={S.headerTitle}>Categories</Text>
        <Text style={S.headerSubtitle}>
          {categories.length === 0
            ? "No categories loaded for this library yet"
            : hiddenCount > 0
              ? `${hiddenCount} of ${categories.length} hidden from the sidebar`
              : `All ${categories.length} shown`}
        </Text>
      </View>

      {/* ─── Library switcher ─── */}
      <FocusGroup style={[S.tabs, isTablet && { paddingHorizontal: 24 }]}>
        {KINDS.map((k) => (
          <Focusable
            key={k.key}
            ringOnFocus={false}
            onPress={() => setKind(k.key)}
            style={S.tabWrapper}
            accessibilityLabel={k.label}
            selected={kind === k.key}
          >
            {(focused) => (
              <View style={[S.tab, kind === k.key && S.tabActive, focused && S.tabFocused]}>
                <DynamicIcon
                  name={k.icon}
                  size={ps(1.8)}
                  color={focused || kind === k.key ? "#000" : "#fff"}
                />
                <Text
                  style={[
                    S.tabText,
                    (focused || kind === k.key) && { color: "#000" },
                  ]}
                >
                  {k.label}
                </Text>
              </View>
            )}
          </Focusable>
        ))}
      </FocusGroup>

      {/* ─── The list ─── */}
      <FocusGroup style={[S.listHost, isTablet && { paddingHorizontal: 24 }]}>
        <FlatList
          key={kind}
          data={categories}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          getItemLayout={(_, index) => ({
            length: ROW_HEIGHT,
            offset: ROW_HEIGHT * index,
            index,
          })}
          initialNumToRender={14}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[S.listContent, isTablet && { paddingBottom: insets.bottom + 20 }]}
          ListEmptyComponent={
            <View style={S.empty}>
              <FolderOpen size={ps(3)} color="rgba(255,255,255,0.1)" />
              <Text style={S.emptyText}>
                Open this library once so its categories load, then come back.
              </Text>
            </View>
          }
        />
      </FocusGroup>

      {/* ─── Actions ─── */}
      <FocusGroup style={[S.actions, isTablet && { paddingHorizontal: 24, paddingBottom: insets.bottom + 20 }]}>
        <Focusable
          ringOnFocus={false}
          onPress={() => hiddenCategories.showAll(kind)}
          disabled={hiddenCount === 0}
          style={S.actionWrapper}
          accessibilityLabel="Show every category in this library"
        >
          {(focused) => (
            <View style={[S.action, focused && S.actionFocused, hiddenCount === 0 && S.actionDisabled]}>
              <Eye size={ps(1.3)} color={focused ? "#000" : "#fff"} />
              <Text style={[S.actionText, focused && S.actionTextFocused]}>SHOW ALL</Text>
            </View>
          )}
        </Focusable>
      </FocusGroup>
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000000" },

  header: {
    paddingHorizontal: pw(8),
    paddingTop: ph(5),
    paddingBottom: ph(1),
  },
  headerTitle: { color: "#fff", fontSize: ps(2.2), fontWeight: "900", letterSpacing: 0.5 },
  headerSubtitle: { color: THEME.colors.textDim, fontSize: ps(1.1), marginTop: ph(0.6) },

  tabs: { flexDirection: "row", gap: pw(1.5), paddingHorizontal: pw(8), paddingVertical: ph(2) },
  tabWrapper: { borderRadius: 18 },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(0.8),
    paddingHorizontal: pw(3),
    paddingVertical: ph(1.6),
    borderRadius: 18,
    backgroundColor: "#17181c",
    borderWidth: 0,
    borderColor: "transparent",
  },
  tabActive: { backgroundColor: "#F5F5F5" },
  tabFocused: { backgroundColor: "#F5F5F5", borderColor: "transparent", borderWidth: 0 },
  tabText: { color: "#fff", fontSize: ps(1.3), fontWeight: "900", letterSpacing: 1 },

  listHost: { flex: 1, paddingHorizontal: pw(8) },
  listContent: { paddingBottom: ph(4), paddingTop: ph(1) },

  rowWrapper: { height: ROW_HEIGHT, justifyContent: "center", paddingVertical: ph(0.5) },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(1.8),
    paddingHorizontal: pw(2.5),
    paddingVertical: ph(2.2),
    borderRadius: 18,
    borderWidth: 0,
    borderColor: "transparent",
    backgroundColor: "#17181c",
  },
  rowFocused: { backgroundColor: "#F5F5F5", borderColor: "transparent", borderWidth: 0 },
  rowName: { flex: 1, color: "#fff", fontSize: ps(1.5), fontWeight: "700" },
  rowNameHidden: { color: "rgba(255,255,255,0.35)" },
  onFocus: { color: "#000" },

  switchTrack: {
    width: ps(3.8),
    height: ps(2),
    borderRadius: ps(1),
    backgroundColor: "rgba(255,255,255,0.14)",
    padding: 2,
    justifyContent: "center",
  },
  switchTrackFocused: { backgroundColor: "rgba(0,0,0,0.15)" },
  switchTrackOn: { backgroundColor: "#4ade80" },
  switchKnob: { width: ps(1.6), height: ps(1.6), borderRadius: ps(0.8), backgroundColor: "rgba(255,255,255,0.6)" },
  switchKnobFocused: { backgroundColor: "#000" },
  switchKnobOn: { alignSelf: "flex-end", backgroundColor: "#0E0F14" },

  empty: { alignItems: "center", justifyContent: "center", paddingVertical: ph(10), gap: ph(1.5) },
  emptyText: {
    color: "rgba(255,255,255,0.3)",
    fontSize: ps(1),
    textAlign: "center",
    maxWidth: pw(40),
  },

  actions: { flexDirection: "row", gap: pw(1.5), paddingHorizontal: pw(8), paddingVertical: ph(2) },
  actionWrapper: { borderRadius: 18 },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(0.9),
    paddingHorizontal: pw(3),
    paddingVertical: ph(1.6),
    borderRadius: 18,
    backgroundColor: "#17181c",
    borderWidth: 0,
    borderColor: "transparent",
  },
  actionFocused: { backgroundColor: "#fff", borderColor: "transparent", borderWidth: 0 },
  actionDisabled: { opacity: 0.45 },
  actionText: { color: "#fff", fontSize: ps(1.3), fontWeight: "900", letterSpacing: 1 },
  actionTextFocused: { color: "#000" },
});
