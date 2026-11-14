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
*(Or with Yarn: `yarn build:tizen`)*

This script performs:
1. `npx expo export --platform web` — bundles the application with Metro.
2. Creates `dist-tizen/` with `config.xml`, 1080p viewport meta tags, Samsung WebAPIs, and TV icons.
3. Patches Expo Router and JavaScript bundles for local `file://` execution.
4. Generates the installable `.wgt` package in:
   ```text
   release-tizen/com.infinity.iptvplayer_1.0.0.wgt
   ```

---

## 3. Installing on a Samsung Smart TV

### Step 1: Enable Developer Mode on your Samsung TV
1. On your Samsung TV remote, press the **Home** or **Smart Hub** button.
2. Go to **Apps** on your TV.
3. On the TV remote or on-screen numeric keypad, enter the sequence: **`1 2 3 4 5`**.
4. A Developer Mode popup dialog will appear.
5. Switch **Developer Mode** to **ON**.
6. In the **Host PC IP** field, enter your development computer's local IP address (e.g. `192.168.1.50`).
7. Click **OK**, then restart your Samsung TV (press and hold the remote's Power button for 3 seconds until the Samsung logo appears).

### Step 2: Connect via SDB (Samsung Device Bridge)
Make sure the Samsung Tizen Studio CLI / SDB is in your system PATH (or use Tizen Studio's Device Manager):

```bash
# Connect to your TV over Wi-Fi / LAN:
sdb connect <YOUR_TV_IP_ADDRESS>:26101

# Verify the connected TV:
sdb devices
```

### Step 3: Install and Launch the Application

```bash
# Install the package on your Samsung TV
tizen install -n release-tizen/com.infinity.iptvplayer_1.0.0.wgt -t <DEVICE_NAME>

# Launch the application
tizen run -p com.infinity.iptvplayer -t <DEVICE_NAME>
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

