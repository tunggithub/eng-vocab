import express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import "dotenv/config";
import { openDb } from "./db.js";
import { wordsRouter } from "./routes/words.js";
import { metaRouter } from "./routes/meta.js";
import { aiRouter } from "./routes/ai.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(db, opts = {}) {
  const audioDir = opts.audioDir || path.join(__dirname, "data", "audio");
  const app = express();
  app.use(express.json({ limit: "5mb" }));

  app.use("/api", wordsRouter(db));
  app.use("/api", metaRouter(db));
  app.use("/api", aiRouter(db, {
    audioDir,
    apiKey: opts.apiKey,
    fetchImpl: opts.fetchImpl || fetch,
    baseUrl: opts.baseUrl,
    ttsApiKey: opts.ttsApiKey,
    ttsBaseUrl: opts.ttsBaseUrl,
  }));

  app.use("/audio", express.static(audioDir));
  app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));
  app.get("/api.js", (_req, res) => res.sendFile(path.join(__dirname, "api.js")));

  return app;
}

// Run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dataDir = path.join(__dirname, "data");
  const audioDir = path.join(dataDir, "audio");
  fs.mkdirSync(audioDir, { recursive: true });
  const db = openDb(path.join(dataDir, "vocab.db"));
  const app = createApp(db, {
    audioDir,
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL,
    ttsApiKey: process.env.OPENAI_TTS_API_KEY,
    ttsBaseUrl: process.env.OPENAI_TTS_BASE_URL,
  });
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`eng-vocab chạy tại http://localhost:${port}`));
}
