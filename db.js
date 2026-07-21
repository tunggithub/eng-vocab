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
