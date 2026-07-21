import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db.js";
import { createApp } from "../server.js";

let server, base, db;

before(async () => {
  db = openDb(":memory:");
  const app = createApp(db, { audioDir: "/tmp", apiKey: "test", fetchImpl: async () => {} });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://localhost:${server.address().port}`;
});
after(() => { server.close(); db.close(); });

const j = (path, opts) => fetch(base + path, opts).then(async (r) => ({ status: r.status, body: await r.json() }));

test("POST then GET words", async () => {
  const created = await j("/api/words", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ term: "diligent", meaning: "chăm chỉ" }),
  });
  assert.equal(created.status, 201);
  assert.ok(created.body.id);
  const list = await j("/api/words");
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].term, "diligent");
});

test("PATCH and DELETE word", async () => {
  const { body: w } = await j("/api/words", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ term: "temp", meaning: "m" }),
  });
  const patched = await j(`/api/words/${w.id}`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ box: 2 }),
  });
  assert.equal(patched.body.box, 2);
  const del = await fetch(`${base}/api/words/${w.id}`, { method: "DELETE" });
  assert.equal(del.status, 200);
  const missing = await fetch(`${base}/api/words/nope`, { method: "DELETE" });
  assert.equal(missing.status, 404);
});

test("bulk and reset-progress", async () => {
  const bulk = await j("/api/words/bulk", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify([{ term: "a", meaning: "a", box: 3 }, { term: "b", meaning: "b", box: 4 }]),
  });
  assert.equal(bulk.body.inserted, 2);
  await j("/api/reset-progress", { method: "POST" });
  const list = await j("/api/words");
  assert.ok(list.body.every((w) => w.box === 0));
});

test("meta GET default then PUT", async () => {
  const def = await j("/api/meta");
  assert.equal(def.body.streak, 0);
  await j("/api/meta", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ streak: 5, last_review_day: "2024-06-01" }),
  });
  const got = await j("/api/meta");
  assert.equal(got.body.streak, 5);
});

test("POST /api/words rejects missing meaning", async () => {
  const res = await j("/api/words", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ term: "test" }),
  });
  assert.equal(res.status, 400);
  assert.ok(res.body.error);
});

test("POST /api/words/bulk rejects non-array body", async () => {
  const res = await j("/api/words/bulk", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ term: "test", meaning: "m" }),
  });
  assert.equal(res.status, 400);
  assert.ok(res.body.error);
});

test("POST /api/words/bulk rejects item missing term", async () => {
  const listBefore = await j("/api/words");
  const countBefore = listBefore.body.length;
  const res = await j("/api/words/bulk", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify([{ meaning: "m" }]),
  });
  assert.equal(res.status, 400);
  assert.ok(res.body.error);
  const listAfter = await j("/api/words");
  assert.equal(listAfter.body.length, countBefore);
});
