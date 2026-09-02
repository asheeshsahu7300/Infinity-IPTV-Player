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
import { FlatList, StatusBar, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePortalStore, Category } from "../src/store/portalStore";
import { hiddenCategories } from "../src/services/hiddenCategories";
import type { MediaKind } from "../src/services/parentalControl";
import { CinematicBackground } from "../src/components/CinematicBackground";
import { THEME, ph, ps, pw } from "../src/theme/tokens";
import { Focusable, FocusGroup } from "../src/tv";

const KINDS: { key: MediaKind; label: string; icon: React.ComponentProps<typeof Ionicons>["name"] }[] = [
  { key: "live", label: "LIVE TV", icon: "tv-outline" },
  { key: "vod", label: "MOVIES", icon: "film-outline" },
  { key: "series", label: "SERIES", icon: "albums-outline" },
];

const ROW_HEIGHT = ph(8);

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
            <Ionicons
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
      <StatusBar hidden />

      <View style={S.header}>
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
      <FocusGroup style={S.tabs}>
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
                <Ionicons
                  name={k.icon}
                  size={ps(1.2)}
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
      <FocusGroup style={S.listHost}>
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
          contentContainerStyle={S.listContent}
          ListEmptyComponent={
            <View style={S.empty}>
              <Ionicons name="folder-open-outline" size={ps(3)} color="rgba(255,255,255,0.1)" />
              <Text style={S.emptyText}>
                Open this library once so its categories load, then come back.
              </Text>
            </View>
          }
        />
      </FocusGroup>

      {/* ─── Actions ─── */}
      <FocusGroup style={S.actions}>
        <Focusable
          ringOnFocus={false}
          onPress={() => hiddenCategories.showAll(kind)}
          disabled={hiddenCount === 0}
          style={S.actionWrapper}
          accessibilityLabel="Show every category in this library"
        >
          {(focused) => (
            <View style={[S.action, focused && S.actionFocused, hiddenCount === 0 && S.actionDisabled]}>
              <Ionicons name="eye-outline" size={ps(1.3)} color={focused ? "#000" : "#fff"} />
              <Text style={[S.actionText, focused && S.actionTextFocused]}>SHOW ALL</Text>
            </View>
          )}
        </Focusable>
      </FocusGroup>
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.colors.background },

  header: { paddingHorizontal: pw(4), paddingTop: ph(2) },
  headerTitle: { color: "#fff", fontSize: ps(2), fontWeight: "900" },
  headerSubtitle: { color: THEME.colors.textDim, fontSize: ps(1), marginTop: ph(0.4) },

  tabs: { flexDirection: "row", gap: pw(1), paddingHorizontal: pw(4), paddingVertical: ph(1.5) },
  tabWrapper: { borderRadius: ps(0.9) },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(0.6),
    paddingHorizontal: pw(2),
    paddingVertical: ph(1),
    borderRadius: ps(0.9),
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "transparent",
  },
  tabActive: { backgroundColor: "rgba(255,255,255,0.85)" },
  tabFocused: { backgroundColor: "#fff", borderColor: "#fff" },
  tabText: { color: "#fff", fontSize: ps(0.9), fontWeight: "900", letterSpacing: 1 },

  listHost: { flex: 1, paddingHorizontal: pw(3) },
  listContent: { paddingBottom: ph(3) },

  rowWrapper: { height: ROW_HEIGHT, justifyContent: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(1.4),
    paddingHorizontal: pw(2),
    paddingVertical: ph(1.2),
    borderRadius: ps(0.8),
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  rowFocused: { backgroundColor: "#fff", borderColor: "#fff" },
  rowName: { flex: 1, color: "#fff", fontSize: ps(1.1), fontWeight: "700" },
  rowNameHidden: { color: "rgba(255,255,255,0.35)" },
  onFocus: { color: "#000" },

  switchTrack: {
    width: ps(3),
    height: ps(1.6),
    borderRadius: ps(0.8),
    backgroundColor: "rgba(255,255,255,0.16)",
    padding: 2,
    justifyContent: "center",
  },
  switchTrackFocused: { backgroundColor: "rgba(0,0,0,0.16)" },
  switchTrackOn: { backgroundColor: "#4ade80" },
  switchKnob: { width: ps(1.2), height: ps(1.2), borderRadius: ps(0.6), backgroundColor: "#fff" },
  switchKnobFocused: { backgroundColor: "#0E0F14" },
  switchKnobOn: { alignSelf: "flex-end", backgroundColor: "#0E0F14" },

  empty: { alignItems: "center", justifyContent: "center", paddingVertical: ph(10), gap: ph(1.5) },
  emptyText: {
    color: "rgba(255,255,255,0.3)",
    fontSize: ps(1),
    textAlign: "center",
    maxWidth: pw(40),
  },

  actions: { flexDirection: "row", gap: pw(1.5), paddingHorizontal: pw(4), paddingVertical: ph(1.5) },
  actionWrapper: { borderRadius: ps(1) },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(0.7),
    paddingHorizontal: pw(2.5),
    paddingVertical: ph(1.2),
    borderRadius: ps(1),
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "transparent",
  },
  actionFocused: { backgroundColor: "#fff", borderColor: "#fff", transform: [{ scale: 1.04 }] },
  actionDisabled: { opacity: 0.45 },
  actionText: { color: "#fff", fontSize: ps(0.95), fontWeight: "900", letterSpacing: 1 },
  actionTextFocused: { color: "#000" },
});
