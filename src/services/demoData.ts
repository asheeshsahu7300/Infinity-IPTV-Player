// src/services/demoData.ts
// Pre-configured credentials and dedicated demo content for Google Play Review & Testing

import {
  Portal,
  Channel,
  VODItem,
  Series,
  Category,
  EPGProgram,
  Season,
} from "../store/portalStore";

export type DemoPortalType = "mag" | "xtream" | "m3u";

export interface DemoCredentialItem {
  id: string;
  name: string;
  type: DemoPortalType;
  description: string;
  url: string;
  username?: string;
  password?: string;
  mac?: string;
}

export const DEMO_CREDENTIALS: Record<DemoPortalType, DemoCredentialItem> = {
  mag: {
    id: "demo-mag-portal",
    name: "Demo STB Portal (MAC)",
    type: "mag",
    description: "STB / MAC Portal configuration for Google Play Review & Demo",
    url: "http://demo.infinityiptv.com/c",
    mac: "00:1A:79:00:00:01",
  },
  xtream: {
    id: "demo-xtream-portal",
    name: "Demo Xtream Codes",
    type: "xtream",
    description: "Xtream Codes API configuration for Google Play Review & Demo",
    url: "http://demo.infinityiptv.com",
    username: "demo_user",
    password: "demo_password",
  },
  m3u: {
    id: "demo-m3u-portal",
    name: "Demo M3U Playlist",
    type: "m3u",
    description: "M3U Playlist configuration for Google Play Review & Demo",
    url: "http://demo.infinityiptv.com/playlist.m3u",
  },
};

export const DEMO_STREAM_A = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";
export const DEMO_STREAM_B = "https://assets.afcdn.com/video49/20210722/v_645516.m3u8";

/**
 * Returns true if a portal is flagged as a demo portal.
 */
export function isDemoPortal(portal: Portal | null | undefined): boolean {
  if (!portal) return false;
  if (portal.id && portal.id.startsWith("demo-")) return true;
  const name = (portal.name || "").toLowerCase();
  if (name.includes("demo") || name.includes("test") || name.includes("review")) return true;
  const url = (portal.config?.url || "").toLowerCase();
  if (url.includes("demo") || url.includes("test") || url.includes("review") || url.includes("infinityiptv.com")) return true;
  const user = (portal.config?.username || "").toLowerCase();
  if (user.includes("demo") || user.includes("test") || user.includes("playstore") || user.includes("review")) return true;
  const mac = (portal.config?.mac || "").toLowerCase();
  if (
    mac.includes("de:mo") ||
    mac.includes("demo") ||
    mac.includes("00:1a:79:00:00:01") ||
    mac.includes("001a79000001") ||
    mac.includes("00:1a:79:de:ad:01") ||
    mac.includes("001a79dead01")
  ) {
    return true;
  }
  return false;
}

/**
 * Checks whether user-entered credentials in the login form match demo credentials.
 */
export function isDemoCredentials(
  type: DemoPortalType,
  inputs: { url?: string; username?: string; password?: string; mac?: string }
): boolean {
  const url = (inputs.url || "").trim().toLowerCase();
  const username = (inputs.username || "").trim().toLowerCase();
  const mac = (inputs.mac || "").trim().toLowerCase().replace(/[:-]/g, "");

  if (url.includes("demo") || url.includes("test") || url.includes("review") || url.includes("infinityiptv.com")) return true;
  if (username.includes("demo") || username.includes("test") || username.includes("playstore") || username.includes("review")) return true;

  if (type === "mag") {
    if (
      mac.includes("demo") ||
      mac === "001a79000001" ||
      mac === "001a79dead01" ||
      mac === "001a79demo01"
    ) return true;
    if (url === DEMO_CREDENTIALS.mag.url.toLowerCase()) return true;
  } else if (type === "xtream") {
    if (username === "demo_user" || username === "demo" || username === "test" || username === "playstore") return true;
    if (url === DEMO_CREDENTIALS.xtream.url.toLowerCase()) return true;
  } else if (type === "m3u") {
    if (url.endsWith(".m3u") && (url.includes("demo") || url.includes("test"))) return true;
    if (url === DEMO_CREDENTIALS.m3u.url.toLowerCase()) return true;
  }

  return false;
}

/**
 * Construct a ready-to-use Portal object for the given demo type.
 */
