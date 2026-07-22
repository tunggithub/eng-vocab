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
