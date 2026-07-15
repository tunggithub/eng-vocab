-- ============================================================
--  Tự điền AI — thêm cột từ loại (pos) và ghi chú (note)
--  Chạy trong: Supabase Dashboard > SQL Editor
--  (Chạy sau khi đã chạy supabase-schema.sql)
-- ============================================================

alter table public.words add column if not exists pos  text default '';
alter table public.words add column if not exists note text default '';
