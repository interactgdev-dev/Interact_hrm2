/**
 * Image → Text (OCR) with clean paragraph output
 *
 * Usage:
 *   node scan.js photo.png
 *   node scan.js photo.png --mode paragraph --out result.txt
 *   node scan.js ./folder --mode clean
 *   node scan.js photo.png --lang eng --mode raw
 */

const fs = require("fs");
const path = require("path");
const { loadEnvFile } = require("./lib/summarize");
const { scanImageBuffer } = require("./lib/scanImage");

const IMAGE_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".bmp",
  ".gif",
  ".tif",
  ".tiff",
]);

function parseArgs(argv) {
  const args = {
    input: null,
    out: null,
    lang: "eng",
    mode: "summary", // summary | raw | clean | paragraph
    help: false,
  };
  const rest = argv.slice(2);

  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--out" || a === "-o") args.out = rest[++i];
    else if (a === "--lang" || a === "-l") args.lang = rest[++i] || "eng";
    else if (a === "--mode" || a === "-m") args.mode = rest[++i] || "paragraph";
    else if (a === "--help" || a === "-h") args.help = true;
    else if (!a.startsWith("-") && !args.input) args.input = a;
  }
  return args;
}

function collectImages(inputPath) {
  const abs = path.resolve(inputPath);
  if (!fs.existsSync(abs)) throw new Error(`Path not found: ${abs}`);

  const stat = fs.statSync(abs);
  if (stat.isFile()) {
    if (!IMAGE_EXT.has(path.extname(abs).toLowerCase())) {
      throw new Error(`Not an image file: ${abs}`);
    }
    return [abs];
  }

  return fs
    .readdirSync(abs)
    .filter((name) => IMAGE_EXT.has(path.extname(name).toLowerCase()))
    .map((name) => path.join(abs, name))
    .sort();
}

function printHelp() {
  console.log(`
Image → Text — scan images into readable paragraphs

  node scan.js <image-or-folder>
  node scan.js photo.png --out result.txt
  node scan.js photo.png --mode summary
  node scan.js photo.png --mode paragraph
  node scan.js photo.png --mode clean
  node scan.js photo.png --mode raw

Modes:
  summary     Readable English paragraphs via Gemini/OpenAI (default)
  paragraph   OCR cleaned into paragraphs
  clean       OCR junk removed, line breaks kept
  raw         Exact OCR, no cleaning

For summary mode, put GEMINI_API_KEY in .env (free: https://aistudio.google.com/apikey)
`);
}

function resolveOutPath(out, imagePath, isBatch) {
  const absOut = path.resolve(out);
  if (isBatch) {
    const base = path.basename(imagePath, path.extname(imagePath)) + ".txt";
    if (path.extname(absOut).toLowerCase() === ".txt") {
      return path.join(path.dirname(absOut), base);
    }
    return path.join(absOut, base);
  }
  return absOut;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.input) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  if (!["summary", "raw", "clean", "paragraph"].includes(args.mode)) {
    console.error("Mode must be: summary | raw | clean | paragraph");
    process.exit(1);
  }

  const images = collectImages(args.input);
  if (!images.length) {
    console.error("No image files found.");
    process.exit(1);
  }

  loadEnvFile();
  console.log(
    `Scanning ${images.length} image(s) | lang=${args.lang} | mode=${args.mode}`,
  );

  for (const imagePath of images) {
    const name = path.basename(imagePath);
    process.stdout.write(`→ ${name} ... `);
    const buf = fs.readFileSync(imagePath);
    const scanned = await scanImageBuffer(buf, name, {
      mode: args.mode,
      lang: args.lang,
    });
    console.log(`done (${scanned.provider})`);
    const text = scanned.text || "(no readable text found)";
    if (args.out) {
      const outPath = resolveOutPath(args.out, imagePath, images.length > 1);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, text + "\n", "utf8");
      console.log(`  saved: ${outPath}`);
    } else {
      console.log("\n----- TEXT START -----\n" + text + "\n----- TEXT END -------\n");
    }
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
