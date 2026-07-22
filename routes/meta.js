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
