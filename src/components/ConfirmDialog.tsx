import React, { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from 'react-native';


import { Focusable, Overlay } from "../tv";
import { THEME, ph, psRaw as ps, pw } from "../theme/tokens";
import * as P from "../theme/palette";
import { RADIUS } from "../theme/materials";

import { HelpCircle, AlertCircle, CheckCircle, LucideIcon } from "lucide-react-native";
import { Text } from './Text';
import { DynamicIcon } from "./DynamicIcon";
import { GlassSurface } from "./GlassSurface";


export type DialogTone = "neutral" | "danger" | "success";

/**
 * The card is achromatic on every tone. Only one thing is still coloured.
 *
 * This has now moved twice, so it is worth writing down where it landed and
 * why. First the tones were colourless; then red came back on the theory that
 * Apple spends it on the action's label; now the surface is white again,
 * because this app's accent is achromatic by decision and a red badge plus a
 * red slab was the loudest thing on screen for what is a two-button question.
 *
 * What survives is the one place red is unambiguously doing work: a focused
 * destructive button fills with white and takes `systemRedOnTint` for its ink.
 * That colour exists for precisely this — see the note beside it in the
 * palette — and it is the only red left in the component. Everything the eye
 * lands on first (badge ring, glyph, title, message, resting labels) is white
 * or grey, on all three tones.
 *
 * `success` is now identical to `neutral`. That is not an oversight: leaving
 * green behind while red went white would have been incoherent, and the tone
 * still earns its keep by picking the default icon.
 *
 * `accent` tints the badge glyph, `fill` is the button's filled state once it
 * takes focus, and `fillText` is what stays legible on top of it.
 *
 * Which button opens focused is the primary signal now that colour is not, and
 * it was always doing the heavier lifting — see `preferCancel` below.
 */
const TONES: Record<DialogTone, { accent: string; badge: string; fill: string; fillText: string }> = {
  neutral: { accent: P.label, badge: P.tintFill, fill: P.tint, fillText: P.onTint },
  danger: { accent: P.label, badge: P.tintFill, fill: P.tintStrong, fillText: P.systemRedOnTint },
  success: { accent: P.label, badge: P.tintFill, fill: P.tint, fillText: P.onTint },
};

const DEFAULT_ICON: Record<DialogTone, LucideIcon> = {
  neutral: HelpCircle,
  danger: AlertCircle,
  success: CheckCircle,
};

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message?: string;
  icon?: string | any;
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
  restoreFocusOnClose?: boolean;
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

  /**
   * At rest both labels are white: `accent` is `P.label` on every tone now, so
   * the resting card carries no colour at all.
   *
   * On focus the confirm button fills white and its label inverts — dark ink
   * on neutral and success, dark red on danger, which is the whole of what
   * distinguishes a destructive dialog once the badge has gone achromatic.
   * Cancel fills with a plain grey, because a focused Cancel is not a warning,
   * and keeps white ink.
   */
  const restColor = isConfirm ? t.accent : P.label;
  const focusFill = isConfirm ? t.fill : P.systemFill;
  const focusColor = isConfirm ? t.fillText : P.label;

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
            focused && S.actionFocused,
            focused && { backgroundColor: focusFill, borderColor: focusFill },
            disabled && S.actionDisabled,
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={focused ? focusColor : restColor} />
          ) : (
            <Text
              style={[S.actionText, { color: focused ? focusColor : restColor }]}
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
  restoreFocusOnClose = true,
}: ConfirmDialogProps) {
  const t = TONES[tone];
  // Destructive dialogs open on Cancel so a stray OK press cannot wipe data.
  const preferCancel = !acknowledgeOnly && tone === "danger";

  const iconToRender = icon ?? DEFAULT_ICON[tone];

  return (
    <Overlay
      visible={visible}
      axis="horizontal"
      closeOnBack={!busy}
      restoreFocusOnClose={restoreFocusOnClose}
      onClose={busy ? undefined : onCancel}
      contentStyle={S.overlayContent}
    >
      <GlassSurface
        key={dialogKey ?? title}
        material="thick"
        radius={RADIUS.sheet}
        shadow="sheet"
        style={S.card}
      >
        <View style={[S.badge, { backgroundColor: t.badge, borderColor: t.accent }]}>
          <DynamicIcon name={iconToRender} size={ps(3)} color={t.accent} />
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
      </GlassSurface>
    </Overlay>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface DialogRequest {
  /** Distinguishes chained dialogs so a follow-up's buttons take focus. */
  id?: string;
  title: string;
  message?: string;
  icon?: string | any;
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
  close: (restoreFocus?: boolean) => void;
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
  const [restoreFocus, setRestoreFocus] = useState(true);

  const open = useCallback((next: DialogRequest) => {
    setRestoreFocus(true);
    setRequest(next);
    setVisible(true);
  }, []);

  const close = useCallback((shouldRestoreFocus = true) => {
    setRestoreFocus(shouldRestoreFocus);
    setVisible(false);
  }, []);

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

  const isMountedRef = React.useRef(true);
  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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
      if (isMountedRef.current) {
        setBusy(false);
      }
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
      restoreFocusOnClose={restoreFocus}
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
    width: pw(44),
    alignItems: "center",
    paddingVertical: ps(3.5),
    paddingHorizontal: ps(3.5),
    // Radius, border and fill all belong to the `thick` material now.
    //
    // The old fill was `rgba(10,11,16,0.99)` with a note explaining that at
    // 0.95 the portal card behind showed through its own text. `thick` fills at
    // 0.93 without a blur, which sounds like a regression and is not: the
    // overlay's own backdrop is `rgba(0,0,0,0.85)`, so anything behind is
    // already down to 15% before this surface is composited over it. The two
    // together land past 0.99 effective — the same solidity, arrived at by
    // stacking rather than by one opaque slab, which is what lets a real blur
    // show through on the platforms that have one.
  },
  badge: {
    width: ps(6),
    height: ps(6),
    borderRadius: RADIUS.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: ph(2),
  },
  title: {
    fontSize: ps(2.1),
    fontFamily: THEME.fonts.regular,
    color: P.label,
    textAlign: "center",
    // Negative tracking at display sizes: Apple tightens as type grows, and at
    // ps(2.1) the previous +0.3 read noticeably loose against the message.
    letterSpacing: -0.4,
  },
  message: {
    fontSize: ps(1.3),
    fontFamily: THEME.fonts.regular,
    lineHeight: ps(1.9),
    color: P.secondaryLabel,
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
    borderRadius: RADIUS.sm,
  },
  action: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: ph(1.6),
    paddingHorizontal: pw(2),
    borderRadius: RADIUS.sm,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: P.glassEdge,
    backgroundColor: P.quaternarySystemFill,
  },
  actionFocused: {
    transform: [{ scale: 1.04 }],
  },
  actionDisabled: {
    opacity: 0.45,
  },
  actionText: {
    fontSize: ps(1.3),
    fontFamily: THEME.fonts.semibold,
    // Apple sets button labels at their natural tracking. The +0.5 here was
    // doing the job a bold weight would have done, and this app cannot use one
    // — see the note on THEME.fonts.
    letterSpacing: 0,
  },
});

export default ConfirmDialog;
