"use client";

import React from "react";
import LayoutDashboard from "../../layout-dashboard";
import styles from "../../attendance-summary/attendance-summary.module.css";

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
        body: JSON.stringify({ date: iso, status, note })
      });
      const data = await res.json();
      if (data?.success) {
        const nextNote = note ?? overrides[iso]?.note ?? null;
        setOverrides((prev) => ({
          ...prev,
          [iso]: { date: iso, status, note: nextNote }
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
    <LayoutDashboard>
      <style>{`
        .calendar-container {
          background: #fff;
          border-radius: 18px;
          box-shadow: 0 4px 24px rgba(0,82,204,0.08);
          padding: 24px;
          margin-bottom: 24px;
          border: 1px solid #E2E8F0;
          max-width: 100%;
          overflow: hidden;
        }
        .calendar-header {
          margin-bottom: 20px;
        }
        .calendar-title {
          font-size: 1.5rem;
          font-weight: 700;
          color: #22223B;
          margin-bottom: 4px;
        }
        .calendar-subtitle {
          color: #4A5568;
          font-size: 0.9rem;
        }
        .calendar-controls {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: 16px;
          flex-wrap: wrap;
        }
        .calendar-btn {
          padding: 10px 18px;
          border-radius: 10px;
          border: none;
          font-weight: 600;
          font-size: 0.9rem;
          cursor: pointer;
          transition: all 0.3s;
          background: linear-gradient(135deg, #0052CC 0%, #00B8A9 100%);
          color: white;
          box-shadow: 0 2px 8px rgba(0,82,204,0.25);
        }
        .calendar-btn:hover {
          box-shadow: 0 4px 16px rgba(0,82,204,0.35);
          transform: translateY(-2px);
        }
        .calendar-btn.secondary {
          background: #F7FAFC;
          color: #22223B;
          border: 2px solid #E2E8F0;
          box-shadow: none;
        }
        .calendar-btn.secondary:hover {
          background: #E2E8F0;
        }
        .calendar-month-label {
          font-weight: 700;
          color: #22223B;
          font-size: 1.1rem;
          margin: 0 8px;
        }
        .weekday-row {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 6px;
          margin: 16px 0 8px;
          font-weight: 600;
          color: #4A5568;
          text-transform: uppercase;
          font-size: 0.7rem;
          letter-spacing: 0.5px;
        }
        .weekday-cell {
          text-align: center;
          padding: 4px;
        }
        .days-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 6px;
        }
        .day-card {
          border-radius: 8px;
          padding: 6px;
          min-height: 85px;
          border: 1px solid #E2E8F0;
          background: #fff;
          display: flex;
          flex-direction: column;
          gap: 4px;
          transition: all 0.2s;
        }
        .day-card:hover {
          box-shadow: 0 2px 8px rgba(0,82,204,0.15);
          border-color: #0052CC;
        }
        .day-card.off {
          background: #FFF5F5;
          border-color: #FEB2B2;
        }
        .day-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 2px;
        }
        .day-num {
          font-weight: 700;
          color: #22223B;
          font-size: 0.85rem;
        }
        .day-pill {
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 0.6rem;
          font-weight: 700;
          text-transform: uppercase;
        }
        .day-pill.off { 
          background: #FEB2B2; 
          color: #742A2A; 
        }
        .day-pill.work { 
          background: #9AE6B4; 
          color: #22543D; 
        }
        .day-week {
          font-size: 0.65rem;
          color: #718096;
          margin-bottom: 2px;
        }
        .day-select, .day-note {
          border-radius: 6px;
          border: 1px solid #E2E8F0;
          padding: 4px 6px;
          background: #F7FAFC;
          font-size: 0.7rem;
          width: 100%;
        }
        .day-select {
          font-weight: 600;
        }
        .day-note {
          font-weight: 400;
          resize: none;
          font-family: inherit;
        }
        .day-note:disabled {
          background: #F7FAFC;
          color: #718096;
        }
        .day-actions {
          display: flex;
          gap: 3px;
          margin-top: 2px;
        }
        .day-btn {
          padding: 3px 6px;
          border-radius: 4px;
          border: none;
          font-size: 0.65rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          flex: 1;
        }
        .day-btn.edit {
          background: #E2E8F0;
          color: #22223B;
        }
        .day-btn.edit:hover {
          background: #CBD5E0;
        }
        .day-btn.set {
          background: #0052CC;
          color: white;
        }
        .day-btn.set:hover {
          background: #003D99;
        }
        .day-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .saving-chip {
          font-size: 0.65rem;
          color: #4A5568;
          font-style: italic;
        }
        @media (max-width: 1100px) {
          .days-grid, .weekday-row { 
            grid-template-columns: repeat(5, 1fr); 
          }
        }
        @media (max-width: 768px) {
          .days-grid, .weekday-row { 
            grid-template-columns: repeat(3, 1fr); 
          }
          .calendar-controls {
            justify-content: center;
          }
        }
      `}</style>
      <div className="calendar-container">
        <div className="calendar-header">
          <div className="calendar-title">Calendar Management</div>
          <div className="calendar-subtitle">Set company off days and working days with notes.</div>
          <div className="calendar-controls">
            <button onClick={handlePrevMonth} className="calendar-btn secondary">Prev</button>
            <div className="calendar-month-label">{formatMonthLabel(currentMonth)}</div>
            <button onClick={handleNextMonth} className="calendar-btn">Next</button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 12, color: "#4A5568" }}>Loading...</div>
        ) : (
          <div>
            <div className="weekday-row">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="weekday-cell">{d}</div>
              ))}
            </div>

            <div className="days-grid">
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
                  <div key={iso} className={`day-card ${isOff ? "off" : ""}`}> 
                    <div className="day-top">
                      <div className="day-num">{day.getDate()}</div>
                      <span className={`day-pill ${isOff ? "off" : "work"}`}>{statusLabel}</span>
                    </div>
                    <div className="day-week">{day.toLocaleString("en-US", { weekday: "short" })}</div>
                    {!isEditing && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingNote((prev) => ({ ...prev, [iso]: true }));
                          if (noteDrafts[iso] === undefined) {
                            setNoteDrafts((prev) => ({ ...prev, [iso]: overrides[iso]?.note ?? "" }));
                          }
                        }}
                        style={{
                          width: '100%',
                          marginTop: 8,
                          padding: '8px 0',
                          borderRadius: '10px',
                          background: 'linear-gradient(135deg, #00B8A9 0%, #0052CC 100%)',
                          color: '#fff',
                          fontWeight: 700,
                          fontSize: '0.95rem',
                          border: 'none',
                          boxShadow: '0 2px 8px rgba(0,82,204,0.10)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                          cursor: 'pointer',
                          transition: 'background 0.2s',
                        }}
                        className="calendar-edit-btn"
                      >
                        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" style={{ marginRight: 5 }}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828a4 4 0 01-1.414.828l-4.243 1.414 1.414-4.243a4 4 0 01.828-1.414z" />
                        </svg>
                        Edit Day
                      </button>
                    )}
                    {isEditing && (
                      <div style={{ position: 'relative', zIndex: 10, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, padding: 8, marginTop: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                          <button
                            type="button"
                            aria-label="Close"
                            onClick={() => setEditingNote((prev) => ({ ...prev, [iso]: false }))}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              padding: 2,
                              marginRight: 2,
                              marginBottom: 2,
                              display: 'flex',
                              alignItems: 'center',
                            }}
                          >
                            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="#22223B" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l8 8M6 14L14 6" />
                            </svg>
                          </button>
                        </div>
                        <select
                          value={status}
                          onChange={(e) => updateDay(day, e.target.value as "off" | "working", noteValue)}
                          disabled={isSaving}
                          className="day-select"
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
                          className="day-note"
                          style={{ marginTop: 4 }}
                        />
                        <div className="day-actions">
                          <button
                            className="day-btn set"
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
                        {isSaving && <div className="saving-chip">Saving...</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </LayoutDashboard>
  );
}
