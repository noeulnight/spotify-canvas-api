import "dotenv/config";
import express from "express";
import { SpotifyClient } from "./spotify/client.js";
import { getCanvasData } from "./spotify/canvas.js";

const spotifyClient = new SpotifyClient();
const app = express();

app.get("/", (req, res) => {
  res.send("Spotify Canvas API is running.");
});

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

app.get("/track/:trackId/canvas", async (req, res) => {
  const { trackId } = req.params;
  const { accept } = req.headers;

  try {
    const canvasUrl = await getCanvasData(spotifyClient, trackId);

    if (accept && accept.includes("application/json")) {
      return res.json({ canvasUrl });
    }

    res.redirect(canvasUrl);
  } catch (error) {
    console.error("Error fetching canvas data:", error);
    res.status(500).send("Internal Server Error");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://127.0.0.1:${PORT}`);
});
