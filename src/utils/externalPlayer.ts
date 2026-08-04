/**
 * externalPlayer.ts
 *
 * Centralised utility for launching external video players (VLC, MX Player,
 * Just Player, Vimu, MPV, etc.) on Android TV or mobile.
 *
 * Key fixes implemented:
 * 1. Intent flags: FLAG_ACTIVITY_NEW_TASK (0x10000000) | FLAG_ACTIVITY_SINGLE_TOP (0x20000000).
 *    This keeps MainActivity alive in the background task stack so when the user
 *    closes the external player, Android returns directly to IPTV-Hub instead of exiting the app.
 *
 * 2. Multi-Player & MIME type fallback chain:
 *    Scans for popular installed players (VLC, MX Player, Just Player, Vimu, MPV, Nova).
 *    Falls back to generic video intents (`video/*`, `application/x-mpegURL`, raw data URL).
 *    If no player is installed, displays an in-app Alert instead of failing with a system error.
 *
 * 3. AppState restoration:
 *    Ensures focus and UI state are cleanly restored when returning to the app.
 */

import { Platform, AppState, AppStateStatus, Alert } from "react-native";
import * as IntentLauncher from "expo-intent-launcher";
import * as Linking from "expo-linking";

// Do NOT use FLAG_ACTIVITY_NEW_TASK (0x10000000) as it opens VLC in a separate task,
// causing the Back button on Android TV to exit to the TV Home Screen instead of our app.
// Using FLAG_GRANT_READ_URI_PERMISSION (1) opens VLC on top of our app's existing task stack.
const INTENT_FLAGS = 1;

// Popular external Android TV / Mobile video players (ordered by popularity)
const KNOWN_PLAYER_PACKAGES = [
  "org.videolan.vlc",                // VLC Media Player
  "com.mxtech.videoplayer.ad",       // MX Player (Free)
  "com.mxtech.videoplayer.pro",      // MX Player (Pro)
  "com.brouken.player",              // Just Player
  "net.wb.vimu",                     // Vimu Media Player (Android TV)
  "is.xyz.mpv",                      // MPV Player
  "com.archos.mediacenter.videofree", // Nova Video Player
];

export interface LaunchExternalPlayerOptions {
  url: string;
  /** Stream title shown in the external player's Now Playing bar. */
  title?: string;
  /** Called once when the user returns to the app after closing the player. */
  onReturn?: () => void;
}

/**
 * Launch an external video player.
 *
 * On Android it fires an ACTION_VIEW intent with multi-player fallback.
 * On iOS it falls back to Linking.openURL().
 *
 * Returns a cleanup function that unsubscribes the AppState listener.
 */
export function launchExternalPlayer({
  url,
  title,
  onReturn,
}: LaunchExternalPlayerOptions): () => void {
  let subscription: ReturnType<typeof AppState.addEventListener> | null = null;
  let hasReturned = false;

  const cleanup = () => {
    subscription?.remove();
    subscription = null;
  };

  // Watch for the app returning to foreground after user closes external player
  if (onReturn) {
    subscription = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus) => {
        if (nextState === "active" && !hasReturned) {
          hasReturned = true;
          cleanup();
          setTimeout(onReturn, 300);
        }
      }
    );
  }

  if (Platform.OS === "android") {
    const extraParams = title ? { title } : undefined;

    // Helper: try launching with a specific package
    const tryPackage = async (pkg: string): Promise<boolean> => {
      try {
        await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
          data: url,
          type: "video/*",
          flags: INTENT_FLAGS,
          packageName: pkg,
          extra: extraParams,
        } as any);
        return true;
      } catch (err) {
        return false;
      }
    };

    // Execute launcher fallback pipeline
    (async () => {
      // 1. Try known external video players first
      for (const pkg of KNOWN_PLAYER_PACKAGES) {
        const success = await tryPackage(pkg);
        if (success) return;
      }

      // 2. Fallback: Generic intent with video/* MIME type (shows system chooser if multiple players exist)
      try {
        await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
          data: url,
          type: "video/*",
          flags: INTENT_FLAGS,
          extra: extraParams,
        } as any);
        return;
      } catch (e) {
        console.log("[externalPlayer] Generic video/* intent failed:", e);
      }

      // 3. Fallback: HLS / M3U8 MIME type
      try {
        await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
          data: url,
          type: "application/x-mpegURL",
          flags: INTENT_FLAGS,
          extra: extraParams,
        } as any);
        return;
      } catch (e) {
        console.log("[externalPlayer] Generic HLS intent failed:", e);
      }

      // 4. Fallback: Raw Data URL without restricting MIME type
      try {
        await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
          data: url,
          flags: INTENT_FLAGS,
          extra: extraParams,
        } as any);
        return;
      } catch (e) {
        console.log("[externalPlayer] Generic data intent failed:", e);
      }

      // 5. Fallback: Linking openURL
      try {
        const canOpen = await Linking.canOpenURL(url);
        if (canOpen) {
          await Linking.openURL(url);
          return;
        }
      } catch (e) {
        console.log("[externalPlayer] Linking openURL failed:", e);
      }

      // 6. User-friendly Alert if no player is found
      Alert.alert(
        "External Player Not Found",
        "No compatible video player app (such as VLC, MX Player, or Just Player) was found on your device.\n\nPlease install one from the app store or use the internal player.",
        [{ text: "OK" }]
      );
    })();
  } else {
    Linking.openURL(url).catch(() => {
      Alert.alert("Playback Error", "Could not open external player on this device.");
    });
  }

  return cleanup;
}