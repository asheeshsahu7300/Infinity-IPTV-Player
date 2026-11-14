# Samsung Smart TV (Tizen OS) Developer Guide — Infinity IPTV Player

This guide documents the architecture, remote control handling, video streaming pipeline, and deployment workflow for running **Infinity IPTV Player** on Samsung Smart TVs running Tizen OS (Tizen 3.0 through Tizen 8.0+, 2017–2025 Samsung TVs).

---

## 1. Overview & Architecture

Samsung Smart TV applications run as hosted web applications packaged in the `.wgt` (widget) format.

```text
                 Infinity IPTV Player (Samsung Tizen)
                                  │
         ┌────────────────────────┼────────────────────────┐
         │                        │                        │
  Samsung TV Remote          D-Pad Engine             Web Video Engine
 (D-Pad & Media Keys)    (Spatial Navigation)     (AVPlay / HLS.js / HTML5)
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
   - **Return / Back Button**: Handles Samsung TV Return key code `10009` via `BackHandler` polyfill, closing modals/drawers and navigating back to previous screens or gracefully exiting the app.
   - Media Keys: Play (`415`), Pause (`19`), PlayPause (`10252` / `402`), FastForward (`417`), Rewind (`412`), Stop (`413`).
   - Channels: Channel Up (`427` / `33`), Channel Down (`428` / `34`).
   - Color Buttons: Red (`403`), Green (`404`), Yellow (`405`), Blue (`406`).
   - Number Keys: `0` through `9` for direct channel number dialing.

2. **Automatic Key Registration**:
   - Samsung Smart TVs require TV apps to explicitly register media and color keys using `tizen.tvinputdevice.registerKey()`.
   - `src/utils/tizenUtils.ts` automatically registers all media, color, channel, and numeric keys on app launch.

3. **2D Spatial Navigation**:
   - `WebSpatialNavigation` calculates Euclidean vectors between elements to provide directional focus jumping across grids and lists without relying on browser Tab sequences.

4. **Hardware Video Decoding & Streaming**:
   - High-performance streaming support via HTML5 `<video>`, `HLS.js`, and Samsung's native `webapis.avplay` hardware decoder pipeline.
   - Smooth 1080p and 4K playback of H.264, H.265/HEVC, and MPEG-TS IPTV streams.

---

## 2. Building the Samsung Tizen TV Package

The project includes an automated build pipeline that exports the web application, optimizes index.html with a 1080p canvas, copies Tizen assets and `config.xml`, and packages the `.wgt` file.

### Build & Package Command:
```bash
npm run build:tizen
```

### Run & Deploy to Emulator or TV with One Command:
```bash
npm run run:tizen
```

This script performs:
1. `npx expo export --platform web` — bundles the application with Metro.
2. Creates `dist-tizen/` with `config.xml`, 1080p viewport meta tags, Samsung WebAPIs, and TV icons.
3. Patches Expo Router and JavaScript bundles for local `file://` execution.
4. Generates and automatically signs the installable `.wgt` package in:
   ```text
   release-tizen/com.infinity.iptvplayer_1.0.0.wgt
   ```
5. `npm run run:tizen` automatically detects any connected Samsung TV or active Tizen Emulator, installs the package, and launches it immediately.

---

## 3. Installing on Emulator or Samsung Smart TV

### Quick Run (Automated)
Ensure your emulator or TV is online, then run:
```bash
npm run run:tizen
```

### SDB & CLI Tools Location (VS Code Tizen Extension)
If running manually and `sdb` is not in your global `PATH`, the tools are located at:
- **SDB**: `C:\Users\<username>\.tizen-extension-platform\server\sdktools\data\tools\sdb.exe`
- **Tizen CLI (tz)**: `C:\Users\<username>\.tizen-extension-platform\server\sdktools\data\tools\tizen-core\tz.exe`

To add them to your PowerShell session temporarily:
```powershell
$env:PATH += ";$env:USERPROFILE\.tizen-extension-platform\server\sdktools\data\tools;$env:USERPROFILE\.tizen-extension-platform\server\sdktools\data\tools\tizen-core"
```

