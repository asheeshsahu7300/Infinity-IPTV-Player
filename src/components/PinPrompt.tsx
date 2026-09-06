// ─────────────────────────────────────────────────────────────────────────────
// PinPrompt — the parental-lock keypad.
//
// Driven entirely by focusable buttons rather than a TextInput: on a TV a text
// field means the system IME covering the screen, and a four-digit PIN is far
// quicker on a D-pad grid. The same overlay is used for entering a PIN and for
// changing one, because the second is just the first asked three times.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from 'react-native';
import { Focusable, Overlay } from "../tv";
import { THEME, ph, ps, pw } from "../theme/tokens";
import { Lock, X } from 'lucide-react-native';
import { DynamicIcon } from '../components/DynamicIcon';
import { Text } from './Text';


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

type KeypadItem =
  | { key: string; type: "digit"; value: number; label: string }
  | { key: string; type: "cancel"; label: string }
  | { key: string; type: "backspace"; label: string };

const KEYPAD_ROWS: KeypadItem[][] = [
  [
    { key: "1", type: "digit", value: 1, label: "Digit 1" },
    { key: "2", type: "digit", value: 2, label: "Digit 2" },
    { key: "3", type: "digit", value: 3, label: "Digit 3" },
  ],
  [
    { key: "4", type: "digit", value: 4, label: "Digit 4" },
    { key: "5", type: "digit", value: 5, label: "Digit 5" },
    { key: "6", type: "digit", value: 6, label: "Digit 6" },
  ],
  [
    { key: "7", type: "digit", value: 7, label: "Digit 7" },
    { key: "8", type: "digit", value: 8, label: "Digit 8" },
    { key: "9", type: "digit", value: 9, label: "Digit 9" },
  ],
  [
    { key: "cancel", type: "cancel", label: "Cancel" },
    { key: "0", type: "digit", value: 0, label: "Digit 0" },
    { key: "backspace", type: "backspace", label: "Delete last digit" },
  ],
];

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
    <Overlay visible={visible} onClose={onCancel} contentStyle={S.content} axis="grid">
      <View style={S.header}>
        <View style={S.lockBadge}>
          <Lock size={ps(2.6)} color="rgba(255,255,255,0.75)" />
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

      {/* ── Keypad (3x4 2D Grid) ── */}
      <View style={S.grid}>
        {KEYPAD_ROWS.map((row, rowIdx) => (
          <View key={rowIdx} style={S.row}>
            {row.map((item, colIdx) => (
              <Focusable
                key={item.key}
                ringOnFocus={false}
                hasTVPreferredFocus={rowIdx === 0 && colIdx === 0}
                onPress={() => {
                  if (item.type === "digit") pushDigit(item.value);
                  else if (item.type === "cancel") onCancel();
                  else if (item.type === "backspace") backspace();
                }}
                style={S.keyWrapper}
                accessibilityLabel={item.label}
              >
                {(focused) => (
                  <View style={[S.key, focused && S.keyFocused]}>
                    {item.type === "digit" ? (
                      <Text style={[S.keyText, focused && S.keyTextFocused]}>{item.value}</Text>
                    ) : item.type === "cancel" ? (
                      <X
                        size={ps(1.4)}
                        color={focused ? "#000" : "rgba(255,255,255,0.75)"}
                      />
                    ) : (
                      <DynamicIcon
                        name="delete"
                        size={ps(1.4)}
                        color={focused ? "#000" : "rgba(255,255,255,0.75)"}
                      />
                    )}
                  </View>
                )}
              </Focusable>
            ))}
          </View>
        ))}
      </View>
    </Overlay>
  );
}

const S = StyleSheet.create({
  content: {
    width: ps(30),
    paddingHorizontal: pw(3),
    paddingVertical: ph(3),
    borderRadius: 18,
    backgroundColor: "#17181c",
    borderWidth: 0,
    borderColor: "transparent",
    alignItems: "center",
  },
  header: { alignItems: "center", gap: ph(0.8) },
  lockBadge: {
    marginBottom: ph(1),
  },
  title: { color: "#fff", fontSize: ps(2), fontWeight: "900", letterSpacing: 0.5 },
  message: {
    color: THEME.colors.textMuted,
    fontSize: ps(1.1),
    textAlign: "center",
    maxWidth: ps(22),
    lineHeight: ps(1.7),
  },

  dots: { flexDirection: "row", gap: pw(1.6), marginTop: ph(2.2), marginBottom: ph(0.4) },
  dot: {
    width: ps(1.2),
    height: ps(1.2),
    borderRadius: ps(0.6),
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  dotFilled: { backgroundColor: "#fff" },
  dotError: { backgroundColor: "rgba(255,80,80,0.75)" },

  error: {
    color: "#ff6b6b",
    fontSize: ps(1),
    fontWeight: "700",
    marginTop: ph(0.8),
    height: ps(1.5),
  },
  // Kept in the layout so the keypad does not jump when an error appears.
  errorHidden: { opacity: 0 },

  grid: {
    flexDirection: "column",
    width: ps(20),
    marginTop: ph(1),
    gap: ps(0.28),
  },
  row: {
    flexDirection: "row",
    justifyContent: "center",
    width: "100%",
    gap: ps(0.28),
  },
  keyWrapper: { flex: 1 },
  key: {
    height: ps(4),
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 0,
    borderColor: "transparent",
  },
  keyFocused: { backgroundColor: "#fff", borderColor: "transparent", borderWidth: 0 },
  keyText: { color: "#fff", fontSize: ps(1.8), fontWeight: "800" },
  keyTextFocused: { color: "#000" },
});

export default PinPrompt;
