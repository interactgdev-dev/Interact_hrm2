import {
  enforcePolicyAfterOcr,
  type KeywordAlertInput,
} from "@/lib/guard-keyword-watch";
import { getMemAvailableMb } from "@/lib/guard-screenshot-retention";

/**
 * Upload-first ingest: keep HRM up under screenshot load.
 *
 * - Upload path is cheap (disk write only) and hard-capped for concurrency.
 * - OCR never runs while an upload is in flight (prevents 2GB RAM thrash).
 * - OCR skipped / queue drained when memory is low.
 */

/** Simultaneous uploads into Node (keep low on small VMs). */
const MAX_UPLOAD_INFLIGHT = Number(
  process.env.GUARD_SS_MAX_UPLOAD_INFLIGHT || 2,
);

const MAX_OCR_INFLIGHT = Number(process.env.GUARD_SS_MAX_OCR_INFLIGHT || 1);
const MAX_OCR_QUEUE = Number(process.env.GUARD_SS_MAX_OCR_QUEUE || 5);
const OCR_MIN_MEM_MB = Number(process.env.GUARD_SS_OCR_MIN_MEM_MB || 550);
const OCR_MIN_GAP_MS = Number(process.env.GUARD_SS_OCR_MIN_GAP_MS || 45_000);
/** After last upload finishes, wait before OCR (ms). */
const OCR_AFTER_UPLOAD_MS = Number(
  process.env.GUARD_SS_OCR_AFTER_UPLOAD_MS || 5_000,
);

let uploadInflight = 0;
let ocrInflight = 0;
let lastOcrStartedAt = 0;
let ocrResumeTimer: ReturnType<typeof setTimeout> | null = null;
const ocrQueue: KeywordAlertInput[] = [];

function ocrEnabled(): boolean {
  const v = String(process.env.GUARD_SS_OCR_ENABLED || "true").toLowerCase();
  return v !== "0" && v !== "false" && v !== "off";
}

export function tryBeginScreenshotUpload(): boolean {
  const cap = Math.max(1, Math.min(8, MAX_UPLOAD_INFLIGHT || 2));
  if (uploadInflight >= cap) return false;
  uploadInflight += 1;
  // Pause OCR immediately while uploads are active.
  if (ocrResumeTimer) {
    clearTimeout(ocrResumeTimer);
    ocrResumeTimer = null;
  }
  return true;
}

export function endScreenshotUpload(): void {
  uploadInflight = Math.max(0, uploadInflight - 1);
  if (uploadInflight === 0 && ocrEnabled() && ocrQueue.length > 0) {
    if (ocrResumeTimer) clearTimeout(ocrResumeTimer);
    ocrResumeTimer = setTimeout(() => {
      ocrResumeTimer = null;
      pumpOcrQueue();
    }, Math.max(1000, OCR_AFTER_UPLOAD_MS));
  }
}

/**
 * Queue policy OCR after the file is already on disk.
 * Never blocks the upload HTTP response; never runs during uploads.
 */
export function enqueueScreenshotPolicyScan(job: KeywordAlertInput): void {
  if (!ocrEnabled()) return;
  const cap = Math.max(1, Math.min(40, MAX_OCR_QUEUE || 5));
  if (ocrQueue.length >= cap) {
    ocrQueue.shift();
  }
  ocrQueue.push(job);
  // Do not pump while uploads are active — schedule after quiet period.
  if (uploadInflight > 0) return;
  if (ocrResumeTimer) clearTimeout(ocrResumeTimer);
  ocrResumeTimer = setTimeout(() => {
    ocrResumeTimer = null;
    pumpOcrQueue();
  }, Math.max(500, OCR_AFTER_UPLOAD_MS));
}

function drainOcrQueue(reason: string) {
  if (ocrQueue.length === 0) return;
  console.warn(
    `[guard-ss-ingest] OCR queue drained (${ocrQueue.length}) — ${reason}`,
  );
  ocrQueue.length = 0;
}

function pumpOcrQueue(): void {
  if (!ocrEnabled()) {
    drainOcrQueue("OCR disabled");
    return;
  }
  // Critical: never compete with live screenshot uploads.
  if (uploadInflight > 0) return;

  const parallel = Math.max(1, Math.min(1, MAX_OCR_INFLIGHT || 1));
  while (ocrInflight < parallel && ocrQueue.length > 0) {
    if (uploadInflight > 0) return;

    const now = Date.now();
    if (lastOcrStartedAt > 0 && now - lastOcrStartedAt < OCR_MIN_GAP_MS) {
      const wait = OCR_MIN_GAP_MS - (now - lastOcrStartedAt);
      setTimeout(() => pumpOcrQueue(), Math.max(1000, wait));
      break;
    }

    const job = ocrQueue.shift();
    if (!job) break;

    ocrInflight += 1;
    lastOcrStartedAt = Date.now();

    void (async () => {
      try {
        if (uploadInflight > 0) {
          // Re-queue and wait for quiet period.
          ocrQueue.unshift(job);
          return;
        }
        const mem = await getMemAvailableMb();
        if (mem != null && mem < OCR_MIN_MEM_MB) {
          drainOcrQueue(`low memory (${mem} MB)`);
          return;
        }
        const result = await enforcePolicyAfterOcr(job);
        if (!result.ok) {
          console.warn("[guard-ss-ingest] policy check failed:", result.error);
          return;
        }
        if (!result.skipped) {
          console.log(
            "[guard-ss-ingest] policy ticket",
            result.ticketNumber,
            result.matched,
          );
        }
      } catch (err) {
        console.warn("[guard-ss-ingest] policy queue error:", err);
      } finally {
        ocrInflight = Math.max(0, ocrInflight - 1);
        if (uploadInflight === 0) pumpOcrQueue();
      }
    })();
  }
}

export function getScreenshotIngestStats() {
  return {
    uploadInflight,
    ocrInflight,
    ocrQueued: ocrQueue.length,
    maxUploadInflight: MAX_UPLOAD_INFLIGHT,
    maxOcrInflight: MAX_OCR_INFLIGHT,
    maxOcrQueue: MAX_OCR_QUEUE,
    ocrEnabled: ocrEnabled(),
  };
}
