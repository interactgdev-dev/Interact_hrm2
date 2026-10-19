"use client";

import React from "react";
import { ModalPortal } from "@/app/components/ModalPortal";
import styles from "./SecretPasswordModal.module.css";

type Props = {
  open: boolean;
  unlocking?: boolean;
  onClose: () => void;
  onSubmit: (password: string) => void | Promise<void>;
  title?: string;
};

/** Shared “Enter password” dialog — same look for System Control + Guard Screenshots. */
export default function SecretPasswordModal({
  open,
  unlocking = false,
  onClose,
  onSubmit,
  title = "Enter password",
}: Props) {
  const [password, setPassword] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (!open) {
      setPassword("");
      setShowPw(false);
      return;
    }
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !unlocking) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, unlocking, onClose]);

  if (!open) return null;

  return (
    <ModalPortal>
      <div
        className={styles.overlay}
        data-hrm-modal-overlay
        role="presentation"
        onClick={() => {
          if (unlocking) return;
          onClose();
        }}
      >
        <div
          className={styles.card}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className={styles.title}>{title}</h2>
          <label htmlFor="secret-pw-input" className={styles.label}>
            Password
          </label>
          <div className={styles.row}>
            <input
              ref={inputRef}
              id="secret-pw-input"
              type={showPw ? "text" : "password"}
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && password && !unlocking) {
                  void onSubmit(password);
                }
              }}
              className={styles.input}
            />
            <button
              type="button"
              className={styles.btnGhost}
              onClick={() => setShowPw((v) => !v)}
            >
              {showPw ? "Hide" : "Show"}
            </button>
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.btnGhost}
              disabled={unlocking}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              disabled={unlocking || !password}
              onClick={() => void onSubmit(password)}
            >
              {unlocking ? "…" : "Enter"}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
