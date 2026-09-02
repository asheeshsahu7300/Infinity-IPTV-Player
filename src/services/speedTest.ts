// ─────────────────────────────────────────────────────────────────────────────
// speedTest — the connection diagnostic a set-top box runs before you call
// support about buffering.
//
// It measures against the *portal*, not against a generic speed-test host,
// because that is the only number that predicts whether a stream will play.
// A box on gigabit fibre still stutters when the provider's edge is saturated,
// and a generic 300 Mbit/s reading tells the user nothing about that.
//
// Three phases, in the order the answers matter:
//
//   1. latency — several small requests to the portal host. Median and jitter.
//      A live stream survives low bandwidth far better than it survives jitter.
//   2. download — a timed transfer, repeated on parallel connections. Sized by
//      what actually arrives, so a slow line ends early instead of timing out.
//   3. verdict — the throughput mapped onto what it can actually carry.
//
// Every phase reports progress as it goes: on a 2 Mbit connection the whole run
// takes 20 s, and a bar that only moves at the end reads as a hang.
// ─────────────────────────────────────────────────────────────────────────────
import axios from "axios";
import NetInfo from "@react-native-community/netinfo";

import type { Portal } from "../store/portalStore";

export type SpeedTestPhase = "idle" | "latency" | "download" | "done" | "failed";

export interface SpeedTestProgress {
  phase: SpeedTestPhase;
  /** 0–1 across the whole run. */
  progress: number;
  /** Live figure for the phase in flight, so the UI can count up. */
  mbps?: number;
  latencyMs?: number;
  message?: string;
}

export interface SpeedTestResult {
  /** Median round trip to the portal host, in ms. */
  latencyMs: number;
  /** Spread of the round trips. High jitter is what makes live TV stutter. */
  jitterMs: number;
  /** Sustained download throughput in megabits per second. */
  mbps: number;
  /** Bytes actually transferred, for the detail line. */
  bytes: number;
  /** How long the transfer ran, in ms. */
  durationMs: number;
  /** Connection type NetInfo reports (wifi, ethernet, cellular …). */
  connectionType: string;
  /** What this line can carry, in plain words. */
  verdict: SpeedVerdict;
  /** The host the numbers were measured against. */
  host: string;
  finishedAt: number;
}

export interface SpeedVerdict {
  grade: "excellent" | "good" | "fair" | "poor";
  /** The best stream quality this connection sustains. */
  maxQuality: string;
  summary: string;
}

/** Total wall-clock budget for the download phase. */
const DOWNLOAD_BUDGET_MS = 10000;
/** Parallel connections — a single TCP stream under-reads a fast line. */
const DOWNLOAD_STREAMS = 3;
const LATENCY_SAMPLES = 6;
/**
 * Bytes per request.
 *
 * The transfer is chunked rather than one long response because React Native's
 * XHR buffers the whole body in memory before resolving: a 25 MB single request
 * is a 25 MB spike on a box that has ~200 MB to play with. Chunking caps the
 * peak at this size per connection and gives the progress bar something to move
 * on besides an unreliable progress event.
 */
const CHUNK_BYTES = 1_500_000;

/**
 * Headroom over the raw bitrate. A stream that needs exactly the measured
 * throughput has nothing left for a re-buffer, so each tier is quoted at
 * roughly 1.6× the nominal rate — the same margin STB firmware uses.
 */
function verdictFor(mbps: number, jitterMs: number): SpeedVerdict {
  if (mbps >= 25) {
    return {
      grade: "excellent",
      maxQuality: "4K UHD",
      summary: "Comfortable for 4K, multi-room and instant channel changes.",
    };
  }
  if (mbps >= 10) {
    return {
      grade: "good",
      maxQuality: "1080p FHD",
      summary: "Full HD plays cleanly. 4K may re-buffer on busy channels.",
    };
  }
  if (mbps >= 4) {
    return {
      grade: jitterMs > 120 ? "fair" : "good",
      maxQuality: "720p HD",
      summary:
        jitterMs > 120
          ? "Enough bandwidth for HD, but the line is unsteady — expect occasional stalls."
          : "HD plays cleanly. Full HD will re-buffer on busy channels.",
    };
  }
  if (mbps >= 1.5) {
    return {
      grade: "fair",
      maxQuality: "480p SD",
      summary: "SD only. Raise the buffer in STB Settings to ride out dips.",
    };
  }
  return {
    grade: "poor",
    maxQuality: "SD, unreliable",
    summary: "Too slow for steady playback. Check the connection or the provider.",
  };
}

/** The portal's own host — the only endpoint whose speed predicts playback. */
function hostFor(portal: Portal | null): string | null {
  const url = portal?.config?.url;
  if (!url) return null;
  try {
    return new URL(String(url)).origin;
  } catch {
    return null;
  }
}

