"use client";

import React from "react";
import { createPortal } from "react-dom";
import styles from "./shell-image-upload.module.css";
import { readImageFileAsDataUrl } from "../../lib/shell-branding-storage";
import { PROFILE_IMAGE_ACCEPT } from "@/lib/document-constants";
import { toastError } from "@/lib/app-toast";

type Props = {
  variant: "logo" | "avatar";
  image: string | null;
  fallbackInitial?: string;
  title?: string;
  /** dataUrl = light preview for instant UI, file = original for HD upload. */
  onImage: (dataUrl: string, file: File) => void;
  onRemove?: () => void;
};

function AvatarPreviewModal({
  image,
  fallbackInitial,
  onClose,
}: {
  image: string | null;
  fallbackInitial: string;
  onClose: () => void;
}) {
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className={styles.previewBackdrop}
      onClick={onClose}
      role="presentation"
    >
      <div
        className={styles.previewDialog}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Profile photo preview"
      >
        <button
          type="button"
          className={styles.previewClose}
          onClick={onClose}
          aria-label="Close preview"
        >
          ×
        </button>
        <div className={styles.previewRing}>
          {image ? (
            <img src={image} alt="" className={styles.previewImage} />
          ) : (
            <span className={styles.previewPlaceholder}>
              {fallbackInitial.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export function ShellImageUpload({
  variant,
  image,
  fallbackInitial = "?",
  title = "Upload image",
  onImage,
  onRemove,
}: Props) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [previewOpen, setPreviewOpen] = React.useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      // Small preview only — the original HD file is uploaded as-is below.
      const previewUrl = await readImageFileAsDataUrl(file, { maxDim: 512, quality: 0.85 });
      onImage(previewUrl, file);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed.";
      toastError(msg);
    }
  }

  function handleRemove(e: React.MouseEvent) {
    e.stopPropagation();
    onRemove?.();
  }

  function openFilePicker(e: React.MouseEvent) {
    e.stopPropagation();
    inputRef.current?.click();
  }

  const sizeClass = variant === "logo" ? styles.logo : styles.avatar;
  const placeholderClass =
    variant === "logo" ? styles.placeholderLogo : styles.placeholderAvatar;

  return (
    <>
      <div className={variant === "logo" ? `${styles.wrap} ${styles.wrapLogo}` : styles.wrap}>
        {variant === "avatar" ? (
          <div className={`${styles.btn} ${sizeClass} ${styles.avatarFrame}`}>
            <button
              type="button"
              className={styles.avatarPreviewBtn}
              title="View profile photo"
              aria-label="View profile photo"
              onClick={() => setPreviewOpen(true)}
            >
              {image ? (
                <img src={image} alt="" className={styles.image} />
              ) : (
                <span className={`${styles.image} ${placeholderClass}`}>
                  {fallbackInitial.charAt(0).toUpperCase()}
                </span>
              )}
            </button>
            <button
              type="button"
              className={styles.editBtn}
              title={title}
              aria-label={title}
              onClick={openFilePicker}
            >
              <svg className={styles.editIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={`${styles.btn} ${sizeClass}`}
            title={title}
            aria-label={title}
            onClick={() => inputRef.current?.click()}
          >
            {image ? (
              <img src={image} alt="" className={styles.image} />
            ) : (
              <span className={`${styles.image} ${placeholderClass}`} />
            )}
            <span className={styles.overlay} aria-hidden>
              <svg className={styles.overlayIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </span>
          </button>
        )}
        {image && onRemove ? (
          <button
            type="button"
            className={styles.removeBtn}
            title="Remove image"
            aria-label="Remove image"
            onClick={handleRemove}
          >
            ×
          </button>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept={PROFILE_IMAGE_ACCEPT}
          className={styles.input}
          onChange={handleChange}
        />
      </div>
      {variant === "avatar" && previewOpen ? (
        <AvatarPreviewModal
          image={image}
          fallbackInitial={fallbackInitial}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </>
  );
}
