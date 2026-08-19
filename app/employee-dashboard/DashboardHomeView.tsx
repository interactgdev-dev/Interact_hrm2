"use client";

import React from "react";
import {
  FaClock,
  FaUsers,
  FaTicketAlt,
  FaEnvelope,
  FaPhone,
  FaMapMarkerAlt,
  FaIdBadge,
} from "react-icons/fa";
import {
  getLastAdminMessage,
  hasUnreadAdminReply,
  type TicketThreadMessage,
} from "../../lib/ticket-thread";
import type { TicketCategory } from "../../lib/ticket-catalog";
import { TardyNoteWidget } from "../components/TardyNoteWidget";
import { HeroProfileAvatar } from "./components/HeroProfileAvatar";
import { SERVER_TIMEZONE } from "../../lib/timezone";
import styles from "./employee-dashboard.module.css";

type TicketWidgetRow = {
  id: number;
  ticket_number: string;
  subject: string | null;
  status: string;
  category: TicketCategory;
  ticket_type: string;
  messages?: TicketThreadMessage[];
  updated_at: string;
};

function ticketStatusLabel(status: string, ticketType?: string) {
  if (ticketType === "leave" && status === "resolved") return "approved";
  return status.replace("_", " ");
}

const ProgressRing = React.memo(function ProgressRing({
  pct,
  color,
  size = 54,
  children,
}: {
  pct: number;
  color: string;
  size?: number;
  children?: React.ReactNode;
}) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, pct));
  const offset = c - (clamped / 100) * c;

  return (
    <div className={styles.ringWrap} style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.25)"
          strokeWidth="5"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className={styles.ringArc}
        />
      </svg>
      {children ? <div className={styles.ringCenter}>{children}</div> : null}
    </div>
  );
});

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
  profilePhoto: string | null;
  onAvatarUpdated: (url: string) => void;
  profileContact: { email: string; phone: string; location: string };
  clockedInLabel: string;
  monthAttendanceStats: {
    present: number;
    absent: number;
    pct: number;
  };
  leaveBalance: {
    annual: number;
    annualAllowance: number;
    bereavement: number;
    bereavementAllowance: number;
  };
  eventsCal: {
    monthLabel: string;
    slots: Array<{ day: number; tags: { id: string | number; title: string; color: string }[] } | null>;
  };
  eventsMonthOffset: number;
  todayDay: number;
  setEventsMonthOffset: React.Dispatch<React.SetStateAction<number>>;
  ticketWidgetItems: TicketWidgetRow[];
  ticketSeenMap: Record<number, string>;
  newReplyCount: number;
  openTicketPage: (ticket?: TicketWidgetRow) => void;
  onNavigate: (path: string) => void;
};

