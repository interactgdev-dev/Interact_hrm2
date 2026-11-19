/**
 * Shared scan used by the standalone tool and Interact HRM screenshot cards.
 * summary = vision paragraphs (Gemini/OpenAI). Other modes = local Tesseract OCR.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { cleanOcrText } = require("./cleanText");
const { summarizeImage, loadEnvFile } = require("./summarize");

const MODES = new Set(["summary", "raw", "clean", "paragraph", "lines"]);
const TESSDATA = path.join(__dirname, "..", "tessdata");
const TESS_CACHE = path.join(process.cwd(), "uploads", "tesseract-cache");

/** Full screenshots are multi‑MB PNGs. Shrink so the vision call returns inside the proxy timeout. */
async function shrinkForSummary(data, filename) {
  try {
    const sharp = require("sharp");
    const out = await sharp(data, { failOn: "none", limitInputPixels: 80_000_000 })
      .rotate()
      .resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 42 })
      .toBuffer();
    return { data: out, filename: "scan.jpg" };
  } catch {
    return { data, filename };
  }
}

async function prepareForOcr(data) {
  try {
    const sharp = require("sharp");
    // Upscale small / dark UI screenshots so short slang (BC) and URLs OCR better.
    return await sharp(data, { failOn: "none", limitInputPixels: 80_000_000 })
      .rotate()
      .resize({
        width: 2200,
        height: 2200,
        fit: "inside",
        withoutEnlargement: false,
      })
      .grayscale()
      .normalize()
      .sharpen({ sigma: 1.1 })
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch {
    return data;
  }
}

async function ocrBuffer(data, filename, lang, mode) {
  const { createWorker } = require("tesseract.js");
  fs.mkdirSync(TESS_CACHE, { recursive: true });
  const worker = await createWorker(lang, 1, {
    logger: () => {},
    cachePath: TESS_CACHE,
    langPath: TESSDATA,
    gzip: false,
  });
  const image = await prepareForOcr(data);
  const tmpFile = path.join(
    os.tmpdir(),
    `hrm-i2t-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`,
  );
  try {
    fs.writeFileSync(tmpFile, image);
    await worker.setParameters({
      tessedit_pageseg_mode: "6",
      preserve_interword_spaces: "1",
    });
    const {
      data: { text },
    } = await worker.recognize(tmpFile);
    return cleanOcrText(text, mode);
  } finally {
    await worker.terminate();
    fs.unlink(tmpFile, () => {});
  }
}

/**
 * @param {Buffer} data
 * @param {string} filename
 * @param {{ mode?: string, lang?: string, fallbackToOcr?: boolean }} [opts]
 * @returns {Promise<{ text: string, mode: string, provider: string, note?: string }>}
 */
async function scanImageBuffer(data, filename, opts = {}) {
  loadEnvFile();
  const requested = MODES.has(opts.mode) ? opts.mode : "summary";
  const lang = String(opts.lang || "eng").trim() || "eng";

  if (requested === "summary") {
    try {
      const prepared = await shrinkForSummary(data, filename);
      const { text, provider } = await summarizeImage(prepared.data, prepared.filename);
      return { text, mode: "summary", provider };
    } catch (err) {
      if (!opts.fallbackToOcr) throw err;
      const text = await ocrBuffer(data, filename, lang, "paragraph");
      return {
        text,
        mode: "paragraph",
        provider: "tesseract",
        note: err && err.message ? err.message : String(err),
      };
    }
  }

  const text = await ocrBuffer(data, filename, lang, requested);
  return { text, mode: requested, provider: "tesseract" };
}

module.exports = { scanImageBuffer };
