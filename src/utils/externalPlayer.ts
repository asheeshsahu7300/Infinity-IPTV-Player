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
 *
 * 4. Guaranteed state reset:
 *    PlaybackState, the AppState subscription, and the resume-on-cold-start marker are
 *    always reset via a single resetState() path — whether the user actually left the
 *    app (AppState "active" transition) or every launch attempt failed and the app never
 *    backgrounded at all (in which case the AppState listener would otherwise never fire).
 */

import { Platform, AppState, AppStateStatus, Alert } from "react-native";
import * as IntentLauncher from "expo-intent-launcher";
import * as Linking from "expo-linking";
import { PlaybackState } from "../services/PlaybackState";
import { safeStorage } from "../services/safeStorage";

// On real Android TV devices, startActivity() must be called with FLAG_ACTIVITY_NEW_TASK (0x10000000).
// However, to prevent the "Back" button from exiting to the TV Home Screen (a known Android TV bug
// with singleTask activities), we also combine it with FLAG_ACTIVITY_SINGLE_TOP (0x20000000).
// 0x10000000 | 0x20000000 = 805306368.
const INTENT_FLAGS = 805306368; // FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_SINGLE_TOP

const RESUME_STATE_KEY = "resume_player_state";

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
  /** The content type (e.g. "vod", "series", "live") */
  type?: string;
  /** The unique ID of the content being played */
  contentId?: string;
  /** Command used to fetch stream url if applicable */
  cmd?: string;
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
  type = "vod",
  contentId,
  cmd,
  onReturn,
}: LaunchExternalPlayerOptions): () => void {
  PlaybackState.setActive(true);

  // Persist a lightweight "resume" marker. If Android kills this app's process
  // while the external player is in the foreground, this marker allows the app
  // to boot straight back into the player upon cold start.
  safeStorage.setItem(RESUME_STATE_KEY, JSON.stringify({
    url,
    title,
    type,
    contentId,
    cmd,
    timestamp: Date.now(),
  })).catch(() => { });

  let subscription: ReturnType<typeof AppState.addEventListener> | null = null;
  let hasReturned = false;

  // Single source of truth for "we're done with this launch attempt" — called
  // whether the user actually left and came back, or every fallback failed and
  // the app never backgrounded in the first place. Idempotent via hasReturned.
  const resetState = (shouldFireOnReturn: boolean) => {
    if (hasReturned) return;
    hasReturned = true;

    PlaybackState.setActive(false);
    safeStorage.removeItem(RESUME_STATE_KEY).catch(() => { });

    subscription?.remove();
    subscription = null;

    if (shouldFireOnReturn && onReturn) {
      setTimeout(onReturn, 300);
    }
  };

  const cleanup = () => {
    subscription?.remove();
    subscription = null;
  };

  // Watch for the app returning to foreground after user closes external player
  subscription = AppState.addEventListener(
    "change",
    (nextState: AppStateStatus) => {
      if (nextState === "active" && !hasReturned) {
        resetState(true);
      }
    }
  );

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
        // fall through to next fallback
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
        // fall through to next fallback
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
        // fall through to next fallback
      }

      // 5. Fallback: Linking openURL
      try {
        const canOpen = await Linking.canOpenURL(url);
        if (canOpen) {
          await Linking.openURL(url);
          return;
        }
      } catch (e) {
        // fall through to terminal alert
      }

      // 6. No player found anywhere — the app never actually backgrounded, so the
      // AppState "active" listener above will never fire. Without this explicit
      // reset, PlaybackState would stay stuck "active", the resume marker would
      // stay in storage indefinitely, and the AppState subscription would leak.
      resetState(false);

      Alert.alert(
        "External Player Not Found",
        "No compatible video player app (such as VLC, MX Player, or Just Player) was found on your device.\n\nPlease install one from the app store or use the internal player.",
        [{ text: "OK" }]
      );
    })();
  } else {
    Linking.openURL(url).catch(() => {
      // Same reasoning as the Android terminal case: if openURL itself throws,
      // the app never left the foreground, so AppState will never transition
      // and reset the state for us.
      resetState(false);
      Alert.alert("Playback Error", "Could not open external player on this device.");
    });
  }

  return cleanup;
}