// src/utils/backHandlerPolyfill.ts
// Polyfills React Native BackHandler for Web & LG webOS TV.
// Listens to webOS Remote Back (keyCode 461), Escape (27), and Backspace (8).
// Dispatches to BackHandler listeners in LIFO order and falls back to safeBack() or webOSExit().

import { Platform, BackHandler } from "react-native";
import { safeBack } from "../services/safeNavigation";
import { webOSExit, isWebOS } from "./webosUtils";

type BackListener = () => boolean | null | undefined | void;

const listeners: BackListener[] = [];
let isPolyfillInitialized = false;

export function initBackHandlerPolyfill(): void {
  if (Platform.OS !== "web" || typeof window === "undefined" || isPolyfillInitialized) {
    return;
  }
  isPolyfillInitialized = true;

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
    } else if (originalExitApp) {
      originalExitApp();
    }
  };

  // Attach global keyboard listener for webOS Back button
  window.addEventListener(
    "keydown",
    (event: KeyboardEvent) => {
      // 461: webOS Remote Back
      // 27: Escape
      // 8: Backspace (only when not typing in an input or textarea)
      const isBackKey =
        event.keyCode === 461 ||
        event.key === "Back" ||
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
        if (!navigated && isWebOS()) {
          webOSExit();
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
