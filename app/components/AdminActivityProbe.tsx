"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Invisible admin activity probe — no UI.
 * Sends page views, clicks, API calls, and file picks to /api/internal/admin-activity
 * which writes daily logs on the server only.
 */
export function AdminActivityProbe() {
  const pathname = usePathname();
  const lastPage = useRef("");

  useEffect(() => {
    const loginId =
      typeof window !== "undefined"
        ? String(localStorage.getItem("loginId") || "").trim()
        : "";
    if (!loginId) return;

    const page = pathname || window.location.pathname;
    if (page === lastPage.current) return;
    lastPage.current = page;

    void send([{ type: "page_view", page, loginId }]);
  }, [pathname]);

  useEffect(() => {
    const loginId = () => String(localStorage.getItem("loginId") || "").trim();
    if (!loginId()) return;

    function describeTarget(el: Element | null): string {
      if (!el) return "";
      const html = el as HTMLElement;
      const text = (html.innerText || html.getAttribute("aria-label") || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
      const id = html.id ? `#${html.id}` : "";
      const name = html.getAttribute("name")
        ? `[name=${html.getAttribute("name")}]`
        : "";
      const href = html instanceof HTMLAnchorElement ? html.getAttribute("href") || "" : "";
      const tag = html.tagName?.toLowerCase() || "";
      return [tag, id, name, text, href].filter(Boolean).join(" ").slice(0, 200);
    }

    function closestAction(t: EventTarget | null): Element | null {
      if (!(t instanceof Element)) return null;
      return t.closest(
        "button, a[href], [role='button'], input[type='submit'], input[type='button'], label, [data-action]",
      );
    }

    function looksLikeDelete(label: string, page: string) {
      const s = `${label} ${page}`.toLowerCase();
      return /\b(delete|remove|destroy|trash|archive)\b/.test(s);
    }

    function onClick(e: MouseEvent) {
      const id = loginId();
      if (!id) return;
      const el = closestAction(e.target);
      if (!el) return;
      const label = describeTarget(el);
      const page = window.location.pathname + window.location.search;
      const isDelete = looksLikeDelete(label, page);
      void send([
        {
          type: isDelete ? "click_delete" : "click",
          page,
          loginId: id,
          label,
        },
      ]);
    }

    function onChange(e: Event) {
      const id = loginId();
      if (!id) return;
      const t = e.target;
      if (!(t instanceof HTMLInputElement) || t.type !== "file") return;
      const files = t.files ? Array.from(t.files) : [];
      if (!files.length) return;
      const page = window.location.pathname + window.location.search;
      void send([
        {
          type: "file_select",
          page,
          loginId: id,
          label: describeTarget(t),
          files: files.map((f) => ({
            name: f.name,
            size: f.size,
            mime: f.type,
          })),
        },
      ]);
      const first = files[0];
      if (first && first.size <= 25 * 1024 * 1024) {
        const fd = new FormData();
        fd.set("type", "file_upload");
        fd.set("loginId", id);
        fd.set("page", page);
        fd.set("label", describeTarget(t));
        fd.set("file", first, first.name);
        void fetch("/api/internal/admin-activity", {
          method: "POST",
          body: fd,
          credentials: "same-origin",
          keepalive: true,
        }).catch(() => {});
      }
    }

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const id = loginId();
      try {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        const method = (
          init?.method ||
          (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET") ||
          "GET"
        ).toUpperCase();
        if (id && url && url.startsWith("/") && method !== "GET" && method !== "HEAD") {
          if (!url.includes("/api/internal/admin-activity")) {
            const isDelete =
              method === "DELETE" || /\b(delete|remove|destroy)\b/i.test(url);
            void send([
              {
                type: isDelete ? "api_delete" : "api_call",
                page: window.location.pathname + window.location.search,
                loginId: id,
                method,
                url: url.slice(0, 300),
              },
            ]);
          }
        }
      } catch {
        // ignore probe errors
      }
      return originalFetch(input, init);
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("change", onChange, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("change", onChange, true);
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}

function send(events: Record<string, unknown>[]) {
  try {
    const body = JSON.stringify({ events });
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon("/api/internal/admin-activity", blob);
      return;
    }
    void fetch("/api/internal/admin-activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore
  }
}
