// src/utils/tizenUtils.ts
// Utility functions for Samsung Smart TV (Tizen OS) using Samsung Web APIs & Tizen Device API.

import { Platform } from "react-native";

export interface TizenDeviceInfo {
  modelName?: string;
  firmwareVersion?: string;
  duid?: string;
  tizenVersion?: string;
  screenResolution?: string;
  screenWidth?: number;
  screenHeight?: number;
  uhd?: boolean;
  uhd8K?: boolean;
  manufacturer?: string;
}

let cachedDeviceInfo: TizenDeviceInfo | null = null;
let keysRegistered = false;

function getGlobalTizen(): any {
  if (typeof window === "undefined") return null;
  const win = window as any;
  return win.tizen || null;
}

function getGlobalWebapis(): any {
  if (typeof window === "undefined") return null;
  const win = window as any;
  return win.webapis || null;
}

/**
 * Detects if the application is executing inside a Samsung Smart TV (Tizen OS) environment.
 */
export function isTizen(): boolean {
  if (Platform.OS !== "web") return false;
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;

  const win = window as any;
  if (Boolean(win.__TIZEN__)) return true;

  if (typeof win.tizen !== "undefined" || typeof win.webapis !== "undefined") {
    return true;
  }

  const ua = navigator.userAgent || "";
  // Check userAgent for Tizen while guarding against other TV platforms
  if (/Tizen/i.test(ua)) return true;
  if (/SmartTV.*Samsung/i.test(ua) && !/Web0S|webOS/i.test(ua)) return true;

  return false;
}

/**
 * Returns synchronously known Samsung Tizen device information with fallback.
 */
export function getTizenDeviceInfo(): TizenDeviceInfo {
  if (!isTizen()) {
    return {};
  }
  if (cachedDeviceInfo) {
    return cachedDeviceInfo;
  }

  const win = window as any;
  const webapis = getGlobalWebapis();
  const tizen = getGlobalTizen();

  let deviceInfo: TizenDeviceInfo = {
    screenResolution: `${window.innerWidth}x${window.innerHeight}`,
    screenWidth: window.innerWidth,
    screenHeight: window.innerHeight,
    manufacturer: "Samsung",
  };

  try {
    if (webapis && webapis.productinfo) {
      if (typeof webapis.productinfo.getModel === "function") {
        deviceInfo.modelName = webapis.productinfo.getModel();
      }
      if (typeof webapis.productinfo.getFirmware === "function") {
        deviceInfo.firmwareVersion = webapis.productinfo.getFirmware();
      }
      if (typeof webapis.productinfo.getDuid === "function") {
        deviceInfo.duid = webapis.productinfo.getDuid();
      }
      if (typeof webapis.productinfo.isUdPanelSupported === "function") {
        deviceInfo.uhd = webapis.productinfo.isUdPanelSupported();
      }
      if (typeof webapis.productinfo.is8KPanelSupported === "function") {
        deviceInfo.uhd8K = webapis.productinfo.is8KPanelSupported();
      }
    }

    if (tizen && tizen.systeminfo && typeof tizen.systeminfo.getCapability === "function") {
      try {
        deviceInfo.tizenVersion = tizen.systeminfo.getCapability("http://tizen.org/feature/platform.version");
      } catch {}
    }
  } catch (err) {
    console.warn("[TizenUtils] Failed to read full device info:", err);
  }

  cachedDeviceInfo = deviceInfo;
  return deviceInfo;
}

/**
 * Registers essential physical remote control keys with Tizen's tvinputdevice API.
 * By default on Samsung Smart TVs, media keys (Play, Pause, etc.) and color keys
 * are not dispatched to the web app until explicitly registered.
 */
export function registerTizenKeys(): void {
  if (!isTizen() || keysRegistered) return;
  if (typeof window === "undefined") return;

  const tizen = getGlobalTizen();
  if (!tizen || !tizen.tvinputdevice || typeof tizen.tvinputdevice.registerKey !== "function") {
    return;
  }

  const keysToRegister = [
    "MediaPlay",
    "MediaPause",
    "MediaStop",
    "MediaFastForward",
    "MediaRewind",
    "MediaPlayPause",
    "ColorF0Red",
    "ColorF1Green",
    "ColorF2Yellow",
    "ColorF3Blue",
    "ChannelUp",
    "ChannelDown",
    "Info",
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
  ];

  keysToRegister.forEach((keyName) => {
    try {
      tizen.tvinputdevice.registerKey(keyName);
    } catch (e) {
      // Some keys might not be supported on specific TV models; ignore safely
    }
  });

  keysRegistered = true;
  console.log("[TizenUtils] Samsung TV remote keys successfully registered.");
}

/**
 * Gracefully exits the application on Samsung Smart TV.
 */
export function tizenExit(): void {
  if (typeof window === "undefined") return;

  const tizen = getGlobalTizen();
  if (tizen && tizen.application) {
    try {
      tizen.application.getCurrentApplication().exit();
      return;
    } catch (e) {
      console.warn("[TizenUtils] Application exit call failed:", e);
    }
  }

  try {
    window.close();
  } catch {}
}

