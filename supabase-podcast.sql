-- ============================================================
--  Podcast AI — bảng theo dõi + bucket lưu audio
--  Chạy trong: Supabase Dashboard > SQL Editor
--  (Chạy sau khi đã chạy supabase-schema.sql)
-- ============================================================

-- Bảng ghi lại: mỗi user chỉ có 1 dòng, lưu "chữ ký" (hash) của bộ từ
-- đã tạo audio gần nhất -> để biết khi nào cần tạo lại.
create table if not exists public.podcasts (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  word_hash  text,
  updated_at timestamptz not null default now()
);

alter table public.podcasts enable row level security;

drop policy if exists "own podcast" on public.podcasts;
create policy "own podcast" on public.podcasts
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Bucket riêng tư để chứa file MP3. Ghi/đọc do Edge Function (service role)
-- xử lý, người dùng nghe qua signed URL nên KHÔNG cần policy công khai.
insert into storage.buckets (id, name, public)
values ('podcasts', 'podcasts', false)
on conflict (id) do nothing;
