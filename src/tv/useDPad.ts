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
  React.useEffect(() => {
    if (!enabled) return;
    if (Platform.OS !== "android" && Platform.OS !== "ios") return;

    const tvEventHandler = new TVEventHandler();
    tvEventHandler.enable(undefined, (_cmp: any, evt: any) => {
      if (!isKeyDown(evt)) return;

      const type = evt?.eventType;
      if (!type) return;

      if (type === "select" || type === "dpad_center" || type === "center") {
        handlers.onSelect?.();
      } else if (type === "up") {
        handlers.onUp?.();
      } else if (type === "down") {
        handlers.onDown?.();
      } else if (type === "left") {
        handlers.onLeft?.();
      } else if (type === "right") {
        handlers.onRight?.();
      } else if (type === "longSelect") {
        handlers.onLongSelect?.();
      } else if (type === "playPause") {
        handlers.onPlayPause?.();
      } else if (type === "fastForward") {
        handlers.onFastForward?.();
      } else if (type === "rewind") {
        handlers.onRewind?.();
      } else if (type === "menu") {
        handlers.onMenu?.();
      }

      handlers.onAny?.(type);
    });

    return () => {
      tvEventHandler.disable();
    };
  }, [enabled, handlers]);
}

// Default no-op export to keep import paths simple
export default useDPad;
