const { withSettingsGradle } = require('expo/config-plugins');

/**
 * Discards the React Native autolinking cache when the paths inside it do not
 * resolve on the machine doing the build.
 *
 * The React Native settings plugin caches autolinking results — including
 * absolute paths into `node_modules` — and only refreshes them when the
 * lockfiles change. `android/build/` is not in `.gitignore`'s reach for every
 * workflow, and CI restores build caches between runs, so a cache written on a
 * Windows developer machine can arrive on a Linux CI builder. Every library
 * project then gets registered against a directory that does not exist, and the
 * failure surfaces much later and far from the cause, as
 * "No matching variant ... No variants exist".
 *
 * Checking whether the cached `sourceDir`s are real directories is enough to
 * tell a portable cache from a stale one, and deleting it just costs one
 * regeneration.
 *
 * This was hand-written into the generated `settings.gradle`, so the SDK 57
 * prebuild dropped it; it is a mod now so the next one does not.
 */

const MARKER = 'Discarding stale autolinking cache';

const GUARD = `
// The React Native settings plugin caches autolinking results (including absolute
// paths into node_modules) and only refreshes them when the lockfiles change. A cache
// produced on another machine — e.g. Windows paths restored onto a Linux CI builder —
// makes Gradle register every library project against a directory that doesn't exist,
// which surfaces later as "No matching variant ... No variants exist".
// Drop the cache when its paths don't resolve here so it gets regenerated.
// Injected by plugins/withAutolinkingCacheGuard.js — edit the plugin, not this file.
def autolinkingCacheDir = new File(rootDir, "build/generated/autolinking")
def autolinkingCacheFile = new File(autolinkingCacheDir, "autolinking.json")
if (autolinkingCacheFile.isFile() && autolinkingCacheFile.length() > 0) {
  def cacheIsStale
  try {
    def cachedConfig = new groovy.json.JsonSlurper().parse(autolinkingCacheFile)
    cacheIsStale = cachedConfig.dependencies?.values()?.any { dependency ->
      def sourceDir = dependency.platforms?.android?.sourceDir
      sourceDir != null && !new File(sourceDir).isDirectory()
    }
  } catch (Exception ignored) {
    cacheIsStale = true
  }
  if (cacheIsStale) {
    logger.lifecycle("${MARKER} at \${autolinkingCacheDir}")
    autolinkingCacheDir.deleteDir()
  }
}
`;

// Must land before the block that consumes the cache.
const ANCHOR = 'extensions.configure(com.facebook.react.ReactSettingsExtension)';

/**
 * The gradle surgery, separated from the plugin wrapper so it can be exercised
 * directly against a real `settings.gradle`. Returns the contents unchanged if
 * the guard is already present.
 */
const addAutolinkingCacheGuard = (contents) => {
  // Idempotent: prebuild can run repeatedly over an already-modified file.
  if (contents.includes(MARKER)) return contents;

  if (!contents.includes(ANCHOR)) {
    throw new Error(
      'withAutolinkingCacheGuard: could not find the ReactSettingsExtension block to insert before.'
    );
  }

  return contents.replace(ANCHOR, `${GUARD}\n${ANCHOR}`);
};

const withAutolinkingCacheGuard = (config) =>
  withSettingsGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error(
        'withAutolinkingCacheGuard: settings.gradle is not Groovy; the injected block would not parse.'
      );
    }
    cfg.modResults.contents = addAutolinkingCacheGuard(cfg.modResults.contents);
    return cfg;
  });

module.exports = withAutolinkingCacheGuard;
module.exports.addAutolinkingCacheGuard = addAutolinkingCacheGuard;
