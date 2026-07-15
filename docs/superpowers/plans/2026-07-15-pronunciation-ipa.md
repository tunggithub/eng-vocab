# Phát âm + IPA cho từ vựng — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho mỗi từ vựng một nút 🔊 để nghe phát âm và hiển thị IPA (tự lấy từ Free Dictionary API khi thêm từ mới).

**Architecture:** App là một file `index.html` duy nhất (vanilla JS trong một IIFE), backend Supabase. Thêm cột `ipa`/`audio` vào bảng `words`; khi thêm từ mới gọi Free Dictionary API lấy IPA + URL audio, lưu vào DB; hiển thị IPA + nút 🔊 ở Danh sách, Flashcard, Ôn tập, và màn Thêm từ. Nút 🔊 phát MP3 nếu có, nếu không thì fallback `speechSynthesis` (đã có sẵn trong app).

**Tech Stack:** HTML/CSS/vanilla JS, Supabase JS v2, Free Dictionary API (`api.dictionaryapi.dev`), Web Speech API (`speechSynthesis`).

## Global Constraints

- UI và mọi chuỗi hiển thị bằng **tiếng Việt**, giữ đúng giọng văn hiện có.
- Không thêm build step, không `package.json`, không thư viện mới — giữ nguyên mô hình một file tĩnh.
- Mọi text người dùng nhập/hiển thị phải đi qua hàm `esc()` sẵn có khi render vào HTML.
- Free Dictionary API: `https://api.dictionaryapi.dev/api/v2/entries/en/<term>` — miễn phí, không key, chỉ tiếng Anh.
- Lỗi API/mạng khi tra cứu: bắt im lặng, coi như `{ ipa: '', audio: '' }`, KHÔNG chặn thao tác, KHÔNG toast đỏ.
- Kiểm thử thủ công qua `python3 -m http.server 8000` (app cần chạy qua HTTP, không mở `file://`).
- Từ cũ KHÔNG backfill; chỉ từ thêm mới mới có IPA/audio. Mọi từ đều nghe được nhờ fallback TTS.

---

### Task 1: Migration SQL + tài liệu

Thêm 2 cột `ipa`, `audio` vào bảng `words` và ghi chú cách chạy. Đây là bước nền cho các task sau (DB phải có cột trước khi code ghi vào).

**Files:**
- Create: `supabase-ipa.sql`
- Modify: `supabase-schema.sql` (thêm 2 cột vào định nghĩa `create table` để người cài mới có sẵn)
- Modify: `README.md` (thêm mục hướng dẫn chạy migration)

**Interfaces:**
- Produces: bảng `public.words` có thêm cột `ipa text default ''` và `audio text default ''`.

- [ ] **Step 1: Tạo file migration `supabase-ipa.sql`**

```sql
-- ============================================================
--  IPA + Audio phát âm — thêm cột vào bảng words
--  Chạy trong: Supabase Dashboard > SQL Editor
--  (Chạy sau khi đã chạy supabase-schema.sql)
-- ============================================================

alter table public.words add column if not exists ipa   text default '';
alter table public.words add column if not exists audio text default '';
```

- [ ] **Step 2: Cập nhật `supabase-schema.sql` để người cài mới có sẵn cột**

Trong khối `create table if not exists public.words (...)`, thêm 2 dòng ngay sau dòng `example text default '',`:

```sql
  ipa         text default '',
  audio       text default '',
```

- [ ] **Step 3: Thêm mục hướng dẫn vào `README.md`**

Thêm một mục con dưới phần cài đặt bảng dữ liệu (sau bước "Tạo bảng dữ liệu"):

```markdown
### 2b. (Nếu nâng cấp app đã chạy trước đó) Thêm cột IPA & phát âm
Nếu bạn đã tạo bảng từ trước, mở **SQL Editor**, dán nội dung file [`supabase-ipa.sql`](supabase-ipa.sql) và bấm **Run** để thêm cột `ipa` và `audio`. Người cài mới (đã chạy `supabase-schema.sql` bản mới nhất) thì bỏ qua bước này.
```

