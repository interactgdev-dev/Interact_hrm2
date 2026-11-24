"use client";

import React from "react";
import {
  FaClock,
  FaUsers,
  FaTicketAlt,
  FaUser,
  FaFileAlt,
} from "react-icons/fa";
import {
  getLastAdminMessage,
  hasUnreadAdminReply,
  type TicketThreadMessage,
} from "../../lib/ticket-thread";
import type { TicketCategory } from "../../lib/ticket-catalog";
import dynamic from "next/dynamic";
import { getParts, SERVER_TIMEZONE } from "../../lib/timezone";
import styles from "./employee-dashboard.module.css";

const TardyNoteWidget = dynamic(
  () => import("../components/TardyNoteWidget").then((m) => m.TardyNoteWidget),
  { ssr: false, loading: () => null },
);

type TicketWidgetRow = {
  id: number;
  ticket_number: string;
  subject: string | null;
  status: string;
  category: TicketCategory;
  ticket_type: string;
  employee_name?: string | null;
  employee_id?: string | null;
  messages?: TicketThreadMessage[];
  updated_at: string;
  approved_by?: string | null;
  approved_by_name?: string | null;
};

type WeekDay = {
  label: string;
  dateKey: string;
  hours: number;
  status: "onTime" | "tardy" | "absent" | "pending" | "upcoming";
  lateMinutes: number;
  isToday: boolean;
};

type UpcomingEvent = {
  id: string | number;
  title: string;
  start_at: string;
  color?: string;
  source?: string;
};

function ticketStatusLabel(status: string, ticketType?: string) {
  if (ticketType === "leave" && status === "resolved") return "approved";
  return status.replace("_", " ");
}

function ticketDecidedByLabel(ticket: TicketWidgetRow): string | null {
  const name = String(ticket.approved_by_name || "").trim();
  if (!name) return null;
  if (ticket.status === "rejected") return `Rejected by ${name}`;
  if (ticket.status === "resolved" || ticket.status === "closed") {
    return ticket.ticket_type === "leave"
      ? `Approved by ${name}`
      : `Resolved by ${name}`;
  }
  return null;
}

