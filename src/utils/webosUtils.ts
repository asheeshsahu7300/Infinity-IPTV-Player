// src/utils/webosUtils.ts
// Utility functions for LG webOS TV detection, lifecycle, and system capabilities.

import { Platform } from "react-native";

export interface WebOSDeviceInfo {
  modelName?: string;
  version?: string;
  versionMajor?: number;
  versionMinor?: number;
  versionDot?: number;
  screenResolution?: string;
  uhd?: boolean;
  oled?: boolean;
}

/**
 * Detects if the app is executing inside an LG webOS TV environment.
 * Checks for:
 * 1. navigator.userAgent contains "Web0S" or "webOS"
 * 2. window.PalmSystem or window.webOS global objects
 */
export function isWebOS(): boolean {
  if (Platform.OS !== "web") return false;
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;

  const ua = navigator.userAgent || "";
  if (/Web0S|webOS/i.test(ua)) return true;

  const win = window as any;
  if (typeof win.PalmSystem !== "undefined" || typeof win.webOS !== "undefined") {
    return true;
  }

  return false;
}

/**
 * Returns webOS device and platform information if available.
 */
export function getWebOSDeviceInfo(): WebOSDeviceInfo {
  if (!isWebOS()) {
    return {};
  }

  const win = window as any;
  const ua = navigator.userAgent || "";

  let deviceInfo: WebOSDeviceInfo = {
    screenResolution: `${window.innerWidth}x${window.innerHeight}`,
  };

  try {
    if (win.PalmSystem && win.PalmSystem.deviceInfo) {
      const parsed = typeof win.PalmSystem.deviceInfo === "string"
        ? JSON.parse(win.PalmSystem.deviceInfo)
        : win.PalmSystem.deviceInfo;

      deviceInfo = {
        ...deviceInfo,
        modelName: parsed.modelName || parsed.model,
        version: parsed.version,
        versionMajor: parsed.versionMajor,
        versionMinor: parsed.versionMinor,
        versionDot: parsed.versionDot,
        uhd: parsed.uhd === "true" || parsed.uhd === true,
        oled: parsed.oled === "true" || parsed.oled === true,
      };
    }
  } catch (err) {
    console.warn("[webOS] Failed to parse PalmSystem.deviceInfo:", err);
  }

  // Fallback extraction from User-Agent
  if (!deviceInfo.modelName) {
    const match = ua.match(/Web0S[; ]+(?:Linux\/SmartTV[; ]+)?([^;)]+)/i);
    if (match) {
      deviceInfo.modelName = match[1]?.trim();
    }
  }

  return deviceInfo;
}

/**
 * Cleanly closes the application on LG webOS TV.
 */
export function webOSExit(): void {
  if (!isWebOS()) {
    if (typeof window !== "undefined") {
      window.close?.();
    }
    return;
  }

  const win = window as any;

  try {
    if (win.PalmSystem && typeof win.PalmSystem.platformBack === "function") {
      win.PalmSystem.platformBack([true]);
      return;
    }
  } catch (e) {
    console.warn("[webOS] PalmSystem.platformBack error:", e);
  }

  try {
    if (win.webOS && typeof win.webOS.platformBack === "function") {
      win.webOS.platformBack();
      return;
    }
  } catch (e) {
    console.warn("[webOS] webOS.platformBack error:", e);
  }

  try {
    window.close();
  } catch {}
}

/**
 * Shows a webOS TV system notification toast if supported.
 */
export function webOSToast(message: string): void {
  if (!isWebOS()) {
    console.log("[webOS Toast]:", message);
    return;
  }

  const win = window as any;
  try {
    if (win.webOS && typeof win.webOS.service?.request === "function") {
      win.webOS.service.request("luna://com.webos.notification", {
        method: "createToast",
        parameters: { message },
      });
    }
  } catch (err) {
    console.warn("[webOS] Toast request error:", err);
  }
}

/**
 * Initializes webOS document styles and meta tags:
 * - Disables cursor selection and touch bounce
 * - Enables webOS hardware-accelerated 1080p canvas
 * - Hides desktop scrollbars
 */
export function initWebOS(): void {
  if (Platform.OS !== "web" || typeof document === "undefined") return;

  const styleId = "webos-tv-global-styles";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      html, body, #root {
        width: 100% !important;
        height: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
        background-color: #08080a !important;
        -webkit-user-select: none !important;
        user-select: none !important;
        -webkit-touch-callout: none !important;
        overscroll-behavior: none !important;
        cursor: default;
      }
      *::-webkit-scrollbar {
        display: none !important;
        width: 0 !important;
        height: 0 !important;
      }
      *:focus {
        outline: none !important;
      }
      [data-focusable="true"] {
        outline: none !important;
      }
    `;
    document.head.appendChild(style);
  }
}
