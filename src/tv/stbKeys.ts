// ─────────────────────────────────────────────────────────────────────────────
// stbKeys — the set-top remote keys, over the TV event bridge that already
// carries them.
//
// react-native-tvos forwards these itself. That is worth stating plainly
// because it is easy to conclude otherwise: the fork ships *two* classes named
// `ReactAndroidHWInputDeviceHelper`, and they disagree.
//
//   • `com.facebook.react.ReactAndroidHWInputDeviceHelper` (Kotlin) maps only
//     the D-pad, select, the transport keys, INFO and MENU. It is `internal`
//     and nothing in the fork references it — dead code.
//   • `com.facebook.react.modules.core.ReactAndroidHWInputDeviceHelper` (Java)
//     is the one `ReactRootView` actually instantiates, and it maps the number
//     row to eventTypes "0".."9", plus "channelUp", "channelDown", "guide" and
//     "info".
//
// So the number pad, CH+/CH- and GUIDE arrive through the ordinary
// `TVEventHandler` path and need no native change. An earlier version of this
// module read the reduced map, concluded the keys were unreachable, and paired
// itself with a `dispatchKeyEvent` override in MainActivity that re-emitted
// them. That made each of these keys fire *twice*: dialling "1" entered "11"
// and CH+ skipped two channels. The override is gone.
//
// What remains here is the semantic layer over those raw event types — digits
// parsed to numbers, PAGE_UP folded onto CH+, and a priority registry so an
// open overlay swallows the number pad instead of the screen behind it also
// tuning.
//
// INFO is deliberately absent: `useDPad` has owned `onInfo` since before this
// module existed, and claiming it in both registries delivers every press
// twice.
// ─────────────────────────────────────────────────────────────────────────────
import { Platform } from "react-native";
import * as ReactNative from "react-native";

import { isKeyPress, resetKeyPressState } from "./keyPress";

// TVEventHandler is provided on TV-enabled builds; on standard react-native it may be absent.
const TVEventHandler: any = (ReactNative as any).TVEventHandler;

export type StbKey =
  | "digit"
  | "channelUp"
  | "channelDown"
  | "guide"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "back";

export interface StbKeyEvent {
  key: StbKey;
  /** 0–9 for `digit`, undefined otherwise. */
  digit?: number;
}

/**
 * `onHWKeyEvent` eventType → the semantic key the app reasons about.
 *
 * The canonical strings come from the Java helper's KEY_EVENTS_ACTIONS map.
 * Aliases are accepted because tvOS and some OEM builds label the same press
 * differently, and an unrecognised label is indistinguishable from a key that
 * was never pressed at all.
 */
const EVENT_TYPES: Record<string, StbKey> = {
  channelUp: "channelUp",
  channelDown: "channelDown",
  channel_up: "channelUp",
  channel_down: "channelDown",
  // Not in the live map, but harmless to accept from remotes that send it.
  pageUp: "channelUp",
  pageDown: "channelDown",
  guide: "guide",
  dvr: "guide",
  // The coloured keys are absent from the live map, so on most hardware these
  // never fire. Kept so a device that does send them works.
  red: "red",
  green: "green",
  yellow: "yellow",
  blue: "blue",
};

/** "0".."9" are their own eventTypes; anything else is not a digit. */
function digitFor(eventType: string): number | undefined {
  if (eventType.length !== 1) return undefined;
  const code = eventType.charCodeAt(0);
  if (code < 48 || code > 57) return undefined;
  return code - 48;
}

type Handler = (event: StbKeyEvent) => void;

interface Subscriber {
  seq: number;
  priority: number;
  enabled: boolean;
  handler: { current: Handler };
}

const subscribers: Subscriber[] = [];
let seqCounter = 0;
let nativeSub: { remove: () => void } | null = null;

/**
 * Mirrors `DPAD_PRIORITY`: only the top enabled subscriber sees a key, so an
 * open overlay swallows the number pad instead of the screen behind it also
 * tuning.
 */
export const STB_PRIORITY = {
  SCREEN: 0,
  PLAYER: 10,
  OVERLAY: 100,
} as const;

