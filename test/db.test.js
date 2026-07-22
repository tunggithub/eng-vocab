import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db.js";

function freshDb() { return openDb(":memory:"); }

test("addWord stores defaults and returns the row", () => {
  const db = freshDb();
  const w = db.addWord({ term: "diligent", meaning: "chăm chỉ" });
  assert.ok(w.id, "has id");
  assert.equal(w.term, "diligent");
  assert.equal(w.box, 0);
  assert.equal(w.reviews, 0);
  assert.equal(w.example, "");
  assert.equal(w.last_review, null);
  assert.match(w.created, /^\d{4}-\d{2}-\d{2}$/);
  db.close();
});

test("listWords returns newest-created first", () => {
  const db = freshDb();
  db.addWord({ term: "a", meaning: "a", created: "2024-01-01" });
  db.addWord({ term: "b", meaning: "b", created: "2024-02-01" });
  const list = db.listWords();
  assert.equal(list[0].term, "b");
  assert.equal(list.length, 2);
  db.close();
});

test("updateWord patches only given fields", () => {
  const db = freshDb();
  const w = db.addWord({ term: "x", meaning: "x" });
  const u = db.updateWord(w.id, { box: 2, due: "2030-01-01" });
  assert.equal(u.box, 2);
  assert.equal(u.due, "2030-01-01");
  assert.equal(u.term, "x");
  assert.equal(db.updateWord("nope", { box: 1 }), null);
  db.close();
});

test("deleteWord and bulkAddWords", () => {
  const db = freshDb();
  const n = db.bulkAddWords([{ term: "a", meaning: "a" }, { term: "b", meaning: "b" }]);
  assert.equal(n, 2);
  const first = db.listWords()[0];
  assert.equal(db.deleteWord(first.id), true);
  assert.equal(db.listWords().length, 1);
  db.close();
});

test("resetProgress clears review state", () => {
  const db = freshDb();
  const w = db.addWord({ term: "a", meaning: "a", box: 3, reviews: 5, correct: 4, learned_on: "2024-01-01" });
  db.resetProgress();
  const got = db.listWords()[0];
  assert.equal(got.box, 0);
  assert.equal(got.reviews, 0);
  assert.equal(got.learned_on, null);
  db.close();
});

test("meta defaults then upsert", () => {
  const db = freshDb();
  assert.deepEqual(db.getMeta(), { streak: 0, last_review_day: null });
  db.upsertMeta({ streak: 3, last_review_day: "2024-05-01" });
  assert.deepEqual(db.getMeta(), { streak: 3, last_review_day: "2024-05-01" });
  db.upsertMeta({ streak: 4, last_review_day: "2024-05-02" });
  assert.equal(db.getMeta().streak, 4);
  db.close();
});

test("podcast hash round-trip", () => {
  const db = freshDb();
  assert.equal(db.getPodcastHash(), null);
  db.setPodcastHash("abc");
  assert.equal(db.getPodcastHash(), "abc");
  db.close();
});
