// ai.js — розкидання великого тексту по слайдах через Gemini (без сервера, прямий fetch).
// Ключ — у localStorage (Google AI Studio). Промпт і парсинг 1:1 з десктопного server.py.
const GEMINI_MODEL = "gemini-flash-latest";

function splitPrompt(text, count) {
  const nHint = count ? `рівно ${count}` : "оптимальну кількість (звичайно 5–8)";
  return (
    "Ти — редактор Instagram-каруселей українською. Розбий поданий текст на " +
    `${nHint} слайдів-тез. Кожен слайд: коротка ТЕЗА (1–3 слова, суть слайда) і ` +
    "ТЕКСТ (1–2 живих речення). Збережи зміст і тон автора, не додавай нічого від себе. " +
    "Поверни ЛИШЕ JSON-масив об'єктів виду " +
    '[{"ТЕЗА":"...","ТЕКСТ":"..."}] без markdown і пояснень.\n\nТЕКСТ:\n' + text
  );
}

function parseSlides(raw) {
  const m = raw.match(/\[[\s\S]*\]/); // JSON-масив, навіть якщо обгорнутий у ```json
  if (!m) throw new Error("Gemini повернув неочікуваний формат");
  return JSON.parse(m[0]).map((it) => ({
    ТЕЗА: String(it["ТЕЗА"] || "").trim(),
    ТЕКСТ: String(it["ТЕКСТ"] || "").trim(),
  }));
}

// повертає масив {ТЕЗА, ТЕКСТ}. key — ключ Gemini з localStorage.
export async function splitText(text, count, key) {
  key = (key || "").trim();
  if (!key) throw new Error("немає ключа Gemini");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const body = {
    contents: [{ parts: [{ text: splitPrompt(text, count) }] }],
    generationConfig: { temperature: 0.7, responseMimeType: "application/json" },
  };
  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    let msg = resp.status + "";
    try { const e = await resp.json(); msg = (e.error && e.error.message) || msg; } catch (er) {}
    throw new Error("Gemini: " + msg);
  }
  const data = await resp.json();
  const parts = ((data.candidates || [{}])[0].content || {}).parts || [];
  const raw = parts.map((p) => p.text || "").join("");
  return parseSlides(raw);
}
