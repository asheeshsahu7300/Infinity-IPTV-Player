// scripts/tizen-run.js
// Quick runner to install and launch Infinity IPTV Player on a Samsung Tizen TV or Emulator.

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const WGT_PATH = path.join(ROOT_DIR, "release-tizen", "com.infinity.iptvplayer_1.0.0.wgt");
const APP_ID = "xInfinity1.InfinityIPTV";

function findTool(toolName) {
  // Check PATH first
  try {
    execSync(`where ${toolName}`, { stdio: "ignore" });
    return toolName;
  } catch {}

  const homeDir = process.env.USERPROFILE || process.env.HOME || "";
  const candidates = [
    path.join(homeDir, ".tizen-extension-platform", "server", "sdktools", "data", "tools", toolName),
    path.join(homeDir, ".tizen-extension-platform", "server", "sdktools", "data", "tools", "tizen-core", toolName),
    path.join("C:", "tizen-studio", "tools", toolName),
    path.join("C:", "tizen-studio", "tools", "ide", "bin", toolName),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return `"${c}"`;
  }
  return null;
}

const sdb = findTool("sdb.exe") || "sdb";

console.log("====================================================");
console.log("📺 Deploying Infinity IPTV Player to Samsung Tizen TV");
console.log("====================================================");

if (!fs.existsSync(WGT_PATH)) {
  console.log("⚠️ Package not found. Building Tizen project first...");
  execSync("npm run build:tizen", { cwd: ROOT_DIR, stdio: "inherit" });
}

try {
  const deviceOutput = execSync(`${sdb} devices`, { encoding: "utf8" });
  const lines = deviceOutput.trim().split("\n").slice(1).map(l => l.trim()).filter(Boolean);

  if (lines.length === 0) {
    console.error("❌ No Samsung Tizen TV or Emulator detected.");
    console.error("   Please start your Tizen Emulator from VS Code or connect your Samsung Smart TV via sdb connect <IP>.");
    process.exit(1);
  }

  const targetDevice = lines[0].split(/\s+/)[0];
  console.log(`✓ Target device found: ${targetDevice} (${lines[0]})`);

  console.log(`\n📦 Installing ${path.basename(WGT_PATH)} on ${targetDevice}...`);
  execSync(`${sdb} -s ${targetDevice} install "${WGT_PATH}"`, { stdio: "inherit" });

  console.log(`\n🚀 Launching ${APP_ID}...`);
  execSync(`${sdb} -s ${targetDevice} shell "app_launcher -s ${APP_ID}"`, { stdio: "inherit" });

  console.log("\n====================================================");
  console.log("✨ App successfully running on Samsung Tizen TV!");
  console.log("====================================================");
} catch (err) {
  console.error("❌ Deployment failed:", err.message);
  process.exit(1);
}

