/**
 * dnsResolver.ts
 *
 * DNS pre-resolution and DNS-over-HTTPS (DoH) service.
 * Pre-resolves domain names via Cloudflare (1.1.1.1) & Google DNS over HTTPS (Port 53 equivalent).
 * Bypasses stale Android DNS caches, ISP DNS throttling, and lookup timeouts.
 */

import axios from "axios";

interface DnsCacheItem {
  ip: string;
  expires: number;
}

const dnsCache = new Map<string, DnsCacheItem>();

/**
 * Extract hostname from URL string
 */
export function extractHostname(urlStr: string): string {
  try {
    const cleaned = urlStr.trim();
    const match = cleaned.match(/^(?:https?:\/\/)?([^:\/\s]+)/i);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

/**
 * Resolve hostname to IPv4 address via DoH (Cloudflare 1.1.1.1 / Google 8.8.8.8)
 */
export async function resolveHostIp(hostname: string): Promise<string | null> {
  const host = hostname.trim().toLowerCase();
  if (!host) return null;

  // Already an IPv4 address
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
    return host;
  }

  // Check in-memory DNS cache (5 min TTL)
  const cached = dnsCache.get(host);
  if (cached && cached.expires > Date.now()) {
    return cached.ip;
  }

  // 1. Try Cloudflare DoH (1.1.1.1)
  try {
    const cfRes = await axios.get(
      `https://1.1.1.1/dns-query?name=${encodeURIComponent(host)}&type=A`,
      {
        headers: { accept: "application/dns-json" },
        timeout: 1500,
      }
    );
    const answers = cfRes.data?.Answer;
    if (Array.isArray(answers)) {
      const aRecord = answers.find((a: any) => a.type === 1 && a.data);
      if (aRecord?.data) {
        const ip = aRecord.data.trim();
        dnsCache.set(host, { ip, expires: Date.now() + 5 * 60 * 1000 });
        return ip;
      }
    }
  } catch {
    // ignore, try fallback
  }

  // 2. Try Google DoH (dns.google)
  try {
    const gRes = await axios.get(
      `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=A`,
      {
        headers: { accept: "application/json" },
        timeout: 1500,
      }
    );
    const answers = gRes.data?.Answer;
    if (Array.isArray(answers)) {
      const aRecord = answers.find((a: any) => a.type === 1 && a.data);
      if (aRecord?.data) {
        const ip = aRecord.data.trim();
        dnsCache.set(host, { ip, expires: Date.now() + 5 * 60 * 1000 });
        return ip;
      }
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Pre-warm DNS cache for a given URL (fire-and-forget)
 */
export function prewarmDns(urlStr: string): void {
  const host = extractHostname(urlStr);
  if (host) {
    resolveHostIp(host).catch(() => {});
  }
}
