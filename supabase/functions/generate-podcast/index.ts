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
const TEXT_MODEL = "gpt-5.4-nano";   // model viết kịch bản; đổi sang model khác nếu muốn
const STYLES = ["single", "dialogue", "story"];
const MAX_CHARS = 4000;              // giới hạn đầu vào của OpenAI /audio/speech

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

type Word = { term: string; meaning: string; example?: string };

// Dùng model chat của OpenAI viết kịch bản podcast tự nhiên theo phong cách + ngôn ngữ.
// lang = "vi" (song ngữ giải thích) | "en" (tiếng Anh, lồng mọi từ thành truyện/hội thoại).
// Trả về text để TTS đọc. Ném lỗi nếu gọi thất bại (caller sẽ fallback).
async function writeScript(words: Word[], style: string, lang: string, apiKey: string): Promise<string> {
  const isEn = lang === "en";
  const list = words.map((w, i) =>
    isEn
      ? `${i + 1}. ${w.term}${w.meaning ? ` (nghĩa: ${w.meaning})` : ""}`
      : `${i + 1}. ${w.term} — ${w.meaning}${w.example ? ` (ví dụ: ${w.example})` : ""}`).join("\n");

  const styleGuideVi: Record<string, string> = {
    single: "Một người dẫn chương trình thân thiện, tự giải thích từng từ một cách gần gũi, kèm mẹo ghi nhớ ngắn.",
    dialogue: "Hai người dẫn trò chuyện qua lại (đặt tên là Minh và Lan). Minh hỏi, Lan giải thích. Ghi rõ tên trước mỗi lượt nói, ví dụ 'Minh:' rồi 'Lan:'.",
    story: "Lồng tất cả các từ vào một mẩu chuyện ngắn vui nhộn bằng tiếng Việt, sau đó tóm tắt lại nghĩa từng từ ở cuối.",
  };
  const styleGuideEn: Record<string, string> = {
    single: "A single friendly host who narrates naturally and works each word into real context, with a quick memory tip now and then.",
    dialogue: "Two hosts named Alex and Sam in a natural back-and-forth chat. Prefix every turn with the speaker's name, e.g. 'Alex:' then 'Sam:'.",
    story: "Weave all of the words into one short, fun, coherent story.",
  };

  const systemVi =
    "Bạn là biên kịch cho một podcast học từ vựng tiếng Anh dành cho người Việt. " +
    "Viết kịch bản BẰNG TIẾNG VIỆT để đọc thành tiếng, nhưng GIỮ NGUYÊN các từ vựng tiếng Anh bằng tiếng Anh. " +
    "Văn nói tự nhiên, ấm áp, dễ nghe. Với mỗi từ: nêu từ, nghĩa, cách dùng và một ví dụ. " +
    "Tuyệt đối KHÔNG dùng markdown, gạch đầu dòng, ký hiệu đặc biệt hay emoji — chỉ văn xuôi để đọc. " +
    "Độ dài khoảng 250–450 từ. Có lời chào mở đầu và lời kết động viên.";
  const systemEn =
    "You are a scriptwriter for an English-learning podcast aimed at Vietnamese learners. " +
    "Write the ENTIRE script in natural, spoken English only — do NOT use any Vietnamese. " +
    "Weave ALL of the given vocabulary words naturally into the content so that every single word is actually used in context at least once. " +
    "Keep it engaging and easy to follow for intermediate learners, at a comfortable listening pace. " +
    "Do NOT use markdown, bullet points, special symbols, or emoji — only prose to be read aloud. " +
    "Length about 250–450 words. Include a short welcome and an encouraging closing.";

  const userVi =
    `Phong cách: ${styleGuideVi[style] || styleGuideVi.single}\n\n` +
    `Danh sách ${words.length} từ hôm nay:\n${list}\n\n` +
    "Hãy viết kịch bản hoàn chỉnh, chỉ trả về phần lời thoại để đọc.";
  const userEn =
    `Style: ${styleGuideEn[style] || styleGuideEn.single}\n\n` +
    `The ${words.length} vocabulary words to include today:\n${list}\n\n` +
    "Write the complete script. Return only the spoken lines, nothing else.";

  const system = isEn ? systemEn : systemVi;
  const user = isEn ? userEn : userVi;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: TEXT_MODEL,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`chat ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("chat trả về rỗng");
  return text;
}

// Kịch bản dự phòng (ghép template) khi bước viết bằng AI thất bại.
function buildScript(words: Word[], lang: string): string {
  const parts: string[] = [];
  if (lang === "en") {
    parts.push(`Welcome to today's English vocabulary podcast. Today we will practice ${words.length} words. Let's begin.`);
    words.forEach((w, i) => {
      parts.push(`Word ${i + 1}: ${w.term}.`);
      const enEx = (w.example || "").split(" - ")[0].trim(); // ví dụ lưu dạng "English. - Tiếng Việt"
      if (enEx) parts.push(`For example: ${enEx}.`);
    });
    parts.push("That's all for today. Keep practicing every day. See you next time!");
    return parts.join("\n");
  }
  const d = new Date();
  const dateVi = `${d.getUTCDate()} tháng ${d.getUTCMonth() + 1}`;
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
    // Hai file cố định (luôn ghi đè): giải thích song ngữ + podcast tiếng Anh.
    const explainPath = `${user.id}/explain.mp3`;
    const podcastPath = `${user.id}/podcast.mp3`;
    const signUrl = (p: string) => admin.storage.from("podcasts").createSignedUrl(p, 3600);

    // 2) Nếu bộ từ không đổi và không ép tạo lại -> dùng lại cả 2 file cũ
    if (!force && hash) {
      const { data: row } = await admin.from("podcasts")
        .select("word_hash").eq("user_id", user.id).maybeSingle();
      if (row && row.word_hash === hash) {
        const [ex, pod] = await Promise.all([signUrl(explainPath), signUrl(podcastPath)]);
        if (ex.data?.signedUrl && pod.data?.signedUrl) {
          return json({ explainUrl: ex.data.signedUrl, podcastUrl: pod.data.signedUrl, reused: true });
        }
      }
    }

    // 3) Viết kịch bản (AI, fallback template nếu lỗi) — vi = giải thích, en = nghe ngấm.
    const makeScript = async (lang: string): Promise<string> => {
      let s = "";
      try { s = await writeScript(words, useStyle, lang, openaiKey); }
      catch (e) { console.error(`[podcast] writeScript(${lang}) failed:`, String(e)); s = ""; }
      if (!s) s = buildScript(words, lang);
      return s.length > MAX_CHARS ? s.slice(0, MAX_CHARS) : s;
    };

    // 4) TTS + ghi đè Storage; trả null nếu ok hoặc chuỗi lỗi.
    const synth = async (script: string, path: string): Promise<string | null> => {
      const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: TTS_MODEL, voice: useVoice, input: script, response_format: "mp3" }),
      });
      if (!ttsRes.ok) return `OpenAI lỗi (${ttsRes.status}): ${(await ttsRes.text()).slice(0, 300)}`;
      const audio = new Uint8Array(await ttsRes.arrayBuffer());
      const { error: upErr } = await admin.storage.from("podcasts")
        .upload(path, audio, { contentType: "audio/mpeg", upsert: true });
      return upErr ? ("Lưu file lỗi: " + upErr.message) : null;
    };

    const [scriptVi, scriptEn] = await Promise.all([makeScript("vi"), makeScript("en")]);
    const [errVi, errEn] = await Promise.all([synth(scriptVi, explainPath), synth(scriptEn, podcastPath)]);
    if (errVi) return json({ error: "Giải thích: " + errVi }, 502);
    if (errEn) return json({ error: "Podcast: " + errEn }, 502);

    // 5) Cập nhật hash + trả signed URL cho cả 2 file
    await admin.from("podcasts").upsert({
      user_id: user.id, word_hash: hash ?? null, updated_at: new Date().toISOString(),
    });
    const [ex, pod] = await Promise.all([signUrl(explainPath), signUrl(podcastPath)]);
    return json({ explainUrl: ex.data?.signedUrl, podcastUrl: pod.data?.signedUrl, reused: false });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