- [ ] **Step 4: Chạy migration trên Supabase**

Mở Supabase Dashboard → SQL Editor, dán nội dung `supabase-ipa.sql`, bấm Run.
Expected: "Success. No rows returned". Vào Table Editor → bảng `words` → thấy 2 cột mới `ipa`, `audio`.

- [ ] **Step 5: Commit**

```bash
git add supabase-ipa.sql supabase-schema.sql README.md
git commit -m "Add ipa/audio columns migration for pronunciation feature"
```

---

### Task 2: Hàm tra cứu `lookupWord` + module phát âm `playPronunciation`

Hai hàm thuần logic, không phụ thuộc DOM, là nền cho mọi UI sau này. Đặt trong IIFE của `index.html`, gần cụm helper hoặc ngay trước phần Podcast (có thể tái dùng `synth`/`pickVoice` đã khai báo phía trên).

**Files:**
- Modify: `index.html` (thêm 2 hàm trong IIFE, đặt sau block `// ---------- Podcast ...` khai báo `synth`, `pickVoice` — quanh dòng 469, để dùng lại `pickVoice`)

**Interfaces:**
- Consumes: `synth`, `pickVoice(pref)` (đã có, khai báo ~dòng 461-469).
- Produces:
  - `async function lookupWord(term)` → trả `Promise<{ ipa: string, audio: string }>`, không bao giờ throw.
  - `function playPronunciation(word)` → phát audio; `word` là object có `.term`, tùy chọn `.audio`. Không trả giá trị.

- [ ] **Step 1: Thêm hàm `lookupWord`**

Chèn sau phần khai báo `pickVoice` (sau dòng 469 `}`):

```javascript
    // ---------- Phát âm + IPA (Free Dictionary API) ----------
    // Tra cứu IPA + URL audio của một từ tiếng Anh. Không bao giờ throw:
    // lỗi/không tìm thấy -> { ipa: "", audio: "" }.
    async function lookupWord(term) {
      const q = (term || "").trim().toLowerCase();
      if (!q) return { ipa: "", audio: "" };
      try {
        const res = await fetch("https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(q));
        if (!res.ok) return { ipa: "", audio: "" };
        const data = await res.json();
        if (!Array.isArray(data)) return { ipa: "", audio: "" };
        let ipa = "", audio = "";
        for (const entry of data) {
          if (!ipa && entry.phonetic) ipa = entry.phonetic;
          const phs = Array.isArray(entry.phonetics) ? entry.phonetics : [];
          for (const p of phs) {
            if (!ipa && p.text) ipa = p.text;
            if (!audio && p.audio) audio = p.audio;
          }
          if (ipa && audio) break;
        }
        return { ipa: ipa || "", audio: audio || "" };
      } catch (e) {
        return { ipa: "", audio: "" };
      }
    }
```

- [ ] **Step 2: Thêm hàm `playPronunciation`**

Chèn ngay sau `lookupWord`:

```javascript
    // Phát âm một từ: ưu tiên file audio thật; không có thì đọc bằng giọng trình duyệt.
    function playPronunciation(word) {
      if (word && word.audio) {
        try {
          const a = new Audio(word.audio);
          a.play().catch(function () { speakTerm(word); });
          return;
        } catch (e) { /* rơi xuống fallback */ }
      }
      speakTerm(word);
    }
    function speakTerm(word) {
      if (!synth || !word || !word.term) return;
      try {
        synth.cancel();
        const u = new SpeechSynthesisUtterance(word.term);
        u.lang = "en-US";
        const v = pickVoice("en");
        if (v) u.voice = v;
        synth.speak(u);
      } catch (e) { /* im lặng */ }
    }
```

- [ ] **Step 3: Verify cú pháp — mở app, mở Console**

