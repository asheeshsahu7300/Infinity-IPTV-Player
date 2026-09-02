// ─────────────────────────────────────────────────────────────────────────────
// useChannelTuner — the "type 1 0 2 to watch channel 102" state machine.
//
// The behaviour is the one every set-top box shares, and viewers notice
// immediately when it is wrong:
//
//   • digits accumulate into a buffer that is shown as it is typed;
//   • the buffer commits on a short idle timeout, not on an explicit key, so
//     "7" tunes to channel 7 on its own but "7" then "3" tunes to 73;
//   • it commits early once no longer number could match — on a list whose
//     highest channel is 480, "9" has nowhere else to go, so it tunes at once
//     rather than making the viewer wait out the timeout;
//   • it caps at the width of the longest channel number, so a fourth digit on
//     a three-digit list starts a new entry rather than being swallowed.
//
// The hook owns only the entry; what to do with the committed number is the
// caller's business — Live TV scrolls to it, the player tunes to it.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from "react";

/** How long after the last digit the entry commits. */
const COMMIT_DELAY_MS = 1800;

export interface ChannelTunerOptions {
  /** Called with the assembled number once entry settles. */
  onCommit: (channelNumber: number) => void;
  /**
   * Whether any channel number starts with this prefix. Drives the early
   * commit; without it every entry waits out the full timeout.
   */
  hasPrefix?: (prefix: number) => boolean;
  /** Digits in the longest channel number in the list. Defaults to 4. */
  maxDigits?: number;
  enabled?: boolean;
}

export interface ChannelTunerState {
  /** The digits typed so far, or null when the tuner is idle. */
  entry: string | null;
  /** Feed a digit in — from the remote's number pad or the on-screen keypad. */
  pushDigit: (digit: number) => void;
  /** Drop the entry without tuning (BACK while typing). */
  cancel: () => void;
  /** Commit immediately (OK while typing). */
  commitNow: () => void;
}

export function useChannelTuner({
  onCommit,
  hasPrefix,
  maxDigits = 4,
  enabled = true,
}: ChannelTunerOptions): ChannelTunerState {
  const [entry, setEntry] = useState<string | null>(null);
  const entryRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read at commit time rather than captured, so a list that grows while the
  // viewer is typing does not commit against a stale snapshot.
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const hasPrefixRef = useRef(hasPrefix);
  hasPrefixRef.current = hasPrefix;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const finish = useCallback(() => {
    clearTimer();
    const typed = entryRef.current;
    entryRef.current = null;
    setEntry(null);
    if (!typed) return;
    const num = Number(typed);
    if (Number.isFinite(num) && num > 0) onCommitRef.current(num);
  }, [clearTimer]);

  const cancel = useCallback(() => {
    clearTimer();
    entryRef.current = null;
    setEntry(null);
  }, [clearTimer]);

  const pushDigit = useCallback(
    (digit: number) => {
      if (!enabled) return;
      if (digit < 0 || digit > 9) return;

      const current = entryRef.current ?? "";
      // A leading zero is not a channel number; "0" then "7" means 7.
      const nextEntry = current === "" && digit === 0 ? "" : `${current}${digit}`;
      if (nextEntry === "") return;

      entryRef.current = nextEntry;
      setEntry(nextEntry);
      clearTimer();

      // Full width — nothing more can be typed, so tune now.
      if (nextEntry.length >= maxDigits) {
        finish();
        return;
      }

      // No longer number could start with this, so waiting achieves nothing.
      const check = hasPrefixRef.current;
      if (check && !check(Number(`${nextEntry}0`)) && !hasLongerMatch(nextEntry, check)) {
        finish();
        return;
      }

      timerRef.current = setTimeout(finish, COMMIT_DELAY_MS);
    },
    [enabled, maxDigits, clearTimer, finish]
  );

  useEffect(() => clearTimer, [clearTimer]);

  // Leaving the screen mid-entry must not fire a tune a second later.
  useEffect(() => {
    if (!enabled) cancel();
  }, [enabled, cancel]);

  return { entry, pushDigit, cancel, commitNow: finish };
}

/**
 * Whether appending any digit to `prefix` could still land on a real channel.
 *
 * Ten cheap probes beats threading a trie through the caller, and it runs at
 * most once per keypress.
 */
function hasLongerMatch(prefix: string, hasPrefix: (n: number) => boolean): boolean {
  for (let d = 0; d <= 9; d++) {
    if (hasPrefix(Number(`${prefix}${d}`))) return true;
  }
  return false;
}

export default useChannelTuner;
