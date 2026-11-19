/**
 * Readable screenshot summary using a vision model (Gemini or OpenAI).
 * Plain OCR cannot write clean paragraphs from busy IDE screenshots —
 * this sends the image to a vision API and asks for simple English.
 */

const fs = require("fs");
const path = require("path");

const SUMMARY_PROMPT = `What is on this screenshot? Reply in 2 or 3 short sentences of plain English. Skip menus, icons, and window chrome. Do not invent details.`;

function loadEnvFile() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

async function geminiGenerate(url, imagePart, generationConfig) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(25000),
      body: JSON.stringify({
        contents: [{ parts: [{ text: SUMMARY_PROMPT }, imagePart] }],
        generationConfig,
      }),
    });
  } catch (err) {
    if (err && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error("Scan timed out before a summary came back. Try again.");
    }
    throw err;
  }

  const json = await res.json();
  if (!res.ok) {
    const msg = json.error?.message || "Gemini request failed";
    throw new Error(`Gemini error: ${String(msg).slice(0, 240)}`);
  }
  return json;
}

function mimeFromName(filename) {
  const ext = path.extname(filename || "").toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

async function summarizeWithGemini(imageBuffer, mimeType) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

  const imagePart = {
    inline_data: {
      mime_type: mimeType,
      data: imageBuffer.toString("base64"),
    },
  };
  const fastConfig = {
    temperature: 0.2,
    maxOutputTokens: 160,
    mediaResolution: "MEDIA_RESOLUTION_LOW",
    thinkingConfig: { thinkingBudget: 0 },
  };

  let json;
  try {
    json = await geminiGenerate(url, imagePart, fastConfig);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/thinking|mediaResolution|thinkingBudget|Unknown name/i.test(msg)) throw err;
    json = await geminiGenerate(url, imagePart, {
      temperature: 0.2,
      maxOutputTokens: 160,
    });
  }

  const text = json.candidates?.[0]?.content?.parts
    ?.filter((p) => p && !p.thought)
    ?.map((p) => p.text || "")
    .join("\n")
    .trim();

  if (!text) throw new Error("Gemini returned empty summary");
  return text;
}

async function summarizeWithOpenAI(imageBuffer, mimeType) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const dataUrl = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: SUMMARY_PROMPT },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      temperature: 0.2,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    const msg = json.error?.message || JSON.stringify(json);
    throw new Error(`OpenAI error: ${msg}`);
  }

  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("OpenAI returned empty summary");
  return text;
}

/**
 * @returns {Promise<{ text: string, provider: string }>}
 */
async function summarizeImage(imageBuffer, filename = "image.png") {
  loadEnvFile();
  const mimeType = mimeFromName(filename);

  if (process.env.GEMINI_API_KEY) {
    const text = await summarizeWithGemini(imageBuffer, mimeType);
    return { text, provider: "gemini" };
  }

  if (process.env.OPENAI_API_KEY) {
    const text = await summarizeWithOpenAI(imageBuffer, mimeType);
    return { text, provider: "openai" };
  }

  throw new Error(
    "Readable summary needs an API key. Create a .env file with GEMINI_API_KEY=... (free from Google AI Studio) or OPENAI_API_KEY=...",
  );
}

module.exports = { summarizeImage, loadEnvFile };
