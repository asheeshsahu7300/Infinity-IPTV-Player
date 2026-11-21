// src/utils/devCorsProxy.ts
import axios from "axios";
import { Platform } from "react-native";

let isDevProxyInitialized = false;

export function initDevCorsProxy(): void {
  if (Platform.OS !== "web" || typeof window === "undefined" || isDevProxyInitialized) {
    return;
  }
  isDevProxyInitialized = true;

  // Set default User-Agent across all axios requests
  try {
    axios.defaults.headers.common["User-Agent"] = "okhttp/3.12.1";
  } catch {}

  // Safely handle benign HTML5 play() promise interruptions (AbortError)
  // Occurs during rapid channel zapping when play() is followed by pause() or new stream load
  if (typeof HTMLMediaElement !== "undefined" && !(HTMLMediaElement.prototype.play as any)?.__isSafePlay) {
    const originalPlay = HTMLMediaElement.prototype.play;
    const safePlay = function (this: HTMLMediaElement, ...args: any[]) {
      const p = (originalPlay as any).apply(this, args);
      if (p && typeof p.catch === "function") {
        return p.catch((err: any) => {
          if (err?.name === "AbortError") {
            // Expected browser interruption when video playback is interrupted by pause() or source load
            return;
          }
          throw err;
        });
      }
      return p;
    };
    (safePlay as any).__isSafePlay = true;
    HTMLMediaElement.prototype.play = safePlay;
  }
}

export function toDevProxyUrl(url: string | null | undefined): string {
  return url || "";
}
