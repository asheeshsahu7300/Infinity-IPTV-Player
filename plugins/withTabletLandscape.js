const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

const { getMainActivity } = AndroidConfig.Manifest;

/**
 * Re-pins the activity to landscape after `@react-native-tvos/config-tv` has
 * removed it.
 *
 * This exists because of a direct conflict between two things we both want.
 * app.json already declares `"orientation": "landscape"`, which Expo writes out
 * as `android:screenOrientation`. But config-tv's `removePortraitOrientation`
 * mod *deletes that attribute outright* — reasonable for a TV, where the
 * activity is landscape regardless, and it is why the committed manifest had no
 * orientation at all. On a tablet the same deletion means the app is free to
 * rotate.
 *
 * Free rotation is not merely cosmetic here. Every screen and `theme/tokens`
 * read `Dimensions.get("window")` **once, at module load**, and size the whole
 * layout off that snapshot; nothing subscribes to dimension changes. Rotating a
 * tablet therefore does not reflow the UI, it leaves it sized for the
 * orientation the JS bundle happened to start in. Pinning the activity is what
 * keeps that snapshot true, and it has to be pinned in the manifest rather than
 * at runtime: the activity must already be landscape before the bundle
 * evaluates, which no `ScreenOrientation.lockAsync` call can be early enough to
 * guarantee.
 *
 * `sensorLandscape` rather than `landscape` so a tablet can be held either way
 * up — both are landscape, so the snapshot stays valid.
 *
 * Phones are the exception and are NOT covered here, because they cannot be:
 * `android:screenOrientation` is one static attribute on one activity and takes
 * no resource qualifier, so there is no manifest way to say landscape on a
 * tablet and portrait on a handset. What this plugin writes is therefore the
 * tablet/TV answer, and `MainActivity.pinHandsetToPortrait` overrides it to
 * portrait on a handset — before `super.onCreate`, so it still lands ahead of
 * the bundle and the snapshot above. Read the two together; neither is the
 * whole rule on its own.
 *
 * MUST be listed **before** `@react-native-tvos/config-tv` in app.json, which
 * reads backwards and is the easy thing to get wrong here. Mod execution is the
 * reverse of array order: `withMod` awaits the newly-registered action and only
 * then calls `nextMod(results)`, so the mod registered *last* runs *first* and
 * the earliest-registered mod is the final writer. Listing this after config-tv
 * looks right, applies cleanly, and silently loses — config-tv then runs second
 * and deletes the attribute again.
 */
const withTabletLandscape = (config, { orientation = 'unspecified' } = {}) =>
  withAndroidManifest(config, (config) => {
    const mainActivity = getMainActivity(config.modResults);
    if (mainActivity?.$) {
      mainActivity.$['android:screenOrientation'] = orientation;
      /**
       * Declared together with the orientation, because the orientation is
       * what makes it necessary.
       *
       * On Android 12+ large screens, an activity that declares a fixed
       * orientation and does not declare itself resizeable is put into
       * compatibility mode: the system hands it a window smaller than the
       * display and fills the remainder with grey letterbox bars. The app
       * looks like it has stopped short of the screen edge, which is exactly
       * what pinning the orientation above produced on a tablet.
       */
      mainActivity.$['android:resizeableActivity'] = 'true';
    }
    return config;
  });

module.exports = withTabletLandscape;
