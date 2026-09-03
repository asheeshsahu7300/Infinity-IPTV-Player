// ─────────────────────────────────────────────────────────────────────────────
// PinPrompt — the parental-lock keypad.
//
// Driven entirely by focusable buttons rather than a TextInput: on a TV a text
// field means the system IME covering the screen, and a four-digit PIN is far
// quicker on a D-pad grid. The same overlay is used for entering a PIN and for
// changing one, because the second is just the first asked three times.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Focusable, FocusGroup, Overlay } from "../tv";
import { THEME, ph, ps, pw } from "../theme/tokens";

export interface PinPromptProps {
  visible: boolean;
  title?: string;
  message?: string;
  /**
   * Checked on the fourth digit. Return true to accept.
   *
   * Verification is the caller's because this component must never hold the
   * PIN or its hash — it only collects digits.
   */
  onSubmit: (pin: string) => boolean | Promise<boolean>;
  onCancel: () => void;
  /** Called after a correct entry, once the success state has been shown. */
  onSuccess?: () => void;
  confirmLabel?: string;
  /**
   * Clears the entry whenever this changes.
   *
   * Needed for multi-step flows. Changing a PIN asks three questions in a row
   * — current, new, confirm — and the prompt stays *visible* the whole time,
   * only its title and message change. Resetting on visibility alone therefore
   * left the previous step's four digits in place, so "New PIN" opened with a
   * full entry: the dots were already filled and no further digit registered.
   *
   * Callers with one question can leave it unset.
   */
  resetKey?: string | number;
}

const PIN_LENGTH = 4;
const KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export function PinPrompt({
  visible,
  title = "Enter PIN",
  message = "This channel is locked.",
  onSubmit,
  onCancel,
  onSuccess,
  resetKey,
}: PinPromptProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const mountedRef = useRef(true);
  /**
   * The authoritative digits, mirrored outside React state.
   *
   * Two reasons. Auto-submit needs the complete PIN in the same tick the last
   * digit is pressed, and reading it from `pin` would read the value from
   * before that press. And a remote can deliver two presses faster than a
   * re-render, which a closure over `pin` would drop.
   */
  const pinRef = useRef("");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Each opening — and each step within one opening — starts clean. A
  // half-typed PIN left over is both confusing and a way to leak how many
  // digits were tried.
  useEffect(() => {
    if (visible) {
      pinRef.current = "";
      setPin("");
      setError(null);
      setChecking(false);
    }
  }, [visible, resetKey]);

  const submit = useCallback(
    async (candidate: string) => {
      setChecking(true);
      let ok = false;
      try {
        ok = await onSubmit(candidate);
      } catch {
        ok = false;
      }
      if (!mountedRef.current) return;
      setChecking(false);

      if (ok) {
        onSuccess?.();
        return;
      }
      setError("Incorrect PIN");
      pinRef.current = "";
      setPin("");
    },
    [onSubmit, onSuccess]
  );

  const pushDigit = useCallback(
    (digit: number) => {
      if (checking) return;
      if (pinRef.current.length >= PIN_LENGTH) return;

      const next = `${pinRef.current}${digit}`;
      pinRef.current = next;
      setError(null);
      setPin(next);

      // Submitting on the last digit is what makes a D-pad PIN bearable —
      // hunting for a separate OK button doubles the interaction.
      //
      // Called here, after the state write, and NOT from inside a setPin
      // updater. React runs updater functions during the render phase, so
      // submitting from in there ran the parent's onSuccess mid-render:
      // "Cannot update a component (ParentalControlScreen) while rendering a
      // different component (PinPrompt)". Updaters also have to be pure —
      // React may call them twice, which would have submitted twice.
      if (next.length === PIN_LENGTH) submit(next);
    },
    [checking, submit]
  );

  const backspace = useCallback(() => {
    const next = pinRef.current.slice(0, -1);
    pinRef.current = next;
    setError(null);
    setPin(next);
  }, []);

  return (
    <Overlay visible={visible} onClose={onCancel} contentStyle={S.content}>
      <View style={S.header}>
        <View style={S.lockBadge}>
          <Ionicons name="lock-closed" size={ps(1.8)} color="#000" />
        </View>
        <Text style={S.title}>{title}</Text>
        <Text style={S.message}>{message}</Text>
      </View>

      {/* ── The dots ── */}
      <View style={S.dots}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <View key={i} style={[S.dot, i < pin.length && S.dotFilled, !!error && S.dotError]} />
        ))}
      </View>

      <Text style={[S.error, !error && S.errorHidden]}>{error ?? " "}</Text>

      {/* ── Keypad ── */}
      <FocusGroup style={S.grid}>
        {KEYS.map((digit, index) => (
          <Focusable
            key={digit}
            ringOnFocus={false}
            hasTVPreferredFocus={index === 0}
            onPress={() => pushDigit(digit)}
            style={S.keyWrapper}
            accessibilityLabel={`Digit ${digit}`}
          >
            {(focused) => (
              <View style={[S.key, focused && S.keyFocused]}>
                <Text style={[S.keyText, focused && S.keyTextFocused]}>{digit}</Text>
              </View>
            )}
          </Focusable>
        ))}

        <Focusable
          ringOnFocus={false}
          onPress={onCancel}
          style={S.keyWrapper}
          accessibilityLabel="Cancel"
        >
          {(focused) => (
            <View style={[S.key, focused && S.keyFocused]}>
              <Ionicons name="close" size={ps(1.4)} color={focused ? "#000" : "rgba(255,255,255,0.75)"} />
            </View>
          )}
        </Focusable>

        <Focusable
          ringOnFocus={false}
          onPress={() => pushDigit(0)}
          style={S.keyWrapper}
          accessibilityLabel="Digit 0"
        >
          {(focused) => (
            <View style={[S.key, focused && S.keyFocused]}>
              <Text style={[S.keyText, focused && S.keyTextFocused]}>0</Text>
            </View>
          )}
        </Focusable>

        <Focusable
          ringOnFocus={false}
          onPress={backspace}
          style={S.keyWrapper}
          accessibilityLabel="Delete last digit"
        >
          {(focused) => (
            <View style={[S.key, focused && S.keyFocused]}>
              <Ionicons name="backspace-outline" size={ps(1.4)} color={focused ? "#000" : "rgba(255,255,255,0.75)"} />
            </View>
          )}
        </Focusable>
      </FocusGroup>
    </Overlay>
  );
}