Run: `python3 -m http.server 8000` rồi mở `http://localhost:8000`, mở DevTools Console.
Expected: KHÔNG có lỗi cú pháp JS (app load bình thường, hiện màn đăng nhập/app). Gõ trong Console: `lookupWord` — nhưng vì hàm nằm trong IIFE nên không truy cập được từ Console; thay vào đó xác nhận app không văng lỗi khi load là đủ ở bước này.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Add lookupWord + playPronunciation helpers"
```

---

### Task 3: Ghi IPA/audio khi thêm từ + xem trước ở màn Thêm từ

Sửa `addWord` để nhận và lưu `ipa`/`audio`; thêm tra cứu tự động khi rời ô "Từ vựng" và hiện xem trước IPA + nút nghe thử.

**Files:**
- Modify: `index.html` — `addWord` (~dòng 270-275), HTML tab-add (~dòng 190-210), `doAdd` (~dòng 340-360), thêm listener blur cho `#fTerm`.

**Interfaces:**
- Consumes: `lookupWord`, `playPronunciation` (Task 2); `sb`, `db`, `esc`, `$` (đã có).
- Produces: `addWord(term, mean, ex, ipa, audio)` — chữ ký mở rộng thêm `ipa`, `audio` (mặc định `''`).

- [ ] **Step 1: Mở rộng `addWord` để lưu ipa/audio**

Thay hàm `addWord` (dòng ~270):

```javascript
    async function addWord(term, mean, ex, ipa, audio) {
      const row = { term: term.trim(), meaning: mean.trim(), example: (ex || "").trim(), ipa: (ipa || "").trim(), audio: (audio || "").trim(), box: 0, due: todayStr(), created: todayStr(), reviews: 0, correct: 0 };
      const { data, error } = await sb.from("words").insert(row).select().single();
      if (error) throw error;
      db.words.unshift(data);
    }
```

- [ ] **Step 2: Thêm vùng xem trước vào HTML tab-add**

Trong `<section id="tab-add">`, ngay sau khối `.row` chứa `#fTerm` (sau `</div>` đóng row của fTerm, ~dòng 195), chèn:

```html
        <div id="ipaPreview" class="sub" style="margin:-8px 0 14px;min-height:20px;display:flex;align-items:center;gap:8px"></div>
```

- [ ] **Step 3: Thêm biến cache + hàm tra cứu-và-hiện-preview**

Ngay trước hàm `doAdd` (~dòng 340), thêm:

```javascript
    // Cache kết quả tra cứu gần nhất cho ô Thêm từ
    let pendingLookup = { term: "", ipa: "", audio: "" };
    let lookupTimer = null;

    function renderIpaPreview(state) {
      const box = $("#ipaPreview");
      if (!box) return;
      if (state === "loading") { box.innerHTML = '<span style="opacity:.7">⏳ Đang tra phát âm…</span>'; return; }
      if (state === "none") { box.innerHTML = '<span style="opacity:.6">— không có IPA cho từ này</span>'; return; }
      if (state === "empty") { box.innerHTML = ""; return; }
      // state === "ready"
      const ipaTxt = pendingLookup.ipa ? '<b>' + esc(pendingLookup.ipa) + '</b>' : '<span style="opacity:.6">— không có IPA</span>';
      box.innerHTML = ipaTxt + '<button type="button" class="iconbtn" id="ipaPlay" title="Nghe thử">🔊</button>';
      const btn = $("#ipaPlay");
      if (btn) btn.addEventListener("click", () => playPronunciation({ term: pendingLookup.term, audio: pendingLookup.audio }));
    }

    async function doLookupPreview() {
      const term = $("#fTerm").value.trim();
      if (!term) { pendingLookup = { term: "", ipa: "", audio: "" }; renderIpaPreview("empty"); return; }
      if (pendingLookup.term === term.toLowerCase()) { renderIpaPreview(pendingLookup.ipa || pendingLookup.audio ? "ready" : "none"); return; }
      renderIpaPreview("loading");
      const r = await lookupWord(term);
      // người dùng có thể đã đổi ô trong lúc chờ
      if ($("#fTerm").value.trim() !== term) return;
      pendingLookup = { term: term.toLowerCase(), ipa: r.ipa, audio: r.audio };
      renderIpaPreview(r.ipa || r.audio ? "ready" : "none");
    }
```

- [ ] **Step 4: Gắn listener tra cứu khi rời ô/gõ xong `#fTerm`**

