const fs = require('fs');

try {
  const buf = fs.readFileSync('scratch_mmkv.bin');
  const text = buf.toString('utf16le');
  
  console.log("MMKV size:", buf.length);
  
  // Find strings that look like cmd or streamUrl or http
  const urls = text.match(/https?:\/\/[a-zA-Z0-9_\-\.\:\@\/\?\=\&\%\+\#\~]+/g) || [];
  console.log("Total URLs found:", urls.length);
  console.log("\nSample unique URLs (first 20):");
  const uniqueUrls = Array.from(new Set(urls));
  console.log(uniqueUrls.slice(0, 20).join('\n'));

  // Search for cmd fields
  const cmdMatches = text.match(/"cmd":"([^"]+)"/g) || [];
  console.log("\nTotal cmd matches found:", cmdMatches.length);
  console.log("Sample cmd matches (first 15):");
  console.log(cmdMatches.slice(0, 15).join('\n'));

  // Search for 4K / UHD items
  const uhdMatches = text.match(/[^"]*(?:4k|uhd|2160)[^"]*/gi) || [];
  console.log("\nSample 4K / UHD entries (first 10):");
  console.log(Array.from(new Set(uhdMatches)).slice(0, 10).join('\n'));

  // Search for any strange prefixes like ffmpeg, ffrt, auto, rtp, extTimeShift
  const strangePrefixes = text.match(/(?:ffmpeg|ffrt\d*|auto|extTimeShift|rtp|udp)\s+[^\s"'\x00]+/gi) || [];
  console.log("\nStrange prefixes found in streams:", strangePrefixes.length);
  console.log(Array.from(new Set(strangePrefixes)).slice(0, 15).join('\n'));

  // Search for trailing parameters like position:, media_len:, atrack:, strack:
  const trailingParams = text.match(/[^\s"'\x00]+\s+(?:position|media_len|atrack|strack):[^\s"'\x00]+/gi) || [];
  console.log("\nTrailing params found in streams:", trailingParams.length);
  console.log(Array.from(new Set(trailingParams)).slice(0, 15).join('\n'));

} catch (err) {
  console.error("Error reading MMKV:", err);
}
