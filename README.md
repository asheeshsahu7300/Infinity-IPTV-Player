
# Infinity IPTV Player TV

<p align="center">
  <img
    width="1280"
    height="720"
    alt="Infinity IPTV Player TV"
    src="https://github.com/user-attachments/assets/c77437a3-b17c-43f4-8daf-b8e73fe1f1fb"
  />
</p>

<p align="center">
  <strong>A modern, high-performance IPTV player for Mobile, Tablet, and Android TV.</strong>
</p>

<p align="center">
  <a href="https://github.com/asheeshsahu7300/Infinity-IPTV-Player/releases/latest">
    <img src="https://img.shields.io/badge/Release-v1.0.0-blue.svg?style=for-the-badge" alt="Release v1.0.0" />
  </a>
  <img src="https://img.shields.io/badge/Google%20Play-Soon%20Live-brightgreen.svg?style=for-the-badge&logo=google-play&logoColor=white" alt="Google Play Soon Live" />
  <img src="https://img.shields.io/badge/Platform-Android%20%7C%20Android%20TV-00C853.svg?style=for-the-badge&logo=android&logoColor=white" alt="Android & Android TV" />
  <a href="https://github.com/asheeshsahu7300/Infinity-IPTV-Player/releases/latest">
    <img src="https://img.shields.io/badge/webOS-LG%20Smart%20TV%20(.ipk)-E50914.svg?style=for-the-badge&logo=lg&logoColor=white" alt="LG webOS TV IPK" />
  </a>
</p>

<p align="center">
  🚀 <strong>Release 1.0.0 is officially ready! Available for Android, Android TV, and LG webOS Smart TVs.</strong>
</p>

<p align="center">
  Built with Expo, React Native, and TypeScript.
</p>

---

## Disclaimer

> **Infinity IPTV Player TV is a player application only.**
>
> It does not provide, host, distribute, or include IPTV channels, streams, subscriptions, or credentials.
>
> Users are responsible for providing their own legal IPTV service credentials and content from authorized providers.

---

## Overview

**Infinity IPTV Player TV** is a modern IPTV/media player built with **Expo, React Native, and TypeScript**.

It supports multiple IPTV playlist and portal formats while providing a consistent experience across:

- Android phones & Tablets
- Android TV / Google TV
- LG webOS Smart TVs (webOS 3.5 through webOS 24)
- D-Pad, Magic Remote, and remote-controlled devices

The application is designed around a premium dark UI, fast content browsing, large media libraries, and a TV-friendly 10-foot interface.

### Release & Downloads

