# Tự điền nghĩa/ví dụ/từ loại bằng AI + tách ô Ghi chú — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm nút "✨ Tự điền" gọi OpenAI điền nghĩa (VN) + ví dụ (EN) + từ loại khi thêm từ; tách ô "Ví dụ / ghi chú" thành hai ô Ví dụ (AI điền) và Ghi chú (người dùng nhập).

**Architecture:** App một file `index.html` (vanilla JS trong IIFE), backend Supabase. Thêm cột `pos`/`note` vào bảng `words`; thêm Edge Function `define-word` (khuôn giống `generate-podcast`) gọi OpenAI trả `{ meaning, example, pos }`; frontend thêm nút gọi function, tách form, hiển thị huy hiệu từ loại + ghi chú.

**Tech Stack:** HTML/CSS/vanilla JS, Supabase JS v2 + Edge Functions (Deno), OpenAI Chat Completions (`gpt-4o-mini`, JSON mode).

## Global Constraints

- UI và mọi chuỗi hiển thị bằng **tiếng Việt**, giữ giọng văn hiện có.
- Không thêm build step, không `package.json`, không thư viện mới ở frontend — giữ mô hình một file tĩnh.
- Mọi giá trị người dùng/AI render vào HTML phải đi qua `esc()`.
- Edge Function dùng lại secret **`OPENAI_API_KEY`** đã đặt sẵn cho `generate-podcast`; KHÔNG hardcode key.
- OpenAI model: `gpt-4o-mini`, `response_format: { type: "json_object" }`, `temperature` ~0.5.
- Lỗi gọi AI: hiện thông báo gọn trên `#addMsg`, KHÔNG chặn nhập tay.
- Kiểm thử: không có test framework. Frontend verify bằng `node --check` trên script IIFE trích ra + grep; Edge Function verify bằng `deno check`. Kiểm thử end-to-end (deploy + đăng nhập + gọi thật) là việc của người dùng.
- Cột `example` cũ giữ nguyên ngữ nghĩa (dùng cho "Ví dụ"); cột mới `note` cho ghi chú người dùng, `pos` cho từ loại. Từ cũ để `''`, không backfill.

---

### Task 1: Migration `supabase-autofill.sql` + schema + README (cột pos/note)

**Files:**
- Create: `supabase-autofill.sql`
- Modify: `supabase-schema.sql` (thêm 2 cột vào `create table words`)
- Modify: `README.md` (mục chạy migration)

**Interfaces:**
- Produces: bảng `public.words` có thêm `pos text default ''` và `note text default ''`.

- [ ] **Step 1: Tạo `supabase-autofill.sql`**

```sql
-- ============================================================
--  Tự điền AI — thêm cột từ loại (pos) và ghi chú (note)
--  Chạy trong: Supabase Dashboard > SQL Editor
--  (Chạy sau khi đã chạy supabase-schema.sql)
-- ============================================================

alter table public.words add column if not exists pos  text default '';
alter table public.words add column if not exists note text default '';
```

- [ ] **Step 2: Thêm 2 cột vào `supabase-schema.sql`**

Trong khối `create table if not exists public.words (...)`, ngay sau dòng `audio       text default '',` thêm:

```sql
  pos         text default '',
  note        text default '',
```

- [ ] **Step 3: Thêm mục README**

Sau mục hướng dẫn `supabase-ipa.sql` (mục "2b"), thêm:

```markdown
### 2c. (Nếu nâng cấp) Thêm cột từ loại & ghi chú
Mở **SQL Editor**, dán nội dung [`supabase-autofill.sql`](supabase-autofill.sql) và bấm **Run** để thêm cột `pos` (từ loại) và `note` (ghi chú). Người cài mới đã chạy `supabase-schema.sql` bản mới nhất thì bỏ qua.
```

- [ ] **Step 4: Chạy migration trên Supabase (việc của người dùng — bỏ qua khi code)**

(Người dùng tự chạy SQL trong Dashboard.)

- [ ] **Step 5: Commit**

