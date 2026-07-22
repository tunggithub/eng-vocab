import { test } from "node:test";
import assert from "node:assert/strict";
import { defineWord, buildScript, synthTTS, writeScript } from "../ai.js";

function fakeFetch(responder) { return async (url, init) => responder(String(url), init); }
const ok = (obj) => new Response(JSON.stringify(obj), { status: 200 });

test("defineWord parses the JSON content", async () => {
  const f = fakeFetch(() => ok({ choices: [{ message: { content: JSON.stringify({ meaning: "chăm chỉ", example: "She is diligent. - Cô ấy chăm chỉ.", pos: "tính từ", ipa: "/ˈdɪlɪdʒənt/" }) } }] }));
  const r = await defineWord("diligent", "key", f);
  assert.equal(r.meaning, "chăm chỉ");
  assert.equal(r.pos, "tính từ");
});

test("defineWord throws on OpenAI error", async () => {
  const f = fakeFetch(() => new Response("boom", { status: 429 }));
  await assert.rejects(() => defineWord("x", "key", f), /429/);
});

test("buildScript fallback includes every word", () => {
  const s = buildScript([{ term: "cat", meaning: "mèo", example: "A cat. - Con mèo." }], "vi");
  assert.match(s, /cat/);
  assert.match(s, /mèo/);
});

test("writeScript returns chat content", async () => {
  const f = fakeFetch(() => ok({ choices: [{ message: { content: "Xin chào, hôm nay học từ cat." } }] }));
  const s = await writeScript([{ term: "cat", meaning: "mèo" }], "single", "vi", "key", f);
  assert.match(s, /cat/);
});

test("synthTTS returns audio bytes", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const f = fakeFetch(() => new Response(bytes, { status: 200, headers: { "content-type": "audio/mpeg" } }));
  const buf = await synthTTS("hello", "alloy", "key", f);
  assert.equal(buf.length, 3);
});
