/**
 * Backend-only TEST/SIMULATION for keyboard pipeline (no OS hook, no real keys).
 * Usage:
 *   node scripts/test-keyboard-pipeline-sim.mjs [baseUrl] [employeeId]
 * Example:
 *   node scripts/test-keyboard-pipeline-sim.mjs https://192.168.10.6:8443 1
 */
import assert from "node:assert/strict";

const TOKENS = ["w", "a", "q", "a", "s", "[space]", "r", "a", "f", "i", "q"];
const base = (process.argv[2] || "http://127.0.0.1:3000").replace(/\/$/, "");
const employeeId = String(process.argv[3] || "1").trim();

const periodStart = new Date();
const events = TOKENS.map((token, ord) => ({
  ord,
  token,
  captured_at: new Date(periodStart.getTime() + ord * 80).toISOString(),
  app_name: "InteractGuard.SIMULATION",
  window_title: "TEST / SIMULATION — synthetic keyboard pipeline",
}));
const periodEnd = new Date(periodStart.getTime() + (TOKENS.length - 1) * 80);
const batchId = `sim-script-${Date.now()}`;

const payload = {
  is_simulation: true,
  mode: "TEST_SIMULATION",
  batch_id: batchId,
  employee_id: employeeId,
  employee_name: "Sim Test",
  period_start: periodStart.toISOString(),
  period_end: periodEnd.toISOString(),
  segments: [
    {
      app_name: "InteractGuard.SIMULATION",
      key_down_count: TOKENS.length,
      typing_active_ms: (TOKENS.length - 1) * 80,
      keyboard_idle_ms: 0,
      simulation_events: events,
      simulation_sequence: TOKENS.join(" → "),
    },
  ],
};

// Order preserved
assert.deepEqual(
  events.map((e) => e.token),
  TOKENS
);

const res = await fetch(`${base}/api/guard/keyboard-activity`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});
const data = await res.json().catch(() => ({}));
if (!res.ok || !data.success) {
  console.error("FAIL", res.status, data);
  process.exit(1);
}
console.log("ok — simulation posted", {
  batchId,
  inserted: data.inserted,
  sequence: TOKENS.join(" → "),
});
console.log(
  "Check Admin → Guard Screenshots → Keyboard activity (filter TEST/SIM only)."
);
