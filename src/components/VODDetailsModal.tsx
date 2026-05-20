import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Platform,
  Linking,
  Animated,
  Easing,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as IntentLauncher from "expo-intent-launcher";
import { LinearGradient } from "expo-linear-gradient";
import { THEME, pw, ph, ps } from "../theme/tokens";
import { isTV } from "../utils/tvUtils";
import { launchExternalPlayer } from "../utils/externalPlayer";

interface VODDetailsModalProps {
  visible: boolean;
  onClose: () => void;
  onPlay: () => void;
  url: string | null;
  title?: string;
  meta?: {
    description?: string;
    rating?: string;
    duration?: string | number;
  } | null;
}

// ─── TV-compliant focusable button ──────────────────────────────────────────
function ModalButton({
  label,
  icon,
  onPress,
  variant = "outline",
  autoFocus = false,
}: {
  label: string;
  icon?: React.ReactNode;
  onPress: () => void;
  variant?: "filled" | "outline" | "ghost";
  autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const scaleAnim = React.useRef(new Animated.Value(1)).current;

  const onFocusIn = () => {
    setFocused(true);
    Animated.spring(scaleAnim, {
      toValue: 1.06,
      friction: 6,
      tension: 50,
      useNativeDriver: true,
    }).start();
  };

  const onFocusOut = () => {
    setFocused(false);
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 6,
      tension: 50,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View
      style={[
        S.btnOuter,
        { transform: [{ scale: scaleAnim }] },
        focused && {
          shadowColor: THEME.colors.primary,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.7,
          shadowRadius: 14,
          elevation: 14,
        },
      ]}
    >
      <LinearGradient
        colors={focused ? [THEME.colors.primary, THEME.colors.secondary] : ["transparent", "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={S.btnGradientBorder}
      >
        <TouchableOpacity
          style={[
            S.btnInner,
            variant === "filled" && S.btnFilled,
            variant === "ghost" && S.btnGhost,
            focused && variant === "filled" && S.btnFilledFocused,
          ]}
          onPress={onPress}
          onFocus={onFocusIn}
          onBlur={onFocusOut}
          // @ts-ignore
          hasTVPreferredFocus={autoFocus}
          focusable
          activeOpacity={0.85}
        >
          <View style={S.btnContent}>
            {icon}
            <Text style={[S.btnText, variant === "ghost" && S.btnTextGhost]}>{label}</Text>
          </View>
        </TouchableOpacity>
      </LinearGradient>
    </Animated.View>
  );
}

// ─── Main Modal ──────────────────────────────────────────────────────────────
export default function VODDetailsModal({
  visible,
  onClose,
  onPlay,
  url,
  title,
  meta,
}: VODDetailsModalProps) {
  const formatDuration = (d?: string | number) => {
    if (d == null || d === "") return "";
    const n = Number(d);
    if (isNaN(n)) return String(d);
    const mins = Math.floor(n / 60);
    const secs = Math.floor(n % 60);
    return mins > 0 ? `${mins}h ${secs}m` : `${secs}m`;
  };

  const handleExternalPlay = () => {
    onClose();
    if (!url) return;
    launchExternalPlayer({ url, title: title ?? undefined });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType={isTV ? "fade" : "slide"}
      onRequestClose={onClose}
    >
      <View style={S.backdrop}>
        {/* Dismiss tap area */}
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />

        {/* Sheet */}
        <View style={[S.sheet, isTV && S.sheetTV]}>
          {/* Handle — mobile only */}
          {!isTV && <View style={S.handle} />}

          {/* Title */}
          <Text style={[S.title, isTV && S.titleTV]} numberOfLines={2}>
            {title || "Play"}
          </Text>

          {/* Description */}
          {meta?.description ? (
            <Text style={[S.description, isTV && S.descriptionTV]} numberOfLines={isTV ? 3 : 4}>
              {meta.description}
            </Text>
          ) : null}

          {/* Meta badges */}
          <View style={S.metaRow}>
            {meta?.rating ? (
              <View style={S.badge}>
                <Ionicons name="star" size={ps(0.9)} color="#fbbf24" />
                <Text style={S.badgeText}>{meta.rating}</Text>
              </View>
            ) : null}
            {meta?.duration ? (
              <View style={S.badge}>
                <Ionicons name="time-outline" size={ps(0.9)} color="#93c5fd" />
                <Text style={S.badgeText}>{formatDuration(meta.duration)}</Text>
              </View>
            ) : null}
          </View>

          {/* Divider */}
          <View style={S.divider} />

          {/* Action Buttons */}
          <ModalButton
            label="Play in App"
            icon={<Ionicons name="play" size={ps(1.1)} color="#fff" style={{ marginRight: pw(1) }} />}
            onPress={() => { onClose(); onPlay(); }}
            variant="filled"
            autoFocus
          />
          <ModalButton
            label="External Player"
            icon={<Ionicons name="tv-outline" size={ps(1.1)} color="rgba(255,255,255,0.7)" style={{ marginRight: pw(1) }} />}
            onPress={handleExternalPlay}
            variant="outline"
          />
          <ModalButton
            label="Cancel"
            onPress={onClose}
            variant="ghost"
          />
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#09090f",
    paddingHorizontal: pw(4),
    paddingTop: ph(1.5),
    paddingBottom: ph(3),
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  // TV: center modal overlay instead of bottom sheet
  sheetTV: {
    alignSelf: "center",
    width: pw(45),
    borderRadius: 20,
    marginBottom: ph(10),
    paddingHorizontal: pw(3),
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#333",
    marginBottom: ph(1.5),
  },
  title: {
    color: "#fff",
    fontSize: ps(1.3),
    fontWeight: "800",
    marginBottom: ph(0.8),
    fontFamily: THEME.fonts.bold,
  },
  titleTV: {
    fontSize: ps(1.6),
    marginBottom: ph(1),
  },
  description: {
    color: "rgba(255,255,255,0.55)",
    fontSize: ps(0.9),
    lineHeight: ps(1.4),
    marginBottom: ph(1),
    fontFamily: THEME.fonts.regular,
  },
  descriptionTV: {
    fontSize: ps(1),
    lineHeight: ps(1.6),
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: ph(1.5),
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
    paddingHorizontal: pw(1.5),
    paddingVertical: ph(0.5),
    borderRadius: 999,
    gap: 5,
  },
  badgeText: {
    color: "#e5e7eb",
    fontSize: ps(0.85),
    fontFamily: THEME.fonts.medium,
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
    marginBottom: ph(1.5),
  },

  // ── Button sub-components ──────────────────────────
  btnOuter: {
    marginBottom: ph(1),
    borderRadius: 12,
    overflow: "visible",
  },
  btnGradientBorder: {
    padding: 1.5,
    borderRadius: 12,
  },
  btnInner: {
    paddingVertical: ph(1.3),
    paddingHorizontal: pw(2),
    borderRadius: 10,
    backgroundColor: "#111118",
    alignItems: "center",
    justifyContent: "center",
  },
  btnFilled: {
    backgroundColor: THEME.colors.primary,
  },
  btnFilledFocused: {
    backgroundColor: THEME.colors.primary,
  },
  btnGhost: {
    backgroundColor: "transparent",
    paddingVertical: ph(0.8),
  },
  btnContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: {
    color: "#fff",
    fontSize: ps(1.0),
    fontWeight: "700",
    fontFamily: THEME.fonts.bold,
    letterSpacing: 0.5,
  },
  btnTextGhost: {
    color: "rgba(255,255,255,0.4)",
    fontSize: ps(0.9),
    fontWeight: "500",
  },
});