let sawNativeKey = false;

/**
 * True once one of these keys has actually arrived.
 *
 * Whether a particular remote even has a number pad can only be observed, not
 * asked about, so screens use this to decide whether to keep the on-screen
 * keypad hint visible — and must stay usable while it is false.
 */
export const hasNativeStbKeys = (): boolean => sawNativeKey;

/** Picks the highest-priority enabled subscriber, newest wins on a tie. */
function activeSubscriber(): Subscriber | null {
  let best: Subscriber | null = null;
  for (const sub of subscribers) {
    if (!sub.enabled) continue;
    if (
      !best ||
      sub.priority > best.priority ||
      (sub.priority === best.priority && sub.seq > best.seq)
    ) {
      best = sub;
    }
  }
  return best;
}

function dispatch(raw: any) {
  const eventType = raw?.eventType;
  if (typeof eventType !== "string" || !eventType) return;

  const digit = digitFor(eventType);
  const key: StbKey | undefined = digit !== undefined ? "digit" : EVENT_TYPES[eventType];
  if (!key) return;

  // Not a key-down filter. The bridge only delivers ACTION_UP unless a native
  // feature flag is on, so filtering for key-down discarded every number key —
  // see the note at the top of keyPress.ts.
  if (!isKeyPress(eventType, raw)) return;

  sawNativeKey = true;
  activeSubscriber()?.handler.current({ key, digit });
}

function attach() {
  if (nativeSub) return;
  if (Platform.OS !== "android" && Platform.OS !== "ios") return;

  try {
    if (TVEventHandler && typeof (TVEventHandler as any).addListener === "function") {
      nativeSub = (TVEventHandler as any).addListener(dispatch);
    } else if (typeof TVEventHandler === "function") {
      // The older class-based API, whose teardown is `disable()` — wrapped to
      // match the { remove } shape the newer one returns.
      const instance = new (TVEventHandler as any)();
      instance.enable(null, (_cmp: any, evt: any) => dispatch(evt));
      nativeSub = {
        remove: () => {
          try {
            instance.disable();
          } catch {
            /* already torn down */
          }
        },
      };
    }
  } catch (err) {
    console.warn("[StbKeys] Failed to attach TVEventHandler:", err);
  }
}

function detachIfIdle() {
  if (subscribers.length === 0) resetKeyPressState();
  if (subscribers.length === 0 && nativeSub) {
    nativeSub.remove();
    nativeSub = null;
  }
}

/**
 * Feeds a key into the same dispatch path the native bridge uses.
 *
 * On-screen controls call this so a tap on the keypad and a press on the remote
 * take exactly one code path.
 */
export function emitStbKey(event: StbKeyEvent) {
  activeSubscriber()?.handler.current(event);
}

export interface StbKeyOptions {
  enabled?: boolean;
  priority?: number;
}

/** A live registration. `enabled` and `priority` are mutable in place. */
export interface StbSubscription {
  setEnabled(enabled: boolean): void;
  setPriority(priority: number): void;
  remove(): void;
}

/**
 * Registers a handler for the extended remote keys.
 *
 * The handler is passed by ref rather than by value, and the returned handle
 * mutates the registration in place, so toggling `enabled` never tears the
 * native listener down and back up mid-keypress — the same reason `useDPad`
 * is built this way.
 */
export function subscribeStbKeys(
  handlerRef: { current: Handler },
  options: StbKeyOptions = {}
): StbSubscription {
  const sub: Subscriber = {
    seq: ++seqCounter,
    priority: options.priority ?? STB_PRIORITY.SCREEN,
    enabled: options.enabled ?? true,
    handler: handlerRef,
  };
  subscribers.push(sub);
  attach();

  return {
    setEnabled(enabled: boolean) {
      sub.enabled = enabled;
    },
    setPriority(priority: number) {
      sub.priority = priority;
    },
    remove() {
      const i = subscribers.indexOf(sub);
      if (i >= 0) subscribers.splice(i, 1);
      detachIfIdle();
    },
  };
}
