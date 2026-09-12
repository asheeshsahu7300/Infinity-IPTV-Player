import React from "react";
import { Platform } from "react-native";
import * as ReactNative from "react-native";

import { isKeyPress, resetKeyPressState } from "./keyPress";

// TVEventHandler is provided on TV-enabled builds; on standard react-native it may be absent.
const TVEventHandler: any = (ReactNative as any).TVEventHandler;

export type DPadEventType =
  | "up"
  | "down"
  | "left"
  | "right"
  | "select"
  | "longSelect"
  | "playPause"
  | "fastForward"
  | "rewind"
  | "menu"
  | "pageUp"
  | "pageDown"
  | "info"
  | "next"
  | "previous"
  | "stop";

export interface DPadHandlers {
  onUp?: () => void;
  onDown?: () => void;
  onLeft?: () => void;
  onRight?: () => void;
  onSelect?: () => void;
  onLongSelect?: () => void;
  onPlayPause?: () => void;
  onFastForward?: () => void;
  onRewind?: () => void;
  onMenu?: () => void;
  onPageUp?: () => void;
  onPageDown?: () => void;
  /** INFO on a set-top remote. RN's Android bridge does forward this one. */
  onInfo?: () => void;
  /** Media next/previous — the closest thing to CH+/CH- the stock bridge has. */
  onNext?: () => void;
  onPrevious?: () => void;
  onStop?: () => void;
  onAny?: (eventType: DPadEventType) => void;
}

/**
 * Dispatch priority. Only the highest-priority *enabled* subscriber receives
 * remote events, so an open overlay silently intercepts everything below it
 * instead of every mounted screen reacting to the same key press.
 */
export const DPAD_PRIORITY = {
  SCREEN: 0,
  PLAYER: 10,
  OVERLAY: 100,
} as const;

export interface DPadOptions {
  enabled?: boolean;
  /** Higher wins. Defaults to `DPAD_PRIORITY.SCREEN`. */
  priority?: number;
}

interface Subscriber {
  seq: number;
  priority: number;
  enabled: boolean;
  handlers: React.MutableRefObject<DPadHandlers>;
}

const subscribers: Subscriber[] = [];
let nativeSubscription: { remove: () => void } | null = null;
let seqCounter = 0;



