const { withDangerousMod } = require('expo/config-plugins');
const path = require('path');
const fs = require('fs');

/**
 * Writes the transparent `splashscreen_logo` drawable that `expo-splash-screen`
 * references but does not create.
 *
 * WHY IT IS NEEDED: `withAndroidSplashStyles` writes
 * `<item name="windowSplashScreenAnimatedIcon">@drawable/splashscreen_logo</item>`
 * into `styles.xml` unconditionally, but `withAndroidSplashImages` only
 * produces that drawable when the plugin is given an `image`. This project
 * deliberately configures only a `backgroundColor` — the visible splash is the
 * animated one in `app/_layout.tsx`, and the native window is meant to be a
 * plain black hold behind it. With no image the reference therefore dangles and
 * `processReleaseResources` fails with "resource drawable/splashscreen_logo not
 * found". SDK 54 papered over the same gap by pointing the style at a
 * `splashscreen_transparent` vector; SDK 57 dropped that name but kept the
 * reference, so the placeholder has to come from here.
 *
 * A 1dp fully-transparent vector is what SDK 54 shipped, and reproducing it
 * keeps the launch appearance byte-for-byte identical: background colour only,
 * no icon, no flash of a logo before the JS splash mounts.
 *
 * ORDERING: this MUST be listed **before** `expo-splash-screen` in app.json.
 * `setSplashImageDrawablesAsync` begins by deleting every known splash drawable
 * path — `drawable/splashscreen_logo.xml` included — so a mod that runs before
 * it is simply erased. Mod execution is the reverse of array order (see the
 * header of `withTabletLandscape` for the mechanism), which makes the
 * earliest-listed plugin the final writer.
 */

const DRAWABLE = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="1dp"
    android:height="1dp"
    android:viewportWidth="1"
    android:viewportHeight="1">
  <path
      android:fillColor="#00000000"
      android:pathData="M0,0h1v1h-1z"/>
</vector>
`;

const withTransparentSplashIcon = (config) =>
  withDangerousMod(config, [
    'android',
    (cfg) => {
      const drawableDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app/src/main/res/drawable'
      );
      fs.mkdirSync(drawableDir, { recursive: true });
      fs.writeFileSync(path.join(drawableDir, 'splashscreen_logo.xml'), DRAWABLE);
      return cfg;
    },
  ]);

module.exports = withTransparentSplashIcon;