```bash
git add supabase-autofill.sql supabase-schema.sql README.md
git commit -m "Add pos/note columns migration for AI auto-fill"
```

---

### Task 2: Edge Function `define-word` + README (deploy)

**Files:**
- Create: `supabase/functions/define-word/index.ts`
- Modify: `README.md` (mục deploy function)

**Interfaces:**
- Produces: endpoint `define-word` nhận POST `{ term }`, trả `{ meaning, example, pos }` (200) hoặc `{ error }` (4xx/5xx).

- [ ] **Step 1: Tạo `supabase/functions/define-word/index.ts`**

```typescript
// ============================================================
//  Edge Function: define-word
//  Nhận một từ tiếng Anh, dùng OpenAI trả về nghĩa tiếng Việt,
//  một câu ví dụ tiếng Anh, và từ loại (tiếng Việt).
//
//  Deploy:
//    supabase functions deploy define-word
//  Dùng lại secret đã đặt cho generate-podcast:
//    supabase secrets set OPENAI_API_KEY=sk-...
// ============================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TEXT_MODEL = "gpt-4o-mini";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY");

    // Xác thực người dùng từ JWT gửi kèm
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return json({ error: "Chưa đăng nhập" }, 401);

    if (!openaiKey) return json({ error: "Server chưa đặt OPENAI_API_KEY" }, 500);

    const { term } = await req.json().catch(() => ({}));
    if (!term || typeof term !== "string" || !term.trim()) {
      return json({ error: "Chưa có từ" }, 400);
    }
    const word = term.trim();

    const system =
      "Bạn là trợ lý học từ vựng tiếng Anh cho người Việt. " +
      "Với một từ hoặc cụm từ tiếng Anh, hãy trả về DUY NHẤT một JSON đúng các khoá " +
      '{"meaning":"","example":"","pos":""}. ' +
      "meaning = nghĩa tiếng Việt ngắn gọn, tự nhiên của từ đó. " +
      "example = MỘT câu ví dụ tiếng Anh tự nhiên có dùng từ đó. " +
      "pos = từ loại bằng tiếng Việt (danh từ, động từ, tính từ, trạng từ, giới từ, liên từ, đại từ, thán từ); " +
      "nếu từ có nhiều từ loại thì chọn loại phổ biến nhất; nếu không xác định được thì để chuỗi rỗng. " +
      "Không thêm bất kỳ chữ nào ngoài JSON.";

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: TEXT_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: "Từ: " + word },
        ],
        temperature: 0.5,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      return json({ error: `OpenAI lỗi (${res.status}): ${detail.slice(0, 300)}` }, 502);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(content); } catch (_e) { parsed = {}; }
    const meaning = String(parsed.meaning ?? "").trim();
    const example = String(parsed.example ?? "").trim();
    const pos = String(parsed.pos ?? "").trim();
    if (!meaning && !example) return json({ error: "AI không trả về nội dung hợp lệ" }, 502);

    return json({ meaning, example, pos });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
```

- [ ] **Step 2: Thêm mục README deploy**

Trong README, gần chỗ nói về Edge Function podcast (hoặc mục Podcast AI), thêm:

```markdown
### Tự điền bằng AI (Edge Function `define-word`)
Deploy function tra nghĩa/ví dụ/từ loại:
```bash
supabase functions deploy define-word
```
Function này **dùng lại** secret `OPENAI_API_KEY` bạn đã đặt cho podcast — không cần đặt lại. Sau khi deploy, nút **✨ Tự điền** ở tab "Thêm từ" sẽ hoạt động.
```

- [ ] **Step 3: Verify cú pháp/typecheck**

