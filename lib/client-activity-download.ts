/**
 * Client-side: archive an exported/downloaded Blob into Backlog Tracker
 * so admins can later Open file from the log.
 */
const MAX_BYTES = 25 * 1024 * 1024;

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

export function reportClientFileDownload(
  data: Blob | ArrayBuffer | Uint8Array,
  fileName: string,
  opts?: { detail?: string; page?: string },
) {
  try {
    if (typeof window === "undefined") return;
    const ids = actorIds();
    if (!ids.loginId && !ids.employeeId) return;

    const name = String(fileName || "download.bin")
      .replace(/[^\w.\-()+ ]+/g, "_")
      .slice(0, 180);
    const blob =
      data instanceof Blob
        ? data
        : new Blob([data as BlobPart], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          });
    if (blob.size <= 0 || blob.size > MAX_BYTES) return;

    const page =
      opts?.page ||
      `${window.location.pathname}${window.location.search}`.slice(0, 512);
    const detail =
      opts?.detail ||
      `Downloaded "${name}" on page "${page}" (${blob.size} B)`;

    const fd = new FormData();
    fd.set("type", "download");
    if (ids.loginId) fd.set("loginId", ids.loginId);
    if (ids.employeeId) fd.set("employeeId", ids.employeeId);
    fd.set("page", page);
    fd.set("label", detail);
    fd.set("method", "BLOB");
    fd.set("url", page);
    try {
      const host = String(localStorage.getItem("hrm_pc_hostname") || "").trim();
      if (host) fd.set("hostname", host);
    } catch {
      /* ignore */
    }
    fd.set(
      "file",
      new File([blob], name.endsWith(".xlsx") || name.includes(".") ? name : `${name}.xlsx`, {
        type:
          blob.type ||
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );

    void fetch("/api/internal/admin-activity", {
      method: "POST",
      body: fd,
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* never block export */
  }
}
