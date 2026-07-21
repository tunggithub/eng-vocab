# Local Migration (off Supabase & Vercel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase (Postgres/auth/storage/edge functions) and Vercel hosting with a self-contained local Node backend + SQLite, so the app runs with `npm start` or Docker on one machine, single user, no login.

**Architecture:** A small Express server (`server.js`) serves the static frontend (`index.html`, `api.js`), exposes a REST API over a SQLite database (`db.js`), and proxies OpenAI for the two AI features (`ai.js` + `routes/ai.js`). The frontend's Supabase calls are replaced by a thin `api.js` fetch client; all auth is removed.

**Tech Stack:** Node.js 24, Express 4, better-sqlite3, dotenv, built-in `node:test`. OpenAI via `fetch`.

## Global Constraints

- Single user — no auth, no `user_id`, no RLS anywhere.
- OpenAI key comes from `process.env.OPENAI_API_KEY` only; never sent to or stored in the frontend.
- OpenAI model constants copied verbatim from the current Edge Functions: `TEXT_MODEL = "gpt-5.4-nano"`, `TTS_MODEL = "gpt-4o-mini-tts"`.
- Podcast generates two MP3s: `explain.mp3` (Vietnamese bilingual) and `podcast.mp3` (English immersion); the frontend expects `{ explainUrl, podcastUrl, reused }`.
- Word column set matches `supabase-schema.sql` minus `user_id`: `id, term, meaning, example, ipa, audio, pos, note, box, due, created, reviews, correct, last_review, learned_on`.
- Dates are `YYYY-MM-DD` text (SQLite has no date type; matches what the JS frontend sends/reads).
- `db.js` and `ai.js` contain no HTTP concerns; route files are thin and delegate.
- Dependency injection for testability: `createApp(db, opts)` takes the db + `{ audioDir, apiKey, fetchImpl }`; `ai.js` functions accept an optional `fetchImpl` (defaults to global `fetch`).
- Static serving is explicit (`/` → index.html, `/api.js` → api.js, `/audio` → audioDir). Do NOT `express.static` the project root — it would expose `.env` and source.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `.gitignore` (replace existing)
- Create: `.env.example`
- Create: `data/.gitkeep`
- Test: `test/scaffold.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: an installable npm project with scripts `start` (`node server.js`) and `test` (`node --test`). Runtime deps `express`, `better-sqlite3`, `dotenv`. Dev dep `@supabase/supabase-js` (only for the one-shot migration script).

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "eng-vocab",
  "version": "1.0.0",
  "description": "Local vocabulary flashcard app (SQLite + Express + OpenAI)",
  "type": "module",
  "private": true,
  "scripts": {
    "start": "node server.js",
    "test": "node --test",
    "pull": "node scripts/pull-from-supabase.js"
  },
  "dependencies": {
    "better-sqlite3": "^11.8.1",
    "dotenv": "^16.4.7",
    "express": "^4.21.2"
  },
  "devDependencies": {
    "@supabase/supabase-js": "^2.48.1"
  }
}
```

- [ ] **Step 2: Write `.gitignore`**

```gitignore
node_modules/
.env
/data/*
!/data/.gitkeep
*.log
.DS_Store
.vercel
```

- [ ] **Step 3: Write `.env.example`**

```dotenv
# Copy to .env and fill in. The OpenAI key stays server-side only.
OPENAI_API_KEY=sk-...
PORT=3000
```

- [ ] **Step 4: Create the data directory placeholder**

Create `data/.gitkeep` as an empty file.

- [ ] **Step 5: Write a scaffold sanity test** in `test/scaffold.test.js`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("package.json declares the expected scripts and deps", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
  assert.equal(pkg.type, "module");
  assert.equal(pkg.scripts.start, "node server.js");
  for (const dep of ["express", "better-sqlite3", "dotenv"]) {
    assert.ok(pkg.dependencies[dep], `missing dep ${dep}`);
  }
});
```

- [ ] **Step 6: Install and run**

Run: `npm install`
Expected: installs without error (better-sqlite3 compiles or fetches a prebuilt binary).
Run: `npm test`
Expected: PASS (1 test).

- [ ] **Step 7: Commit**

```bash
git add package.json .gitignore .env.example data/.gitkeep test/scaffold.test.js package-lock.json
git commit -m "chore: scaffold local Node project"
```

---

### Task 2: SQLite layer (`db.js`)

**Files:**
- Create: `db.js`
- Test: `test/db.test.js`

**Interfaces:**
- Consumes: `better-sqlite3`.
- Produces: `openDb(path)` returning an object with:
  - `listWords(): Word[]` — ordered by `created` desc, then `id` desc for stability.
  - `addWord(fields): Word` — sets `id = crypto.randomUUID()`; defaults `box=0, reviews=0, correct=0`, `created`/`due` = today, empty strings for text fields, null for `last_review`/`learned_on` when absent. Returns the stored row.
  - `bulkAddWords(fieldsArray): number` — inserts many in one transaction, returns count.
  - `updateWord(id, fields): Word | null` — updates only provided columns; returns updated row or null if id missing.
  - `deleteWord(id): boolean`
  - `resetProgress(): void` — sets `box=0, due=today, reviews=0, correct=0, last_review=null, learned_on=null` for all rows.
  - `getMeta(): { streak, last_review_day }` — defaults `{ streak: 0, last_review_day: null }`.
  - `upsertMeta({ streak, last_review_day }): void`
  - `getPodcastHash(): string | null`
  - `setPodcastHash(hash): void`
  - `close(): void`
  - `todayStr(): string` — `YYYY-MM-DD` local date (exported helper).

- [ ] **Step 1: Write the failing test** in `test/db.test.js`

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/db.test.js`
Expected: FAIL — cannot import `../db.js` (module not found).

- [ ] **Step 3: Write `db.js`**

