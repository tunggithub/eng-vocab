import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../db.js";
import { createApp } from "../server.js";

let server, base, db, audioDir, calls;

function fakeFetch() {
  return async (url) => {
    calls.push(String(url));
    if (String(url).includes("/chat/completions")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ meaning: "mèo", example: "A cat. - Con mèo.", pos: "danh từ", ipa: "/kæt/" }) } }] }), { status: 200 });
    }
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  };
}

before(async () => {
  db = openDb(":memory:");
  audioDir = fs.mkdtempSync(path.join(os.tmpdir(), "vocab-audio-"));
  calls = [];
  const app = createApp(db, { audioDir, apiKey: "test-key", fetchImpl: fakeFetch() });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://localhost:${server.address().port}`;
});
after(() => { server.close(); db.close(); fs.rmSync(audioDir, { recursive: true, force: true }); });

const post = (path, body) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

test("define-word returns parsed fields", async () => {
  const r = await post("/api/define-word", { term: "cat" });
  assert.equal(r.status, 200);
  assert.equal(r.body.meaning, "mèo");
});

test("define-word 400 without term", async () => {
  const r = await post("/api/define-word", {});
  assert.equal(r.status, 400);
});

test("generate-podcast writes both files then reuses", async () => {
  const words = [{ term: "cat", meaning: "mèo", example: "A cat. - Con mèo." }];
  const first = await post("/api/generate-podcast", { words, hash: "h1", voice: "alloy", style: "single", force: false });
  assert.equal(first.status, 200);
  assert.equal(first.body.reused, false);
  assert.equal(first.body.explainUrl, "/audio/explain.mp3");
  assert.ok(fs.existsSync(path.join(audioDir, "explain.mp3")));
  assert.ok(fs.existsSync(path.join(audioDir, "podcast.mp3")));

  const callsBefore = calls.length;
  const second = await post("/api/generate-podcast", { words, hash: "h1", voice: "alloy", style: "single", force: false });
  assert.equal(second.body.reused, true);
  assert.equal(calls.length, callsBefore, "no new OpenAI calls on reuse");
});

test("chat and TTS route to their own endpoints + keys (proxy chat, real-OpenAI TTS)", async () => {
  const seen = [];
  const recordingFetch = async (url, init) => {
    seen.push({ url: String(url), auth: init.headers.Authorization });
    if (String(url).includes("/chat/completions")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: "Xin chào cat." } }] }), { status: 200 });
    }
    return new Response(new Uint8Array([9]), { status: 200 });
  };
  const db2 = openDb(":memory:");
  const audioDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "vocab-tts-"));
  const app2 = createApp(db2, {
    audioDir: audioDir2,
    apiKey: "proxy-key",
    baseUrl: "http://localhost:8080/v1",
    ttsApiKey: "real-openai-key",
    fetchImpl: recordingFetch,
  });
  const s2 = app2.listen(0);
  await new Promise((r) => s2.once("listening", r));
  const b2 = `http://localhost:${s2.address().port}`;
  try {
    await fetch(b2 + "/api/generate-podcast", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ words: [{ term: "cat", meaning: "mèo" }], hash: "h", voice: "alloy", style: "single", force: true }),
    }).then((r) => r.json());

    const chat = seen.filter((c) => c.url.includes("/chat/completions"));
    const tts = seen.filter((c) => c.url.includes("/audio/speech"));
    assert.ok(chat.length >= 1, "chat called");
    assert.ok(tts.length >= 1, "tts called");
    for (const c of chat) {
      assert.equal(c.url, "http://localhost:8080/v1/chat/completions");
      assert.equal(c.auth, "Bearer proxy-key");
    }
    for (const t of tts) {
      assert.equal(t.url, "https://api.openai.com/v1/audio/speech", "TTS defaults to real OpenAI when a TTS key is set");
      assert.equal(t.auth, "Bearer real-openai-key");
    }
  } finally {
    s2.close(); db2.close(); fs.rmSync(audioDir2, { recursive: true, force: true });
  }
});