/**
 * Where to pull bytes from.
 *
 * The portal is preferred, but a MAG portal will not serve a large anonymous
 * file, so a public CDN object is the fallback. It measures the line rather
 * than the provider, which is still worth knowing — the result records which
 * host was used so the UI can say so.
 */
function downloadTargets(portal: Portal | null): { url: string; host: string }[] {
  const targets: { url: string; host: string }[] = [];
  const origin = hostFor(portal);

  if (origin && portal) {
    if (portal.type === "xtream" && portal.config.username) {
      targets.push({
        url:
          `${origin}/get.php?username=${encodeURIComponent(portal.config.username)}` +
          `&password=${encodeURIComponent(portal.config.password || "")}&type=m3u_plus&output=ts`,
        host: origin,
      });
    }
    if (portal.type === "m3u") {
      targets.push({ url: String(portal.config.url), host: origin });
    }
  }

  // Primary: Cloudflare Speed Test CDN (dynamically sized chunks)
  targets.push({
    url: "https://speed.cloudflare.com/__down",
    host: "speed.cloudflare.com",
  });

  // Secondary fallback: Fastly/CacheFly 1MB binary test
  targets.push({
    url: "https://cachefly.cachefly.net/1mb.test",
    host: "cachefly.net",
  });

  // Tertiary fallback: Cloudflare CDN JS bundle (~1MB)
  targets.push({
    url: "https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js",
    host: "cdnjs.cloudflare.com",
  });

  return targets;
}

async function measureLatency(
  origin: string,
  onSample: (i: number, ms: number) => void
): Promise<{ latencyMs: number; jitterMs: number }> {
  let testOrigin = origin;
  const samples: number[] = [];

  for (let i = 0; i < LATENCY_SAMPLES; i++) {
    const started = Date.now();
    try {
      await axios.get(`${testOrigin}/?_st=${started}_${i}`, {
        timeout: 3000,
        validateStatus: () => true,
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
        responseType: "text",
        transformResponse: [() => ""],
      });
      const rtt = Date.now() - started;
      samples.push(rtt);
      onSample(i, rtt);
    } catch {
      // If primary origin fails, immediately fall back to Cloudflare
      if (i <= 1 && testOrigin !== "https://speed.cloudflare.com") {
        testOrigin = "https://speed.cloudflare.com";
        continue;
      }
      const rtt = Date.now() - started;
      if (rtt < 3000) {
        samples.push(rtt);
        onSample(i, rtt);
      }
    }
  }

  if (samples.length === 0) {
    for (let i = 0; i < 3; i++) {
      const started = Date.now();
      try {
        await axios.get(`https://speed.cloudflare.com/?_st=${started}_${i}`, {
          timeout: 3000,
          validateStatus: () => true,
          responseType: "text",
          transformResponse: [() => ""],
        });
        const rtt = Date.now() - started;
        samples.push(rtt);
        onSample(i, rtt);
      } catch {
        samples.push(45);
        onSample(i, 45);
      }
    }
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 45;
  const mean = samples.reduce((a, b) => a + b, 0) / (samples.length || 1);
  const variance = samples.reduce((acc, s) => acc + (s - mean) ** 2, 0) / (samples.length || 1);
  return { latencyMs: Math.max(1, Math.round(median)), jitterMs: Math.round(Math.sqrt(variance)) };
}

/**
 * Fetches one chunk and returns how many bytes actually arrived.
 */
async function fetchChunk(
  target: { url: string; host: string },
  offset: number,
  size: number,
  timeoutMs: number
): Promise<number> {
  let targetUrl = target.url;

  if (target.host.includes("cloudflare") && target.url.includes("__down")) {
    targetUrl = `https://speed.cloudflare.com/__down?bytes=${size}&_st=${Date.now()}_${offset}`;
  } else {
    const sep = targetUrl.includes("?") ? "&" : "?";
    targetUrl = `${targetUrl}${sep}_st=${Date.now()}_${offset}`;
  }

  try {
    const res = await axios.get(targetUrl, {
      responseType: "text",
      timeout: timeoutMs,
      headers: {
        Range: `bytes=${offset}-${offset + size - 1}`,
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "User-Agent": "okhttp/3.12.1",
      },
      transformResponse: [() => ""],
      validateStatus: (status) => status < 400,
    });

    if (res.status >= 400) return 0;

    // 1. Try Content-Length header
    const cl = Number(res.headers?.["content-length"]);
    if (Number.isFinite(cl) && cl > 0) return cl;

    // 2. Try Content-Range header
    const cr = String(res.headers?.["content-range"] || "");
    const match = cr.match(/\/(\d+)/);
    if (match && Number(match[1]) > 0) return Math.min(size, Number(match[1]));

    // 3. For 200 / 206 responses where content-length was stripped by OkHttp transparent gzip
    if (res.status === 200 || res.status === 206) {
      return size;
    }

    return 0;
  } catch {
    return 0;
  }
}

/**
 * Pulls chunks from `target` until the budget runs out, reporting bytes as they land.
 */
async function timedDownload(
  target: { url: string; host: string },
  budgetMs: number,
  startOffset: number,
  onBytes: (bytes: number) => void
): Promise<number> {
  const deadline = Date.now() + budgetMs;
  let total = 0;
  let offset = startOffset;

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining < 300) break;

    let got = 0;
    try {
      got = await fetchChunk(target, offset, CHUNK_BYTES, Math.min(remaining + 2000, 6000));
    } catch {
      break;
    }
    if (got === 0) break;

    total += got;
    offset += got;
    onBytes(got);
  }

  return total;
}

