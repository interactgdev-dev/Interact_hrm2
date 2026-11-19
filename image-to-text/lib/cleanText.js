/**
 * Turns messy OCR into readable paragraphs.
 * Removes UI junk, broken symbols, and joins lines into normal text.
 */

/** Characters that are usually OCR noise from IDE / OS chrome */
const NOISE_CHARS = /[®©™§†‡•¤¢£¥¦¨ª«»¬¯°±²³´µ¶·¸¹º¼½¾¿×÷◊○●□■▪▫►◄▲▼◆◇★☆✓✗✘※‼‽‹›€™←→↑↓↔↕«»""''…–—]/g;

/** Whole-line patterns that are almost never real content */
const JUNK_LINE = [
  /^(file|edit|selection|view|go|run|terminal|help|window)\b/i,
  /^(type here to search)/i,
  /cursor tab/i,
  /agent stats/i,
  /tab stats/i,
  /^\s*nx!?\s*$/i,
  /^\s*[ coox]+\s*$/i,
  /undoal|keep\s*a[il]/i,
  /^\s*[\W\d_]{0,4}\s*$/,
  /^[\W_]{3,}$/,
];

function stripNoiseChars(text) {
  return text
    .replace(NOISE_CHARS, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g, " ");
}

function looksLikeJunkLine(line) {
  const t = line.trim();
  if (!t) return true;
  if (t.length <= 1) return true;

  // Too many weird fragments, too few letters
  const letters = (t.match(/[A-Za-z\u0600-\u06FF]/g) || []).length;
  const ratio = letters / t.length;
  if (t.length > 8 && ratio < 0.35) return true;

  return JUNK_LINE.some((re) => re.test(t));
}

function fixCommonOcrTypos(text) {
  return text
    .replace(/\bcalption\b/gi, "caption")
    .replace(/\bScreencaptureservice\b/gi, "ScreenCaptureService")
    .replace(/\bGusrdControllen\b/gi, "GuardController")
    .replace(/\bmmclient\b/gi, "MmmClient")
    .replace(/\bScreenshotCapturecnabled\b/gi, "ScreenshotCaptureEnabled")
    .replace(/\bUploadscreenshotAsync\b/gi, "UploadScreenshotAsync")
    .replace(/\binteract-him20\b/gi, "interact-hrm2.0")
    .replace(/\bNIERACT-HIRAE\b/gi, "interact-hrm2.0")
    .replace(/\bJsshole\b/gi, "asshole")
    .replace(/\bpomhub\b/gi, "pornhub")
    .replace(/\bfucka\b/gi, "fuck")
    .replace(/\bOFf\b/g, "Off")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([,.!?;:])([A-Za-z])/g, "$1 $2");
}

/**
 * @param {string} raw
 * @param {"raw"|"clean"|"paragraph"} mode
 */
function cleanOcrText(raw, mode = "paragraph") {
  if (!raw) return "";
  if (mode === "raw" || mode === "lines") {
    return String(raw)
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .filter((line) => line.length > 0)
      .join("\n")
      .trim();
  }

  let text = String(raw).replace(/\r\n/g, "\n");
  text = stripNoiseChars(text);

  let lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => !looksLikeJunkLine(l));

  // Drop near-duplicate consecutive lines
  const deduped = [];
  for (const line of lines) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.toLowerCase() === line.toLowerCase()) continue;
    deduped.push(line);
  }
  lines = deduped;

  text = lines.join("\n");
  text = fixCommonOcrTypos(text);

  if (mode === "clean") {
    return text.replace(/\n{3,}/g, "\n\n").trim();
  }

  // paragraph mode: join broken lines into flowing paragraphs
  const paragraphs = [];
  let buf = [];

  const flush = () => {
    if (!buf.length) return;
    let p = buf.join(" ");
    p = p.replace(/\s+/g, " ").trim();
    if (p) paragraphs.push(p);
    buf = [];
  };

  for (const line of lines) {
    const endsSentence = /[.!?:]$/.test(line);
    const looksHeading =
      line.length < 60 &&
      !/[.!?]$/.test(line) &&
      (/^[A-Z][\w ./-]+$/.test(line) || /feature|plan|agent|files/i.test(line));

    buf.push(line);
    if (endsSentence || looksHeading) flush();
  }
  flush();

  return paragraphs
    .map((p) => fixCommonOcrTypos(p))
    .join("\n\n")
    .trim();
}

module.exports = { cleanOcrText };