function formatShiftTime(raw?: string | null) {
  if (!raw) return "—";
  const m = String(raw).match(/(\d{1,2}):(\d{2})/);
  if (!m) return String(raw);
  let h = Number(m[1]);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${min} ${ampm}`;
}

function formatHours(hours: number) {
  if (!hours || hours <= 0) return "0h";
  const totalMinutes = Math.floor(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h <= 0 && m <= 0) return "0h";
  if (m <= 0) return `${h}h`;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function formatElapsedHms(totalSeconds: number) {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

function elapsedSecondsBetween(startIso: string, endIso?: string | null) {
  const inParts = getParts(startIso, SERVER_TIMEZONE);
  if (!inParts) return 0;
  const start = Date.UTC(
    inParts.year,
    inParts.month - 1,
    inParts.day,
    inParts.hour,
    inParts.minute,
    inParts.second
  );
  let end = Date.now();
  if (endIso) {
    const outParts = getParts(endIso, SERVER_TIMEZONE);
    if (outParts) {
      end = Date.UTC(
        outParts.year,
        outParts.month - 1,
        outParts.day,
        outParts.hour,
        outParts.minute,
        outParts.second
      );
    }
  } else {
    const nowParts = getParts(new Date(), SERVER_TIMEZONE);
    if (nowParts) {
      end = Date.UTC(
        nowParts.year,
        nowParts.month - 1,
        nowParts.day,
        nowParts.hour,
        nowParts.minute,
        nowParts.second
      );
    }
  }
  return Math.max(0, Math.floor((end - start) / 1000));
}

/** Same 1s Karachi elapsed clock as Working timer — never rounds minutes ahead. */
const LiveHoursToday = React.memo(function LiveHoursToday({
  clockInAt,
  clockOutAt,
}: {
  clockInAt?: string | null;
  clockOutAt?: string | null;
}) {
  const [label, setLabel] = React.useState("00h 00m 00s");

  React.useEffect(() => {
    if (!clockInAt) {
      setLabel("00h 00m 00s");
      return;
    }
    const tick = () => {
      setLabel(formatElapsedHms(elapsedSecondsBetween(clockInAt, clockOutAt)));
    };
    tick();
    if (clockOutAt) return;
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [clockInAt, clockOutAt]);

  return <>{label}</>;
});

function eventParts(startAt: string) {
  const key = String(startAt || "").slice(0, 10);
  const [y, mo, d] = key.split("-").map(Number);
  if (!y || !mo || !d) return { day: "—", mon: "", when: "" };
  const instant = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  const day = String(d);
  const mon = new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC",
  }).format(instant);
  const when = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(instant);
  return { day, mon, when };
}

function barClass(status: WeekDay["status"]) {
  if (status === "onTime") return styles.weekBarOnTime;
  if (status === "tardy") return styles.weekBarTardy;
  if (status === "absent") return styles.weekBarAbsent;
  if (status === "pending") return styles.weekBarPending;
  return styles.weekBarUpcoming;
}

/** Own 1s tick — avoids re-rendering the whole dashboard every second. */
const LiveClock = React.memo(function LiveClock() {
  const [liveClock, setLiveClock] = React.useState(() =>
    new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
      timeZone: SERVER_TIMEZONE,
    })
  );
  React.useEffect(() => {
    const tick = () => {
      setLiveClock(
        new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
          timeZone: SERVER_TIMEZONE,
        })
      );
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return <div className={styles.liveClock}>{liveClock}</div>;
});

export type DashboardHomeViewProps = {
  employeeId: string;
  employeeName: string;
  /** Kept for parent session sync; home uses greeting + ID chips instead of avatar card. */
  profilePhoto?: string | null;
  onAvatarUpdated?: (url: string) => void;
  profileContact?: { email: string; phone: string; location: string };
  clockedInLabel: string;
  todayStatus: string;
  todayHours: number;
  /** Open session clock-in — Hours today ticks 1s with Working timer. */
  sessionClockIn?: string | null;
  sessionClockOut?: string | null;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  greetingHour: number;
  todayLabel: string;
  monthAttendanceStats: {
    present: number;
    absent: number;
    pct: number;
  };
  monthTardies: number;
  leaveBalance: {
    annual: number;
    annualAllowance: number;
    bereavement: number;
    bereavementAllowance: number;
    maternity: number;
    maternityAllowance: number;
    paternity: number;
    paternityAllowance: number;
  };
  weekChart: WeekDay[];
  weekStats: {
    onTime: number;
    late: number;
    absent: number;
    weekScore: number;
    avgHours: number;
  };
  maxChartHours: number;
  upcomingEvents: UpcomingEvent[];
  reminders: Array<{ id: number; message: string }>;
  ticketWidgetItems: TicketWidgetRow[];
  ticketSeenMap: Record<number, string>;
  newReplyCount: number;
  openTicketPage: (ticket?: TicketWidgetRow) => void;
  isHrTicketInbox?: boolean;
  inboxTicketItems?: TicketWidgetRow[];
  inboxPendingCount?: number;
  openTicketInbox?: () => void;
  onNavigate: (path: string) => void;
  todayClock?: React.ReactNode;
};

export default function DashboardHomeView(props: DashboardHomeViewProps) {
  const {
    employeeId,
    clockedInLabel,
    todayStatus,
    todayHours,
    sessionClockIn,
    sessionClockOut,
    shiftStart,
    shiftEnd,
    monthAttendanceStats,
    monthTardies,
    leaveBalance,
    weekChart,
    weekStats,
    maxChartHours,
    upcomingEvents,
    reminders,
    ticketWidgetItems,
    ticketSeenMap,
    newReplyCount,
    openTicketPage,
    isHrTicketInbox = false,
    inboxTicketItems = [],
    inboxPendingCount = 0,
    openTicketInbox,
    onNavigate,
    todayClock,
  } = props;

  const leaveLeftLabel = `${leaveBalance.annual}/${leaveBalance.annualAllowance}`;
  const statusChipClass =
    todayStatus.startsWith("Late")
      ? styles.chipWarn
      : todayStatus === "On time"
        ? styles.chipLive
        : styles.chipMuted;

  const leaveRows = [
    {
      key: "annual",
      label: "Annual leave",
      left: leaveBalance.annual,
      total: leaveBalance.annualAllowance,
      fill: styles.leaveTeal,
    },
    {
      key: "bereavement",
      label: "Bereavement",
      left: leaveBalance.bereavement,
      total: leaveBalance.bereavementAllowance,
      fill: styles.leaveOrange,
    },
    ...(leaveBalance.maternityAllowance > 0
      ? [
          {
            key: "maternity",
            label: "Maternity",
            left: leaveBalance.maternity,
            total: leaveBalance.maternityAllowance,
            fill: styles.leaveTeal,
          },
        ]
      : []),
    ...(leaveBalance.paternityAllowance > 0
      ? [
          {
            key: "paternity",
            label: "Paternity",
            left: leaveBalance.paternity,
            total: leaveBalance.paternityAllowance,
            fill: styles.leaveOrange,
          },
        ]
      : []),
  ];

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        {employeeId ? <TardyNoteWidget employeeId={employeeId} variant="slack" /> : null}

        <div className={styles.greetingActions}>
          <div className={styles.greetingMeta}>
            <span className={`${styles.chip} ${statusChipClass}`}>{todayStatus}</span>
            <span className={styles.chip}>{clockedInLabel}</span>
            {employeeId ? (
              <span className={`${styles.chip} ${styles.chipMuted}`}>ID {employeeId}</span>
            ) : null}
          </div>
          <div className={styles.greetingActionsBtns}>
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => onNavigate("/employee-dashboard/my-info")}
            >
              My profile
            </button>
            <button
              type="button"
              className={styles.solidBtn}
              onClick={() => onNavigate("/employee-dashboard/attendance")}
            >
              Attendance detail
            </button>
          </div>
        </div>

        <section className={styles.primaryRow} aria-label="Today and this week">
          <article className={`${styles.panel} ${styles.todayDesk}`}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>Today&apos;s desk</h2>
              <span className={styles.panelMeta}>Live workspace</span>
            </div>
            <div className={styles.todayTop}>
              <div>
                <LiveClock />
              </div>
              <div className={styles.todayStats}>
                <div className={styles.statPill}>
                  <span className={styles.statPillLabel}>Hours today</span>
                  <span className={styles.statPillValue}>
                    {sessionClockIn ? (
                      <LiveHoursToday
                        clockInAt={sessionClockIn}
                        clockOutAt={sessionClockOut}
                      />
                    ) : (
                      formatHours(todayHours)
                    )}
                  </span>
                </div>
                <div className={styles.statPill}>
                  <span className={styles.statPillLabel}>Punch status</span>
                  <span className={styles.statPillValue}>{todayStatus}</span>
                </div>
              </div>
            </div>
            <div className={styles.shiftRow}>
              <div className={styles.shiftItem}>
                <span className={styles.shiftItemLabel}>Shift starts</span>
                <span className={styles.shiftItemValue}>{formatShiftTime(shiftStart)}</span>
              </div>
              <div className={styles.shiftItem}>
                <span className={styles.shiftItemLabel}>Shift ends</span>
                <span className={styles.shiftItemValue}>{formatShiftTime(shiftEnd)}</span>
              </div>
            </div>
            <div className={styles.todayActions}>{todayClock}</div>
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>This week</h2>
              <span className={styles.panelMeta}>Mon – Fri pulse</span>
            </div>
            <div className={styles.weekBody}>
              <div className={styles.weekBars} aria-label="Weekly hours">
                {weekChart.map((day) => {
                  const pct =
                    day.status === "absent"
                      ? 12
                      : day.status === "upcoming" || day.status === "pending"
                        ? 8
                        : Math.max(8, Math.round((day.hours / maxChartHours) * 100));
                  return (
                    <div
                      key={day.dateKey}
                      className={`${styles.weekCol}${day.isToday ? ` ${styles.weekColToday}` : ""}`}
                    >
                      <span className={styles.weekHours}>
                        {day.status === "upcoming" || day.status === "pending"
                          ? "—"
                          : day.status === "absent"
                            ? "Abs"
                            : formatHours(day.hours)}
                      </span>
                      <div className={styles.weekBarTrack}>
                        <div
                          className={`${styles.weekBarFill} ${barClass(day.status)}`}
                          style={{ height: `${pct}%` }}
                        />
                      </div>
                      <span className={styles.weekLabel}>{day.label}</span>
                    </div>
                  );
                })}
              </div>
              <div className={styles.weekSummary}>
                <div className={styles.weekStat}>
                  <span className={styles.weekStatLabel}>On time</span>
                  <span className={styles.weekStatValue}>{weekStats.onTime}</span>
                </div>
                <div className={styles.weekStat}>
                  <span className={styles.weekStatLabel}>Late</span>
                  <span className={styles.weekStatValue}>{weekStats.late}</span>
                </div>
                <div className={styles.weekStat}>
                  <span className={styles.weekStatLabel}>Absent</span>
                  <span className={styles.weekStatValue}>{weekStats.absent}</span>
                </div>
                <div className={styles.weekStat}>
                  <span className={styles.weekStatLabel}>Avg hours</span>
                  <span className={styles.weekStatValue}>
                    {weekStats.avgHours > 0 ? weekStats.avgHours.toFixed(1) : "0"}
                  </span>
                </div>
              </div>
              <nav className={styles.shortcuts} aria-label="Useful shortcuts">
                <button
                  type="button"
                  className={styles.shortcut}
                  onClick={() => onNavigate("/employee-dashboard/time")}
                >
                  <span className={`${styles.shortcutIcon} ${styles.iconTeal}`}>
                    <FaClock />
                  </span>
                  Time & attendance
                </button>
                <button
                  type="button"
                  className={styles.shortcut}
                  onClick={() => onNavigate("/employee-dashboard/generate-ticket")}
                >
                  <span className={`${styles.shortcutIcon} ${styles.iconInk}`}>
                    <FaFileAlt />
                  </span>
                  Generate ticket
                </button>
                {isHrTicketInbox ? (
                  <>
                    <button
                      type="button"
                      className={styles.shortcut}
                      onClick={() =>
                        openTicketInbox
                          ? openTicketInbox()
                          : onNavigate("/employee-dashboard/tickets")
                      }
                    >
                      <span className={`${styles.shortcutIcon} ${styles.iconInk}`}>
                        <FaTicketAlt />
                      </span>
                      Ticket inbox
                      {inboxPendingCount > 0 ? ` (${inboxPendingCount})` : ""}
                    </button>
                    <button
                      type="button"
                      className={styles.shortcut}
                      onClick={() =>
                        onNavigate("/employee-dashboard/manage-leaves?tab=requests")
                      }
                    >
                      <span className={`${styles.shortcutIcon} ${styles.iconTeal}`}>
                        <FaUsers />
                      </span>
                      Leaves
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={styles.shortcut}
                    onClick={() => onNavigate("/employee-dashboard/my-team")}
                  >
                    <span className={`${styles.shortcutIcon} ${styles.iconInk}`}>
                      <FaUsers />
                    </span>
                    My team
                  </button>
                )}
                <button
                  type="button"
                  className={styles.shortcut}
                  onClick={() => onNavigate("/employee-dashboard/my-info")}
                >
                  <span className={`${styles.shortcutIcon} ${styles.iconTeal}`}>
                    <FaUser />
                  </span>
                  My info
                </button>
              </nav>
            </div>
          </article>
        </section>

        <section className={styles.pulseStrip} aria-label="Month at a glance">
          <div className={`${styles.pulseCard} ${styles.pulseAccent}`}>
            <p className={styles.pulseLabel}>Attendance</p>
            <p className={styles.pulseValue}>{monthAttendanceStats.pct}%</p>
            <p className={styles.pulseHint}>Month to date</p>
          </div>
          <div className={styles.pulseCard}>
            <p className={styles.pulseLabel}>Present</p>
            <p className={styles.pulseValue}>{monthAttendanceStats.present}</p>
            <p className={styles.pulseHint}>Working days counted</p>
          </div>
          <div className={`${styles.pulseCard} ${styles.pulseDanger}`}>
            <p className={styles.pulseLabel}>Absent</p>
            <p className={styles.pulseValue}>{monthAttendanceStats.absent}</p>
            <p className={styles.pulseHint}>Open attendance for detail</p>
          </div>
          <div className={`${styles.pulseCard} ${styles.pulseWarn}`}>
            <p className={styles.pulseLabel}>Tardies</p>
            <p className={styles.pulseValue}>{monthTardies}</p>
            <p className={styles.pulseHint}>Late punches this month</p>
          </div>
          <div className={`${styles.pulseCard} ${styles.pulseAccent}`}>
            <p className={styles.pulseLabel}>Leave left</p>
            <p className={styles.pulseValue}>{leaveLeftLabel}</p>
            <p className={styles.pulseHint}>Annual balance</p>
          </div>
        </section>

        <section className={styles.secondaryRow} aria-label="Leave, events, attention">
          <article className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>Leave wallet</h2>
              <span className={styles.panelMeta}>Remaining</span>
            </div>
            <div className={styles.leaveList}>
              {leaveRows.map((row) => (
                <div key={row.key} className={styles.leaveRow}>
                  <div className={styles.leaveMeta}>
                    <span>{row.label}</span>
                    <span>
                      {String(row.left).padStart(2, "0")}/{row.total} days
                    </span>
                  </div>
                  <div className={styles.leaveTrack}>
                    <div
                      className={`${styles.leaveFill} ${row.fill}`}
                      style={{
                        width: `${Math.min(
                          100,
                          row.total ? (row.left / row.total) * 100 : 0
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() => onNavigate("/employee-dashboard/leave")}
            >
              Request leave →
            </button>
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>Coming up</h2>
              <span className={styles.panelMeta}>Events & holidays</span>
            </div>
            <div className={styles.upcomingList}>
              {upcomingEvents.length === 0 ? (
                <p className={styles.emptyNote}>No upcoming events</p>
              ) : (
                upcomingEvents.map((ev) => {
                  const parts = eventParts(ev.start_at);
                  return (
                    <div key={String(ev.id)} className={styles.upcomingItem}>
                      <div className={styles.upcomingDate}>
                        <span className={styles.upcomingDay}>{parts.day}</span>
                        <span className={styles.upcomingMon}>{parts.mon}</span>
                      </div>
                      <div className={styles.upcomingBody}>
                        <p className={styles.upcomingTitle}>{ev.title || "Event"}</p>
                        <p className={styles.upcomingSub}>
                          <span
                            className={styles.dot}
                            style={{ background: ev.color || "#0f766e" }}
                          />
                          {parts.when}
                          {ev.source ? ` · ${ev.source}` : ""}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </article>

          <article
            className={`${styles.panel} ${styles.clickPanel}`}
            role="button"
            tabIndex={0}
            onClick={() =>
              isHrTicketInbox
                ? openTicketInbox
                  ? openTicketInbox()
                  : onNavigate("/employee-dashboard/tickets")
                : openTicketPage()
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (isHrTicketInbox) {
                  openTicketInbox
                    ? openTicketInbox()
                    : onNavigate("/employee-dashboard/tickets");
                } else {
                  openTicketPage();
                }
              }
            }}
          >
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>
                {isHrTicketInbox ? "Needs attention" : "My attention"}
              </h2>
              <span className={styles.panelMeta}>Tickets & notes</span>
            </div>
            <div className={styles.attentionStack}>
              {!isHrTicketInbox && reminders.length > 0 ? (
                <div className={styles.attentionBlock}>
                  <p className={styles.attentionBlockTitle}>Reminders</p>
                  {reminders.slice(0, 2).map((r) => (
                    <div key={r.id} className={styles.reminderItem}>
                      <p className={styles.reminderText}>{r.message}</p>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className={styles.attentionBlock}>
                <p className={styles.attentionBlockTitle}>
                  {isHrTicketInbox ? "Open tickets" : "Active tickets"}
                </p>
                {isHrTicketInbox ? (
                  <>
                    {inboxPendingCount > 0 ? (
                      <span className={styles.replyBadge}>{inboxPendingCount} open</span>
                    ) : null}
                    {inboxTicketItems.length === 0 ? (
                      <p className={styles.emptyNote}>No open tickets</p>
                    ) : (
                      inboxTicketItems.slice(0, 3).map((ticket) => (
                        <div key={ticket.id} className={styles.ticketItem}>
                          <div className={styles.ticketTop}>
                            <span className={styles.ticketNum}>{ticket.ticket_number}</span>
                            <span className={styles.badgeMuted}>
                              {ticketStatusLabel(ticket.status, ticket.ticket_type)}
                            </span>
                          </div>
                          <div className={styles.ticketSub}>
                            {ticket.employee_name || ticket.employee_id || "Employee"}
                            {ticket.subject ? ` · ${ticket.subject}` : ""}
                          </div>
                        </div>
                      ))
                    )}
                  </>
                ) : (
                  <>
                    {newReplyCount > 0 ? (
                      <span className={styles.replyBadge}>
                        {newReplyCount} new {newReplyCount === 1 ? "reply" : "replies"}
                      </span>
                    ) : null}
                    {ticketWidgetItems.length === 0 ? (
                      <p className={styles.emptyNote}>Nothing pending — you&apos;re clear</p>
                    ) : (
                      ticketWidgetItems.map((ticket) => {
                        const isLeave = ticket.ticket_type === "leave";
                        const unread =
                          !isLeave &&
                          hasUnreadAdminReply(ticket.id, ticket.messages, ticketSeenMap);
                        const lastAdmin = isLeave
                          ? null
                          : getLastAdminMessage(ticket.messages ?? []);
                        return (
                          <div key={ticket.id} className={styles.ticketItem}>
                            <div className={styles.ticketTop}>
                              <span className={styles.ticketNum}>{ticket.ticket_number}</span>
                              <span className={unread ? styles.badgeNew : styles.badgeMuted}>
                                {unread
                                  ? "New reply"
                                  : ticketStatusLabel(ticket.status, ticket.ticket_type)}
                              </span>
                            </div>
                            <div className={styles.ticketSub}>{ticket.subject}</div>
                            {ticketDecidedByLabel(ticket) ? (
                              <div
                                className={styles.ticketPreview}
                                style={{
                                  fontWeight: 600,
                                  color:
                                    ticket.status === "rejected" ? "#b91c1c" : "#0f766e",
                                }}
                              >
                                {ticketDecidedByLabel(ticket)}
                              </div>
                            ) : null}
                            {lastAdmin ? (
                              <div className={styles.ticketPreview}>
                                Admin: {lastAdmin.body}
                              </div>
                            ) : null}
                          </div>
                        );
                      })
                    )}
                  </>
                )}
              </div>
            </div>
          </article>
        </section>

      </div>
    </div>
  );
}
