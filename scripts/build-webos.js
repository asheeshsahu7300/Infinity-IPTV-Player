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

  // Step 4: Inject webOS TV tags into index.html
  console.log("🛠️  Step 4: Optimizing index.html for LG webOS TV 1080p canvas...");
  const indexPath = path.join(WEBOS_OUTPUT_DIR, "index.html");
  if (fs.existsSync(indexPath)) {
    let indexHtml = fs.readFileSync(indexPath, "utf8");

    // Replace or ensure 1920x1080 viewport and TV styling
    const webosHeadInjection = `
    <!-- LG webOS TV Metadata & Viewport -->
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
    `;

    indexHtml = indexHtml.replace("<head>", `<head>\n${webosHeadInjection}`);
    fs.writeFileSync(indexPath, indexHtml, "utf8");
    console.log("  ✓ Injected 1920x1080 viewport and TV overrides into index.html");
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