Thay dòng listener của `#fTerm` (dòng ~339) và thêm blur. Dòng hiện tại:

```javascript
    $("#fTerm").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#fMean").focus(); });
```

thành:

```javascript
    $("#fTerm").addEventListener("keydown", (e) => { if (e.key === "Enter") { doLookupPreview(); $("#fMean").focus(); } });
    $("#fTerm").addEventListener("blur", () => { clearTimeout(lookupTimer); lookupTimer = setTimeout(doLookupPreview, 400); });
    $("#fTerm").addEventListener("input", () => { renderIpaPreview("empty"); });
```

- [ ] **Step 5: Dùng kết quả tra cứu trong `doAdd`**

Trong `doAdd`, thay khối trong `try` (dòng ~348-355). Hiện tại:

```javascript
      try {
        await addWord(term, mean, ex);
```

thành:

```javascript
      try {
        let ipa = "", audio = "";
        if (pendingLookup.term === term.trim().toLowerCase()) { ipa = pendingLookup.ipa; audio = pendingLookup.audio; }
        else { const r = await lookupWord(term); ipa = r.ipa; audio = r.audio; }
        await addWord(term, mean, ex, ipa, audio);
```

Và ngay sau khi reset các ô (sau `$("#fTerm").value = ""; ...`), thêm reset preview:

```javascript
        pendingLookup = { term: "", ipa: "", audio: "" };
        renderIpaPreview("empty");
```

- [ ] **Step 6: Verify thủ công**

Run: `python3 -m http.server 8000`, đăng nhập.
1. Vào tab Thêm từ, gõ `ubiquitous` rồi Tab (rời ô) → hiện IPA `/juːˈbɪkwɪtəs/` + nút 🔊; bấm 🔊 nghe được.
2. Gõ từ bịa `asdfqwer` rồi rời ô → "— không có IPA cho từ này".
3. Lưu `ubiquitous` → vào Table Editor Supabase thấy row có `ipa`/`audio`; preview reset.
Expected: đúng như trên, không lỗi Console.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "Fetch + store IPA/audio on add, with preview in add form"
```

---

### Task 4: Hiển thị IPA + nút 🔊 ở Danh sách

**Files:**
- Modify: `index.html` — `renderList` (~dòng 364-390), thêm CSS class cho IPA (~trong `<style>`, gần `.vitem`).

**Interfaces:**
- Consumes: `playPronunciation`, `db.words`, `esc`, `$`.

- [ ] **Step 1: Thêm CSS cho dòng IPA**

Sau dòng `.vitem .mean { ... }` (~dòng 85), thêm:

```css
    .vitem .ipa { color: var(--muted); font-size: 13px; margin-top: 2px; font-family: "Segoe UI", system-ui, sans-serif; }
    .vitem .ipa .pron { background: transparent; border: 0; color: var(--primary); cursor: pointer; font-size: 14px; padding: 0 2px; }
    .vitem .ipa .pron:hover { color: var(--primary-2); }
```

- [ ] **Step 2: Render IPA + 🔊 trong `renderList`**

Trong `renderList`, trong hàm `.map`, sau dòng tạo `ex` (~dòng 376), thêm biến `ipa` và chèn vào markup. Thay khối:

```javascript
        const ex = w.example ? '<div class="ex">“' + esc(w.example) + '”</div>' : "";
        return '<div class="vitem" data-id="' + w.id + '">' +
          '<div><div class="term">' + esc(w.term) + '</div><div class="mean">' + esc(w.meaning) + '</div>' + ex + '</div>' +
```

thành:

```javascript
        const ex = w.example ? '<div class="ex">“' + esc(w.example) + '”</div>' : "";
        const ipaLine = '<div class="ipa"><button class="pron" data-act="play" title="Nghe phát âm">🔊</button>' + (w.ipa ? '<span>' + esc(w.ipa) + '</span>' : '') + '</div>';
        return '<div class="vitem" data-id="' + w.id + '">' +
          '<div><div class="term">' + esc(w.term) + '</div><div class="mean">' + esc(w.meaning) + '</div>' + ipaLine + ex + '</div>' +
