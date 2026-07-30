/**
 * externalPlayer.ts
 *
 * Centralised utility for launching an external video player (VLC, MX Player,
 * etc.) on Android TV or mobile.
 *
 * Root causes fixed vs. the previous inline implementation:
 *
 * 1. Wrong intent flags
 *    The old code used `flags: 1` (FLAG_GRANT_READ_URI_PERMISSION) which is
 *    meaningless for http:// stream URLs and doesn't help with activity
 *    routing. We now use FLAG_ACTIVITY_NEW_TASK (0x10000000) so VLC launches
 *    as a top-level activity that can be independently closed.
 *
 * 2. Hanging `await startActivityAsync`
 *    `startActivityAsync` resolves only when the launched Activity calls
 *    setResult() and finishes. VLC (and most media players) simply call
 *    finish() without setResult(), so the promise NEVER resolves — leaving the
 *    caller suspended and the UI blocked.
 *    Fix: fire the intent without awaiting it, then use an AppState listener
 *    so we can run optional cleanup / focus-restore logic when the user returns
 *    to the app.
 *
 * 3. Optional title extra
 *    VLC reads the "title" extra to display a user-friendly stream name in its
 *    Now Playing screen.
 */

import { Platform, AppState, AppStateStatus } from "react-native";
import * as IntentLauncher from "expo-intent-launcher";
import * as Linking from "expo-linking";

// Intent flag to bring calling app task back to front when external activity finishes
const FLAG_ACTIVITY_CLEAR_TOP = 0x04000000;
const FLAG_ACTIVITY_SINGLE_TOP = 0x20000000;

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
 * On Android it fires an ACTION_VIEW intent.
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

  // Watch for the app coming back to the foreground (user closes external player).
  subscription = AppState.addEventListener(
    "change",
    (nextState: AppStateStatus) => {
      if (nextState === "active" && !hasReturned) {
        hasReturned = true;
        cleanup();
        if (onReturn) {
          setTimeout(onReturn, 200);
        }
      }
    }
  );

  if (Platform.OS === "android") {
    // Fire-and-forget: launch external player activity over current app stack
    // without NEW_TASK isolation so pressing BACK in VLC returns directly to iptv-hub.
    const intentFlags = FLAG_ACTIVITY_CLEAR_TOP | FLAG_ACTIVITY_SINGLE_TOP;

    IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
      data: url,
      type: "video/*",
      flags: intentFlags,
      packageName: "org.videolan.vlc",
      extra: title ? { title } : undefined,
    } as any).catch(() => {
      // 2. Fallback: launch generic video view chooser intent
      return IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: url,
        type: "video/*",
        flags: intentFlags,
        extra: title ? { title } : undefined,
      } as any);
    }).catch(() => {
      // 3. Fallback: standard URL linking
      Linking.openURL(url).catch(() => {});
    });
  } else {
    Linking.openURL(url).catch(() => {});
  }

  return cleanup;
}
