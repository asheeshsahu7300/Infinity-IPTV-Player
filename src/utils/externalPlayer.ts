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

// Do NOT use FLAG_ACTIVITY_NEW_TASK (0x10000000) as it opens VLC in a separate task,
// causing the Back button on Android to exit to the Home Screen instead of our app.
// Using FLAG_GRANT_READ_URI_PERMISSION (1) opens VLC on top of our app's existing task stack.
const INTENT_FLAGS = 1;

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
 * On Android it fires an ACTION_VIEW intent (fire-and-forget).
 * On iOS it falls back to Linking.openURL().
 *
 * Returns a cleanup function that unsubscribes the AppState listener;
 * call it if the component unmounts before the user returns.
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

  // Watch for the app coming back to the foreground (user closes VLC).
  if (onReturn) {
    subscription = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus) => {
        if (nextState === "active" && !hasReturned) {
          hasReturned = true;
          cleanup();
          // Small delay so the app's own UI has time to re-render before the
          // callback tries to change navigation state.
          setTimeout(onReturn, 300);
        }
      }
    );
  }

  if (Platform.OS === "android") {
    // Fire-and-forget: do NOT await — VLC never resolves the promise.
    // 1. First, attempt to launch VLC directly using its package name (faster, bypasses chooser)
    IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
      data: url,
      type: "video/*",
      flags: INTENT_FLAGS,
      packageName: "org.videolan.vlc",
      // VLC reads this extra as the stream title.
      extra: title ? { title } : undefined,
    } as any).catch((err) => {
      console.log("[externalPlayer] VLC direct package launch failed, trying generic video chooser:", err);
      // 2. Fallback: launch generic video view intent (shows chooser with MX Player, Just Play, etc.)
      return IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: url,
        type: "video/*",
        flags: INTENT_FLAGS,
        extra: title ? { title } : undefined,
      } as any);
    }).catch((err) => {
      // 3. Fallback: use standard URL linking as a last resort
      console.warn("[externalPlayer] Generic intent failed, falling back to Linking:", err);
      Linking.openURL(url).catch(() => {});
    });
  } else {
    Linking.openURL(url).catch(() => {});
  }

  return cleanup;
}
