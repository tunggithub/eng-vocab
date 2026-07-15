# Thiết kế: Phát âm + IPA cho từ vựng

**Ngày:** 2026-07-15
**Trạng thái:** Đã duyệt

## Mục tiêu

Thêm hai khả năng cho app Sổ Từ Vựng:

1. **Nghe phát âm** — mỗi từ có nút 🔊 để nghe cách đọc.
2. **Hiển thị IPA** — phiên âm IPA hiện ngay khi từ được thêm và ở các nơi xem từ.

## Bối cảnh

App là một file `index.html` duy nhất (vanilla JS trong một IIFE), backend Supabase, UI tiếng Việt. App **đã có sẵn** hạ tầng `speechSynthesis` (dùng cho tính năng Podcast) — sẽ tận dụng làm fallback phát âm.

## Quyết định thiết kế

### Nguồn dữ liệu

Dùng **Free Dictionary API**: `https://api.dictionaryapi.dev/api/v2/entries/en/<từ>`
- Miễn phí, không cần API key, hỗ trợ CORS → gọi thẳng từ trình duyệt.
- Chỉ tra tiếng Anh. Tra không ra → để trống, không chặn lưu từ.

Trích xuất từ response (mảng JSON):
- **IPA**: chuỗi `phonetic` đầu tiên có giá trị; nếu không có, lấy `phonetics[].text` đầu tiên không rỗng.
- **Audio**: `phonetics[].audio` đầu tiên không rỗng (URL `.mp3`, giọng người thật).

### Data model

Thêm 2 cột vào bảng `public.words`:
- `ipa text default ''`
- `audio text default ''`

Migration: file mới `supabase-ipa.sql` với `alter table public.words add column if not exists ...`. Ghi chú cách chạy trong README.

**Từ cũ:** KHÔNG backfill. Từ đã có sẽ có `ipa`/`audio` rỗng; vẫn nghe được nhờ fallback TTS, nhưng không hiện IPA. Chỉ từ thêm mới từ giờ mới có IPA/audio.

## Các thành phần

### 1. Hàm tra cứu `lookupWord(term)` → `{ ipa, audio }`

- Gọi Free Dictionary API cho `term` (đã trim, lowercase để tra).
- Trả về `{ ipa: '', audio: '' }` nếu lỗi/không tìm thấy (bắt lỗi im lặng, không toast).
- Là đơn vị độc lập, không phụ thuộc DOM.

### 2. Luồng thêm từ (tab "Thêm từ")

- Khi rời ô "Từ vựng" (blur) hoặc nhấn Enter sang ô nghĩa → gọi `lookupWord` (debounce ~400ms; bỏ qua nếu term rỗng hoặc trùng lần tra trước).
- Hiện dưới ô "Từ vựng" một dòng xem trước: **IPA** + nút **🔊 nghe thử**. Không tra ra → hiện "— không có IPA" nhạt.
- Cache kết quả vào biến tạm `pendingLookup = { term, ipa, audio }`.
- Khi bấm "Lưu từ": nếu `pendingLookup.term` khớp term hiện tại → dùng luôn; nếu chưa có/không khớp → gọi `lookupWord` một lần rồi mới insert.
- `addWord(term, mean, ex, ipa, audio)` ghi thêm `ipa`, `audio` vào row insert.

### 3. Module phát âm `playPronunciation(word)`

- Có `word.audio` → `new Audio(word.audio).play()`.
- Không có → `speechSynthesis` đọc `word.term`, `lang = "en-US"`, dùng `pickVoice("en")` sẵn có.
- Dùng lại được ở mọi nơi. Áp dụng cho **mọi từ**, kể cả từ cũ.

### 4. Hiển thị

- **Danh sách (`renderList`)**: dưới nghĩa, nếu có `ipa` thì hiện dòng IPA. Thêm nút 🔊 vào cụm `.meta`. Gắn listener gọi `playPronunciation`.
- **Flashcard (`renderFlash`) & Ôn tập (`drawReviewCard`)**: mặt trước, dưới từ, hiện IPA (nếu có) + nút 🔊. Nút 🔊 phải `stopPropagation()` để bấm nghe **không lật thẻ**.
- **Thêm từ**: như mục 2.

### 5. Export / Import

- Export: mỗi word JSON kèm `ipa`, `audio` (tự nhiên vì lấy nguyên `db.words`).
- Import: map thêm `ipa: w.ipa || ''`, `audio: w.audio || ''`.

## Xử lý lỗi

- Lỗi API/mạng khi tra cứu → coi như không có dữ liệu, không chặn thao tác, không toast đỏ.
- IPA render qua `esc()`.
- `new Audio().play()` có thể bị chặn autoplay → bọc `.catch()` im lặng (người dùng đã tương tác bằng cách bấm nút nên thường ok).

## Kiểm thử (thủ công)

App tĩnh, không có test framework. Verify bằng `python3 -m http.server 8000`:
1. Thêm từ có audio (vd *ubiquitous*) → thấy IPA + nghe được giọng thật.
2. Thêm từ bịa (vd *asdfqwer*) → không có IPA, lưu vẫn được, 🔊 fallback TTS.
3. Từ cũ (không có ipa/audio) → không hiện IPA, 🔊 vẫn đọc bằng giọng trình duyệt.
4. Trên Flashcard: bấm 🔊 → phát âm mà **không** lật thẻ.
5. Danh sách và Ôn tập hiện IPA + 🔊 đúng.

## Ngoài phạm vi (YAGNI)

- Không backfill hàng loạt từ cũ.
- Không hỗ trợ đa ngôn ngữ ngoài tiếng Anh.
- Không chọn giọng/accent (Anh-Mỹ vs Anh-Anh) — lấy audio đầu tiên có sẵn.