Run: `deno check supabase/functions/define-word/index.ts`
Expected: không lỗi. (Nếu môi trường không có `deno`, bỏ qua và ghi rõ trong report rằng chưa chạy được — cấu trúc bám sát `generate-podcast/index.ts` đã hoạt động.)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/define-word/index.ts README.md
git commit -m "Add define-word Edge Function (OpenAI meaning/example/pos)"
```

---

### Task 3: Tách ô Ví dụ/Ghi chú + plumbing lưu pos/note

**Files:**
- Modify: `index.html` — HTML tab-add (~dòng 207-214), `addWord` (~dòng 277-282), khai báo `pendingLookup` (~dòng 347), `doAdd` (~dòng 377-402), import handler (~dòng 770-775).

**Interfaces:**
- Consumes: `esc`, `$`, `sb`, `db`, `todayStr`, `lookupWord`, `pendingLookup`.
- Produces:
  - `addWord(term, mean, ex, ipa, audio, pos, note)` — chữ ký mở rộng.
  - `pendingPos = { term: string, pos: string }` — biến module cache từ loại do AI trả (Task 4 sẽ set).
  - `renderPosBadge()` — render huy hiệu từ loại vào `#posBadge` (guard `if (!box) return`).
  - phần tử HTML `#fNote` (textarea ghi chú) và `#posBadge` (span huy hiệu).

- [ ] **Step 1: Tách ô Ví dụ/Ghi chú + thêm `#posBadge` trong HTML**

Thay khối (dòng ~207-214):

```html
        <div class="row">
          <label for="fEx">Ví dụ / ghi chú (không bắt buộc)</label>
          <textarea id="fEx" rows="2" placeholder="ví dụ: Smartphones are now ubiquitous."></textarea>
        </div>
        <div class="btnbar">
          <button class="btn" id="btnAdd">Lưu từ</button>
          <span id="addMsg" style="align-self:center;color:var(--green);font-size:13px;font-weight:600"></span>
        </div>
```

bằng:

```html
        <div class="row">
          <label for="fEx">Ví dụ (AI tự điền)</label>
          <textarea id="fEx" rows="2" placeholder="ví dụ: Smartphones are now ubiquitous."></textarea>
        </div>
        <div class="row">
          <label for="fNote">Ghi chú (không bắt buộc)</label>
          <textarea id="fNote" rows="2" placeholder="ghi chú của riêng bạn…"></textarea>
        </div>
        <div class="btnbar">
          <button class="btn" id="btnAdd">Lưu từ</button>
          <span id="posBadge" style="align-self:center"></span>
          <span id="addMsg" style="align-self:center;color:var(--green);font-size:13px;font-weight:600"></span>
        </div>
```

- [ ] **Step 2: Mở rộng `addWord`**

Thay hàm `addWord` (dòng ~277):

```javascript
    async function addWord(term, mean, ex, ipa, audio, pos, note) {
      const row = { term: term.trim(), meaning: mean.trim(), example: (ex || "").trim(), ipa: (ipa || "").trim(), audio: (audio || "").trim(), pos: (pos || "").trim(), note: (note || "").trim(), box: 0, due: todayStr(), created: todayStr(), reviews: 0, correct: 0 };
      const { data, error } = await sb.from("words").insert(row).select().single();
      if (error) throw error;
      db.words.unshift(data);
    }
```

- [ ] **Step 3: Khai báo `pendingPos` + `renderPosBadge`**

Ngay sau dòng `let lookupTimer = null;` (dòng ~348), thêm:

```javascript
    // Cache từ loại do AI trả về cho ô Thêm từ (Task tự điền set)
    let pendingPos = { term: "", pos: "" };
    function renderPosBadge() {
      const box = $("#posBadge");
      if (!box) return;
      box.innerHTML = pendingPos.pos ? '<span class="pos">' + esc(pendingPos.pos) + '</span>' : "";
    }
```

- [ ] **Step 4: Cập nhật `doAdd` để đọc/lưu note + pos**

Thay dòng đọc input (dòng ~378):

```javascript
      const term = $("#fTerm").value, mean = $("#fMean").value, ex = $("#fEx").value;
```

thành:

```javascript
      const term = $("#fTerm").value, mean = $("#fMean").value, ex = $("#fEx").value, note = $("#fNote").value;
```

Thay khối trong `try` từ `let ipa = ""` tới `renderIpaPreview("empty");` (dòng ~386-393):

