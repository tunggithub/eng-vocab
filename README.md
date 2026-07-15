# Sổ Từ Vựng — Flashcard & Ôn tập mỗi ngày

Web app học từ vựng: nhập từ, lật flashcard kiểu Quizlet, và **mỗi ngày tự chọn ra vài từ để ôn tập** theo cơ chế lặp ngắt quãng (spaced repetition — Leitner).

Dữ liệu lưu trên **Supabase** và **đồng bộ giữa mọi thiết bị** — sửa ở máy này, máy khác thấy ngay. Có đăng nhập bằng email (magic link), mỗi người chỉ thấy từ của mình.

## Cài đặt (một lần, ~5 phút)

### 1. Tạo project Supabase (miễn phí)
1. Vào https://supabase.com → tạo tài khoản → **New project**.
2. Đợi project khởi tạo xong.

### 2. Tạo bảng dữ liệu
1. Mở **SQL Editor** trong Supabase Dashboard.
2. Dán toàn bộ nội dung file [`supabase-schema.sql`](supabase-schema.sql) và bấm **Run**.

### 2b. (Nếu nâng cấp app đã chạy trước đó) Thêm cột IPA & phát âm
Nếu bạn đã tạo bảng từ trước, mở **SQL Editor**, dán nội dung file [`supabase-ipa.sql`](supabase-ipa.sql) và bấm **Run** để thêm cột `ipa` và `audio`. Người cài mới (đã chạy `supabase-schema.sql` bản mới nhất) thì bỏ qua bước này.

### 2c. (Nếu nâng cấp) Thêm cột từ loại & ghi chú
Mở **SQL Editor**, dán nội dung [`supabase-autofill.sql`](supabase-autofill.sql) và bấm **Run** để thêm cột `pos` (từ loại) và `note` (ghi chú). Người cài mới đã chạy `supabase-schema.sql` bản mới nhất thì bỏ qua.

### 3. Điền khóa vào `config.js`
1. Vào **Project Settings → API Keys**.
2. Copy **Project URL** và **Publishable key** (`sb_publishable_...`; project cũ hơn hiển thị là *anon public key* dạng `eyJ...` — dùng cũng được).
3. Mở [`config.js`](config.js), dán vào:
   ```js
   window.SUPABASE_URL             = "https://xxxxx.supabase.co";
   window.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_...";
   ```
   > Publishable key được thiết kế để lộ ra ở frontend — an toàn. Dữ liệu vẫn được bảo vệ bởi Row Level Security.

### 4. Tắt đăng ký tự do — chỉ admin tạo tài khoản (BẮT BUỘC)
App **không có** nút đăng ký; người dùng chỉ đăng nhập bằng tài khoản được cấp sẵn. Nhưng phải chặn thêm ở phía Supabase, nếu không kẻ khác vẫn gọi thẳng API đăng ký được:

1. Vào **Authentication → Sign In / Providers** (hoặc **Authentication → Settings**).
2. **Tắt "Allow new users to sign up"** (Disable signup). → Từ giờ mọi lời gọi `signUp` đều bị từ chối.

**Cách admin tạo tài khoản cho người dùng:**
- Vào **Authentication → Users → Add user**.
- Nhập email + mật khẩu, tích **Auto Confirm User** để họ đăng nhập được ngay.
- Gửi email + mật khẩu đó cho người dùng. Họ đăng nhập là dùng được, dữ liệu tách biệt theo tài khoản.

## Chạy

- **Thử tại máy:** cần chạy qua HTTP (không mở trực tiếp `file://` vì đăng nhập cần domain hợp lệ):
  ```bash
  python3 -m http.server 8000
  # rồi mở http://localhost:8000
  ```
- **Đưa lên online (miễn phí):** đẩy 3 file (`index.html`, `config.js`, và không cần `supabase-schema.sql`) lên **Netlify**, **Vercel**, hoặc **GitHub Pages**. Kéo-thả thư mục vào Netlify Drop là xong.

## Cách hoạt động

