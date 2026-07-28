import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
} from "react-native";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// ============================================================================
// BASE SKELETON
// ============================================================================

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  borderRadius?: number;
  style?: any;
  variant?: "text" | "box";
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width = "100%",
  height = 20,
  borderRadius = 4,
  style,
  variant = "box",
}) => {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  const opacity = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  const commonStyle = [
    styles.skeleton,
    { width, height, borderRadius, opacity },
    style,
  ];

  // ================= TEXT SKELETON =================


  // ================= BOX / IMAGE SKELETON =================
  return <Animated.View style={commonStyle} />;
};

// ============================================================================
// CHANNEL ITEM SKELETON
// ============================================================================

// ============================================================================
// CHANNEL ITEM SKELETON
// ============================================================================

interface ChannelItemSkeletonProps {
  grid?: boolean;
  style?: any;
}

export const ChannelItemSkeleton: React.FC<ChannelItemSkeletonProps> = ({
  grid = false,
  style,
}) => {
  return (
    <View style={[grid ? styles.channelGridItem : styles.channelListItem, style]}>
      {/* Logo */}
      <Skeleton width={48} height={48} borderRadius={8} />

      {/* Text */}
      {!grid && (
        <View style={styles.channelInfo}>
          <Skeleton
            width="70%"
            height={16}
            variant="text"
            style={{ marginBottom: 8 }}
          />
          <Skeleton width="40%" height={12} variant="text" />
        </View>
      )}
    </View>
  );
};

// ============================================================================
// MOVIE / SERIES CARD SKELETON
// ============================================================================

interface CardSkeletonProps {
  style?: any;
}

export const CardSkeleton: React.FC<CardSkeletonProps> = ({ style }) => {
  return (
    <View style={[styles.card, style]}>
      {/* Poster */}
      <Skeleton width="100%" height={190} borderRadius={12} />

      {/* Text */}
      <View style={styles.cardContent}>
        <Skeleton
          width="80%"
          height={16}
          variant="text"
          style={{ marginBottom: 6 }}
        />
        <Skeleton width="50%" height={12} variant="text" />
      </View>
    </View>
  );
};

// ============================================================================
// SKELETON LIST (MAIN CONTROLLER)
// ============================================================================

interface SkeletonListProps {
  contentType: "channel" | "media";
  layoutMode?: "grid" | "list";
  count?: number;
  itemStyle?: any;
}

const ChannelGridItemSkeleton = (props: any) => <ChannelItemSkeleton grid {...props} />;
ChannelGridItemSkeleton.displayName = "ChannelGridItemSkeleton";

export const SkeletonList: React.FC<SkeletonListProps> = ({
  contentType,
  layoutMode = "list",
  count: propCount,
  itemStyle,
}) => {
  let count = propCount || 0;
  let Component: React.FC<any>;
  let containerStyle: any = styles.list;

  // ================= CHANNEL =================
  if (contentType === "channel") {
    if (layoutMode === "grid") {
      if (!count) count = 15; // 3 × 5
      containerStyle = styles.channelGrid;
      Component = ChannelGridItemSkeleton;
    } else {
      if (!count) count = 5;
      Component = ChannelItemSkeleton;
    }
  }

  // ================= MOVIES / SERIES =================
  if (contentType === "media") {
    if (!count) count = 12; // 2 × 6
    containerStyle = styles.mediaGrid;
    Component = CardSkeleton;
  }

  return (
    <View style={containerStyle}>
      {Array.from({ length: count }).map((_, index) => (
        <Component key={index} style={itemStyle} />
      ))}
    </View>
  );
};

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: "#111827",
  },

  hiddenText: {
    opacity: 0,
    height: "100%",
  },

  // ================= CHANNEL LIST =================
  channelListItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#111827",
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },

  channelInfo: {
    flex: 1,
    marginLeft: 12,
  },

  // ================= CHANNEL GRID =================
  channelGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 12,
    justifyContent: "space-between",
  },

  channelGridItem: {
    width: "30%",
    height: 70,
    alignItems: "center",
    backgroundColor: "#111827",
    borderRadius: 12,
    paddingVertical: 16,
    marginBottom: 12,
  },

  // ================= MEDIA GRID =================
  mediaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 12,
    justifyContent: "space-between",
  },

  card: {
    width: "48%",
    marginBottom: 16,
  },

  cardContent: {
    marginTop: 8,
  },

  list: {
    padding: 16,
  },
});
