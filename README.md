# 📺 IPTV Hub (Mobile & TV Player)

> **⚠️ This is a player application only. It does not provide, host, or include any IPTV content, streams, or subscriptions. Users must provide their own legal IPTV service credentials.**

A modern, highly-optimized IPTV player built with **Expo**, **React Native**, and **TypeScript**. It supports **M3U**, **Xtream**, and **MAG/Stalker** portals. 
Optimized for performance, dynamic media loading, fast pagination, and smooth playback on both Mobile and Android TV.

---

## 📸 Screenshots (Mobile Experience)

<p align="center">
<img width="590" height="1280" alt="image" src="https://github.com/user-attachments/assets/8e5bdf02-0f4d-4949-88dd-cc1ee2067e46" />
<img width="590" height="1280" alt="image" src="https://github.com/user-attachments/assets/cdca60f0-bf37-4d86-bfd1-defa93c14e22" />
<img width="590" height="1280" alt="image" src="https://github.com/user-attachments/assets/ade19036-9b4f-4c23-9ff0-b6c5830fb384" />
<img width="590" height="1280" alt="image" src="https://github.com/user-attachments/assets/ae8bb1f0-cd3d-41ad-8b02-bb1866bd2faa" />

</p>

---

## ✨ Features

- **Multi-Platform Support**: Enjoy a seamless mobile experience (iOS/Android) and an optimized 10-foot UI for Android TV.
- **Dynamic Player**: Uses `expo-video` for standard formats and dynamically loads `react-native-vlc-media-player` for Live TV streams to reduce mobile bundle/app size.
- **Live TV, VOD, & Series**: Full categorization, pagination, and support for massive catalogs.
- **Multiple Portal Types**:
  - M3U Playlists (both `.m3u` and `.m3u8`)
  - Xtream Codes API
  - MAG / Stalker Portals
- **Premium UI Aesthetics**: Glassmorphism, smooth gradients, dynamic micro-animations, and a responsive layout using custom Google TV typography (`GoogleSans`).
- **External Player Support**: Long press to open streams in VLC, MX Player, etc. (Android).
- **Built for Scale**: Uses Zustand for fast state management and FlashList for 60FPS list rendering.

---

## 🛠️ Tech Stack

- **Expo & React Native** (SDK 54)
- **TypeScript** & **Expo Router**
- **Zustand** (State Management)
- **Axios** (Networking)
- **FlashList / FlatList** (High-Performance Lists)
- **Expo Video** & **VLC Player** (Video Playback)

---

## 📁 Project Structure

```text
├── app/                # File-based routing (Expo Router)
├── assets/             # Images, fonts, and screenshots
├── src/
│   ├── components/     # Reusable UI components (CinematicBackground, Focusable, etc.)
│   ├── services/       # API layers (M3U, Xtream, MAG) & Boot Managers
│   ├── store/          # Zustand state store
│   ├── theme/          # Design tokens (THEME, typography, scaling)
│   └── utils/          # Helpers & normalizers
├── android/            # Native Android project
├── ios/                # Native iOS project
└── README.md
```

---

## 🚀 Installation & Local Development

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/iptv-player-app.git
   cd iptv-player-app
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the development server:**
   ```bash
   npx expo start
   ```

4. **Run on device/emulator:**
   - Press `a` for Android
   - Press `i` for iOS
   - Scan the QR code with the Expo Go app.

---

## 📱 Building for Production

### Android (Mobile & TV)

Native builds have been optimized to exclude unused ABI architectures (like `x86`), greatly reducing the APK size for mobile devices.

```bash
# Generate native Android project
npx expo prebuild --platform android

# Build Release APK
cd android
./gradlew assembleRelease

# Or build seamlessly with EAS
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

The app securely manages your credentials locally and supports three connection types:

1. **M3U Playlist**: Provide a valid M3U/M3U8 URL.
2. **Xtream Codes**: Requires Server URL, Username, and Password.
3. **MAG/Stalker**: Requires Portal URL and a registered MAC address.

Configure these securely in the app's **Settings → Add Portal**.

---

## 🤝 Contributing

Contributions are highly welcome! 

1. Fork the repository.
2. Create a feature branch (`git checkout -b feature/amazing-feature`).
3. Commit your changes (`git commit -m 'Add amazing feature'`).
4. Push to the branch (`git push origin feature/amazing-feature`).
5. Open a Pull Request.

---

## ⚠️ Legal Disclaimer

**This is a player application only.**

- ❌ This app **does NOT** provide any IPTV content, channels, or streams.
- ❌ This app **does NOT** include any subscriptions or services.
- ❌ This app **does NOT** host or distribute any media content.
- ✅ This app **ONLY** plays content from IPTV services you already legally subscribe to.

Users are solely responsible for obtaining legal access to IPTV services, providing their own valid credentials, and complying with local copyright laws. The developers do not endorse piracy and will not provide support for accessing illegal content.
