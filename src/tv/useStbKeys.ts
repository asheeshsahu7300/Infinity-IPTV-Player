import React from "react";

import {
  StbKeyEvent,
  STB_PRIORITY,
  StbKeyOptions,
  StbSubscription,
  subscribeStbKeys,
} from "./stbKeys";

export interface StbKeyHandlers {
  /** A number key, 0–9. This is what drives the channel tuner. */
  onDigit?: (digit: number) => void;
  onChannelUp?: () => void;
  onChannelDown?: () => void;
  /**
   * INFO is not here. `useDPad` already owns it — see the note at the top of
   * stbKeys.ts — and handling it in both registries fires every press twice.
   */
  /** GUIDE / EPG — opens the programme guide. */
  onGuide?: () => void;
  onRed?: () => void;
  onGreen?: () => void;
  onYellow?: () => void;
  onBlue?: () => void;
  onAny?: (event: StbKeyEvent) => void;
}

/**
 * Subscribes to the set-top keys the React Native TV bridge drops — the number
 * pad, CH+/CH-, INFO, GUIDE and the coloured keys. See `stbKeys.ts` for how
 * they get here, and note that on a build without the native half nothing ever
 * fires: every caller needs an on-screen path to the same action.
 */
export function useStbKeys(handlers: StbKeyHandlers, options: StbKeyOptions | boolean = true) {
  const opts: StbKeyOptions = typeof options === "boolean" ? { enabled: options } : options;
  const enabled = opts.enabled ?? true;
  const priority = opts.priority ?? STB_PRIORITY.SCREEN;

  const handlersRef = React.useRef(handlers);
  handlersRef.current = handlers;

  const dispatchRef = React.useRef((event: StbKeyEvent) => {
    const h = handlersRef.current;
    switch (event.key) {
      case "digit":
        if (event.digit !== undefined) h.onDigit?.(event.digit);
        break;
      case "channelUp": h.onChannelUp?.(); break;
      case "channelDown": h.onChannelDown?.(); break;
      case "guide": h.onGuide?.(); break;
      case "red": h.onRed?.(); break;
      case "green": h.onGreen?.(); break;
      case "yellow": h.onYellow?.(); break;
      case "blue": h.onBlue?.(); break;
      default: break;
    }
    h.onAny?.(event);
  });

  const subRef = React.useRef<StbSubscription | null>(null);

  // Registered once per mount; enabled/priority are mutated in place below so
  // a re-render never drops a keypress on the floor.
  React.useEffect(() => {
    subRef.current = subscribeStbKeys(dispatchRef, { enabled, priority });
    return () => {
      subRef.current?.remove();
      subRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    subRef.current?.setEnabled(enabled);
    subRef.current?.setPriority(priority);
  }, [enabled, priority]);
}

export default useStbKeys;
