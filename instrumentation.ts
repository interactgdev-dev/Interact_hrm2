/**
 * Keep this file free of Node-only imports (fs, path, child_process).
 * Real logic lives in lib/register-zkbio-cron.ts (import "server-only").
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { registerZkbioCron } = await import("./lib/register-zkbio-cron");
  registerZkbioCron();
}
