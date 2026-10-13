// src/utils/devCorsProxy.ts
// Transparent local development CORS proxy for desktop browsers.
// When testing the app in Chrome/Edge on localhost:8081, third-party IPTV servers
// reject browser cross-origin requests.
// This intercepts requests on localhost and routes them through Metro's local proxy.
// On physical LG webOS TVs (.ipk) or native Android, requests are sent directly.

import axios from "axios";
import { Platform } from "react-native";

let isDevProxyInitialized = false;

export function initDevCorsProxy(): void {
  if (Platform.OS !== "web" || typeof window === "undefined" || isDevProxyInitialized) {
    return;
  }
  isDevProxyInitialized = true;

  const hostname = window.location.hostname;
  const isLocalhost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".local");

  // Packaged webOS apps run under file:// or webOS origin, never localhost
  if (!isLocalhost) {
    return;
  }

  console.log("[DevCorsProxy] Local browser detected. Bypassing browser CORS via Metro dev proxy.");

  axios.interceptors.request.use((config) => {
    if (
      config.url &&
      config.url.startsWith("http") &&
      !config.url.includes("/__dev_proxy?url=")
    ) {
      const originalUrl = config.url;
      const proxyBase = `${window.location.protocol}//${window.location.host}`;
      config.url = `${proxyBase}/__dev_proxy?url=${encodeURIComponent(originalUrl)}`;
    }
    return config;
  });
}
