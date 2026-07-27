"use client";

import React from "react";
import { createPortal } from "react-dom";
import { FaCamera, FaUser } from "react-icons/fa";
import { PROFILE_IMAGE_ACCEPT } from "@/lib/document-constants";
import { saveEmployeeAvatar } from "../../shell-branding-api";
import { toastError } from "@/lib/app-toast";
import styles from "./hero-profile-avatar.module.css";

type Props = {
  employeeId: string;
  name: string;
  initials: string;
  photo: string | null;
  onAvatarUpdated: (url: string) => void;
  /** Dashboard profile card — larger circle + "Update image" hover bar */
  variant?: "hero" | "card";
};

function PreviewModal({
  image,
  initials,
  name,
  onClose,
}: {
  image: string | null;
  initials: string;
  name: string;
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
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <div
        className={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${name} profile photo`}
      >
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className={styles.ring}>
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={name} className={styles.previewImg} />
          ) : (
            <span className={styles.previewPlaceholder}>{initials.charAt(0).toUpperCase()}</span>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export function HeroProfileAvatar({
  employeeId,
  name,
  initials,
  photo,
  onAvatarUpdated,
  variant = "hero",
}: Props) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const isCard = variant === "card";

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !employeeId) return;
    setUploading(true);
    try {
      const url = await saveEmployeeAvatar(employeeId, file);
      onAvatarUpdated(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save profile photo.";
      toastError(msg);
    } finally {
      setUploading(false);
    }
  }

  function openPicker(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    inputRef.current?.click();
  }

  return (
    <>
      <div className={`${styles.wrap}${isCard ? ` ${styles.wrapCard}` : ""}`}>
        <button
          type="button"
          className={styles.previewBtn}
          title="View profile photo"
          aria-label="View profile photo"
          onClick={() => setPreviewOpen(true)}
        >
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" className={styles.img} />
          ) : (
            <span className={styles.placeholder} aria-hidden>
              <FaUser className={styles.placeholderIcon} />
              <span className={styles.initials}>{initials}</span>
            </span>
          )}
        </button>

        <button
          type="button"
          className={styles.uploadBar}
          title="Update image"
          aria-label="Update profile image"
          onClick={openPicker}
          disabled={uploading || !employeeId}
        >
          <FaCamera className={styles.uploadIcon} aria-hidden />
          <span>{uploading ? "…" : isCard ? "Update image" : "Upload"}</span>
        </button>

        <input
          ref={inputRef}
          type="file"
          accept={PROFILE_IMAGE_ACCEPT}
          className={styles.hiddenInput}
          onChange={handleFileChange}
        />
      </div>

      {previewOpen ? (
        <PreviewModal
          image={photo}
          initials={initials}
          name={name}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </>
  );
}
