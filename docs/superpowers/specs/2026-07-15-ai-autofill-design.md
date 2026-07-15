# Thiết kế: Tự điền nghĩa/ví dụ/từ loại bằng AI + tách ô Ghi chú

**Ngày:** 2026-07-15
**Trạng thái:** Đã duyệt

## Mục tiêu

Khi thêm từ mới, người dùng chỉ cần nhập **từ**; bấm một nút để AI tự điền **nghĩa (tiếng Việt)**, **ví dụ (tiếng Anh)**, và **từ loại** (danh từ, động từ, tính từ…), xem lại rồi lưu.

Đồng thời tách ô "Ví dụ / ghi chú" hiện tại thành **hai ô riêng**: **Ví dụ** (AI tự điền, ánh xạ cột `example` cũ) và **Ghi chú** (người dùng tự nhập, cột mới `note`).

## Bối cảnh

App là một file `index.html` (vanilla JS trong IIFE), backend Supabase. Đã có sẵn một Supabase Edge Function `generate-podcast` gọi OpenAI với secret `OPENAI_API_KEY` — tính năng này dựng theo cùng khuôn và **dùng lại chính key đó**. Phần IPA/audio (Free Dictionary API) đã có và độc lập với tính năng này.

## Quyết định thiết kế

- **Nguồn:** OpenAI Edge Function (nghĩa tiếng Việt cần chất lượng dịch/giải thích — Free Dictionary chỉ có tiếng Anh).
- **Kích hoạt:** nút "✨ Tự điền" bấm thủ công (tránh tốn phí ngoài ý muốn; cho người dùng xem lại trước khi lưu).
- **Ghi đè:** điền lại **cả ba** (nghĩa, ví dụ, từ loại), thay thế nội dung hiện có.
- **Từ loại:** lưu ở cột DB riêng `pos`, hiển thị dạng huy hiệu (pill) ở Danh sách và Flashcard/Ôn tập.

## Data model

Thêm hai cột vào bảng `public.words`:
- `pos  text default ''` — từ loại.
- `note text default ''` — ghi chú của người dùng.

(Cột `example` cũ giữ nguyên, giờ chỉ dùng cho "Ví dụ".)

Migration: file mới `supabase-autofill.sql` (`alter table ... add column if not exists pos/note text default ''`), đồng thời thêm cả hai cột vào `supabase-schema.sql` cho người cài mới. Từ cũ để `''`.

## Thành phần

### 1. Edge Function `define-word`

File mới: `supabase/functions/define-word/index.ts`, dựng theo khuôn `generate-podcast`:
- CORS headers giống hệt (`Access-Control-Allow-*`).
- `OPTIONS` → trả "ok"; chỉ nhận `POST`.
- Xác thực: đọc `Authorization` header, tạo user client, `auth.getUser()`; chưa đăng nhập → `{ error: "Chưa đăng nhập" }` status 401.
- Đọc secret `OPENAI_API_KEY`; thiếu → `{ error: "Server chưa đặt OPENAI_API_KEY" }` status 500.
- Input: `{ term }` từ body. Thiếu/rỗng → `{ error: "Chưa có từ" }` status 400.
- Gọi OpenAI chat completions:
  - model `gpt-4o-mini`, `response_format: { type: "json_object" }`, `temperature` vừa phải (~0.5).
  - system prompt: yêu cầu trả JSON đúng khoá `{ "meaning": "...", "example": "...", "pos": "..." }`; *meaning* = nghĩa tiếng Việt ngắn gọn của từ tiếng Anh; *example* = một câu ví dụ tiếng Anh tự nhiên có dùng từ đó, theo sau là bản dịch tiếng Việt của câu đó, ngăn cách bằng " - "; *pos* = từ loại **bằng tiếng Việt** (ví dụ: "danh từ", "động từ", "tính từ", "trạng từ", "giới từ"); nếu từ có nhiều từ loại thì chọn phổ biến nhất; không xác định được thì để chuỗi rỗng.
  - user prompt: chứa `term`.
  - OpenAI lỗi (non-2xx) → `{ error: "OpenAI lỗi (<status>): <detail>" }` status 502.
- Parse `choices[0].message.content` thành JSON; lấy `meaning`, `example`, `pos` (mặc định chuỗi rỗng nếu thiếu). Nếu cả `meaning` lẫn `example` đều rỗng → coi như lỗi 502.
- Trả `{ meaning, example, pos }` status 200.
- Bọc toàn bộ trong try/catch trả `{ error }` status 500.

