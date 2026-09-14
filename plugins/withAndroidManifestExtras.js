const { withAndroidManifest } = require('expo/config-plugins');

/**
 * The `AndroidManifest.xml` entries this app needs that `app.json` has no field
 * for and no other plugin generates.
 *
 * Like the rest of `plugins/`, this exists because all of it was hand-written
 * into the generated manifest and would not have survived the prebuild that the
 * SDK 57 upgrade requires.
 *
 * HARDWARE FEATURES — Google Play derives implied `<uses-feature>` requirements
 * from the permissions an app requests, and filters devices on them. Requesting
 * `RECORD_AUDIO` implies `android.hardware.microphone` as REQUIRED, which
 * delists the app from virtually every Android TV box and set-top box, since
 * they have no microphone. Declaring the features explicitly with
 * `required="false"` is the only way to opt back in. `tools:replace` is on each
 * because a dependency's manifest may declare the same feature as required, and
 * the merger fails the build on the conflict rather than picking a side.
 *
 * `@react-native-tvos/config-tv` declares touchscreen, faketouch and leanback
 * but not microphone or screen.portrait, and adds no `tools:replace` — hence
 * this runs after it and fills both gaps. It must therefore stay listed
 * *before* config-tv in app.json; see the header of `withTabletLandscape` for
 * why that ordering is backwards from how it reads.
 *
 * PACKAGE VISIBILITY (`<queries>`) — since Android 11 an app cannot see, or
 * resolve an intent against, packages it has not declared. `externalPlayer.ts`
 * fires a single implicit `ACTION_VIEW` and lets Android show a chooser (see
 * the long comment at its line 49 for why it no longer targets packages by
 * name). Without these declarations `queryIntentActivities` comes back empty on
 * Android 11+, the chooser never appears, and every launch attempt fails the
 * `LAUNCH_GRACE_MS` timeout — so the feature degrades to an in-app alert on
 * exactly the modern devices it is most needed on.
 *
 * Both forms are declared deliberately. The `<intent>` entries cover the
 * implicit dispatch the app actually performs, for any player installed. The
 * `<package>` entries name the players we know about, which is what makes them
 * visible to `getApplicationInfo`-style checks and keeps behaviour identical to
 * the manifest this replaces.
 *
 * CLEARTEXT TRAFFIC — a large share of IPTV portals are plain HTTP, including
 * the stream URLs themselves. Android has blocked cleartext by default since
 * API 28, so without this the app fails against those portals with an opaque
 * network error.
 *
 * LARGE HEAP — channel lists run to tens of thousands of entries, each with a
 * logo, and EPG payloads are parsed whole. `app.json` carried an
 * `android.largeHeap` key for this, but that has never been a field in Expo's
 * config schema (SDK 57's `expo-doctor` is simply the first version to say so)
 * and it was the hand-edited manifest, not the app config, that was actually
 * setting the attribute. Declaring it here is what makes it real.
 *
 * Predictive back is deliberately NOT set here: `android.predictiveBackGestureEnabled`
 * in app.json is the supported route to the same
 * `android:enableOnBackInvokedCallback="false"`. It matters because the app
 * routes every back press through `safeNavigation.safeBack()`, which reads the
 * navigation state to decide between popping, exiting and ignoring a remote's
 * key bounce — a decision the platform's ahead-of-time callback registration
 * cannot express.
 */

const PLAYER_PACKAGES = [
  'org.videolan.vlc',
  'com.mxtech.videoplayer.ad',
  'com.mxtech.videoplayer.pro',
  'com.brouken.player',
  'is.xyz.mpv',
  'net.wb.vimu',
  'com.archos.mediacenter.videofree',
];

/** The MIME types `externalPlayer.ts` walks through on its fallback chain. */
const PLAYER_MIME_TYPES = ['video/*', 'application/x-mpegURL'];

/**
 * Every hardware feature that must be explicitly optional. `microphone` is
 * implied by `RECORD_AUDIO` and `screen.portrait` by a fixed orientation; the
 * other three are the touch features a TV device does not have.
 */
const OPTIONAL_FEATURES = [
  'android.hardware.touchscreen',
  'android.hardware.faketouch',
  'android.software.leanback',
  'android.hardware.microphone',
  'android.hardware.screen.portrait',
];

const attr = (name) => ({ $: { 'android:name': name } });

const viewIntentForMimeType = (mimeType) => ({
  action: [attr('android.intent.action.VIEW')],
  data: [{ $: { 'android:mimeType': mimeType } }],
});

const optionalFeature = (name) => ({
  $: {
    'android:name': name,
    'android:required': 'false',
    'tools:replace': 'android:required',
  },
});

/**
 * The manifest surgery, separated from the plugin wrapper so it can be
 * exercised directly against a parsed manifest. Mutates and returns it.
 */
const addAndroidManifestExtras = (androidManifest) => {
  const manifest = androidManifest.manifest;

  // `tools:` attributes are only legal once the namespace is declared.
  manifest.$ = manifest.$ ?? {};
  manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';

  // config-tv has already declared three of these; take them over rather than
  // duplicating, so each feature appears exactly once with tools:replace on it.
  manifest['uses-feature'] = manifest['uses-feature'] ?? [];
  for (const name of OPTIONAL_FEATURES) {
    const existing = manifest['uses-feature'].find(
      (feature) => feature.$?.['android:name'] === name
    );
    if (existing) {
      // Leave `android:required` as config-tv set it — it honours the plugin's
      // own `androidTVRequired` option, which is not ours to overrule.
      existing.$['tools:replace'] = 'android:required';
    } else {
      manifest['uses-feature'].push(optionalFeature(name));
    }
  }

  // `queries` may already carry the https/BROWSABLE entry Expo generates for
  // deep linking, so merge into it rather than replacing it.
  manifest.queries = manifest.queries ?? [];
  const queries = manifest.queries[0] ?? {};
  if (!manifest.queries.length) manifest.queries.push(queries);

  queries.intent = queries.intent ?? [];
  const declaredMimeTypes = new Set(
    queries.intent.flatMap((intent) =>
      (intent.data ?? []).map((data) => data.$?.['android:mimeType'])
    )
  );
  for (const mimeType of PLAYER_MIME_TYPES) {
    if (!declaredMimeTypes.has(mimeType)) {
      queries.intent.push(viewIntentForMimeType(mimeType));
    }
  }

  queries.package = queries.package ?? [];
  const declaredPackages = new Set(
    queries.package.map((entry) => entry.$?.['android:name'])
  );
  for (const name of PLAYER_PACKAGES) {
    if (!declaredPackages.has(name)) {
      queries.package.push(attr(name));
    }
  }

  const application = manifest.application?.[0];
  if (!application?.$) {
    throw new Error(
      'withAndroidManifestExtras: no <application> element to configure.'
    );
  }
  application.$['android:usesCleartextTraffic'] = 'true';
  application.$['android:largeHeap'] = 'true';

  return androidManifest;
};

const withAndroidManifestExtras = (config) =>
  withAndroidManifest(config, (cfg) => {
    cfg.modResults = addAndroidManifestExtras(cfg.modResults);
    return cfg;
  });

module.exports = withAndroidManifestExtras;
module.exports.addAndroidManifestExtras = addAndroidManifestExtras;
