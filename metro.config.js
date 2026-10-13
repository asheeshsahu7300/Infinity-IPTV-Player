// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");
const path = require('path');
const { FileStore } = require('metro-cache');

const config = getDefaultConfig(__dirname);

// Use a stable on-disk store (shared across web/android)
const root = process.env.METRO_CACHE_ROOT || path.join(__dirname, '.metro-cache');
config.cacheStores = [
    new FileStore({ root: path.join(root, 'cache') }),
];


// // Exclude unnecessary directories from file watching
// config.watchFolders = [__dirname];
// config.resolver.blacklistRE = /(.*)\/(__tests__|android|ios|build|dist|.git|node_modules\/.*\/android|node_modules\/.*\/ios|node_modules\/.*\/windows|node_modules\/.*\/macos)(\/.*)?$/;

// // Alternative: use a more aggressive exclusion pattern
// config.resolver.blacklistRE = /node_modules\/.*\/(android|ios|windows|macos|__tests__|\.git|.*\.android\.js|.*\.ios\.js)$/;

// Configure web resolver for browser-safe builds (prevent Node agent-base / https-proxy-agent crashes)
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (platform === 'web') {
        if (moduleName === 'axios') {
            return {
                filePath: path.resolve(__dirname, 'node_modules/axios/dist/browser/axios.cjs'),
                type: 'sourceFile',
            };
        }
        if (
            moduleName === 'https-proxy-agent' ||
            moduleName === 'agent-base' ||
            moduleName === 'http' ||
            moduleName === 'https'
        ) {
            return {
                type: 'empty',
            };
        }
    }

    if (originalResolveRequest) {
        return originalResolveRequest(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
};

// Local development CORS proxy middleware
const http = require('http');
const https = require('https');
const urlModule = require('url');

config.server = {
    ...config.server,
    enhanceMiddleware: (metroMiddleware) => {
        return (req, res, next) => {
            if (req.url && req.url.startsWith('/__dev_proxy?url=')) {
                const targetUrl = decodeURIComponent(req.url.replace('/__dev_proxy?url=', ''));
                try {
                    const parsed = urlModule.parse(targetUrl);
                    const client = parsed.protocol === 'https:' ? https : http;

                    const forwardHeaders = { ...req.headers };
                    delete forwardHeaders.host;
                    delete forwardHeaders.origin;
                    delete forwardHeaders.referer;
                    forwardHeaders['host'] = parsed.host;

                    const proxyReq = client.request(targetUrl, {
                        method: req.method,
                        headers: forwardHeaders,
                        timeout: 30000,
                    }, (proxyRes) => {
                        res.setHeader('Access-Control-Allow-Origin', '*');
                        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
                        res.setHeader('Access-Control-Allow-Headers', '*');
                        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
                        proxyRes.pipe(res);
                    });

                    proxyReq.on('error', (err) => {
                        res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
                        res.end(JSON.stringify({ error: err.message }));
                    });

                    req.pipe(proxyReq);
                    return;
                } catch (e) {
                    res.writeHead(400, { 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ error: 'Invalid proxy target URL' }));
                    return;
                }
            }

            if (req.method === 'OPTIONS' && req.url && req.url.startsWith('/__dev_proxy')) {
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
                res.setHeader('Access-Control-Allow-Headers', '*');
                res.writeHead(204);
                res.end();
                return;
            }

            return metroMiddleware(req, res, next);
        };
    },
};

// Reduce the number of workers to decrease resource usage
config.maxWorkers = 2;

module.exports = config;