# LG webOS TV Developer Guide — Infinity IPTV Player

This guide documents the architecture, remote control handling, video streaming pipeline, and deployment workflow for running **Infinity IPTV Player** on LG webOS Smart TVs (webOS 3.5 through webOS 24).

---

## 1. Overview & Architecture

LG webOS TV applications run as hosted web applications packaged in the `.ipk` format.

```text
                  Infinity IPTV Player (webOS)
                                │
       ┌────────────────────────┼────────────────────────┐
       │                        │                        │
  LG Magic Remote         D-Pad Engine             Web Video Engine
(Air-mouse cursor)     (Spatial Navigation)     (Hardware HLS / HLS.js)
       │                        │                        │
       └────────────────────────┼────────────────────────┘
                                │
                     React Native for Web
                                │
                         Expo Router
```

### Key Compatibility Features:
1. **Remote Control Key Mapping**:
   - D-Pad: `ArrowUp` (38), `ArrowDown` (40), `ArrowLeft` (37), `ArrowRight` (39).
   - OK / Select: `Enter` (13).
   - **Back Button**: Handles webOS key code `461` via `BackHandler` polyfill, closing modals/drawers and navigating back to previous screens.
   - Media Keys: Play (415), Pause (19), PlayPause (402), FastForward (417), Rewind (412), Stop (413).
   - Channels: Channel Up / PageUp (33), Channel Down / PageDown (34).
   - Color Buttons: Red (403), Green (404), Yellow (405), Blue (406).

2. **LG Magic Remote Pointer Support**:
   - `Focusable` components handle hover states (`onHoverIn`), highlighting elements when pointed at with the LG air-mouse cursor.
   - Clicking with the Magic Remote wheel/trigger fires `handlePress`.

3. **2D Spatial Navigation**:
   - `WebSpatialNavigation` calculates Euclidean vectors between elements to provide directional focus jumping across grids and lists without relying on browser Tab sequences.

4. **Hardware Video Decoding & Streaming**:
   - Native hardware-accelerated playback for H.264, H.265/HEVC, and MPEG-TS via the webOS media pipeline.
   - Dual-mode HLS: Native `application/vnd.apple.mpegurl` on webOS TV hardware with automatic `HLS.js` fallback for standard browser environments.

---

## 2. Building the webOS TV Package

The project includes an automated build pipeline that exports the web application, optimizes index.html with a 1080p canvas, copies webOS assets and `appinfo.json`, and packages the `.ipk` file.

### Prerequisites:
Install the official webOS TV CLI (if not already installed):
```bash
npm install -g @webosose/ares-cli
```

### Build & Package Command:
```bash
npm run build:webos
```

This script performs:
1. `npx expo export --platform web` — bundles the application with Metro.
2. Creates `dist-webos/` with `appinfo.json`, 1080p viewport meta tags, and webOS icons.
3. Automatically runs `ares-package --no-minify dist-webos -o release-webos`.
4. Outputs the ready-to-install `.ipk` package to `release-webos/com.infinity.iptvplayer_1.0.0_all.ipk`.

---

## 3. Installing on an LG Smart TV

### Step 1: Enable Developer Mode on your LG TV
1. Install the **Developer Mode** app from the LG Content Store on your TV.
2. Launch the Developer Mode app and turn **Dev Mode On** and **Key Server On**.
3. Note the TV's IP address and Passphrase shown on screen.

### Step 2: Add your TV to the CLI
Run:
```bash
ares-setup-device
```
Enter a device name (e.g., `my-tv`), your TV's IP address, and port `9922`.

### Step 3: Get Device Key
```bash
ares-novacom --device my-tv --getkey
```
Enter the 6-character Passphrase displayed in the TV's Developer Mode app.

### Step 4: Install and Launch
```bash
# Install the package
ares-install --device my-tv release-webos/com.infinity.iptvplayer_1.0.0_all.ipk

# Launch the app
ares-launch --device my-tv com.infinity.iptvplayer
```

---

## 4. Manifest Configuration (`webos/appinfo.json`)

```json
{
  "id": "com.infinity.iptvplayer",
  "version": "1.0.0",
  "vendor": "Infinity",
  "type": "web",
  "main": "index.html",
  "title": "Infinity IPTV Player",
  "icon": "icon.png",
  "largeIcon": "largeIcon.png",
  "bgImage": "bgImage.png",
  "splashBackground": "splashBackground.png",
  "iconColor": "#000000",
  "bgColor": "#000000",
  "splashColor": "#000000",
  "resolution": "1920x1080",
  "disableBackHistoryAPI": true,
  "handlesRelaunch": true,
  "requiredPermissions": [],
  "trustLevel": "default",
  "allowCrossOrigin": true
}
```
