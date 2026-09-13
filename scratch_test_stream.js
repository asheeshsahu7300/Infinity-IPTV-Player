const axios = require('axios');

async function test() {
  const base = 'http://livetvbox.live:8080';
  const token = 'C0B15BBED3A7B0416051E10C6AB117B4';
  const mac = '00:1A:79:BC:AD:4A';

  const headers = {
    'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) MAG254 stbapp ver: 2 rev: 250 Mobile Safari/533.3',
    'X-User-Agent': 'Model: MAG254; Link: Ethernet',
    'Authorization': `Bearer ${token}`,
    'Cookie': `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=Europe/London;`
  };

  try {
    console.log("Fetching channels list sample...");
    const res = await axios.get(`${base}/portal.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`, { headers });
    const data = res.data?.js?.data || res.data?.js || [];
    console.log(`Fetched ${data.length} channels.`);
    if (data.length > 0) {
      const sampleCh = data[0];
      console.log("\n--- Sample Channel ---");
      console.log("Channel ID:", sampleCh.id);
      console.log("Channel Name:", sampleCh.name);
      console.log("Channel cmd:", sampleCh.cmd);

      console.log("\nCalling create_link for channel.cmd...");
      const linkRes = await axios.get(`${base}/portal.php?type=itv&action=create_link&cmd=${encodeURIComponent(sampleCh.cmd)}&JsHttpRequest=1-xml`, { headers });
      console.log("create_link response:", JSON.stringify(linkRes.data));
    }

    // Also check VOD sample
    console.log("\nFetching VOD list sample...");
    const vodRes = await axios.get(`${base}/portal.php?type=vod&action=get_categories&JsHttpRequest=1-xml`, { headers });
    const vodCats = vodRes.data?.js || [];
    if (vodCats.length > 0) {
      const catId = vodCats[0].id;
      const moviesRes = await axios.get(`${base}/portal.php?type=vod&action=get_data&category=${catId}&p=1&JsHttpRequest=1-xml`, { headers });
      const movies = moviesRes.data?.js?.data || moviesRes.data?.js || [];
      if (movies.length > 0) {
        const sampleMovie = movies[0];
        console.log("\n--- Sample Movie ---");
        console.log("Movie ID:", sampleMovie.id);
        console.log("Movie Name:", sampleMovie.name);
        console.log("Movie cmd:", sampleMovie.cmd);

        console.log("\nCalling create_link for movie.cmd...");
        const vodLinkRes = await axios.get(`${base}/portal.php?type=vod&action=create_link&cmd=${encodeURIComponent(sampleMovie.cmd)}&JsHttpRequest=1-xml`, { headers });
        console.log("VOD create_link response:", JSON.stringify(vodLinkRes.data));
      }
    }
  } catch (err) {
    console.error("Test error:", err.message, err.response?.data);
  }
}

test();
