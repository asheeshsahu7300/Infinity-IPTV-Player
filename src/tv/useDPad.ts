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
]);

let tvEventHandlerInstance: any = null;
let lastSelectTime = 0;

function dispatch(evt: any) {
  const type = evt?.eventType;
  if (!type) return;

  const isSelect = SELECT_TYPES.has(type);

  // For non-select events (e.g. directional keys), filter out key-up (action 1)
  if (!isSelect && !isKeyDown(evt)) return;

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
  else if (type === "up") handlerKey = "onUp";
  else if (type === "down") handlerKey = "onDown";
  else if (type === "left") handlerKey = "onLeft";
  else if (type === "right") handlerKey = "onRight";
  else if (type === "longSelect") handlerKey = "onLongSelect";
  else if (type === "playPause") handlerKey = "onPlayPause";
  else if (type === "fastForward") handlerKey = "onFastForward";
  else if (type === "rewind") handlerKey = "onRewind";
  else if (type === "menu") handlerKey = "onMenu";
  else if (type === "pageUp") handlerKey = "onPageUp";
  else if (type === "pageDown") handlerKey = "onPageDown";

  if (!handlerKey) return;

  const target = activeSubscriberForEvent(handlerKey);
  if (!target) return;

  const h = target.handlers.current;

  if (handlerKey === "onSelect") h.onSelect?.();
  else if (handlerKey === "onUp") h.onUp?.();
  else if (handlerKey === "onDown") h.onDown?.();
  else if (handlerKey === "onLeft") h.onLeft?.();
  else if (handlerKey === "onRight") h.onRight?.();
  else if (handlerKey === "onLongSelect") h.onLongSelect?.();
  else if (handlerKey === "onPlayPause") h.onPlayPause?.();
  else if (handlerKey === "onFastForward") h.onFastForward?.();
  else if (handlerKey === "onRewind") h.onRewind?.();
  else if (handlerKey === "onMenu") h.onMenu?.();
  else if (handlerKey === "onPageUp") h.onPageUp?.();
  else if (handlerKey === "onPageDown") h.onPageDown?.();

  h.onAny?.(type as DPadEventType);
}

function attachNative() {
  if (nativeSubscription || tvEventHandlerInstance) return;
  if (Platform.OS !== "android" && Platform.OS !== "ios") return;

  try {
    if (typeof TVEventHandler === "function") {
      tvEventHandlerInstance = new (TVEventHandler as any)();
      tvEventHandlerInstance.enable(null, (_cmp: any, evt: any) => {
        dispatch(evt);
      });
    } else if (TVEventHandler && typeof (TVEventHandler as any).addListener === "function") {
      nativeSubscription = (TVEventHandler as any).addListener(dispatch);
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
