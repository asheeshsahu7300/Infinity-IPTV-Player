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
 * 2. MIME type fallback chain:
 *    Fires one implicit ACTION_VIEW and lets Android pick or offer a chooser,
 *    falling back through `video/*`, `application/x-mpegURL` and a bare data URL.
 *    If nothing handles it, displays an in-app Alert instead of a system toast.
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

/**
 * How long to give Android to put a player in front of us before concluding
 * that nothing did. Generous, because a cold-starting player on slow TV
 * hardware can take a moment to take the foreground.
 */
const LAUNCH_GRACE_MS = 1500;

/**
 * There is deliberately no list of player package names here any more.
 *
 * There used to be seven, tried in turn via `packageName`. That did nothing:
 * expo-intent-launcher only sets `intent.component` when `className` is also
 * supplied (see IntentLauncherModule.kt — `params.className?.let { ... }`), so
 * every one of those seven attempts fired the *same* implicit intent. Targeting
 * a package properly would mean hardcoding each player's activity class, which
 * changes between their releases.
 *
 * One implicit intent is also the better behaviour: Android already knows which
 * players are installed and shows a chooser when there is more than one, which
 * beats an app-side popularity ranking that silently prefers VLC.
 */

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

    // Whether anything ever actually took the foreground. This is the only
    // trustworthy success signal — see the comment on `attempt` below.
    let didBackground = false;
    const backgroundWatch = AppState.addEventListener("change", (next) => {
      if (next !== "active") didBackground = true;
    });

    /**
     * Fires one intent and reports whether a player really took over.
     *
     * The obvious test — awaiting `startActivityAsync` and treating a resolved
     * promise as success — is wrong, and was the bug behind Android's
     * "You don't have an app that can do this" toast appearing while the app
     * sat in the foreground believing it had launched something.
     *
     * expo-intent-launcher resolves that promise from `OnActivityResult`. When
     * nothing can handle the intent, Android's resolver shows that toast and
     * hands back RESULT_CANCELED *immediately* — which resolves the promise
     * exactly as a successful launch eventually does. The two are only
     * distinguishable by whether this app actually lost the foreground, so that
     * is what gets checked. On a genuine launch the promise does not settle at
     * all until the viewer comes back, so it cannot be awaited outright either.
     */
    const attempt = async (params: Record<string, unknown>): Promise<boolean> => {
      let rejected = false;

      const launch = IntentLauncher.startActivityAsync(
        "android.intent.action.VIEW",
        params as any
      ).catch(() => {
        rejected = true;
      });

      await Promise.race([
        launch,
        new Promise((resolve) => setTimeout(resolve, LAUNCH_GRACE_MS)),
      ]);

      if (didBackground) return true;
      if (rejected) return false;

      // Resolved or timed out without ever leaving the foreground: the resolver
      // bounced it. Give the next MIME type a turn.
      return false;
    };

    (async () => {
      try {
        // Most players advertise video/*; a chooser appears if several do.
        if (await attempt({ data: url, type: "video/*", flags: INTENT_FLAGS, extra: extraParams })) return;

        // Some HLS-only players register the playlist type instead.
        if (await attempt({ data: url, type: "application/x-mpegURL", flags: INTENT_FLAGS, extra: extraParams })) return;

        // Last resort: no MIME type, letting the player sniff the extension.
        if (await attempt({ data: url, flags: INTENT_FLAGS, extra: extraParams })) return;

        // Nothing took it. Note that Linking.openURL is *not* tried here: the
        // URL is an http stream, so the only thing that would claim it is a
        // browser, which cannot play it and which most TV devices lack — and
        // asking produces the very system toast this is avoiding.
        //
        // The app never backgrounded, so the AppState "active" listener above
        // will never fire. Without this explicit reset PlaybackState would stay
        // stuck "active", the resume marker would linger in storage, and the
        // subscription would leak.
        resetState(false);

        Alert.alert(
          "External Player Not Found",
          "No compatible video player app (such as VLC, MX Player, or Just Player) was found on your device.\n\nPlease install one from the app store or use the internal player.",
          [{ text: "OK" }]
        );
      } finally {
        backgroundWatch.remove();
      }
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