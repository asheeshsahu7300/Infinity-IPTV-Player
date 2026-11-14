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
    "Exit",
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

/**
 * Checks whether the Samsung TV virtual keyboard (IME) is currently visible.
 */
export function isTizenVirtualKeyboardShowing(): boolean {
  if (!isTizen() || typeof document === "undefined") return false;
  const active = document.activeElement;
  if (!active) return false;
  const tag = active.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || (active as HTMLElement).isContentEditable;
}

/**
 * Initializes Samsung Tizen document styles and meta properties:
 * - Locks hardware 1080p canvas
 * - Disables text selection and touch callouts
 * - Hides scrollbars
 * - Pre-registers TV remote keys
 */
export function initTizen(): void {
  if (Platform.OS !== "web" || typeof document === "undefined") return;

  const styleId = "tizen-tv-global-styles";
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
      /* Promote video & UI overlays to dedicated GPU compositing planes for smooth 60fps playback */
      video {
        transform: translate3d(0, 0, 0) !important;
        -webkit-transform: translate3d(0, 0, 0) !important;
        will-change: transform !important;
        backface-visibility: hidden !important;
        -webkit-backface-visibility: hidden !important;
      }
    `;
    document.head.appendChild(style);
  }

  if (isTizen()) {
    registerTizenKeys();
  }
}

/**
 * Returns the appropriate MIME type for Samsung Smart TV video streams.
 */
export function getTizenMediaMimeType(url: string, isLive?: boolean): string {
  if (!url) return "video/mp4";
  const clean = url.split("?")[0].toLowerCase();
  if (clean.endsWith(".m3u8") || clean.includes(".m3u8") || url.toLowerCase().includes(".m3u8")) {
    return "application/vnd.apple.mpegurl";
  }
  if (clean.endsWith(".ts") || clean.includes(".ts") || clean.includes("/ch/") || (isLive && !clean.includes(".mp4"))) {
    return "video/mp2t";
  }
  if (clean.endsWith(".mpd") || clean.includes("mpd")) {
    return "application/dash+xml";
  }
  if (clean.endsWith(".mp4")) return "video/mp4";
  if (clean.endsWith(".mkv")) return "video/x-matroska";
  if (clean.endsWith(".webm")) return "video/webm";
  if (isLive) return "video/mp2t";
  return "video/mp4";
}

/**
 * Ensures at least one valid audio track is enabled on Samsung Smart TV HTMLMediaElement.
 * On Samsung Tizen TV, multi-track IPTV streams often require explicit track enablement
 * to prevent silent playback or hardware decoder stalls.
 */
export function activateTizenAudioTracks(videoEl: HTMLVideoElement): void {
  try {
    const domTracks = (videoEl as any)?.audioTracks;
    if (domTracks && domTracks.length > 0) {
      let hasEnabled = false;
      for (let i = 0; i < domTracks.length; i++) {
        if (domTracks[i].enabled) {
          hasEnabled = true;
          break;
        }
      }
      if (!hasEnabled) {
        // Prefer universal codecs (AAC/MP3/Stereo) to avoid multi-channel stalls
        let targetIdx = 0;
        for (let i = 0; i < domTracks.length; i++) {
          const lbl = String(domTracks[i].label || domTracks[i].language || "").toLowerCase();
          if (lbl.includes("aac") || lbl.includes("mp3") || lbl.includes("stereo") || lbl.includes("pcm")) {
            targetIdx = i;
            break;
          }
        }
        domTracks[targetIdx].enabled = true;
        console.log(`[Tizen Audio] Activated audio track ${targetIdx} on Samsung TV.`);
      }
    }
  } catch (err) {
    console.warn("[Tizen Audio] Track activation notice:", err);
  }
}

/**
 * Configures an HTMLVideoElement for Samsung Smart TV native playback.
 */
export function setupTizenVideoSource(
  videoEl: HTMLVideoElement,
  streamUrl: string,
  isLive?: boolean,
  headers?: Record<string, string>
): void {
  if (!videoEl || !streamUrl) return;
  if (!/^(https?|blob):/i.test(streamUrl.trim())) {
    console.warn("[Tizen Video] Refusing to set non-network stream URL:", streamUrl);
    return;
  }

  // Revoke any previous MSE blob URL and remove direct src
  if (videoEl.src && videoEl.src.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(videoEl.src);
    } catch {}
  }
  videoEl.removeAttribute("src");

  // Remove existing source elements
  while (videoEl.firstChild) {
    videoEl.removeChild(videoEl.firstChild);
  }

  videoEl.preload = "auto";
  videoEl.setAttribute("playsinline", "true");
  videoEl.setAttribute("webkit-playsinline", "true");

  const mimeType = getTizenMediaMimeType(streamUrl, isLive);
  const source = document.createElement("source");
  source.src = streamUrl;
  source.type = mimeType;

  videoEl.appendChild(source);
  // For progressive VOD containers (MP4 / WebM / MKV), direct src allows hardware seek pipelines
  if (!isLive && (mimeType === "video/mp4" || mimeType === "video/webm" || mimeType === "video/x-matroska")) {
    videoEl.src = streamUrl;
  }
  videoEl.load();

  const onMetadataLoaded = () => {
    activateTizenAudioTracks(videoEl);
  };
  videoEl.addEventListener("loadedmetadata", onMetadataLoaded, { once: true });
  videoEl.addEventListener("canplay", onMetadataLoaded, { once: true });
}


