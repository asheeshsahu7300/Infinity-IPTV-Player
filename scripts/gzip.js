import { fetch } from "react-native-fetch-api";
import { gunzip } from "pako";

export async function axiosGzip(url, headers, retry = 1) {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: headers,
    });
    console.log(response);
    const arrayBuf = await response.arrayBuffer();
    let buffer = new Uint8Array(arrayBuf);

    // Handle Cloudflare empty gzip chunk
    if (buffer.length === 0 && retry > 0) {
      console.log("⚠ Empty chunk received, retrying...");
      return axiosGzip(url, headers, retry - 1);
    }

    let result = buffer;

    // Detect gzip (magic bytes)
    const isGzip = buffer[0] === 0x1f && buffer[1] === 0x8b;

    if (isGzip) {
      try {
        result = gunzip(buffer);
      } catch (err) {
        console.warn("Primary gunzip failed, trying fallback...");

        // Try to find correct gzip header offset (Cloudflare often breaks it)
        for (let i = 1; i < 100 && i < buffer.length - 2; i++) {
          if (buffer[i] === 0x1f && buffer[i + 1] === 0x8b) {
            try {
              result = gunzip(buffer.slice(i));
              break;
            } catch {}
          }
        }
      }
    }

    const text = new TextDecoder().decode(result);

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch (err) {
    console.error("❌ fetchGzip ERROR:", err);
    throw err;
  }
}