const S = StyleSheet.create({
  content: {
    width: ps(26),
    padding: pw(2.5),
    borderRadius: ps(1.6),
    backgroundColor: "#0E0F14",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
  },
  header: { alignItems: "center", gap: ph(0.6) },
  lockBadge: {
    width: ps(3.4),
    height: ps(3.4),
    borderRadius: ps(1.7),
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: ph(0.6),
  },
  title: { color: "#fff", fontSize: ps(1.5), fontWeight: "900", letterSpacing: 0.5 },
  message: {
    color: THEME.colors.textMuted,
    fontSize: ps(1),
    textAlign: "center",
    maxWidth: ps(20),
  },

  dots: { flexDirection: "row", gap: pw(1.2), marginTop: ph(1.6) },
  dot: {
    width: ps(1),
    height: ps(1),
    borderRadius: ps(0.5),
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  dotFilled: { backgroundColor: "#fff" },
  dotError: { backgroundColor: "rgba(255,80,80,0.75)" },

  error: {
    color: "#ff6b6b",
    fontSize: ps(0.9),
    fontWeight: "700",
    marginTop: ph(0.8),
    height: ps(1.4),
  },
  // Kept in the layout so the keypad does not jump when an error appears.
  errorHidden: { opacity: 0 },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    width: ps(16),
    justifyContent: "center",
    marginTop: ph(0.6),
  },
  keyWrapper: { width: "33.33%", padding: ps(0.28) },
  key: {
    height: ps(3.4),
    borderRadius: ps(0.7),
    backgroundColor: "rgba(255,255,255,0.07)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  keyFocused: { backgroundColor: "#fff", borderColor: "#fff", transform: [{ scale: 1.06 }] },
  keyText: { color: "#fff", fontSize: ps(1.6), fontWeight: "800" },
  keyTextFocused: { color: "#000" },
});

export default PinPrompt;
