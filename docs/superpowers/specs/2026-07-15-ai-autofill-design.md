# Thiết kế: Tự điền nghĩa + ví dụ bằng AI

**Ngày:** 2026-07-15
**Trạng thái:** Đã duyệt

## Mục tiêu

Khi thêm từ mới, người dùng chỉ cần nhập **từ**; bấm một nút để AI tự điền **nghĩa (tiếng Việt)** và **ví dụ (tiếng Anh)**, xem lại rồi lưu.

## Bối cảnh

App là một file `index.html` (vanilla JS trong IIFE), backend Supabase. Đã có sẵn một Supabase Edge Function `generate-podcast` gọi OpenAI với secret `OPENAI_API_KEY` — tính năng này dựng theo cùng khuôn và **dùng lại chính key đó**. Phần IPA/audio (Free Dictionary API) đã có và độc lập với tính năng này.

## Quyết định thiết kế

- **Nguồn:** OpenAI Edge Function (nghĩa tiếng Việt cần chất lượng dịch/giải thích — Free Dictionary chỉ có tiếng Anh).
- **Kích hoạt:** nút "✨ Tự điền" bấm thủ công (tránh tốn phí ngoài ý muốn; cho người dùng xem lại trước khi lưu).
- **Ghi đè:** điền lại **cả hai** ô nghĩa và ví dụ, thay thế nội dung hiện có.

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
  - system prompt: yêu cầu trả JSON đúng khoá `{ "meaning": "...", "example": "..." }`; *meaning* = nghĩa tiếng Việt ngắn gọn của từ tiếng Anh; *example* = một câu ví dụ tiếng Anh tự nhiên có dùng từ đó.
  - user prompt: chứa `term`.
  - OpenAI lỗi (non-2xx) → `{ error: "OpenAI lỗi (<status>): <detail>" }` status 502.
- Parse `choices[0].message.content` thành JSON; lấy `meaning`, `example` (mặc định chuỗi rỗng nếu thiếu). Rỗng cả hai → coi như lỗi 502.
- Trả `{ meaning, example }` status 200.
- Bọc toàn bộ trong try/catch trả `{ error }` status 500.

### 2. Frontend — nút "✨ Tự điền"

Trong tab "Thêm từ", thêm nút `✨ Tự điền` vào cụm `.btnbar` (cạnh "Lưu từ").
- Bấm khi `#fTerm` trống → hiện `#addMsg` màu đỏ "Nhập từ trước đã.", dừng.
- Có từ → disable nút, đổi nhãn/hiện trạng thái "⏳ Đang nhờ AI…".
- Gọi `sb.functions.invoke("define-word", { body: { term } })`.
- Đọc lỗi theo đúng pattern hàm `genAI` hiện có: nếu `error`, thử `await error.context.json()` lấy `body.error`, fallback `error.message`.
- Thành công (`data.meaning`/`data.example`) → gán đè `$("#fMean").value` và `$("#fEx").value`. Không tự lưu — người dùng xem lại rồi bấm "Lưu từ".
- Lỗi → hiện `#addMsg` đỏ với thông điệp lỗi; vẫn cho gõ tay.
- `finally`: bật lại nút, phục hồi nhãn.

Nút này độc lập với luồng IPA (blur → Free Dictionary). Khi Lưu, `doAdd` vẫn gom nghĩa/ví dụ (giờ có thể do AI điền) + IPA/audio như hiện tại.

### 3. Tài liệu

README: thêm mục hướng dẫn deploy `define-word` (`supabase functions deploy define-word`), nêu rõ dùng lại `OPENAI_API_KEY` đã đặt cho podcast.

## Xử lý lỗi

- Mọi lỗi mạng/OpenAI/parse → thông báo gọn trên `#addMsg`, không chặn nhập tay.
- Không có test framework: kiểm thử thủ công (deploy function, đăng nhập, nhập từ, bấm Tự điền).

## Ngoài phạm vi (YAGNI)

- Không cache kết quả define (mỗi lần bấm gọi mới).
- Function này KHÔNG suy ra IPA (IPA vẫn do Free Dictionary lo).
- Không dịch ngược ví dụ sang tiếng Việt.
