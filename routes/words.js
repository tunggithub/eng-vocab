import express from "express";

function isValidWord(w) {
  return w && w.term && w.meaning;
}

export function wordsRouter(db) {
  const r = express.Router();

  r.get("/words", (_req, res) => res.json(db.listWords()));

  r.post("/words", (req, res) => {
    if (!isValidWord(req.body)) return res.status(400).json({ error: "Thiếu term hoặc meaning" });
    res.status(201).json(db.addWord(req.body));
  });

  r.post("/words/bulk", (req, res) => {
    if (!Array.isArray(req.body)) return res.status(400).json({ error: "Body phải là mảng" });
    if (!req.body.every(isValidWord)) return res.status(400).json({ error: "Mỗi item phải có term và meaning" });
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
