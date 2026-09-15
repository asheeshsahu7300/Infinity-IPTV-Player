import React, { useState } from "react";
import { View, StyleSheet, Animated } from 'react-native';
import { LinearGradient } from "expo-linear-gradient";
import { Focusable, Overlay } from "../tv";
import { THEME, pw, ph, ps } from "../theme/tokens";
import { launchExternalPlayer } from "../utils/externalPlayer";
import { Clock, Play, Star, Tv } from 'lucide-react-native';
import { Text } from './Text';
import { GlassSurface } from './GlassSurface';
import { RADIUS } from '../theme/materials';
import * as P from '../theme/palette';


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
        <Focusable
          ringOnFocus={false}
          hasTVPreferredFocus={autoFocus}
          accessibilityLabel={label}
          onPress={onPress}
          onFocus={onFocusIn}
          onBlur={onFocusOut}
          style={[
            S.btnInner,
            variant === "filled" && S.btnFilled,
            variant === "ghost" && S.btnGhost,
            focused && variant === "filled" && S.btnFilledFocused,
          ]}
        >
          <View style={S.btnContent}>
            {icon}
            <Text
              style={[
                S.btnText,
                variant === "filled" && S.btnTextFilled,
                variant === "ghost" && S.btnTextGhost,
              ]}
            >
              {label}
            </Text>
          </View>
        </Focusable>
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
    <Overlay visible={visible} onClose={onClose}>
      {/* `thick`, the sheet material — this is a presented sheet and the
          screen behind it should recede without disappearing. */}
      <GlassSurface material="thick" radius={RADIUS.sheet} shadow="sheet" style={S.sheet}>
        {/* Title */}
        <Text style={S.title} numberOfLines={2}>
          {title || "Play"}
        </Text>

        {/* Description */}
        {meta?.description ? (
          <Text style={S.description} numberOfLines={3}>
            {meta.description}
          </Text>
        ) : null}

        {/* Meta badges */}
        <View style={S.metaRow}>
          {meta?.rating ? (
            <View style={S.badge}>
              <Star size={ps(0.9)} color={P.systemYellow} />
              <Text style={S.badgeText}>{meta.rating}</Text>
            </View>
          ) : null}
          {meta?.duration ? (
            <View style={S.badge}>
              <Clock size={ps(0.9)} color={P.secondaryLabel} />
              <Text style={S.badgeText}>{formatDuration(meta.duration)}</Text>
            </View>
          ) : null}
        </View>

        {/* Divider */}
        <View style={S.divider} />

        {/* Action Buttons */}
        <ModalButton
          label="Play in App"
          // Dark, not white: this is the one filled button on the sheet, so the
          // glyph sits on the off-white tint alongside `btnTextFilled`.
          icon={<Play size={ps(1.1)} color={P.onTint} style={{ marginRight: pw(1) }} />}
          onPress={() => { onClose(); onPlay(); }}
          variant="filled"
          autoFocus
        />
        <ModalButton
          label="External Player"
          icon={<Tv size={ps(1.1)} color={P.secondaryLabel} style={{ marginRight: pw(1) }} />}
          onPress={handleExternalPlay}
          variant="outline"
        />
        <ModalButton
          label="Cancel"
          onPress={onClose}
          variant="ghost"
        />
      </GlassSurface>
    </Overlay>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  sheet: {
    width: pw(45),
    paddingHorizontal: pw(3),
    paddingTop: ph(2.5),
    paddingBottom: ph(3),
    // Radius, fill and edge belong to the `thick` material now.
  },
  title: {
    color: P.label,
    fontSize: ps(1.6),
    fontFamily: THEME.fonts.semibold,
    letterSpacing: -0.3,
    marginBottom: ph(1),
  },
  description: {
    color: P.secondaryLabel,
    fontSize: ps(1),
    lineHeight: ps(1.6),
    marginBottom: ph(1),
    fontFamily: THEME.fonts.regular,
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
    backgroundColor: P.tertiarySystemFill,
    paddingHorizontal: pw(1.5),
    paddingVertical: ph(0.5),
    borderRadius: RADIUS.full,
    gap: 5,
  },
  badgeText: {
    color: P.secondaryLabel,
    fontSize: ps(0.85),
    fontFamily: THEME.fonts.medium,
  },
  divider: {
    // A hairline that reads *through* the material, which is what Apple's
    // `separator` is for — the opaque one is only right between opaque rows.
    height: StyleSheet.hairlineWidth * 2,
    backgroundColor: P.separator,
    marginBottom: ph(1.5),
  },

  // ── Button sub-components ──────────────────────────
  btnOuter: {
    marginBottom: ph(1),
    borderRadius: RADIUS.card,
    overflow: "visible",
  },
  btnGradientBorder: {
    padding: 1.5,
    borderRadius: RADIUS.card,
  },
  btnInner: {
    paddingVertical: ph(1.3),
    paddingHorizontal: pw(2),
    borderRadius: RADIUS.card - 2,
    borderCurve: "continuous",
    backgroundColor: P.tertiarySystemFill,
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
    color: P.label,
    fontSize: ps(1.0),
    fontFamily: THEME.fonts.semibold,
    letterSpacing: 0,
  },
  /**
   * The filled variant's ink, and the reason this style exists separately.
   *
   * `btnFilled` fills with `THEME.colors.primary`, which is the off-white
   * tint — so `btnText`'s white would be white on white. This is the same
   * latent bug the file already shipped once, when the accent was `#F5F5F5`
   * and every variant shared one white label; it was briefly correct while the
   * accent was blue, and is wrong again now. The fix is the general rule
   * rather than a local one: ink on a tint fill is always `onTint`.
   */
  btnTextFilled: {
    color: P.onTint,
  },
  btnTextGhost: {
    color: P.tertiaryLabel,
    fontSize: ps(0.9),
  },
});
