// ============================================================
//  Edge Function: generate-podcast
//  Sinh audio podcast từ danh sách từ vựng bằng OpenAI TTS,
//  ghi đè vào Storage (bucket "podcasts"), trả về signed URL.
//
//  Deploy:
//    supabase functions deploy generate-podcast
//  Đặt khóa OpenAI (bí mật, KHÔNG để ở frontend):
//    supabase secrets set OPENAI_API_KEY=sk-...
// ============================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VOICES = ["alloy", "nova", "shimmer", "echo", "fable", "onyx"];
const TTS_MODEL = "gpt-4o-mini-tts"; // đổi sang "tts-1" nếu tài khoản chưa có model này
const TEXT_MODEL = "gpt-4o-mini";    // model viết kịch bản; đổi sang model khác nếu muốn
const STYLES = ["single", "dialogue", "story"];
const MAX_CHARS = 4000;              // giới hạn đầu vào của OpenAI /audio/speech

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

type Word = { term: string; meaning: string; example?: string };

// Dùng model chat của OpenAI viết kịch bản podcast tự nhiên theo phong cách.
// Trả về text để TTS đọc. Ném lỗi nếu gọi thất bại (caller sẽ fallback).
async function writeScript(words: Word[], style: string, apiKey: string): Promise<string> {
  const list = words.map((w, i) =>
    `${i + 1}. ${w.term} — ${w.meaning}${w.example ? ` (ví dụ: ${w.example})` : ""}`).join("\n");

  const styleGuide: Record<string, string> = {
    single: "Một người dẫn chương trình thân thiện, tự giải thích từng từ một cách gần gũi, kèm mẹo ghi nhớ ngắn.",
    dialogue: "Hai người dẫn trò chuyện qua lại (đặt tên là Minh và Lan). Minh hỏi, Lan giải thích. Ghi rõ tên trước mỗi lượt nói, ví dụ 'Minh:' rồi 'Lan:'.",
    story: "Lồng tất cả các từ vào một mẩu chuyện ngắn vui nhộn bằng tiếng Việt, sau đó tóm tắt lại nghĩa từng từ ở cuối.",
  };

  const system =
    "Bạn là biên kịch cho một podcast học từ vựng tiếng Anh dành cho người Việt. " +
    "Viết kịch bản BẰNG TIẾNG VIỆT để đọc thành tiếng, nhưng GIỮ NGUYÊN các từ vựng tiếng Anh bằng tiếng Anh. " +
    "Văn nói tự nhiên, ấm áp, dễ nghe. Với mỗi từ: nêu từ, nghĩa, cách dùng và một ví dụ. " +
    "Tuyệt đối KHÔNG dùng markdown, gạch đầu dòng, ký hiệu đặc biệt hay emoji — chỉ văn xuôi để đọc. " +
    "Độ dài khoảng 250–450 từ. Có lời chào mở đầu và lời kết động viên.";

  const user =
    `Phong cách: ${styleGuide[style] || styleGuide.single}\n\n` +
    `Danh sách ${words.length} từ hôm nay:\n${list}\n\n` +
    "Hãy viết kịch bản hoàn chỉnh, chỉ trả về phần lời thoại để đọc.";

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: TEXT_MODEL,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.8,
    }),
  });
  if (!res.ok) throw new Error(`chat ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("chat trả về rỗng");
  return text;
}

// Kịch bản dự phòng (ghép template) khi bước viết bằng AI thất bại.
function buildScript(words: Word[]): string {
  const d = new Date();
  const dateVi = `${d.getUTCDate()} tháng ${d.getUTCMonth() + 1}`;
  const parts: string[] = [];
  parts.push(`Chào mừng bạn đến với podcast từ vựng ngày ${dateVi}. Hôm nay chúng ta cùng ôn ${words.length} từ. Bắt đầu nhé.`);
  words.forEach((w, i) => {
    parts.push(`Từ số ${i + 1}. ${w.term}.`);
    parts.push(`Nghĩa là: ${w.meaning}.`);
    if (w.example) parts.push(`Ví dụ: ${w.example}.`);
  });
  parts.push("Đó là toàn bộ từ vựng hôm nay. Học đều mỗi ngày nhé. Hẹn gặp lại bạn!");
  return parts.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY");

    // 1) Xác thực người dùng từ JWT gửi kèm
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return json({ error: "Chưa đăng nhập" }, 401);

    if (!openaiKey) return json({ error: "Server chưa đặt OPENAI_API_KEY" }, 500);

    const { words, hash, voice, style, force } = await req.json().catch(() => ({}));
    if (!Array.isArray(words) || words.length === 0) return json({ error: "Không có từ nào" }, 400);
    const useVoice = VOICES.includes(voice) ? voice : "alloy";
    const useStyle = STYLES.includes(style) ? style : "single";

    const admin = createClient(supabaseUrl, serviceKey);
    const path = `${user.id}/latest.mp3`; // đường dẫn cố định -> luôn ghi đè

    // 2) Nếu bộ từ không đổi và không ép tạo lại -> dùng lại file cũ
    if (!force && hash) {
      const { data: row } = await admin.from("podcasts")
        .select("word_hash").eq("user_id", user.id).maybeSingle();
      if (row && row.word_hash === hash) {
        const { data: signed } = await admin.storage.from("podcasts").createSignedUrl(path, 3600);
        if (signed?.signedUrl) return json({ url: signed.signedUrl, reused: true });
      }
    }

    // 3a) Viết kịch bản bằng AI (fallback về template nếu lỗi)
    let script = "";
    try { script = await writeScript(words, useStyle, openaiKey); } catch (_e) { script = ""; }
    if (!script) script = buildScript(words);
    if (script.length > MAX_CHARS) script = script.slice(0, MAX_CHARS);

    // 3b) Chuyển kịch bản thành giọng nói (OpenAI TTS)
    const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: TTS_MODEL, voice: useVoice, input: script, response_format: "mp3" }),
    });
    if (!ttsRes.ok) {
      const detail = await ttsRes.text();
      return json({ error: `OpenAI lỗi (${ttsRes.status}): ${detail.slice(0, 300)}` }, 502);
    }
    const audio = new Uint8Array(await ttsRes.arrayBuffer());

    // 4) Ghi đè vào Storage
    const { error: upErr } = await admin.storage.from("podcasts")
      .upload(path, audio, { contentType: "audio/mpeg", upsert: true });
    if (upErr) return json({ error: "Lưu file lỗi: " + upErr.message }, 500);

    // 5) Cập nhật hash + trả signed URL
    await admin.from("podcasts").upsert({
      user_id: user.id, word_hash: hash ?? null, updated_at: new Date().toISOString(),
    });
    const { data: signed } = await admin.storage.from("podcasts").createSignedUrl(path, 3600);
    return json({ url: signed?.signedUrl, reused: false });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
