"use client";

import React from "react";
import Link from "next/link";
import {
  FaDownload,
  FaEllipsisV,
  FaTimes,
  FaTrash,
} from "react-icons/fa";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import SecretPasswordModal from "@/app/components/SecretPasswordModal";
import adminStyles from "../admin-page.module.css";
import styles from "../presence-idle/presence-idle.module.css";
import GuardScreenshotSettings from "./GuardScreenshotSettings";
import GuardPolicyPanel from "./GuardPolicyPanel";
import GuardLiveView from "./GuardLiveView";
import GuardAppActivityPanel from "./GuardAppActivityPanel";
import GuardKeyboardActivityPanel from "./GuardKeyboardActivityPanel";
import { toastError, toastSuccess } from "@/lib/app-toast";

type ShotSummary = {
  employeeId: string;
  count: number;
  latestAt: string | null;
  sampleName: string | null;
  samplePseudonym: string | null;
};

type FileRow = {
  relativePath: string;
  fileName: string;
  employeeId: string;
  dateFolder: string;
  size: number;
  mtimeMs: number;
  capturedAt: string;
};

type AgentHealth = "healthy" | "stale" | "offline";

type AgentRow = {
  machineId: string;
  hostname: string | null;
  windowsUser: string | null;
  assignedEmployeeId: string | null;
  agentVersion: string | null;
  agentProduct?: string | null;
  lastSeenAt: string | null;
  health: AgentHealth;
  assignedEmployeeName: string | null;
  assignedEmployeeCode: string | null;
  assignedPseudonym?: string | null;
};

type EmpRow = {
  id: number;
  first_name?: string;
  last_name?: string;
  employee_code?: string | null;
  pseudonym?: string | null;
  department_name?: string | null;
};

type DeptRow = { id: number; name?: string; department_name?: string };

type ProfileCard = {
  employeeId: string;
  name: string;
  pseudonym: string;
  department: string;
  employeeCode: string;
  screenshotCount: number;
  latestShotAt: string | null;
  machineCount: number;
  hostnames: string[];
  health: AgentHealth;
  agentVersion: string | null;
  lastSeenAt: string | null;
};

const PAGE_SIZE = 24;

