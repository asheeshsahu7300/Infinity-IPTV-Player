import React, { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Focusable, Overlay } from "../tv";
import { ph, psRaw as ps, pw } from "../theme/tokens";
import { isTV } from "../utils/tvUtils";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

export type DialogTone = "neutral" | "danger" | "success";

const TONES: Record<DialogTone, { accent: string; badge: string; fill: string; fillText: string }> = {
  neutral: { accent: "#FFFFFF", badge: "rgba(255,255,255,0.08)", fill: "#FFFFFF", fillText: "#000000" },
  danger: { accent: "#FF4D57", badge: "rgba(255,77,87,0.16)", fill: "#FF4D57", fillText: "#FFFFFF" },
  success: { accent: "#63E65C", badge: "rgba(99,230,92,0.16)", fill: "#63E65C", fillText: "#000000" },
};

const DEFAULT_ICON: Record<DialogTone, IconName> = {
  neutral: "help-circle-outline",
  danger: "alert-circle-outline",
  success: "checkmark-circle-outline",
};

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message?: string;
  icon?: IconName;
  tone?: DialogTone;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Single-button acknowledgement — the replacement for a one-button `Alert`. */
  acknowledgeOnly?: boolean;
  /** Spins the confirm button and locks both actions while an action runs. */
  busy?: boolean;
  onConfirm?: () => void;
  onCancel: () => void;
  /**
   * Remounts the dialog body when it changes, so chaining one dialog straight
   * into another (confirm → result) hands `hasTVPreferredFocus` to the new
   * button set. Defaults to the title, which is usually distinct enough.
   */
  dialogKey?: string;
}

interface ActionProps {
  label: string;
  variant: "confirm" | "cancel";
  tone: DialogTone;
  onPress: () => void;
  preferred?: boolean;
  busy?: boolean;
  disabled?: boolean;
}

function DialogAction({ label, variant, tone, onPress, preferred, busy, disabled }: ActionProps) {
  const t = TONES[tone];
  const isConfirm = variant === "confirm";
  const restColor = isConfirm && tone === "danger" ? t.accent : "#fff";
  const restBorder =
    isConfirm && tone === "danger" ? "rgba(255,69,58,0.45)" : isConfirm ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.12)";

  return (
    <Focusable
      ringOnFocus={false}
      hasTVPreferredFocus={preferred}
      disabled={disabled}
      onPress={onPress}
      accessibilityLabel={label}
      style={S.actionWrapper}
    >
      {(focused) => (
        <View
          style={[
            S.action,
            { borderColor: restBorder },
            focused && S.actionFocused,
            focused && (isConfirm
              ? { backgroundColor: t.fill, borderColor: t.fill }
              : { backgroundColor: "#fff", borderColor: "#fff" }),
            disabled && S.actionDisabled,
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={focused ? t.fillText : "#fff"} />
          ) : (
            <Text
              style={[S.actionText, { color: restColor }, focused && { color: isConfirm ? t.fillText : "#000" }]}
              numberOfLines={1}
            >
              {label}
            </Text>
          )}
        </View>
      )}
    </Focusable>
  );
}

/**
 * Confirmation dialog rendered inside the React tree instead of through
 * `Alert.alert`.
 *
 * The native alert is not usable here: on an Android TV release build the
 * leanback activity never surfaces it reliably, and when it does appear the
 * D-pad cannot reach its buttons — so a destructive action silently did nothing.
 * Building on `Overlay` puts the buttons inside the app's own focus engine,
 * which means `hasTVPreferredFocus`, the focus trap and remote Back all work.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  icon,
  tone = "neutral",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  acknowledgeOnly = false,
  busy = false,
  onConfirm,
  onCancel,
  dialogKey,
}: ConfirmDialogProps) {
  const t = TONES[tone];
  // Destructive dialogs open on Cancel so a stray OK press cannot wipe data.
  const preferCancel = !acknowledgeOnly && tone === "danger";

  return (
    <Overlay
      visible={visible}
      axis="horizontal"
      closeOnBack={!busy}
      onClose={busy ? undefined : onCancel}
      contentStyle={S.overlayContent}
    >
      <View key={dialogKey ?? title} style={S.card}>
        <View style={[S.badge, { backgroundColor: t.badge, borderColor: t.accent + "33" }]}>
          <Ionicons name={icon ?? DEFAULT_ICON[tone]} size={ps(3)} color={t.accent} />
        </View>

        <Text style={S.title}>{title}</Text>
        {message ? <Text style={S.message}>{message}</Text> : null}

        <View style={S.actions}>
          {!acknowledgeOnly && (
            <DialogAction
              label={cancelLabel}
              variant="cancel"
              tone={tone}
              onPress={onCancel}
              preferred={preferCancel}
              disabled={busy}
            />
          )}
          <DialogAction
            label={confirmLabel}
            variant="confirm"
            tone={tone}
            onPress={acknowledgeOnly ? onCancel : (onConfirm ?? onCancel)}
            preferred={!preferCancel}
            busy={busy}
            disabled={busy}
          />
        </View>
      </View>
    </Overlay>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface DialogRequest {
  /** Distinguishes chained dialogs so a follow-up's buttons take focus. */
  id?: string;
  title: string;
  message?: string;
  icon?: IconName;
  tone?: DialogTone;
  confirmLabel?: string;
  cancelLabel?: string;
  acknowledgeOnly?: boolean;
  /** Awaited; the confirm button spins until it settles. */
  onConfirm?: () => void | Promise<void>;
}

