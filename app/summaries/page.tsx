"use client";

import React, { startTransition, Suspense, useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import styles from "../break-summary/break-summary.module.css";
import { REFRESHMENT_BREAK_CONFIG, MEETING_BREAK_CONFIG } from "@/lib/session-break-config";

export type SummaryViewKey = "attendance" | "break" | "prayer" | "refreshment" | "meeting";

const VIEW_OPTIONS: { key: SummaryViewKey; label: string }[] = [
  { key: "attendance", label: "Attendance" },
  { key: "break", label: "Break" },
  { key: "prayer", label: "Prayer Break" },
  { key: "refreshment", label: "Refreshment" },
  { key: "meeting", label: "Meeting" },
];

/** Lazy: only the selected panel’s JS loads; switching unmounts the other (no extra fetches/timers). */
const AttendanceSummaryView = dynamic(() => import("./AttendanceSummaryView"), {
  ssr: false,
  loading: () => <SummaryLoading label="Attendance" />,
});
const BreakSummaryView = dynamic(() => import("./BreakSummaryView"), {
  ssr: false,
  loading: () => <SummaryLoading label="Break" />,
});
const PrayerSummaryView = dynamic(() => import("./PrayerSummaryView"), {
  ssr: false,
  loading: () => <SummaryLoading label="Prayer Break" />,
});
const RefreshmentSummaryView = dynamic(
  () => import("./SessionBreakSummaryView").then((m) => ({
    default: () => <m.default config={REFRESHMENT_BREAK_CONFIG} />,
  })),
  {
    ssr: false,
    loading: () => <SummaryLoading label="Refreshment" />,
  }
);
const MeetingSummaryView = dynamic(
  () => import("./SessionBreakSummaryView").then((m) => ({
    default: () => <m.default config={MEETING_BREAK_CONFIG} />,
  })),
  {
    ssr: false,
    loading: () => <SummaryLoading label="Meeting" />,
  }
);

function SummaryLoading({ label }: { label: string }) {
  return (
    <div className={styles.breakSummaryContainer} style={{ paddingTop: 24 }}>
      <p style={{ color: "#64748b", fontSize: "0.95rem" }}>Loading {label} summary…</p>
    </div>
  );
}

function parseView(raw: string | null | undefined): SummaryViewKey {
  if (
    raw === "break" ||
    raw === "prayer" ||
    raw === "attendance" ||
    raw === "refreshment" ||
    raw === "meeting"
  ) {
    return raw;
  }
  return "attendance";
}

/** Prefer path segment (/summaries/break) over legacy ?view=break. */
function viewFromLocation(
  pathname: string | null | undefined,
  searchView: string | null | undefined,
): SummaryViewKey {
  const p = String(pathname || "");
  const seg = p.match(/\/summaries\/(break|prayer|refreshment|meeting|attendance)\/?$/i);
  if (seg) return parseView(seg[1].toLowerCase());
  return parseView(searchView);
}

function hrefForSummaryView(
  pathname: string | null | undefined,
  next: SummaryViewKey,
): string {
  const p = String(pathname || "");
  const underEmployee = p.includes("/employee-dashboard");
  const root = underEmployee ? "/employee-dashboard/summaries" : "/summaries";
  if (next === "attendance") return root;
  if (underEmployee) return `${root}/${next}`;
  return `${root}?view=${next}`;
}

function SummariesHubInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const viewFromUrl = viewFromLocation(pathname, searchParams?.get("view"));
  const [view, setView] = useState<SummaryViewKey>(viewFromUrl);

  React.useEffect(() => {
    setView(viewFromUrl);
  }, [viewFromUrl]);

  // Migrate legacy ?view= on employee hub → path segments (sidebar highlight).
  React.useEffect(() => {
    const p = String(pathname || "");
    if (!p.endsWith("/summaries")) return;
    const q = searchParams?.get("view");
    if (!q || q === "attendance") return;
    const next = parseView(q);
    if (next === "attendance") return;
    if (p.includes("/employee-dashboard")) {
      router.replace(`/employee-dashboard/summaries/${next}`, { scroll: false });
    }
  }, [pathname, searchParams, router]);

  const onViewChange = useCallback(
    (next: SummaryViewKey) => {
      startTransition(() => {
        setView(next);
        router.replace(hrefForSummaryView(pathname, next), { scroll: false });
      });
    },
    [pathname, router],
  );

  const panel = useMemo(() => {
    // Key forces clean remount; inactive panels are not kept alive
    if (view === "break") return <BreakSummaryView key="break" />;
    if (view === "prayer") return <PrayerSummaryView key="prayer" />;
    if (view === "refreshment") return <RefreshmentSummaryView key="refreshment" />;
    if (view === "meeting") return <MeetingSummaryView key="meeting" />;
    return <AttendanceSummaryView key="attendance" />;
  }, [view]);

  return (
    <OptionalAdminShell>
      <div className={styles.breakSummaryContainer} style={{ marginBottom: 0, paddingBottom: 0 }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 12,
            marginBottom: 8,
          }}
        >
          <label
            htmlFor="summary-view-select"
            style={{ fontWeight: 600, color: "#334155", fontSize: "0.95rem" }}
          >
            Summary
          </label>
          <select
            id="summary-view-select"
            value={view}
            onChange={(e) => onViewChange(parseView(e.target.value))}
            className={styles.breakSummaryDate}
            style={{ width: 220, fontWeight: 600 }}
          >
            {VIEW_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {panel}
    </OptionalAdminShell>
  );
}

export default function SummariesPage() {
  return (
    <Suspense fallback={<OptionalAdminShell><SummaryLoading label="" /></OptionalAdminShell>}>
      <SummariesHubInner />
    </Suspense>
  );
}
