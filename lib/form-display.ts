/** Human-readable labels for form template categories. */
export function formCategoryLabel(category: string | undefined | null): string {
  const key = (category || "").toLowerCase();
  const map: Record<string, string> = {
    warning: "Warning",
    appraisal: "Appraisal",
    onboarding: "Onboarding",
    exit: "Exit",
    asset: "Asset",
    leave: "Leave",
    disciplinary: "Disciplinary",
    medical: "Medical",
    general: "General",
    custom: "Custom",
  };
  return map[key] || capitalizeWord(category) || "Form";
}

function capitalizeWord(value: string | undefined | null): string {
  const raw = (value || "").trim();
  if (!raw) return "";
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

export function documentTypeLabel(doc: {
  folder_type?: string;
  source_type?: string;
}): string {
  if (doc.source_type === "employee_upload") return "Personal upload";
  if (doc.source_type === "form_submission") return "Submitted form";
  if (doc.source_type === "appraisal") return "Appraisal";
  if (doc.source_type === "warning") return "Warning";
  if (doc.folder_type === "hr_issued" || doc.source_type === "hr_upload") return "HR issued";
  return (doc.folder_type || "document").replace(/_/g, " ");
}

export function canPreviewMime(mime: string): boolean {
  const m = mime.toLowerCase();
  return (
    m.includes("pdf") ||
    m.startsWith("image/") ||
    m.includes("html") ||
    m.startsWith("text/")
  );
}

/** Default HR message when sending a form by category. */
export function defaultHrMessageForCategory(category: string | undefined | null): string {
  const c = (category || "").toLowerCase();
  if (c === "appraisal") return "Please fill your appraisal form as soon as possible.";
  if (c === "medical") {
    return "Please complete this medical form and submit.";
  }
  return "";
}

export function hrMessageFieldLabel(category: string | undefined | null): string {
  const c = (category || "").toLowerCase();
  if (c === "warning") return "Warning details — employee will see this";
  if (c === "appraisal") return "Message to employee";
  return "Message / instructions for employee";
}

export function hrMessagePlaceholder(category: string | undefined | null): string {
  const c = (category || "").toLowerCase();
  if (c === "warning") {
    return "Describe why this warning is being issued (e.g. repeated tardiness, policy violation…)";
  }
  if (c === "appraisal") return "Please fill your appraisal form as soon as possible.";
  return "Add instructions the employee should read before filling the form…";
}

export function isHrMessageRequired(category: string | undefined | null): boolean {
  return (category || "").toLowerCase() === "warning";
}

/** Default appraisal cycle label — HR can edit when sending the form. */
export function defaultReviewPeriod(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  if (month < 6) return `January ${year} – June ${year}`;
  return `July ${year} – December ${year}`;
}

export function reviewPeriodPlaceholder(): string {
  return "e.g. January 2026 – June 2026, or Annual Review FY 2025–26";
}

export function isReviewPeriodRequired(category: string | undefined | null): boolean {
  return (category || "").toLowerCase() === "appraisal";
}
