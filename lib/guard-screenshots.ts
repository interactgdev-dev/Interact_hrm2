import { NextRequest } from "next/server";

/**
 * Gallery / Backlog Tracker unlock — same password as staging.
 * Default matches System Control + Screenshots secret: penPencil1122!
 * Override with GUARD_SCREENSHOT_GALLERY_PASSWORD in .env.local if needed.
 */
export const GALLERY_COOKIE = "guard_ss_gallery";
export const GALLERY_COOKIE_MAX_AGE = 60 * 60 * 2; // 2 hours

export function galleryPassword(): string {
  return (
    process.env.GUARD_SCREENSHOT_GALLERY_PASSWORD?.trim() || "penPencil1122!"
  );
}

export function isGalleryUnlocked(req: NextRequest): boolean {
  return req.cookies.get(GALLERY_COOKIE)?.value === "1";
}