function todayYmd() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function formatWhen(iso: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function healthRank(h: AgentHealth) {
  if (h === "healthy") return 0;
  if (h === "stale") return 1;
  return 2;
}

function healthLabel(h: AgentHealth) {
  if (h === "healthy") return "Online";
  if (h === "stale") return "Stale";
  return "Offline";
}

function healthClass(h: AgentHealth) {
  if (h === "healthy") return styles.healthOk;
  if (h === "stale") return styles.healthWarn;
  return styles.healthBad;
}

function buildProfiles(
  agents: AgentRow[],
  employees: EmpRow[],
  shots: ShotSummary[]
): ProfileCard[] {
  const empById = new Map(employees.map((e) => [String(e.id), e]));
  const shotById = new Map(shots.map((s) => [String(s.employeeId), s]));

  const byEmp = new Map<string, AgentRow[]>();
  for (const a of agents) {
    const id = String(a.assignedEmployeeId || "").trim();
    if (!id) continue;
    const list = byEmp.get(id) ?? [];
    list.push(a);
    byEmp.set(id, list);
  }

  const cards: ProfileCard[] = [];
  for (const [employeeId, list] of byEmp) {
    const emp = empById.get(employeeId);
    const shot = shotById.get(employeeId);
    const best = [...list].sort(
      (a, b) => healthRank(a.health) - healthRank(b.health)
    )[0];
    const nameFromEmp = emp
      ? `${emp.first_name || ""} ${emp.last_name || ""}`.trim()
      : "";
    const name =
      nameFromEmp ||
      best?.assignedEmployeeName ||
      shot?.sampleName ||
      `Employee ${employeeId}`;
    const pseudonym =
      (emp?.pseudonym || "").trim() ||
      (best?.assignedPseudonym || "").trim() ||
      (shot?.samplePseudonym || "").trim() ||
      "";
    const hostnames = [
      ...new Set(
        list
          .map((a) => (a.hostname || "").trim())
          .filter(Boolean)
      ),
    ];
    const lastSeenAt = list
      .map((a) => a.lastSeenAt)
      .filter(Boolean)
      .sort()
      .reverse()[0] || null;
    const version =
      list.map((a) => a.agentVersion).find((v) => !!v?.trim()) || null;

    cards.push({
      employeeId,
      name,
      pseudonym,
      department: (emp?.department_name || "").trim() || "—",
      employeeCode:
        (emp?.employee_code || "").trim() ||
        (best?.assignedEmployeeCode || "").trim() ||
        "",
      screenshotCount: shot?.count ?? 0,
      latestShotAt: shot?.latestAt ?? null,
      machineCount: list.length,
      hostnames,
      health: best?.health || "offline",
      agentVersion: version,
      lastSeenAt,
    });
  }

  return cards.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

export default function GuardScreenshotsPage() {
  const [unlocked, setUnlocked] = React.useState(false);
  const [checking, setChecking] = React.useState(true);
  const [unlocking, setUnlocking] = React.useState(false);

  const [agents, setAgents] = React.useState<AgentRow[]>([]);
  const [hrEmployees, setHrEmployees] = React.useState<EmpRow[]>([]);
  const [departments, setDepartments] = React.useState<DeptRow[]>([]);
  const [shotSummaries, setShotSummaries] = React.useState<ShotSummary[]>([]);
  const [loadingRoster, setLoadingRoster] = React.useState(false);

  const [searchQuery, setSearchQuery] = React.useState("");
  const [deptFilter, setDeptFilter] = React.useState("");

  const [selectedId, setSelectedId] = React.useState("");
  const [dates, setDates] = React.useState<string[]>([]);
  const [filterDate, setFilterDate] = React.useState(todayYmd());
  const [timeFrom, setTimeFrom] = React.useState("");
  const [timeTo, setTimeTo] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [total, setTotal] = React.useState(0);
  const [files, setFiles] = React.useState<FileRow[]>([]);
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});
  const [loadingFiles, setLoadingFiles] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [viewPath, setViewPath] = React.useState<string | null>(null);
  const [menuPath, setMenuPath] = React.useState<string | null>(null);
  const [scanPath, setScanPath] = React.useState<string | null>(null);
  const [scanText, setScanText] = React.useState("");
  const [scanNote, setScanNote] = React.useState("");
  const [scanBusy, setScanBusy] = React.useState(false);
  const [scanError, setScanError] = React.useState("");
  const [liveMode, setLiveMode] = React.useState(false);
  const [activityMode, setActivityMode] = React.useState(false);
  const [keyboardMode, setKeyboardMode] = React.useState(false);
  const [policyMode, setPolicyMode] = React.useState(false);

  const profiles = React.useMemo(
    () => buildProfiles(agents, hrEmployees, shotSummaries),
    [agents, hrEmployees, shotSummaries]
  );

  const filteredProfiles = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const dept = deptFilter.trim().toLowerCase();
    return profiles.filter((p) => {
      if (q) {
        const hay = `${p.name} ${p.pseudonym} ${p.employeeId} ${p.employeeCode}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (dept && p.department.toLowerCase() !== dept) return false;
      return true;
    });
  }, [profiles, searchQuery, deptFilter]);

  const selectedProfile = React.useMemo(
    () => profiles.find((p) => p.employeeId === selectedId) || null,
    [profiles, selectedId]
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selectedPaths = React.useMemo(
    () => Object.keys(selected).filter((k) => selected[k]),
    [selected]
  );

  const checkUnlock = React.useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/admin/guard-screenshots/unlock", {
        cache: "no-store",
      });
      const data = await res.json();
      setUnlocked(!!data.unlocked);
    } catch {
      setUnlocked(false);
    } finally {
      setChecking(false);
    }
  }, []);

  React.useEffect(() => {
    void checkUnlock();
  }, [checkUnlock]);

  const loadRoster = React.useCallback(async () => {
    setLoadingRoster(true);
    try {
      const [agentsRes, empRes, deptRes, shotsRes] = await Promise.all([
        fetch("/api/admin/presence-agents", { cache: "no-store" }),
        fetch("/api/employee-list", { cache: "no-store" }),
        fetch("/api/departments", { cache: "no-store" }),
        fetch("/api/admin/guard-screenshots", { cache: "no-store" }),
      ]);
      const agentsData = await agentsRes.json();
      const empData = await empRes.json();
      const deptData = await deptRes.json();
      const shotsData = await shotsRes.json();

      if (shotsRes.status === 401 || shotsData.locked) {
        setUnlocked(false);
        return;
      }
      if (!agentsData.success) {
        toastError(agentsData.error || "Could not load installed agents");
        return;
      }
      setAgents((Array.isArray(agentsData.agents) ? agentsData.agents : []) as AgentRow[]);
      if (empData.success && Array.isArray(empData.employees)) {
        setHrEmployees(empData.employees as EmpRow[]);
      }
      if (deptData.success && Array.isArray(deptData.departments)) {
        setDepartments(deptData.departments as DeptRow[]);
      }
      if (shotsData.success) {
        setShotSummaries((shotsData.employees || []) as ShotSummary[]);
      }
    } catch {
      toastError("Network error loading profiles");
    } finally {
      setLoadingRoster(false);
    }
  }, []);

  React.useEffect(() => {
    if (unlocked) void loadRoster();
  }, [unlocked, loadRoster]);

  const loadDates = React.useCallback(async (employeeId: string) => {
    if (!employeeId) {
      setDates([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/admin/guard-screenshots?employeeId=${encodeURIComponent(employeeId)}&datesOnly=1`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (res.status === 401 || data.locked) {
        setUnlocked(false);
        return;
      }
      const list = (data.dates || []) as string[];
      setDates(list);
      if (list.length && !list.includes(filterDate)) {
        setFilterDate(list[0]);
      }
    } catch {
      setDates([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when employee changes
  }, []);

  React.useEffect(() => {
    if (unlocked && selectedId) {
      setPage(1);
      setSelected({});
      setTimeFrom("");
      setTimeTo("");
      void loadDates(selectedId);
    } else {
      setDates([]);
      setFiles([]);
      setTotal(0);
    }
  }, [unlocked, selectedId, loadDates]);

  const loadFiles = React.useCallback(async () => {
    if (!selectedId) {
      setFiles([]);
      setTotal(0);
      return;
    }
    setLoadingFiles(true);
    try {
      const q = new URLSearchParams({
        employeeId: selectedId,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (filterDate) q.set("date", filterDate);
      if (timeFrom) q.set("timeFrom", timeFrom);
      if (timeTo) q.set("timeTo", timeTo);
      const res = await fetch(`/api/admin/guard-screenshots?${q}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.status === 401 || data.locked) {
        setUnlocked(false);
        return;
      }
      if (!data.success) {
        toastError(data.error || "Could not load files");
        return;
      }
      setFiles((data.files || []) as FileRow[]);
      setTotal(Number(data.total) || 0);
    } catch {
      toastError("Network error loading files");
    } finally {
      setLoadingFiles(false);
    }
  }, [selectedId, filterDate, timeFrom, timeTo, page]);

  React.useEffect(() => {
    if (unlocked && selectedId) void loadFiles();
  }, [unlocked, selectedId, loadFiles]);

  async function unlock(password: string) {
    if (!password || unlocking) return;
    setUnlocking(true);
    try {
      const res = await fetch("/api/admin/guard-screenshots/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!data.success) {
        toastError(data.error || "Invalid password");
        return;
      }
      setUnlocked(true);
      toastSuccess("Unlocked");
    } catch {
      toastError("Network error");
    } finally {
      setUnlocking(false);
    }
  }

  async function lock() {
    try {
      await fetch("/api/admin/guard-screenshots/unlock", { method: "DELETE" });
    } catch {
      /* ignore */
    }
    setUnlocked(false);
    setSelectedId("");
    setViewPath(null);
    setMenuPath(null);
    setScanPath(null);
    setLiveMode(false);
    setActivityMode(false);
    setKeyboardMode(false);
    setPolicyMode(false);
  }

  React.useEffect(() => {
    if (!menuPath) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target?.closest("[data-shot-menu]")) setMenuPath(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuPath(null);
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuPath]);

  async function runImageToText(relativePath: string) {
    setMenuPath(null);
    setScanPath(relativePath);
    setScanText("");
    setScanNote("");
    setScanError("");
    setScanBusy(true);
    try {
      const res = await fetch("/api/admin/guard-screenshots/image-to-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: relativePath, mode: "lines" }),
      });
      const raw = await res.text();
      let data: { success?: boolean; error?: string; text?: string; note?: string } | null =
        null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }
      if (!res.ok || !data?.success) {
        setScanError(
          data?.error ||
            (res.status === 504
              ? "Scan timed out. Try again."
              : res.status === 502
                ? "The server restarted during the scan. Try again."
                : "Image to text failed")
        );
        return;
      }
      setScanText(String(data.text || ""));
      if (data.note) setScanNote(String(data.note));
    } catch {
      setScanError("Network error");
    } finally {
      setScanBusy(false);
    }
  }

  async function copyScanText() {
    if (!scanText) return;
    try {
      await navigator.clipboard.writeText(scanText);
      toastSuccess("Copied");
    } catch {
      toastError("Could not copy");
    }
  }

  function fileUrl(relativePath: string, download = false) {
    const q = new URLSearchParams({ path: relativePath });
    if (download) q.set("download", "1");
    return `/api/admin/guard-screenshots/file?${q.toString()}`;
  }

  function toggleSelect(path: string) {
    setSelected((prev) => ({ ...prev, [path]: !prev[path] }));
  }

  function toggleSelectAllOnPage() {
    const allOn = files.every((f) => selected[f.relativePath]);
    setSelected((prev) => {
      const next = { ...prev };
      for (const f of files) next[f.relativePath] = !allOn;
      return next;
    });
  }

  async function deletePaths(paths: string[]) {
    if (!paths.length) return;
    if (!window.confirm(`Delete ${paths.length} screenshot(s)? This cannot be undone.`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/guard-screenshots", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths }),
      });
      const data = await res.json();
      if (!data.success) {
        toastError(data.error || "Delete failed");
        return;
      }
      toastSuccess(`Deleted ${data.deletedCount ?? paths.length} file(s)`);
      setSelected({});
      if (viewPath && paths.includes(viewPath)) setViewPath(null);
      await loadFiles();
      await loadRoster();
    } catch {
      toastError("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteDay() {
    if (!selectedId || !filterDate) return;
    if (
      !window.confirm(
        `Delete ALL screenshots for this employee on ${filterDate}? This cannot be undone.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/guard-screenshots", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: selectedId, date: filterDate }),
      });
      const data = await res.json();
      if (!data.success) {
        toastError(data.error || "Delete failed");
        return;
      }
      toastSuccess(`Deleted ${data.deletedCount ?? 0} file(s)`);
      setSelected({});
      setViewPath(null);
      await loadDates(selectedId);
      await loadFiles();
      await loadRoster();
    } catch {
      toastError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <OptionalAdminShell>
      <div className={adminStyles.page}>
        <div className={`${adminStyles.card} ${styles.wrap}`}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <div>
              <h1 className={adminStyles.title}>Guard Screenshots</h1>
              <p className={adminStyles.subtitle}>
                Profiles for PCs with Interact Guard installed. Open a card to
                browse captures.
              </p>
            </div>
            {unlocked &&
            selectedId &&
            !liveMode &&
            !activityMode &&
            !keyboardMode &&
            !policyMode ? (
              <button
                type="button"
                className={styles.navBackBtn}
                onClick={() => {
                  setSelectedId("");
                  setViewPath(null);
                  setSelected({});
                  setMenuPath(null);
                  setScanPath(null);
                }}
              >
                ← Profiles
              </button>
            ) : (
              <Link href="/admin/presence-idle" className={styles.navBackBtn}>
                ← Presence / Idle
              </Link>
            )}
          </div>

          <GuardScreenshotSettings />

          {checking ? (
            <p className={styles.tip}>Checking access…</p>
          ) : !unlocked ? (
            <>
              <p className={styles.tip}>Enter password to open the gallery.</p>
              <SecretPasswordModal
                open
                unlocking={unlocking}
                onClose={() => {
                  if (typeof window !== "undefined") {
                    window.location.href = "/admin/presence-idle";
                  }
                }}
                onSubmit={unlock}
              />
            </>
          ) : (
            <div className={styles.galleryWrap}>
              <div className={styles.durationRow} style={{ marginBottom: 2 }}>
                <button
                  type="button"
                  className={adminStyles.btnSecondary}
                  onClick={() => {
                    void loadRoster();
                    if (selectedId) void loadFiles();
                  }}
                  disabled={loadingRoster || loadingFiles || busy}
                >
                  {loadingRoster || loadingFiles ? "Refreshing…" : "Refresh"}
                </button>
                <button
                  type="button"
                  className={adminStyles.btnSecondary}
                  onClick={() => void lock()}
                >
                  Lock
                </button>
              </div>

              {policyMode ? (
                <GuardPolicyPanel onBack={() => setPolicyMode(false)} />
              ) : liveMode ? (
                <GuardLiveView
                  profiles={filteredProfiles.map((p) => ({
                    employeeId: p.employeeId,
                    name: p.name,
                    pseudonym: p.pseudonym,
                    department: p.department,
                    health: p.health,
                  }))}
                  onClose={() => setLiveMode(false)}
                />
              ) : activityMode ? (
                <GuardAppActivityPanel onBack={() => setActivityMode(false)} />
              ) : keyboardMode ? (
                <GuardKeyboardActivityPanel
                  onBack={() => setKeyboardMode(false)}
                />
              ) : !selectedId ? (
                <>
                  <div className={styles.profileFilterBar}>
                    <div className={`${styles.field} ${styles.profileSearchField}`}>
                      <label htmlFor="ss-search">Search</label>
                      <input
                        id="ss-search"
                        type="text"
                        className={styles.profileSearchInput}
                        value={searchQuery}
                        placeholder="Name, pseudo name, or ID…"
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                    </div>
                    <div className={`${styles.field} ${styles.profileDeptField}`}>
                      <label htmlFor="ss-dept">Department</label>
                      <select
                        id="ss-dept"
                        value={deptFilter}
                        onChange={(e) => setDeptFilter(e.target.value)}
                      >
                        <option value="">All departments</option>
                        {departments.map((d) => {
                          const label = d.name || d.department_name || `Dept ${d.id}`;
                          return (
                            <option key={d.id} value={label}>
                              {label}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                    <button
                      type="button"
                      className={adminStyles.btnPrimary}
                      disabled={filteredProfiles.length === 0}
                      onClick={() => setLiveMode(true)}
                    >
                      Live screens
                    </button>
                    <button
                      type="button"
                      className={adminStyles.btnSecondary}
                      onClick={() => setActivityMode(true)}
                    >
                      App activity
                    </button>
                    <button
                      type="button"
                      className={adminStyles.btnSecondary}
                      onClick={() => setKeyboardMode(true)}
                    >
                      Keyboard activity
                    </button>
                    <button
                      type="button"
                      className={adminStyles.btnSecondary}
                      onClick={() => {
                        setSelectedId("");
                        setPolicyMode(true);
                      }}
                    >
                      Policy
                    </button>
                  </div>

                  {loadingRoster && profiles.length === 0 ? (
                    <p className={styles.tip}>Loading installed profiles…</p>
                  ) : filteredProfiles.length === 0 ? (
                    <p className={styles.tip}>
                      No installed Guard profiles match these filters. Assign an
                      employee on Presence / Idle after the agent is installed.
                    </p>
                  ) : (
                    <div className={styles.profileGrid}>
                      {filteredProfiles.map((p) => (
                        <button
                          key={p.employeeId}
                          type="button"
                          className={styles.profileCard}
                          onClick={() => setSelectedId(p.employeeId)}
                        >
                          <div className={styles.profileCardTop}>
                            <div>
                              <h3 className={styles.profileName}>{p.name}</h3>
                              {p.pseudonym ? (
                                <p className={styles.profilePseudo}>{p.pseudonym}</p>
                              ) : null}
                            </div>
                            <span className={healthClass(p.health)}>
                              {healthLabel(p.health)}
                            </span>
                          </div>
                          <div className={styles.profileMeta}>
                            <div>
                              <strong>Dept:</strong> {p.department}
                            </div>
                            <div>
                              <strong>ID:</strong> {p.employeeId}
                              {p.employeeCode ? ` · ${p.employeeCode}` : ""}
                            </div>
                            <div>
                              <strong>PC:</strong>{" "}
                              {p.hostnames.length
                                ? p.hostnames.slice(0, 2).join(", ")
                                : "—"}
                              {p.machineCount > 1 ? ` (+${p.machineCount - 1})` : ""}
                            </div>
                            <div>
                              <strong>Last seen:</strong> {formatWhen(p.lastSeenAt)}
                            </div>
                          </div>
                          <div className={styles.profileStats}>
                            <span className={`${styles.profileStat} ${styles.profileStatAccent}`}>
                              {p.screenshotCount} shot{p.screenshotCount === 1 ? "" : "s"}
                            </span>
                            {p.agentVersion ? (
                              <span className={styles.profileStat}>v{p.agentVersion}</span>
                            ) : null}
                            {p.latestShotAt ? (
                              <span className={styles.profileStat}>
                                last {formatWhen(p.latestShotAt)}
                              </span>
                            ) : null}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className={styles.detailHeader}>
                    <div>
                      <h2 className={styles.detailTitle}>
                        {selectedProfile?.name || `Employee ${selectedId}`}
                      </h2>
                      <p className={styles.detailSub}>
                        {[
                          selectedProfile?.pseudonym,
                          selectedProfile?.department,
                          `ID ${selectedId}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                  </div>

                  <div className={styles.durationRow}>
                    <div className={styles.field}>
                      <label htmlFor="ss-date">Date</label>
                      <input
                        id="ss-date"
                        type="date"
                        value={filterDate}
                        list="ss-date-list"
                        onChange={(e) => {
                          setFilterDate(e.target.value);
                          setPage(1);
                          setSelected({});
                        }}
                      />
                      <datalist id="ss-date-list">
                        {dates.map((d) => (
                          <option key={d} value={d} />
                        ))}
                      </datalist>
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="ss-from">Time from</label>
                      <input
                        id="ss-from"
                        type="time"
                        step={1}
                        value={timeFrom}
                        onChange={(e) => {
                          setTimeFrom(e.target.value);
                          setPage(1);
                        }}
                      />
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="ss-to">Time to</label>
                      <input
                        id="ss-to"
                        type="time"
                        step={1}
                        value={timeTo}
                        onChange={(e) => {
                          setTimeTo(e.target.value);
                          setPage(1);
                        }}
                      />
                    </div>
                  </div>

                  <div className={styles.durationRow} style={{ marginTop: 4 }}>
                    <span className={styles.tip}>
                      {loadingFiles
                        ? "Loading…"
                        : `${total} file(s)${filterDate ? ` on ${filterDate}` : ""} · page ${page}/${totalPages}`}
                    </span>
                    <button
                      type="button"
                      className={styles.chip}
                      disabled={!files.length || busy}
                      onClick={toggleSelectAllOnPage}
                    >
                      Select page
                    </button>
                    <button
                      type="button"
                      className={adminStyles.btnSecondary}
                      disabled={!selectedPaths.length || busy}
                      onClick={() => void deletePaths(selectedPaths)}
                    >
                      Delete selected ({selectedPaths.length})
                    </button>
                    <button
                      type="button"
                      className={adminStyles.btnSecondary}
                      disabled={!filterDate || busy}
                      onClick={() => void deleteDay()}
                    >
                      Delete whole day
                    </button>
                  </div>

                  {!loadingFiles && files.length === 0 ? (
                    <p className={styles.tip}>
                      No screenshots for this filter. Pick another date or clear
                      time range.
                    </p>
                  ) : (
                    <div className={styles.thumbGrid}>
                      {files.map((f) => (
                        <div key={f.relativePath} className={styles.thumbCard}>
                          <label className={styles.thumbCheck}>
                            <input
                              type="checkbox"
                              checked={!!selected[f.relativePath]}
                              onChange={() => toggleSelect(f.relativePath)}
                            />
                          </label>
                          <div className={styles.thumbMenu} data-shot-menu="">
                            <button
                              type="button"
                              className={styles.thumbMenuBtn}
                              aria-label="Screenshot actions"
                              aria-expanded={menuPath === f.relativePath}
                              onClick={() =>
                                setMenuPath((cur) =>
                                  cur === f.relativePath ? null : f.relativePath
                                )
                              }
                            >
                              <FaEllipsisV />
                            </button>
                            {menuPath === f.relativePath ? (
                              <div className={styles.thumbMenuList} role="menu">
                                <button
                                  type="button"
                                  role="menuitem"
                                  className={styles.thumbMenuItem}
                                  onClick={() => void runImageToText(f.relativePath)}
                                >
                                  Image to text
                                </button>
                              </div>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            className={styles.thumbOpen}
                            onClick={() => setViewPath(f.relativePath)}
                            title={f.fileName}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={fileUrl(f.relativePath)}
                              alt={f.fileName}
                              className={styles.thumbImg}
                              loading="lazy"
                              decoding="async"
                            />
                            <span className={styles.thumbMeta}>
                              {f.capturedAt.replace("T", " ")}
                            </span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {totalPages > 1 ? (
                    <div className={styles.durationRow} style={{ marginTop: 8 }}>
                      <button
                        type="button"
                        className={adminStyles.btnSecondary}
                        disabled={page <= 1 || loadingFiles}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        className={adminStyles.btnSecondary}
                        disabled={page >= totalPages || loadingFiles}
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      >
                        Next
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )}

          {viewPath ? (
            <div
              className={styles.shotLightbox}
              role="dialog"
              aria-modal="true"
              aria-label="Screenshot preview"
              onClick={() => setViewPath(null)}
            >
              <div
                className={styles.shotLightboxPanel}
                onClick={(e) => e.stopPropagation()}
              >
                <div className={styles.shotLightboxBar}>
                  <div className={styles.shotLightboxMeta}>
                    <span className={styles.shotLightboxTitle}>Screenshot</span>
                    <span className={styles.shotLightboxPath} title={viewPath}>
                      {viewPath}
                    </span>
                  </div>
                  <div className={styles.shotLightboxActions}>
                    <a
                      className={styles.shotLightboxPrimary}
                      href={fileUrl(viewPath, true)}
                      download
                    >
                      <FaDownload aria-hidden />
                      Download
                    </a>
                    <button
                      type="button"
                      className={styles.shotLightboxDanger}
                      disabled={busy}
                      onClick={() => void deletePaths([viewPath])}
                    >
                      <FaTrash aria-hidden />
                      Delete
                    </button>
                    <button
                      type="button"
                      className={styles.shotLightboxClose}
                      aria-label="Close"
                      onClick={() => setViewPath(null)}
                    >
                      <FaTimes />
                    </button>
                  </div>
                </div>
                <div className={styles.shotLightboxStage}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={fileUrl(viewPath)}
                    alt="Screenshot"
                    className={styles.shotLightboxImg}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {scanPath ? (
            <div
              className={styles.modalBackdrop}
              role="dialog"
              aria-modal="true"
              aria-label="Image to text"
              onClick={() => {
                if (!scanBusy) setScanPath(null);
              }}
            >
              <div
                className={styles.modalPanel}
                onClick={(e) => e.stopPropagation()}
              >
                <div className={styles.modalActions}>
                  <strong className={styles.scanTitle}>Image to text</strong>
                  <button
                    type="button"
                    className={adminStyles.btnPrimary}
                    disabled={scanBusy || !scanText}
                    onClick={() => void copyScanText()}
                  >
                    Copy text
                  </button>
                  <button
                    type="button"
                    className={adminStyles.btnSecondary}
                    disabled={scanBusy}
                    onClick={() => setScanPath(null)}
                  >
                    Close
                  </button>
                </div>
                <div className={styles.modalBody}>
                  <p className={styles.tip}>{scanPath}</p>
                  {scanBusy ? (
                    <p className={styles.tip}>Scanning screenshot…</p>
                  ) : null}
                  {scanError ? <p className={styles.scanError}>{scanError}</p> : null}
                  {scanNote && !scanError ? (
                    <p className={styles.tip}>{scanNote}</p>
                  ) : null}
                  <textarea
                    className={styles.scanOutput}
                    readOnly
                    value={scanText}
                    placeholder={scanBusy ? "Reading the screenshot…" : "Extracted text will appear here."}
                    rows={14}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </OptionalAdminShell>
  );
}
