# Design: Run eng-vocab fully locally (off Supabase & Vercel)

Date: 2026-07-21

## Goal

Convert the app from a Supabase-backed, Vercel/Netlify-hosted static site into a
self-contained app that runs on one machine via a small local Node backend. Single
user, no login. Keep both OpenAI-powered features (word auto-define and AI podcast).

## Decisions (locked)

- **Users/auth:** single user, no login. Remove auth, RLS, and per-user separation entirely.
- **Data store:** SQLite file (`data/vocab.db`).
- **AI features:** keep both (`define-word`, `generate-podcast`); OpenAI key held server-side.
- **Backend stack:** Node.js + Express + `better-sqlite3`.
- **Run methods:** both plain `npm start` and Docker (`docker-compose`).
- **Frontend wiring:** clean API client (`api.js`), rewrite call sites, delete dead auth code.
- **Data migration:** one-shot pull script reading current Supabase → local SQLite.

## The Supabase surface being replaced

| Today (Supabase/Vercel) | Local replacement |
|---|---|
| Postgres `words` + `meta` tables + RLS | SQLite `data/vocab.db` (no RLS, no `user_id`) |
| Email/password auth, login + setup screens | Removed; app opens straight to the vocab UI |
| Storage bucket for podcast MP3s | Local folder `data/audio/` served at `/audio/*` |
| Edge Functions `define-word`, `generate-podcast` | Node routes `POST /api/define-word`, `POST /api/generate-podcast` |
| `supabase-js` CDN + `config.js` keys | Removed; frontend calls same-origin `/api/*` |
| OpenAI key as Supabase secret | `OPENAI_API_KEY` in local `.env` (server-side only) |

## Architecture

```
Browser (index.html + api.js)
        │  fetch  /api/*   and   /audio/*
        ▼
server.js  (Node + Express)
   ├── static files (project root: index.html, api.js)
   ├── /api/words, /api/meta        → better-sqlite3 → data/vocab.db
   ├── /api/reset-progress          → better-sqlite3
   ├── /api/define-word             → OpenAI chat  (key from .env)
   ├── /api/generate-podcast        → OpenAI chat+TTS → data/audio/*.mp3
   └── /audio/*                     → static from data/audio/
```

### Units and responsibilities

- **`server.js`** — process entry: config/env load, static serving (project root), route wiring, `listen`.
- **`db.js`** — opens SQLite, creates schema on startup, exposes typed query helpers
  (`listWords`, `addWord`, `updateWord`, `deleteWord`, `bulkAddWords`, `resetProgress`,
  `getMeta`, `upsertMeta`, `getPodcastHash`, `setPodcastHash`). No HTTP concerns.
- **`routes/words.js`** — CRUD + bulk + reset endpoints; thin, delegates to `db.js`.
- **`routes/meta.js`** — GET/PUT streak.
- **`ai.js`** — OpenAI helpers ported from the Edge Functions: `defineWord(term)`,
  `writeScript()`, `buildScript()` (fallback), `synthTTS()`. No HTTP/DB concerns.
- **`routes/ai.js`** — `/api/define-word` and `/api/generate-podcast`; delegates to `ai.js` + `db.js`.
- **`api.js`** (project root, served statically) — frontend client: named functions wrapping `fetch('/api/...')`.
- **`scripts/pull-from-supabase.js`** — one-shot migration.

## API contract

All JSON. Errors return `{ error: string }` with a non-2xx status.

- `GET  /api/words` → `Word[]` (ordered by `created` desc, matching current UI).
- `POST /api/words` body = word fields → returns created `Word` (server sets `id`,
  `created`, `due` defaults).
- `PATCH /api/words/:id` body = partial fields → returns updated `Word`.
- `DELETE /api/words/:id` → `{ ok: true }`.
- `POST /api/words/bulk` body = `Word[]` → `{ inserted: n }` (used by Import).
- `POST /api/reset-progress` → resets `box=0, due=today, reviews=0, correct=0,
  last_review=null, learned_on=null` for all rows (the "reset all" button).
- `GET  /api/meta` → `{ streak, last_review_day }` (or defaults if none).
- `PUT  /api/meta` body = `{ streak, last_review_day }` → upserts.
- `POST /api/define-word` body = `{ term }` → `{ meaning, example, pos, ipa }`.
- `POST /api/generate-podcast` body = `{ words, hash, voice, style, force }` →
  `{ explainUrl, podcastUrl, reused }` where URLs are `/audio/explain.mp3` and
  `/audio/podcast.mp3`.

### Word shape (SQLite columns)

Same as `supabase-schema.sql` minus `user_id`:
`id TEXT PK, term, meaning, example, ipa, audio, pos, note, box INT, due, created,
reviews INT, correct INT, last_review, learned_on`. Dates stored as `YYYY-MM-DD`
text (SQLite has no date type; matches what the JS frontend already sends/reads).

