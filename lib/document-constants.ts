export const MAX_PROFILE_IMAGE_BYTES = 100 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;

/** Any image the OS picker offers — client compresses to JPEG before upload. */
export const PROFILE_IMAGE_ACCEPT = "image/*";
export const PROFILE_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/heic",
  "image/heif",
  "image/avif",
]);

export const DOCUMENT_UPLOAD_MIMES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
]);

export const DOCUMENT_UPLOAD_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.txt,application/pdf,image/png,image/jpeg,image/webp";

export const EMPLOYEE_FILES_DIR = "employee-files";
