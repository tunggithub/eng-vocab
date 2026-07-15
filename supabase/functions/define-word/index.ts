// ============================================================
//  Edge Function: define-word
//  Nhận một từ tiếng Anh, dùng OpenAI trả về nghĩa tiếng Việt,
//  một câu ví dụ tiếng Anh, và từ loại (tiếng Việt).
//
//  Deploy:
//    supabase functions deploy define-word
//  Dùng lại secret đã đặt cho generate-podcast:
//    supabase secrets set OPENAI_API_KEY=sk-...
// ============================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TEXT_MODEL = "gpt-4o-mini";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY");

    // Xác thực người dùng từ JWT gửi kèm
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return json({ error: "Chưa đăng nhập" }, 401);

    if (!openaiKey) return json({ error: "Server chưa đặt OPENAI_API_KEY" }, 500);

    const { term } = await req.json().catch(() => ({}));
    if (!term || typeof term !== "string" || !term.trim()) {
      return json({ error: "Chưa có từ" }, 400);
    }
    const word = term.trim();

    const system =
      "Bạn là trợ lý học từ vựng tiếng Anh cho người Việt. " +
      "Với một từ hoặc cụm từ tiếng Anh, hãy trả về DUY NHẤT một JSON đúng các khoá " +
      '{"meaning":"","example":"","pos":""}. ' +
      "meaning = nghĩa tiếng Việt ngắn gọn, tự nhiên của từ đó. " +
      "example = MỘT câu ví dụ tiếng Anh tự nhiên có dùng từ đó. " +
      "pos = từ loại bằng tiếng Việt (danh từ, động từ, tính từ, trạng từ, giới từ, liên từ, đại từ, thán từ); " +
      "nếu từ có nhiều từ loại thì chọn loại phổ biến nhất; nếu không xác định được thì để chuỗi rỗng. " +
      "Không thêm bất kỳ chữ nào ngoài JSON.";

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: TEXT_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: "Từ: " + word },
        ],
        temperature: 0.5,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      return json({ error: `OpenAI lỗi (${res.status}): ${detail.slice(0, 300)}` }, 502);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(content); } catch (_e) { parsed = {}; }
    const meaning = String(parsed.meaning ?? "").trim();
    const example = String(parsed.example ?? "").trim();
    const pos = String(parsed.pos ?? "").trim();
    if (!meaning && !example) return json({ error: "AI không trả về nội dung hợp lệ" }, 502);

    return json({ meaning, example, pos });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
