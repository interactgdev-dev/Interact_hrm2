"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Invisible admin activity probe — no UI.
 * Captures page views, clicks (with employee context), API calls, file picks.
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
      const href =
        html instanceof HTMLAnchorElement ? html.getAttribute("href") || "" : "";
      const tag = html.tagName?.toLowerCase() || "";
      const action = html.getAttribute("data-action") || "";
      return [tag, id, name, action, text, href].filter(Boolean).join(" ").slice(0, 220);
    }

    function closestAction(t: EventTarget | null): Element | null {
      if (!(t instanceof Element)) return null;
      return t.closest(
        "button, a[href], [role='button'], input[type='submit'], input[type='button'], label, [data-action]",
      );
    }

    /** Walk up DOM for employee / row context (id + name). */
    function extractTargetContext(el: Element | null) {
      if (!el) return {} as Record<string, string | number>;
      let node: Element | null = el;
      for (let i = 0; i < 12 && node; i++, node = node.parentElement) {
        const ds = (node as HTMLElement).dataset || {};
        const empId =
          ds.employeeId ||
          ds.empId ||
          ds.employee_id ||
          node.getAttribute("data-employee-id") ||
          node.getAttribute("data-emp-id");
        const empName =
          ds.employeeName ||
          ds.empName ||
          ds.employee_name ||
          node.getAttribute("data-employee-name") ||
          node.getAttribute("data-emp-name");
        const pseudo =
          ds.employeePseudonym ||
          node.getAttribute("data-employee-pseudonym") ||
          "";
        const dept =
          ds.departmentName || node.getAttribute("data-department-name") || "";
        if (empId || empName) {
          const out: Record<string, string | number> = {};
          if (empId) out.target_employee_id = Number(empId) || String(empId);
          if (empName) out.target_employee_name = String(empName).trim();
          if (pseudo) out.target_pseudonym = String(pseudo).trim();
          if (dept) out.target_department = String(dept).trim();
          return out;
        }
      }

      // Fallback: parse nearby text e.g. "Emp. ID 97" + name in same card/row
      const root =
        el.closest("tr, [data-employee-id], article, section, div") || el.parentElement;
      const text = (root?.textContent || "").replace(/\s+/g, " ").trim();
      const idMatch = text.match(/\bEmp\.?\s*ID\s*[#:.]?\s*(\d+)\b/i);
      const out: Record<string, string | number> = {};
      if (idMatch) out.target_employee_id = Number(idMatch[1]);

      // table row: often ID in first cell, name in second
      const tr = el.closest("tr");
      if (tr) {
        const cells = Array.from(tr.querySelectorAll("td"));
        if (cells.length >= 2) {
          const c0 = cells[0].textContent?.trim() || "";
          const c1 = cells[1].textContent?.trim() || "";
          if (/^\d+$/.test(c0) && !out.target_employee_id) {
            out.target_employee_id = Number(c0);
          }
          if (c1 && c1.length < 80) out.target_employee_name = c1;
        }
      }
      return out;
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
      const target = extractTargetContext(el);
      void send([
        {
          type: isDelete ? "click_delete" : "click",
          page,
          loginId: id,
          label,
          ...target,
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
      const target = extractTargetContext(t);
      void send([
        {
          type: "file_select",
          page,
          loginId: id,
          label: describeTarget(t),
          ...target,
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
        if (target.target_employee_id != null) {
          fd.set("target_employee_id", String(target.target_employee_id));
        }
        if (target.target_employee_name) {
          fd.set("target_employee_name", String(target.target_employee_name));
        }
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
          (typeof input !== "string" && !(input instanceof URL)
            ? input.method
            : "GET") ||
          "GET"
        ).toUpperCase();
        if (
          id &&
          url &&
          url.startsWith("/") &&
          method !== "GET" &&
          method !== "HEAD"
        ) {
          if (!url.includes("/api/internal/admin-activity")) {
            const isDelete =
              method === "DELETE" || /\b(delete|remove|destroy)\b/i.test(url);
            // Try pull employee id from URL query/path
            const empFromUrl =
              url.match(/employeeId=(\d+)/i)?.[1] ||
              url.match(/employee_id=(\d+)/i)?.[1] ||
              url.match(/\/employees?\/(\d+)/i)?.[1];
            void send([
              {
                type: isDelete ? "api_delete" : "api_call",
                page: window.location.pathname + window.location.search,
                loginId: id,
                method,
                url: url.slice(0, 300),
                ...(empFromUrl
                  ? { target_employee_id: Number(empFromUrl) }
                  : {}),
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
