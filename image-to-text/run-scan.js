/**
 * One screenshot scan in its own process.
 * A crash here must not take down the HRM server.
 *
 *   node run-scan.js /absolute/path/to/image.jpg
 * Prints one JSON object to stdout.
 */

const fs = require("fs");
const path = require("path");
const { scanImageBuffer } = require("./lib/scanImage");

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("image path required");
  const buf = fs.readFileSync(file);
  const scanned = await scanImageBuffer(buf, path.basename(file), {
    mode: "lines",
    lang: "eng",
  });
  process.stdout.write(
    JSON.stringify({
      ok: true,
      text: scanned.text || "",
      mode: scanned.mode || "lines",
      provider: scanned.provider || "tesseract",
    }),
  );
}

main().catch((err) => {
  const msg = String((err && err.message) || err || "Scan failed")
    .replace(/key=[^&\s]+/gi, "key=redacted")
    .slice(0, 300);
  process.stdout.write(JSON.stringify({ ok: false, error: msg }));
});
