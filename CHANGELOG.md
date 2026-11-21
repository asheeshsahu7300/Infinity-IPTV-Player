# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-11-21

### Added
- LG webOS Smart TV support:
  - Direct hardware video pipeline with 4K adaptive streaming passthrough.
  - 2D spatial navigation engine with Magic Remote air-pointer hover highlights.
  - Dedicated key handling for LG Magic Remote (Back code 461, Channel Up/Down, color buttons).
  - Automated webOS packaging pipeline via `npm run build:webos` producing installable `.ipk` packages.
- Android 16 compatibility properties in AndroidManifest (`PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY` and `PROPERTY_COMPAT_ALLOW_USER_ASPECT_RATIO_OVERRIDE`).
- R8 ProGuard keep rules for React Native, TurboModules, Expo Modules, AndroidX Media3, Jellyfin FFmpeg decoder, MMKV, and OkHttp.

### Changed
- Bumped `versionCode` to 18 and `versionName` to 1.0.1 across Android Gradle, app.json, package.json, and webOS appinfo.json.
- Enabled R8 code minification (`minifyEnabled true`) and resource shrinking (`shrinkResources true`) for release builds, exceeding Google Play's 25% obfuscation threshold.
- Updated status bar and navigation bar styles in `styles.xml` to transparent for Android 15 edge-to-edge compliance.
- Upgraded display cutout mode from deprecated `SHORT_EDGES` to `LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS` on API 30+.
- Modernized `MainActivity.kt` to use AndroidX `WindowInsetsControllerCompat` and `WindowCompat.setDecorFitsSystemWindows(window, false)` for immersive full-screen rendering.
- Guarded `pinHandsetToPortrait()` to avoid restricting orientation on large-screen devices, foldables (`swDp >= 600`), and multi-window or split-screen modes.

### Fixed
- Fixed Google Play Console hardware feature restriction by marking `android.hardware.wifi`, `android.hardware.telephony`, `android.hardware.camera`, and `android.hardware.bluetooth` as optional (`required="false"`), enabling full availability on Ethernet-only Android TV boxes, desktop/ChromeOS, and Android XR devices.
- Overrode hardcoded portrait orientation in ML Kit's `GmsBarcodeScanningDelegateActivity` to resolve Android 16 large-screen orientation warnings.
- Removed deprecated `window.decorView.systemUiVisibility` flags from `MainActivity.kt`.
- Resolved JSX unescaped entities in `app/search.tsx`.

---

## [1.0.0] - 2026-10-24

### Added
- Official initial release for Android, Android TV, and Google TV on Google Play Store.
- Multi-portal management supporting M3U/M3U8 playlists, Xtream Codes API, and MAG / Stalker Portal APIs.
- 10-foot TV user interface with D-Pad focus memory, glow indicators, and spatial navigation.
- Live TV guide (EPG) with category filters, channel zap lists, and program descriptions.
- VOD and Series section with season/episode selector, search, and metadata parsing.
- Streaming engine powered by customized AndroidX Media3 / ExoPlayer with Jellyfin FFmpeg software audio decoder fallback.
- Hardware-accelerated video decoding for H.264, HEVC / H.265, and VP9.
- Adaptive network buffer caching with 4K stream detection and 1.5x cache floor.
- External player delegation support for VLC, Just Player, and MX Player via Android Intents.
