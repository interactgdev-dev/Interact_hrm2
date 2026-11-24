type ReadImageOptions = {
  /** Longest side is scaled down to at most this many px (never upscaled). */
  maxDim?: number;
  /** Always output JPEG (drops transparency) — good for photo avatars. */
  forceJpeg?: boolean;
  /** JPEG/WEBP quality 0..1. */
  quality?: number;
};

/**
 * Reads an image file and returns a (usually downscaled + compressed) data URL.
 *
 * Full-size photos as base64 can exceed MySQL's max_allowed_packet and fail to
 * save, so we resize on the client. Falls back to the original data URL if the
 * browser canvas is unavailable or anything goes wrong.
 */
export function readImageFileAsDataUrl(
  file: File,
  opts: ReadImageOptions = {},
): Promise<string> {
  const { maxDim = 1024, forceJpeg = false, quality = 0.85 } = opts;

  return new Promise((resolve, reject) => {
    const mime = (file.type || "").toLowerCase();
    const looksImage =
      mime.startsWith("image/") ||
      /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)$/i.test(file.name || "");
    if (!looksImage) {
      reject(new Error("Please choose an image file."));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.onload = () => {
      const original = typeof reader.result === "string" ? reader.result : "";
      if (!original) {
        reject(new Error("Could not read image."));
        return;
      }

      if (typeof document === "undefined") {
        resolve(original);
        return;
      }

      const img = new Image();
      img.onload = () => {
        try {
          const srcW = img.naturalWidth || img.width;
          const srcH = img.naturalHeight || img.height;
          const scale = Math.min(1, maxDim / Math.max(srcW, srcH || 1));

          // Already small enough and no format change requested — keep original.
          if (scale >= 1 && !forceJpeg) {
            resolve(original);
            return;
          }

          const w = Math.max(1, Math.round(srcW * scale));
          const h = Math.max(1, Math.round(srcH * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(original);
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);

          const outMime = forceJpeg
            ? "image/jpeg"
            : mime === "image/webp"
              ? "image/webp"
              : mime === "image/jpeg" || mime === "image/jpg"
                ? "image/jpeg"
                : "image/png";
          const out =
            outMime === "image/png"
              ? canvas.toDataURL("image/png")
              : canvas.toDataURL(outMime, quality);
          resolve(out || original);
        } catch {
          resolve(original);
        }
      };
      img.onerror = () => resolve(original);
      img.src = original;
    };
    reader.readAsDataURL(file);
  });
}
