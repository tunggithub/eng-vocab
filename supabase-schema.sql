-- ============================================================
--  Sổ Từ Vựng — Supabase schema
--  Chạy toàn bộ file này trong: Supabase Dashboard > SQL Editor
-- ============================================================

-- Bảng từ vựng (mỗi dòng thuộc về 1 user)
create table if not exists public.words (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  term        text not null,
  meaning     text not null,
  example     text default '',
  ipa         text default '',
  audio       text default '',
  box         int  not null default 0,
  due         date not null default current_date,
  created     date not null default current_date,
  reviews     int  not null default 0,
  correct     int  not null default 0,
  last_review date
);

-- Bảng meta lưu chuỗi ngày ôn tập (streak) của từng user
create table if not exists public.meta (
  user_id         uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  streak          int not null default 0,
  last_review_day date
);

-- Bật Row Level Security: mỗi user chỉ đọc/ghi dữ liệu của chính mình
alter table public.words enable row level security;
alter table public.meta  enable row level security;

drop policy if exists "own words" on public.words;
create policy "own words" on public.words
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own meta" on public.meta;
create policy "own meta" on public.meta
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Tăng tốc truy vấn "từ đến hạn ôn"
create index if not exists words_user_due_idx on public.words (user_id, due);
