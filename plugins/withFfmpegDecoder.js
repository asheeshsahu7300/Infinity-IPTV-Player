const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Adds Jellyfin's FFmpeg audio decoder for media3 to the app module.
 *
 * IPTV live streams routinely carry AC3, E-AC3 or DTS audio, which media3's
 * `MediaCodec` renderers only play if the device happens to ship a hardware
 * decoder for them. Most Android TV boxes and effectively no phones do, so
 * those channels play as video with silence. `patches/expo-video+*.patch`
 * registers an `FfmpegAudioRenderer` as a fallback renderer inside expo-video's
 * `DefaultRenderersFactory`; this dependency is what puts the native library
 * behind `FfmpegLibrary.isAvailable()` into the APK. Both halves are required —
 * the patch alone logs "FfmpegLibrary is NOT available" and falls through.
 *
 * It is declared here, at the app level, rather than relying on the copy the
 * patch adds to expo-video's own `build.gradle`, so the `.so` is packaged even
 * if expo-video is ever consumed prebuilt instead of `buildFromSource`.
 *
 * VERSION: the `+N` suffix is Jellyfin's own build number; the part before it
 * must track `androidxMedia3Version` in `node_modules/expo-video/android/build.gradle`
 * exactly, or two media3 versions land on the classpath. expo-video 57.0.4 uses
 * media3 1.9.0. Re-check this on every expo-video bump.
 */

const FFMPEG_DECODER = 'org.jellyfin.media3:media3-ffmpeg-decoder:1.9.0+1';

// Anchored on the React Native dependency the template always emits, so the
// insert point does not depend on our own previous output.
const ANCHOR = 'implementation("com.facebook.react:react-android")';

/**
 * The gradle surgery, separated from the plugin wrapper so it can be exercised
 * directly against a real `build.gradle`. Returns the contents unchanged if the
 * dependency is already declared.
 */
const addFfmpegDecoder = (contents) => {
  // Idempotent: prebuild can run repeatedly over an already-modified file.
  if (contents.includes('media3-ffmpeg-decoder')) return contents;

  if (!contents.includes(ANCHOR)) {
    throw new Error(
      `withFfmpegDecoder: could not find \`${ANCHOR}\` to anchor the dependency to.`
    );
  }

  return contents.replace(
    ANCHOR,
    `${ANCHOR}\n    implementation("${FFMPEG_DECODER}")`
  );
};

const withFfmpegDecoder = (config) =>
  withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error(
        'withFfmpegDecoder: app/build.gradle is not Groovy; the injected line would not parse.'
      );
    }
    cfg.modResults.contents = addFfmpegDecoder(cfg.modResults.contents);
    return cfg;
  });

module.exports = withFfmpegDecoder;
module.exports.addFfmpegDecoder = addFfmpegDecoder;
