"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { FaCamera, FaKey, FaSignOutAlt } from "react-icons/fa";
import { PROFILE_IMAGE_ACCEPT } from "@/lib/document-constants";
import { saveEmployeeAvatar } from "../../shell-branding-api";
import { UpdatePasswordModal } from "./UpdatePasswordModal";
import styles from "./employee-profile-menu.module.css";
import { toastError } from "@/lib/app-toast";
import { clearPortalSessionKeys } from "@/lib/access-control/employee-shell";

type Props = {
  employeeId: string;
  onAvatarUpdated: (dataUrl: string) => void;
  /** Open menu upward (e.g. sidebar footer) */
  dropUp?: boolean;
  /** Light button for dark backgrounds */
  tone?: "default" | "onDark";
};

export function EmployeeProfileMenu({
  employeeId,
  onAvatarUpdated,
  dropUp = false,
  tone = "default",
}: Props) {
  const router = useRouter();
  const menuRef = React.useRef<HTMLDivElement>(null);
  const photoInputRef = React.useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [passwordOpen, setPasswordOpen] = React.useState(false);
  const [uploadingPhoto, setUploadingPhoto] = React.useState(false);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      window.addEventListener("mousedown", handleClickOutside);
      return () => window.removeEventListener("mousedown", handleClickOutside);
    }
  }, [menuOpen]);

  function openPhotoPicker() {
    setMenuOpen(false);
    photoInputRef.current?.click();
  }

  function openPasswordModal() {
    setMenuOpen(false);
    setPasswordOpen(true);
  }

  function handleLogout() {
    setMenuOpen(false);
    if (typeof window !== "undefined") {
      localStorage.removeItem("loginId");
      clearPortalSessionKeys();
    }
    router.push("/auth");
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !employeeId) return;

    setUploadingPhoto(true);
    try {
      const url = await saveEmployeeAvatar(employeeId, file);
      onAvatarUpdated(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save profile photo.";
      toastError(msg);
    } finally {
      setUploadingPhoto(false);
    }
  }

  return (
    <>
      <div className={`${styles.menuWrap} ${menuOpen ? styles.menuWrapOpen : ""}`} ref={menuRef}>
        <button
          type="button"
          className={`${styles.menuBtn} ${menuOpen ? styles.menuBtnOpen : ""} ${tone === "onDark" ? styles.menuBtnOnDark : ""}`}
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="Account menu"
          aria-expanded={menuOpen}
        >
          <span className={styles.menuDots}>⋮</span>
        </button>

        {menuOpen ? (
          <div
            className={`${styles.dropdown} ${dropUp ? styles.dropdownUp : ""}`}
            role="menu"
          >
            <button
              type="button"
              className={styles.menuItem}
              role="menuitem"
              onClick={openPhotoPicker}
              disabled={uploadingPhoto}
            >
              <span className={styles.menuIcon}>
                <FaCamera />
              </span>
              {uploadingPhoto ? "Uploading photo…" : "Update profile picture"}
            </button>
            <button
              type="button"
              className={styles.menuItem}
              role="menuitem"
              onClick={openPasswordModal}
            >
              <span className={styles.menuIcon}>
                <FaKey />
              </span>
              Update password
            </button>
            <div className={styles.menuDivider} aria-hidden />
            <button
              type="button"
              className={`${styles.menuItem} ${styles.menuItemLogout}`}
              role="menuitem"
              onClick={handleLogout}
            >
              <span className={styles.menuIcon}>
                <FaSignOutAlt />
              </span>
              Logout
            </button>
          </div>
        ) : null}

        <input
          ref={photoInputRef}
          type="file"
          accept={PROFILE_IMAGE_ACCEPT}
          className={styles.hiddenInput}
          onChange={handlePhotoChange}
          aria-hidden
        />
      </div>

      <UpdatePasswordModal
        open={passwordOpen}
        employeeId={employeeId}
        onClose={() => setPasswordOpen(false)}
      />
    </>
  );
}
