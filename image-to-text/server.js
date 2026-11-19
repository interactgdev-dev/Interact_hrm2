/**
 * Local web UI for Image → Text (clean paragraphs by default).
 * Open http://localhost:3847 after: npm start
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { loadEnvFile } = require("./lib/summarize");
const { scanImageBuffer } = require("./lib/scanImage");

loadEnvFile();

const PORT = Number(process.env.PORT) || 3847;
const PUBLIC = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipart(buffer, boundary) {
  const sep = Buffer.from(`--${boundary}`);
  let start = buffer.indexOf(sep) + sep.length;
  if (buffer[start] === 13 && buffer[start + 1] === 10) start += 2;

  const headerEnd = buffer.indexOf("\r\n\r\n", start);
  if (headerEnd < 0) throw new Error("Invalid multipart body");
  const headers = buffer.slice(start, headerEnd).toString("utf8");
  const nameMatch = /filename="([^"]+)"/i.exec(headers);
  const filename = nameMatch ? nameMatch[1] : "upload.png";

  let dataStart = headerEnd + 4;
  let dataEnd = buffer.indexOf(sep, dataStart);
  if (dataEnd < 0) dataEnd = buffer.length;
  if (buffer[dataEnd - 2] === 13 && buffer[dataEnd - 1] === 10) dataEnd -= 2;

  return { filename, data: buffer.slice(dataStart, dataEnd) };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      return send(res, 200, fs.readFileSync(path.join(PUBLIC, "index.html")), MIME[".html"]);
    }

    if (req.method === "GET" && req.url.startsWith("/")) {
      const safe = path.normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
      const filePath = path.join(PUBLIC, safe);
      if (!filePath.startsWith(PUBLIC) || !fs.existsSync(filePath)) {
        return send(res, 404, "Not found");
      }
      const ext = path.extname(filePath).toLowerCase();
      return send(res, 200, fs.readFileSync(filePath), MIME[ext] || "application/octet-stream");
    }

    if (req.method === "POST" && req.url === "/api/ocr") {
      const contentType = req.headers["content-type"] || "";
      const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
      if (!match) {
        return send(
          res,
          400,
          JSON.stringify({ ok: false, error: "Expected multipart form" }),
          "application/json",
        );
      }

      const boundary = match[1] || match[2];
      const raw = await readBody(req);
      const { filename, data } = parseMultipart(raw, boundary);
      const lang =
        (typeof req.headers["x-ocr-lang"] === "string" &&
          req.headers["x-ocr-lang"].trim()) ||
        "eng";
      const modeRaw =
        (typeof req.headers["x-ocr-mode"] === "string" &&
          req.headers["x-ocr-mode"].trim()) ||
        "summary";
      const mode = ["summary", "raw", "clean", "paragraph"].includes(modeRaw)
        ? modeRaw
        : "summary";

      const scanned = await scanImageBuffer(data, filename, { mode, lang });
      return send(
        res,
        200,
        JSON.stringify({
          ok: true,
          filename,
          mode: scanned.mode,
          provider: scanned.provider,
          text: scanned.text,
        }),
        "application/json",
      );
    }

    send(res, 404, "Not found");
  } catch (err) {
    send(
      res,
      500,
      JSON.stringify({ ok: false, error: err.message || String(err) }),
      "application/json",
    );
  }
});

server.listen(PORT, () => {
  console.log(`Image → Text UI: http://localhost:${PORT}`);
  console.log('Default mode: "Readable summary" (needs GEMINI_API_KEY or OPENAI_API_KEY in .env)');
});