export interface DialogApi {
  /** Confirm/cancel dialog. */
  open: (request: DialogRequest) => void;
  /** One-button message — the drop-in replacement for `Alert.alert(title, msg)`. */
  notify: (title: string, message?: string, tone?: DialogTone) => void;
  close: () => void;
  busy: boolean;
  /** Render last inside the screen root so it layers above the content. */
  node: React.ReactNode;
}

/**
 * Owns the dialog state for a screen. `open`, `notify` and `close` are stable,
 * so they can be listed as dependencies without re-creating callbacks.
 */
export function useDialog(): DialogApi {
  const [request, setRequest] = useState<DialogRequest | null>(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  const open = useCallback((next: DialogRequest) => {
    setRequest(next);
    setVisible(true);
  }, []);

  const close = useCallback(() => setVisible(false), []);

  const notify = useCallback(
    (title: string, message?: string, tone: DialogTone = "neutral") =>
      open({
        id: `notify:${title}:${message ?? ""}`,
        title,
        message,
        tone,
        acknowledgeOnly: true,
        confirmLabel: "OK",
      }),
    [open]
  );

  const handleConfirm = useCallback(async () => {
    const action = request?.onConfirm;
    if (!action) {
      close();
      return;
    }
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }, [request, close]);

  // `request` is deliberately kept after closing so the overlay's fade-out
  // still has content to render instead of flashing an empty card.
  const node = request ? (
    <ConfirmDialog
      visible={visible}
      dialogKey={request.id ?? request.title}
      title={request.title}
      message={request.message}
      icon={request.icon}
      tone={request.tone}
      confirmLabel={request.confirmLabel}
      cancelLabel={request.cancelLabel}
      acknowledgeOnly={request.acknowledgeOnly}
      busy={busy}
      onConfirm={handleConfirm}
      onCancel={close}
    />
  ) : null;

  return { open, notify, close, busy, node };
}

const S = StyleSheet.create({
  overlayContent: {
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    width: isTV ? pw(44) : pw(86),
    maxWidth: pw(92),
    alignItems: "center",
    paddingVertical: ps(3.5),
    paddingHorizontal: ps(3.5),
    borderRadius: ps(2.5),
    backgroundColor: "rgba(18, 20, 26, 0.95)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  badge: {
    width: ps(6),
    height: ps(6),
    borderRadius: ps(3),
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: ph(2),
  },
  title: {
    fontSize: isTV ? ps(2.1) : ps(1.9),
    fontWeight: "700",
    color: "#fff",
    textAlign: "center",
    letterSpacing: 0.3,
  },
  message: {
    fontSize: isTV ? ps(1.3) : ps(1.15),
    lineHeight: isTV ? ps(1.9) : ps(1.7),
    color: "rgba(255,255,255,0.6)",
    textAlign: "center",
    marginTop: ph(1.2),
  },
  actions: {
    flexDirection: "row",
    alignSelf: "stretch",
    justifyContent: "center",
    gap: pw(1.5),
    marginTop: ph(3),
  },
  actionWrapper: {
    flex: 1,
    maxWidth: pw(22),
    borderRadius: ps(1.2),
  },
  action: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: ph(1.6),
    paddingHorizontal: pw(2),
    borderRadius: ps(1.2),
    borderWidth: 1.5,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  actionFocused: {
    transform: [{ scale: 1.04 }],
  },
  actionDisabled: {
    opacity: 0.45,
  },
  actionText: {
    fontSize: isTV ? ps(1.3) : ps(1.2),
    fontWeight: "700",
    letterSpacing: 0.5,
  },
});

export default ConfirmDialog;
