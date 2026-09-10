const { withMainActivity } = require('expo/config-plugins');

/**
 * Pins handsets to portrait from `MainActivity.onCreate`.
 *
 * This exists as a plugin, rather than as an edit to the generated
 * `MainActivity.kt`, because it was written as an edit once and `expo prebuild`
 * regenerated the file and threw it away — silently, since nothing fails when
 * the pin is missing. It just means phones launch in whatever the manifest
 * says. Anything that has to survive a regeneration has to be a mod.
 *
 * WHY IT CANNOT BE THE MANIFEST: `android:screenOrientation` is a single static
 * attribute on a single activity and takes no resource qualifier, so there is
 * no way to declare "landscape on a tablet, portrait on a handset". The
 * manifest carries the tablet/TV answer (see `withTabletLandscape`) and this
 * overrides it for handsets.
 *
 * WHY IT CANNOT BE JAVASCRIPT: `theme/tokens` and every screen read
 * `Dimensions.get("window")` once as the module evaluates and size the layout
 * from that snapshot. The activity therefore has to already be portrait before
 * the bundle runs, and no `ScreenOrientation.lockAsync` can be that early — by
 * the time JS can call it the snapshot is taken. Setting it before
 * `super.onCreate` puts it ahead of the React instance and the bundle load.
 * `configChanges` already lists `orientation|screenSize`, so the change is
 * delivered rather than restarting the activity.
 *
 * `smallestScreenWidthDp < 480` must stay equal to
 * `phoneUtils.PHONE_MAX_SHORTEST_SIDE`, so the native tier and the JS tier
 * cannot disagree about what a phone is. It is 480 rather than Android's usual
 * 600 because a 1920x1200 tablet at ~2.25 density reports 533dp and was being
 * pinned upright as a handset; see the reasoning in `phoneUtils`. The
 * television check reads
 * `UiModeManager.currentModeType`, which is exactly what react-native-tvos
 * reads for `Platform.isTV` — a box can report a small `swdp` and must never be
 * turned upright.
 */

const MARKER = 'pinHandsetToPortrait';

const IMPORTS = [
  'import android.app.UiModeManager',
  'import android.content.Context',
  'import android.content.pm.ActivityInfo',
  'import android.content.res.Configuration',
];

const METHOD = `
  /**
   * Strictly upright on a handset. Injected by plugins/withHandsetPortrait.js —
   * edit the plugin, not this file, or the next prebuild will drop the change.
   */
  private fun ${MARKER}() {
    try {
      val uiModeManager = getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
      val isTelevision =
        uiModeManager?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION
      val isHandset = resources.configuration.smallestScreenWidthDp < 480
      if (!isTelevision && isHandset) {
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
      }
    } catch (e: Exception) {}
  }
`;

/**
 * The string surgery, separated from the plugin wrapper so it can be exercised
 * directly against a real `MainActivity.kt` instead of only through a prebuild.
 * Returns the contents unchanged if the pin is already present.
 */
const injectHandsetPortrait = (contents) => {
  // Idempotent: prebuild can run repeatedly over an already-modified file.
  if (contents.includes(MARKER)) return contents;

  let src = contents;

  for (const imp of IMPORTS) {
    if (!src.includes(imp)) {
      src = src.replace(/^(import android\.os\.Bundle)$/m, `${imp}\n$1`);
    }
  }

  // First statement of onCreate, so it lands before super.onCreate() starts
  // the React instance.
  const onCreate = /(override fun onCreate\(savedInstanceState: Bundle\?\) \{)/;
  if (!onCreate.test(src)) {
    throw new Error('withHandsetPortrait: could not find onCreate to inject the pin into.');
  }
  src = src.replace(onCreate, `$1\n    ${MARKER}()`);

  // Method body before the class's closing brace.
  const lastBrace = src.lastIndexOf('}');
  return src.slice(0, lastBrace) + METHOD + src.slice(lastBrace);
};

const withHandsetPortrait = (config) =>
  withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error(
        'withHandsetPortrait: MainActivity is not Kotlin; the injected source would not compile.'
      );
    }
    cfg.modResults.contents = injectHandsetPortrait(cfg.modResults.contents);
    return cfg;
  });

module.exports = withHandsetPortrait;
module.exports.injectHandsetPortrait = injectHandsetPortrait;
