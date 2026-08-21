"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { FaCamera, FaKey, FaSignOutAlt } from "react-icons/fa";
import { PROFILE_IMAGE_ACCEPT } from "@/lib/document-constants";
import { saveAdminAvatar } from "@/app/shell-branding-api";
import { toastError } from "@/lib/app-toast";
import { AdminUpdatePasswordModal } from "./AdminUpdatePasswordModal";
import menuStyles from "@/app/employee-dashboard/components/employee-profile-menu.module.css";

type Props = {
  onAvatarUpdated: (dataUrl: string) => void;
};

export function AdminProfileMenu({ onAvatarUpdated }: Props) {
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

  function handleLogout() {
    setMenuOpen(false);
    const loginId =
      typeof window !== "undefined"
        ? String(localStorage.getItem("loginId") || "").trim()
        : "";
    if (typeof window !== "undefined") localStorage.removeItem("loginId");
    try {
      void fetch("/api/internal/admin-activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: [{ type: "admin_logout", loginId, page: window.location.pathname }],
        }),
        credentials: "same-origin",
        keepalive: true,
      });
      // clear httpOnly actor cookie via activity logout event
    } catch {
      // ignore
    }
    router.push("/auth");
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const url = await saveAdminAvatar(file);
      onAvatarUpdated(url);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not save profile photo.");
    } finally {
      setUploadingPhoto(false);
    }
  }

  return (
    <>
      <div className={menuStyles.menuWrap} ref={menuRef}>
        <button
          type="button"
          className={`${menuStyles.menuBtn} ${menuOpen ? menuStyles.menuBtnOpen : ""}`}
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Account menu"
          aria-expanded={menuOpen}
        >
          <span className={menuStyles.menuDots}>⋮</span>
        </button>
        {menuOpen ? (
          <div className={menuStyles.dropdown} role="menu">
            <button
              type="button"
              className={menuStyles.menuItem}
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                photoInputRef.current?.click();
              }}
              disabled={uploadingPhoto}
            >
              <span className={menuStyles.menuIcon}>
                <FaCamera />
              </span>
              {uploadingPhoto ? "Uploading photo…" : "Update profile picture"}
            </button>
            <button
              type="button"
              className={menuStyles.menuItem}
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setPasswordOpen(true);
              }}
            >
              <span className={menuStyles.menuIcon}>
                <FaKey />
              </span>
              Update password
            </button>
            <div className={menuStyles.menuDivider} aria-hidden />
            <button
              type="button"
              className={`${menuStyles.menuItem} ${menuStyles.menuItemLogout}`}
              role="menuitem"
              onClick={handleLogout}
            >
              <span className={menuStyles.menuIcon}>
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
          className={menuStyles.hiddenInput}
          onChange={handlePhotoChange}
          aria-hidden
        />
      </div>
      <AdminUpdatePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </>
  );
}
