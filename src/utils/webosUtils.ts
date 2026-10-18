// src/utils/webosUtils.ts
// Utility functions for LG webOS TV using official webOSTV.js & webOSDev libraries.

import { Platform } from "react-native";

export interface WebOSDeviceInfo {
  modelName?: string;
  version?: string;
  versionMajor?: number;
  versionMinor?: number;
  versionDot?: number;
  sdkVersion?: string;
  screenResolution?: string;
  screenWidth?: number;
  screenHeight?: number;
  uhd?: boolean;
  uhd8K?: boolean;
  oled?: boolean;
  hdr10?: boolean;
  dolbyVision?: boolean;
  dolbyAtmos?: boolean;
  brandName?: string;
  manufacturer?: string;
}

let cachedDeviceInfo: WebOSDeviceInfo | null = null;

function getGlobalWebOS(): any {
  if (typeof window === "undefined") return null;
  const win = window as any;
  if (win.webOS) return win.webOS;
  try {
    const mod = require("webostvjs");
    return mod?.default || mod;
  } catch {
    return null;
  }
}

function getGlobalWebOSDev(): any {
  if (typeof window === "undefined") return null;
  const win = window as any;
  return win.webOSDev || null;
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
 * Returns synchronously known webOS device information with fallback.
 */
export function getWebOSDeviceInfo(): WebOSDeviceInfo {
  if (!isWebOS()) {
    return {};
  }
  if (cachedDeviceInfo) {
    return cachedDeviceInfo;
  }

  const win = window as any;
  const ua = navigator.userAgent || "";

  let deviceInfo: WebOSDeviceInfo = {
    screenResolution: `${window.innerWidth}x${window.innerHeight}`,
    screenWidth: window.innerWidth,
    screenHeight: window.innerHeight,
  };

  try {
    if (win.PalmSystem && win.PalmSystem.deviceInfo) {
      const parsed = typeof win.PalmSystem.deviceInfo === "string"
        ? JSON.parse(win.PalmSystem.deviceInfo)
        : win.PalmSystem.deviceInfo;

      deviceInfo = {
        ...deviceInfo,
        modelName: parsed.modelName || parsed.model,
        version: parsed.version || parsed.platformVersion,
        versionMajor: parsed.versionMajor || parsed.platformVersionMajor,
        versionMinor: parsed.versionMinor || parsed.platformVersionMinor,
        versionDot: parsed.versionDot || parsed.platformVersionDot,
        uhd: parsed.uhd === "true" || parsed.uhd === true,
        oled: parsed.oled === "true" || parsed.oled === true,
        screenWidth: parsed.screenWidth || deviceInfo.screenWidth,
        screenHeight: parsed.screenHeight || deviceInfo.screenHeight,
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

  cachedDeviceInfo = deviceInfo;
  return deviceInfo;
}

/**
 * Asynchronously queries the official webOSTV.js deviceInfo API for full hardware capabilities:
 * OLED, UHD, 8K, HDR10, Dolby Vision, Dolby Atmos, and firmware version.
 */
export function fetchWebOSDeviceInfo(): Promise<WebOSDeviceInfo> {
  return new Promise((resolve) => {
    if (!isWebOS()) {
      resolve({});
      return;
    }

    const webos = getGlobalWebOS();
    if (webos && typeof webos.deviceInfo === "function") {
      try {
        webos.deviceInfo((info: any) => {
          if (info) {
            const enriched: WebOSDeviceInfo = {
              ...getWebOSDeviceInfo(),
              modelName: info.modelName || cachedDeviceInfo?.modelName,
              version: info.version || cachedDeviceInfo?.version,
              versionMajor: info.versionMajor || cachedDeviceInfo?.versionMajor,
              versionMinor: info.versionMinor || cachedDeviceInfo?.versionMinor,
              versionDot: info.versionDot || cachedDeviceInfo?.versionDot,
              sdkVersion: info.sdkVersion,
              uhd: !!info.uhd,
              uhd8K: !!info.uhd8K,
              oled: !!info.oled,
              hdr10: !!info.hdr10,
              dolbyVision: !!info.dolbyVision,
              dolbyAtmos: !!info.dolbyAtmos,
              brandName: info.brandName || "LG",
              manufacturer: info.manufacturer || "LG Electronics",
              screenWidth: info.screenWidth || window.innerWidth,
              screenHeight: info.screenHeight || window.innerHeight,
              screenResolution: `${info.screenWidth || window.innerWidth}x${info.screenHeight || window.innerHeight}`,
            };
            cachedDeviceInfo = enriched;
            resolve(enriched);
            return;
          }
          resolve(getWebOSDeviceInfo());
        });
        return;
      } catch (e) {
        console.warn("[webOSTV.js] deviceInfo call error:", e);
      }
    }
    resolve(getWebOSDeviceInfo());
  });
}

/**
 * Cleanly closes the application using official webOSTV.js platformBack() or PalmSystem.
 */
export function webOSExit(): void {
  if (!isWebOS()) {
    if (typeof window !== "undefined") {
      window.close?.();
    }
    return;
  }

  const webos = getGlobalWebOS();
  if (webos && typeof webos.platformBack === "function") {
    try {
      webos.platformBack();
      return;
    } catch {}
  }

  const win = window as any;
  try {
    if (win.PalmSystem && typeof win.PalmSystem.platformBack === "function") {
      win.PalmSystem.platformBack([true]);
      return;
    }
  } catch {}

  try {
    window.close();
  } catch {}
}

/**
 * Shows a webOS TV system notification toast via webOSTV.js Luna service bus.
 */
export function webOSToast(message: string): void {
  if (!isWebOS()) {
    console.log("[webOS Toast]:", message);
    return;
  }

  const webos = getGlobalWebOS();
  if (webos && typeof webos.service?.request === "function") {
    try {
      webos.service.request("luna://com.webos.notification", {
        method: "createToast",
        parameters: { message },
      });
      return;
    } catch (err) {
      console.warn("[webOSTV.js] Toast request error:", err);
    }
  }

  const win = window as any;
  try {
    if (win.PalmServiceBridge) {
      const bridge = new win.PalmServiceBridge();
      bridge.call("luna://com.webos.notification/createToast", JSON.stringify({ message }));
    }
  } catch {}
}

/**
 * Queries network connection status via official webOSDev.connection library.
 */
export function subscribeWebOSNetwork(callback: (status: any) => void): () => void {
  if (!isWebOS()) return () => {};

  const dev = getGlobalWebOSDev();
  if (dev && dev.connection && typeof dev.connection.getStatus === "function") {
    try {
      dev.connection.getStatus({
        subscribe: true,
        onSuccess: (res: any) => callback(res),
        onFailure: (err: any) => console.warn("[webOSDev] Network status error:", err),
      });
    } catch (e) {
      console.warn("[webOSDev] Connection subscription error:", e);
    }
  }
  return () => {};
}

/**
 * Checks if the webOS virtual onscreen keyboard is currently visible.
 */
export function isWebOSVirtualKeyboardShowing(): boolean {
  if (!isWebOS()) return false;
  const webos = getGlobalWebOS();
  if (webos && webos.keyboard && typeof webos.keyboard.isShowing === "function") {
    try {
      return !!webos.keyboard.isShowing();
    } catch {}
  }
  const win = window as any;
  return !!win.PalmSystem?.isKeyboardVisible;
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

  // Preload hardware info asynchronously
  if (isWebOS()) {
    fetchWebOSDeviceInfo().catch(() => {});
  }
}

/**
 * Returns the appropriate MIME type for LG webOS TV native video pipeline.
 * LG webOS TV automatically binds the HLS hardware media pipeline when
 * 'application/vnd.apple.mpegURL' or 'application/x-mpegURL' is used.
 */
export function getWebOSMediaMimeType(url: string, isLive?: boolean): string {
  if (!url) return "video/mp4";
  const clean = url.split("?")[0].toLowerCase();
  if (clean.endsWith(".ts") || clean.includes(".ts?") || clean.includes("/ch/")) {
    return "video/mp2t";
  }
  if (clean.endsWith(".m3u8") || clean.includes("m3u8")) {
    return "application/vnd.apple.mpegURL";
  }
  if (clean.endsWith(".mp4")) return "video/mp4";
  if (clean.endsWith(".mkv")) return "video/x-matroska";
  if (clean.endsWith(".webm")) return "video/webm";
  if (isLive) return "application/vnd.apple.mpegURL";
  return "video/mp4";
}

/**
 * Converts standard SubRip (.srt) subtitle text into W3C WebVTT (.vtt) format.
 */
export function convertSrtToVtt(srtText: string): string {
  if (!srtText) return "WEBVTT\n\n";
  const normalized = srtText.replace(/\r\n|\r/g, "\n").trim();
  const vttCues = normalized.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  return `WEBVTT\n\n${vttCues}`;
}

/**
 * Ensures at least one audio track is enabled on webOS TV HTMLMediaElement.
 * Per LG webOS TV Developer FAQ, hardware audio decoding does not engage
 * unless an AudioTrack has enabled = true explicitly set.
 */
export function activateWebOSAudioTracks(videoEl: HTMLVideoElement): void {
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
        // If multiple audio tracks exist, prefer universal (AAC/MP3) to avoid AC3/EAC3 hardware limit stalls
        let targetIdx = 0;
        for (let i = 0; i < domTracks.length; i++) {
          const lbl = String(domTracks[i].label || domTracks[i].language || "").toLowerCase();
          if (lbl.includes("aac") || lbl.includes("mp3") || lbl.includes("stereo") || lbl.includes("pcm")) {
            targetIdx = i;
            break;
          }
        }
        domTracks[targetIdx].enabled = true;
      }
    }
  } catch {}
}

/**
 * Builds the official LG webOS mediaOption query string payload for HTML5 video elements.
 * Uses encodeURI (per LG webOS TV specification) and binds mediaTransportType (HLS / URI).
 */
export function createWebOSMediaOption(options?: {
  startTimeMs?: number;
  mimeType?: string;
  isLive?: boolean;
  headers?: Record<string, string>;
}): string {
  const isHls = options?.mimeType === "application/vnd.apple.mpegURL";
  const defaultHeaders: Record<string, string> = {
    "User-Agent": "okhttp/3.12.1",
    "Accept": "*/*",
    "Range": "bytes=0-",
    "Connection": "keep-alive",
    "Icy-MetaData": "1",
  };
  const payload: any = {
    mediaTransportType: isHls ? "HLS" : "URI",
    option: {
      transmission: {
        httpHeader: { ...defaultHeaders, ...(options?.headers || {}) },
      },
    },
    adaptiveStreaming: {
      maxWidth: 3840,
      maxHeight: 2160,
    },
  };
  if (options?.startTimeMs && options.startTimeMs > 0 && !options.isLive) {
    payload.option.transmission.playTime = {
      start: Math.round(options.startTimeMs),
    };
  }
  return encodeURI(JSON.stringify(payload));
}

/**
 * Configures an HTMLVideoElement with official webOS <source> element and mediaOption.
 */
export function setupWebOSVideoSource(
  videoEl: HTMLVideoElement,
  streamUrl: string,
  isLive?: boolean,
  startTimeMs?: number,
  headers?: Record<string, string>
): void {
  if (!videoEl || !streamUrl) return;
  // Ensure streamUrl is absolute HTTP/HTTPS to prevent resolving against local file:///D:/
  if (!/^(https?|blob):/i.test(streamUrl.trim())) {
    console.warn("[webOS Video] Refusing to set non-network stream URL:", streamUrl);
    return;
  }

  // Revoke any previous MSE blob URL and remove direct src so child <source> is evaluated (per W3C spec)
  if (videoEl.src && videoEl.src.startsWith("blob:")) {
    try { URL.revokeObjectURL(videoEl.src); } catch {}
  }
  videoEl.removeAttribute("src");

  // Remove existing source tags
  while (videoEl.firstChild) {
    videoEl.removeChild(videoEl.firstChild);
  }

  const mimeType = getWebOSMediaMimeType(streamUrl, isLive);
  const mediaOpt = createWebOSMediaOption({ startTimeMs, mimeType, isLive, headers });

  const source = document.createElement("source");
  source.src = streamUrl;
  source.type = `${mimeType};mediaOption=${mediaOpt}`;

  videoEl.appendChild(source);
  videoEl.load();

  // WebOS TV audio track auto-activation
  const onMetadataLoaded = () => {
    activateWebOSAudioTracks(videoEl);
  };
  videoEl.addEventListener("loadedmetadata", onMetadataLoaded, { once: true });
  videoEl.addEventListener("canplay", onMetadataLoaded, { once: true });
}

/**
 * Initializes webOS DRM Agent (PlayReady or Widevine) via webOSTV-dev.js.
 */
export async function setupWebOSDrm(drmType: "playready" | "widevine"): Promise<any> {
  if (!isWebOS()) return null;
  const dev = getGlobalWebOSDev();
  if (!dev || typeof dev.drmAgent !== "function") return null;

  try {
    const agent = dev.drmAgent(drmType);
    if (!agent) return null;
    return new Promise((resolve) => {
      agent.load({
        onSuccess: (res: any) => {
          console.log(`[webOS DRM] ${drmType} agent loaded:`, res?.clientId);
          resolve(agent);
        },
        onFailure: (err: any) => {
          console.warn(`[webOS DRM] Failed to load ${drmType} agent:`, err);
          resolve(null);
        },
      });
    });
  } catch (e) {
    console.warn("[webOS DRM] Error creating drmAgent:", e);
    return null;
  }
}
