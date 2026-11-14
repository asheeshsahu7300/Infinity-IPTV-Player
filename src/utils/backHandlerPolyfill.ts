// src/utils/backHandlerPolyfill.ts
// Polyfills React Native BackHandler for Web, LG webOS TV & Samsung Tizen TV.
// Listens to webOS Remote Back (keyCode 461), Samsung Tizen Return (keyCode 10009), Escape (27), and Backspace (8).
// Dispatches to BackHandler listeners in LIFO order and falls back to safeBack(), webOSExit(), or tizenExit().

import { Platform, BackHandler } from "react-native";
import { safeBack } from "../services/safeNavigation";
import { webOSExit, isWebOS } from "./webosUtils";
import { tizenExit, isTizen } from "./tizenUtils";

type BackListener = () => boolean | null | undefined | void;

const listeners: BackListener[] = [];
let isPolyfillInitialized = false;

export function initBackHandlerPolyfill(): void {
  if (Platform.OS !== "web" || typeof window === "undefined" || isPolyfillInitialized) {
    return;
  }
  isPolyfillInitialized = true;

  // Polyfill findNodeHandle on web so any call returns safely without throwing
  try {
    const RN = require("react-native");
    if (RN) {
      RN.findNodeHandle = (component: any) => {
        if (!component) return undefined;
        if (typeof component === "number") return component;
        return component;
      };
    }
  } catch {}

  // Polyfill BackHandler methods on web
  const originalAddEventListener = BackHandler.addEventListener;
  const originalExitApp = BackHandler.exitApp;

  BackHandler.addEventListener = function (
    eventName: "hardwareBackPress",
    handler: BackListener
  ) {
    if (eventName === "hardwareBackPress" && typeof handler === "function") {
      listeners.push(handler);
      return {
        remove: () => {
          const index = listeners.indexOf(handler);
          if (index !== -1) {
            listeners.splice(index, 1);
          }
        },
      };
    }
    return originalAddEventListener ? originalAddEventListener(eventName, handler as any) : { remove: () => {} };
  };

  BackHandler.exitApp = function () {
    if (isWebOS()) {
      webOSExit();
    } else if (isTizen()) {
      tizenExit();
    } else if (originalExitApp) {
      originalExitApp();
    }
  };

  // Attach global keyboard listener for webOS Back button
  window.addEventListener(
    "keydown",
    (event: KeyboardEvent) => {
      // 461: webOS Remote Back
      // 10009: Samsung Tizen Return
      // 27: Escape
      // 8: Backspace (only when not typing in an input or textarea)
      const isBackKey =
        event.keyCode === 461 ||
        event.keyCode === 10009 ||
        event.key === "Back" ||
        event.key === "Return" ||
        event.keyCode === 27 ||
        event.key === "Escape";

      const isBackspace =
        (event.keyCode === 8 || event.key === "Backspace") &&
        !isTextInputTarget(event.target);

      if (!isBackKey && !isBackspace) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      // Dispatch to registered listeners in LIFO order (most recent first)
      const reversed = [...listeners].reverse();
      let handled = false;

      for (const listener of reversed) {
        try {
          const result = listener();
          if (result === true) {
            handled = true;
            break;
          }
        } catch (err) {
          console.warn("[BackHandlerPolyfill] Error in back listener:", err);
        }
      }

      // If no listener consumed the back press, invoke default navigation back
      if (!handled) {
        const navigated = safeBack();
        if (!navigated) {
          if (isWebOS()) {
            webOSExit();
          } else if (isTizen()) {
            tizenExit();
          }
        }
      }
    },
    true // capture phase to intercept before browser history triggers
  );
}

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea") return true;
  if (target.isContentEditable) return true;
  return false;
}
