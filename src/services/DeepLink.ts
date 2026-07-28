// src/services/DeepLink.ts
// Captures the URL the app was opened with so it can be replayed after the
// store has hydrated. Without this, a cold start from a deep link races the
// boot redirect in app/index.tsx and the link is silently dropped.

import * as Linking from "expo-linking";

export interface DeepLinkTarget {
  pathname: string;
  params: Record<string, string>;
}

/** Routes a deep link is allowed to open. Anything else falls back to boot. */
const ALLOWED_ROUTES = new Set([
  "dashboard",
  "live-tv",
  "vod",
  "series",
  "series-details",
  "search",
  "settings",
  "portals",
  "add-portal",
  "player",
]);

let pending: DeepLinkTarget | null = null;
let captured = false;

export function parseDeepLink(url: string | null): DeepLinkTarget | null {
  if (!url) return null;

  try {
    const { path, queryParams } = Linking.parse(url);
    const route = (path || "").replace(/^\/+|\/+$/g, "");
    if (!route || !ALLOWED_ROUTES.has(route)) return null;

    const params: Record<string, string> = {};
    Object.entries(queryParams ?? {}).forEach(([key, value]) => {
      if (value == null) return;
      params[key] = Array.isArray(value) ? String(value[0]) : String(value);
    });

    // /player is only meaningful with something to play.
    if (route === "player" && !params.url) return null;

    return { pathname: `/${route}`, params };
  } catch {
    return null;
  }
}

export const DeepLink = {
  /** Reads the launch URL once. Safe to call repeatedly. */
  async capture(): Promise<void> {
    if (captured) return;
    captured = true;
    try {
      pending = parseDeepLink(await Linking.getInitialURL());
    } catch {
      pending = null;
    }
  },

  /** Stores a link that arrived while the app was already running. */
  push(url: string) {
    const target = parseDeepLink(url);
    if (target) pending = target;
  },

  /** Returns the pending target and clears it, so it is replayed only once. */
  consume(): DeepLinkTarget | null {
    const target = pending;
    pending = null;
    return target;
  },

  get hasPending(): boolean {
    return pending !== null;
  },
};

export default DeepLink;