export default function DashboardHomeView(props: DashboardHomeViewProps) {
  const {
    employeeId,
    employeeName,
    profilePhoto,
    onAvatarUpdated,
    profileContact,
    clockedInLabel,
    monthAttendanceStats,
    leaveBalance,
    eventsCal,
    eventsMonthOffset,
    todayDay,
    setEventsMonthOffset,
    ticketWidgetItems,
    ticketSeenMap,
    newReplyCount,
    openTicketPage,
    onNavigate,
  } = props;

  const profileInitials = (employeeName || "E")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        {employeeId ? <TardyNoteWidget employeeId={employeeId} variant="slack" /> : null}

        <div className={styles.dashGrid}>
          <article className={`${styles.card} ${styles.todayCard}`}>
            <h2 className={styles.cardTitle}>Today&apos;s Status</h2>
            <LiveClock />
            <p className={styles.clockedInLabel}>{clockedInLabel}</p>
            <div id="emp-today-status-root" className={styles.todayActions} />
          </article>

          <article className={`${styles.card} ${styles.attendanceCard}`}>
            <h2 className={styles.cardTitle}>My Attendance</h2>
            <div className={styles.attendanceBody}>
              <ProgressRing pct={monthAttendanceStats.pct} color="#fff" size={88}>
                <span>{monthAttendanceStats.pct}%</span>
              </ProgressRing>
              <div className={styles.attendanceStats}>
                <div className={styles.attStat}>
                  <span className={`${styles.dot} ${styles.dotBlue}`} />
                  {monthAttendanceStats.present} Days Present
                </div>
                <button
                  type="button"
                  className={`${styles.attStat} ${styles.attStatBtn}`}
                  onClick={() => onNavigate("/employee-dashboard/attendance?filter=absent")}
                >
                  <span className={`${styles.dot} ${styles.dotRed}`} />
                  {monthAttendanceStats.absent} Absent
                </button>
              </div>
            </div>
          </article>

          <article className={`${styles.card} ${styles.leaveCard}`}>
            <h2 className={styles.cardTitle}>Leave Balance</h2>
            <div className={styles.leaveRow}>
              <div className={styles.leaveMeta}>
                <span>Annual Leaves</span>
                <span>
                  {String(leaveBalance.annual).padStart(2, "0")}/{leaveBalance.annualAllowance}{" "}
                  days
                </span>
              </div>
              <div className={styles.leaveTrack}>
                <div
                  className={`${styles.leaveFill} ${styles.leaveTeal}`}
                  style={{
                    width: `${Math.min(
                      100,
                      leaveBalance.annualAllowance
                        ? (leaveBalance.annual / leaveBalance.annualAllowance) * 100
                        : 0
                    )}%`,
                  }}
                />
              </div>
            </div>
            <div className={styles.leaveRow}>
              <div className={styles.leaveMeta}>
                <span>Bereavement Leave</span>
                <span>
                  {String(leaveBalance.bereavement).padStart(2, "0")}/
                  {leaveBalance.bereavementAllowance} days
                </span>
              </div>
              <div className={styles.leaveTrack}>
                <div
                  className={`${styles.leaveFill} ${styles.leaveOrange}`}
                  style={{
                    width: `${Math.min(
                      100,
                      leaveBalance.bereavementAllowance
                        ? (leaveBalance.bereavement / leaveBalance.bereavementAllowance) * 100
                        : 0
                    )}%`,
                  }}
                />
              </div>
            </div>
          </article>

          <article className={`${styles.card} ${styles.profileCard}`}>
            <HeroProfileAvatar
              employeeId={employeeId}
              name={employeeName}
              initials={profileInitials}
              photo={profilePhoto}
              onAvatarUpdated={onAvatarUpdated}
              variant="card"
            />
            <h3 className={styles.profileName}>{employeeName}</h3>
            <ul className={styles.profileMeta}>
              <li>
                <FaEnvelope aria-hidden />
                <span>{profileContact.email || "No email"}</span>
              </li>
              <li>
                <FaPhone aria-hidden />
                <span>{profileContact.phone || "No phone"}</span>
              </li>
              <li>
                <FaMapMarkerAlt aria-hidden />
                <span>{profileContact.location}</span>
              </li>
              <li>
                <FaIdBadge aria-hidden />
                <span>ID: {employeeId || "—"}</span>
              </li>
            </ul>
            <button
              type="button"
              className={styles.profileBtn}
              onClick={() => onNavigate("/employee-dashboard/my-info")}
            >
              View Full Profile
            </button>
          </article>

          <article className={`${styles.card} ${styles.eventsCard}`}>
            <div className={styles.calNav}>
              <button
                type="button"
                className={styles.calNavBtn}
                onClick={() => setEventsMonthOffset((o) => o - 1)}
                aria-label="Previous month"
              >
                ‹
              </button>
              <h2 className={styles.calMonth}>{eventsCal.monthLabel}</h2>
              <button
                type="button"
                className={styles.calNavBtn}
                onClick={() => setEventsMonthOffset((o) => o + 1)}
                aria-label="Next month"
              >
                ›
              </button>
            </div>
            <div className={styles.calWeek}>
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                <div key={`${d}-${i}`} className={styles.calDow}>
                  {d}
                </div>
              ))}
            </div>
            <div className={styles.calGrid}>
              {eventsCal.slots.map((slot, idx) =>
                slot ? (
                  <div
                    key={idx}
                    className={`${styles.calCell}${
                      slot.day === todayDay && eventsMonthOffset === 0
                        ? ` ${styles.calCellToday}`
                        : ""
                    }`}
                  >
                    {slot.day}
                    <div className={styles.calDots}>
                      {slot.tags.slice(0, 3).map((t) => (
                        <span
                          key={String(t.id)}
                          className={styles.calDot}
                          style={{ background: t.color }}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div key={idx} className={styles.calCell} />
                )
              )}
            </div>
          </article>

          <article className={`${styles.card} ${styles.actionsCard}`}>
            <h2 className={styles.cardTitle}>Quick Actions</h2>
            <div className={styles.actionList}>
              <button
                type="button"
                className={styles.actionBtn}
                onClick={() => onNavigate("/employee-dashboard/time")}
              >
                <span className={`${styles.actionIcon} ${styles.actionBlue}`}>
                  <FaClock />
                </span>
                Time & attendance
              </button>
              <button
                type="button"
                className={styles.actionBtn}
                onClick={() => onNavigate("/employee-dashboard/generate-ticket")}
              >
                <span className={`${styles.actionIcon} ${styles.actionOrange}`}>
                  <FaTicketAlt />
                </span>
                Generate ticket
              </button>
              <button
                type="button"
                className={styles.actionBtn}
                onClick={() => onNavigate("/employee-dashboard/my-team")}
              >
                <span className={`${styles.actionIcon} ${styles.actionPurple}`}>
                  <FaUsers />
                </span>
                My team
              </button>
            </div>
          </article>

          <article
            className={`${styles.card} ${styles.ticketsCard}`}
            role="button"
            tabIndex={0}
            onClick={() => openTicketPage()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openTicketPage();
              }
            }}
          >
            <div className={styles.ticketsHead}>
              <h2 className={styles.ticketsHeadTitle}>Generate Tickets</h2>
              <button
                type="button"
                className={styles.viewAll}
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigate("/employee-dashboard/generate-ticket");
                }}
              >
                View all
              </button>
            </div>
            <div className={styles.ticketsBody}>
              {newReplyCount > 0 ? (
                <span className={styles.replyBadge}>
                  {newReplyCount} New {newReplyCount === 1 ? "Reply" : "Replies"}
                </span>
              ) : null}
              {ticketWidgetItems.length === 0 ? (
                <div className={styles.ticketEmpty}>No pending tickets</div>
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
                      {lastAdmin ? (
                        <div className={styles.ticketPreview}>Admin: {lastAdmin.body}</div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}