```

- [ ] **Step 3: Gắn listener phát âm**

Sau khối gắn listener `[data-act="del"]` (~dòng 384-389), thêm:

```javascript
      box.querySelectorAll('[data-act="play"]').forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const id = e.target.closest(".vitem").dataset.id;
          const w = db.words.find((x) => x.id === id);
          if (w) playPronunciation(w);
        });
      });
```

- [ ] **Step 4: Verify thủ công**

Run: `python3 -m http.server 8000`, mở tab Danh sách.
Expected: từ mới thêm (vd `ubiquitous`) hiện nút 🔊 + IPA; bấm 🔊 nghe được. Từ cũ hiện nút 🔊 (không có IPA), bấm vẫn đọc bằng giọng trình duyệt. Không lỗi Console.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Show IPA + pronunciation button in word list"
```

---

### Task 5: Hiển thị IPA + nút 🔊 ở Flashcard & Ôn tập (không lật thẻ)

**Files:**
- Modify: `index.html` — `renderFlash` (~dòng 395-415), `drawReviewCard` (~dòng 420-452), thêm CSS `.flash-face .ipa`.

**Interfaces:**
- Consumes: `playPronunciation`, `esc`, `$`, `flashDeck`, `revDeck`.

- [ ] **Step 1: Thêm CSS cho IPA trên mặt thẻ**

Sau dòng `.flash-face .big { ... }` (~dòng 103), thêm:

```css
    .flash-face .ipa { color: var(--muted); font-size: 15px; margin-top: 10px; display: flex; align-items: center; gap: 8px; }
    .flash-face .ipa .pron { background: transparent; border: 1px solid var(--border); color: var(--primary); cursor: pointer; font-size: 16px; padding: 4px 10px; border-radius: 8px; }
    .flash-face .ipa .pron:hover { color: var(--primary-2); background: var(--surface-2); }
```

- [ ] **Step 2: Render IPA + 🔊 vào mặt trước Flashcard**

Trong `renderFlash`, thay dòng mặt trước (~dòng 402):

```javascript
          '<div class="flash-face"><span class="hint">Từ</span><div class="big">' + esc(w.term) + '</div><div class="sub" style="margin-top:12px">Bấm để lật</div></div>' +
```

thành:

```javascript
          '<div class="flash-face"><span class="hint">Từ</span><div class="big">' + esc(w.term) + '</div>' +
            '<div class="ipa"><button class="pron" id="fcPron" title="Nghe phát âm">🔊</button>' + (w.ipa ? '<span>' + esc(w.ipa) + '</span>' : '') + '</div>' +
            '<div class="sub" style="margin-top:12px">Bấm để lật</div></div>' +
```

- [ ] **Step 3: Gắn listener 🔊 cho Flashcard (chặn lật thẻ)**

Trong `renderFlash`, sau dòng `$("#fc").addEventListener("click", ...)` (~dòng 411), thêm:

```javascript
      const fcPron = $("#fcPron");
      if (fcPron) fcPron.addEventListener("click", (e) => { e.stopPropagation(); playPronunciation(w); });
```

- [ ] **Step 4: Render IPA + 🔊 vào mặt trước thẻ Ôn tập**

Trong `drawReviewCard`, thay dòng mặt trước (~dòng 441):

```javascript
            '<div class="flash-face"><span class="hint">Từ</span><div class="big">' + esc(w.term) + '</div><div class="sub" style="margin-top:12px">Bấm để xem nghĩa</div></div>' +
```

thành:

```javascript
            '<div class="flash-face"><span class="hint">Từ</span><div class="big">' + esc(w.term) + '</div>' +
              '<div class="ipa"><button class="pron" id="rcPron" title="Nghe phát âm">🔊</button>' + (w.ipa ? '<span>' + esc(w.ipa) + '</span>' : '') + '</div>' +
              '<div class="sub" style="margin-top:12px">Bấm để xem nghĩa</div></div>' +
```

- [ ] **Step 5: Gắn listener 🔊 cho Ôn tập (chặn lật thẻ)**

