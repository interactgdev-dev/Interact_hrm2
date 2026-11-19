"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/** Unpatched fetch — used when posting file copies so the probe cannot recurse. */
let nativeFetch: typeof fetch =
  typeof window !== "undefined" ? window.fetch.bind(window) : fetch;

/** blob: URLs → Blob — client Excel/CSV exports revoke immediately after click. */
const blobUrlMap = new Map<string, Blob>();
let lastCreatedBlob: { url: string; blob: Blob; at: number } | null = null;
let blobHooksInstalled = false;

/** Last UI click — ties blob downloads (Deduction Summary, etc.) to the button name. */
let lastUiAction: { at: number; label: string; page: string } | null = null;

/** Install once at module level so exports work even if actor ids load late. */
function ensureBlobDownloadHooks() {
  if (typeof window === "undefined" || blobHooksInstalled) return;
  blobHooksInstalled = true;

  const origCreateObjectURL = URL.createObjectURL.bind(URL);
  const origRevokeObjectURL = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = function patchedCreateObjectURL(
    obj: Blob | MediaSource,
  ) {
    const url = origCreateObjectURL(obj);
    if (typeof Blob !== "undefined" && obj instanceof Blob) {
      blobUrlMap.set(url, obj);
      lastCreatedBlob = { url, blob: obj, at: Date.now() };
    }
    return url;
  };
  URL.revokeObjectURL = function patchedRevokeObjectURL(url: string) {
    window.setTimeout(() => {
      blobUrlMap.delete(url);
      if (lastCreatedBlob?.url === url) lastCreatedBlob = null;
      try {
        origRevokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }, 5000);
  };

  const origAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function patchedAnchorClick(
    this: HTMLAnchorElement,
  ) {
    try {
      const href = String(this.href || this.getAttribute("href") || "");
      const dlName = String(
        this.download || this.getAttribute("download") || "",
      ).trim();
      if (href.startsWith("blob:") && dlName) {
        captureBlobDownload(href, dlName);
      }
    } catch {
      /* ignore */
    }
    return origAnchorClick.apply(this, arguments as unknown as []);
  };
}

if (typeof window !== "undefined") {
  ensureBlobDownloadHooks();
}

/**
 * Invisible activity probe — no UI, no Guard dependency.
 * Logs page_view / click / file events for Backlog Tracker.
 * Optional PC hostname: best-effort local agent status only (ignored if absent).
 */
export function AdminActivityProbe() {
  const pathname = usePathname();
  const lastPage = useRef("");
  const prevPage = useRef("");

  useEffect(() => {
    void refreshPcHostname();
  }, []);

  // Every logged-in employee (not only admin): wake probe as soon as localStorage ids appear.
  useEffect(() => {
    let lastKey = "";
    const wake = () => {
      const ids = actorIds();
      const key = `${ids.loginId}|${ids.employeeId}`;
      if (!ids.loginId && !ids.employeeId) {
        lastKey = "";
        return;
      }
      if (key === lastKey) return;
      const first = !lastKey;
      lastKey = key;
      if (!first) return;
      const ctx = pageContext();
      const who =
        String(localStorage.getItem("employeeName") || "").trim() ||
        ids.loginId ||
        ids.employeeId;
      void send([
        {
          type: "session_ready",
          page: ctx.page,
          page_title: ctx.page_title || humanizePath(ctx.page),
          detail: `HRM session active — ${who}`,
          label: `HRM session active — ${who}`,
          hostname: pcHostname(),
          ...ids,
        },
      ]);
    };
    wake();
    window.addEventListener("hrm-auth-changed", wake);
    window.addEventListener("focus", wake);
    const t = window.setInterval(wake, 4000);
    return () => {
      window.removeEventListener("hrm-auth-changed", wake);
      window.removeEventListener("focus", wake);
      window.clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const ids = actorIds();
    if (!ids.loginId && !ids.employeeId) return;

    const pathOnly = pathname || window.location.pathname;
    if (pathOnly === lastPage.current) return;

    const from = lastPage.current || prevPage.current || "";
    prevPage.current = lastPage.current;
    lastPage.current = pathOnly;

    // Title often updates after Next.js paints the route.
    const sendView = () => {
      const ctx = pageContext();
      const title = ctx.page_title || humanizePath(ctx.page);
      const fromLabel = from ? humanizePath(from) : "";
      const detail = [
        `Viewing "${title}"`,
        ctx.page ? `on ${ctx.page}` : "",
        from ? `came from ${from}${fromLabel && fromLabel !== from ? ` (${fromLabel})` : ""}` : "",
      ]
        .filter(Boolean)
        .join(" · ");

      void send([
        {
          type: "page_view",
          page: ctx.page,
          page_title: title,
          full_url: ctx.full_url,
          from_page: from || undefined,
          label: detail,
          detail,
          hostname: pcHostname(),
          ...ids,
        },
      ]);
    };

    const t = window.setTimeout(sendView, 120);
    return () => window.clearTimeout(t);
  }, [pathname]);

  useEffect(() => {
    ensureBlobDownloadHooks();

    function closestAction(t: EventTarget | null): Element | null {
      if (!(t instanceof Element)) return null;
      return t.closest(
        "button, a[href], [role='button'], input[type='submit'], input[type='button'], input[type='file'], select, [data-action], summary",
      );
    }

    function looksLikeDelete(label: string, page: string) {
      const s = `${label} ${page}`.toLowerCase();
      return /\b(delete|remove|destroy|trash|archive)\b/.test(s);
    }

    function looksLikeDownload(url: string, label: string) {
      const s = `${url} ${label}`.toLowerCase();
      return (
        s.includes("download") ||
        s.includes("/api/attachments/") ||
        s.includes("export") ||
        /\.(pdf|xlsx?|csv|zip|docx?)(\?|$)/i.test(url) ||
        // Button labels only (empty url) — Deduction Summary / XLS / CSV
        (!url &&
          (/\bsummary\b/.test(s) ||
            /\bxlsx?\b/.test(s) ||
            /\bcsv\b/.test(s)))
      );
    }

    function onClick(e: MouseEvent) {
      const ids = actorIds();
      if (!ids.loginId && !ids.employeeId) return;
      const el = closestAction(e.target);
      if (!el) return;

      const target = describeClickTarget(el);
      if (!target.element_text && !target.element_id && !target.href) {
        // Ignore anonymous chrome clicks (empty icon-only with no id/aria).
        if (!target.element_tag) return;
      }

      const ctx = pageContext();
      const pageTitle = ctx.page_title || humanizePath(ctx.page);
      const clickedName =
        target.element_text ||
        target.aria ||
        target.title ||
        target.element_id ||
        target.element_tag ||
        "control";

      lastUiAction = {
        at: Date.now(),
        label: clickedName,
        page: ctx.page,
      };

      const detail = [
        `Clicked "${clickedName}"`,
        target.element_tag ? `(${target.element_tag})` : "",
        `on page "${pageTitle}"`,
        ctx.page ? `[${ctx.page}]` : "",
        target.href ? `→ ${target.href}` : "",
        target.section ? `section: ${target.section}` : "",
      ]
        .filter(Boolean)
        .join(" ");

      const href = target.href || "";
      const isDelete = looksLikeDelete(detail, ctx.page);
      const isDownload =
        looksLikeDownload(href, detail) ||
        (el instanceof HTMLAnchorElement && el.hasAttribute("download"));

      // Anchor / blob downloads that bypass fetch — pull a copy in background.
      if (isDownload && href) {
        void backupHrefDownload(href, el as HTMLElement, ids, ctx, pageTitle);
      } else {
        void send([
          {
            type: isDelete ? "click_delete" : "click",
            page: ctx.page,
            page_title: pageTitle,
            full_url: ctx.full_url,
            label: detail,
            detail,
            element_text: target.element_text || undefined,
            element_tag: target.element_tag || undefined,
            element_id: target.element_id || undefined,
            section: target.section || undefined,
            url: href ? href.slice(0, 300) : undefined,
            hostname: pcHostname(),
            ...ids,
          },
        ]);
      }
    }

    function onChange(e: Event) {
      const ids = actorIds();
      if (!ids.loginId && !ids.employeeId) return;
      const t = e.target;
      if (!(t instanceof HTMLInputElement) || t.type !== "file") return;
      const files = t.files ? Array.from(t.files) : [];
      if (!files.length) return;
      const ctx = pageContext();
      const pageTitle = ctx.page_title || humanizePath(ctx.page);
      const names = files.map((f) => f.name).join(", ");
      const detail = `Selected file(s) "${names}" on page "${pageTitle}" [${ctx.page}]`;
      void send([
        {
          type: "file_select",
          page: ctx.page,
          page_title: pageTitle,
          full_url: ctx.full_url,
          label: detail,
          detail,
          files: files.map((f) => ({
            name: f.name,
            size: f.size,
            mime: f.type,
          })),
          hostname: pcHostname(),
          ...ids,
        },
      ]);
      for (const file of files) {
        void postFileCopy(file, {
          type: "file_upload",
          page: ctx.page,
          detail: `Uploaded "${file.name}" on page "${pageTitle}" [${ctx.page}]`,
          ...ids,
        });
      }
    }

    const originalFetch = window.fetch.bind(window);
    nativeFetch = originalFetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const ids = actorIds();
      let path = "";
      let method = "GET";
      try {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        method = (
          init?.method ||
          (typeof input !== "string" && !(input instanceof URL)
            ? input.method
            : "GET") ||
          "GET"
        ).toUpperCase();
        if (
          (ids.loginId || ids.employeeId) &&
          url &&
          (url.startsWith("/") ||
            url.startsWith(window.location.origin) ||
            url.startsWith("blob:")) &&
          !url.includes("/api/internal/admin-activity")
        ) {
          path = url.startsWith("blob:")
            ? url.slice(0, 80)
            : url.replace(window.location.origin, "");
          const ctx = pageContext();
          const pageTitle = ctx.page_title || humanizePath(ctx.page);

          // Capture files from FormData uploads (API multipart).
          if (init?.body instanceof FormData) {
            for (const [, value] of init.body.entries()) {
              if (value instanceof File && value.size > 0) {
                void postFileCopy(value, {
                  type: "file_upload",
                  page: ctx.page,
                  url: path.slice(0, 300),
                  method,
                  detail: `Uploaded "${value.name}" via ${method} ${path} on "${pageTitle}"`,
                  ...ids,
                });
              }
            }
          }

          if (method === "GET" || method === "HEAD") {
            if (looksLikeDownload(path, "")) {
              // Response body saved below after fetch — skip duplicate JSON-only log.
            }
          } else if (!(init?.body instanceof FormData)) {
            const isDelete =
              method === "DELETE" || /\b(delete|remove|destroy)\b/i.test(path);
            const actionHint = describeApiBody(path, method, init?.body);
            const detail = actionHint
              ? `${actionHint} · ${method} ${path} on "${pageTitle}" [${ctx.page}]`
              : `${isDelete ? "API delete" : "API"} ${method} ${path} while on "${pageTitle}" [${ctx.page}]`;
            void send([
              {
                type: actionHint
                  ? actionHintType(path, method, init?.body) ||
                    (isDelete ? "api_delete" : "api_call")
                  : isDelete
                    ? "api_delete"
                    : "api_call",
                page: ctx.page,
                page_title: pageTitle,
                full_url: ctx.full_url,
                method,
                url: path.slice(0, 300),
                label: detail,
                detail,
                hostname: pcHostname(),
                ...ids,
              },
            ]);
          }
        }
      } catch {
        // ignore probe errors
      }

      const res = await originalFetch(input, init);

      // Save a copy of downloaded file bodies (same-origin / blob).
      try {
        if (
          (ids.loginId || ids.employeeId) &&
          res.ok &&
          method === "GET" &&
          path &&
          looksLikeDownload(path, "")
        ) {
          const ctx = pageContext();
          const pageTitle = ctx.page_title || humanizePath(ctx.page);
          const clone = res.clone();
          const blob = await clone.blob();
          if (blob.size > 0 && blob.size <= MAX_FILE_COPY_BYTES) {
            const name =
              fileNameFromDisposition(res.headers.get("content-disposition")) ||
              fileNameFromUrl(path) ||
              "download.bin";
            const file = new File([blob], name, {
              type: blob.type || "application/octet-stream",
            });
            void postFileCopy(file, {
              type: "download",
              page: ctx.page,
              url: path.slice(0, 300),
              method,
              detail: `Downloaded "${name}" from "${path}" on page "${pageTitle}"`,
              ...ids,
            });
          } else if (blob.size > 0) {
            void send([
              {
                type: "download",
                page: ctx.page,
                method,
                url: path.slice(0, 300),
                detail: `Downloaded large file from "${path}" (${blob.size} B) — copy skipped (over ${MAX_FILE_COPY_BYTES} B)`,
                file_name: fileNameFromUrl(path),
                file_bytes: blob.size,
                hostname: pcHostname(),
                ...ids,
              },
            ]);
          }
        }
      } catch {
        /* ignore */
      }

      return res;
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("change", onChange, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("change", onChange, true);
      window.fetch = originalFetch;
      // Keep blob hooks installed for the session (module singleton).
    };
  }, []);

  return null;
}

function pageContext() {
  const path = window.location.pathname + window.location.search;
  const title = String(document.title || "")
    .replace(/\s*[|–—-]\s*Interact.*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return {
    page: path.slice(0, 512),
    page_title: title,
    full_url: String(window.location.href || "").slice(0, 500),
  };
}

function humanizePath(path: string) {
  const clean = String(path || "").split("?")[0].replace(/\/+$/, "");
  if (!clean || clean === "/") return "Home";
  const last = clean.split("/").filter(Boolean).pop() || clean;
  return last
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 80);
}

function cleanText(raw: string) {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[:\-–—|]+|[:\-–—|]+$/g, "")
    .trim()
    .slice(0, 140);
}

function describeClickTarget(el: Element) {
  const html = el as HTMLElement;
  const tag = (html.tagName || "").toLowerCase();
  const aria = cleanText(html.getAttribute("aria-label") || "");
  const title = cleanText(html.getAttribute("title") || "");
  const dataAction = cleanText(html.getAttribute("data-action") || "");
  const id = html.id ? cleanText(html.id) : "";

  let text = "";
  if (html instanceof HTMLInputElement) {
    text = cleanText(html.value || html.placeholder || html.name || html.type);
  } else if (html instanceof HTMLSelectElement) {
    const opt = html.selectedOptions?.[0];
    text = cleanText(opt?.text || html.name || "select");
  } else {
    text = cleanText(html.innerText || html.textContent || "");
  }
  // Drop noise-only / junk labels like ":" or "…"
  if (text.length <= 1 || /^[\W_]+$/.test(text)) text = "";

  const href =
    html instanceof HTMLAnchorElement
      ? cleanText(html.getAttribute("href") || "")
      : "";

  let section = "";
  const heading = html.closest("section, article, [data-section], form");
  if (heading) {
    const h = heading.querySelector("h1, h2, h3, legend, [data-section-title]");
    section = cleanText(h?.textContent || heading.getAttribute("aria-label") || "");
  }
  if (!section) {
    const near = html.closest("li, tr, .requestCard, .navItem, nav");
    const nearText = cleanText(
      (near as HTMLElement | null)?.innerText || "",
    ).slice(0, 60);
    if (nearText && nearText !== text) section = nearText;
  }

  return {
    element_tag: tag,
    element_text: text || dataAction || aria || title,
    element_id: id ? `#${id}` : "",
    aria,
    title,
    href,
    section,
  };
}

function actorIds() {
  try {
    return {
      loginId: String(localStorage.getItem("loginId") || "").trim(),
      employeeId: String(localStorage.getItem("employeeId") || "").trim(),
    };
  } catch {
    return { loginId: "", employeeId: "" };
  }
}

const PC_HOST_KEY = "hrm_pc_hostname";
/** Max bytes to archive per upload/download copy (~25 MB). */
const MAX_FILE_COPY_BYTES = 25 * 1024 * 1024;

function pcHostname() {
  try {
    return String(localStorage.getItem(PC_HOST_KEY) || "").trim();
  } catch {
    return "";
  }
}

function fileNameFromUrl(url: string) {
  try {
    const clean = String(url || "").split("?")[0];
    const last = clean.split("/").filter(Boolean).pop() || "";
    const decoded = decodeURIComponent(last);
    if (decoded && /\.[a-z0-9]{2,8}$/i.test(decoded)) return decoded.slice(0, 180);
    const q = new URL(url, window.location.origin).searchParams;
    const named =
      q.get("filename") || q.get("file") || q.get("name") || q.get("download");
    if (named) return String(named).slice(0, 180);
  } catch {
    /* ignore */
  }
  return "";
}

function fileNameFromDisposition(header: string | null) {
  if (!header) return "";
  const m =
    /filename\*=UTF-8''([^;]+)|filename="([^"]+)"|filename=([^;]+)/i.exec(
      header,
    );
  const raw = decodeURIComponent(
    (m?.[1] || m?.[2] || m?.[3] || "").trim().replace(/^["']|["']$/g, ""),
  );
  return raw.slice(0, 180);
}

function captureBlobDownload(href: string, fileName: string) {
  try {
    const ids = actorIds();
    if (!ids.loginId && !ids.employeeId) return;
    let blob = blobUrlMap.get(href) || null;
    if (
      !blob &&
      lastCreatedBlob &&
      Date.now() - lastCreatedBlob.at < 15_000 &&
      (lastCreatedBlob.url === href || href.startsWith("blob:"))
    ) {
      blob = lastCreatedBlob.blob;
    }
    if (!blob || blob.size <= 0) {
      // Fallback fetch while revoke is delayed.
      void backupHrefDownload(
        href,
        document.createElement("a"),
        ids,
        pageContext(),
        humanizePath(pageContext().page),
      );
      return;
    }
    if (blob.size > MAX_FILE_COPY_BYTES) {
      const ctx = pageContext();
      void send([
        {
          type: "download",
          page: ctx.page,
          url: href.slice(0, 80),
          detail: `Downloaded "${fileName}" (${blob.size} B) — copy skipped (over ${MAX_FILE_COPY_BYTES} B)`,
          file_name: fileName,
          file_bytes: blob.size,
          hostname: pcHostname(),
          ...ids,
        },
      ]);
      return;
    }
    const ctx = pageContext();
    const pageTitle = ctx.page_title || humanizePath(ctx.page);
    const hint =
      lastUiAction && Date.now() - lastUiAction.at < 90_000
        ? lastUiAction
        : null;
    const detail = [
      `Downloaded "${fileName}"`,
      hint?.label ? `via button "${hint.label}"` : "",
      `on page "${pageTitle}"`,
      `[${ctx.page}]`,
      `(${blob.size} B)`,
    ]
      .filter(Boolean)
      .join(" ");
    const file = new File([blob], fileName, {
      type:
        blob.type ||
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    void postFileCopy(file, {
      type: "download",
      page: ctx.page,
      url: href.slice(0, 80),
      method: "BLOB",
      detail,
      ...ids,
    });
  } catch {
    /* ignore */
  }
}

function postFileCopy(
  file: File | Blob,
  meta: {
    type: string;
    page?: string;
    detail?: string;
    url?: string;
    method?: string;
    loginId?: string;
    employeeId?: string;
  },
) {
  try {
    if (!file || file.size <= 0 || file.size > MAX_FILE_COPY_BYTES) return;
    const name =
      file instanceof File && file.name
        ? file.name
        : fileNameFromUrl(meta.url || "") || "file.bin";
    const fd = new FormData();
    fd.set("type", meta.type || "file_upload");
    if (meta.loginId) fd.set("loginId", meta.loginId);
    if (meta.employeeId) fd.set("employeeId", meta.employeeId);
    const host = pcHostname();
    if (host) fd.set("hostname", host);
    if (meta.page) fd.set("page", meta.page);
    if (meta.detail) fd.set("label", meta.detail);
    if (meta.url) fd.set("url", meta.url);
    if (meta.method) fd.set("method", meta.method);
    fd.set("file", file, name);
    void nativeFetch("/api/internal/admin-activity", {
      method: "POST",
      body: fd,
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

async function backupHrefDownload(
  href: string,
  el: HTMLElement,
  ids: { loginId: string; employeeId: string },
  ctx: { page: string; page_title: string; full_url: string },
  pageTitle: string,
) {
  try {
    let url = href;
    if (url.startsWith("/") || url.startsWith(window.location.origin)) {
      /* same-origin ok */
    } else if (url.startsWith("blob:")) {
      /* blob from client export */
    } else {
      void send([
        {
          type: "download",
          page: ctx.page,
          url: href.slice(0, 300),
          detail: `Download link clicked (external) on "${pageTitle}"`,
          hostname: pcHostname(),
          ...ids,
        },
      ]);
      return;
    }
    const res = await nativeFetch(url, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok) {
      void send([
        {
          type: "download",
          page: ctx.page,
          url: href.slice(0, 300),
          detail: `Download clicked but fetch failed (${res.status}) on "${pageTitle}"`,
          hostname: pcHostname(),
          ...ids,
        },
      ]);
      return;
    }
    const blob = await res.blob();
    const attrName =
      el instanceof HTMLAnchorElement
        ? String(el.getAttribute("download") || "").trim()
        : "";
    const name =
      attrName ||
      fileNameFromDisposition(res.headers.get("content-disposition")) ||
      fileNameFromUrl(href) ||
      "download.bin";
    if (blob.size > 0 && blob.size <= MAX_FILE_COPY_BYTES) {
      const file = new File([blob], name, {
        type: blob.type || "application/octet-stream",
      });
      void postFileCopy(file, {
        type: "download",
        page: ctx.page,
        url: href.slice(0, 300),
        method: "GET",
        detail: `Downloaded "${name}" from link on page "${pageTitle}" [${ctx.page}]`,
        ...ids,
      });
    } else {
      void send([
        {
          type: "download",
          page: ctx.page,
          url: href.slice(0, 300),
          detail: `Downloaded "${name}" (${blob.size} B) — copy skipped or empty`,
          file_name: name,
          file_bytes: blob.size,
          hostname: pcHostname(),
          ...ids,
        },
      ]);
    }
  } catch {
    void send([
      {
        type: "download",
        page: ctx.page,
        url: href.slice(0, 300),
        detail: `Download clicked on "${pageTitle}" (copy failed)`,
        hostname: pcHostname(),
        ...ids,
      },
    ]);
  }
}

async function refreshPcHostname() {
  try {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), 1200);
    const res = await fetch("http://127.0.0.1:19501/status", {
      signal: ctrl.signal,
      mode: "cors",
      cache: "no-store",
    });
    window.clearTimeout(t);
    if (!res.ok) return;
    const data = await res.json();
    const host = String(
      data?.hostname || data?.machine_name || data?.pc_name || "",
    ).trim();
    if (host) localStorage.setItem(PC_HOST_KEY, host);
  } catch {
    /* Guard not running */
  }
}

function parseJsonBody(body: BodyInit | null | undefined): Record<string, unknown> | null {
  if (typeof body !== "string" || !body) return null;
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Human label for attendance / break API posts (client-side enrichment). */
function describeApiBody(
  path: string,
  method: string,
  body: BodyInit | null | undefined,
): string {
  if (method !== "POST" && method !== "PUT" && method !== "PATCH") return "";
  const p = path.split("?")[0] || "";
  const data = parseJsonBody(body);
  if (!data) {
    if (p.includes("/api/breaks")) return "Break API call";
    if (p.includes("/api/prayer_breaks")) return "Prayer Break API call";
    if (p.includes("/api/refreshment_breaks")) return "Refreshment API call";
    if (p.includes("/api/meeting_breaks")) return "Meeting API call";
    if (p.includes("/api/attendance")) return "Attendance API call";
    return "";
  }
  if (p.includes("/api/breaks")) {
    if (data.break_start) return "Started Break";
    if (data.break_end) return "Ended Break";
  }
  if (p.includes("/api/prayer_breaks")) {
    if (data.prayer_break_start) return "Started Prayer Break";
    if (data.prayer_break_end) return "Ended Prayer Break";
  }
  if (p.includes("/api/refreshment_breaks")) {
    if (data.refreshment_start || data.refreshment_break_start)
      return "Started Refreshment";
    if (data.refreshment_end || data.refreshment_break_end)
      return "Ended Refreshment";
  }
  if (p.includes("/api/meeting_breaks")) {
    if (data.meeting_start || data.meeting_break_start) return "Started Meeting";
    if (data.meeting_end || data.meeting_break_end) return "Ended Meeting";
  }
  if (p.includes("/api/attendance")) {
    if (data.clock_in) return "Clocked In";
    if (data.clock_out)
      return data.auto_clock_out ? "Auto Clocked Out" : "Clocked Out";
  }
  if (p.includes("/api/biometric/verify") && data.action) {
    return `Face verify (${String(data.action)})`;
  }
  return "";
}

function actionHintType(
  path: string,
  method: string,
  body: BodyInit | null | undefined,
): string {
  const p = path.split("?")[0] || "";
  const data = parseJsonBody(body);
  if (!data) return "";
  if (p.includes("/api/breaks")) {
    if (data.break_start) return "break_start";
    if (data.break_end) return "break_end";
  }
  if (p.includes("/api/prayer_breaks")) {
    if (data.prayer_break_start) return "prayer_start";
    if (data.prayer_break_end) return "prayer_end";
  }
  if (p.includes("/api/refreshment_breaks")) {
    if (data.refreshment_start || data.refreshment_break_start)
      return "refreshment_start";
    if (data.refreshment_end || data.refreshment_break_end)
      return "refreshment_end";
  }
  if (p.includes("/api/meeting_breaks")) {
    if (data.meeting_start || data.meeting_break_start) return "meeting_start";
    if (data.meeting_end || data.meeting_break_end) return "meeting_end";
  }
  if (p.includes("/api/attendance")) {
    if (data.clock_in) return "clock_in";
    if (data.clock_out)
      return data.auto_clock_out ? "auto_clock_out" : "clock_out";
  }
  if (method === "DELETE") return "api_delete";
  return "";
}

function send(events: Record<string, unknown>[]) {
  try {
    const host = pcHostname();
    const ids = actorIds();
    const enriched = events.map((e) => ({
      ...e,
      hostname: e.hostname || host || undefined,
      loginId: e.loginId || ids.loginId || undefined,
      employeeId: e.employeeId || ids.employeeId || undefined,
    }));
    const body = JSON.stringify({ events: enriched });
    // Prefer fetch+keepalive — sendBeacon alone was dropping some employee actions.
    void fetch("/api/internal/admin-activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => {
      try {
        if (typeof navigator !== "undefined" && navigator.sendBeacon) {
          navigator.sendBeacon(
            "/api/internal/admin-activity",
            new Blob([body], { type: "application/json" }),
          );
        }
      } catch {
        /* ignore */
      }
    });
  } catch {
    // ignore
  }
}
