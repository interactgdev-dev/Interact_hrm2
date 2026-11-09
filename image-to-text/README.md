# Image → Text

This folder lives inside Interact HRM. Screenshot cards on Presence / Idle call `lib/scanImage.js` through `/api/admin/guard-screenshots/image-to-text`. The standalone UI below still runs on its own port.

For busy screenshots (Cursor, VS Code, browsers), use **Readable summary** — clear English paragraphs, not OCR junk.

## 1) Add a free API key (for Readable summary)

1. Get a key: https://aistudio.google.com/apikey  
2. In this folder create `.env`:

```env
GEMINI_API_KEY=your_key_here
```

(Or use `OPENAI_API_KEY` instead.)

## 2) Run

```bash
cd "C:\Users\Waqas Rafique\image-to-text"
npm install
npm run dev
```

Open http://localhost:3847  
Mode: **Readable summary (recommended)** → drop image.

## Why OCR looked broken

Normal OCR reads every pixel (menus, icons, file tree). That becomes symbols and garbage.  
**Readable summary** looks at the whole image and explains it in paragraphs — like the example you wanted.

## CLI

```bash
node scan.js photo.png --mode summary --out result.txt
node scan.js photo.png --mode paragraph
```
