// ─────────────────────────────────────────────────────────────────────────────
// keyPress — turning the TV bridge's key events into one press each.
//
// This exists because the obvious filter is wrong, and wrong in a way that
// silently deletes every key.
//
// `ReactAndroidHWInputDeviceHelper.shouldDispatchEvent` reads:
//
//     KEY_EVENTS_ACTIONS.containsKey(code) && (
//       action == ACTION_UP ||
//       (action == ACTION_DOWN && !longPress && ReactFeatureFlags.enableKeyDownEvents) ||
//       ...
//     )
//
// and `enableKeyDownEvents` defaults to **false**. So on a stock build the only
// event that reaches JS is ACTION_UP — the key-*up*. Filtering for key-down,
// which is what you would write to avoid counting a press twice, throws away
// the one event there is. That is why the numeric tuner did nothing at all.
//
// Three delivery modes have to work, and a timer cannot tell them apart — the
// gap between a real DOWN and its UP is however long the finger was on the
// button, which overlaps with two deliberate presses. So this tracks the pair
// instead:
//
//   • UP only (the default)           → the UP is the press.
//   • DOWN then UP (flag enabled)     → the DOWN is the press, the UP is
//                                       swallowed because a DOWN is pending.
//   • no action field at all (tvOS)   → treat it as a press.
// ─────────────────────────────────────────────────────────────────────────────

const ACTION_DOWN = 0;
const ACTION_UP = 1;

/**
 * Keys whose ACTION_DOWN has been counted and whose ACTION_UP must not be.
 *
 * Keyed per *scope*, not globally, because `useDPad` and `stbKeys` each attach
 * their own listener to the same native `onHWKeyEvent` stream. Sharing one set
 * meant whichever module dispatched first consumed the DOWN and the second one
 * then treated the paired UP as a fresh press — every number key entered twice
 * on any build where `enableKeyDownEvents` is on.
 */
const pendingDown = new Map<string, Set<string>>();

function pendingFor(scope: string): Set<string> {
  let set = pendingDown.get(scope);
  if (!set) {
    set = new Set<string>();
    pendingDown.set(scope, set);
  }
  return set;
}

/**
 * Whether this event is the moment to act on, exactly once per physical press.
 *
 * @param key   a stable identity for the button — the eventType is fine.
 * @param event the raw payload, read for `eventKeyAction`.
 * @param scope the listener asking. Each native listener needs its own, or the
 *              two of them eat each other's halves of a press.
 */
export function isKeyPress(key: string, event: any, scope = "default"): boolean {
  const raw = event?.eventKeyAction;

  // tvOS and some OEM builds omit the field. Nothing to pair up, so every
  // event is a press.
  if (raw === null || raw === undefined) return true;

  const action = typeof raw === "string" ? Number(raw) : raw;
  if (!Number.isFinite(action)) return true;

  if (action === ACTION_DOWN) {
    pendingFor(scope).add(key);
    return true;
  }

  if (action === ACTION_UP) {
    // Its DOWN already counted, so this UP is the tail of the same press.
    if (pendingFor(scope).delete(key)) return false;
    return true;
  }

  // Anything else — key repeat on some devices — is not a fresh press.
  return false;
}

/**
 * Drops any half-seen presses for one scope.
 *
 * Called when a subscriber list empties: a DOWN whose UP never arrived (focus
 * moved, an overlay opened) would otherwise swallow the next press of that key.
 * Scoped, so one module going idle does not clear the other's pending presses.
 */
export function resetKeyPressState(scope = "default"): void {
  pendingDown.get(scope)?.clear();
}
