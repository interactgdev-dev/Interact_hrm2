import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import path from "node:path";
import { pool } from "@/lib/db";
import { ensureAdminSettingsTable } from "@/lib/admin-settings";
import {
  EMPLOYEE_TICKETS_TABLE,
  buildTicketNumber,
  ensureEmployeeTicketsTable,
  rowToTicket,
} from "@/lib/employee-tickets-table";
import { broadcastWsEvent } from "@/lib/ws-broadcast";
import { getEmployeePseudonym } from "@/lib/ticket-employee-meta";
import { seedEmployeeMessage } from "@/lib/ticket-thread";
import { getLatestAppActivity } from "@/lib/guard-app-activity";
import { formatDateTimeInServerTz } from "@/lib/timezone";

const require = createRequire(path.join(process.cwd(), "package.json"));
const { cleanOcrText } = require(path.join(
  process.cwd(),
  "image-to-text",
  "lib",
  "cleanText.js"
)) as { cleanOcrText: (raw: string, mode?: string) => string };

function clearEvidenceText(raw: string): string {
  const cleaned = cleanOcrText(String(raw || ""), "clean");
  return (cleaned || String(raw || ""))
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 2500);
}

const TABLE = "hrm_admin_settings";
const KEY_ENABLED = "guard_keyword_watch_enabled";
const KEY_KEYWORDS = "guard_keyword_watch_keywords";
const KEY_WEBSITES = "guard_policy_websites";
const KEY_APPS = "guard_policy_apps";
const KEY_UPLOADS = "guard_policy_uploads";
const KEY_DEDUP = "guard_keyword_watch_dedup_minutes";

export const GUARD_KEYWORD_TICKET_TYPE = "guard_policy_alert";

export type GuardPolicyKind = "keyword" | "website" | "app" | "upload";

/** Starter OCR / language list — editable in Guard Policy tab. */
export const DEFAULT_GUARD_KEYWORDS = [
  "fuck",
  "fucking",
  "shit",
  "bitch",
  "bastard",
  "asshole",
  "idiot",
  "stupid",
  "porn",
  "pornhub",
  "xxx",
  "nude",
  "nudes",
  "sex video",
  "onlyfans",
  "hentai",
  "xvideos",
  "xnxx",
  "adult video",
  "harassment",
];

export const DEFAULT_GUARD_WEBSITES = [
  "pornhub.com",
  "xvideos.com",
  "xnxx.com",
  "xhamster.com",
  "onlyfans.com",
  "chaturbate.com",
  "redtube.com",
];

export const DEFAULT_GUARD_APPS: string[] = [];

export const DEFAULT_GUARD_UPLOADS = [
  ".torrent",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".zip",
  ".rar",
  "upload files",
  "open file",
  "choose file",
  "select files to upload",
];

export type GuardKeywordWatchSettings = {
  enabled: boolean;
  keywords: string[];
  websites: string[];
  apps: string[];
  uploads: string[];
  dedupMinutes: number;
};

async function getRaw(key: string): Promise<string | null> {
  await ensureAdminSettingsTable();
  const [rows] = await pool.execute(
    `SELECT setting_value FROM ${TABLE} WHERE setting_key = ? LIMIT 1`,
    [key]
  );
  const list = rows as { setting_value: string }[];
  return list[0]?.setting_value ?? null;
}

