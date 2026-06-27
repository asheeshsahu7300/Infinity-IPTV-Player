import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Pressable,
  Platform,
  Dimensions,
  Animated,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  usePortalStore,
  Channel,
  VODItem,
  Series,
} from "../src/store/portalStore";
import { portalApi } from "../src/services/portalApi";
import { isTV } from "../src/utils/tvUtils";
import { THEME , fw } from '../src/theme/tokens';

type FavoriteType = "channels" | "vod" | "series";

interface FavoriteItem {
  id: string;
  name: string;
  logo?: string;
  type: FavoriteType;
  streamUrl?: string;
}

// 🔹 Separate component for list items to manage focus state
const FavoriteListItem = ({
  item,
  isFocused,
  isRemoveFocused,
  onFocus,
  onRemoveFocus,
  onPress,
  onRemove,
}: {
  item: FavoriteItem;
  isFocused: boolean;
  isRemoveFocused: boolean;
  onFocus: () => void;
  onRemoveFocus: () => void;
  onPress: () => void;
  onRemove: () => void;
}) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: isFocused ? 1.1 : 1,
      friction: 5,
      tension: 40,
      useNativeDriver: true,
    }).start();
  }, [isFocused]);

  // OK is delivered via Pressable.onPress when focused — no separate listener.

  return (
    <Animated.View style={{ transform: [{ scale: (isFocused && !isRemoveFocused) ? scaleAnim : 1 }], zIndex: isFocused ? 10 : 1 }}>
      <Pressable
        focusable
        onFocus={onFocus}
        style={({ pressed }) => [
          styles.item,
          isTV && {
            marginVertical: 8,
            paddingHorizontal: 20,
            paddingVertical: 16,
          },
          isFocused && styles.focusedItem,
          pressed && styles.pressedItem,
        ]}
        accessibilityLabel={`${item.name}`}
        accessibilityRole="button"
      >
        <View style={styles.itemIcon}>
          {item.logo ? (
            <Image
              source={{ uri: item.logo }}
              style={styles.itemImage}
              contentFit="cover"
            />
          ) : (
            <Ionicons
              name={
                item.type === "channels"
                  ? "tv"
                  : item.type === "vod"
                    ? "film"
                    : "albums"
              }
              size={isTV ? 32 : 24}
              color="#4a4a6a"
            />
          )}
        </View>
        <View style={styles.itemInfo}>
          <Text
            style={[styles.itemName, isTV && { fontSize: 17 }]}
            numberOfLines={1}
          >
            {item.name}
          </Text>
          <Text style={[styles.itemType, isTV && { fontSize: 14 }]}>
            {item.type === "channels"
              ? "Live TV"
              : item.type === "vod"
                ? "Movie"
                : "TV Series"}
          </Text>
        </View>
        <Pressable
          focusable
          onFocus={onRemoveFocus}
          style={[styles.removeBtn, isRemoveFocused && styles.focusedRemoveBtn]}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="heart" size={isTV ? 26 : 22} color="#ef4444" />
        </Pressable>
        <Ionicons
          name={item.type === "series" ? "chevron-forward" : "play-circle"}
          size={isTV ? 36 : 28}
          color={THEME.colors.primary}
        />
      </Pressable>
    </Animated.View>
  );
};

