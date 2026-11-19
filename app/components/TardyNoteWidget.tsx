"use client";

import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ATTENDANCE_DATA_CHANGED } from "@/lib/ui-sync/breakPrayerDataRefresh";
import { getDateStringInTimeZone, SERVER_TIMEZONE } from "@/lib/timezone";
import {
  countWords,
  TARDY_NOTE_OPTIONS,
  TARDY_NOTE_OTHER_CODE,
  TARDY_NOTE_OTHER_MAX_WORDS,
  type TardyNoteOption,
} from "@/lib/tardy-note-options";
import styles from "./tardy-note-slack.module.css";

export function TardyNoteWidget({
  employeeId,
  variant: _variant = "default",
}: {
  employeeId: string;
  /** Kept for call-site compatibility; UI is always the compulsory modal. */
  variant?: "default" | "slack";
}) {
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [selectedCode, setSelectedCode] = useState("");
  const [otherText, setOtherText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [attendanceDate, setAttendanceDate] = useState(() =>
    getDateStringInTimeZone(new Date(), SERVER_TIMEZONE)
  );

  const otherWordCount = countWords(otherText);
  const isOther = selectedCode === TARDY_NOTE_OTHER_CODE;
  const canSubmit =
    Boolean(selectedCode) &&
    !submitting &&
    (!isOther || (otherWordCount >= 1 && otherWordCount <= TARDY_NOTE_OTHER_MAX_WORDS));

  useEffect(() => {
    setMounted(true);
  }, []);

  const refresh = useCallback(async () => {
    const id = String(employeeId || "").trim();
    if (!id) {
      setVisible(false);
      return;
    }
    const today = getDateStringInTimeZone(new Date(), SERVER_TIMEZONE);
    try {
      const res = await fetch(
        `/api/tardy-notes?employeeId=${encodeURIComponent(id)}&date=${encodeURIComponent(today)}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (!data.success) {
        setVisible(false);
        return;
      }
      setVisible(Boolean(data.success && data.isLate && data.isClockedIn && data.canAddNote));
      setAttendanceDate(data.attendanceDate || today);
      if (!data.canAddNote) {
        setSelectedCode("");
        setOtherText("");
      }
    } catch {
      setVisible(false);
    }
  }, [employeeId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onAttendanceChanged = () => {
      void refresh();
    };
    window.addEventListener(ATTENDANCE_DATA_CHANGED, onAttendanceChanged);
    return () => window.removeEventListener(ATTENDANCE_DATA_CHANGED, onAttendanceChanged);
  }, [refresh]);

  // Block Escape only. Background scroll uses overlay pointer-events:none
  // (no wheel capture / preventDefault — that caused scroll jank).
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [visible]);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setMessage("");
    try {
      const res = await fetch("/api/tardy-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId,
          attendanceDate,
          noteCode: selectedCode,
          noteText: isOther ? otherText : undefined,
        }),
      });
      const data = await res.json();
      if (data.success && data.note) {
        setVisible(false);
        setSelectedCode("");
        setOtherText("");
        return;
      }
      setMessage(data.error || "Could not submit");
    } catch {
      setMessage("Could not submit");
    } finally {
      setSubmitting(false);
    }
  };

  if (!visible || !mounted) return null;

  const modal = (
    <div
      className={styles.overlay}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="tardy-note-title"
      aria-describedby="tardy-note-desc"
    >
      <div id="tardy-note-dialog" className={styles.dialog}>
        <div className={styles.header}>
          <span className={styles.badge}>Late today</span>
          <h2 id="tardy-note-title" className={styles.title}>
            Why were you late?
          </h2>
          <p id="tardy-note-desc" className={styles.subtitle}>
            Select a reason to continue.{" "}
            <span className={styles.required}>Required</span>
          </p>
        </div>

        <div>
          <label className={styles.label} htmlFor="tardy-note-select">
            Reason <span className={styles.required}>*</span>
          </label>
          <select
            id="tardy-note-select"
            className={styles.select}
            value={selectedCode}
            onChange={(e) => {
              const next = e.target.value;
              setSelectedCode(next);
              if (next !== TARDY_NOTE_OTHER_CODE) setOtherText("");
              setMessage("");
            }}
            aria-required="true"
            autoFocus
          >
            <option value="">Select a reason…</option>
            {TARDY_NOTE_OPTIONS.map((opt: TardyNoteOption) => (
              <option key={opt.code} value={opt.code}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {isOther ? (
          <div>
            <label className={styles.label} htmlFor="tardy-note-other">
              Explain (max {TARDY_NOTE_OTHER_MAX_WORDS} words){" "}
              <span className={styles.required}>*</span>
            </label>
            <textarea
              id="tardy-note-other"
              className={styles.textarea}
              value={otherText}
              onChange={(e) => {
                setOtherText(e.target.value);
                setMessage("");
              }}
              placeholder="Write your reason…"
              rows={3}
              maxLength={2500}
              aria-required="true"
            />
            <div
              className={`${styles.wordCount} ${otherWordCount > TARDY_NOTE_OTHER_MAX_WORDS ? styles.wordCountError : ""}`}
            >
              {otherWordCount}/{TARDY_NOTE_OTHER_MAX_WORDS} words
            </div>
          </div>
        ) : null}

        {message ? <div className={styles.error}>{message}</div> : null}

        <button
          type="button"
          className={styles.submit}
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {submitting ? "Submitting…" : "Submit"}
        </button>
        <p className={styles.hint}>Cannot close until a reason is submitted.</p>
      </div>
    </div>
  );

  // Portal to body so sticky summary tables cannot cover the modal (dock has low z-index).
  return createPortal(modal, document.body);
}
