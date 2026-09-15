const { withMainActivity } = require('expo/config-plugins');

/**
 * Re-adds the immersive-mode and key-event handling that `MainActivity` needs
 * but `expo prebuild` does not generate.
 *
 * All of this was previously hand-written straight into the generated
 * `MainActivity.kt` and survived only because nobody re-ran prebuild. The SDK
 * 57 upgrade regenerates the file from the React Native 0.86 template, which
 * would have dropped every line of it — silently, because none of it is
 * load-bearing at compile time. It is a mod for the same reason
 * `withHandsetPortrait` is: anything that has to outlive a regeneration has to
 * be one.
 *
 * Three unrelated things live here because they share one target file:
 *
 * IMMERSIVE MODE (`hideSystemUI`) — the **navigation** bar is hidden for the
 * life of the activity. It is re-applied from `onResume` and
 * `onWindowFocusChanged` rather than set once, because Android restores the
 * bars whenever the window loses and regains focus: returning from the system
 * TV settings panel, from an external player, or from a PiP transition all put
 * them back. Both the `WindowCompat` path and the deprecated
 * `systemUiVisibility` path are set, and each is wrapped separately, because
 * the older STB firmware this app targets does not reliably honour the former.
 *
 * It hid the **status** bar too until the app was asked to show one. That is
 * why this is `navigationBars()` and not `systemBars()`, and why the two
 * FULLSCREEN flags are absent from the legacy path: those are the status bar's
 * half of the pair. Re-adding either takes the status bar back off the whole
 * app, and — because this runs on every focus change — no amount of
 * `StatusBar.setHidden(false)` in JS would win it back.
 *
 * The status bar is now `expo-status-bar`'s to control, which is what lets
 * `app/player.tsx` hide it for itself and restore it on the way out. An Android
 * TV box has no status bar to begin with, so nothing here changes on a box.
 *
 * The function keeps the name `hideSystemUI` deliberately: `MARKER` below
 * greps for it to decide whether the block is already injected, and renaming it
 * would make a prebuild over an already-patched file inject a second copy.
 *
 * BACK AT ROOT (`invokeDefaultOnBackPressed`) — moves the task to the
 * background instead of finishing the activity. Finishing it tears down the
 * React instance, so returning to the app pays a cold start and loses the
 * loaded portal; `moveTaskToBack` keeps it warm. Falls through to the default
 * only if the move is refused.
 *
 * That one REPLACES a template implementation rather than adding to it. The
 * React Native 0.86 template emits its own `invokeDefaultOnBackPressed`, which
 * only moves the task to the back on Android R and below and defers to the
 * platform from S onwards. Appending ours next to it is a "conflicting
 * overloads" compile error, so the existing function is cut out first. Ours
 * applies on every API level on purpose: the Android S behaviour it replaces
 * finishes the activity, which is exactly the cold start being avoided here,
 * and it is most costly on the TV boxes where returning from an external
 * player is routine.
 *
 * KEY EVENT GUARDS (`onKeyDown` / `onKeyUp` / `onKeyMultiple`) — the superclass
 * implementations throw on some STB remotes that deliver key codes React
 * Native's Android TV input helper does not map. An uncaught throw here kills
 * the activity, so each is wrapped and reports the event as unhandled instead.
 * This is NOT a `dispatchKeyEvent` override; see the header of
 * `src/tv/stbKeys.ts` for why that specific approach was tried and removed.
 */

const MARKER = 'hideSystemUI';

const METHODS = `
  /**
   * Injected by plugins/withImmersiveMainActivity.js — edit the plugin, not
   * this file, or the next prebuild will drop the change.
   */
  override fun onResume() {
    super.onResume()
    hideSystemUI()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) {
      hideSystemUI()
    }
  }

  private fun hideSystemUI() {
    try {
      androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window, false)
      val controller = androidx.core.view.WindowCompat.getInsetsController(window, window.decorView)
      controller.systemBarsBehavior = androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      controller.hide(androidx.core.view.WindowInsetsCompat.Type.navigationBars())
    } catch (e: Exception) {}

    try {
      @Suppress("DEPRECATION")
      window.decorView.systemUiVisibility = (
        android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
          or android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
          or android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
          or android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
      )
    } catch (e: Exception) {}
  }

  override fun onKeyDown(keyCode: Int, event: android.view.KeyEvent?): Boolean {
    return try {
      super.onKeyDown(keyCode, event)
    } catch (e: Exception) {
      false
    }
  }

  override fun onKeyUp(keyCode: Int, event: android.view.KeyEvent?): Boolean {
    return try {
      super.onKeyUp(keyCode, event)
    } catch (e: Exception) {
      false
    }
  }

  override fun onKeyMultiple(keyCode: Int, repeatCount: Int, event: android.view.KeyEvent?): Boolean {
    return try {
      super.onKeyMultiple(keyCode, repeatCount, event)
    } catch (e: Exception) {
      false
    }
  }
`;

