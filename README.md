
<img width="512" height="96" alt="TV (1)" src="https://github.com/user-attachments/assets/ff801556-6c2c-4411-a9c4-d3a937182a78" />

# Infinity IPTV Player App
> **WARNING: This is a player application only. It does not provide, host, or include any IPTV content, streams, or subscriptions. Users must provide their own legal IPTV service credentials.**

A modern, high-performance IPTV player built with **Expo**, **React Native**, and **TypeScript**, supporting **M3U**, **Xtream Codes**, and **MAG/Stalker** portals.
Optimized for mobile touchscreens, tablets, and full **Android TV 10-foot D-pad remote navigation**.

---

## Screenshots

### Mobile Experience

| Splash screen | Dashboard |
| :---: | :---: |
|<img width="220" alt="Live TV" src="https://github.com/user-attachments/assets/4f87144c-cc7c-45f4-bebf-69dc1c0b178f" />| <img width="220" alt="Dashboard" src="https://github.com/user-attachments/assets/1d75ffc1-e34d-4fb7-927c-b31f6ec9a6c3" /> | 

| VOD Movies | Series |
| :---: | :---: |
| <img width="220" alt="VOD Movies" src="https://github.com/user-attachments/assets/bbe9eb64-6e7e-41a1-bfef-b601832c3db7" /> | <img width="220" alt="Series" src="https://github.com/user-attachments/assets/0e2e8493-ee19-4557-845e-a1098e9cefbb" /> |

---

### Android TV & Large Screen Experience

| Splash screen |
| :---: |
| <img width="600" alt="Android TV Dashboard" src="https://github.com/user-attachments/assets/36b817b0-1ac7-4e06-ab64-5d23c0999d17" /> |

| Dashboard | Movies | Series |
| :---: | :---: | :---: |
| <img width="280" alt="TV Category Browsing" src="https://github.com/user-attachments/assets/27318928-8c0a-4c6a-87bb-7775abd77449" /> | <img width="280" alt="TV Grid Browsing" src="https://github.com/user-attachments/assets/cc512c7a-c7cd-4688-b740-0aee6edb7566" /> | <img width="280" alt="TV Focus Highlight" src="https://github.com/user-attachments/assets/f6b6bc2a-9269-4d8a-a910-c634011ecdd1" /> |

---

## Features

- **Multi-Portal Support**:
  - **M3U / M3U8 Playlists**
  - **Xtream Codes API**
  - **MAG / Stalker Portal API**
- **Content Coverage**: Live TV, VOD Movies, and TV Series (with Season & Episode browser)
- **Full Android TV & D-Pad Remote Control**: Smooth directional focus navigation, glowing TV focus rings, and Leanback launcher support
- **Performance & Pagination**: Smart chunking, infinite scroll, and background cache management for large playlists
- **Favorites System**: Quick-access bookmarking for Live TV, Movies, and Series
- **Built-in & External Video Players**: Integrated video player with subtitle and audio track switching + Android Intent launcher for external players (VLC, MX Player, etc.)
- **Modern Aesthetics**: Sleek dark mode, poster tile overlays with top-right rating badges, smooth gradients, and typography

---

## Tech Stack

- **Framework**: Expo (SDK 52+), React Native, TypeScript
- **Navigation**: Expo Router (File-based routing)
- **State Management**: Zustand
- **Networking & API**: Axios (Custom M3U, Xtream, and MAG Stalker client engines)
- **Lists**: `@shopify/flash-list` & React Native `FlatList`
- **Media Playback**: `expo-video` & Android Intent Launchers
- **TV Support**: Custom TV Focus Engine (`Focusable`, `FocusGroup`, D-Pad direction management)

---

## Project Structure