- **Latest Release**: [**v1.0.0 on GitHub Releases**](https://github.com/asheeshsahu7300/Infinity-IPTV-Player/releases/latest)
- **LG webOS Smart TV**: Download the installable [**`com.infinity.iptvplayer_1.0.0_all.ipk`**](https://github.com/asheeshsahu7300/Infinity-IPTV-Player/releases/latest)
- **Android / Android TV**: [**Download APK**](https://github.com/asheeshsahu7300/Infinity-IPTV-Player/releases/latest) | 🟢 **Soon Live on Google Play Store!** (Submitted for review)

---

## Features

### Multi-Portal Support

Connect to IPTV services using:

- **M3U / M3U8 Playlists**
- **Xtream Codes API**
- **MAG / Stalker Portal API**

Multiple portals can be saved and managed from the application.

---

### Content Types

Browse different types of media from a single interface:

- Live TV
- VOD / Movies
- TV Series
- Seasons & Episodes
- Global Search
- Favorites

---

### Android TV Optimized

Designed specifically for the Android TV 10-foot experience.

- Full D-Pad navigation
- Up / Down / Left / Right navigation
- Select / Back controls
- Custom focus management
- Glowing focus states
- High-contrast active states
- Large TV-friendly UI elements
- Leanback launcher support

---

### Performance

Built to handle large IPTV libraries efficiently.

- Infinite scrolling
- Smart content chunking
- Background caching
- Optimized list rendering
- `@shopify/flash-list`
- Efficient playlist processing
- Large-library friendly architecture

---

### Favorites

Quickly access content you watch regularly.

Favorites can be maintained for:

- Live TV channels
- Movies
- TV Series

---

### Powerful Playback

The built-in player supports:

- Video playback
- Subtitle switching
- Audio-track switching
- Full-screen playback
- External player support

Compatible external players include:

- VLC
- MX Player
- Other Android-compatible video players

---

### Modern UI

The interface is designed around a premium streaming experience.

- Dark-first design
- Cinematic gradients
- Poster-based content cards
- Rating badges
- Smooth focus animations
- Glowing TV focus states
- Premium typography
- Responsive layouts

---

# Screenshots

## Mobile Experience

| Splash Screen | Dashboard | Portal Options |
|:---:|:---:|:---:|
| <img width="300" alt="Infinity IPTV Player TV Splash Screen" src="https://github.com/user-attachments/assets/b5b7d547-138c-4d8d-9704-9612c7d132d1"> | <img width="300" alt="Infinity IPTV Player TV Dashboard" src="https://github.com/user-attachments/assets/8ad857b5-70b4-413c-b127-c2cb0b579fde"> | <img width="300" alt="Infinity IPTV Player TV Add Portal" src="https://github.com/user-attachments/assets/fab05763-b7ad-44fd-a1f0-5ddd4ffb2c5f"> |

---

## Android TV Experience

### Splash Screen

<img
  width="1280"
  alt="Infinity IPTV Player TV Android TV Splash Screen"
  src="https://github.com/user-attachments/assets/e858646d-c480-490e-9be2-5a5fd3a528bb"
/>

### TV Dashboard

<img
  width="1280"
  alt="Infinity IPTV Player TV Android TV Dashboard"
  src="https://github.com/user-attachments/assets/3db99589-24b0-4b8c-a545-60f2ee780c99"
/>

### Portal Options

<img
  width="1280"
  alt="Infinity IPTV Player TV Android TV Add Portal"
  src="https://github.com/user-attachments/assets/d2c844f8-bad9-4d3e-a1be-c717917e2e5d"
/>

---

# Tech Stack

| Category | Technology |
|---|---|
| Framework | Expo |
| UI | React Native |
| Language | TypeScript |
| Navigation | Expo Router |
| State Management | Zustand |
| Networking | Axios |
| IPTV APIs | M3U, Xtream Codes, MAG/Stalker |
| Lists | FlashList / FlatList |
| Video | Expo Video |
| TV Navigation | Custom D-Pad Focus Engine |
| Platform | Android / Android TV |

---

# Project Structure

```text
├── app/
│   ├── index.tsx                 # Splash & portal authentication gate
│   ├── portals.tsx               # Saved portal selection
│   ├── add-portal.tsx            # Add/configure IPTV portal
│   ├── dashboard.tsx             # Main dashboard
│   ├── live-tv.tsx               # Live TV browser
│   ├── vod.tsx                   # Movies / VOD catalog
│   ├── series.tsx                # TV Series catalog
│   ├── series-details.tsx        # Seasons & episodes
│   ├── search.tsx                # Global content search
│   ├── player.tsx                # Built-in video player
│   └── settings.tsx              # Application settings
│
├── src/
│   ├── components/              # Reusable UI components
│   ├── services/                # IPTV API clients
│   │   ├── m3u/
│   │   ├── xtream/
│   │   └── stalker/
│   ├── store/                   # Zustand stores
│   ├── theme/                   # Design system & tokens
│   ├── tv/                      # Android TV focus engine
│   │   ├── Focusable/
│   │   └── FocusGroup/
│   └── utils/                   # Device & utility helpers
│
├── assets/                      # Images, icons & splash assets
├── android/                     # Native Android configuration
├── app.json
├── eas.json
├── package.json
└── README.md
````

---

# Getting Started

## Prerequisites

Make sure you have the following installed:

* Node.js 18+
* npm, Yarn, or Bun
* Expo CLI / Expo tooling
* Android Studio
* Android SDK
* Android emulator or physical Android device

For Android TV development, an Android TV emulator or compatible TV device is recommended.

---

## Installation

Clone the repository:

```bash
git clone https://github.com/yourusername/iptv-player-app.git
```

Navigate into the project:

```bash
cd iptv-player-app
```

Install dependencies:

```bash
npm install
```

Or with Yarn:

```bash
yarn install
```

Or with Bun:

```bash
bun install
```

---

# Development

Start the Expo development server:

```bash
npx expo start
```

Run on Android:

```bash
npx expo start --android
```

For a development build:

```bash
npx expo run:android
```

---

# Production Build

## Android APK

Generate the native Android project:

```bash
npx expo prebuild --platform android
```

Build the release APK:

```bash
cd android
./gradlew assembleRelease
```

The generated APK can be found under:

```text
android/app/build/outputs/apk/release/
```

---

## EAS Build

Configure EAS:

```bash
npx eas build:configure
```

Build a production Android application:

```bash
npx eas build --platform android --profile production
```

---

## LG webOS Smart TV (`.ipk`)

### 1. Build & Package IPK Locally

Make sure the official LG webOS TV CLI is installed:

```bash
npm install -g @webosose/ares-cli
```

Generate the optimized webOS build and `.ipk` package:

```bash
npm run build:webos
```

*(Or with Yarn: `yarn build:webos`)*

The generated `.ipk` package will be available in:

```text
release-webos/com.infinity.iptvplayer_1.0.0_all.ipk
```

---

### 2. Sideload / Install IPK on LG Smart TV

There are three easy ways to install the `.ipk` on your LG webOS TV:

#### Method A: webOS Dev Manager (Recommended — GUI for Windows / Mac / Linux)

1. Download and install [**webOS Dev Manager**](https://github.com/webosbrew/dev-manager/releases).
2. On your LG TV, install and launch the **Developer Mode** app from the LG Content Store.
3. Turn **Dev Mode ON** and **Key Server ON**.
4. In webOS Dev Manager on your computer, click **Add Device**, enter the TV IP address and the 6-character passphrase shown on your TV screen.
5. Click **Install IPK**, select `com.infinity.iptvplayer_1.0.0_all.ipk`, and the app will install on your TV!

#### Method B: LG webOS CLI (`ares-cli`)

1. Register your TV with the CLI:
   ```bash
   ares-setup-device
   ```
2. Fetch the authentication key (enter the 6-character passphrase from the TV screen):
   ```bash
   ares-novacom --device <device-name> --getkey
   ```
3. Install and launch the application:
   ```bash
   ares-install --device <device-name> release-webos/com.infinity.iptvplayer_1.0.0_all.ipk
   ares-launch --device <device-name> com.infinity.iptvplayer
   ```

#### Method C: Homebrew Channel (webOS Brew for Rooted TVs)

If your LG TV is rooted with the [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel):
1. Open the Homebrew Channel app on your TV.
2. Transfer or upload `com.infinity.iptvplayer_1.0.0_all.ipk` via web browser or Dev Manager without needing Developer Mode timers.

---

# Portal Configuration

Infinity IPTV Player TV supports three main connection methods.

## M3U / M3U8

Provide a direct playlist URL:

```text
https://example.com/playlist.m3u
```

---

## Xtream Codes

Provide:

```text
Server URL
Username
Password
```

Example:

```text
Server: https://example.com
Username: your_username
Password: your_password
```

---

## MAG / Stalker Portal

Provide:

```text
Portal URL
MAC Address
```

Example:

```text
MAC: 00:1A:79:XX:XX:XX
```

> Only use portal credentials and services that you are legally authorized to access.

---

# Android TV Experience

Infinity IPTV Player TV is designed around the Android TV 10-foot UI experience.

## D-Pad Navigation

Users can navigate the application using:

```text
        ↑
        │
    ←   OK   →
        │
        ↓
```

Supported controls include:

* Up
* Down
* Left
* Right
* Select / OK
* Back

---

## Focus System

Interactive components use a custom TV focus system.

```text
Focusable
   │
   ├── FocusGroup
   │
   ├── D-Pad Navigation
   │
   └── Visual Focus State
```

Focused elements receive:

* Glowing border
* Increased visual contrast
* Active pill state
* Smooth focus transition

This makes the interface easy to use from a distance with a standard TV remote.

---

# Architecture

The application separates the IPTV providers from the UI layer.

```text
                    Infinity IPTV Player TV
                            │
             ┌──────────────┼──────────────┐
             │              │              │
            M3U          Xtream          MAG
             │              │              │
             └──────────────┼──────────────┘
                            │
                      Content Engine
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
       Live TV             VOD              Series
          │                 │                 │
          └─────────────────┼─────────────────┘
                            │
                     Zustand Store
                            │
                     React Native UI
                            │
             ┌──────────────┴──────────────┐
             │                             │
          Mobile                      Android TV
             │                             │
        Touch UI                      D-Pad UI
```

---

# Performance Architecture

Large IPTV playlists can contain thousands of channels and media items.

The application uses:

* FlashList
* Pagination
* Chunked processing
* Background caching
* Lazy content loading
* Optimized React Native rendering

The goal is to keep navigation responsive even with large content libraries.

---

# Validation

Run TypeScript validation:

```bash
npx tsc --noEmit
```

Run ESLint check:

```bash
yarn lint
```

For Android builds:

```bash
cd android
./gradlew assembleDebug
cd ..
```

*(On Windows PowerShell: `cd android; .\gradlew.bat assembleDebug; cd ..`)*

---

# Clean Build

If you encounter Android, Metro, or Gradle build problems:

```bash
cd android
./gradlew clean
cd ..
rm -rf node_modules
yarn install
```

On Windows (PowerShell):

```powershell
cd android; .\gradlew.bat clean; cd ..
Remove-Item -Recurse -Force node_modules
yarn install
```

---

# Contributing

Contributions, bug reports, and feature requests are welcome! For complete development guidelines, project architecture, D-Pad focus standards, and patch management, please see **[CONTRIBUTING.md](CONTRIBUTING.md)**.

### Quick Workflow

1. **Fork & Branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. **Follow Coding Standards**:
   * Use TypeScript with strict types.
   * Maintain Android TV D-Pad compatibility (`Focusable` / `FocusGroup` from `src/components/Focusable.tsx`).
   * Adhere to responsive design tokens (`ps`, `pw`, `ph` from `src/theme/tokens.ts`).
   * Never commit IPTV streams, credentials, or copyrighted playlist URLs.
3. **Validate**:
   ```bash
   npx tsc --noEmit
   yarn lint
   ```
4. **Commit & Push**:
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   git push origin feature/your-feature-name
   ```
5. **Open a Pull Request**:
   * Fill out the PR summary referencing the [PULL_REQUEST_DESCRIPTION.md](PULL_REQUEST_DESCRIPTION.md) template.

---

# Privacy & Content Responsibility

Infinity IPTV Player TV does not provide IPTV content.

The application does not:

* Host IPTV streams
* Provide IPTV subscriptions
* Sell IPTV credentials
* Include copyrighted IPTV channels
* Distribute third-party playlists

Users are responsible for the content and services they connect to the application.

Always ensure that your IPTV provider and content are legally authorized in your jurisdiction.

---

# Changelog

### webOS Experimental (LG Smart TV Compatibility)
- **LG webOS TV Package Pipeline**: Automated packaging generating official `com.infinity.iptvplayer_1.0.0_all.ipk` via `npm run build:webos`.
- **Magic Remote Air-Pointer & D-Pad Integration**: Full spatial 2D navigation engine (`webSpatialNavigation.ts`) with Magic Remote hover highlight support.
- **webOS Back Button & Media Control**: Polyfilled React Native `BackHandler` on Web catching webOS remote Back (key code `461`), Play/Pause, Fast-Forward, Rewind, Channel Up/Down, and color keys.
- **Hardware-Accelerated Video Pipeline**: Native webOS HLS streaming with dual-mode `HLS.js` fallback for standard browsers.
- **Developer Guide**: Comprehensive LG webOS deployment and testing documentation in [WEBOS_GUIDE.md](docs/WEBOS_GUIDE.md).

### Release 1.0.0 (Production App Release — Soon Live on Google Play Store)
- **Official Google Play Store Release**: Production build compiled and packaged for Google Play Store review across Android Mobile, Tablet, and Android TV devices.
- **Universal Multi-Portal Engine**: Native integration for M3U / M3U8 playlists, Xtream Codes API, and MAG / Stalker Portal APIs with unified category and EPG navigation.
- **Cinematic Dark UI & 10-Foot TV Experience**: Responsive layouts with D-Pad focus engine, glow highlights, and remote-control navigation tailored for Android TV and Google TV.
- **Resilient Media Playback**: High-performance streaming pipeline with hardware video decoding (AVC, HEVC, VP9) and robust audio safety guards for Qualcomm ACDB and MediaTek chipsets.

---

# License

This project is intended for **learning and personal media-player use**.

Please ensure that your use of third-party IPTV services complies with applicable laws and the provider's terms of service.

---

# Disclaimer

**Infinity IPTV Player TV is a media player, not an IPTV content provider.**

The developers do not provide, host, control, or distribute third-party IPTV content.

Users must provide their own legally obtained IPTV service credentials and content.

The developers are not responsible for content accessed through third-party services.

---

<p align="center">
  <strong>Made with Expo, React Native & TypeScript</strong>
</p>

<p align="center">
  <strong>Infinity IPTV Player TV</strong>
  <br />
  Your Player. Your Content. Your Choice.
</p>