export default function FavoritesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    activePortal,
    favorites,
    channels,
    vodItems,
    series,
    toggleFavorite,
    loadFavorites,
  } = usePortalStore();

  const [selectedType, setSelectedType] = useState<FavoriteType>("channels");
  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);
  const { setChannels, setVodItems, setSeries } = usePortalStore();

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focusedIdRef = useRef<string | null>(null);

  useEffect(() => {
    focusedIdRef.current = focusedId;
  }, [focusedId]);



  useEffect(() => {
    if (!activePortal) {
      router.replace("/");
      return;
    }
    loadFavorites();
    loadDataIfNeeded();
  }, [activePortal]);

  useEffect(() => {
    updateFavoriteItems();
  }, [selectedType, favorites, channels, vodItems, series]);

  const loadDataIfNeeded = async () => {
    if (!activePortal) return;

    try {
      if (favorites.channels.length > 0 && channels.length === 0) {
        const loadedChannels = await portalApi.getLiveChannels(activePortal);
        setChannels(loadedChannels);
      }
      if (favorites.vod.length > 0 && vodItems.length === 0) {
        const loadedVod = await portalApi.getVodItems(activePortal);
        setVodItems(loadedVod);
      }
      if (favorites.series.length > 0 && series.length === 0) {
        const loadedSeries = await portalApi.getSeries(activePortal);
        setSeries(loadedSeries);
      }
    } catch (error) {
      console.error("Failed to load data for favorites:", error);
    }
  };

  const updateFavoriteItems = () => {
    let items: FavoriteItem[] = [];

    if (selectedType === "channels") {
      items = favorites.channels
        .map((id) => {
          const channel = channels.find((c) => c.id === id);
          if (channel) {
            return {
              id: channel.id,
              name: channel.name,
              logo: channel.logo,
              type: "channels" as FavoriteType,
              streamUrl: channel.streamUrl,
            };
          }
          return null;
        })
        .filter(Boolean) as FavoriteItem[];
    } else if (selectedType === "vod") {
      items = favorites.vod
        .map((id) => {
          const vod = vodItems.find((v) => v.id === id);
          if (vod) {
            return {
              id: vod.id,
              name: vod.name,
              logo: vod.logo,
              type: "vod" as FavoriteType,
              streamUrl: vod.streamUrl,
            };
          }
          return null;
        })
        .filter(Boolean) as FavoriteItem[];
    } else {
      items = favorites.series
        .map((id) => {
          const s = series.find((ser) => ser.id === id);
          if (s) {
            return {
              id: s.id,
              name: s.name,
              logo: s.logo,
              type: "series" as FavoriteType,
            };
          }
          return null;
        })
        .filter(Boolean) as FavoriteItem[];
    }

    setFavoriteItems(items);
  };

  const handleItemPress = useCallback(async (item: FavoriteItem) => {
    if (!activePortal) return;

    if (item.type === "series") {
      router.push({
        pathname: "/series-details",
        params: {
          id: item.id,
          name: item.name,
          logo: item.logo || "",
          description: "",
          year: "",
          rating: "",
        },
      });
    } else if (item.streamUrl) {
      try {
        const type = item.type === "channels" ? "itv" : "vod";
        const streamUrl = await portalApi.getStreamUrl(
          activePortal,
          item.streamUrl,
          type
        );
        router.push({
          pathname: "/player",
          params: {
            url: streamUrl,
            title: item.name,
            type,
          },
        });
      } catch (error) {
        Alert.alert("Error", "Failed to get stream URL");
      }
    }
  }, [activePortal, router]);

  const handleRemoveFavorite = useCallback(
    (item: FavoriteItem) => {
      toggleFavorite(item.type, item.id);
    },
    [toggleFavorite]
  );

  // Update ref for accessing items in event handler
  const favoriteItemsRef = useRef(favoriteItems);
  useEffect(() => {
    favoriteItemsRef.current = favoriteItems;
  }, [favoriteItems]);

  // Header & filter buttons handle OK via their own onPress — no global listener.

  // --------------------------------------------------
  // RENDER ITEM - Now uses separate component
  // --------------------------------------------------
  const renderItem = ({ item }: { item: FavoriteItem }) => (
    <FavoriteListItem
      item={item}
      isFocused={focusedId === `item-${item.type}-${item.id}`}
      isRemoveFocused={focusedId === `remove-${item.type}-${item.id}`}
      onFocus={() => setFocusedId(`item-${item.type}-${item.id}`)}
      onRemoveFocus={() => setFocusedId(`remove-${item.type}-${item.id}`)}
      onPress={() => handleItemPress(item)}
      onRemove={() => handleRemoveFavorite(item)}
    />
  );

  const totalCount =
    favorites.channels.length + favorites.vod.length + favorites.series.length;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          focusable
          onPress={() => router.back()}
          style={[styles.backButton, focusedId === 'back' && styles.focusedHeaderButton]}
          onFocus={() => setFocusedId('back')}
        >
          <Ionicons name="chevron-back" size={isTV ? 36 : 28} color="#fff" />
        </Pressable>
        <Text style={[styles.headerTitle, isTV && { fontSize: 24 }]}>
          Favorites
        </Text>
        <View style={styles.placeholder} />
      </View>

      <View style={[styles.typeSelector, isTV && { paddingHorizontal: 32 }]}>
        {(["channels", "vod", "series"] as FavoriteType[]).map(
          (type, index) => {
            const count = favorites[type].length;
            const isActive = selectedType === type;
            return (
              <Pressable
                key={type}
                focusable
                onPress={() => setSelectedType(type)}
                style={[
                  styles.typeButton,
                  isActive && styles.typeButtonActive,
                  focusedId === `type-${type}` && styles.focusedTypeButton,
                  isTV && { paddingVertical: 14, paddingHorizontal: 16 },
                ]}
                onFocus={() => setFocusedId(`type-${type}`)}
              >
                <Ionicons
                  name={
                    type === "channels"
                      ? "tv"
                      : type === "vod"
                        ? "film"
                        : "albums"
                  }
                  size={isTV ? 22 : 18}
                  color={isActive ? "#fff" : "#888"}
                />
                <Text
                  style={[
                    styles.typeButtonText,
                    isActive && styles.typeButtonTextActive,
                    isTV && { fontSize: 16 },
                  ]}
                >
                  {type === "channels"
                    ? "Live TV"
                    : type === "vod"
                      ? "Movies"
                      : "Series"}
                </Text>
                {count > 0 && (
                  <View
                    style={[
                      styles.countBadge,
                      isActive && styles.countBadgeActive,
                      isTV && { paddingHorizontal: 10, paddingVertical: 4 },
                    ]}
                  >
                    <Text style={[styles.countText, isTV && { fontSize: 14 }]}>
                      {count}
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          }
        )}
      </View>

      <FlashList
        data={favoriteItems}
        renderItem={renderItem}
        keyExtractor={(item) => `${item.type}-${item.id}`}
        contentContainerStyle={[styles.list, isTV && { paddingBottom: 60 }]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="heart-outline" size={isTV ? 80 : 64} color="#333" />
            <Text style={[styles.emptyText, isTV && { fontSize: 20 }]}>
              No favorites yet
            </Text>
            <Text
              style={[
                styles.emptySubtext,
                isTV && { fontSize: 16, paddingHorizontal: 60 },
              ]}
            >
              Tap the heart icon on any content to add it here
            </Text>
          </View>
        }
        // 🔑 Critical for TV focus
        keyboardShouldPersistTaps="handled"
        removeClippedSubviews={false}

      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#111827",
  },
  backButton: {
    padding: isTV ? 16 : 8,
    width: isTV ? 60 : 44,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: fw("600"),
    color: "#fff",
    textAlign: "center",
  },
  placeholder: {
    width: isTV ? 60 : 44,
  },
  typeSelector: {
    flexDirection: "row",
    padding: 16,
    gap: isTV ? 12 : 8,
  },
  typeButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: isTV ? 8 : 6,
    backgroundColor: "#111827",
    paddingVertical: 10,
    borderRadius: 12,
  },
  typeButtonActive: {
    backgroundColor: THEME.colors.primary,
  },
  typeButtonText: {
    color: "#888",
    fontSize: 12,
    fontWeight: fw("500"),
  },
  typeButtonTextActive: {
    color: "#fff",
  },
  countBadge: {
    backgroundColor: "#2a2a4a",
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  countBadgeActive: {
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  countText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: fw("600"),
  },
  list: {
    padding: 16,
    paddingBottom: 32,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#111827",
    borderRadius: 12,
    padding: 12,
    marginBottom: isTV ? 16 : 10,
  },
  focusedItem: {
    backgroundColor: "#1e3a5f",
    borderColor: "#fff",
    borderWidth: 2,
    shadowColor: THEME.colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 15,
    elevation: 20,
  },
  pressedItem: {
    transform: [{ scale: 1.06 }],
  },
  itemIcon: {
    width: isTV ? 60 : 50,
    height: isTV ? 60 : 50,
    borderRadius: 10,
    backgroundColor: "#0a0a1a",
    alignItems: "center",
    justifyContent: "center",
    marginRight: isTV ? 18 : 12,
    overflow: "hidden",
  },
  itemImage: {
    width: "100%",
    height: "100%",
    borderRadius: 8,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 15,
    fontWeight: fw("500"),
    color: "#fff",
    marginBottom: 4,
  },
  itemType: {
    fontSize: 12,
    color: "#888",
  },
  removeBtn: {
    padding: isTV ? 10 : 8,
    marginRight: isTV ? 6 : 4,
    borderRadius: 8,
    backgroundColor: "transparent",
  },
  focusedRemoveBtn: {
    backgroundColor: "rgba(239, 68, 68, 0.2)",
    transform: [{ scale: 1.1 }],
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
  },
  emptyText: {
    color: "#666",
    fontSize: 18,
    fontWeight: fw("600"),
    marginTop: 16,
  },
  emptySubtext: {
    color: "#555",
    fontSize: 14,
    marginTop: 8,
    textAlign: "center",
  },
  focusedHeaderButton: {
    backgroundColor: THEME.colors.primary + '66',
    borderColor: '#fff',
    borderWidth: 1,
    transform: [{ scale: 1.1 }],
  },
  focusedTypeButton: {
    borderColor: '#fff',
    borderWidth: 2,
    backgroundColor: THEME.colors.primary + '66',
    transform: [{ scale: 1.1 }],
    zIndex: 10,
    shadowColor: THEME.colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
  }
});