-- ============================================================
--  IPA + Audio phát âm — thêm cột vào bảng words
--  Chạy trong: Supabase Dashboard > SQL Editor
--  (Chạy sau khi đã chạy supabase-schema.sql)
-- ============================================================

alter table public.words add column if not exists ipa   text default '';
alter table public.words add column if not exists audio text default '';
