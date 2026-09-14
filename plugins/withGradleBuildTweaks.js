const {
  withAppBuildGradle,
  withGradleProperties,
} = require('expo/config-plugins');

/**
 * Two build settings that have to survive `expo prebuild` and that neither
 * `app.json` nor `expo-build-properties` has a field for.
 *
 * ABI SET — the template builds `armeabi-v7a, arm64-v8a, x86, x86_64`. This
 * project drops `x86`: no Android TV box, set-top box or retail phone ships a
 * 32-bit Intel ABI, so the slice is dead weight in a universal APK and pure
 * cost in build time. `x86_64` is kept because that is what the Android
 * emulator uses on a normal development machine, and losing it would mean the
 * app could not be run locally at all.
 *
 * LINT — release builds must not be gated on lint. `ManifestResource` in
 * particular fires on the `tools:replace` attributes that
 * `@react-native-tvos/config-tv` writes onto the `uses-feature` entries, which
 * is a deliberate manifest-merger instruction rather than a defect. Without
 * this block `./gradlew assembleRelease` fails on a warning the project cannot
 * act on.
 *
 * Both were hand-edited into the generated files before SDK 57 and would have
 * been lost when the RN 0.86 template regenerated them.
 */

/** Every ABI except `x86`; see the note above. */
const ARCHITECTURES = 'armeabi-v7a,arm64-v8a,x86_64';

const LINT_BLOCK = `    lint {
        abortOnError false
        checkReleaseBuilds false
        disable 'ManifestResource'
    }
`;

// Anchored on the last block the template emits inside `android { }`, so the
// insert point does not depend on our own previous output.
const ANCHOR = /^(\s*androidResources \{\n(?:.*\n)*?\s*\}\n)/m;

/**
 * The gradle surgery, separated from the plugin wrapper so it can be exercised
 * directly against a real `build.gradle`. Returns the contents unchanged if the
 * lint block is already present.
 */
const addLintBlock = (contents) => {
  // Idempotent: prebuild can run repeatedly over an already-modified file.
  if (/^\s*lint \{/m.test(contents)) return contents;

  if (!ANCHOR.test(contents)) {
    throw new Error(
      'withGradleBuildTweaks: could not find the androidResources block to anchor lint config to.'
    );
  }

  return contents.replace(ANCHOR, `$1${LINT_BLOCK}`);
};

const withGradleBuildTweaks = (config) => {
  config = withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error(
        'withGradleBuildTweaks: app/build.gradle is not Groovy; the injected block would not parse.'
      );
    }
    cfg.modResults.contents = addLintBlock(cfg.modResults.contents);
    return cfg;
  });

  config = withGradleProperties(config, (cfg) => {
    const entry = cfg.modResults.find(
      (item) => item.type === 'property' && item.key === 'reactNativeArchitectures'
    );
    if (entry) {
      entry.value = ARCHITECTURES;
    } else {
      cfg.modResults.push({
        type: 'property',
        key: 'reactNativeArchitectures',
        value: ARCHITECTURES,
      });
    }
    return cfg;
  });

  return config;
};

module.exports = withGradleBuildTweaks;
module.exports.addLintBlock = addLintBlock;
