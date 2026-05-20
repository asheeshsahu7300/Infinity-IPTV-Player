# 📺 IPTV Player App (Expo + React Native)

> **⚠️ This is a player application only. It does not provide, host, or include any IPTV content, streams, or subscriptions. Users must provide their own legal IPTV service credentials.**

A modern IPTV player built with **Expo**, **React Native**, and **TypeScript**, supporting **M3U**, **Xtream**, and **MAG/Stalker** portals.  
Optimized for performance, pagination, caching, and external player support on Android.

---

## Features

- ✅ Support for **Live TV**, **VOD**, and **TV Series**
- ✅ Portal types:
  - **M3U**
  - **Xtream Codes**
  - **MAG / Stalker**
- ✅ Category-based browsing
- ✅ Pagination & caching for large playlists
- ✅ Favorites (Live, VOD, Series)
- ✅ In-app video player
- ✅ Open streams in **external players** (VLC, MX Player, etc.)
- ✅ Android TV–friendly UI
- ✅ Built with **Expo Router**
- ✅ CI-ready (Codemagic compatible)

---

## Tech Stack

- **Expo**
- **React Native**
- **TypeScript**
- **Expo Router**
- **Zustand**
- **Axios**
- **FlashList / FlatList**
- **Expo Video**
- **Android Intents**

---

## 📁 Project Structure

```
├── app/                # File-based routing (Expo Router)
├── src/
│   ├── components/     # Reusable UI components
│   ├── services/       # API layers (M3U, Xtream, MAG)
│   ├── store/          # Zustand store
│   └── utils/          # Helpers & normalizers
├── android/            # Native Android (after prebuild)
├── ios/                # Native iOS (after prebuild)
├── codemagic.yaml      # CI configuration
└── README.md
```

---

## Prerequisites

- **Node.js** ≥ 18
- **npm** or **yarn**
- **Android Studio** (for Android builds)
- **Xcode** (for iOS builds, macOS only)
- **Expo CLI**

```bash
npm install -g expo-cli
```

---

## 🛠️ Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/iptv-player-app.git
   cd iptv-player-app
   ```

2. **Install dependencies:**
   ```bash
   npm install
   # or
   yarn install
   ```

3. **Start the development server:**
   ```bash
   npx expo start
   ```

4. **Run on device/emulator:**
   - Press `a` for Android
   - Press `i` for iOS
   - Scan QR code with Expo Go app

---

## 📱 Building for Production

### Android

```bash
# Generate native Android project
npx expo prebuild --platform android

# Build APK
cd android
./gradlew assembleRelease

# Or build with EAS
npx eas build --platform android
```

### iOS

```bash
# Generate native iOS project
npx expo prebuild --platform ios

# Build with EAS
npx eas build --platform ios
```

---

## 🔧 Configuration

### Portal Setup

The app supports three portal types:

1. **M3U Playlist**
   - Provide M3U URL
   - Supports both `.m3u` and `.m3u8` formats

2. **Xtream Codes**
   - Server URL
   - Username
   - Password

3. **MAG/Stalker**
   - Portal URL
   - MAC address

Configure portals in the app's settings or directly in your store configuration.

---

## 🎮 Usage

1. **Add Portal:** Go to Settings → Add Portal
2. **Browse Content:** Navigate categories (Live TV, Movies, Series)
3. **Play Content:** Tap to play in built-in player
4. **External Player:** Long press to open in external player (Android)
5. **Favorites:** Star icon to add to favorites
6. **Search:** Use search to find specific content

---

## 🆕 Coming Soon

### 📺 TV Optimization (Android TV & Large Screens)

We're actively working on **TV-first optimizations** to improve the experience on Android TV and large-screen devices:

- 🎮 **D-pad / Remote navigation** (Up / Down / Left / Right)
- 🔍 **Focus-based UI** with clear focus indicators
- ⚡ **Faster list navigation** for large channel & VOD catalogs
- 🖥️ **10-foot UI design** (readable text, larger touch targets)
- ▶️ **Auto-play & resume** behavior optimized for TV usage
- 🧭 Improved **category switching** using remote controls

> These enhancements will make the app fully usable with a TV remote, without requiring touch input.

🚧 **Status:** In development  
📅 **Target:** Upcoming release

---

## 🐛 Troubleshooting

### Gradle Permission Error (macOS/Linux)
```bash
chmod +x android/gradlew
```

### Gradle Permission Error (Windows)
```powershell
git update-index --chmod=+x android/gradlew
```

### Video Playback Issues
- Ensure you're using `expo-video` (not deprecated `expo-av`)
- Check stream URL validity
- Verify network connectivity

### Build Failures
```bash
# Clean build
cd android
./gradlew clean
cd ..

# Reinstall dependencies
rm -rf node_modules
npm install
```

---

## 📦 Dependencies

### Core
- `expo` - Expo SDK
- `react-native` - React Native framework
- `expo-router` - File-based routing
- `expo-video` - Video playback

### State Management
- `zustand` - State management

### Networking
- `axios` - HTTP client

### UI Components
- `@shopify/flash-list` - High-performance lists
- `expo-linear-gradient` - Gradient backgrounds
- `@expo/vector-icons` - Icon library

### Storage
- `@react-native-async-storage/async-storage` - Local storage

### Other
- `expo-screen-orientation` - Screen orientation control
- `react-native-safe-area-context` - Safe area handling

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is for **learning and internal use only**.  
Ensure compliance with local laws and IPTV provider terms of service.

---

## ⚠️ Disclaimer

**This is a player application only.**

- ❌ This app **does NOT** provide any IPTV content, channels, or streams
- ❌ This app **does NOT** include any subscriptions or services
- ❌ This app **does NOT** host or distribute any media content
- ✅ This app **ONLY** plays content from IPTV services you already subscribe to

Users are responsible for:
- Obtaining **legal access** to IPTV services and content
- Providing their own **valid credentials** from legitimate IPTV providers
- Complying with **copyright laws** in their jurisdiction
- Following their **IPTV provider's terms of service**
- Ensuring they have **legal rights** to access the content they play

The developers:
- Do not endorse or promote piracy
- Are not responsible for misuse of this software
- Do not provide support for illegal streaming services
- Cannot help users find or access IPTV services

**Use this app only with legal IPTV subscriptions that you have properly purchased.**

---

## 📧 Support

For issues and questions:
- Open an issue on GitHub
- Check existing issues for solutions
- Review documentation

---

## 🙏 Acknowledgments

- Expo team for the amazing framework
- React Native community
- Contributors and testers

---

**Made with ❤️ using Expo and React Native**