- **➕ Thêm từ** — nhập *từ · nghĩa · ví dụ*. Enter để lưu nhanh liên tục.
- **📅 Ôn hôm nay** — tự chọn các từ **đến hạn** + tối đa 8 từ mới/ngày. Lật thẻ rồi chấm *Đã nhớ / Chưa nhớ*.
- **🎧 Podcast** — dựng một "tập podcast" đọc to các từ hôm nay (lời dẫn tiếng Việt + từ giọng Anh + nghĩa + ví dụ), có phát/tạm dừng/chuyển từ và chỉnh tốc độ. Dùng giọng đọc sẵn của trình duyệt, không cần cài gì thêm.
- **🃏 Flashcard** — lật thẻ tự do như Quizlet (không tính điểm).
- **📚 Danh sách** — xem, tìm, xoá từ.
- **⬇ Xuất / ⬆ Nhập** — sao lưu ra JSON và nạp lại (nạp = thêm vào tài khoản hiện tại).

## Podcast AI bằng OpenAI (tùy chọn)

Tab **🎧 Podcast** có 2 chế độ:
- **Nghe nhanh (miễn phí)** — dùng giọng trình duyệt, chạy ngay, không cần cài gì.
- **Podcast AI** — giọng đọc tự nhiên của OpenAI, sinh ra file MP3 tải được. Cần thiết lập một lần như dưới đây.

> 🔑 Khóa OpenAI **không nằm ở frontend**. Nó được giữ bí mật trong một Edge Function của Supabase; trình duyệt chỉ gọi hàm đó.

### Cài đặt (một lần)

1. **Tạo bảng + bucket:** chạy [`supabase-podcast.sql`](supabase-podcast.sql) trong **SQL Editor**.

2. **Cài Supabase CLI** (nếu chưa có): https://supabase.com/docs/guides/cli
   ```bash
   supabase login
   supabase link --project-ref <PROJECT_REF>   # lấy ở URL dashboard hoặc Project Settings
   ```

3. **Đặt khóa OpenAI làm secret** (lấy khóa ở https://platform.openai.com/api-keys):
   ```bash
   supabase secrets set OPENAI_API_KEY=sk-...
   ```

4. **Deploy Edge Function:**
   ```bash
   supabase functions deploy generate-podcast
   ```

Xong! Vào tab Podcast → **Tạo audio bằng AI**.

### Cách tiết kiệm bộ nhớ & chi phí
- **Ghi đè:** mỗi user chỉ có đúng 1 file `<user_id>/latest.mp3`, bản mới đè bản cũ → Storage không phình to, không cần job dọn dẹp.
- **Dùng lại:** nếu bộ từ hôm nay chưa đổi, app phát lại file cũ, không gọi lại OpenAI (khỏi tốn phí). Bấm **🔄 Tạo lại** để ép sinh mới.
- Chi phí OpenAI rất nhỏ (khoảng vài xu / ngày). Muốn đổi model, sửa các hằng số trong [`supabase/functions/generate-podcast/index.ts`](supabase/functions/generate-podcast/index.ts).

### Hai model được dùng
| Bước | Model | Hằng số | Ghi chú |
|---|---|---|---|
| Viết kịch bản | `gpt-4o-mini` | `TEXT_MODEL` | AI viết lời dẫn tự nhiên; lỗi thì tự dùng template dự phòng |
| Đọc thành audio | `gpt-4o-mini-tts` | `TTS_MODEL` | Đổi sang `tts-1` nếu tài khoản chưa có |

### Phong cách kịch bản
Chọn ngay trên giao diện tab Podcast:
- **Một người dẫn** — giải thích từng từ gần gũi, có mẹo nhớ.
- **Hai người trò chuyện** — hội thoại qua lại (Minh & Lan). *Lưu ý: TTS chỉ có một giọng nên một người đọc cả hai vai.*
- **Kể chuyện** — lồng các từ vào một mẩu truyện ngắn rồi tóm tắt nghĩa.

### Lịch ôn (Leitner)
Nhớ đúng → khoảng cách ôn giãn dần: **1 → 2 → 4 → 7 → 15 → 30 ngày**. Quên → về mức 1, ôn lại sớm. Từ khó xuất hiện thường xuyên, từ đã thuộc thì thưa dần.