```javascript
        let ipa = "", audio = "";
        if (pendingLookup.term === term.trim().toLowerCase()) { ipa = pendingLookup.ipa; audio = pendingLookup.audio; }
        else { const r = await lookupWord(term); ipa = r.ipa; audio = r.audio; }
        await addWord(term, mean, ex, ipa, audio);
        $("#fTerm").value = ""; $("#fMean").value = ""; $("#fEx").value = "";
        $("#fTerm").focus();
        pendingLookup = { term: "", ipa: "", audio: "" };
        renderIpaPreview("empty");
```

thành:

```javascript
        let ipa = "", audio = "";
        if (pendingLookup.term === term.trim().toLowerCase()) { ipa = pendingLookup.ipa; audio = pendingLookup.audio; }
        else { const r = await lookupWord(term); ipa = r.ipa; audio = r.audio; }
        let pos = "";
        if (pendingPos.term === term.trim().toLowerCase()) pos = pendingPos.pos;
        await addWord(term, mean, ex, ipa, audio, pos, note);
        $("#fTerm").value = ""; $("#fMean").value = ""; $("#fEx").value = ""; $("#fNote").value = "";
        $("#fTerm").focus();
        pendingLookup = { term: "", ipa: "", audio: "" };
        pendingPos = { term: "", pos: "" };
        renderIpaPreview("empty");
        renderPosBadge();
```

- [ ] **Step 5: Import mang theo pos + note**

Thay object trong `.map` của `#fileImport` (dòng ~770):

```javascript
        const rows = data.words.map((w) => ({
          term: w.term, meaning: w.meaning, example: w.example || "",
          ipa: w.ipa || "", audio: w.audio || "",
          box: w.box || 0, due: w.due || todayStr(), created: w.created || todayStr(),
          reviews: w.reviews || 0, correct: w.correct || 0, last_review: w.last_review || w.lastReview || null
        }));
```

thành:

```javascript
        const rows = data.words.map((w) => ({
          term: w.term, meaning: w.meaning, example: w.example || "",
          ipa: w.ipa || "", audio: w.audio || "", pos: w.pos || "", note: w.note || "",
          box: w.box || 0, due: w.due || todayStr(), created: w.created || todayStr(),
          reviews: w.reviews || 0, correct: w.correct || 0, last_review: w.last_review || w.lastReview || null
        }));
```

(Export tự động mang theo pos/note vì dùng nguyên `db.words` — không cần sửa.)

- [ ] **Step 6: Verify**

Extract script IIFE → `node --check` (phải sạch). Grep xác nhận: `id="fNote"`, `id="posBadge"` trong HTML; `addWord(term, mean, ex, ipa, audio, pos, note)` định nghĩa; `addWord(term, mean, ex, ipa, audio, pos, note)` gọi trong doAdd (7 tham số); `pendingPos` và `renderPosBadge` định nghĩa; `pos: w.pos || ""` và `note: w.note || ""` trong import.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "Split example/note fields, plumb pos+note through add/import"
```

---

### Task 4: Nút "✨ Tự điền" + gọi Edge Function

**Files:**
- Modify: `index.html` — thêm nút vào `.btnbar` của tab-add; thêm hàm `doDefine` + listener gần `$("#btnAdd").addEventListener` (dòng ~344).

**Interfaces:**
- Consumes: `sb`, `$`, `esc`, `pendingPos`, `renderPosBadge` (Task 3).
- Produces: nút `#btnDefine` và hàm `doDefine()`.

- [ ] **Step 1: Thêm nút vào btnbar**

Trong `.btnbar` của tab-add, thay:

```html
        <div class="btnbar">
          <button class="btn" id="btnAdd">Lưu từ</button>
          <span id="posBadge" style="align-self:center"></span>
```

thành:

```html
        <div class="btnbar">
          <button class="btn ghost" id="btnDefine">✨ Tự điền</button>
          <button class="btn" id="btnAdd">Lưu từ</button>
          <span id="posBadge" style="align-self:center"></span>
```

- [ ] **Step 2: Thêm listener + hàm `doDefine`**

