const axios = require('axios');

async function testAuthAndLink() {
  const base = 'http://livetvbox.live:8080';
  const mac = '00:1A:79:BC:AD:4A';

  const reqHeaders = {
    'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) MAG254 stbapp ver: 2 rev: 250 Mobile Safari/533.3',
    'X-User-Agent': 'Model: MAG254; Link: Ethernet',
    'Accept': '*/*',
    'Cookie': `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=Europe/London;`
  };

  try {
    console.log("1. Handshaking...");
    const hsRes = await axios.get(`${base}/portal.php?type=stb&action=handshake&JsHttpRequest=1-xml`, {
      headers: reqHeaders,
      timeout: 15000
    });
    console.log("Handshake response:", hsRes.data);
    const token = hsRes.data?.js?.token;
    console.log("Token:", token);

    if (!token) {
      console.error("No token from handshake!");
      return;
    }

    const authHeaders = {
      ...reqHeaders,
      'Authorization': `Bearer ${token}`,
      'Cookie': `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=Europe/London;`
    };

    console.log("\n2. Getting profile...");
    const profRes = await axios.get(`${base}/portal.php?type=stb&action=get_profile&JsHttpRequest=1-xml`, {
      headers: authHeaders,
      timeout: 15000
    });
    console.log("Profile status:", profRes.status);

    const testCmd = 'ffmpeg http://localhost/ch/407479_';
    console.log(`\n3. Calling create_link for cmd: "${testCmd}"...`);
    const linkRes = await axios.get(`${base}/portal.php?type=itv&action=create_link&cmd=${encodeURIComponent(testCmd)}&JsHttpRequest=1-xml`, {
      headers: authHeaders,
      timeout: 15000
    });
    console.log("create_link response for original cmd:\n", JSON.stringify(linkRes.data, null, 2));

    const cleanCmd = 'http://localhost/ch/407479_';
    console.log(`\n4. Calling create_link for clean cmd: "${cleanCmd}"...`);
    const linkCleanRes = await axios.get(`${base}/portal.php?type=itv&action=create_link&cmd=${encodeURIComponent(cleanCmd)}&JsHttpRequest=1-xml`, {
      headers: authHeaders,
      timeout: 15000
    });
    console.log("create_link response for clean cmd:\n", JSON.stringify(linkCleanRes.data, null, 2));

  } catch (err) {
    console.error("Error:", err.message, err.response?.data);
  }
}

testAuthAndLink();
