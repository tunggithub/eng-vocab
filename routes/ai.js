import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { defineWord, writeScript, buildScript, synthTTS, VOICES, STYLES, MAX_CHARS, DEFAULT_BASE_URL } from "../ai.js";

export function aiRouter(db, { audioDir, apiKey, fetchImpl = fetch, baseUrl, ttsApiKey, ttsBaseUrl }) {
  const r = express.Router();

  // Chat (define-word + podcast scripts) uses apiKey/baseUrl. TTS can use a
  // separate key/endpoint: if a dedicated TTS key is given, default its base to
  // the real OpenAI API (not the chat proxy, which may not do speech).
  const ttsKey = ttsApiKey || apiKey;
  const ttsBase = ttsBaseUrl || (ttsApiKey ? DEFAULT_BASE_URL : baseUrl);

  r.post("/define-word", async (req, res) => {
    if (!apiKey) return res.status(500).json({ error: "Server chưa đặt OPENAI_API_KEY" });
    const term = (req.body?.term || "").trim();
    if (!term) return res.status(400).json({ error: "Chưa có từ" });
    try {
      res.json(await defineWord(term, apiKey, fetchImpl, baseUrl));
    } catch (e) {
      res.status(502).json({ error: String(e.message || e) });
    }
  });

  r.post("/generate-podcast", async (req, res) => {
    if (!apiKey) return res.status(500).json({ error: "Server chưa đặt OPENAI_API_KEY" });
    const { words, hash, voice, style, force } = req.body || {};
    if (!Array.isArray(words) || words.length === 0) return res.status(400).json({ error: "Không có từ nào" });
    const useVoice = VOICES.includes(voice) ? voice : "alloy";
    const useStyle = STYLES.includes(style) ? style : "single";
    const explainPath = path.join(audioDir, "explain.mp3");
    const podcastPath = path.join(audioDir, "podcast.mp3");
    const result = { explainUrl: "/audio/explain.mp3", podcastUrl: "/audio/podcast.mp3" };

    const exists = async (p) => { try { await fs.access(p); return true; } catch { return false; } };
    if (!force && hash && db.getPodcastHash() === hash && (await exists(explainPath)) && (await exists(podcastPath))) {
      return res.json({ ...result, reused: true });
    }

    const makeScript = async (lang) => {
      let s = "";
      try { s = await writeScript(words, useStyle, lang, apiKey, fetchImpl, baseUrl); }
      catch (e) { console.error(`[podcast] writeScript(${lang}) failed:`, String(e)); s = ""; }
      if (!s) s = buildScript(words, lang);
      return s.length > MAX_CHARS ? s.slice(0, MAX_CHARS) : s;
    };

    try {
      const [scriptVi, scriptEn] = await Promise.all([makeScript("vi"), makeScript("en")]);
      const [audioVi, audioEn] = await Promise.all([
        synthTTS(scriptVi, useVoice, ttsKey, fetchImpl, ttsBase),
        synthTTS(scriptEn, useVoice, ttsKey, fetchImpl, ttsBase),
      ]);
      await fs.mkdir(audioDir, { recursive: true });
      await fs.writeFile(explainPath, audioVi);
      await fs.writeFile(podcastPath, audioEn);
      db.setPodcastHash(hash ?? null);
      res.json({ ...result, reused: false });
    } catch (e) {
      res.status(502).json({ error: String(e.message || e) });
    }
  });

  return r;
}