Sau dòng `$("#btnAdd").addEventListener("click", doAdd);` (dòng ~344), thêm:

```javascript
    $("#btnDefine").addEventListener("click", doDefine);
    async function doDefine() {
      const term = $("#fTerm").value.trim();
      if (!term) {
        $("#addMsg").style.color = "var(--red)";
        $("#addMsg").textContent = "Nhập từ trước đã.";
        return;
      }
      const btn = $("#btnDefine"), label = btn.textContent;
      btn.disabled = true; btn.textContent = "⏳ Đang nhờ AI…";
      try {
        const { data, error } = await sb.functions.invoke("define-word", { body: { term } });
        if (error) {
          let detail = "";
          try { const body = await error.context.json(); detail = body.error || ""; } catch (_) {}
          throw new Error(detail || error.message || "Không gọi được AI");
        }
        if (!data || data.error) throw new Error((data && data.error) || "Không có dữ liệu trả về");
        $("#fMean").value = data.meaning || "";
        $("#fEx").value = data.example || "";
        pendingPos = { term: term.toLowerCase(), pos: data.pos || "" };
        renderPosBadge();
        $("#addMsg").style.color = "var(--green)";
        $("#addMsg").textContent = "✓ AI đã điền — xem lại rồi bấm Lưu nhé.";
        setTimeout(() => ($("#addMsg").textContent = ""), 2500);
      } catch (e) {
        $("#addMsg").style.color = "var(--red)";
        $("#addMsg").textContent = "Lỗi: " + e.message;
      } finally { btn.disabled = false; btn.textContent = label; }
    }
```

- [ ] **Step 3: Verify**

Extract script IIFE → `node --check` (sạch). Grep: `id="btnDefine"` trong HTML; `doDefine` định nghĩa; `sb.functions.invoke("define-word"` có mặt; `pendingPos = { term: term.toLowerCase(), pos: data.pos` được gán.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Add AI auto-fill button calling define-word"
```

---

### Task 5: Hiển thị huy hiệu từ loại + ghi chú ở Danh sách

**Files:**
- Modify: `index.html` — CSS gần `.vitem .mean`/`.vitem .ex` (~dòng 85-86); `renderList` (~dòng 416-426).

**Interfaces:**
- Consumes: `esc`, `db.words`.

- [ ] **Step 1: Thêm CSS**

Sau dòng `.vitem .ex { ... }` (~dòng 86), thêm:

```css
    .pos { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: var(--surface); border: 1px solid var(--border); color: var(--primary); margin-left: 6px; vertical-align: middle; white-space: nowrap; }
    .vitem .note { color: var(--muted); font-size: 13px; margin-top: 4px; }
```

- [ ] **Step 2: Render pos pill + note trong `renderList`**

Trong `.map` của `renderList`, thay khối (dòng ~418-425):

```javascript
        const ex = w.example ? '<div class="ex">“' + esc(w.example) + '”</div>' : "";
        const ipaLine = '<div class="ipa"><button class="pron" data-act="play" title="Nghe phát âm">🔊</button>' + (w.ipa ? '<span>' + esc(w.ipa) + '</span>' : '') + '</div>';
        return '<div class="vitem" data-id="' + w.id + '">' +
          '<div><div class="term">' + esc(w.term) + '</div><div class="mean">' + esc(w.meaning) + '</div>' + ipaLine + ex + '</div>' +
          '<div class="meta">' +
            '<span class="pill' + (isDue ? ' due' : '') + '">' + (isDue ? 'Đến hạn' : 'Cấp ' + w.box) + '</span>' +
            '<button class="iconbtn" data-act="del" title="Xoá">🗑</button>' +
          '</div></div>';
