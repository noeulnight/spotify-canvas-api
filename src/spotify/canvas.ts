import { redisCache } from "../cache/redis.js";

const CANVAS_SHA256_HASH =
  process.env.SPOTIFY_CANVAS_GQL_HASH ||
  "575138ab27cd5c1b3e54da54d0a7cc8d85485402de26340c2145f0f6bb5e7a9f";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
const CACHE_TTL = 60 * 60 * 24 * 7; // 7 days

const canvasQueryBody = (trackUri: string) => ({
  variables: { trackUri },
  operationName: "canvas",
  extensions: {
    persistedQuery: {
      version: 1,
      sha256Hash: CANVAS_SHA256_HASH,
    },
  },
});

export async function getCanvasData(
  token: string,
  trackId: string,
): Promise<string> {
  // Check cache first
  const cacheKey = `track:${trackId}`;
  const cachedUrl = await redisCache.get(cacheKey);

  if (cachedUrl) {
    console.log(`Cache hit for track ${trackId}`);
    return cachedUrl;
  }

  // Cache miss - fetch from API
  console.log(`Cache miss for track ${trackId}, fetching from API`);
  const trackUri = `spotify:track:${trackId}`;
  const url = "https://api-partner.spotify.com/pathfinder/v2/query";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify(canvasQueryBody(trackUri)),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch canvas data: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json() as {
    data: { trackUnion: { canvas: { url: string } } };
  };

  const canvasURL = data.data.trackUnion?.canvas?.url;
  if (!canvasURL) {
    throw new Error("No canvas data found for the given track ID");
  }

  // Store in cache
  await redisCache.set(cacheKey, canvasURL, CACHE_TTL);

  return canvasURL;
}
