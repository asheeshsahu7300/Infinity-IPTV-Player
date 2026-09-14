const {
  withAndroidStyles,
  withAndroidColors,
  AndroidConfig,
} = require('expo/config-plugins');

/**
 * Paints the Android window itself black, so nothing white can show through.
 *
 * THE BUG: `AppTheme` inherits `Theme.AppCompat.DayNight.NoActionBar` and never
 * set `android:windowBackground`, so the window took the parent's default —
 * which on a device in LIGHT mode is white. Every surface this app draws is
 * near-black, but the window sits *behind* all of them, and any moment the JS
 * surface does not cover it is a white flash: the `slide_from_right` transition
 * between screens briefly exposes it, and so does a screen that
 * `react-native-screens` has created but React has not yet painted.
 *
 * It reproduces only in light mode, which is why it reads as intermittent — the
 * same build on a phone set to dark looks perfect, because there `DayNight`
 * resolves to a near-black window and the flash is invisible against the app.
 *
 * The JS side was already correct and is not the fix: `app/_layout.tsx` sets
 * `#08080a` on its root and the navigator sets `contentStyle`, but neither can
 * paint a window that React does not own yet.
 *
 * `android:colorBackground` goes with it because that is what the framework and
 * the activity transition animations sample when they need a backdrop, and
 * leaving the two disagreeing is how the flash comes back somewhere else.
 *
 * Not `values-night` — the app is dark on every device, whatever the system is
 * set to, so one unconditional value is the honest description.
 */

const WINDOW_BACKGROUND_COLOR = '#000000';
/** Matches `container` in `app/_layout.tsx`, so the seam is invisible. */
const COLOR_NAME = 'activityBackground';

const withDarkWindowBackground = (config) => {
  config = withAndroidColors(config, (cfg) => {
    cfg.modResults = AndroidConfig.Colors.assignColorValue(cfg.modResults, {
      name: COLOR_NAME,
      value: WINDOW_BACKGROUND_COLOR,
    });
    return cfg;
  });

  config = withAndroidStyles(config, (cfg) => {
    for (const name of ['android:windowBackground', 'android:colorBackground']) {
      cfg.modResults = AndroidConfig.Styles.assignStylesValue(cfg.modResults, {
        add: true,
        // `getAppThemeGroup()` and not the `...LightNoActionBarGroup` helper:
        // that one pins `parent` to `Theme.AppCompat.Light.NoActionBar`, and
        // `findResourceGroup` only compares the parent when one is given. This
        // theme's parent is `DayNight`, so the pinned version would match
        // nothing and silently append a second, unused `AppTheme` group.
        parent: AndroidConfig.Styles.getAppThemeGroup(),
        name,
        value: `@color/${COLOR_NAME}`,
      });
    }
    return cfg;
  });

  return config;
};

module.exports = withDarkWindowBackground;