Trong `drawReviewCard`, sau dòng `$("#rc").addEventListener("click", ...)` (~dòng 448), thêm:

```javascript
      const rcPron = $("#rcPron");
      if (rcPron) rcPron.addEventListener("click", (e) => { e.stopPropagation(); playPronunciation(w); });
```

- [ ] **Step 6: Verify thủ công**

Run: `python3 -m http.server 8000`.
1. Tab Flashcard: mặt trước hiện 🔊 (+ IPA nếu có). Bấm 🔊 → phát âm, thẻ **KHÔNG** lật.
2. Tab Ôn hôm nay: tương tự trên thẻ ôn, bấm 🔊 không lật thẻ; bấm chỗ khác vẫn lật bình thường.
Expected: đúng như trên, không lỗi Console.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "Show IPA + pronunciation on flashcard and review cards"
```

---

### Task 6: Export/Import mang theo IPA/audio

**Files:**
- Modify: `index.html` — hàm map trong `#fileImport` change handler (~dòng 655-659).

**Interfaces:**
- Consumes: `todayStr`, `sb`. (Export lấy nguyên `db.words` nên đã tự có `ipa`/`audio` — không cần sửa.)

- [ ] **Step 1: Thêm ipa/audio vào map khi Import**

Trong handler `#fileImport`, thay object trong `.map` (~dòng 655):

```javascript
        const rows = data.words.map((w) => ({
          term: w.term, meaning: w.meaning, example: w.example || "",
          box: w.box || 0, due: w.due || todayStr(), created: w.created || todayStr(),
          reviews: w.reviews || 0, correct: w.correct || 0, last_review: w.last_review || w.lastReview || null
        }));
```

thành:

```javascript
        const rows = data.words.map((w) => ({
          term: w.term, meaning: w.meaning, example: w.example || "",
          ipa: w.ipa || "", audio: w.audio || "",
          box: w.box || 0, due: w.due || todayStr(), created: w.created || todayStr(),
          reviews: w.reviews || 0, correct: w.correct || 0, last_review: w.last_review || w.lastReview || null
        }));
```

- [ ] **Step 2: Verify thủ công**

Run: `python3 -m http.server 8000`.
1. Bấm ⬇ Xuất → mở file JSON tải về → xác nhận từ mới có trường `ipa`, `audio`.
2. Bấm ⬆ Nhập chọn lại file đó → nhập thành công; kiểm tra Danh sách từ mới nhập vẫn có IPA + 🔊.
Expected: đúng như trên, không lỗi.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "Carry ipa/audio through export and import"
```

---

## Self-Review

**Spec coverage:**
- Nguồn dữ liệu (Free Dictionary API) → Task 2 (`lookupWord`). ✓
- Data model (cột ipa/audio) → Task 1. ✓
- Luồng thêm từ + preview → Task 3. ✓
- Module `playPronunciation` (audio thật + fallback TTS) → Task 2. ✓
- Hiển thị Danh sách → Task 4; Flashcard & Ôn tập → Task 5. ✓
- Export/Import → Task 6. ✓
- Xử lý lỗi im lặng → Global Constraints + `lookupWord` try/catch. ✓
- Từ cũ không backfill, vẫn phát được → fallback TTS trong `playPronunciation`. ✓
- Kiểm thử thủ công → mỗi task có bước verify. ✓

**Placeholder scan:** Không có TBD/TODO; mọi bước có code hoặc lệnh cụ thể. ✓

**Type consistency:**
- `lookupWord(term)` → `{ ipa, audio }` dùng nhất quán ở Task 3. ✓
- `playPronunciation(word)` nhận object có `.term`/`.audio`; gọi với `{term, audio}` (preview) và với `w` từ `db.words` (list/flash/review) — đều có `.term`, `.audio`. ✓
- `addWord(term, mean, ex, ipa, audio)` — chữ ký mới dùng đúng trong `doAdd`. ✓
- `pendingLookup.term` lưu dạng lowercase; so sánh với `term.trim().toLowerCase()` nhất quán ở Task 3 Step 3 và Step 5. ✓