function activeSubscriberForEvent(handlerKey: keyof DPadHandlers): Subscriber | null {
  let best: Subscriber | null = null;
  for (const sub of subscribers) {
    if (!sub.enabled) continue;
    const h = sub.handlers.current;
    if (!h[handlerKey] && !h.onAny) continue;

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

const SELECT_TYPES = new Set([
  "select",
  "dpad_center",
  "center",
  "enter",
  "button_select",
  "KEYCODE_DPAD_CENTER",
  "KEYCODE_ENTER",
  "space",
  "Space",
]);

const UP_TYPES = new Set(["up", "dpad_up", "arrow_up", "KEYCODE_DPAD_UP", "upArrow", "ArrowUp"]);
const DOWN_TYPES = new Set(["down", "dpad_down", "arrow_down", "KEYCODE_DPAD_DOWN", "downArrow", "ArrowDown"]);
const LEFT_TYPES = new Set(["left", "dpad_left", "arrow_left", "KEYCODE_DPAD_LEFT", "leftArrow", "ArrowLeft"]);
const RIGHT_TYPES = new Set(["right", "dpad_right", "arrow_right", "KEYCODE_DPAD_RIGHT", "rightArrow", "ArrowRight"]);
const PLAY_TYPES = new Set([
  "playPause",
  "play",
  "pause",
  "media_play_pause",
  "media_play",
  "media_pause",
  "KEYCODE_MEDIA_PLAY_PAUSE",
  "KEYCODE_MEDIA_PLAY",
  "KEYCODE_MEDIA_PAUSE",
]);
const FF_TYPES = new Set(["fastForward", "fast_forward", "media_fast_forward", "media_step_forward", "KEYCODE_MEDIA_FAST_FORWARD"]);
const REW_TYPES = new Set(["rewind", "media_rewind", "media_step_backward", "KEYCODE_MEDIA_REWIND"]);
const MENU_TYPES = new Set(["menu", "KEYCODE_MENU"]);
const INFO_TYPES = new Set(["info", "KEYCODE_INFO"]);
const NEXT_TYPES = new Set(["next", "media_next", "KEYCODE_MEDIA_NEXT"]);
const PREV_TYPES = new Set(["previous", "media_previous", "KEYCODE_MEDIA_PREVIOUS"]);
const STOP_TYPES = new Set(["stop", "media_stop", "KEYCODE_MEDIA_STOP"]);
const PAGE_UP_TYPES = new Set(["pageUp", "KEYCODE_PAGE_UP"]);
const PAGE_DOWN_TYPES = new Set(["pageDown", "KEYCODE_PAGE_DOWN"]);

let tvEventHandlerInstance: any = null;
let lastSelectTime = 0;

function dispatch(evt: any) {
  const type = evt?.eventType;
  if (!type || type === "focus" || type === "blur") return;

  const isSelect = SELECT_TYPES.has(type);

  // One call per physical press.
  //
  // This was `if (!isKeyDown(evt)) return;` — filtering for ACTION_DOWN, which
  // seems right and is not: the bridge only delivers ACTION_UP unless a native
  // feature flag is enabled, so that line dropped every event. Focus movement
  // kept working because the Android focus engine does it without JS, which is
  // what hid this. See the note at the top of keyPress.ts.
  if (!isKeyPress(type, evt)) return;

  // Select keeps a short debounce on top. Some remotes report the OK button
  // through more than one eventType ("select" and "enter"), which pairing
  // cannot collapse because they are different keys.
  if (isSelect) {
    const now = Date.now();
    if (now - lastSelectTime < 150) {
      return;
    }
    lastSelectTime = now;
  }

  let handlerKey: keyof DPadHandlers | null = null;
  if (isSelect) handlerKey = "onSelect";
  else if (UP_TYPES.has(type)) handlerKey = "onUp";
  else if (DOWN_TYPES.has(type)) handlerKey = "onDown";
  else if (LEFT_TYPES.has(type)) handlerKey = "onLeft";
  else if (RIGHT_TYPES.has(type)) handlerKey = "onRight";
  else if (type === "longSelect") handlerKey = "onLongSelect";
  else if (PLAY_TYPES.has(type)) handlerKey = "onPlayPause";
  else if (FF_TYPES.has(type)) handlerKey = "onFastForward";
  else if (REW_TYPES.has(type)) handlerKey = "onRewind";
  else if (MENU_TYPES.has(type)) handlerKey = "onMenu";
  else if (PAGE_UP_TYPES.has(type)) handlerKey = "onPageUp";
  else if (PAGE_DOWN_TYPES.has(type)) handlerKey = "onPageDown";
  else if (INFO_TYPES.has(type)) handlerKey = "onInfo";
  else if (NEXT_TYPES.has(type)) handlerKey = "onNext";
  else if (PREV_TYPES.has(type)) handlerKey = "onPrevious";
  else if (STOP_TYPES.has(type)) handlerKey = "onStop";

  const target = activeSubscriberForEvent(handlerKey || "onAny");
  if (!target) return;

  const h = target.handlers.current;

  if (handlerKey && h[handlerKey]) {
    h[handlerKey]?.();
  }

  h.onAny?.(type as DPadEventType);
}

function attachNative() {
  if (nativeSubscription || tvEventHandlerInstance) return;
  if (Platform.OS !== "android" && Platform.OS !== "ios") return;

  try {
    if (TVEventHandler && typeof (TVEventHandler as any).addListener === "function") {
      nativeSubscription = (TVEventHandler as any).addListener((evt: any) => {
        dispatch(evt);
      });
    } else if (typeof TVEventHandler === "function") {
      tvEventHandlerInstance = new (TVEventHandler as any)();
      tvEventHandlerInstance.enable(null, (_cmp: any, evt: any) => {
        dispatch(evt);
      });
    }
  } catch (err) {
    console.warn("Failed to attach TVEventHandler in useDPad:", err);
  }
}

function detachNativeIfIdle() {
  if (subscribers.length === 0) {
    resetKeyPressState();
    if (tvEventHandlerInstance && typeof tvEventHandlerInstance.disable === "function") {
      try {
        tvEventHandlerInstance.disable();
      } catch {}
      tvEventHandlerInstance = null;
    }
    if (nativeSubscription) {
      nativeSubscription.remove();
      nativeSubscription = null;
    }
  }
}

export function useDPad(handlers: DPadHandlers, options: boolean | DPadOptions = true) {
  const opts: DPadOptions = typeof options === "boolean" ? { enabled: options } : options;
  const enabled = opts.enabled ?? true;
  const priority = opts.priority ?? DPAD_PRIORITY.SCREEN;

  const handlersRef = React.useRef(handlers);
  handlersRef.current = handlers;

  const subRef = React.useRef<Subscriber | null>(null);

  // Register once per mount; enabled/priority are mutated in place so toggling
  // them never tears down and re-attaches the native listener.
  React.useEffect(() => {
    const sub: Subscriber = {
      seq: ++seqCounter,
      priority,
      enabled,
      handlers: handlersRef,
    };
    subRef.current = sub;
    subscribers.push(sub);
    attachNative();

    return () => {
      const i = subscribers.indexOf(sub);
      if (i >= 0) subscribers.splice(i, 1);
      subRef.current = null;
      detachNativeIfIdle();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (subRef.current) {
      subRef.current.enabled = enabled;
      subRef.current.priority = priority;
    }
  }, [enabled, priority]);
}

export default useDPad;
