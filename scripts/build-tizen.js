// scripts/build-tizen.js
// Automated build and packaging pipeline for Samsung Smart TV (Tizen OS).
// Exports the Expo web application, configures Tizen TV metadata & config.xml,
// injects 1080p spatial navigation meta tags and Tizen WebAPIs, and generates the .wgt package.

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.resolve(ROOT_DIR, "dist");
const TIZEN_SRC_DIR = path.resolve(ROOT_DIR, "tizen");
const TIZEN_OUTPUT_DIR = path.resolve(ROOT_DIR, "dist-tizen");
const PACKAGE_OUTPUT_DIR = path.resolve(ROOT_DIR, "release-tizen");

console.log("====================================================");
console.log("🚀 Building Infinity IPTV Player for Samsung Tizen TV");
console.log("====================================================");

try {
  // Step 1: Export web bundle with Expo
  console.log("\n📦 Step 1: Exporting Expo Web Bundle...");
  execSync("npx expo export --platform web", {
    cwd: ROOT_DIR,
    stdio: "inherit",
  });

  // Step 2: Prepare Tizen distribution directory
  console.log("\n📁 Step 2: Preparing Tizen Distribution Directory...");
  if (fs.existsSync(TIZEN_OUTPUT_DIR)) {
    fs.rmSync(TIZEN_OUTPUT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TIZEN_OUTPUT_DIR, { recursive: true });

  // Copy dist files into TIZEN_OUTPUT_DIR
  fs.cpSync(DIST_DIR, TIZEN_OUTPUT_DIR, { recursive: true });

  // Step 3: Copy Tizen manifest and assets
  console.log("📋 Step 3: Copying config.xml and Tizen icons...");
  const tizenAssets = ["config.xml", "icon.png"];

  for (const asset of tizenAssets) {
    const srcPath = path.join(TIZEN_SRC_DIR, asset);
    const destPath = path.join(TIZEN_OUTPUT_DIR, asset);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, destPath);
      console.log(`  ✓ Copied ${asset}`);
    } else {
      console.warn(`  ⚠️ Asset ${asset} not found in ${TIZEN_SRC_DIR}`);
    }
  }

  // Step 4: Optimize HTML and JavaScript bundles for local file:// execution on Samsung Tizen TV
  console.log("🛠️  Step 4: Optimizing assets and index.html for Samsung Tizen TV (file:// protocol & 1080p)...");

  // 4a. Process all HTML files in TIZEN_OUTPUT_DIR
  const htmlFiles = fs.readdirSync(TIZEN_OUTPUT_DIR).filter((f) => f.endsWith(".html"));
  for (const htmlFile of htmlFiles) {
    const filePath = path.join(TIZEN_OUTPUT_DIR, htmlFile);
    let content = fs.readFileSync(filePath, "utf8");

    // Replace root-relative paths with relative paths
    content = content.replace(/src="\/_expo\//g, 'src="./_expo/');
    content = content.replace(/href="\/favicon\.ico"/g, 'href="./favicon.ico"');
    content = content.replace(/href="\/_expo\//g, 'href="./_expo/');
    content = content.replace(/src="\/assets\//g, 'src="./assets/');
    content = content.replace(/href="\/assets\//g, 'href="./assets/');

    // Remove type="module" on inline hydration script for standard file:// execution
    content = content.replace(/<script type="module">/g, "<script>");

    const tizenHeadInjection = `
    <!-- Official Samsung Smart TV WebAPIs -->
    <script type="text/javascript" src="$WEBAPIS/webapis/webapis.js"></script>
    <!-- Samsung Tizen TV Metadata & Viewport -->
    <meta name="viewport" content="width=1920, height=1080, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <meta name="format-detection" content="telephone=no" />
    <style>
      html, body, #root {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 100% !important;
        height: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
        background-color: #08080a !important;
        -webkit-user-select: none !important;
        user-select: none !important;
      }
    </style>
    <script>
      window.__TIZEN__ = true;

      // Permanently lock document/window scroll to (0, 0) for fixed 1080p TV UI
      var _resetScroll = function() {
        if (window.scrollX !== 0 || window.scrollY !== 0) {
          window.scrollTo(0, 0);
        }
        if (document.documentElement && (document.documentElement.scrollTop !== 0 || document.documentElement.scrollLeft !== 0)) {
          document.documentElement.scrollTop = 0;
          document.documentElement.scrollLeft = 0;
        }
        if (document.body && (document.body.scrollTop !== 0 || document.body.scrollLeft !== 0)) {
          document.body.scrollTop = 0;
          document.body.scrollLeft = 0;
        }
      };

      window.addEventListener("scroll", _resetScroll, { passive: false });
      window.addEventListener("popstate", _resetScroll);
      window.addEventListener("hashchange", _resetScroll);
      window.addEventListener("focus", _resetScroll, true);

      // Register Tizen TV physical remote keys as soon as window loads
      window.addEventListener("load", function() {
        try {
          if (window.tizen && window.tizen.tvinputdevice && typeof window.tizen.tvinputdevice.registerKey === "function") {
            var keys = [
              "MediaPlay", "MediaPause", "MediaStop", "MediaFastForward", "MediaRewind", "MediaPlayPause",
              "ColorF0Red", "ColorF1Green", "ColorF2Yellow", "ColorF3Blue",
              "ChannelUp", "ChannelDown", "Info",
              "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"
            ];
            keys.forEach(function(k) {
              try { window.tizen.tvinputdevice.registerKey(k); } catch(e){}
            });
            console.log("[Tizen Bootstrap] Remote keys registered.");
          }
        } catch (err) {
          console.warn("[Tizen Bootstrap] Remote key registration notice:", err);
        }
      });

      // Polyfill and normalize History API on file:// for Tizen TV SPA
      if (typeof window !== "undefined" && window.location.protocol === "file:") {
        var _origPush = history.pushState ? history.pushState.bind(history) : null;
        var _origReplace = history.replaceState ? history.replaceState.bind(history) : null;

        var _toHashUrl = function(url) {
          if (!url || typeof url !== "string") return window.location.hash || "#/";
          if (url.startsWith("#")) return url;
          if (url.includes(".html#")) {
            return "#" + url.split(".html#")[1];
          }
          if (url.includes(".html")) {
            var afterHtml = url.split(".html")[1];
            return afterHtml ? "#" + afterHtml : "#/";
          }
          if (url.startsWith("/")) {
            return "#" + url;
          }
          return "#/" + url;
        };

        history.pushState = function(state, title, url) {
          var targetHash = _toHashUrl(url);
          var pushed = false;
          if (_origPush) {
            try {
              _origPush(state, title, targetHash);
              pushed = true;
            } catch (e) {}
          }
          if (!pushed) {
            try {
              if (window.location.hash !== targetHash) {
                window.location.hash = targetHash;
              }
            } catch (err) {}
          }
          _resetScroll();
        };

        history.replaceState = function(state, title, url) {
          var targetHash = _toHashUrl(url);
          var replaced = false;
          if (_origReplace) {
            try {
              _origReplace(state, title, targetHash);
              replaced = true;
            } catch (e) {}
          }
          if (!replaced) {
            try {
              if (window.location.hash !== targetHash) {
                window.location.replace(targetHash);
              }
            } catch (err) {}
          }
          _resetScroll();
        };

        // Intercept root filesystem network calls to prevent errors on Tizen TV
        var _origFetch = window.fetch;
        if (_origFetch) {
          window.fetch = function(input, init) {
            var urlStr = typeof input === "string" ? input : (input && input.url ? input.url : "");
            if (urlStr === "/" || urlStr === "" || urlStr === "file:///D:/" || urlStr.startsWith("/D:/") || (urlStr.startsWith("file://") && !urlStr.includes("dist-tizen"))) {
              console.warn("[Tizen Network Guard] Prevented local drive fetch:", urlStr);
              return Promise.resolve(new Response("", { status: 200, statusText: "OK" }));
            }
            return _origFetch.apply(this, arguments);
          };
        }
        var _origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url) {
          var urlStr = typeof url === "string" ? url : "";
          if (urlStr === "/" || urlStr === "" || urlStr === "file:///D:/" || urlStr.startsWith("/D:/") || (urlStr.startsWith("file://") && !urlStr.includes("dist-tizen"))) {
            console.warn("[Tizen Network Guard] Prevented local drive XHR:", urlStr);
            return;
          }
          return _origOpen.apply(this, arguments);
        };

        var _origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
        var _unsafeHeaders = {
          "user-agent": 1,
          "accept-encoding": 1,
          "cookie": 1,
          "cookie2": 1,
          "connection": 1,
          "content-length": 1,
          "date": 1,
          "expect": 1,
          "host": 1,
          "origin": 1,
          "referer": 1,
          "te": 1,
          "upgrade": 1,
          "via": 1
        };
        XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
          if (header && _unsafeHeaders[String(header).toLowerCase()]) {
            return;
          }
          return _origSetHeader.apply(this, arguments);
        };

        // Guard against any anchor click attempting to navigate to root filesystem
        document.addEventListener("click", function(e) {
          var el = e.target;
          while (el && el.tagName !== "A") {
            el = el.parentElement;
          }
          if (el && el.tagName === "A") {
            var href = el.getAttribute("href");
            if (href && (href.startsWith("/") || href.startsWith("./")) && !href.startsWith("#") && !href.includes(".html")) {
              e.preventDefault();
              window.location.hash = _toHashUrl(href);
            }
          }
        }, true);
      }
    </script>
    `;
    content = content.replace("<head>", `<head>\n${tizenHeadInjection}`);

    fs.writeFileSync(filePath, content, "utf8");
    console.log(`  ✓ Patched relative paths and injected Tizen runtime in ${htmlFile}`);
  }

  // 4b. Patch JS bundles to support file:// protocol on Samsung Tizen
  const jsDir = path.join(TIZEN_OUTPUT_DIR, "_expo", "static", "js", "web");
  if (fs.existsSync(jsDir)) {
    const jsFiles = fs.readdirSync(jsDir).filter((f) => f.endsWith(".js"));
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

      // In Expo Router's getInitialURLWithTimeout, replace bare window.location.href
      jsContent = jsContent.replace(
        /return'undefined'==typeof window\?'':window\.location\.href/g,
        "return'undefined'==typeof window?'':(window.location.protocol==='file:'?('http://localhost'+(window.location.hash.startsWith('#/')?window.location.hash.slice(1):'/')):window.location.href)"
      );

      // In Expo Router's useLinking, normalize pathname to hash route or '/'
      jsContent = jsContent.replace(
        /r=t\?t\.pathname\+t\.search:void 0/g,
        "r=t?(window.location.protocol==='file:'?(window.location.hash.startsWith('#/')?window.location.hash.slice(1):'/'):t.pathname+t.search):void 0"
      );

      // In Expo Router's state listener, replace path construction on file://
      jsContent = jsContent.replace(
        /n\.pathname\+n\.search\+n\.hash/g,
        "(window.location.protocol==='file:'?(window.location.hash.startsWith('#/')?window.location.hash.slice(1):'/'):(n.pathname+n.search+n.hash))"
      );

      jsContent = jsContent.replace(
        /n\.pathname\+n\.search/g,
        "(window.location.protocol==='file:'?(window.location.hash.startsWith('#/')?window.location.hash.slice(1):'/'):n.pathname+n.search)"
      );

      // In Expo Router's createMemoryHistory, ensure push and replace pass hash on file://
      jsContent = jsContent.replace(
        /window\.history\.pushState\(\{id:([a-zA-Z0-9_]+)\},'',([a-zA-Z0-9_]+)\)/g,
        "window.history.pushState({id:$1},'',(window.location.protocol==='file:'?('#'+($2.startsWith('/')?$2:'/'+$2)):$2))"
      );

      jsContent = jsContent.replace(
        /window\.history\.replaceState\(\{id:([a-zA-Z0-9_]+)\},'',([a-zA-Z0-9_]+)\)/g,
        "window.history.replaceState({id:$1},'',(window.location.protocol==='file:'?('#'+($2.startsWith('/')?$2:'/'+$2)):$2))"
      );

      fs.writeFileSync(jsPath, jsContent, "utf8");
      console.log(`  ✓ Patched web bundle for file:// execution: ${jsFile}`);
    }
  }

  // Step 5: Package into Tizen .wgt package
  console.log("\n📦 Step 5: Packaging into Samsung Tizen .wgt package...");
  if (!fs.existsSync(PACKAGE_OUTPUT_DIR)) {
    fs.mkdirSync(PACKAGE_OUTPUT_DIR, { recursive: true });
  }

  let tizenCliFound = false;
  try {
    execSync("tizen version", { stdio: "ignore" });
    tizenCliFound = true;
  } catch {}

  const wgtFileName = "com.infinity.iptvplayer_1.0.0.wgt";
  const wgtFilePath = path.join(PACKAGE_OUTPUT_DIR, wgtFileName);
  const zipFileName = "com.infinity.iptvplayer.zip";
  const zipFilePath = path.join(PACKAGE_OUTPUT_DIR, zipFileName);

  if (tizenCliFound) {
    console.log("  ✓ Tizen CLI detected! Packaging with Tizen Studio CLI...");
    execSync(`tizen package -t wgt -s default "${TIZEN_OUTPUT_DIR}" -o "${PACKAGE_OUTPUT_DIR}"`, {
      cwd: ROOT_DIR,
      stdio: "inherit",
    });
    console.log(`\n🎉 Success! Tizen package generated via Tizen CLI in: ${PACKAGE_OUTPUT_DIR}`);
  } else {
    console.log("  ℹ️ Tizen CLI not found in system PATH. Generating standard compliant .wgt package...");
    // A Tizen .wgt is a standard ZIP archive containing config.xml at the root
    try {
      // Create zip file first
      execSync(`tar -a -cf "${zipFilePath}" -C "${TIZEN_OUTPUT_DIR}" .`, {
        cwd: ROOT_DIR,
        stdio: "inherit",
      });
      // Copy to .wgt
      fs.copyFileSync(zipFilePath, wgtFilePath);
      console.log(`  ✓ Generated installable Tizen package: ${wgtFilePath}`);
      console.log(`  ✓ Generated backup archive: ${zipFilePath}`);
    } catch (zipErr) {
      console.warn("  ⚠️ Warning during archive creation:", zipErr.message);
    }
  }

  console.log("\n====================================================");
  console.log("✨ Samsung Tizen TV build completed successfully!");
  console.log(`📂 Web app output:  ${TIZEN_OUTPUT_DIR}`);
  console.log(`📦 Tizen WGT package: ${wgtFilePath}`);
  console.log("====================================================");
} catch (error) {
  console.error("❌ Tizen build failed:", error);
  process.exit(1);
}

