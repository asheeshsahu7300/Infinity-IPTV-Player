
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

- Android phones
- Tablets
- Android TV
- D-Pad / remote-controlled devices

The application is designed around a premium dark UI, fast content browsing, large media libraries, and a TV-friendly 10-foot interface.

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

For Android builds:

```bash
cd android
./gradlew assembleDebug
```

---

# Clean Build

If you encounter Android or Gradle build problems:

```bash
cd android
./gradlew clean
cd ..
```

Then reinstall dependencies:

```bash
rm -rf node_modules
npm install
```

On Windows:

```powershell
Remove-Item -Recurse -Force node_modules
npm install
```

---

# Contributing

Contributions, bug reports, and feature requests are welcome.

## 1. Fork the repository

Create your personal fork of the project.

## 2. Create a feature branch

```bash
git checkout -b feature/your-feature-name
```

## 3. Follow the coding standards

* Use TypeScript.
* Keep components reusable.
* Follow the existing design system.
* Maintain Android TV D-Pad compatibility.
* Use `Focusable` / `FocusGroup` for interactive TV components.
* Follow the existing theme tokens.

## 4. Validate your changes

```bash
npx tsc --noEmit
```

## 5. Commit your changes

```bash
git add .
git commit -m "feat: add new feature"
```

## 6. Push your branch

```bash
git push origin feature/your-feature-name
```

## 7. Open a Pull Request

Describe:

* What was changed
* Why it was changed
* How it was tested

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
```