export function getDemoPortal(type: DemoPortalType): Portal {
  const creds = DEMO_CREDENTIALS[type];
  const now = Date.now();

  if (type === "mag") {
    return {
      id: creds.id,
      name: creds.name,
      type: "mag",
      config: {
        url: creds.url,
        mac: creds.mac!,
        token: "demo_token_review_2026",
        expiry: now + 365 * 24 * 3600 * 1000,
        serverInfo: {
          name: "Infinity Demo STB Middleware",
          version: "5.6.0",
          timezone: "UTC",
          mac: creds.mac,
        },
      },
    };
  }

  if (type === "xtream") {
    return {
      id: creds.id,
      name: creds.name,
      type: "xtream",
      config: {
        url: creds.url,
        username: creds.username!,
        password: creds.password!,
      },
    };
  }

  return {
    id: creds.id,
    name: creds.name,
    type: "m3u",
    config: {
      url: creds.url,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Demo Content Data Sets (Separate for MAG, Xtream, and M3U)
// ─────────────────────────────────────────────────────────────────────────────

interface DemoDataSet {
  categories: Category[];
  channels: Channel[];
  vodItems: VODItem[];
  series: Series[];
  epgData: EPGProgram[];
}

function buildEpgForChannels(channels: Channel[]): EPGProgram[] {
  const now = Date.now();
  const ONE_HOUR = 3600 * 1000;
  const programs: EPGProgram[] = [];

  channels.forEach((ch, idx) => {
    programs.push({
      id: `epg-${ch.id}-prev`,
      channelId: String(ch.id),
      title: `${ch.name} - Morning Spotlight`,
      description: "Review of key morning highlights, entertainment news, and current events.",
      start: now - ONE_HOUR * 1.5,
      end: now - ONE_HOUR * 0.1,
    });
    programs.push({
      id: `epg-${ch.id}-now`,
      channelId: String(ch.id),
      title: `${ch.name} - Live Special Broadcast`,
      description: "Live streaming showcase feature presentation. High definition multi-camera broadcast.",
      start: now - ONE_HOUR * 0.1,
      end: now + ONE_HOUR * 1.5,
    });
    programs.push({
      id: `epg-${ch.id}-next`,
      channelId: String(ch.id),
      title: `${ch.name} - Prime Time Premiere`,
      description: "Award-winning studio presentation featuring exclusive interviews and documentary segments.",
      start: now + ONE_HOUR * 1.5,
      end: now + ONE_HOUR * 3.5,
    });
  });

  return programs;
}

// 1. MAG Demo Content
function getMagDemoData(): DemoDataSet {
  const categories: Category[] = [
    { id: "mag-live-1", name: "STB Entertainment", type: "live" },
    { id: "mag-live-2", name: "STB Cinema Live", type: "live" },
    { id: "mag-live-3", name: "STB Sports HD", type: "live" },
    { id: "mag-live-4", name: "STB World & Nature", type: "live" },
    { id: "vod:mag-1", name: "STB Premiere Movies", type: "vod" },
    { id: "vod:mag-2", name: "STB Sci-Fi & Action", type: "vod" },
    { id: "series:mag-1", name: "STB Exclusive Drama", type: "series" },
  ];

  const channels: Channel[] = [
    {
      id: "mag-ch-1",
      name: "STB One HD",
      category: "STB Entertainment",
      categoryId: "mag-live-1",
      num: 101,
      streamUrl: DEMO_STREAM_A,
      logo: "https://images.unsplash.com/photo-1594909122845-11baa439b7bf?w=300",
    },
    {
      id: "mag-ch-2",
      name: "STB Cinema Premiere",
      category: "STB Cinema Live",
      categoryId: "mag-live-2",
      num: 102,
      streamUrl: DEMO_STREAM_B,
      logo: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=300",
    },
    {
      id: "mag-ch-3",
      name: "STB Sports Max",
      category: "STB Sports HD",
      categoryId: "mag-live-3",
      num: 103,
      streamUrl: DEMO_STREAM_A,
      logo: "https://images.unsplash.com/photo-1517649763962-0c623266ddc0?w=300",
    },
    {
      id: "mag-ch-4",
      name: "STB Discovery World",
      category: "STB World & Nature",
      categoryId: "mag-live-4",
      num: 104,
      streamUrl: DEMO_STREAM_B,
      logo: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=300",
    },
  ];

  const vodItems: VODItem[] = [
    {
      id: "mag-vod-1",
      name: "Tears of Steel",
      category: "STB Sci-Fi & Action",
      categoryId: "vod:mag-2",
      streamUrl: DEMO_STREAM_A,
      logo: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=500",
      backdrop: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=1200",
      year: "2024",
      duration: "1h 52m",
      rating: "8.4",
      description: "In a dystopian future, a group of scientists and warriors in Amsterdam attempt to save the earth from a catastrophic technological disaster.",
      director: "Ian Hubert",
      cast: ["Derek de Lint", "Sergio Hasselbaink", "Rogier Schippers"],
      tags: ["Sci-Fi", "Action", "CGI", "Adventure"],
    },
    {
      id: "mag-vod-2",
      name: "Elephants Dream",
      category: "STB Premiere Movies",
      categoryId: "vod:mag-1",
      streamUrl: DEMO_STREAM_B,
      logo: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=500",
      backdrop: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1200",
      year: "2023",
      duration: "1h 45m",
      rating: "7.9",
      description: "Two friends journey through a colossal and surreal machine with intricate mechanisms, uncovering strange secrets.",
      director: "Bassam Kurdali",
      cast: ["Tygo Gernandt", "Cas Jansen"],
      tags: ["Animation", "Surreal", "Mystery"],
    },
  ];

  const series: Series[] = [
    {
      id: "mag-ser-1",
      name: "Chronicles of the Cosmos",
      category: "STB Exclusive Drama",
      categoryId: "series:mag-1",
      logo: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=500",
      backdrop: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200",
      year: "2024",
      rating: "9.1",
      description: "An epic exploration of human destiny across deep space colonies and interstellar exploration.",
      director: "Alastair Fothergill",
      cast: ["David Attenborough", "Brian Cox"],
      tags: ["Drama", "Sci-Fi", "Space"],
      seasons: [
        {
          id: "mag-ser-1-s1",
          name: "Season 1",
          seasonNumber: 1,
          episodes: [
            {
              id: "mag-ser-1-s1-e1",
              name: "Episode 1: Departure Point",
              episodeNum: 1,
              seasonNum: 1,
              cmd: DEMO_STREAM_A,
              streamUrl: DEMO_STREAM_A,
              duration: "48m",
              description: "The crew prepares the starship for its historic journey across the asteroid belt.",
            },
            {
              id: "mag-ser-1-s1-e2",
              name: "Episode 2: Deep Silence",
              episodeNum: 2,
              seasonNum: 1,
              cmd: DEMO_STREAM_B,
              streamUrl: DEMO_STREAM_B,
              duration: "52m",
              description: "A mysterious signal echoes through the radio receivers as the ship crosses Jupiter's orbit.",
            },
          ],
        },
      ],
    },
  ];

  return {
    categories,
    channels,
    vodItems,
    series,
    epgData: buildEpgForChannels(channels),
  };
}

// 2. Xtream Demo Content
function getXtreamDemoData(): DemoDataSet {
  const categories: Category[] = [
    { id: "live:xtream-1", name: "Xtream Live Hits", type: "live" },
    { id: "live:xtream-2", name: "Xtream Sports Plus", type: "live" },
    { id: "live:xtream-3", name: "Xtream Family & Toons", type: "live" },
    { id: "vod:xtream-1", name: "Xtream Box Office", type: "vod" },
    { id: "vod:xtream-2", name: "Xtream Animation Showcase", type: "vod" },
    { id: "series:xtream-1", name: "Xtream Originals", type: "series" },
  ];

  const channels: Channel[] = [
    {
      id: "xtream-ch-1",
      name: "Xtream Premiere HD",
      category: "Xtream Live Hits",
      categoryId: "live:xtream-1",
      num: 201,
      streamUrl: DEMO_STREAM_A,
      logo: "https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?w=300",
    },
    {
      id: "xtream-ch-2",
      name: "Xtream Velocity Sports",
      category: "Xtream Sports Plus",
      categoryId: "live:xtream-2",
      num: 202,
      streamUrl: DEMO_STREAM_B,
      logo: "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=300",
    },
    {
      id: "xtream-ch-3",
      name: "Xtream Kids Toons",
      category: "Xtream Family & Toons",
      categoryId: "live:xtream-3",
      num: 203,
      streamUrl: DEMO_STREAM_A,
      logo: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=300",
    },
  ];

  const vodItems: VODItem[] = [
    {
      id: "xtream-vod-1",
      name: "Big Buck Bunny",
      category: "Xtream Animation Showcase",
      categoryId: "vod:xtream-2",
      streamUrl: DEMO_STREAM_A,
      logo: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500",
      backdrop: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=1200",
      year: "2024",
      duration: "1h 38m",
      rating: "8.7",
      description: "A large and gentle rabbit with a heart of gold takes a stand against forest bullies in a fun and humorous animated adventure.",
      director: "Sacha Goedegebure",
      cast: ["Jan Morgenstern"],
      tags: ["Animation", "Family", "Comedy"],
    },
    {
      id: "xtream-vod-2",
      name: "For Bigger Joy Blazes",
      category: "Xtream Box Office",
      categoryId: "vod:xtream-1",
      streamUrl: DEMO_STREAM_B,
      logo: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=500",
      backdrop: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1200",
      year: "2023",
      duration: "2h 05m",
      rating: "8.2",
      description: "A high-octane thrill ride featuring advanced aerial photography and relentless stunts across metropolitan skylines.",
      director: "Chromecast Studio",
      cast: ["Alex Rivers", "Elena Vance"],
      tags: ["Action", "Thriller"],
    },
  ];

  const series: Series[] = [
    {
      id: "xtream-ser-1",
      name: "The Animation Studio",
      category: "Xtream Originals",
      categoryId: "series:xtream-1",
      logo: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=500",
      backdrop: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1200",
      year: "2024",
      rating: "8.9",
      description: "Behind the scenes with digital storytellers crafting award-winning short films and visual masterpieces.",
      director: "Ton Roosendaal",
      cast: ["Enrico Valenza", "Andy Goralczyk"],
      tags: ["Documentary", "Animation", "Creativity"],
      seasons: [
        {
          id: "xtream-ser-1-s1",
          name: "Season 1",
          seasonNumber: 1,
          episodes: [
            {
              id: "xtream-ser-1-s1-e1",
              name: "Episode 1: The Initial Spark",
              episodeNum: 1,
              seasonNum: 1,
              cmd: DEMO_STREAM_A,
              streamUrl: DEMO_STREAM_A,
              duration: "45m",
              description: "How a humble open-source initiative evolved into an international creative powerhouse.",
            },
            {
              id: "xtream-ser-1-s1-e2",
              name: "Episode 2: Rendering Worlds",
              episodeNum: 2,
              seasonNum: 1,
              cmd: DEMO_STREAM_B,
              streamUrl: DEMO_STREAM_B,
              duration: "50m",
              description: "Artists and engineers merge live-action footage with photorealistic 3D VFX.",
            },
          ],
        },
      ],
    },
  ];

  return {
    categories,
    channels,
    vodItems,
    series,
    epgData: buildEpgForChannels(channels),
  };
}

// 3. M3U Demo Content
function getM3uDemoData(): DemoDataSet {
  const categories: Category[] = [
    { id: "live:m3u-1", name: "M3U Global News", type: "live" },
    { id: "live:m3u-2", name: "M3U CineMax", type: "live" },
    { id: "live:m3u-3", name: "M3U Wildlife Discovery", type: "live" },
    { id: "live:m3u-4", name: "M3U Sports Arena", type: "live" },
    { id: "live:m3u-5", name: "M3U Music Pulse", type: "live" },
    { id: "live:m3u-6", name: "M3U Kids & Family", type: "live" },
    { id: "vod:m3u-1", name: "M3U Cinema Classics", type: "vod" },
    { id: "vod:m3u-2", name: "M3U Documentary Vault", type: "vod" },
    { id: "vod:m3u-3", name: "M3U Action & Thrillers", type: "vod" },
    { id: "series:m3u-1", name: "M3U Horizon Series", type: "series" },
    { id: "series:m3u-2", name: "M3U Sci-Fi Originals", type: "series" },
  ];

  const channels: Channel[] = [
    {
      id: "m3u-ch-1",
      name: "M3U World News 24/7",
      category: "M3U Global News",
      categoryId: "live:m3u-1",
      num: 301,
      streamUrl: DEMO_STREAM_A,
      logo: "https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=300",
    },
    {
      id: "m3u-ch-2",
      name: "M3U CineMax Gold",
      category: "M3U CineMax",
      categoryId: "live:m3u-2",
      num: 302,
      streamUrl: DEMO_STREAM_B,
      logo: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=300",
    },
    {
      id: "m3u-ch-3",
      name: "M3U Wild Planet",
      category: "M3U Wildlife Discovery",
      categoryId: "live:m3u-3",
      num: 303,
      streamUrl: DEMO_STREAM_A,
      logo: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=300",
    },
    {
      id: "m3u-ch-4",
      name: "M3U Sports Arena HD",
      category: "M3U Sports Arena",
      categoryId: "live:m3u-4",
      num: 304,
      streamUrl: DEMO_STREAM_B,
      logo: "https://images.unsplash.com/photo-1517649763962-0c623266ddc0?w=300",
    },
    {
      id: "m3u-ch-5",
      name: "M3U Music Pulse TV",
      category: "M3U Music Pulse",
      categoryId: "live:m3u-5",
      num: 305,
      streamUrl: DEMO_STREAM_A,
      logo: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300",
    },
    {
      id: "m3u-ch-6",
      name: "M3U Kids Adventure",
      category: "M3U Kids & Family",
      categoryId: "live:m3u-6",
      num: 306,
      streamUrl: DEMO_STREAM_B,
      logo: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=300",
    },
  ];

  const vodItems: VODItem[] = [
    {
      id: "m3u-vod-1",
      name: "Sintel",
      category: "M3U Cinema Classics",
      categoryId: "vod:m3u-1",
      streamUrl: DEMO_STREAM_A,
      logo: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=500",
      backdrop: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1200",
      year: "2024",
      duration: "1h 42m",
      rating: "8.6",
      description: "A determined young girl travels across snowy peaks and desolate deserts to rescue her dragon friend.",
      director: "Colin Levy",
      cast: ["Halina Reijn", "Thom Hoffman"],
      tags: ["Fantasy", "Adventure", "Animation"],
    },
    {
      id: "m3u-vod-2",
      name: "Outback Expedition",
      category: "M3U Documentary Vault",
      categoryId: "vod:m3u-2",
      streamUrl: DEMO_STREAM_B,
      logo: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=500",
      backdrop: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200",
      year: "2023",
      duration: "1h 30m",
      rating: "8.0",
      description: "An incredible voyage across remote landscapes, encountering untouched habitats and breathtaking wilderness.",
      director: "National Geographic Team",
      cast: ["Explorer Crew"],
      tags: ["Documentary", "Nature", "Wild"],
    },
    {
      id: "m3u-vod-3",
      name: "Cyber Horizon",
      category: "M3U Action & Thrillers",
      categoryId: "vod:m3u-3",
      streamUrl: DEMO_STREAM_A,
      logo: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=500",
      backdrop: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=1200",
      year: "2024",
      duration: "1h 55m",
      rating: "8.3",
      description: "In neon-lit megalopolises, specialized operatives race against quantum encryption to uncover a syndicate conspiracy.",
      director: "Elena Ramos",
      cast: ["Marcus Vance", "Sarah Chen"],
      tags: ["Action", "Sci-Fi", "Cyberpunk"],
    },
    {
      id: "m3u-vod-4",
      name: "Echoes of the Deep",
      category: "M3U Documentary Vault",
      categoryId: "vod:m3u-2",
      streamUrl: DEMO_STREAM_B,
      logo: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=500",
      backdrop: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=1200",
      year: "2023",
      duration: "1h 25m",
      rating: "8.8",
      description: "Deep sea submersibles dive into the Mariana Trench documenting bioluminescent wonders and abyssal ecosystems.",
      director: "David Attenborough Team",
      cast: ["Marine Explorers"],
      tags: ["Documentary", "Ocean", "Exploration"],
    },
  ];

  const series: Series[] = [
    {
      id: "m3u-ser-1",
      name: "The Frontier Odyssey",
      category: "M3U Horizon Series",
      categoryId: "series:m3u-1",
      logo: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=500",
      backdrop: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200",
      year: "2024",
      rating: "9.0",
      description: "Follow daring pioneers as they navigate uncharted waters and remote frontiers around the globe.",
      director: "Nova Horizons",
      cast: ["Mark Sullivan", "Rachel Adams"],
      tags: ["Exploration", "DocuSeries"],
      seasons: [
        {
          id: "m3u-ser-1-s1",
          name: "Season 1",
          seasonNumber: 1,
          episodes: [
            {
              id: "m3u-ser-1-s1-e1",
              name: "Episode 1: The Wild Coast",
              episodeNum: 1,
              seasonNum: 1,
              cmd: DEMO_STREAM_A,
              streamUrl: DEMO_STREAM_A,
              duration: "42m",
              description: "Charting the treacherous coastal rocks and uncovering ancient marine life.",
            },
            {
              id: "m3u-ser-1-s1-e2",
              name: "Episode 2: Highland Ridge",
              episodeNum: 2,
              seasonNum: 1,
              cmd: DEMO_STREAM_B,
              streamUrl: DEMO_STREAM_B,
              duration: "46m",
              description: "Ascending the steepest peaks under extreme conditions to document rare flora.",
            },
            {
              id: "m3u-ser-1-s1-e3",
              name: "Episode 3: Untamed Oceans",
              episodeNum: 3,
              seasonNum: 1,
              cmd: DEMO_STREAM_A,
              streamUrl: DEMO_STREAM_A,
              duration: "49m",
              description: "Navigating stormy waters to reach untouched archipelago ecosystems.",
            },
          ],
        },
      ],
    },
    {
      id: "m3u-ser-2",
      name: "Quantum Dimensions",
      category: "M3U Sci-Fi Originals",
      categoryId: "series:m3u-2",
      logo: "https://images.unsplash.com/photo-1507499739999-097706ad8914?w=500",
      backdrop: "https://images.unsplash.com/photo-1507499739999-097706ad8914?w=1200",
      year: "2024",
      rating: "8.9",
      description: "Theoretical physicists breach parallel dimensions, discovering divergent realities and mysterious phenomena.",
      director: "Caleb Scott",
      cast: ["Olivia Wright", "Nathan Brooks"],
      tags: ["Sci-Fi", "Mystery", "Drama"],
      seasons: [
        {
          id: "m3u-ser-2-s1",
          name: "Season 1",
          seasonNumber: 1,
          episodes: [
            {
              id: "m3u-ser-2-s1-e1",
              name: "Episode 1: The Rift",
              episodeNum: 1,
              seasonNum: 1,
              cmd: DEMO_STREAM_B,
              streamUrl: DEMO_STREAM_B,
              duration: "51m",
              description: "The particle accelerator triggers an unprecedented gravitational anomaly in the research bunker.",
            },
            {
              id: "m3u-ser-2-s1-e2",
              name: "Episode 2: Echoes",
              episodeNum: 2,
              seasonNum: 1,
              cmd: DEMO_STREAM_A,
              streamUrl: DEMO_STREAM_A,
              duration: "48m",
              description: "Researchers receive audio broadcasts originating from an alternate timeline.",
            },
          ],
        },
      ],
    },
  ];

  return {
    categories,
    channels,
    vodItems,
    series,
    epgData: buildEpgForChannels(channels),
  };
}

/**
 * Generates an actual valid #EXTM3U formatted playlist text.
 */
export function generateDemoM3uText(): string {
  const data = getM3uDemoData();
  const lines: string[] = ['#EXTM3U url-tvg="http://demo.infinityiptv.com/epg.xml"'];

  data.channels.forEach((ch) => {
    lines.push(
      `#EXTINF:-1 tvg-id="${ch.id}" tvg-name="${ch.name}" tvg-logo="${ch.logo || ''}" group-title="${ch.category || 'Live'}" tvg-chno="${ch.num || 1}",${ch.name}`
    );
    lines.push(ch.streamUrl || DEMO_STREAM_A);
  });

  data.vodItems.forEach((v) => {
    lines.push(
      `#EXTINF:-1 tvg-id="${v.id}" tvg-name="${v.name}" tvg-logo="${v.logo || ''}" group-title="${v.category || 'Movies'}",${v.name}`
    );
    lines.push(v.streamUrl || DEMO_STREAM_A);
  });

  data.series.forEach((s) => {
    (s.seasons || []).forEach((season) => {
      season.episodes.forEach((ep) => {
        lines.push(
          `#EXTINF:-1 tvg-id="${ep.id}" tvg-name="${s.name} S01E0${ep.episodeNum} ${ep.name}" tvg-logo="${s.logo || ''}" group-title="${s.category || 'Series'}",${s.name} S01E0${ep.episodeNum} ${ep.name}`
        );
        lines.push(ep.streamUrl || DEMO_STREAM_A);
      });
    });
  });

  return lines.join('\n');
}

/**
 * Returns the complete demo dataset corresponding to the portal type.
 */
export function getDemoPortalData(type: DemoPortalType): DemoDataSet {
  if (type === "mag") return getMagDemoData();
  if (type === "xtream") return getXtreamDemoData();
  return getM3uDemoData();
}