async function setRaw(key: string, value: string): Promise<void> {
  await ensureAdminSettingsTable();
  await pool.execute(
    `INSERT INTO ${TABLE} (setting_key, setting_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [key, value]
  );
}

function normalizeList(raw: unknown, maxLen = 120): string[] {
  const list = Array.isArray(raw)
    ? raw.map((v) => String(v || "").trim())
    : String(raw || "")
        .split(/\r?\n|,/)
        .map((v) => v.trim());
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || item.length < 2) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item.slice(0, maxLen));
    if (out.length >= 400) break;
  }
  return out;
}

function parseListOrDefault(
  raw: string | null,
  fallback: string[],
  allowEmptyDefault = false
): string[] {
  if (raw == null) return [...fallback];
  if (!String(raw).trim()) return allowEmptyDefault ? [] : [...fallback];
  try {
    const parsed = JSON.parse(raw);
    const list = normalizeList(parsed);
    if (!list.length && !allowEmptyDefault) return [...fallback];
    return list;
  } catch {
    const list = normalizeList(raw);
    if (!list.length && !allowEmptyDefault) return [...fallback];
    return list;
  }
}

export async function getGuardKeywordWatchSettings(): Promise<GuardKeywordWatchSettings> {
  const [enabledRaw, keywordsRaw, websitesRaw, appsRaw, uploadsRaw, dedupRaw] =
    await Promise.all([
      getRaw(KEY_ENABLED),
      getRaw(KEY_KEYWORDS),
      getRaw(KEY_WEBSITES),
      getRaw(KEY_APPS),
      getRaw(KEY_UPLOADS),
      getRaw(KEY_DEDUP),
    ]);

  const dedup = Math.min(
    24 * 60,
    Math.max(5, Number.parseInt(String(dedupRaw || "60"), 10) || 60)
  );

  return {
    enabled:
      enabledRaw == null
        ? true
        : !/^(0|false|no|off)$/i.test(String(enabledRaw).trim()),
    keywords: parseListOrDefault(keywordsRaw, DEFAULT_GUARD_KEYWORDS),
    websites: parseListOrDefault(websitesRaw, DEFAULT_GUARD_WEBSITES),
    apps: parseListOrDefault(appsRaw, DEFAULT_GUARD_APPS, true),
    uploads: parseListOrDefault(uploadsRaw, DEFAULT_GUARD_UPLOADS),
    dedupMinutes: dedup,
  };
}

export async function saveGuardKeywordWatchSettings(
  input: Partial<GuardKeywordWatchSettings>
): Promise<GuardKeywordWatchSettings> {
  const current = await getGuardKeywordWatchSettings();
  const next: GuardKeywordWatchSettings = {
    enabled:
      typeof input.enabled === "boolean" ? input.enabled : current.enabled,
    keywords:
      input.keywords != null
        ? normalizeList(input.keywords)
        : current.keywords,
    websites:
      input.websites != null
        ? normalizeList(input.websites)
        : current.websites,
    apps: input.apps != null ? normalizeList(input.apps) : current.apps,
    uploads:
      input.uploads != null ? normalizeList(input.uploads) : current.uploads,
    dedupMinutes: Math.min(
      24 * 60,
      Math.max(
        5,
        Number(input.dedupMinutes ?? current.dedupMinutes) ||
          current.dedupMinutes
      )
    ),
  };
  if (!next.keywords.length) next.keywords = DEFAULT_GUARD_KEYWORDS;

  await Promise.all([
    setRaw(KEY_ENABLED, next.enabled ? "1" : "0"),
    setRaw(KEY_KEYWORDS, JSON.stringify(next.keywords)),
    setRaw(KEY_WEBSITES, JSON.stringify(next.websites)),
    setRaw(KEY_APPS, JSON.stringify(next.apps)),
    setRaw(KEY_UPLOADS, JSON.stringify(next.uploads)),
    setRaw(KEY_DEDUP, String(next.dedupMinutes)),
  ]);
  return next;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const EVIDENCE_CONTEXT_CHARS = 140;
const EVIDENCE_MAX_SNIPPETS = 4;

/**
 * Build ticket evidence from text BEFORE + AFTER each matched word/phrase
 * (not just the isolated keyword). Marks the hit with «word» for admin review.
 */
export function buildEvidenceAroundMatches(
  fullText: string,
  matched: string[],
  opts?: { contextChars?: number; maxSnippets?: number },
): string {
  const source = String(fullText || "");
  if (!source.trim()) return "";
  const needles = (matched || [])
    .map((m) => String(m || "").trim())
    .filter((m) => m.length >= 2);
  if (!needles.length) return source.slice(0, 1600);

  const ctx = Math.max(40, opts?.contextChars ?? EVIDENCE_CONTEXT_CHARS);
  const maxSnippets = Math.max(1, opts?.maxSnippets ?? EVIDENCE_MAX_SNIPPETS);
  const snippets: string[] = [];
  const lower = source.toLowerCase();

  for (const needle of needles) {
    if (snippets.length >= maxSnippets) break;
    const n = needle.toLowerCase();
    let from = 0;
    let localHits = 0;
    while (localHits < 2 && snippets.length < maxSnippets) {
      const idx = lower.indexOf(n, from);
      if (idx < 0) break;
      const beforeCh = idx === 0 ? "" : source[idx - 1];
      const afterCh =
        idx + needle.length >= source.length
          ? ""
          : source[idx + needle.length];
      // Prefer word-ish boundaries for single tokens (skip mid-word noise)
      const boundaryOk =
        /\s/.test(needle) ||
        needle.includes(".") ||
        ((!beforeCh || /[^a-z0-9_]/i.test(beforeCh)) &&
          (!afterCh || /[^a-z0-9_]/i.test(afterCh)));
      if (boundaryOk) {
        const start = Math.max(0, idx - ctx);
        const end = Math.min(source.length, idx + needle.length + ctx);
        let piece = source.slice(start, end).replace(/[^\S\n]+/g, " ").trim();
        if (start > 0) piece = `…${piece}`;
        if (end < source.length) piece = `${piece}…`;
        // Highlight every occurrence of this needle inside the window
        const marked = piece.replace(
          new RegExp(escapeRegExp(needle), "ig"),
          (m) => `«${m}»`,
        );
        snippets.push(marked);
        localHits += 1;
      }
      from = idx + Math.max(1, needle.length);
    }
  }

  if (!snippets.length) {
    // Match may only exist in collapsed haystack — fall back to head of OCR
    return source.slice(0, 1600);
  }

  return snippets
    .map((s, i) => {
      const label =
        snippets.length === 1
          ? "Context (before «match» after)"
          : `Context ${i + 1} (before «match» after)`;
      return `${label}:\n${s}`;
    })
    .join("\n\n");
}

/**
 * Build a richer haystack from OCR so policy never relies on one raw line.
 * Always includes: raw text, collapsed spaced letters (B C → BC), URLs/domains, file names.
 */
export function preparePolicyHaystack(text: string): string {
  const raw = String(text || "");
  if (!raw.trim()) return "";

  // OCR often splits short slang: "B C" / "B.C" → "BC"
  let collapsed = raw.replace(/\b([A-Za-z])(?:[\s._*-]+)([A-Za-z])\b/g, "$1$2");
  collapsed = collapsed.replace(
    /\b([A-Za-z])(?:[\s._*-]+)([A-Za-z])(?:[\s._*-]+)([A-Za-z])\b/g,
    "$1$2$3"
  );

  const urls =
    raw.match(
      /https?:\/\/[^\s"'<>]+|www\.[^\s"'<>]+|[a-z0-9][a-z0-9.-]{1,60}\.(?:com|net|org|pk|io|co|info|tv|me|app|xyz)(?:\/[^\s"'<>]*)?/gi
    ) || [];
  const files =
    raw.match(
      /\b[\w.-]+\.(?:pdf|docx?|xlsx?|pptx?|zip|rar|7z|torrent|txt|csv|rtf)\b/gi
    ) || [];

  return [raw, collapsed, urls.join("\n"), files.join("\n")]
    .filter((p) => p && p.trim())
    .join("\n");
}

/** Word-aware match for OCR keywords (OCR-tolerant for short slang like BC). */
export function findMatchedKeywords(text: string, keywords: string[]): string[] {
  const source = preparePolicyHaystack(text);
  if (!source.trim()) return [];
  const hits: string[] = [];
  for (const kw of keywords) {
    const needle = String(kw || "").trim();
    if (needle.length < 2) continue;
    if (/\s/.test(needle) || needle.includes(".")) {
      if (source.toLowerCase().includes(needle.toLowerCase())) hits.push(needle);
      continue;
    }
    const re = new RegExp(
      `(?:^|[^a-z0-9_])${escapeRegExp(needle)}(?:[^a-z0-9_]|$)`,
      "i"
    );
    if (re.test(source)) {
      hits.push(needle);
      continue;
    }
    // Short slang only (e.g. BC): allow OCR gaps B C / B.C.
    // NEVER flex-match repeated letters like "xxx" — OCR often invents "X x X" / "XxX"
    // from Chrome UI chrome (Gemini buttons, etc.) and creates false policy tickets.
    const uniqueLetters = new Set(needle.toLowerCase().split(""));
    if (
      needle.length <= 4 &&
      /^[a-z0-9]+$/i.test(needle) &&
      uniqueLetters.size >= 2
    ) {
      const flex = needle
        .split("")
        .map((ch) => escapeRegExp(ch))
        .join("[\\W_]*");
      const flexRe = new RegExp(
        `(?:^|[^a-z0-9_])${flex}(?:[^a-z0-9_]|$)`,
        "i"
      );
      if (flexRe.test(source)) hits.push(needle);
    }
  }
  return [...new Set(hits)];
}

function normalizeLoose(s: string) {
  return String(s || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .trim();
}

/** Substring match for sites/apps/upload phrases. */
export function findMatchedLoose(haystack: string, needles: string[]): string[] {
  const source = normalizeLoose(preparePolicyHaystack(haystack));
  if (!source) return [];
  const hits: string[] = [];
  for (const item of needles) {
    const needle = normalizeLoose(item);
    if (needle.length < 2) continue;
    if (source.includes(needle)) hits.push(item.trim());
  }
  return [...new Set(hits)];
}

export type PolicyMatch = {
  kind: GuardPolicyKind;
  matched: string[];
  evidence: string;
};

/** OCR of our own Policy admin UI — do not raise alerts for the word list itself. */
export function isPolicySettingsSelfScan(text: string): boolean {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return false;
  if (
    /restricted words|save policy|reload|policy inbox|guard-screenshots|words \(ocr\)|enable policy alerts/.test(
      t
    )
  ) {
    return true;
  }
  // Dense dump of many policy keywords = reading the Words textarea.
  const markers = [
    "adult video",
    "harassment",
    "bagairat",
    "besharam",
    "pornhub",
    "onlyfans",
  ];
  const hits = markers.filter((m) => t.includes(m)).length;
  return hits >= 3;
}

/**
 * Keep only the word/phrase the employee most likely used — not the whole policy list.
 */
export function pickPrimaryMatches(
  text: string,
  matched: string[],
  max = 1
): string[] {
  const uniq = [...new Set(matched.map((m) => String(m || "").trim()).filter(Boolean))];
  if (uniq.length <= max) return uniq;
  if (isPolicySettingsSelfScan(text)) return [];

  const source = preparePolicyHaystack(text).toLowerCase();
  const scored = uniq.map((word) => {
    const needle = word.toLowerCase();
    const idx = source.indexOf(needle);
    let neighborHits = 0;
    if (idx >= 0) {
      const win = source.slice(Math.max(0, idx - 60), idx + needle.length + 60);
      for (const other of uniq) {
        if (other === word) continue;
        if (win.includes(other.toLowerCase())) neighborHits += 1;
      }
    }
    return {
      word,
      // Prefer isolated + longer phrases (e.g. "adult video" over noise).
      score: neighborHits * 10 - word.length,
    };
  });
  scored.sort((a, b) => a.score - b.score || b.word.length - a.word.length);
  return scored.slice(0, max).map((s) => s.word);
}

/**
 * RULE (mandatory): every OCR / Image→Text result must run this against
 * Policy words + websites/links + uploads/docs (+ apps). Never skip the check
 * in callers — only ticket creation may skip (disabled / dedup / no_match).
 */
export function evaluateTextPolicy(
  text: string,
  settings: GuardKeywordWatchSettings
): PolicyMatch | null {
  const source = String(text || "");
  if (!source.trim()) return null;
  if (isPolicySettingsSelfScan(source)) return null;

  const hay = preparePolicyHaystack(source);

  const sites = pickPrimaryMatches(
    source,
    findMatchedLoose(hay, settings.websites),
    2
  );
  if (sites.length) {
    return {
      kind: "website",
      matched: sites,
      evidence: buildEvidenceAroundMatches(source, sites),
    };
  }

  const uploads = pickPrimaryMatches(
    source,
    findMatchedLoose(hay, settings.uploads),
    2
  );
  if (uploads.length) {
    return {
      kind: "upload",
      matched: uploads,
      evidence: buildEvidenceAroundMatches(source, uploads),
    };
  }

  const apps = pickPrimaryMatches(source, findMatchedLoose(hay, settings.apps), 2);
  if (apps.length) {
    return {
      kind: "app",
      matched: apps,
      evidence: buildEvidenceAroundMatches(source, apps),
    };
  }

  const words = pickPrimaryMatches(
    source,
    findMatchedKeywords(hay, settings.keywords),
    1
  );
  if (words.length) {
    return {
      kind: "keyword",
      matched: words,
      evidence: buildEvidenceAroundMatches(source, words),
    };
  }

  return null;
}

export function evaluateAppActivityPolicy(
  appName: string,
  appPath: string | null | undefined,
  caption: string | null | undefined,
  settings: GuardKeywordWatchSettings
): PolicyMatch | null {
  const appHay = [appName, appPath || ""].filter(Boolean).join("\n");
  const captionHay = String(caption || "");
  const combined = [appHay, captionHay].filter(Boolean).join("\n");

  const apps = findMatchedLoose(appHay, settings.apps);
  if (apps.length) {
    return {
      kind: "app",
      matched: apps,
      evidence: buildEvidenceAroundMatches(combined, apps),
    };
  }

  const sites = findMatchedLoose(combined, settings.websites);
  if (sites.length) {
    return {
      kind: "website",
      matched: sites,
      evidence: buildEvidenceAroundMatches(combined, sites),
    };
  }

  const uploads = findMatchedLoose(combined, settings.uploads);
  if (uploads.length) {
    return {
      kind: "upload",
      matched: uploads,
      evidence: buildEvidenceAroundMatches(combined, uploads),
    };
  }

  return null;
}

function ocrTextFromFile(absPath: string): Promise<string> {
  const script = path.join(process.cwd(), "image-to-text", "run-scan.js");
  return new Promise((resolve, reject) => {
    // Staging is ~2GB RAM — keep OCR child heap modest (override via env).
    const ocrHeap = Math.max(
      128,
      Math.min(448, Number(process.env.GUARD_SS_OCR_HEAP_MB || 256) || 256),
    );
    execFile(
      process.execPath,
      [`--max-old-space-size=${ocrHeap}`, script, absPath],
      {
        cwd: process.cwd(),
        env: process.env,
        timeout: 55000,
        maxBuffer: 1024 * 1024,
      },
      (err, stdout) => {
        const raw = String(stdout || "").trim();
        try {
          const parsed = JSON.parse(raw) as {
            ok?: boolean;
            text?: string;
            error?: string;
          };
          if (!parsed.ok) {
            reject(new Error(parsed.error || "OCR failed"));
            return;
          }
          resolve(String(parsed.text || ""));
          return;
        } catch {
          /* fall through */
        }
        reject(
          new Error(err ? "OCR process failed" : "OCR returned an invalid response")
        );
      }
    );
  });
}

export type KeywordAlertInput = {
  absolutePath: string;
  relativePath: string;
  employeeId: string;
  employeeName?: string;
  pseudonym?: string;
  ocrText?: string;
};

export type KeywordAlertResult =
  | { ok: true; skipped: true; reason: string }
  | {
      ok: true;
      skipped?: false;
      ticketId: number;
      ticketNumber: string;
      matched: string[];
      kind: GuardPolicyKind;
    }
  | { ok: false; error: string };

function kindLabel(kind: GuardPolicyKind) {
  if (kind === "website") return "restricted website";
  if (kind === "app") return "restricted app";
  if (kind === "upload") return "restricted upload / file action";
  return "abusive / indecent wording";
}

function buildProfessionalSummary(input: {
  kind: GuardPolicyKind;
  matched: string[];
  employeeName: string;
  appName?: string | null;
  caption?: string | null;
}): { subject: string; summary: string; detailLines: string[] } {
  const word = input.matched[0] || "restricted content";
  const app = String(input.appName || "").trim();
  const caption = String(input.caption || "").trim();
  const whereApp = app || "an unknown application";
  const whereCaption = caption ? ` (“${caption.slice(0, 120)}”)` : "";

  let summary: string;
  if (input.kind === "website") {
    summary = `Employee accessed or viewed a restricted website/link “${word}” while using ${whereApp}${whereCaption}.`;
  } else if (input.kind === "upload") {
    summary = `Employee performed a restricted file/upload action involving “${word}” while using ${whereApp}${whereCaption}.`;
  } else if (input.kind === "app") {
    summary = `Employee used a restricted application “${word}”${caption ? ` — window: “${caption.slice(0, 120)}”` : ""}.`;
  } else {
    summary = `Restricted word “${word}” was detected on a screenshot while ${whereApp} was active${whereCaption}. This is OCR of on-screen text (not proof the employee typed it).`;
  }

  const subject =
    input.kind === "keyword"
      ? `Policy alert — ${input.employeeName} · “${word}” on screen · ${whereApp}`
      : `Policy alert — ${input.employeeName} · ${kindLabel(input.kind)} · ${word}`;

  const detailLines = [
    summary,
    "",
    `Employee: ${input.employeeName}`,
    app ? `Application: ${app}` : null,
    caption ? `Window title: ${caption.slice(0, 200)}` : null,
    `Matched: ${input.matched.join(", ")}`,
    `Detected: ${formatDateTimeInServerTz(new Date())}`,
  ].filter((line): line is string => line != null);

  return { subject, summary, detailLines };
}

/** Silent: inbox only — no manager toast popup. */
function broadcastSilentTicket(ticket: Record<string, unknown>) {
  broadcastWsEvent({
    type: "ticket_update",
    ticket,
    silent: true,
  });
}

export async function createGuardPolicyTicket(input: {
  employeeId: string;
  employeeName?: string;
  pseudonym?: string;
  kind: GuardPolicyKind;
  matched: string[];
  evidence: string;
  relativePath?: string;
  sourceDetail?: string;
  appName?: string | null;
  caption?: string | null;
}): Promise<KeywordAlertResult> {
  await ensureEmployeeTicketsTable();
  const settings = await getGuardKeywordWatchSettings();
  if (!settings.enabled) {
    return { ok: true, skipped: true, reason: "disabled" };
  }
  const primaryMatched = pickPrimaryMatches(
    input.evidence,
    input.matched,
    input.kind === "keyword" ? 1 : 2
  );
  if (!primaryMatched.length) {
    return { ok: true, skipped: true, reason: "no_match" };
  }

  const employeeId = String(input.employeeId || "").trim();
  if (!employeeId) {
    return { ok: false, error: "employee_id required" };
  }

  let employeeName = String(input.employeeName || "").trim();
  let pseudonym = String(input.pseudonym || "").trim();
  try {
    const [rows] = await pool.query(
      `SELECT first_name, last_name, pseudonym FROM hrm_employees WHERE id = ? LIMIT 1`,
      [employeeId]
    );
    const emp = (
      rows as { first_name?: string; last_name?: string; pseudonym?: string }[]
    )[0];
    if (emp) {
      const n = `${emp.first_name || ""} ${emp.last_name || ""}`.trim();
      if (n) employeeName = n;
      if (emp.pseudonym?.trim()) pseudonym = emp.pseudonym.trim();
    }
  } catch {
    /* keep */
  }
  if (!pseudonym) {
    pseudonym = (await getEmployeePseudonym(employeeId)) || "";
  }
  if (!employeeName) employeeName = `Employee ${employeeId}`;

  let appName = String(input.appName || "").trim();
  let caption = String(input.caption || "").trim();
  if (!appName) {
    try {
      const latest = await getLatestAppActivity(employeeId);
      if (latest) {
        appName = latest.appName || "";
        if (!caption) caption = latest.caption || "";
      }
    } catch {
      /* optional context */
    }
  }

  const dedupMs = settings.dedupMinutes * 60 * 1000;
  try {
    const [dupRows] = await pool.query(
      `SELECT id, ticket_number, requested_at, status FROM ${EMPLOYEE_TICKETS_TABLE}
       WHERE employee_id = ?
         AND ticket_type = ?
         AND status IN ('pending', 'in_progress')
       ORDER BY id DESC
       LIMIT 10`,
      [employeeId, GUARD_KEYWORD_TICKET_TYPE]
    );
    const cutoff = Date.now() - dedupMs;
    const recent = (Array.isArray(dupRows) ? dupRows : []).find((row) => {
      const r = row as { requested_at?: string | Date };
      const raw = r.requested_at;
      let ts = 0;
      if (raw instanceof Date) ts = raw.getTime();
      else if (raw != null) {
        const s = String(raw).trim();
        // Naive DB times are UTC wall clock (Mongo sqlNow).
        const normalized = s.includes("T") ? s : s.replace(" ", "T");
        const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized);
        ts = Date.parse(hasTz ? normalized : `${normalized}Z`);
      }
      return Number.isFinite(ts) && ts >= cutoff;
    }) as { id: number } | undefined;
    if (recent?.id) {
      return { ok: true, skipped: true, reason: "deduped" };
    }
  } catch {
    /* continue */
  }

  const displayName = pseudonym
    ? `${employeeName} (${pseudonym})`
    : employeeName;
  // Prefer contextual before/after snippets around the matched word(s).
  const contextual = buildEvidenceAroundMatches(
    input.evidence,
    primaryMatched,
  );
  const evidenceClear = clearEvidenceText(contextual || input.evidence);
  const { subject, summary, detailLines } = buildProfessionalSummary({
    kind: input.kind,
    matched: primaryMatched,
    employeeName: displayName,
    appName,
    caption,
  });
  const description = [
    ...detailLines,
    "",
    "Context around match (before «word» after):",
    evidenceClear,
    `HRM ID: ${employeeId}`,
    input.relativePath ? `Screenshot: ${input.relativePath}` : null,
    input.sourceDetail ? `Source: ${input.sourceDetail}` : null,
  ]
    .filter((line) => line != null)
    .join("\n");

  const formJson = JSON.stringify({
    employee_id: employeeId,
    employee_name: employeeName,
    pseudonym: pseudonym || null,
    policy_kind: input.kind,
    matched: primaryMatched,
    summary,
    app_name: appName || null,
    caption: caption || null,
    evidence: evidenceClear,
    evidence_has_context: true,
    screenshot_path: input.relativePath || null,
    source: "guard_policy_watch",
    silent: true,
    secret_inbox: true,
  });

  const [result]: any = await pool.query(
    `INSERT INTO ${EMPLOYEE_TICKETS_TABLE}
     (ticket_number, employee_id, employee_name, category, ticket_type, is_custom,
      subject, description, form_data, priority, status, requested_at, updated_at)
     VALUES ('PENDING', ?, ?, 'HR', ?, 0,
      ?, ?, ?, 'high', 'pending', NOW(), NOW())`,
    [
      employeeId,
      employeeName,
      GUARD_KEYWORD_TICKET_TYPE,
      subject,
      description,
      formJson,
    ]
  );

  const id = Number(result?.insertId);
  const ticketNumber = buildTicketNumber(id);
  await pool.query(
    `UPDATE ${EMPLOYEE_TICKETS_TABLE} SET ticket_number = ? WHERE id = ?`,
    [ticketNumber, id]
  );

  const messages = seedEmployeeMessage("Interact Guard", description);
  try {
    await pool.query(
      `UPDATE ${EMPLOYEE_TICKETS_TABLE} SET messages = ? WHERE id = ?`,
      [JSON.stringify(messages), id]
    );
  } catch {
    /* optional */
  }

  const [rows]: any = await pool.query(
    `SELECT * FROM ${EMPLOYEE_TICKETS_TABLE} WHERE id = ? LIMIT 1`,
    [id]
  );
  const ticket = rowToTicket(rows[0]);
  try {
    broadcastSilentTicket({
      ...ticket,
      employee_pseudonym: pseudonym || null,
    } as any);
  } catch {
    /* inbox can still load on refresh */
  }

  return {
    ok: true,
    ticketId: id,
    ticketNumber,
    matched: primaryMatched,
    kind: input.kind,
  };
}

/** @deprecated use createGuardPolicyTicket */
export async function createGuardKeywordTicket(input: {
  employeeId: string;
  employeeName?: string;
  pseudonym?: string;
  matched: string[];
  relativePath: string;
  ocrExcerpt: string;
}): Promise<KeywordAlertResult> {
  return createGuardPolicyTicket({
    employeeId: input.employeeId,
    employeeName: input.employeeName,
    pseudonym: input.pseudonym,
    kind: "keyword",
    matched: input.matched,
    evidence: input.ocrExcerpt,
    relativePath: input.relativePath,
    sourceDetail: "screenshot OCR",
  });
}

const scanning = new Set<string>();

export async function scanScreenshotForKeywordAlerts(
  input: KeywordAlertInput
): Promise<KeywordAlertResult> {
  try {
    const settings = await getGuardKeywordWatchSettings();
    if (!settings.enabled) {
      return { ok: true, skipped: true, reason: "disabled" };
    }

    const abs = String(input.absolutePath || "").trim();
    const employeeId = String(input.employeeId || "").trim();
    if (!abs || !employeeId) {
      return { ok: false, error: "path and employee_id required" };
    }

    const scanKey = `${employeeId}:${abs}`;
    if (scanning.has(scanKey)) {
      return { ok: true, skipped: true, reason: "busy" };
    }
    scanning.add(scanKey);
    try {
      // Always obtain OCR text, then ALWAYS evaluate words / sites / docs / apps.
      const text =
        typeof input.ocrText === "string"
          ? input.ocrText
          : await ocrTextFromFile(abs);
      const hit = evaluateTextPolicy(text, settings);
      if (!hit) {
        return { ok: true, skipped: true, reason: "no_match" };
      }
      let appName: string | null = null;
      let caption: string | null = null;
      try {
        const latest = await getLatestAppActivity(employeeId);
        if (latest) {
          appName = latest.appName || null;
          caption = latest.caption || null;
        }
      } catch {
        /* optional */
      }
      return await createGuardPolicyTicket({
        employeeId,
        employeeName: input.employeeName,
        pseudonym: input.pseudonym,
        kind: hit.kind,
        matched: hit.matched,
        evidence: hit.evidence,
        relativePath: input.relativePath,
        sourceDetail: "screenshot OCR",
        appName,
        caption,
      });
    } finally {
      scanning.delete(scanKey);
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Keyword scan failed",
    };
  }
}

/**
 * RULE entry: Image→Text + screenshot upload must call this — never skip.
 * Evaluates Policy words, websites/links, uploads/docs, apps against OCR text.
 */
export async function enforcePolicyAfterOcr(
  input: KeywordAlertInput
): Promise<KeywordAlertResult> {
  return scanScreenshotForKeywordAlerts(input);
}

export async function scanAppActivityForPolicyAlerts(input: {
  employeeId: string;
  employeeName?: string | null;
  pseudonym?: string | null;
  appName: string;
  appPath?: string | null;
  caption?: string | null;
}): Promise<KeywordAlertResult> {
  try {
    const settings = await getGuardKeywordWatchSettings();
    if (!settings.enabled) {
      return { ok: true, skipped: true, reason: "disabled" };
    }
    const employeeId = String(input.employeeId || "").trim();
    if (!employeeId || !input.appName) {
      return { ok: false, error: "employee_id and app_name required" };
    }
    const hit = evaluateAppActivityPolicy(
      input.appName,
      input.appPath,
      input.caption,
      settings
    );
    if (!hit) {
      return { ok: true, skipped: true, reason: "no_match" };
    }
    return await createGuardPolicyTicket({
      employeeId,
      employeeName: input.employeeName || undefined,
      pseudonym: input.pseudonym || undefined,
      kind: hit.kind,
      matched: hit.matched,
      evidence: hit.evidence,
      sourceDetail: `app activity · ${input.appName}`,
      appName: input.appName,
      caption: input.caption || null,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "App policy scan failed",
    };
  }
}
