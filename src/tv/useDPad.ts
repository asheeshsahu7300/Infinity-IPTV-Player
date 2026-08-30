import React from "react";
import { Platform, TVEventHandler } from "react-native";

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
  | "pageDown";

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

/**
 * Android reports 0 for ACTION_DOWN and 1 for ACTION_UP; tvOS reports -1 or
 * nothing at all. Treat everything that is not an explicit key-up as a
 * key-down so tvOS events are not silently dropped.
 */
const isKeyDown = (evt: any): boolean => {
  const action = evt?.eventKeyAction;
  if (action == null) return true;
  if (typeof action === "number") return action !== 1;
  if (typeof action === "string") return action !== "1" && action !== "up";
  return true;
};

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
const PAGE_UP_TYPES = new Set(["pageUp", "KEYCODE_PAGE_UP"]);
const PAGE_DOWN_TYPES = new Set(["pageDown", "KEYCODE_PAGE_DOWN"]);

let tvEventHandlerInstance: any = null;
let lastSelectTime = 0;

function dispatch(evt: any) {
  const type = evt?.eventType;
  if (!type || type === "focus" || type === "blur") return;

  const isSelect = SELECT_TYPES.has(type);

  // Filter out key-up (action 1) events so only key-down triggers actions
  if (!isKeyDown(evt)) return;

  // Debounce select events (150ms) because Android TV remotes can send action 1 and 0 back-to-back
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