const BACK_SIGNATURE = 'override fun invokeDefaultOnBackPressed()';

const BACK_OVERRIDE = `  /**
   * Move the task to the background instead of finishing MainActivity when
   * back is pressed at root level, so the React instance survives. Injected by
   * plugins/withImmersiveMainActivity.js, replacing the template's API-gated
   * version — edit the plugin, not this file.
   */
  ${BACK_SIGNATURE} {
    if (!moveTaskToBack(true)) {
      super.invokeDefaultOnBackPressed()
    }
  }`;

/**
 * Cuts the declaration starting at `signature` — and the KDoc block directly
 * above it, if any — out of `src`, putting `replacement` in its place. Returns
 * null when the signature is absent, so the caller can fall back to appending.
 *
 * Brace counting is enough here because the bodies involved are template code
 * with no braces inside strings or comments.
 */
const replaceDeclaration = (src, signature, replacement) => {
  const start = src.indexOf(signature);
  if (start === -1) return null;

  let depth = 0;
  let end = src.indexOf('{', start);
  if (end === -1) return null;
  for (; end < src.length; end++) {
    if (src[end] === '{') depth++;
    else if (src[end] === '}' && --depth === 0) {
      end++;
      break;
    }
  }

  // Cut from the start of the signature's own line so the replacement supplies
  // the indentation, and take the doc comment with it so the replacement's own
  // comment is the only description left behind.
  const preceding = src.slice(0, start);
  let from = preceding.lastIndexOf('\n', start) + 1;
  const docStart = preceding.lastIndexOf('/**');
  if (docStart !== -1 && preceding.slice(docStart).trimEnd().endsWith('*/')) {
    from = preceding.lastIndexOf('\n', docStart) + 1;
  }

  return src.slice(0, from) + replacement + src.slice(end);
};

/**
 * The string surgery, separated from the plugin wrapper so it can be exercised
 * directly against a real `MainActivity.kt` instead of only through a prebuild.
 * Returns the contents unchanged if the methods are already present.
 */
const injectImmersiveMode = (contents) => {
  // Idempotent: prebuild can run repeatedly over an already-modified file.
  if (contents.includes(MARKER)) return contents;

  // The first paint has to already be immersive, so this goes immediately after
  // the React instance is created rather than in onResume alone — onResume
  // fires late enough that the bars are briefly visible.
  const superOnCreate = /^(\s*)(super\.onCreate\((?:null|savedInstanceState)\))$/m;
  if (!superOnCreate.test(contents)) {
    throw new Error(
      'withImmersiveMainActivity: could not find super.onCreate to hook the immersive call onto.'
    );
  }
  let src = contents.replace(superOnCreate, `$1$2\n$1${MARKER}()`);

  // Method bodies before the class's closing brace.
  const lastBrace = src.lastIndexOf('}');
  src = src.slice(0, lastBrace) + METHODS + src.slice(lastBrace);

  // The back override is a replacement, not an addition — see the header. Fall
  // back to appending if a future template stops emitting one.
  const replaced = replaceDeclaration(src, BACK_SIGNATURE, BACK_OVERRIDE);
  if (replaced) return replaced;

  const closing = src.lastIndexOf('}');
  return src.slice(0, closing) + `\n${BACK_OVERRIDE}\n` + src.slice(closing);
};

const withImmersiveMainActivity = (config) =>
  withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error(
        'withImmersiveMainActivity: MainActivity is not Kotlin; the injected source would not compile.'
      );
    }
    cfg.modResults.contents = injectImmersiveMode(cfg.modResults.contents);
    return cfg;
  });

module.exports = withImmersiveMainActivity;
module.exports.injectImmersiveMode = injectImmersiveMode;