### 2. Tách ô Ví dụ / Ghi chú

Trong tab "Thêm từ", thay ô `#fEx` (nhãn cũ "Ví dụ / ghi chú") bằng **hai** ô:
- `#fEx` — nhãn "Ví dụ (AI tự điền)", ánh xạ cột `example`.
- `#fNote` — nhãn "Ghi chú (không bắt buộc)", ánh xạ cột `note`, do người dùng nhập.

`addWord` mở rộng thành `addWord(term, mean, ex, ipa, audio, pos, note)`, ghi thêm `pos` và `note` vào row. `doAdd` đọc thêm `$("#fNote").value`, và reset ô này sau khi lưu. Import/Export mang theo `note` (`note: w.note || ""`). Phím Enter nhanh vẫn ở ô nghĩa như cũ; ô Ghi chú không gắn Enter-để-lưu.

### 3. Frontend — nút "✨ Tự điền"

Trong tab "Thêm từ", thêm nút `✨ Tự điền` vào cụm `.btnbar` (cạnh "Lưu từ").
- Bấm khi `#fTerm` trống → hiện `#addMsg` màu đỏ "Nhập từ trước đã.", dừng.
- Có từ → disable nút, đổi nhãn/hiện trạng thái "⏳ Đang nhờ AI…".
- Gọi `sb.functions.invoke("define-word", { body: { term } })`.
- Đọc lỗi theo đúng pattern hàm `genAI` hiện có: nếu `error`, thử `await error.context.json()` lấy `body.error`, fallback `error.message`.
- Thành công → gán đè `$("#fMean").value` = `data.meaning`, `$("#fEx").value` = `data.example`; và lưu `data.pos` vào biến tạm `pendingPos = { term: <lowercased>, pos }` (không có ô nhập cho từ loại). Hiện huy hiệu từ loại ở khu xem trước cạnh ô "Từ vựng" (dùng chung chỗ với xem trước IPA hoặc một dòng riêng). Không tự lưu — người dùng xem lại rồi bấm "Lưu từ".
- Lỗi → hiện `#addMsg` đỏ với thông điệp lỗi; vẫn cho gõ tay.
- `finally`: bật lại nút, phục hồi nhãn.

Nút này độc lập với luồng IPA (blur → Free Dictionary). Khi Lưu, `doAdd` mở rộng để gom thêm `pos`: nếu `pendingPos.term` khớp từ hiện tại (lowercased) thì dùng `pendingPos.pos`, ngược lại `''`. `addWord` nhận thêm tham số `pos` và ghi vào row. Sau khi lưu thành công, reset `pendingPos` và xoá huy hiệu.

### 4. Hiển thị từ loại + ghi chú

- **Huy hiệu từ loại:**
  - Danh sách: pill nhỏ cạnh từ khi `w.pos` khác rỗng.
  - Flashcard & Ôn tập: pill ở mặt trước, gần từ (cạnh IPA).
- **Ghi chú (`note`):** hiển thị riêng, khác với ví dụ:
  - Danh sách: một dòng riêng (không in nghiêng kiểu trích dẫn như ví dụ), chỉ hiện khi `w.note` khác rỗng.
  - Flashcard & Ôn tập: ở mặt sau (mặt nghĩa), dưới ví dụ, khi có.
- Dùng `esc()` cho cả `pos` và `note`.
- **Export/Import:** mang theo `pos` và `note` (`pos: w.pos || ""`, `note: w.note || ""`).

### 5. Tài liệu

README: thêm mục hướng dẫn deploy `define-word` (`supabase functions deploy define-word`), nêu rõ dùng lại `OPENAI_API_KEY` đã đặt cho podcast; và mục chạy `supabase-autofill.sql` để thêm cột `pos`, `note` (giống mục `supabase-ipa.sql`).

## Xử lý lỗi

- Mọi lỗi mạng/OpenAI/parse → thông báo gọn trên `#addMsg`, không chặn nhập tay.
- Không có test framework: kiểm thử thủ công (deploy function, đăng nhập, nhập từ, bấm Tự điền).

## Ngoài phạm vi (YAGNI)

- Không cache kết quả define (mỗi lần bấm gọi mới).
- Function này KHÔNG suy ra IPA (IPA vẫn do Free Dictionary lo).
- Không dịch ngược ví dụ sang tiếng Việt.
- Không có ô nhập tay riêng cho từ loại (chỉ AI điền + hiển thị); không backfill từ loại cho từ cũ.
