# Contributing to Infinity IPTV Player TV

Thank you for your interest in contributing to **Infinity IPTV Player TV**! We welcome contributions from developers, designers, and testers of all skill levels. Whether you are fixing a bug, improving Android TV focus management, optimizing list rendering performance, or polishing documentation, your help is appreciated.

Please take a moment to review this guide before submitting issues or pull requests.

---

## Table of Contents

1. [Important Legal & Content Policy](#important-legal--content-policy)
2. [Code of Conduct](#code-of-conduct)
3. [How to Contribute](#how-to-contribute)
   - [Reporting Bugs](#reporting-bugs)
   - [Suggesting Features](#suggesting-features)
   - [Submitting Pull Requests](#submitting-pull-requests)
4. [Development Environment Setup](#development-environment-setup)
   - [Prerequisites](#prerequisites)
   - [Cloning & Installing](#cloning--installing)
   - [Running the Project](#running-the-project)
   - [Working with Patches](#working-with-patches)
5. [Architecture & Project Structure](#architecture--project-structure)
6. [Coding Standards & Best Practices](#coding-standards--best-practices)
   - [TypeScript](#typescript)
   - [Android TV & D-Pad Focus](#android-tv--d-pad-focus)
   - [Design Tokens & Responsiveness](#design-tokens--responsiveness)
   - [Performance & Large Libraries](#performance--large-libraries)
   - [State Management](#state-management)
7. [Validation & Testing](#validation--testing)
8. [Pull Request Guidelines](#pull-request-guidelines)

---

## Important Legal & Content Policy

> **Infinity IPTV Player TV is strictly a media player application.**

- **Do NOT commit or share IPTV streams, credentials, or copyrighted playlists.** Any pull request, issue, or discussion containing links to pirated content, unauthorized stream URLs, or illegal Xtream/Stalker server credentials will be immediately closed and removed.
- Use only public domain or open-source test media (such as Big Buck Bunny, Tears of Steel, or public domain HLS/DASH test streams) for demonstrations and test scripts.
- Ensure all contributed code respects third-party intellectual property and open-source licenses.

---

## Code of Conduct

We are committed to providing a welcoming, inclusive, and harassment-free environment for everyone.
- Be respectful, constructive, and collaborative in all communications.
- Welcome newcomers and provide actionable feedback on code reviews.
- Focus on what is best for the project and user experience.

---

## How to Contribute

### Reporting Bugs

Before creating a new issue, search existing [Issues](https://github.com/asheeshsahu7300/iptv-hub/issues) to see if it has already been reported.

When opening a bug report, please include:
- **Device Details**: Phone, tablet, or Android TV box (e.g., Chromecast with Google TV, Fire TV, Nvidia Shield).
- **Android Version**: e.g., Android 11, 13, 14.
- **Form Factor / Input Mode**: Touchscreen or TV Remote (D-Pad).
- **Clear Reproduction Steps**: Step-by-step instructions to reproduce the issue.
- **Observed vs. Expected Behavior**: What actually happened vs. what you expected.
- **Logs**: Relevant `adb logcat` output or console logs if applicable (redact any private URLs, tokens, or credentials).

### Suggesting Features

We welcome ideas that enhance performance, TV remote usability, playback compatibility, or UI polish:
- Clearly explain the problem the feature solves.
- Describe the proposed solution and how it should behave on both TV (D-Pad) and Mobile/Tablet (Touch).
- Provide mockups, screenshots, or references if applicable.

### Submitting Pull Requests

1. Fork the repository and create a feature branch from `main`.
2. Keep pull requests focused on a single concern or fix.
3. Validate your code with TypeScript and linter checks.
4. Test your changes on both touch and D-Pad remote environments where possible.
5. Submit the PR with a detailed summary (see [Pull Request Guidelines](#pull-request-guidelines)).

---

## Development Environment Setup

### Prerequisites

- **Node.js**: `>= 20.19.4`
- **Package Manager**: [Yarn](https://classic.yarnpkg.com/) (`1.22.x` recommended)
- **Java Development Kit (JDK)**: JDK 17
- **Android Studio & Android SDK**: Android SDK Platform-Tools (`adb`), Android SDK Build-Tools, Android NDK
- **Expo CLI**: Installed globally or executed via `npx expo`

### Cloning & Installing

```bash
# Clone the repository
git clone https://github.com/asheeshsahu7300/iptv-hub.git
cd iptv-hub

# Install dependencies
yarn install
```

> **Note**: Playback is powered by [`infinity-media-player`](https://github.com/asheeshsahu7300/infinity-media-player), a dedicated high-performance Android Media3 player engine featuring Neural Video Latent Concealment (NVC-Live), Qualcomm ACDB audio HAL safety, and low-latency IPTV buffering.

### Running the Project

#### 1. Start the Expo Dev Server
```bash
yarn start
```

#### 2. Run on Android Device / Emulator
Ensure your device or Android TV emulator is connected via `adb devices`:
```bash
yarn android
```

#### 3. Connect via ADB over Wi-Fi (for Android TV)
```bash
adb connect <android-tv-ip-address>:5555
adb devices
yarn android
```

### Media Player Architecture

The playback engine is maintained in `modules/infinity-media-player` and upstreamed at [`https://github.com/asheeshsahu7300/infinity-media-player`](https://github.com/asheeshsahu7300/infinity-media-player).
It replaces `expo-video` with direct Media3 / ExoPlayer integration and embedded ONNX Runtime NVC-Live frame concealment.

---

## Architecture & Project Structure

The project is structured around **Expo Router** and modular services:

```text
Infinity-IPTV-Player/
├── app/                  # Expo Router file-based screens and routes
│   ├── _layout.tsx       # Root layout, navigation stack, and theme providers
│   ├── dashboard.tsx     # TV/Mobile home dashboard
│   ├── live-tv.tsx       # Live TV channels and category browsing
│   ├── vod.tsx           # Video on Demand (Movies) browser
│   ├── series.tsx        # TV Series and season browsing
│   ├── player.tsx        # Video player screen with controls overlay
│   ├── epg.tsx           # Electronic Program Guide (EPG)
│   ├── portals.tsx       # Saved portal & playlist management
│   └── settings.tsx      # Application and playback settings
├── src/
│   ├── components/       # Reusable UI components (Focusable, Cards, Modals)
│   ├── context/          # React contexts (e.g., Focus context)
│   ├── hooks/            # Custom React hooks (D-Pad navigation, orientation, etc.)
│   ├── player/           # Playback managers, track selectors, and audio sink configurations
│   ├── services/         # IPTV protocol parsers (M3U/M3U8, Xtream Codes, MAG/Stalker)
│   ├── store/            # Zustand global stores (channels, favorites, portals, settings)
│   ├── theme/            # Design tokens, typography, colors, responsive scale helpers
│   ├── tv/               # Android TV specific D-pad key handlers and focus utilities
│   ├── types/            # TypeScript interface and type declarations
│   └── utils/            # Helper functions, storage (MMKV), device detection
├── android/              # Native Android project configuration and Gradle build files
├── patches/              # Patches applied to node_modules via patch-package
└── scripts/              # Helper maintenance scripts
```

---

## Coding Standards & Best Practices

### TypeScript
- Write clean, fully typed code. Avoid `any` whenever possible; create or extend interfaces in `src/types/`.
- Verify type correctness before committing:
  ```bash
  npx tsc --noEmit
  ```

### Android TV & D-Pad Focus
- **Every interactive UI component must be navigable with a TV D-pad remote** (`Up`, `Down`, `Left`, `Right`, `Select`, `Back`).
- Use `Focusable` and `FocusGroup` from `src/components/Focusable.tsx` for buttons, cards, list rows, and navigation tabs.
- Ensure the focused element has clear visual feedback:
  - Glowing border / high-contrast active state.
  - Scale transform or highlight indicator.
  - Proper focus restoration when navigating between screens.

### Design Tokens & Responsiveness
- The app runs on phone, tablet, and TV screens (1080p and 4K displays).
- Never use hardcoded pixel sizes for primary layouts.
- Use scaling helpers and design tokens from `src/theme/tokens.ts`:
  - `ps(value)`: Proportional scale helper calibrated for TV & tablet.
  - `pw(percentage)` / `ph(percentage)`: Percentage width/height helpers.
  - Colors and typography from the centralized theme tokens.
- Maintain the sleek, dark-first cinematic aesthetic across all views.

### Performance & Large Libraries
- IPTV playlists can contain 20,000+ streams.
- Always use `@shopify/flash-list` or virtualized lists for channel and VOD listings.
- Avoid passing inline anonymous functions or objects as props to list item renderers; memoize with `useCallback` and `React.memo`.
- Use chunked loading and lazy pagination for large datasets.

### State Management
- Use **Zustand** stores (`src/store/`) for shared application state.
- Keep UI components decoupled from raw API network calls; route requests through `src/services/`.
- Use `react-native-mmkv` for high-performance key-value persistence.

---

## Validation & Testing

Before creating a commit or opening a pull request, run all validation checks:

### 1. TypeScript Validation
```bash
npx tsc --noEmit
```

### 2. Linting
```bash
yarn lint
```

### 3. Native Android Build (if modifying native code or patches)
```bash
cd android
./gradlew assembleDebug
cd ..
```
*(On Windows PowerShell: `cd android; .\gradlew assembleDebug; cd ..`)*

---

## Pull Request Guidelines

1. **Branch Naming**:
   - `feat/feature-name` for new features
   - `fix/issue-description` for bug fixes
   - `perf/optimization` for performance improvements
   - `docs/update` for documentation changes

2. **Commit Messages**:
   - Write clear, imperative commit messages:
     - `feat: add audio track selector modal to video player`
     - `fix: prevent focus trap when navigating live tv categories`
     - `perf: optimize EPG row re-renders using FlashList`

3. **Pull Request Content**:
   - Use the template provided in [PULL_REQUEST_DESCRIPTION.md](PULL_REQUEST_DESCRIPTION.md).
   - Explain the **Why**, **How**, and **Test Plan**.
   - Attach screenshots or screen recordings showing both TV (D-Pad) and Mobile behavior where relevant.
   - Confirm that `npx tsc --noEmit` and `yarn lint` pass without errors.

---

## Need Help?

If you have questions or need guidance on implementation details, feel free to open a discussion or ask in your pull request draft. We are happy to help you get your contribution merged!