### `meta` and `podcast` tables

- `meta`: single row — `streak INT, last_review_day TEXT`.
- `podcast`: single row — `word_hash TEXT, updated_at TEXT`. Drives podcast reuse.

## AI routes — port details

Ported ~verbatim from `supabase/functions/*/index.ts`, with these changes only:

- Remove the Supabase JWT/`getUser` auth block (single user).
- Remove Supabase Storage upload; write MP3 bytes to `data/audio/explain.mp3` and
  `data/audio/podcast.mp3` on disk instead. No `user.id` path prefix.
- Reuse check reads/writes `podcast.word_hash` in SQLite instead of the `podcasts` table.
- Model constants preserved verbatim: `TEXT_MODEL = "gpt-5.4-nano"`,
  `TTS_MODEL = "gpt-4o-mini-tts"`. Prompts, styles, voices, MAX_CHARS unchanged.
- Read `OPENAI_API_KEY` from `process.env`; if missing, return a clear 500 so the
  frontend shows its existing "set OPENAI_API_KEY" hint.

## Frontend changes (`index.html` + new `api.js`)

`index.html` and `api.js` stay at the project root, served as static files by `server.js`.

- Remove `<script src="supabase-js@2">` and `<script src="config.js">`.
- Add `<script src="api.js">`.
- Replace each `sb.from("words")…` / `sb.from("meta")…` call (~8 sites) with the
  matching `api.*` function.
- Replace `sb.functions.invoke("define-word"/"generate-podcast", {body})` (2 sites)
  with `api.defineWord()` / `api.generatePodcast()`. Preserve existing error-message
  extraction so the UI still shows server error text.
- Delete auth code: `screenSetup`/`screenLogin` handling, `doAuth`, `signInWithPassword`,
  `signOut`, `onAuthStateChange`, `getSession`, the `onSession` gate. `init()` becomes:
  load words + meta, render, show app directly.
- The review/flashcard/spaced-repetition logic is untouched — it operates on the same
  in-memory word objects.

## Run methods

- **npm:** `npm install && npm start` → `http://localhost:3000`. Reads `.env`
  (`OPENAI_API_KEY`, optional `PORT`).
- **Docker:** `Dockerfile` switches to a Node base and runs `server.js`;
  `docker-compose.yml` mounts `./data` as a volume (DB + MP3s persist across rebuilds)
  and passes `OPENAI_API_KEY` through from the host env / `.env`.

## Data migration — `scripts/pull-from-supabase.js`

One-shot Node script:

1. Reads current Supabase URL + publishable key (from the existing `config.js` or CLI args)
   and prompts for the account email + password (or reads from env).
2. Uses `supabase-js` to sign in, fetch all `words` and the `meta` row for that user.
3. Inserts them into local `data/vocab.db` (drops `user_id`), preserving `box`, `due`,
   `reviews`, etc. so spaced-repetition state carries over.
4. Idempotent-ish: warns if `vocab.db` already has words; requires `--force` to append.

Run once: `node scripts/pull-from-supabase.js`. Depends on the old Supabase project still
being reachable. This is developer tooling, not part of the running app.

## Cleanup

- Delete: `config.js`, `supabase/` directory, `supabase-*.sql` files, `.vercel/`.
- Update `README.md` for local setup (install Node, `.env`, `npm start` / Docker,
  migration script). Rewrite the Supabase/OpenAI-secret sections.
- `.gitignore` adds: `.env`, `/data/`, `node_modules/`.
- Keep the migration script's `supabase-js` dependency out of runtime deps (dev/optional),
  or document installing it ad hoc for the one-time pull.

## Project layout (after)

```
eng-vocab/
├── server.js
├── db.js
├── ai.js
├── routes/{words,meta,ai}.js
├── index.html       (static, served from root)
├── api.js           (static, served from root)
├── scripts/pull-from-supabase.js
├── data/            (gitignored: vocab.db, audio/*.mp3)
├── .env             (gitignored)
├── package.json
├── Dockerfile
├── docker-compose.yml
└── README.md
```

## Testing

Light integration tests with `node:test` against a temp SQLite DB, OpenAI mocked:

- words: add → list → update → delete round-trip; bulk insert; reset-progress clears state.
- meta: GET default, PUT upsert, GET reflects it.
- define-word: happy path returns parsed fields; OpenAI error → 502 with message;
  missing key → 500.
- generate-podcast: happy path writes both MP3s and returns URLs + `reused:false`;
  same hash + no force → `reused:true` without re-calling OpenAI; missing key → 500.

Plus a manual smoke run of the full UI (add word, auto-define, review, podcast).

## Out of scope (YAGNI)

- Multi-user, auth, RLS.
- Cloud hosting / HTTPS / domains.
- Real-time cross-device sync.
- Postgres.
