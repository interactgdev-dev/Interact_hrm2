import type { BiometricAction } from "@/lib/face-types";

export type SessionBreakKind = "refreshment" | "meeting";

export type SessionBreakConfig = {
  kind: SessionBreakKind;
  apiPath: string;
  responseKey: string;
  startField: string;
  endField: string;
  durationField: string;
  startAction: BiometricAction;
  endAction: BiometricAction;
  lockPrefix: string;
  label: string;
  shortLabel: string;
  exceedSeconds: number;
  cardClass: string;
  titleClass: string;
  btnClass: string;
  btnEndClass: string;
  accentColor: string;
  badgeLiveColor: string;
  dataChangedEvent: string;
  summaryViewKey: string;
  breakTypeKey: string;
};

export const REFRESHMENT_BREAK_CONFIG: SessionBreakConfig = {
  kind: "refreshment",
  apiPath: "/api/refreshment_breaks",
  responseKey: "refreshment_breaks",
  startField: "refreshment_break_start",
  endField: "refreshment_break_end",
  durationField: "refreshment_break_duration",
  startAction: "refreshment_start",
  endAction: "refreshment_end",
  lockPrefix: "refreshment_break_start_emp_",
  label: "Refreshment",
  shortLabel: "Refreshment",
  exceedSeconds: 1800,
  cardClass: "cardRefreshment",
  titleClass: "titleRefreshment",
  btnClass: "btnRefreshment",
  btnEndClass: "btnRefreshmentEnd",
  accentColor: "#d97706",
  badgeLiveColor: "#b45309",
  dataChangedEvent: "hrm:refreshment-data-changed",
  summaryViewKey: "refreshment",
  breakTypeKey: "refreshment_break",
};

export const MEETING_BREAK_CONFIG: SessionBreakConfig = {
  kind: "meeting",
  apiPath: "/api/meeting_breaks",
  responseKey: "meeting_breaks",
  startField: "meeting_break_start",
  endField: "meeting_break_end",
  durationField: "meeting_break_duration",
  startAction: "meeting_start",
  endAction: "meeting_end",
  lockPrefix: "meeting_break_start_emp_",
  label: "Meeting",
  shortLabel: "Meeting",
  exceedSeconds: 3600,
  cardClass: "cardMeeting",
  titleClass: "titleMeeting",
  btnClass: "btnMeeting",
  btnEndClass: "btnMeetingEnd",
  accentColor: "#2563eb",
  badgeLiveColor: "#1d4ed8",
  dataChangedEvent: "hrm:meeting-data-changed",
  summaryViewKey: "meeting",
  breakTypeKey: "meeting_break",
};

export const SESSION_BREAK_CONFIGS: Record<SessionBreakKind, SessionBreakConfig> = {
  refreshment: REFRESHMENT_BREAK_CONFIG,
  meeting: MEETING_BREAK_CONFIG,
};

export function breakTypeLabel(breakType: string | null | undefined): string {
  if (breakType === "prayer_break") return "Prayer Break";
  if (breakType === "refreshment_break") return "Refreshment";
  if (breakType === "meeting_break") return "Meeting";
  return "Break";
}
