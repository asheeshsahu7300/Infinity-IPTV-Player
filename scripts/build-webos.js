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

  // Step 3: Copy webOS manifest, assets, and official webOSTV libraries
  console.log("📋 Step 3: Copying appinfo.json, webOS icons, and webOSTV.js libraries...");
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

  // Copy official webOSTV.js libraries from node_modules
  const webosLibDir = path.resolve(ROOT_DIR, "node_modules", "webostvjs");
  const webosLibFiles = ["webOSTV.js", "webOSTV-dev.js"];
  for (const libFile of webosLibFiles) {
    const src = path.join(webosLibDir, libFile);
    const dest = path.join(WEBOS_OUTPUT_DIR, libFile);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      console.log(`  ✓ Bundled official webOS library: ${libFile}`);
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

    const webosHeadInjection = `
    <!-- Official LG webOS TV Libraries -->
    <script type="text/javascript" src="./webOSTV.js"></script>
    <script type="text/javascript" src="./webOSTV-dev.js"></script>
    <!-- LG webOS TV Metadata & Viewport -->
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
      window.__WEBOS__ = true;
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

      // Polyfill and normalize History API on file:// for webOS TV SPA
      if (typeof window !== "undefined" && window.location.protocol === "file:") {
        var _origPush = history.pushState ? history.pushState.bind(history) : null;
        var _origReplace = history.replaceState ? history.replaceState.bind(history) : null;

        var _toHashUrl = function(url) {
          if (!url || typeof url !== "string") return window.location.hash || "#/";
          if (url.startsWith("#")) return url;
          // Strip filesystem path or .html references
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

        // Intercept any root filesystem network calls (e.g. file:///D:/ or /) to prevent red errors in webOS
        var _origFetch = window.fetch;
        if (_origFetch) {
          window.fetch = function(input, init) {
            var urlStr = typeof input === "string" ? input : (input && input.url ? input.url : "");
            if (urlStr === "/" || urlStr === "" || urlStr === "file:///D:/" || urlStr.startsWith("/D:/") || (urlStr.startsWith("file://") && !urlStr.includes("dist-webos"))) {
              console.warn("[webOS Network Guard] Prevented local drive fetch:", urlStr);
              return Promise.resolve(new Response("", { status: 200, statusText: "OK" }));
            }
            return _origFetch.apply(this, arguments);
          };
        }
        var _origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url) {
          var urlStr = typeof url === "string" ? url : "";
          if (urlStr === "/" || urlStr === "" || urlStr === "file:///D:/" || urlStr.startsWith("/D:/") || (urlStr.startsWith("file://") && !urlStr.includes("dist-webos"))) {
            console.warn("[webOS Network Guard] Prevented local drive XHR:", urlStr);
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

        // Guard against any anchor click attempting to navigate to root filesystem (file://D:/...)
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
    content = content.replace("<head>", `<head>\n${webosHeadInjection}`);

    fs.writeFileSync(filePath, content, "utf8");
    console.log(`  ✓ Patched relative paths and injected webOS runtime in ${htmlFile}`);
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

      // In Expo Router's getInitialURLWithTimeout, replace bare window.location.href
      jsContent = jsContent.replace(
        /return'undefined'==typeof window\?'':window\.location\.href/g,
        "return'undefined'==typeof window?'':(window.location.protocol==='file:'?('http://localhost'+(window.location.hash.startsWith('#/')?window.location.hash.slice(1):'/')):window.location.href)"
      );

      // In Expo Router's useLinking (initial state resolver), normalize pathname to hash route or '/'
      jsContent = jsContent.replace(
        /r=t\?t\.pathname\+t\.search:void 0/g,
        "r=t?(window.location.protocol==='file:'?(window.location.hash.startsWith('#/')?window.location.hash.slice(1):'/'):t.pathname+t.search):void 0"
      );

      // In Expo Router's state listener, replace the entire path construction (including n.hash) on file://
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
