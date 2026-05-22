import "server-only";

import { existsSync } from "fs";
import path from "path";
import { runZkbioSync } from "@/lib/zkbio-sync-runner";

/**
 * Starts the 30-minute ZKBio → MySQL interval. Node-only (not Edge).
 */
export function registerZkbioCron(): void {
  if (process.env.ZKBIO_SYNC_AUTO_ENABLED === "false" || process.env.ZKBIO_SYNC_AUTO_ENABLED === "0") {
    console.log("[zkbio-sync] Auto sync off (ZKBIO_SYNC_AUTO_ENABLED=false).");
    return;
  }

  const root = process.cwd();
  const pyScript = path.join(root, "scripts", "zkbio_sync_punches.py");
  const localEnv = path.join(root, "scripts", "zkbio-sync.local.env");
  if (!existsSync(pyScript) || !existsSync(localEnv)) {
    console.log(
      "[zkbio-sync] Auto sync skipped (add scripts/zkbio-sync.local.env + zkbio_sync_punches.py to enable).",
    );
    return;
  }

  const parsed = Number(process.env.ZKBIO_SYNC_AUTO_INTERVAL_MS ?? 30 * 60 * 1000);
  const intervalMs = Number.isFinite(parsed) && parsed >= 60_000 ? parsed : 30 * 60 * 1000;

  const g = globalThis as typeof globalThis & { __zkbioSyncInterval?: ReturnType<typeof setInterval> };
  if (g.__zkbioSyncInterval) return;

  const ts = () =>
    new Date().toLocaleString("en-GB", {
      timeZone: process.env.TZ || "Asia/Karachi",
      hour12: true,
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  const tick = () => {
    const started = ts();
    console.log(`[zkbio-sync] ▶ ${started} — sync started (ZKBio → MySQL zkbio_punch_log)`);

    runZkbioSync()
      .then((r) => {
        const ended = ts();
        if (r.code === 0) {
          const out = r.stdout || "";
          const inserted = out.match(/inserted\s+(\d+)\s+new/i);
          const fetched = out.match(/Fetched\s+(\d+)\s+row/i);
          const windowLine = out
            .split("\n")
            .map((l) => l.trim())
            .find((l) => l.includes("ZKBio sync ("));
          const summary = inserted
            ? `Fetched ${fetched?.[1] ?? "?"} from API, inserted ${inserted[1]} new`
            : out
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean)
                .slice(-1)[0] || "done";
          console.log(`[zkbio-sync] ✓ ${ended} — finished OK — ${summary}`);
          if (windowLine) console.log(`[zkbio-sync]   ${windowLine}`);
          if (!inserted || Number(inserted[1]) === 0) {
            const hints = (r.stderr || "")
              .split("\n")
              .map((l) => l.trim())
              .filter((l) => l.startsWith("Hint:"));
            hints.forEach((h) => console.warn(`[zkbio-sync]   ${h}`));
          }
        } else {
          console.error(
            `[zkbio-sync] ✗ ${ended} — FAILED exit=${r.code}`,
            (r.stderr || "").trim().slice(-800) || "(no stderr)",
          );
        }
      })
      .catch((e) => {
        console.error(`[zkbio-sync] ✗ ${ts()} — error`, e);
      });
  };

  g.__zkbioSyncInterval = setInterval(tick, intervalMs);
  console.log(
    `[zkbio-sync] Auto-run every ${intervalMs / 60000} min → ZKBio → DB (while Next.js server is running).`,
  );

  setTimeout(tick, 15_000);
}
