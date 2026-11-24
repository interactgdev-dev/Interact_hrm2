/**
 * Browser-side resize/compress for profile DPs so any phone/camera photo
 * (any size, any browser-decodable type) uploads under the reverse-proxy
 * body limit (~1 MB nginx default) without asking the user to shrink files.
 */

const MAX_EDGE = 1280;
const TARGET_BYTES = 700 * 1024;
const QUALITIES = [0.88, 0.8, 0.72, 0.64, 0.55, 0.45];

function loadBitmap(file: File): Promise<ImageBitmap> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file);
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth || img.width;
      c.height = img.naturalHeight || img.height;
      const ctx = c.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read image"));
        return;
      }
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      createImageBitmap(c).then(resolve, reject);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unsupported or corrupt image"));
    };
    img.src = url;
  });
}

function toJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("Could not encode image"));
        else resolve(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

function baseName(file: File): string {
  const raw = (file.name || "photo").replace(/\.[^.]+$/, "");
  return (raw || "photo").slice(0, 80);
}

/**
 * Returns a JPEG File suitable for avatar upload. Always re-encodes so
 * HEIC/PNG/BMP/WebP/GIF/etc. that the browser can decode become a small JPEG.
 */
export async function compressProfileImage(file: File): Promise<File> {
  if (!(file instanceof File) || file.size <= 0) {
    throw new Error("Please choose a valid image file");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await loadBitmap(file);
  } catch {
    throw new Error(
      "This image type could not be read. Try JPG, PNG, WEBP, or GIF.",
    );
  }

  try {
    const srcW = bitmap.width || 1;
    const srcH = bitmap.height || 1;
    let edge = MAX_EDGE;
    let blob: Blob | null = null;

    for (let pass = 0; pass < 5; pass++) {
      const scale = Math.min(1, edge / Math.max(srcW, srcH));
      const w = Math.max(1, Math.round(srcW * scale));
      const h = Math.max(1, Math.round(srcH * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not process image");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);

      blob = null;
      for (const q of QUALITIES) {
        const candidate = await toJpegBlob(canvas, q);
        blob = candidate;
        if (candidate.size <= TARGET_BYTES) break;
      }
      if (blob && blob.size <= TARGET_BYTES) break;
      edge = Math.max(320, Math.round(edge * 0.65));
    }

    if (!blob) throw new Error("Could not encode image");

    return new File([blob], `${baseName(file)}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } finally {
    bitmap.close?.();
  }
}
