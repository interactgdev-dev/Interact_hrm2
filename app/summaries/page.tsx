"use client";

import React, { startTransition, Suspense, useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import LayoutDashboard from "../layout-dashboard";
import styles from "../break-summary/break-summary.module.css";

export type SummaryViewKey = "attendance" | "break" | "prayer";

const VIEW_OPTIONS: { key: SummaryViewKey; label: string }[] = [
  { key: "attendance", label: "Attendance" },
  { key: "break", label: "Break" },
  { key: "prayer", label: "Prayer Break" },
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

function SummaryLoading({ label }: { label: string }) {
  return (
    <div className={styles.breakSummaryContainer} style={{ paddingTop: 24 }}>
      <p style={{ color: "#64748b", fontSize: "0.95rem" }}>Loading {label} summary…</p>
    </div>
  );
}

function parseView(raw: string | null | undefined): SummaryViewKey {
  if (raw === "break" || raw === "prayer" || raw === "attendance") return raw;
  return "attendance";
}

function SummariesHubInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const viewFromUrl = parseView(searchParams?.get("view"));
  const [view, setView] = useState<SummaryViewKey>(viewFromUrl);

  // Keep local state in sync if user lands via redirect (?view=break)
  React.useEffect(() => {
    setView(viewFromUrl);
  }, [viewFromUrl]);

  const onViewChange = useCallback(
    (next: SummaryViewKey) => {
      // Defer heavy panel mount so the select stays snappy
      startTransition(() => {
        setView(next);
        const base = pathname || "/summaries";
        const qs = next === "attendance" ? "" : `?view=${next}`;
        router.replace(`${base}${qs}`, { scroll: false });
      });
    },
    [pathname, router],
  );

  const panel = useMemo(() => {
    // Key forces clean remount; inactive panels are not kept alive
    if (view === "break") return <BreakSummaryView key="break" />;
    if (view === "prayer") return <PrayerSummaryView key="prayer" />;
    return <AttendanceSummaryView key="attendance" />;
  }, [view]);

  return (
    <LayoutDashboard>
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
    </LayoutDashboard>
  );
}

export default function SummariesPage() {
  return (
    <Suspense fallback={<LayoutDashboard><SummaryLoading label="" /></LayoutDashboard>}>
      <SummariesHubInner />
    </Suspense>
  );
}
