import "server-only";

import { sweepGuardScreenshotRetention } from "@/lib/guard-screenshot-retention";

/**
 * Hourly (default) purge of old Guard screenshots + backlog file copies
 * so staging/production disks never fill from continuous captures.
 */
export function registerGuardScreenshotRetentionCron(): void {
  if (
    process.env.GUARD_SS_RETENTION_ENABLED === "false" ||
    process.env.GUARD_SS_RETENTION_ENABLED === "0"
  ) {
    console.log(
      "[guard-ss-retention] Off (GUARD_SS_RETENTION_ENABLED=false).",
    );
    return;
  }

  const parsed = Number(
    process.env.GUARD_SS_RETENTION_INTERVAL_MS ?? 60 * 60 * 1000,
  );
  const intervalMs =
    Number.isFinite(parsed) && parsed >= 5 * 60 * 1000
      ? parsed
      : 60 * 60 * 1000;

  const g = globalThis as typeof globalThis & {
    __guardSsRetentionInterval?: ReturnType<typeof setInterval>;
  };
  if (g.__guardSsRetentionInterval) return;

  const tick = () => {
    sweepGuardScreenshotRetention()
      .then((r) => {
        if (r.deletedFiles > 0) {
          console.log(
            `[guard-ss-retention] deleted ${r.deletedFiles} file(s) (${Math.round(r.deletedBytes / 1024 / 1024)} MB) · kept≈${r.keptFiles} · free=${r.freeMb ?? "?"} MB · memAvail=${r.memAvailableMb ?? "?"} MB`,
          );
        }
      })
      .catch((e) => {
        console.error("[guard-ss-retention] Sweep failed:", e);
      });
  };

  g.__guardSsRetentionInterval = setInterval(tick, intervalMs);
  console.log(
    `[guard-ss-retention] Auto-purge every ${Math.round(intervalMs / 60000)} min (age + size caps).`,
  );
  setTimeout(tick, 20_000);
}
