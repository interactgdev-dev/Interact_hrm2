"use client";

import React from "react";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import styles from "../admin-page.module.css";
import cal from "./calendar.module.css";

interface CalendarDayOverride {
  date: string;
  status: "off" | "working";
  note?: string | null;
}

function formatMonthLabel(date: Date) {
  return date.toLocaleString("en-US", { month: "long", year: "numeric" });
}

function formatISO(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isWeekend(date: Date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function getMonthDays(date: Date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const days: Date[] = [];
  for (let i = 1; i <= lastDay; i += 1) {
    days.push(new Date(year, month, i));
  }
  return days;
}

export default function AdminCalendarPage() {
  const [currentMonth, setCurrentMonth] = React.useState(new Date());
  const [overrides, setOverrides] = React.useState<Record<string, CalendarDayOverride>>({});
  const [loading, setLoading] = React.useState(false);
  const [savingDate, setSavingDate] = React.useState<string | null>(null);
  const [editingNote, setEditingNote] = React.useState<Record<string, boolean>>({});
  const [noteDrafts, setNoteDrafts] = React.useState<Record<string, string>>({});

  const fetchOverrides = React.useCallback(async () => {
    try {
      setLoading(true);
      const month = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, "0")}`;
      const res = await fetch(`/api/calendar?month=${month}`, { cache: "no-store" });
      const data = await res.json();
      if (data?.success) {
        const map: Record<string, CalendarDayOverride> = {};
        (data.days || []).forEach((d: CalendarDayOverride) => {
          map[d.date] = d;
        });
        setOverrides(map);
      }
    } catch (error) {
      console.error("calendar fetch", error);
    } finally {
      setLoading(false);
    }
  }, [currentMonth]);

  React.useEffect(() => {
    fetchOverrides();
  }, [fetchOverrides]);

  const monthDays = React.useMemo(() => getMonthDays(currentMonth), [currentMonth]);
  const firstDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();

  function getStatus(date: Date) {
    const iso = formatISO(date);
    const override = overrides[iso];
    if (override) return override.status;
    return isWeekend(date) ? "off" : "working";
  }

  function getStatusLabel(date: Date) {
    return getStatus(date) === "off" ? "Off" : "Working";
  }

  async function updateDay(date: Date, status: "off" | "working", note?: string | null) {
    const iso = formatISO(date);
    try {
      setSavingDate(iso);
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: iso, status, note }),
      });
      const data = await res.json();
      if (data?.success) {
        const nextNote = note ?? overrides[iso]?.note ?? null;
        setOverrides((prev) => ({
          ...prev,
          [iso]: { date: iso, status, note: nextNote },
        }));
      }
    } catch (error) {
      console.error("calendar update", error);
    } finally {
      setSavingDate(null);
    }
  }

  function handlePrevMonth() {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  }

  function handleNextMonth() {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  }

  return (
    <OptionalAdminShell>
      <div className={styles.page}>
        <div className={styles.inner}>
          <h1 className={styles.title}>Leave calendar</h1>
          <p className={styles.subtitle}>Mark company off days and working days, with optional notes.</p>

          <div className={styles.card}>
            <div className={cal.controls}>
              <button type="button" onClick={handlePrevMonth} className={styles.btnSecondary}>
                Prev
              </button>
              <div className={cal.monthLabel}>{formatMonthLabel(currentMonth)}</div>
              <button type="button" onClick={handleNextMonth} className={styles.btnPrimary}>
                Next
              </button>
            </div>

            {loading ? (
              <p className={styles.muted} style={{ padding: 12 }}>
                Loading…
              </p>
            ) : (
              <div>
                <div className={cal.weekdayRow}>
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                    <div key={d} className={cal.weekdayCell}>
                      {d}
                    </div>
                  ))}
                </div>

                <div className={cal.daysGrid}>
                  {Array.from({ length: firstDay }).map((_, idx) => (
                    <div key={`empty-${idx}`} />
                  ))}
                  {monthDays.map((day) => {
                    const iso = formatISO(day);
                    const status = getStatus(day);
                    const statusLabel = getStatusLabel(day);
                    const isOff = status === "off";
                    const isSaving = savingDate === iso;
                    const noteValue = noteDrafts[iso] ?? overrides[iso]?.note ?? "";
                    const isEditing = editingNote[iso] === true;

                    return (
                      <div
                        key={iso}
                        className={`${cal.dayCard} ${isOff ? cal.dayCardOff : ""}`}
                      >
                        <div className={cal.dayTop}>
                          <div className={cal.dayNum}>{day.getDate()}</div>
                          <span
                            className={`${cal.dayPill} ${isOff ? cal.dayPillOff : cal.dayPillWork}`}
                          >
                            {statusLabel}
                          </span>
                        </div>
                        <div className={cal.dayWeek}>
                          {day.toLocaleString("en-US", { weekday: "short" })}
                        </div>
                        {!isEditing && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingNote((prev) => ({ ...prev, [iso]: true }));
                              if (noteDrafts[iso] === undefined) {
                                setNoteDrafts((prev) => ({
                                  ...prev,
                                  [iso]: overrides[iso]?.note ?? "",
                                }));
                              }
                            }}
                            className={styles.btnGreen}
                            style={{
                              width: "100%",
                              marginTop: 8,
                              padding: "8px 0",
                              fontSize: "0.8rem",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 6,
                            }}
                          >
                            Edit day
                          </button>
                        )}
                        {isEditing && (
                          <div className={cal.editPanel}>
                            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
                              <button
                                type="button"
                                aria-label="Close"
                                onClick={() =>
                                  setEditingNote((prev) => ({ ...prev, [iso]: false }))
                                }
                                style={{
                                  background: "none",
                                  border: "none",
                                  cursor: "pointer",
                                  padding: 2,
                                  fontWeight: 700,
                                  color: "#64748b",
                                }}
                              >
                                ✕
                              </button>
                            </div>
                            <select
                              value={status}
                              onChange={(e) =>
                                updateDay(day, e.target.value as "off" | "working", noteValue)
                              }
                              disabled={isSaving}
                              className={cal.daySelect}
                            >
                              <option value="working">Working</option>
                              <option value="off">Off</option>
                            </select>
                            <input
                              type="text"
                              value={noteValue}
                              disabled={!isEditing}
                              onChange={(e) => {
                                const next = e.target.value;
                                setNoteDrafts((prev) => ({ ...prev, [iso]: next }));
                              }}
                              placeholder="Note"
                              className={cal.dayNote}
                              style={{ marginTop: 4 }}
                            />
                            <div className={cal.dayActions}>
                              <button
                                className={cal.dayBtnSet}
                                type="button"
                                disabled={!isEditing || isSaving}
                                onClick={() => {
                                  setEditingNote((prev) => ({ ...prev, [iso]: false }));
                                  updateDay(day, status, noteValue);
                                }}
                              >
                                Set
                              </button>
                            </div>
                            {isSaving ? <div className={cal.savingChip}>Saving…</div> : null}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </OptionalAdminShell>
  );
}