```

thành:

```javascript
        const ex = w.example ? '<div class="ex">“' + esc(w.example) + '”</div>' : "";
        const noteLine = w.note ? '<div class="note">📝 ' + esc(w.note) + '</div>' : "";
        const posPill = w.pos ? ' <span class="pos">' + esc(w.pos) + '</span>' : "";
        const ipaLine = '<div class="ipa"><button class="pron" data-act="play" title="Nghe phát âm">🔊</button>' + (w.ipa ? '<span>' + esc(w.ipa) + '</span>' : '') + '</div>';
        return '<div class="vitem" data-id="' + w.id + '">' +
          '<div><div class="term">' + esc(w.term) + posPill + '</div><div class="mean">' + esc(w.meaning) + '</div>' + ipaLine + ex + noteLine + '</div>' +
          '<div class="meta">' +
            '<span class="pill' + (isDue ? ' due' : '') + '">' + (isDue ? 'Đến hạn' : 'Cấp ' + w.box) + '</span>' +
            '<button class="iconbtn" data-act="del" title="Xoá">🗑</button>' +
          '</div></div>';
```

- [ ] **Step 3: Verify**

Extract script → `node --check` (sạch). Grep: `class="pos"` và `class="note"` trong CSS; `posPill` và `noteLine` dùng trong renderList markup.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Show part-of-speech badge + note in word list"
```

---

### Task 6: Hiển thị từ loại (mặt trước) + ghi chú (mặt sau) ở Flashcard & Ôn tập

**Files:**
- Modify: `index.html` — CSS gần `.flash-face .ipa` (~dòng 100-102); `renderFlash` (~dòng 449-455); `drawReviewCard` (~dòng 490-498).

**Interfaces:**
- Consumes: `esc`.

- [ ] **Step 1: Thêm CSS**

Sau khối `.flash-face .ipa .pron:hover { ... }` (~dòng 102), thêm:

```css
    .flash-face .pos-badge { display: inline-block; margin-top: 8px; font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--border); color: var(--primary); }
    .flash-face .note { color: var(--muted); font-size: 14px; margin-top: 10px; }
```

- [ ] **Step 2: Flashcard — pos badge (mặt trước) + note (mặt sau)**

Trong `renderFlash`, thay dòng dựng `ex` (dòng ~449):

```javascript
      const ex = w.example ? '<div class="ex">“' + esc(w.example) + '”</div>' : "";
```

thành:

```javascript
      const ex = w.example ? '<div class="ex">“' + esc(w.example) + '”</div>' : "";
      const note = w.note ? '<div class="note">📝 ' + esc(w.note) + '</div>' : "";
      const posBadge = w.pos ? '<div class="pos-badge">' + esc(w.pos) + '</div>' : "";
```

Thay hai dòng markup mặt trước + mặt sau (dòng ~452-455):

```javascript
          '<div class="flash-face"><span class="hint">Từ</span><div class="big">' + esc(w.term) + '</div>' +
            '<div class="ipa"><button class="pron" id="fcPron" title="Nghe phát âm">🔊</button>' + (w.ipa ? '<span>' + esc(w.ipa) + '</span>' : '') + '</div>' +
            '<div class="sub" style="margin-top:12px">Bấm để lật</div></div>' +
          '<div class="flash-face flash-back"><span class="hint">Nghĩa</span><div class="big">' + esc(w.meaning) + '</div>' + ex + '</div>' +
```

thành:

```javascript
          '<div class="flash-face"><span class="hint">Từ</span><div class="big">' + esc(w.term) + '</div>' + posBadge +
            '<div class="ipa"><button class="pron" id="fcPron" title="Nghe phát âm">🔊</button>' + (w.ipa ? '<span>' + esc(w.ipa) + '</span>' : '') + '</div>' +
            '<div class="sub" style="margin-top:12px">Bấm để lật</div></div>' +
          '<div class="flash-face flash-back"><span class="hint">Nghĩa</span><div class="big">' + esc(w.meaning) + '</div>' + ex + note + '</div>' +
```

- [ ] **Step 3: Ôn tập — pos badge (mặt trước) + note (mặt sau)**

Trong `drawReviewCard`, thay dòng dựng `ex` (dòng ~490):

```javascript
      const ex = w.example ? '<div class="ex">“' + esc(w.example) + '”</div>' : "";
```

thành:

```javascript
      const ex = w.example ? '<div class="ex">“' + esc(w.example) + '”</div>' : "";
      const note = w.note ? '<div class="note">📝 ' + esc(w.note) + '</div>' : "";
      const posBadge = w.pos ? '<div class="pos-badge">' + esc(w.pos) + '</div>' : "";
```

Thay hai dòng markup mặt trước + mặt sau (dòng ~495-498):

```javascript
            '<div class="flash-face"><span class="hint">Từ</span><div class="big">' + esc(w.term) + '</div>' +
              '<div class="ipa"><button class="pron" id="rcPron" title="Nghe phát âm">🔊</button>' + (w.ipa ? '<span>' + esc(w.ipa) + '</span>' : '') + '</div>' +
              '<div class="sub" style="margin-top:12px">Bấm để xem nghĩa</div></div>' +
            '<div class="flash-face flash-back"><span class="hint">Nghĩa</span><div class="big">' + esc(w.meaning) + '</div>' + ex + '</div>' +
```

thành:

```javascript
            '<div class="flash-face"><span class="hint">Từ</span><div class="big">' + esc(w.term) + '</div>' + posBadge +
              '<div class="ipa"><button class="pron" id="rcPron" title="Nghe phát âm">🔊</button>' + (w.ipa ? '<span>' + esc(w.ipa) + '</span>' : '') + '</div>' +
              '<div class="sub" style="margin-top:12px">Bấm để xem nghĩa</div></div>' +
            '<div class="flash-face flash-back"><span class="hint">Nghĩa</span><div class="big">' + esc(w.meaning) + '</div>' + ex + note + '</div>' +
```

- [ ] **Step 4: Verify**

Extract script → `node --check` (sạch). Grep: `pos-badge` trong CSS; `posBadge` xuất hiện ở CẢ `renderFlash` và `drawReviewCard`; `+ ex + note +` xuất hiện 2 lần (hai mặt sau).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Show part-of-speech badge + note on flashcard and review cards"
```

---

## Self-Review

**Spec coverage:**
- Edge Function `define-word` trả `{ meaning, example, pos }` → Task 2. ✓
- Cột DB `pos`, `note` → Task 1. ✓
- Nút ✨ Tự điền + gọi function + ghi đè fMean/fEx + cache pos → Task 4 (dùng `pendingPos`/`renderPosBadge` từ Task 3). ✓
- Tách ô Ví dụ/Ghi chú + lưu note → Task 3. ✓
- addWord signature (pos, note) + doAdd + import → Task 3. ✓
- Hiển thị huy hiệu từ loại + ghi chú: Danh sách → Task 5; Flashcard & Ôn tập → Task 6. ✓
- Export/Import mang theo pos+note → Task 3 (export tự động). ✓
- README deploy function + migration → Task 1 & Task 2. ✓
- Lỗi AI không chặn nhập tay → Task 4 (`#addMsg`, không disable form khác). ✓

**Placeholder scan:** Không có TBD/TODO; mọi bước có code hoặc lệnh cụ thể. ✓

**Type consistency:**
- `addWord(term, mean, ex, ipa, audio, pos, note)` định nghĩa (Task 3 Step 2) khớp lời gọi (Task 3 Step 4, 7 tham số). ✓
- `pendingPos = { term, pos }` khai báo Task 3 Step 3; set ở Task 4 Step 2; đọc ở Task 3 Step 4 (`pendingPos.term`/`.pos`). ✓
- `renderPosBadge()` định nghĩa Task 3 Step 3; gọi ở Task 3 Step 4 (reset) và Task 4 Step 2 (sau khi điền). ✓
- `#posBadge` thêm ở Task 3 Step 1; `#btnDefine` thêm ở Task 4 Step 1 (cùng btnbar, bổ sung, không xung đột). ✓
- Function trả khoá `meaning`/`example`/`pos`; frontend đọc `data.meaning`/`data.example`/`data.pos` (Task 4). ✓
- CSS `.pos`/`.note` (Task 5) và `.pos-badge`/`.flash-face .note` (Task 6) khớp class dùng trong markup. ✓
