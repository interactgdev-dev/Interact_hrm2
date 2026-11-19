/**
 * Lightweight unit checks for keyboard-activity validation helpers.
 * Run: node scripts/test-guard-keyboard-activity.mjs
 */
import assert from "node:assert/strict";

const FORBIDDEN = [
  "text",
  "typed_text",
  "typedText",
  "keys",
  "keystrokes",
  "key_codes",
  "keyCodes",
  "vk_codes",
  "vkCodes",
  "characters",
  "clipboard",
  "password",
  "passwords",
  "message",
  "messages",
  "content",
];

function findForbiddenKeyboardFields(body) {
  const hit = [];
  for (const key of FORBIDDEN) {
    if (Object.prototype.hasOwnProperty.call(body, key) && body[key] != null) {
      hit.push(key);
    }
  }
  for (const seg of Array.isArray(body.segments) ? body.segments : []) {
    if (!seg || typeof seg !== "object") continue;
    for (const key of FORBIDDEN) {
      if (Object.prototype.hasOwnProperty.call(seg, key) && seg[key] != null) {
        hit.push(`segments[].${key}`);
      }
    }
  }
  return [...new Set(hit)];
}

function clampUint(n, max = 86_400_000) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.min(max, v);
}

// Clean metrics payload
assert.deepEqual(
  findForbiddenKeyboardFields({
    employee_id: "1",
    batch_id: "abc",
    segments: [{ app_name: "chrome.exe", key_down_count: 12 }],
  }),
  []
);

// Reject typed text at root
assert.ok(findForbiddenKeyboardFields({ text: "hello" }).includes("text"));
assert.ok(
  findForbiddenKeyboardFields({ keystrokes: ["a"] }).includes("keystrokes")
);
assert.ok(
  findForbiddenKeyboardFields({
    segments: [{ app_name: "x", clipboard: "secret" }],
  }).some((x) => x.includes("clipboard"))
);

assert.equal(clampUint(-5), 0);
assert.equal(clampUint(1.9), 1);
assert.equal(clampUint(999_999_999), 86_400_000);

console.log("ok — guard-keyboard-activity validation checks passed");
