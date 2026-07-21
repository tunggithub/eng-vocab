-- ============================================================
--  learned_on — ngày một từ được giới thiệu (rời cấp 0)
--  Dùng để giới hạn số từ MỚI mỗi ngày (DAILY_NEW), tránh việc
--  ôn xong lại bị thay bằng lô từ mới khác trong cùng ngày.
--  Chạy trong: Supabase Dashboard > SQL Editor
--  (Chạy sau khi đã chạy supabase-schema.sql)
-- ============================================================

alter table public.words add column if not exists learned_on date;
