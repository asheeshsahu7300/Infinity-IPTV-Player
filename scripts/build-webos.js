// scripts/build-webos.js
// Automated build and packaging pipeline for LG webOS TV.
// Exports the Expo web application, configures webOS TV metadata & appinfo.json,
// injects 1080p spatial navigation meta tags, and generates the .ipk package.

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.resolve(ROOT_DIR, "dist");
const WEBOS_SRC_DIR = path.resolve(ROOT_DIR, "webos");
const WEBOS_OUTPUT_DIR = path.resolve(ROOT_DIR, "dist-webos");

console.log("====================================================");
console.log("🚀 Building Infinity IPTV Player for LG webOS TV");
console.log("====================================================");

try {
  // Step 1: Export web bundle with Expo
  console.log("\n📦 Step 1: Exporting Expo Web Bundle...");
  execSync("npx expo export --platform web", {
    cwd: ROOT_DIR,
    stdio: "inherit",
  });

  // Step 2: Prepare webOS distribution directory
  console.log("\n📁 Step 2: Preparing webOS Distribution Directory...");
  if (fs.existsSync(WEBOS_OUTPUT_DIR)) {
    fs.rmSync(WEBOS_OUTPUT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(WEBOS_OUTPUT_DIR, { recursive: true });

  // Copy dist files into WEBOS_OUTPUT_DIR
  fs.cpSync(DIST_DIR, WEBOS_OUTPUT_DIR, { recursive: true });

  // Step 3: Copy webOS manifest and assets
  console.log("📋 Step 3: Copying appinfo.json and webOS icons...");
  const webosAssets = [
    "appinfo.json",
    "icon.png",
    "largeIcon.png",
    "bgImage.png",
    "splashBackground.png",
  ];

  for (const asset of webosAssets) {
    const srcPath = path.join(WEBOS_SRC_DIR, asset);
    const destPath = path.join(WEBOS_OUTPUT_DIR, asset);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, destPath);
      console.log(`  ✓ Copied ${asset}`);
    } else {
      console.warn(`  ⚠️ Asset ${asset} not found in ${WEBOS_SRC_DIR}`);
    }
  }

  // Step 4: Optimize HTML and JavaScript bundles for local file:// execution on webOS TV
  console.log("🛠️  Step 4: Optimizing assets and index.html for LG webOS TV (file:// protocol & 1080p)...");

  // 4a. Process all HTML files in WEBOS_OUTPUT_DIR
  const htmlFiles = fs.readdirSync(WEBOS_OUTPUT_DIR).filter(f => f.endsWith(".html"));
  for (const htmlFile of htmlFiles) {
    const filePath = path.join(WEBOS_OUTPUT_DIR, htmlFile);
    let content = fs.readFileSync(filePath, "utf8");

    // Replace root-relative paths with relative paths
    content = content.replace(/src="\/_expo\//g, 'src="./_expo/');
    content = content.replace(/href="\/favicon\.ico"/g, 'href="./favicon.ico"');
    content = content.replace(/href="\/_expo\//g, 'href="./_expo/');
    content = content.replace(/src="\/assets\//g, 'src="./assets/');
    content = content.replace(/href="\/assets\//g, 'href="./assets/');

    // Remove type="module" on inline hydration script for standard file:// execution
    content = content.replace(/<script type="module">/g, '<script>');

    if (htmlFile === "index.html") {
      const webosHeadInjection = `
    <!-- LG webOS TV Metadata, Base & Viewport -->
    <base href="./" />
    <meta name="viewport" content="width=1920, height=1080, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <meta name="format-detection" content="telephone=no" />
    <style>
      html, body, #root {
        width: 1920px !important;
        height: 1080px !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
        background-color: #08080a !important;
        -webkit-user-select: none !important;
        user-select: none !important;
      }
    </style>
    <script>
      window.__WEBOS__ = true;
      // Polyfill and normalize History API on file:// for webOS TV SPA
      if (typeof window !== "undefined" && window.location.protocol === "file:") {
        var _origPush = history.pushState;
        var _origReplace = history.replaceState;
        var _normalizeFileUrl = function(url) {
          if (!url || typeof url !== "string") return window.location.pathname;
          if (url.startsWith("#")) return window.location.pathname + url;
          if (url.startsWith("/") && !url.includes(".html")) {
            return window.location.pathname + "#" + url;
          }
          return url;
        };
        history.pushState = function(state, title, url) {
          try {
            return _origPush.call(this, state, title, _normalizeFileUrl(url));
          } catch (e) {}
        };
        history.replaceState = function(state, title, url) {
          try {
            return _origReplace.call(this, state, title, _normalizeFileUrl(url));
          } catch (e) {}
        };
      }
    </script>
      `;
      content = content.replace("<head>", `<head>\n${webosHeadInjection}`);
    }

    fs.writeFileSync(filePath, content, "utf8");
    console.log(`  ✓ Patched relative paths in ${htmlFile}`);
  }

  // 4b. Patch JS bundles to support file:// protocol on webOS
  const jsDir = path.join(WEBOS_OUTPUT_DIR, "_expo", "static", "js", "web");
  if (fs.existsSync(jsDir)) {
    const jsFiles = fs.readdirSync(jsDir).filter(f => f.endsWith(".js"));
    for (const jsFile of jsFiles) {
      const jsPath = path.join(jsDir, jsFile);
      let jsContent = fs.readFileSync(jsPath, "utf8");

      // Replace root-relative asset URLs with relative paths for icons & fonts
      jsContent = jsContent.replace(/"\/assets\//g, '"./assets/');

      // Ensure Expo Router boots with hash or root route ("/") instead of full filesystem path under file://
      jsContent = jsContent.replace(
        /new URL\(window\.location\.href\)/g,
        "new URL(window.location.protocol==='file:'?('http://localhost'+(window.location.hash.startsWith('#/')?window.location.hash.slice(1):'/')):window.location.href)"
      );

      jsContent = jsContent.replace(
        /window\.location\?\.href/g,
        "(window.location.protocol==='file:'?('http://localhost'+(window.location.hash.startsWith('#/')?window.location.hash.slice(1):'/')):window.location?.href)"
      );

      // In Expo Router's getInitialURL, replace `return window.location.href;`
      jsContent = jsContent.replace(
        /return window\.location\.href;/g,
        "return (window.location.protocol==='file:'?('http://localhost'+(window.location.hash.startsWith('#/')?window.location.hash.slice(1):'/')):window.location.href);"
      );

      // In Expo Router's useLinking (initial state resolver), normalize pathname to hash route or '/'
      jsContent = jsContent.replace(
        /r=t\?t\.pathname\+t\.search:void 0/g,
        "r=t?(window.location.protocol==='file:'?(window.location.hash.startsWith('#/')?window.location.hash.slice(1):'/'):t.pathname+t.search):void 0"
      );

      // In Expo Router's state listener, normalize pathname to hash route or '/' on file://
      jsContent = jsContent.replace(
        /n\.pathname\+n\.search/g,
        "(window.location.protocol==='file:'?(window.location.hash.startsWith('#/')?window.location.hash.slice(1):'/'):n.pathname+n.search)"
      );

      fs.writeFileSync(jsPath, jsContent, "utf8");
      console.log(`  ✓ Patched web bundle for file:// execution: ${jsFile}`);
    }
  }

  // Step 5: Check for webOS CLI (ares-package)
  console.log("\n📦 Step 5: Checking for LG webOS TV CLI (ares-package)...");
  let aresFound = false;
  try {
    execSync("ares-package -V", { stdio: "ignore" });
    aresFound = true;
  } catch {}

  if (aresFound) {
    console.log("  ✓ ares-package detected! Generating .ipk package...");
    const packageOutputDir = path.resolve(ROOT_DIR, "release-webos");
    if (!fs.existsSync(packageOutputDir)) {
      fs.mkdirSync(packageOutputDir, { recursive: true });
    }
    execSync(`ares-package --no-minify "${WEBOS_OUTPUT_DIR}" -o "${packageOutputDir}"`, {
      cwd: ROOT_DIR,
      stdio: "inherit",
    });
    console.log(`\n🎉 Success! webOS IPK generated in: ${packageOutputDir}`);
  } else {
    console.log("  ℹ️ ares-package (LG webOS CLI) not found in system PATH.");
    console.log(`  ✓ WebOS app build completed in: ${WEBOS_OUTPUT_DIR}`);
    console.log("\nTo create an installable .ipk package:");
    console.log("  1. npm install -g @webosose/ares-cli");
    console.log(`  2. ares-package "${WEBOS_OUTPUT_DIR}" -o release-webos\n`);
  }

  console.log("====================================================");
  console.log("✨ webOS TV build completed successfully!");
  console.log("====================================================");
} catch (error) {
  console.error("❌ webOS build failed:", error);
  process.exit(1);
}
