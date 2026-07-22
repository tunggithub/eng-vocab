export const VOICES = ["alloy", "nova", "shimmer", "echo", "fable", "onyx"];
export const STYLES = ["single", "dialogue", "story"];
export const TEXT_MODEL = "gpt-5.4-nano";
export const TTS_MODEL = "gpt-4o-mini-tts";
export const MAX_CHARS = 4000;

const CHAT_URL = "https://api.openai.com/v1/chat/completions";
const SPEECH_URL = "https://api.openai.com/v1/audio/speech";

export async function defineWord(term, apiKey, fetchImpl = fetch) {
  const system =
    "Bạn là trợ lý học từ vựng tiếng Anh cho người Việt. " +
    "Với một từ hoặc cụm từ tiếng Anh, hãy trả về DUY NHẤT một JSON đúng các khoá " +
    '{"meaning":"","example":"","pos":"","ipa":""}. ' +
    "meaning = nghĩa tiếng Việt ngắn gọn, tự nhiên của từ đó. " +
    "example = MỘT câu ví dụ tiếng Anh tự nhiên có dùng từ đó, theo sau là bản dịch tiếng Việt của chính câu đó, ngăn cách bằng ' - ' (ví dụ: \"She is very diligent. - Cô ấy rất chăm chỉ.\"). " +
    "pos = từ loại bằng tiếng Việt, KHÔNG giới hạn ở từ đơn: nếu là một từ thì dùng danh từ, động từ, tính từ, trạng từ, giới từ, liên từ, đại từ, thán từ (chọn loại phổ biến nhất khi có nhiều loại); " +
    "nếu là cụm từ nhiều chữ thì dùng loại phù hợp như cụm động từ, cụm danh từ, cụm tính từ, cụm giới từ, thành ngữ, hoặc cụm từ (ví dụ: \"lean against\" -> \"cụm động từ\"); nếu không xác định được thì để chuỗi rỗng. " +
    "ipa = phiên âm IPA của từ/cụm từ theo giọng Anh-Mỹ, đặt trong dấu gạch chéo, ví dụ \"/ˈjuːnɪk/\" hoặc \"/liːn əˈɡɛnst/\"; nếu không chắc thì để chuỗi rỗng. " +
    "Không thêm bất kỳ chữ nào ngoài JSON.";
  const res = await fetchImpl(CHAT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: TEXT_MODEL,
      messages: [{ role: "system", content: system }, { role: "user", content: "Từ: " + term }],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI lỗi (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  let parsed = {};
  try { parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? ""); } catch { parsed = {}; }
  const meaning = String(parsed.meaning ?? "").trim();
  const example = String(parsed.example ?? "").trim();
  const pos = String(parsed.pos ?? "").trim();
  const ipa = String(parsed.ipa ?? "").trim();
  if (!meaning && !example) throw new Error("AI không trả về nội dung hợp lệ");
  return { meaning, example, pos, ipa };
}

export async function writeScript(words, style, lang, apiKey, fetchImpl = fetch) {
  const isEn = lang === "en";
  const list = words.map((w, i) =>
    isEn
      ? `${i + 1}. ${w.term}${w.meaning ? ` (nghĩa: ${w.meaning})` : ""}`
      : `${i + 1}. ${w.term} — ${w.meaning}${w.example ? ` (ví dụ: ${w.example})` : ""}`).join("\n");
  const styleGuideVi = {
    single: "Một người dẫn chương trình thân thiện, tự giải thích từng từ một cách gần gũi, kèm mẹo ghi nhớ ngắn.",
    dialogue: "Hai người dẫn trò chuyện qua lại (đặt tên là Minh và Lan). Minh hỏi, Lan giải thích. Ghi rõ tên trước mỗi lượt nói, ví dụ 'Minh:' rồi 'Lan:'.",
    story: "Lồng tất cả các từ vào một mẩu chuyện ngắn vui nhộn bằng tiếng Việt, sau đó tóm tắt lại nghĩa từng từ ở cuối.",
  };
  const styleGuideEn = {
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
  const res = await fetchImpl(CHAT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: TEXT_MODEL,
      messages: [{ role: "system", content: isEn ? systemEn : systemVi }, { role: "user", content: isEn ? userEn : userVi }],
    }),
  });
  if (!res.ok) throw new Error(`chat ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("chat trả về rỗng");
  return text;
}

export function buildScript(words, lang) {
  const parts = [];
  if (lang === "en") {
    parts.push(`Welcome to today's English vocabulary podcast. Today we will practice ${words.length} words. Let's begin.`);
    words.forEach((w, i) => {
      parts.push(`Word ${i + 1}: ${w.term}.`);
      const enEx = (w.example || "").split(" - ")[0].trim();
      if (enEx) parts.push(`For example: ${enEx}.`);
    });
    parts.push("That's all for today. Keep practicing every day. See you next time!");
    return parts.join("\n");
  }
  const d = new Date();
  const dateVi = `${d.getDate()} tháng ${d.getMonth() + 1}`;
  parts.push(`Chào mừng bạn đến với podcast từ vựng ngày ${dateVi}. Hôm nay chúng ta cùng ôn ${words.length} từ. Bắt đầu nhé.`);
  words.forEach((w, i) => {
    parts.push(`Từ số ${i + 1}. ${w.term}.`);
    parts.push(`Nghĩa là: ${w.meaning}.`);
    if (w.example) parts.push(`Ví dụ: ${w.example}.`);
  });
  parts.push("Đó là toàn bộ từ vựng hôm nay. Học đều mỗi ngày nhé. Hẹn gặp lại bạn!");
  return parts.join("\n");
}

export async function synthTTS(script, voice, apiKey, fetchImpl = fetch) {
  const res = await fetchImpl(SPEECH_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: TTS_MODEL, voice, input: script, response_format: "mp3" }),
  });
  if (!res.ok) throw new Error(`OpenAI lỗi (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}
