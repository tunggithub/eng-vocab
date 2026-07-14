// ============================================================
//  Cấu hình Supabase — chỉ cần sửa file này
// ============================================================
//  Lấy 2 giá trị này ở: Supabase Dashboard > Project Settings > API Keys
//    - Project URL          (dạng https://xxxxx.supabase.co)
//    - Publishable key       (dạng "sb_publishable_...", AN TOÀN để đưa lên frontend)
//      (project cũ hơn có thể vẫn hiện là "anon public key" dạng "eyJ..." — dùng cũng được)
//
//  publishable key được thiết kế để lộ ra ở phía client; dữ liệu vẫn được bảo vệ
//  bởi Row Level Security (mỗi user chỉ thấy từ của mình).
// ============================================================

window.SUPABASE_URL             = "https://hytmwjfylbloxfdxmivc.supabase.co";
window.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_5K6j7PgBKK5hqLwrQMNMUw_vVolOgyE";
