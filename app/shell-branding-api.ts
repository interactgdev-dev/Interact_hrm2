import { SHELL_SUBJECT_IDS } from "@/lib/shell-branding-constants";
import { compressProfileImage } from "@/lib/compress-profile-image";
import {
  clearOrgChartPhotosClientCache,
  fetchOrgChartPhotosBundle,
} from "@/lib/org-chart-photos-client-cache";

export type ShellBranding = {
  companyLogo: string | null;
  adminAvatar: string | null;
  employeeAvatars: Record<string, string>;
};

export async function fetchShellBranding(): Promise<ShellBranding> {
  const bundle = await fetchOrgChartPhotosBundle();
  return {
    companyLogo: bundle.companyLogo,
    adminAvatar: bundle.adminAvatar,
    employeeAvatars: bundle.employeeAvatars,
  };
}

/**
 * Compresses any browser-readable image to a small JPEG, then uploads multipart
 * so the file lands on disk (public/uploads/profile-pictures) and only the path
 * goes to the DB — no base64 / proxy body-limit failures for large phone photos.
 */
async function readJsonSafe(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    const snip = text.replace(/\s+/g, " ").slice(0, 80);
    throw new Error(
      res.status === 413 || /request entity too large/i.test(text)
        ? "Upload blocked by server size limit. Please try again."
        : `Upload failed (HTTP ${res.status}). Server returned non-JSON: ${snip || "(empty)"}`,
    );
  }
}

async function savePhoto(
  subjectType: "company_logo" | "shell_avatar",
  subjectId: string,
  file: File,
): Promise<string> {
  const id = String(subjectId || "").trim();
  if (!id) throw new Error("Employee id is required to save photo");
  if (!(file instanceof File) || file.size <= 0) {
    throw new Error("Please choose a valid image file");
  }
  // Any source size is OK — we shrink in-browser before the network request.
  const uploadFile = await compressProfileImage(file);
  const fd = new FormData();
  fd.append("subjectType", subjectType);
  fd.append("subjectId", id);
  fd.append("file", uploadFile);
  const res = await fetch("/api/profile-picture", { method: "POST", body: fd });
  const data = await readJsonSafe(res);
  if (!res.ok || !data.success) {
    throw new Error(String(data.error || "Failed to save image"));
  }
  clearOrgChartPhotosClientCache();
  return String(data.url || "");
}

async function removePhoto(
  subjectType: "company_logo" | "shell_avatar",
  subjectId: string,
) {
  const id = String(subjectId || "").trim();
  const qs = new URLSearchParams({ subjectType, subjectId: id });
  // Remove from the new file-based store and also clear any legacy base64 row.
  const res = await fetch(`/api/profile-picture?${qs}`, { method: "DELETE" });
  const data = await readJsonSafe(res);
  if (!res.ok || !data.success) {
    throw new Error(String(data.error || "Failed to remove image"));
  }
  await fetch(`/api/admin/org-chart-photos?${qs}`, { method: "DELETE" }).catch(() => {});
  clearOrgChartPhotosClientCache();
}

export function saveCompanyLogo(file: File) {
  return savePhoto("company_logo", SHELL_SUBJECT_IDS.companyLogo, file);
}

export function removeCompanyLogo() {
  return removePhoto("company_logo", SHELL_SUBJECT_IDS.companyLogo);
}

export function saveAdminAvatar(file: File) {
  return savePhoto("shell_avatar", SHELL_SUBJECT_IDS.adminAvatar, file);
}

export function removeAdminAvatar() {
  return removePhoto("shell_avatar", SHELL_SUBJECT_IDS.adminAvatar);
}

export function saveEmployeeAvatar(employeeId: string, file: File) {
  return savePhoto("shell_avatar", employeeId, file);
}

export function removeEmployeeAvatar(employeeId: string) {
  return removePhoto("shell_avatar", employeeId);
}