### Step 1: Enable Developer Mode on your Samsung TV
1. On your Samsung TV remote, press the **Home** or **Smart Hub** button.
2. Go to **Apps** on your TV.
3. On the TV remote or on-screen numeric keypad, enter the sequence: **`1 2 3 4 5`**.
4. A Developer Mode popup dialog will appear.
5. Switch **Developer Mode** to **ON**.
6. In the **Host PC IP** field, enter your development computer's local IP address (e.g. `192.168.1.50`).
7. Click **OK**, then restart your Samsung TV (press and hold the remote's Power button for 3 seconds until the Samsung logo appears).

### Step 2: Connect via SDB (Samsung Device Bridge)
```bash
# Connect to your TV over Wi-Fi / LAN:
sdb connect <YOUR_TV_IP_ADDRESS>:26101

# Verify the connected TV or Emulator:
sdb devices
```

### Step 3: Install and Launch the Application

```bash
# Install the package on your Samsung TV or Emulator
sdb -s <DEVICE_ID> install release-tizen/com.infinity.iptvplayer_1.0.0.wgt

# Launch the application
sdb -s <DEVICE_ID> shell "app_launcher -s xInfinity1.InfinityIPTV"
```

---

## 4. Manifest Configuration (`tizen/config.xml`)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns="http://www.w3.org/ns/widgets" 
        xmlns:tizen="http://tizen.org/ns/widgets" 
        id="http://infinity.com/iptvplayer" 
        version="1.0.0" 
        viewmodes="maximized">
    <tizen:application id="com.infinity.iptvplayer" 
                       package="com.infinity" 
                       required_version="3.0"/>
    <content src="index.html"/>
    <feature name="http://tizen.org/feature/screen.size.all"/>
    <icon src="icon.png"/>
    <name>Infinity IPTV Player</name>
    <description>High-performance modern IPTV player for live TV, movies, and series streaming on Samsung Smart TV.</description>
    <tizen:profile name="tv-samsung"/>
    <tizen:setting screen-orientation="landscape" context-menu="enable" background-support="disable" encryption="disable" install-location="auto"/>
    <tizen:privilege name="http://tizen.org/privilege/internet"/>
    <tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/>
    <tizen:privilege name="http://tizen.org/privilege/application.launch"/>
    <tizen:privilege name="http://tizen.org/privilege/filesystem.read"/>
    <tizen:privilege name="http://tizen.org/privilege/filesystem.write"/>
    <tizen:privilege name="http://developer.samsung.com/privilege/network.public"/>
    <tizen:privilege name="http://developer.samsung.com/privilege/avplay"/>
    <access origin="*" subdomains="true"/>
    <tizen:allow-navigation>*</tizen:allow-navigation>
</widget>
```

---

## 5. Samsung Apps TV Seller Lounge Certification & QA Checklist

When submitting **Infinity IPTV Player** to the [Samsung Apps TV Seller Lounge](https://seller.samsungapps.com/tv), ensure the following certification criteria are met:

### 1. Store Assets & Metadata
- **App Icon**: `512x512` PNG (provided in `tizen/store-assets/icon-512x512.png`).
- **Store Screenshots**: At least 4 screenshots at `1920x1080` (provided in `tizen/store-assets/` for Dashboard, Live TV, EPG, VOD, and Series).
- **Category**: Video / Entertainment.
- **Rating**: 12+ (Media player).

### 2. Functional & QA Requirements
- **App Launch Time**: Cold-boot within 5 seconds without showing a blank white/black screen.
- **10-Foot D-Pad Usability**: All interactive cards, menus, and input fields must be navigable via directional arrow keys and Enter/Select.
- **Return Key Navigation**: The remote's Return button (`10009`) must navigate back sequentially through modals, overlays, and previous routes before closing the app.
- **Physical Exit Key**: The `Exit` button (`10182`) must exit the application immediately via `tizen.application.getCurrentApplication().exit()`.
- **Media Keys Compliance**: Physical `Play`, `Pause`, `FastForward`, and `Rewind` keys must control playback state on both Live TV and VOD.
- **Multi-Track Audio**: Automatic audio track engagement prevents muted playback on multi-language IPTV streams.
- **Memory Consumption**: Peak memory must remain below 1GB during continuous 30-minute streaming on standard Samsung Smart TVs.


