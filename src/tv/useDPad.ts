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

const isKeyDown = (evt: any): boolean => {
  const action = evt?.eventKeyAction;
  if (action == null) return true;
  if (typeof action === "number") return action === 0;
  if (typeof action === "string") return action === "0" || action === "down";
  return true;
};

export function useDPad(handlers: DPadHandlers, enabled: boolean = true) {
  const handlersRef = React.useRef(handlers);

  React.useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  React.useEffect(() => {
    if (!enabled) return;
    if (Platform.OS !== "android" && Platform.OS !== "ios") return;

    let subscription: any;
    let tvEventHandler: any;

    const handler = (evt: any) => {
      if (!isKeyDown(evt)) return;

      const type = evt?.eventType;
      if (!type) return;

      const current = handlersRef.current;

      if (type === "select" || type === "dpad_center" || type === "center") {
        current.onSelect?.();
      } else if (type === "up") {
        current.onUp?.();
      } else if (type === "down") {
        current.onDown?.();
      } else if (type === "left") {
        current.onLeft?.();
      } else if (type === "right") {
        current.onRight?.();
      } else if (type === "longSelect") {
        current.onLongSelect?.();
      } else if (type === "playPause") {
        current.onPlayPause?.();
      } else if (type === "fastForward") {
        current.onFastForward?.();
      } else if (type === "rewind") {
        current.onRewind?.();
      } else if (type === "menu") {
        current.onMenu?.();
      } else if (type === "pageUp") {
        current.onPageUp?.();
      } else if (type === "pageDown") {
        current.onPageDown?.();
      }

      current.onAny?.(type);
    };

    if (typeof TVEventHandler === "function") {
      tvEventHandler = new (TVEventHandler as any)();
      tvEventHandler.enable(undefined, (_cmp: any, evt: any) => handler(evt));
    } else if (TVEventHandler && typeof (TVEventHandler as any).addListener === "function") {
      subscription = (TVEventHandler as any).addListener(handler);
    }

    return () => {
      if (tvEventHandler && typeof tvEventHandler.disable === "function") tvEventHandler.disable();
      if (subscription && typeof subscription.remove === "function") subscription.remove();
    };
  }, [enabled]);
}

// Default no-op export to keep import paths simple
export default useDPad;
