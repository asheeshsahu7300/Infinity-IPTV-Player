const axios = require("axios");
const { execSync } = require("child_process");

async function run() {
  const base = "http://livetvbox.live:8080";
  const mac = "00:1A:79:BC:AD:4A";
  const reqHeaders = {
    "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) MAG254 stbapp ver: 2 rev: 250 Mobile Safari/533.3",
    "X-User-Agent": "Model: MAG254; Link: Ethernet",
    "Accept": "*/*",
    "Cookie": `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=Europe/London;`
  };
  const hsRes = await axios.get(`${base}/portal.php?type=stb&action=handshake&JsHttpRequest=1-xml`, { headers: reqHeaders });
  const token = hsRes.data?.js?.token;
  const authHeaders = { ...reqHeaders, Authorization: `Bearer ${token}` };
  await axios.get(`${base}/portal.php?type=stb&action=get_profile&JsHttpRequest=1-xml`, { headers: authHeaders });
  const linkRes = await axios.get(`${base}/portal.php?type=itv&action=create_link&cmd=ffmpeg%20http://localhost/ch/407479_&JsHttpRequest=1-xml`, { headers: authHeaders });
  const cmd = linkRes.data?.js?.cmd;
  const streamUrl = cmd.replace(/^ffmpeg\s+/i, "");
  console.log("STREAM_URL:", streamUrl);

  try {
    const res1 = await axios.get(streamUrl, {
      headers: { "User-Agent": "okhttp/3.12.1" },
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400
    });
    console.log("Status 1:", res1.status);
    console.log("Headers 1:", res1.headers);
    const loc = res1.headers.location;
    console.log("Location:", loc);

    if (loc) {
      console.log("\nFetching redirect Location...");
      const res2 = await axios.get(loc, {
        headers: { "User-Agent": "okhttp/3.12.1" },
        responseType: "stream",
        timeout: 5000
      });
      console.log("Status 2:", res2.status);
      console.log("Headers 2:", res2.headers);
      res2.data.on("data", (chunk) => {
        console.log("GOT CHUNK! length:", chunk.length);
        console.log("First byte 0x47?", chunk[0] === 0x47, chunk[0]);
        console.log("Hex:", chunk.slice(0, 32).toString("hex"));
        console.log("Ascii:", chunk.slice(0, 100).toString("utf8"));
        res2.data.destroy();
      });
    }
  } catch (err) {
    console.log("ERR:", err.message, err.response?.status, err.response?.headers);
    if (err.response?.data) {
      console.log("ERR DATA:", err.response.data.toString ? err.response.data.toString('utf8') : err.response.data);
    }
  }
}
run();
