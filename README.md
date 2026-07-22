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

Muốn dùng proxy/gateway tương thích OpenAI thay cho API thật (ví dụ chạy cục bộ), đặt
`OPENAI_BASE_URL` trong `.env` — phải kèm tiền tố phiên bản, app tự nối `/chat/completions`
và `/audio/speech`. Bỏ trống thì dùng thẳng `https://api.openai.com/v1`.
```dotenv
OPENAI_BASE_URL=http://localhost:8080/v1
```

Nếu proxy đó không có endpoint đọc giọng (`/audio/speech`), phần podcast AI có thể
dùng nhà cung cấp/khoá riêng cho TTS: đặt `OPENAI_TTS_API_KEY` (và tuỳ chọn
`OPENAI_TTS_BASE_URL`). Khi đặt `OPENAI_TTS_API_KEY`, TTS mặc định gọi thẳng
`https://api.openai.com/v1`; nếu bỏ trống thì TTS dùng lại khoá/URL chat ở trên.
```dotenv
OPENAI_TTS_API_KEY=sk-...            # khoá OpenAI thật, có quyền TTS
OPENAI_TTS_BASE_URL=https://api.openai.com/v1
```

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