```js
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const WORD_COLUMNS = [
  "term", "meaning", "example", "ipa", "audio", "pos", "note",
  "box", "due", "created", "reviews", "correct", "last_review", "learned_on",
];

function normalizeWord(f) {
  const t = todayStr();
  const str = (v) => (v == null ? "" : String(v));
  return {
    id: f.id || randomUUID(),
    term: str(f.term).trim(),
    meaning: str(f.meaning).trim(),
    example: str(f.example),
    ipa: str(f.ipa),
    audio: str(f.audio),
    pos: str(f.pos),
    note: str(f.note),
    box: Number.isFinite(f.box) ? f.box : 0,
    due: f.due || t,
    created: f.created || t,
    reviews: Number.isFinite(f.reviews) ? f.reviews : 0,
    correct: Number.isFinite(f.correct) ? f.correct : 0,
    last_review: f.last_review ?? null,
    learned_on: f.learned_on ?? null,
  };
}

export function openDb(path) {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS words (
      id TEXT PRIMARY KEY,
      term TEXT NOT NULL,
      meaning TEXT NOT NULL,
      example TEXT DEFAULT '',
      ipa TEXT DEFAULT '',
      audio TEXT DEFAULT '',
      pos TEXT DEFAULT '',
      note TEXT DEFAULT '',
      box INTEGER NOT NULL DEFAULT 0,
      due TEXT NOT NULL,
      created TEXT NOT NULL,
      reviews INTEGER NOT NULL DEFAULT 0,
      correct INTEGER NOT NULL DEFAULT 0,
      last_review TEXT,
      learned_on TEXT
    );
    CREATE INDEX IF NOT EXISTS words_due_idx ON words (due);
    CREATE TABLE IF NOT EXISTS meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      streak INTEGER NOT NULL DEFAULT 0,
      last_review_day TEXT
    );
    CREATE TABLE IF NOT EXISTS podcast (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      word_hash TEXT,
      updated_at TEXT
    );
  `);

  const insertStmt = sqlite.prepare(`
    INSERT INTO words (id, term, meaning, example, ipa, audio, pos, note, box, due, created, reviews, correct, last_review, learned_on)
    VALUES (@id, @term, @meaning, @example, @ipa, @audio, @pos, @note, @box, @due, @created, @reviews, @correct, @last_review, @learned_on)
  `);
  const getStmt = sqlite.prepare(`SELECT * FROM words WHERE id = ?`);

  function insert(fields) {
    const row = normalizeWord(fields);
    insertStmt.run(row);
    return getStmt.get(row.id);
  }

  const bulkTxn = sqlite.transaction((arr) => {
    for (const f of arr) insert(f);
    return arr.length;
  });

  return {
    todayStr,
    listWords() {
      return sqlite.prepare(`SELECT * FROM words ORDER BY created DESC, id DESC`).all();
    },
    addWord: insert,
    bulkAddWords: (arr) => bulkTxn(arr),
    updateWord(id, fields) {
      const cols = WORD_COLUMNS.filter((c) => c in fields);
      if (cols.length === 0) return getStmt.get(id) || null;
      const set = cols.map((c) => `${c} = @${c}`).join(", ");
      const params = { id };
      for (const c of cols) params[c] = fields[c];
      const info = sqlite.prepare(`UPDATE words SET ${set} WHERE id = @id`).run(params);
      return info.changes ? getStmt.get(id) : null;
    },
    deleteWord(id) {
      return sqlite.prepare(`DELETE FROM words WHERE id = ?`).run(id).changes > 0;
    },
    resetProgress() {
      sqlite.prepare(
        `UPDATE words SET box = 0, due = @t, reviews = 0, correct = 0, last_review = NULL, learned_on = NULL`
      ).run({ t: todayStr() });
    },
    getMeta() {
      const row = sqlite.prepare(`SELECT streak, last_review_day FROM meta WHERE id = 1`).get();
      return row || { streak: 0, last_review_day: null };
    },
    upsertMeta({ streak, last_review_day }) {
      sqlite.prepare(`
        INSERT INTO meta (id, streak, last_review_day) VALUES (1, @streak, @last_review_day)
        ON CONFLICT(id) DO UPDATE SET streak = @streak, last_review_day = @last_review_day
      `).run({ streak: streak ?? 0, last_review_day: last_review_day ?? null });
    },
    getPodcastHash() {
      const row = sqlite.prepare(`SELECT word_hash FROM podcast WHERE id = 1`).get();
      return row ? row.word_hash : null;
    },
    setPodcastHash(hash) {
      sqlite.prepare(`
        INSERT INTO podcast (id, word_hash, updated_at) VALUES (1, @hash, @at)
        ON CONFLICT(id) DO UPDATE SET word_hash = @hash, updated_at = @at
      `).run({ hash: hash ?? null, at: new Date().toISOString() });
    },
    close: () => sqlite.close(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/db.test.js`
Expected: PASS (all 7 tests).

- [ ] **Step 5: Commit**

```bash
git add db.js test/db.test.js
git commit -m "feat: SQLite layer with words/meta/podcast helpers"
```

---

### Task 3: HTTP app + words & meta routes (`server.js`, `routes/words.js`, `routes/meta.js`)

**Files:**
- Create: `server.js`
- Create: `routes/words.js`
- Create: `routes/meta.js`
- Test: `test/api.test.js`

**Interfaces:**
- Consumes: `openDb` from `db.js`.
- Produces:
  - `createApp(db, opts)` from `server.js` — returns an Express app. `opts = { audioDir, apiKey, fetchImpl }` (all optional here; AI opts used in Task 5). Mounts word/meta routers under `/api`, serves `/` → `index.html` and `/api.js` → `api.js` via `sendFile`, and `/audio` static from `opts.audioDir`.
  - `wordsRouter(db)` from `routes/words.js`, `metaRouter(db)` from `routes/meta.js`.
  - When run directly (`node server.js`), opens `data/vocab.db`, creates `data/audio`, and listens on `PORT` (default 3000).
- Endpoints: `GET/POST /api/words`, `PATCH/DELETE /api/words/:id`, `POST /api/words/bulk`, `POST /api/reset-progress`, `GET/PUT /api/meta`.

- [ ] **Step 1: Write the failing test** in `test/api.test.js`

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/api.test.js`
Expected: FAIL — cannot import `../server.js`.

- [ ] **Step 3: Write `routes/words.js`**

```js
import express from "express";

export function wordsRouter(db) {
  const r = express.Router();

  r.get("/words", (_req, res) => res.json(db.listWords()));

  r.post("/words", (req, res) => {
    const { term, meaning } = req.body || {};
    if (!term || !meaning) return res.status(400).json({ error: "Thiếu term hoặc meaning" });
    res.status(201).json(db.addWord(req.body));
  });

  r.post("/words/bulk", (req, res) => {
    if (!Array.isArray(req.body)) return res.status(400).json({ error: "Body phải là mảng" });
    res.status(201).json({ inserted: db.bulkAddWords(req.body) });
  });

  r.post("/reset-progress", (_req, res) => { db.resetProgress(); res.json({ ok: true }); });

  r.patch("/words/:id", (req, res) => {
    const updated = db.updateWord(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: "Không tìm thấy từ" });
    res.json(updated);
  });

  r.delete("/words/:id", (req, res) => {
    if (!db.deleteWord(req.params.id)) return res.status(404).json({ error: "Không tìm thấy từ" });
    res.json({ ok: true });
  });

  return r;
}
```

- [ ] **Step 4: Write `routes/meta.js`**

```js
import express from "express";

export function metaRouter(db) {
  const r = express.Router();
  r.get("/meta", (_req, res) => res.json(db.getMeta()));
  r.put("/meta", (req, res) => {
    const { streak, last_review_day } = req.body || {};
    db.upsertMeta({ streak, last_review_day });
    res.json(db.getMeta());
  });
  return r;
}
```

- [ ] **Step 5: Write `server.js`** (AI router import is added in Task 5; leave it out for now)

```js
import express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import "dotenv/config";
import { openDb } from "./db.js";
import { wordsRouter } from "./routes/words.js";
import { metaRouter } from "./routes/meta.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(db, opts = {}) {
  const audioDir = opts.audioDir || path.join(__dirname, "data", "audio");
  const app = express();
  app.use(express.json({ limit: "5mb" }));

  app.use("/api", wordsRouter(db));
  app.use("/api", metaRouter(db));

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
  const app = createApp(db, { audioDir, apiKey: process.env.OPENAI_API_KEY });
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`eng-vocab chạy tại http://localhost:${port}`));
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test test/api.test.js`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add server.js routes/words.js routes/meta.js test/api.test.js
git commit -m "feat: Express app with words + meta REST API"
```

---

### Task 4: OpenAI helpers (`ai.js`)

**Files:**
- Create: `ai.js`
- Test: `test/ai.test.js`

**Interfaces:**
- Consumes: nothing (uses injected `fetchImpl`, default global `fetch`).
- Produces (all take `apiKey` and optional `fetchImpl`):
  - `defineWord(term, apiKey, fetchImpl?): Promise<{meaning, example, pos, ipa}>` — throws `Error` on non-OK OpenAI response.
  - `writeScript(words, style, lang, apiKey, fetchImpl?): Promise<string>` — throws on failure.
  - `buildScript(words, lang): string` — pure fallback, no network.
  - `synthTTS(script, voice, apiKey, fetchImpl?): Promise<Buffer>` — throws on non-OK.
  - Constants `VOICES`, `STYLES`, `TEXT_MODEL`, `TTS_MODEL`, `MAX_CHARS`.

Port the prompt strings, styles, and constants verbatim from `supabase/functions/*/index.ts` (do not paraphrase the Vietnamese prompts).

- [ ] **Step 1: Write the failing test** in `test/ai.test.js`

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ai.test.js`
Expected: FAIL — cannot import `../ai.js`.

- [ ] **Step 3: Write `ai.js`** (prompts copied verbatim from the Edge Functions)

```js
export const VOICES = ["alloy", "nova", "shimmer", "echo", "fable", "onyx"];
export const STYLES = ["single", "dialogue", "story"];
export const TEXT_MODEL = "gpt-5.4-nano";
export const TTS_MODEL = "gpt-4o-mini-tts";
export const MAX_CHARS = 4000;

const CHAT_URL = "https://api.openai.com/v1/chat/completions";
const SPEECH_URL = "https://api.openai.com/v1/audio/speech";

export async function defineWord(term, apiKey, fetchImpl = fetch) {
  const system =
    "Bạn là trợ lý học từ vựng tiếng Anh cho người Việt. " +
    "Với một từ hoặc cụm từ tiếng Anh, hãy trả về DUY NHẤT một JSON đúng các khoá " +
    '{"meaning":"","example":"","pos":"","ipa":""}. ' +
    "meaning = nghĩa tiếng Việt ngắn gọn, tự nhiên của từ đó. " +
    "example = MỘT câu ví dụ tiếng Anh tự nhiên có dùng từ đó, theo sau là bản dịch tiếng Việt của chính câu đó, ngăn cách bằng ' - ' (ví dụ: \"She is very diligent. - Cô ấy rất chăm chỉ.\"). " +
    "pos = từ loại bằng tiếng Việt, KHÔNG giới hạn ở từ đơn: nếu là một từ thì dùng danh từ, động từ, tính từ, trạng từ, giới từ, liên từ, đại từ, thán từ (chọn loại phổ biến nhất khi có nhiều loại); " +
    "nếu là cụm từ nhiều chữ thì dùng loại phù hợp như cụm động từ, cụm danh từ, cụm tính từ, cụm giới từ, thành ngữ, hoặc cụm từ (ví dụ: \"lean against\" -> \"cụm động từ\"); nếu không xác định được thì để chuỗi rỗng. " +
    "ipa = phiên âm IPA của từ/cụm từ theo giọng Anh-Mỹ, đặt trong dấu gạch chéo, ví dụ \"/ˈjuːnɪk/\" hoặc \"/liːn əˈɡɛnst/\"; nếu không chắc thì để chuỗi rỗng. " +
    "Không thêm bất kỳ chữ nào ngoài JSON.";
  const res = await fetchImpl(CHAT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: TEXT_MODEL,
      messages: [{ role: "system", content: system }, { role: "user", content: "Từ: " + term }],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI lỗi (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  let parsed = {};
  try { parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? ""); } catch { parsed = {}; }
  const meaning = String(parsed.meaning ?? "").trim();
  const example = String(parsed.example ?? "").trim();
  const pos = String(parsed.pos ?? "").trim();
  const ipa = String(parsed.ipa ?? "").trim();
  if (!meaning && !example) throw new Error("AI không trả về nội dung hợp lệ");
  return { meaning, example, pos, ipa };
}

export async function writeScript(words, style, lang, apiKey, fetchImpl = fetch) {
  const isEn = lang === "en";
  const list = words.map((w, i) =>
    isEn
      ? `${i + 1}. ${w.term}${w.meaning ? ` (nghĩa: ${w.meaning})` : ""}`
      : `${i + 1}. ${w.term} — ${w.meaning}${w.example ? ` (ví dụ: ${w.example})` : ""}`).join("\n");
  const styleGuideVi = {
    single: "Một người dẫn chương trình thân thiện, tự giải thích từng từ một cách gần gũi, kèm mẹo ghi nhớ ngắn.",
    dialogue: "Hai người dẫn trò chuyện qua lại (đặt tên là Minh và Lan). Minh hỏi, Lan giải thích. Ghi rõ tên trước mỗi lượt nói, ví dụ 'Minh:' rồi 'Lan:'.",
    story: "Lồng tất cả các từ vào một mẩu chuyện ngắn vui nhộn bằng tiếng Việt, sau đó tóm tắt lại nghĩa từng từ ở cuối.",
  };
  const styleGuideEn = {
    single: "A single friendly host who narrates naturally and works each word into real context, with a quick memory tip now and then.",
    dialogue: "Two hosts named Alex and Sam in a natural back-and-forth chat. Prefix every turn with the speaker's name, e.g. 'Alex:' then 'Sam:'.",
    story: "Weave all of the words into one short, fun, coherent story.",
  };
  const systemVi =
    "Bạn là biên kịch cho một podcast học từ vựng tiếng Anh dành cho người Việt. " +
    "Viết kịch bản BẰNG TIẾNG VIỆT để đọc thành tiếng, nhưng GIỮ NGUYÊN các từ vựng tiếng Anh bằng tiếng Anh. " +
    "Văn nói tự nhiên, ấm áp, dễ nghe. Với mỗi từ: nêu từ, nghĩa, cách dùng và một ví dụ. " +
    "Tuyệt đối KHÔNG dùng markdown, gạch đầu dòng, ký hiệu đặc biệt hay emoji — chỉ văn xuôi để đọc. " +
    "Độ dài khoảng 250–450 từ. Có lời chào mở đầu và lời kết động viên.";
  const systemEn =
    "You are a scriptwriter for an English-learning podcast aimed at Vietnamese learners. " +
    "Write the ENTIRE script in natural, spoken English only — do NOT use any Vietnamese. " +
    "Weave ALL of the given vocabulary words naturally into the content so that every single word is actually used in context at least once. " +
    "Keep it engaging and easy to follow for intermediate learners, at a comfortable listening pace. " +
    "Do NOT use markdown, bullet points, special symbols, or emoji — only prose to be read aloud. " +
    "Length about 250–450 words. Include a short welcome and an encouraging closing.";
  const userVi =
    `Phong cách: ${styleGuideVi[style] || styleGuideVi.single}\n\n` +
    `Danh sách ${words.length} từ hôm nay:\n${list}\n\n` +
    "Hãy viết kịch bản hoàn chỉnh, chỉ trả về phần lời thoại để đọc.";
  const userEn =
    `Style: ${styleGuideEn[style] || styleGuideEn.single}\n\n` +
    `The ${words.length} vocabulary words to include today:\n${list}\n\n` +
    "Write the complete script. Return only the spoken lines, nothing else.";
  const res = await fetchImpl(CHAT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: TEXT_MODEL,
      messages: [{ role: "system", content: isEn ? systemEn : systemVi }, { role: "user", content: isEn ? userEn : userVi }],
    }),
  });
  if (!res.ok) throw new Error(`chat ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("chat trả về rỗng");
  return text;
}

export function buildScript(words, lang) {
  const parts = [];
  if (lang === "en") {
    parts.push(`Welcome to today's English vocabulary podcast. Today we will practice ${words.length} words. Let's begin.`);
    words.forEach((w, i) => {
      parts.push(`Word ${i + 1}: ${w.term}.`);
      const enEx = (w.example || "").split(" - ")[0].trim();
      if (enEx) parts.push(`For example: ${enEx}.`);
    });
    parts.push("That's all for today. Keep practicing every day. See you next time!");
    return parts.join("\n");
  }
  const d = new Date();
  const dateVi = `${d.getDate()} tháng ${d.getMonth() + 1}`;
  parts.push(`Chào mừng bạn đến với podcast từ vựng ngày ${dateVi}. Hôm nay chúng ta cùng ôn ${words.length} từ. Bắt đầu nhé.`);
  words.forEach((w, i) => {
    parts.push(`Từ số ${i + 1}. ${w.term}.`);
    parts.push(`Nghĩa là: ${w.meaning}.`);
    if (w.example) parts.push(`Ví dụ: ${w.example}.`);
  });
  parts.push("Đó là toàn bộ từ vựng hôm nay. Học đều mỗi ngày nhé. Hẹn gặp lại bạn!");
  return parts.join("\n");
}

export async function synthTTS(script, voice, apiKey, fetchImpl = fetch) {
  const res = await fetchImpl(SPEECH_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: TTS_MODEL, voice, input: script, response_format: "mp3" }),
  });
  if (!res.ok) throw new Error(`OpenAI lỗi (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ai.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add ai.js test/ai.test.js
git commit -m "feat: OpenAI helpers ported from Edge Functions"
```

---

### Task 5: AI routes + podcast reuse (`routes/ai.js`, wire into `server.js`)

**Files:**
- Create: `routes/ai.js`
- Modify: `server.js` (import + mount `aiRouter`)
- Test: `test/ai-routes.test.js`

**Interfaces:**
- Consumes: `db`, `ai.js` helpers, `opts.audioDir`, `opts.apiKey`, `opts.fetchImpl`.
- Produces: `aiRouter(db, { audioDir, apiKey, fetchImpl })` from `routes/ai.js`:
  - `POST /api/define-word` body `{ term }` → `{ meaning, example, pos, ipa }`. 400 if no term; 500 if no `apiKey`; 502 on OpenAI error.
  - `POST /api/generate-podcast` body `{ words, hash, voice, style, force }` → `{ explainUrl:"/audio/explain.mp3", podcastUrl:"/audio/podcast.mp3", reused }`. Writes `explain.mp3` (lang `vi`) and `podcast.mp3` (lang `en`) to `audioDir`. Reuse when `!force && hash && db.getPodcastHash() === hash && both files exist`. 500 if no `apiKey`; 400 if no words; 502 if TTS fails.

- [ ] **Step 1: Write the failing test** in `test/ai-routes.test.js`

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ai-routes.test.js`
Expected: FAIL — `aiRouter` / route not present (404 or import error).

- [ ] **Step 3: Write `routes/ai.js`**

```js
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { defineWord, writeScript, buildScript, synthTTS, VOICES, STYLES, MAX_CHARS } from "../ai.js";

export function aiRouter(db, { audioDir, apiKey, fetchImpl = fetch }) {
  const r = express.Router();

  r.post("/define-word", async (req, res) => {
    if (!apiKey) return res.status(500).json({ error: "Server chưa đặt OPENAI_API_KEY" });
    const term = (req.body?.term || "").trim();
    if (!term) return res.status(400).json({ error: "Chưa có từ" });
    try {
      res.json(await defineWord(term, apiKey, fetchImpl));
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
      try { s = await writeScript(words, useStyle, lang, apiKey, fetchImpl); }
      catch (e) { console.error(`[podcast] writeScript(${lang}) failed:`, String(e)); s = ""; }
      if (!s) s = buildScript(words, lang);
      return s.length > MAX_CHARS ? s.slice(0, MAX_CHARS) : s;
    };

    try {
      const [scriptVi, scriptEn] = await Promise.all([makeScript("vi"), makeScript("en")]);
      const [audioVi, audioEn] = await Promise.all([
        synthTTS(scriptVi, useVoice, apiKey, fetchImpl),
        synthTTS(scriptEn, useVoice, apiKey, fetchImpl),
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
```

- [ ] **Step 4: Wire `aiRouter` into `server.js`**

Add the import near the other route imports:

```js
import { aiRouter } from "./routes/ai.js";
```

Inside `createApp`, after the meta router line (`app.use("/api", metaRouter(db));`), add:

```js
  app.use("/api", aiRouter(db, {
    audioDir,
    apiKey: opts.apiKey,
    fetchImpl: opts.fetchImpl || fetch,
  }));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/ai-routes.test.js`
Expected: PASS (3 tests).
Run: `node --test`
Expected: PASS (all suites: scaffold, db, api, ai, ai-routes).

- [ ] **Step 6: Commit**

```bash
git add routes/ai.js server.js test/ai-routes.test.js
git commit -m "feat: AI routes for define-word and generate-podcast"
```

---

### Task 6: Frontend rewrite (`api.js` + `index.html`)

**Files:**
- Create: `api.js`
- Modify: `index.html` (remove Supabase/auth, wire to `api.js`)

**Interfaces:**
- Consumes: the REST API from Tasks 3 & 5.
- Produces: a global `window.api` object with: `listWords()`, `addWord(fields)`, `updateWord(id, fields)`, `deleteWord(id)`, `bulkAddWords(rows)`, `resetProgress()`, `getMeta()`, `putMeta({streak, last_review_day})`, `defineWord(term)`, `generatePodcast(payload)`. Each returns parsed JSON and throws `Error(body.error || statusText)` on non-2xx.

This task has no automated test (browser UI); it ends with a manual smoke run in Step 9.

- [ ] **Step 1: Write `api.js`**

```js
// ============================================================
//  Local API client — thay cho Supabase. Gọi backend Node cùng origin.
// ============================================================
(function () {
  async function req(method, path, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error((data && data.error) || res.statusText || "Lỗi máy chủ");
    return data;
  }

  window.api = {
    listWords: () => req("GET", "/api/words"),
    addWord: (fields) => req("POST", "/api/words", fields),
    updateWord: (id, fields) => req("PATCH", "/api/words/" + encodeURIComponent(id), fields),
    deleteWord: (id) => req("DELETE", "/api/words/" + encodeURIComponent(id)),
    bulkAddWords: (rows) => req("POST", "/api/words/bulk", rows),
    resetProgress: () => req("POST", "/api/reset-progress"),
    getMeta: () => req("GET", "/api/meta"),
    putMeta: (meta) => req("PUT", "/api/meta", meta),
    defineWord: (term) => req("POST", "/api/define-word", { term }),
    generatePodcast: (payload) => req("POST", "/api/generate-podcast", payload),
  };
})();
```

- [ ] **Step 2: Replace the script tags in `index.html`**

Lines 7-8 currently are:
```html
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="config.js"></script>
```
Replace both lines with a single tag:
```html
  <script src="api.js"></script>
```
This loads before the app's inline `<script>` (at ~line 255), so `window.api` is defined in time. Verify afterward: `grep -n "supabase-js\|config.js" index.html` returns nothing.

- [ ] **Step 3: Rewrite the data-access functions** (the "State + Supabase" block, `index.html:280-328`)

Replace lines 281-328 with:

```js
    // ---------- State + local API ----------
    const db = { words: [], streak: 0, lastReviewDay: null };

    async function loadAll() {
      db.words = await api.listWords();
      const meta = await api.getMeta();
      db.streak = (meta && meta.streak) || 0;
      db.lastReviewDay = (meta && meta.last_review_day) || null;
    }

    async function addWord(term, mean, ex, ipa, audio, pos, note) {
      const row = { term: term.trim(), meaning: mean.trim(), example: (ex || "").trim(), ipa: (ipa || "").trim(), audio: (audio || "").trim(), pos: (pos || "").trim(), note: (note || "").trim(), box: 0, due: todayStr(), created: todayStr(), reviews: 0, correct: 0 };
      const data = await api.addWord(row);
      db.words.unshift(data);
    }

    async function persistGrade(w) {
      try {
        await api.updateWord(w.id, { box: w.box, due: w.due, reviews: w.reviews, correct: w.correct, last_review: w.last_review, learned_on: w.learned_on });
      } catch (e) { toast("Lỗi lưu: " + e.message); }
    }

    async function deleteWord(id) {
      try { await api.deleteWord(id); }
      catch (e) { toast("Lỗi xoá: " + e.message); return false; }
      db.words = db.words.filter((w) => w.id !== id);
      return true;
    }

    async function updateWord(id, fields) {
      try {
        const data = await api.updateWord(id, fields);
        const i = db.words.findIndex((w) => w.id === id);
        if (i >= 0) db.words[i] = data;
        return true;
      } catch (e) { toast("Lỗi lưu: " + e.message); return false; }
    }

    async function bumpStreak() {
      const t = todayStr();
      if (db.lastReviewDay === t) return;
      const yesterday = addDays(t, -1);
      db.streak = db.lastReviewDay === yesterday ? (db.streak || 0) + 1 : 1;
      db.lastReviewDay = t;
      try { await api.putMeta({ streak: db.streak, last_review_day: t }); }
      catch (e) { toast("Lỗi lưu streak: " + e.message); }
    }
```

Note: the `let sb = null, user = null;` line is removed. If any other code references `user`, replace those references in later steps.

- [ ] **Step 4: Rewrite `resetProgress`** (`index.html:639-649`)

Replace the Supabase call inside `resetProgress`:
```js
      const { error } = await sb.from("words").update({ box: 0, due: t, reviews: 0, correct: 0, last_review: null, learned_on: null }).not("id", "is", null);
      if (error) { toast("Lỗi reset: " + error.message); if (rr) rr.disabled = false; return; }
```
with:
```js
      try { await api.resetProgress(); }
      catch (e) { toast("Lỗi reset: " + e.message); if (rr) rr.disabled = false; return; }
```

- [ ] **Step 5: Rewrite the import handler** (`index.html:1118`)

Replace:
```js
        const { error } = await sb.from("words").insert(rows);
        if (error) throw error;
        await loadAll();
```
with:
```js
        await api.bulkAddWords(rows);
        await loadAll();
```

- [ ] **Step 6: Rewrite `define-word` call** (`index.html:399-409`)

Replace:
```js
        const [invoked, dict] = await Promise.all([
          sb.functions.invoke("define-word", { body: { term } }),
          lookupWord(term),
        ]);
        const { data, error } = invoked;
        if (error) {
          let detail = "";
          try { const body = await error.context.json(); detail = body.error || ""; } catch (_) {}
          throw new Error(detail || error.message || "Không gọi được AI");
        }
        if (!data || data.error) throw new Error((data && data.error) || "Không có dữ liệu trả về");
```
with:
```js
        const [data, dict] = await Promise.all([
          api.defineWord(term),
          lookupWord(term),
        ]);
```
(`api.defineWord` throws on error, which the existing surrounding `try/catch` already handles. `data` now holds `{meaning, example, pos, ipa}` directly.)

- [ ] **Step 7: Rewrite `generate-podcast` call** (`index.html:991-1002`)

Replace:
```js
        const { data, error } = await sb.functions.invoke("generate-podcast", {
          body: { words: currentWordsPayload(), hash: wordsHash(), voice: aiVoice, style: aiStyle, force: !!force }
        });
        if (error) {
          let detail = "";
          try { const body = await error.context.json(); detail = body.error || ""; } catch (_) {}
          throw new Error(detail || error.message || "Không gọi được Edge Function");
        }
        if (!data || data.error) throw new Error((data && data.error) || "Không có dữ liệu trả về");
        if (!data.explainUrl || !data.podcastUrl) throw new Error("Thiếu audio trả về");
```
with:
```js
        const data = await api.generatePodcast({ words: currentWordsPayload(), hash: wordsHash(), voice: aiVoice, style: aiStyle, force: !!force });
        if (!data.explainUrl || !data.podcastUrl) throw new Error("Thiếu audio trả về");
```

Also update the error hint text in the `catch` (line ~1019) to drop the "deploy Edge Function" wording:
```js
        out.innerHTML = '<div class="progress-txt" style="color:var(--red)">Lỗi: ' + esc(e.message) + '.<br>' +
          'Kiểm tra server đã đặt <code>OPENAI_API_KEY</code> trong <code>.env</code> chưa (xem README). Trong lúc đó bạn vẫn nghe được bằng giọng trình duyệt bên dưới.</div>';
```

Note on audio playback: `explainUrl`/`podcastUrl` are now same-origin relative paths (`/audio/explain.mp3`). The browser caches by URL; the filenames are stable and overwritten on regenerate. Append a cache-buster so a regenerated file is re-fetched: in the `player(...)` calls (line ~1010-1011), change `data.explainUrl` → `data.explainUrl + '?t=' + Date.now()` and likewise for `data.podcastUrl`.

- [ ] **Step 8: Remove the auth screens + rewrite `init`** (`index.html:1132-1178`)

Delete `doAuth`, the `#btnAuth`/`#loginPass`/`#btnLogout` listeners, `onSession`, and the `loginMsg` helper. Keep the `show(screen)` helper only if still referenced elsewhere; otherwise delete it and remove `screenSetup`/`screenLogin` markup. Replace the `init` IIFE (lines 1170-1178) with:

```js
    // ---------- init ----------
    (async function init() {
      try {
        await loadAll();
      } catch (e) {
        toast("Lỗi tải dữ liệu: " + e.message + " (server đã chạy chưa?)");
        return;
      }
      renderStats();
      renderReview();
    })();
```

Then remove the `#screenSetup` and `#screenLogin` markup blocks and the account-email display (`#acctEmail`) / logout button from the HTML, and ensure the `#app` container is always visible (drop the `hidden` class on it if present). Verify no leftover references: `grep -nE "\bsb\b|screenLogin|screenSetup|onSession|acctEmail|signInWithPassword|window\.supabase|SUPABASE_" index.html` should return nothing.

- [ ] **Step 9: Manual smoke test**

Run: `OPENAI_API_KEY=sk-REAL npm start` (use a real key to exercise AI; without one, AI buttons show the graceful error and the rest works).
Open `http://localhost:3000` and verify:
1. App loads directly to the vocab UI (no login screen).
2. Add a word (with and without "nhờ AI" auto-define).
3. "Ôn hôm nay" — flip a card, grade it, reload page → grade persisted.
4. Reset progress works.
5. Export to JSON, then Import the same file → count increases.
6. Podcast → "Tạo audio bằng AI" produces two players; regenerate replaces them.

- [ ] **Step 10: Commit**

```bash
git add api.js index.html
git commit -m "feat: rewire frontend to local API, remove Supabase + auth"
```

---

### Task 7: Docker (npm + container both supported)

**Files:**
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `.dockerignore`

**Interfaces:**
- Consumes: `package.json`, `server.js`.
- Produces: a container that runs `node server.js` on port 3000, with `./data` mounted as a volume and `OPENAI_API_KEY` passed through.

- [ ] **Step 1: Rewrite `Dockerfile`**

```dockerfile
# App cục bộ: backend Node + SQLite, không cần Supabase/Vercel
FROM node:24-slim

# better-sqlite3 cần build tools nếu không có prebuilt binary
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js db.js ai.js index.html api.js ./
COPY routes ./routes

EXPOSE 3000
CMD ["node", "server.js"]
```

- [ ] **Step 2: Rewrite `docker-compose.yml`**

```yaml
services:
  app:
    build: .
    image: eng-vocab
    container_name: eng-vocab
    ports:
      - "3000:3000"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - PORT=3000
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

- [ ] **Step 3: Update `.dockerignore`**

```gitignore
node_modules
.git
data
.env
*.log
docs
test
```

- [ ] **Step 4: Verify the build**

Run: `docker compose build`
Expected: build succeeds (better-sqlite3 compiles or uses prebuilt).
Run: `OPENAI_API_KEY=sk-REAL docker compose up -d && sleep 3 && curl -s localhost:3000/api/words`
Expected: `[]` (or existing words). Then `docker compose down`.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore
git commit -m "chore: Docker setup for Node backend"
```

---

### Task 8: One-shot migration script (`scripts/pull-from-supabase.js`)

**Files:**
- Create: `scripts/pull-from-supabase.js`

**Interfaces:**
- Consumes: `@supabase/supabase-js` (devDependency), `openDb` from `db.js`. Reads `SUPABASE_URL`, `SUPABASE_KEY` from env; prompts for email + password.
- Produces: populates `data/vocab.db` from the live Supabase project once.

This is developer tooling run once; no automated test. It ends with a documented manual run.

- [ ] **Step 1: Write `scripts/pull-from-supabase.js`**

```js
// ============================================================
//  Chạy MỘT LẦN để kéo dữ liệu từ Supabase cũ về SQLite cục bộ.
//  Cần: SUPABASE_URL + SUPABASE_KEY (env), email + mật khẩu tài khoản.
//  Dùng: SUPABASE_URL=... SUPABASE_KEY=... node scripts/pull-from-supabase.js
//  Thêm --force để nối vào DB đã có sẵn từ.
// ============================================================
import { createClient } from "@supabase/supabase-js";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { openDb } from "../db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) {
    console.error("Thiếu SUPABASE_URL hoặc SUPABASE_KEY (đặt qua biến môi trường).");
    process.exit(1);
  }
  const force = process.argv.includes("--force");

  const rl = readline.createInterface({ input: stdin, output: stdout });
  const email = process.env.SUPABASE_EMAIL || (await rl.question("Email đăng nhập Supabase: "));
  const password = process.env.SUPABASE_PASSWORD || (await rl.question("Mật khẩu: "));
  rl.close();

  const sb = createClient(url, key);
  const { error: authErr } = await sb.auth.signInWithPassword({ email, password });
  if (authErr) { console.error("Đăng nhập thất bại:", authErr.message); process.exit(1); }

  const { data: words, error: wErr } = await sb.from("words").select("*");
  if (wErr) { console.error("Không đọc được words:", wErr.message); process.exit(1); }
  const { data: metaRows } = await sb.from("meta").select("*").limit(1);
  const meta = metaRows && metaRows[0];

  const dataDir = path.join(__dirname, "..", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const db = openDb(path.join(dataDir, "vocab.db"));

  if (db.listWords().length > 0 && !force) {
    console.error(`vocab.db đã có ${db.listWords().length} từ. Dùng --force để nối thêm.`);
    process.exit(1);
  }

  const rows = (words || []).map((w) => {
    const { user_id, ...rest } = w; // bỏ user_id
    return rest;
  });
  const inserted = db.bulkAddWords(rows);
  if (meta) db.upsertMeta({ streak: meta.streak, last_review_day: meta.last_review_day });
  db.close();
  console.log(`Đã nhập ${inserted} từ${meta ? " + streak" : ""} vào data/vocab.db.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Verify it loads without crashing (no live pull)**

Run: `node scripts/pull-from-supabase.js`
Expected: exits with "Thiếu SUPABASE_URL hoặc SUPABASE_KEY" (proves the script parses and runs). The real run happens once with env vars set + credentials, per README.

- [ ] **Step 3: Commit**

```bash
git add scripts/pull-from-supabase.js
git commit -m "feat: one-shot Supabase-to-SQLite migration script"
```

---

### Task 9: Cleanup + README

**Files:**
- Delete: `config.js`, `supabase/` (whole dir), `supabase-schema.sql`, `supabase-ipa.sql`, `supabase-autofill.sql`, `supabase-podcast.sql`, `supabase-learned-on.sql`, `.vercel/`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a repo with no Supabase/Vercel artifacts and a README describing local setup.

- [ ] **Step 1: Delete the obsolete files**

```bash
git rm -r config.js supabase supabase-schema.sql supabase-ipa.sql supabase-autofill.sql supabase-podcast.sql supabase-learned-on.sql
rm -rf .vercel
```

- [ ] **Step 2: Rewrite `README.md`**

Replace the whole file with:

````markdown
# Sổ Từ Vựng — chạy cục bộ

Web app học từ vựng: nhập từ, lật flashcard, ôn tập theo cơ chế lặp ngắt quãng (Leitner),
nghe podcast (giọng trình duyệt miễn phí hoặc giọng AI của OpenAI). Chạy hoàn toàn trên
máy bạn: backend Node + SQLite, không cần Supabase hay Vercel. Dùng cho **một người**,
không có đăng nhập.

## Yêu cầu
- Node.js 24+ (hoặc Docker).
- (Tuỳ chọn) Khoá OpenAI cho tính năng tự điền nghĩa & podcast AI.

## Chạy bằng npm
```bash
npm install
cp .env.example .env      # rồi điền OPENAI_API_KEY nếu muốn dùng AI
npm start                 # mở http://localhost:3000
```
Dữ liệu lưu ở `data/vocab.db`, audio ở `data/audio/`. Sao lưu = copy thư mục `data/`.

## Chạy bằng Docker
```bash
export OPENAI_API_KEY=sk-...   # hoặc đặt trong .env
docker compose up -d --build   # http://localhost:3000
```
Thư mục `./data` được mount làm volume nên dữ liệu không mất khi build lại.

## Tính năng AI (tuỳ chọn)
Đặt `OPENAI_API_KEY` trong `.env` (hoặc biến môi trường). Khoá chỉ nằm ở server, không lộ
ra frontend. Model dùng: `gpt-5.4-nano` (viết nghĩa/kịch bản) và `gpt-4o-mini-tts` (đọc).
Đổi model trong `ai.js`. Không có khoá thì các nút AI báo lỗi nhẹ nhàng; phần còn lại vẫn chạy.

## Chuyển dữ liệu từ Supabase cũ (một lần)
Nếu bạn từng dùng bản Supabase và muốn mang dữ liệu về:
```bash
SUPABASE_URL="https://xxxx.supabase.co" SUPABASE_KEY="sb_publishable_..." \
  node scripts/pull-from-supabase.js
```
Script sẽ hỏi email + mật khẩu tài khoản Supabase, rồi nạp toàn bộ từ + streak vào
`data/vocab.db`. (Cần project Supabase cũ còn hoạt động.)

## Cách hoạt động
- **➕ Thêm từ** — nhập *từ · nghĩa · ví dụ*; nút "nhờ AI" tự điền nghĩa/ví dụ/IPA/từ loại.
- **📅 Ôn hôm nay** — chọn từ đến hạn + tối đa vài từ mới/ngày; chấm *Đã nhớ / Chưa nhớ*.
- **🎧 Podcast** — nghe nhanh bằng giọng trình duyệt, hoặc tạo 2 file MP3 bằng OpenAI
  (giải thích song ngữ + podcast tiếng Anh).
- **🃏 Flashcard**, **📚 Danh sách**, **⬇ Xuất / ⬆ Nhập** (JSON).

## Kiểm thử
```bash
npm test
```

## Cấu trúc
- `server.js` — Express: phục vụ frontend + REST API.
- `db.js` — SQLite (bảng `words`, `meta`, `podcast`).
- `ai.js`, `routes/ai.js` — gọi OpenAI (define-word, generate-podcast).
- `routes/words.js`, `routes/meta.js` — CRUD.
- `index.html`, `api.js` — frontend.
- `scripts/pull-from-supabase.js` — công cụ chuyển dữ liệu một lần.
````

- [ ] **Step 3: Verify nothing references the deleted files**

Run: `grep -rnE "supabase|config\.js|SUPABASE|vercel" index.html api.js server.js db.js ai.js routes/ README.md`
Expected: only benign mentions (README's migration section, `ai.js` model comments). No code depends on Supabase at runtime.
Run: `npm test`
Expected: PASS (all suites).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove Supabase/Vercel artifacts, rewrite README for local use"
```

---

## Self-Review Notes

- **Spec coverage:** users/no-auth → Task 6 Step 8; SQLite → Task 2; AI features → Tasks 4-5; Node backend → Task 3; npm + Docker → Tasks 3 & 7; clean API client → Task 6; migration script → Task 8; cleanup + README → Task 9. All spec sections mapped.
- **Podcast reuse** (`word_hash`) → Task 2 (`get/setPodcastHash`) + Task 5 route logic + test.
- **Type consistency:** `openDb` helper names, `createApp(db, opts)`, `aiRouter`/`wordsRouter`/`metaRouter`, `window.api.*` method names, and the `{explainUrl, podcastUrl, reused}` shape are consistent across Tasks 2-6.
- **Security note:** static serving is explicit (index.html + api.js only), so `.env`/source are never served.
- **Known caveat:** `better-sqlite3` is a native module; Task 1/7 account for build tooling. If a prebuilt binary is unavailable for the platform, `npm install` compiles it (needs python3/make/g++, added in the Dockerfile).