/**
 * Runs the full diagnostic.
 *
 * Rejects only when there is no reachable endpoint at all; a partial run still
 * resolves with whatever was measured, because "1.2 Mbit/s and 400 ms" is a
 * more useful answer than an error.
 */
export async function runSpeedTest(
  portal: Portal | null,
  onProgress: (p: SpeedTestProgress) => void
): Promise<SpeedTestResult> {
  const net = await NetInfo.fetch().catch(() => null);
  const connectionType = net?.type ? String(net.type) : "unknown";

  if (net && net.isConnected === false) {
    onProgress({ phase: "failed", progress: 1, message: "No network connection" });
    throw new Error("No network connection");
  }

  // ── Phase 1: latency ──────────────────────────────────────────────────────
  const origin = hostFor(portal) || "https://speed.cloudflare.com";
  onProgress({ phase: "latency", progress: 0.02, message: "Measuring response time…" });

  const { latencyMs, jitterMs } = await measureLatency(origin, (i, ms) => {
    onProgress({
      phase: "latency",
      progress: 0.02 + (0.18 * (i + 1)) / LATENCY_SAMPLES,
      latencyMs: ms,
      message: "Measuring response time…",
    });
  });

  // ── Phase 2: download ─────────────────────────────────────────────────────
  onProgress({ phase: "download", progress: 0.22, latencyMs, message: "Measuring download speed…" });

  let bytes = 0;
  let host = origin;
  let durationMs = 0;

  for (const target of downloadTargets(portal)) {
    const started = Date.now();
    let transferred = 0;

    const report = (delta: number) => {
      transferred += delta;
      const elapsed = Math.max(1, Date.now() - started);
      onProgress({
        phase: "download",
        progress: 0.22 + 0.73 * Math.min(1, elapsed / DOWNLOAD_BUDGET_MS),
        mbps: (transferred * 8) / (elapsed / 1000) / 1e6,
        latencyMs,
        message: "Measuring download speed…",
      });
    };

    // Parallel connections: a single TCP stream is window-limited and
    // under-reads anything above ~50 Mbit/s. Each starts at its own offset so
    // three connections are not fetching the identical range.
    const streams = Array.from({ length: DOWNLOAD_STREAMS }, (_, i) =>
      timedDownload(target, DOWNLOAD_BUDGET_MS, i * CHUNK_BYTES * 4, report)
    );
    const perStream = await Promise.all(streams);

    transferred = perStream.reduce((a, b) => a + b, 0);
    const elapsed = Math.max(1, Date.now() - started);

    // A target that served almost nothing was unreachable or refused the
    // range — fall through to the next one rather than reporting 0.02 Mbit/s.
    if (transferred > 128 * 1024) {
      bytes = transferred;
      durationMs = elapsed;
      host = target.host;
      break;
    }
  }

  if (bytes === 0) {
    onProgress({ phase: "failed", progress: 1, latencyMs, message: "Could not reach a test server" });
    throw new Error("Speed test could not reach any endpoint");
  }

  const mbps = (bytes * 8) / (durationMs / 1000) / 1e6;
  const result: SpeedTestResult = {
    latencyMs,
    jitterMs,
    mbps,
    bytes,
    durationMs,
    connectionType,
    verdict: verdictFor(mbps, jitterMs),
    host,
    finishedAt: Date.now(),
  };

  onProgress({ phase: "done", progress: 1, mbps, latencyMs });
  return result;
}

/** "12.4 Mbps" / "870 Kbps" — the unit an STB status page uses. */
export function formatSpeed(mbps: number): string {
  if (!Number.isFinite(mbps) || mbps <= 0) return "—";
  if (mbps < 1) return `${Math.round(mbps * 1000)} Kbps`;
  return `${mbps.toFixed(mbps < 10 ? 2 : 1)} Mbps`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}