```
├── app/                # File-based routing (Expo Router)
│   ├── index.tsx       # Splash & portal auth gate
│   ├── portals.tsx     # Saved portal selection screen
│   ├── add-portal.tsx  # Add/configure portal (M3U, Xtream, MAG)
│   ├── dashboard.tsx   # Main hub (Hero, category rails, quick links)
│   ├── live-tv.tsx     # Live TV channels & category browser
│   ├── vod.tsx          # Movies catalog with poster overlay & rating
│   ├── series.tsx       # Series catalog
│   ├── series-details.tsx # Seasons & episodes browser
│   ├── search.tsx       # Global content search across Live/VOD/Series
│   ├── player.tsx       # Built-in player with audio/subtitle track modals
│   └── settings.tsx     # Hardware acceleration, cache, and active portal settings
├── src/
│   ├── components/     # Reusable TV & Mobile UI components (Sidebar, Pills, Overlays)
│   ├── services/       # Portal API implementations (M3U, Xtream, MAG)
│   ├── store/          # Zustand global state (Portals, Favorites, Active Content)
│   ├── theme/          # Design tokens, responsive dimensions (`ps`, `pw`, `ph`), colors
│   ├── tv/             # D-Pad focus management components (`Focusable`, `FocusGroup`)
│   └── utils/          # Device detection (`isTV`, `isPhone`, `isTablet`) & helpers
├── assets/             # Icons, splash screen GIF, and screenshots
├── android/             # Native Android project configuration
└── README.md
```

---

## Prerequisites

- **Node.js** ≥ 18
- **npm** or **yarn**
- **Expo CLI** (`npm install -g expo-cli`)
- **Android Studio** (for Android emulator & APK builds)

---

## Installation & Running Locally

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/iptv-player-app.git
   cd iptv-player-app
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start Expo Dev Server:**
   ```bash
   npx expo start
   ```

4. **Run on Device or Emulator:**
   - Press `a` for Android Emulator / TV Box
   - Scan QR code using **Expo Go**

---

## Building for Production

### Android (APK & Android TV)

```bash
# Generate native Android project files
npx expo prebuild --platform android

# Build Release APK locally
cd android
./gradlew assembleRelease

# Or build via Expo Application Services (EAS)
npx eas build --platform android --profile production
```

---

## Portal Setup & Configuration

The app allows users to configure multiple IPTV portals:

1. **M3U Playlist**
   - Provide direct M3U or M3U8 URL.
2. **Xtream Codes**
   - Provide Server URL, Username, and Password.
3. **MAG / Stalker**
   - Provide Portal URL and MAC Address (e.g. `00:1A:79:XX:XX:XX`).

---

## Android TV & Remote Control Experience

Infinity IPTV Player is built ground-up for TV screens:
- **D-Pad Directional Navigation**: Seamlessly navigate channels, categories, and settings using standard TV remote controls (Up / Down / Left / Right / Select / Back).
- **Focus Rings & Visual Feedback**: Highlighted focus borders with high-contrast active pill states.
- **10-Foot Interface**: Optimized typography and large touch targets readable from a distance.

---

## Troubleshooting

### Gradle Execution Permissions (macOS/Linux)
```bash
chmod +x android/gradlew
```

### Clean Rebuild
```bash
cd android
./gradlew clean
cd ..
rm -rf node_modules
npm install
```

---

## Contributing Guidelines

Contributions, bug reports, and feature requests are welcome. To ensure code quality and consistency across mobile and Android TV platforms, please follow these guidelines:

1. **Fork the Repository**: Create your personal fork on GitHub.
2. **Create a Feature Branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Coding Standards**:
   - Write clean, type-safe TypeScript code.
   - Maintain Android TV D-Pad focus compatibility by wrapping interactive elements with `Focusable` or `FocusGroup` components.
   - Use design system tokens (`ps`, `pw`, `ph`, `fw`) from `src/theme/tokens`.
4. **Validation & Type Checking**:
   - Run local type checks prior to submitting:
     ```bash
     npx tsc --noEmit
     ```
5. **Commit & Push**:
   ```bash
   git commit -m "feat: add support for custom EPG source"
   git push origin feature/your-feature-name
   ```
6. **Open a Pull Request**: Submit a PR explaining the problem solved or feature added.

---

## License

This project is intended for **learning and personal media player use**. Ensure compliance with local laws and provider terms of service.

---

## Disclaimer

**This is a player application only.**

- This app **does NOT** provide, host, or include any IPTV content, channels, or streams.
- This app **does NOT** sell subscriptions or IPTV credentials.
- Users MUST provide their own legal IPTV service credentials from authorized providers.

Developers are not responsible for content streamed through third-party services.

---

**Made using Expo, React Native & TypeScript**
