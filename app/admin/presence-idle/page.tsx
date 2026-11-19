"use client";

import React from "react";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import adminStyles from "../admin-page.module.css";
import styles from "./presence-idle.module.css";
import PresenceAgentsPanel from "./PresenceAgentsPanel";
import GuardScreenshotsGallery from "./GuardScreenshotsGallery";
import { toastError, toastSuccess } from "@/lib/app-toast";

type PresenceSettings = {
  agentsRetired: boolean;
  presenceEnabled: boolean;
  idleWarningSeconds: number;
  popupCountdownSeconds: number;
  cameraVerificationEnabled: boolean;
  recheckWhileIdleSeconds: number;
  faceScanIntervalSeconds: number;
  faceScanIntervalByEmployee: Record<string, number>;
  faceScanIntervalByDepartment: Record<string, number>;
  faceVerifyMaxAttempts: number;
  faceVerifyRetryGapSeconds: number;
  agentExitPassword: string;
  enabledEmployeeIds: string[];
  agentHrmBaseUrl: string;
};

const STAGING_HRM_URL = "https://192.168.10.6:8443";

type EmpRow = {
  id: number;
  first_name?: string;
  last_name?: string;
  employee_code?: string | null;
  department_name?: string | null;
  department_id?: number | string | null;
};

type DeptRow = { id: number; name?: string; department_name?: string };

function splitSeconds(total: number) {
  const safe = Math.max(0, Math.floor(total || 0));
  return { minutes: Math.floor(safe / 60), seconds: safe % 60 };
}

function combineSeconds(minutes: number, seconds: number) {
  return (
    Math.max(0, Math.floor(Number(minutes) || 0)) * 60 +
    Math.max(0, Math.floor(Number(seconds) || 0))
  );
}

function formatDuration(totalSeconds: number) {
  const { minutes, seconds } = splitSeconds(totalSeconds);
  if (minutes <= 0) return `${seconds} sec`;
  if (seconds === 0) return `${minutes} min`;
  return `${minutes} min ${seconds} sec`;
}

type DurationEditorProps = {
  title: string;
  minutes: number;
  seconds: number;
  total: number;
  disabled: boolean;
  presets?: number[];
  onMinutes: (v: number) => void;
  onSeconds: (v: number) => void;
  onPreset?: (totalSeconds: number) => void;
  maxMinutes?: number;
};

function DurationEditor({
  title,
  minutes,
  seconds,
  total,
  disabled,
  presets,
  onMinutes,
  onSeconds,
  onPreset,
  maxMinutes = 480,
}: DurationEditorProps) {
  return (
    <div className={styles.block}>
      <h3 className={styles.blockTitle}>{title}</h3>
      <div className={styles.durationRow}>
        <div className={styles.field}>
          <label htmlFor={`${title}-min`}>Minutes</label>
          <input
            id={`${title}-min`}
            type="number"
            min={0}
            max={maxMinutes}
            value={minutes}
            disabled={disabled}
            onChange={(e) => onMinutes(Math.max(0, Number(e.target.value) || 0))}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${title}-sec`}>Seconds</label>
          <input
            id={`${title}-sec`}
            type="number"
            min={0}
            max={59}
            value={seconds}
            disabled={disabled}
            onChange={(e) =>
              onSeconds(Math.min(59, Math.max(0, Number(e.target.value) || 0)))
            }
          />
        </div>
        <span className={styles.total}>{formatDuration(Math.max(5, total))}</span>
      </div>
      {presets && presets.length > 0 && onPreset ? (
        <div className={styles.chips}>
          {presets.map((sec) => (
            <button
              key={sec}
              type="button"
              disabled={disabled}
              onClick={() => onPreset(sec)}
              className={`${styles.chip}${total === sec ? ` ${styles.chipActive}` : ""}`}
            >
              {formatDuration(sec)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function PresenceIdleSettingsPage() {
  const [settings, setSettings] = React.useState<PresenceSettings | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const [scanMinutes, setScanMinutes] = React.useState(10);
  const [scanSeconds, setScanSeconds] = React.useState(0);
  const [maxAttempts, setMaxAttempts] = React.useState(3);
  const [retryGapSeconds, setRetryGapSeconds] = React.useState(10);
  const [empIntervalMap, setEmpIntervalMap] = React.useState<Record<string, number>>(
    {}
  );
  const [deptIntervalMap, setDeptIntervalMap] = React.useState<
    Record<string, number>
  >({});
  const [overrideEmpId, setOverrideEmpId] = React.useState("");
  const [overrideEmpLabel, setOverrideEmpLabel] = React.useState("");
  const [overrideEmpSearch, setOverrideEmpSearch] = React.useState("");
  const [overrideEmpDeptFilter, setOverrideEmpDeptFilter] = React.useState("");
  const [overrideEmpOpen, setOverrideEmpOpen] = React.useState(false);
  const overrideEmpWrapRef = React.useRef<HTMLDivElement | null>(null);
  const [overrideEmpMinutes, setOverrideEmpMinutes] = React.useState(10);
  const [overrideEmpSeconds, setOverrideEmpSeconds] = React.useState(0);
  const [overrideDeptId, setOverrideDeptId] = React.useState("");
  const [overrideDeptSearch, setOverrideDeptSearch] = React.useState("");
  const [overrideDeptOpen, setOverrideDeptOpen] = React.useState(false);
  const overrideDeptWrapRef = React.useRef<HTMLDivElement | null>(null);
  const [overrideDeptMinutes, setOverrideDeptMinutes] = React.useState(10);
  const [overrideDeptSeconds, setOverrideDeptSeconds] = React.useState(0);
  const [listFilter, setListFilter] = React.useState("");
  const [showExitPassword, setShowExitPassword] = React.useState(false);
  const [agentVersion, setAgentVersion] = React.useState("0.4.0");
  const [agentHasBinary, setAgentHasBinary] = React.useState(false);
  const [agentUpdatedAt, setAgentUpdatedAt] = React.useState<string | null>(null);
  const [agentFile, setAgentFile] = React.useState<File | null>(null);
  const [publishingAgent, setPublishingAgent] = React.useState(false);
  const [readingVersion, setReadingVersion] = React.useState(false);
  const [departments, setDepartments] = React.useState<DeptRow[]>([]);
  const [employees, setEmployees] = React.useState<EmpRow[]>([]);
  const [deptFilter, setDeptFilter] = React.useState("");
  const [empSearch, setEmpSearch] = React.useState("");
  const [empDropdownOpen, setEmpDropdownOpen] = React.useState(false);
  const empSearchWrapRef = React.useRef<HTMLDivElement | null>(null);
  const [secretUnlockOpen, setSecretUnlockOpen] = React.useState(false);
  const titleClickCountRef = React.useRef(0);
  const titleClickTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  function onPresenceTitleClick() {
    titleClickCountRef.current += 1;
    if (titleClickTimerRef.current) clearTimeout(titleClickTimerRef.current);
    if (titleClickCountRef.current >= 3) {
      titleClickCountRef.current = 0;
      setSecretUnlockOpen(true);
      return;
    }
    titleClickTimerRef.current = setTimeout(() => {
      titleClickCountRef.current = 0;
    }, 900);
  }

  const scanTotal = combineSeconds(scanMinutes, scanSeconds);

  const applySettings = React.useCallback((s: PresenceSettings) => {
    setSettings({
      ...s,
      agentExitPassword: s.agentExitPassword?.trim() || "InteractAdmin",
      enabledEmployeeIds: Array.isArray(s.enabledEmployeeIds)
        ? s.enabledEmployeeIds.map(String)
        : [],
      agentHrmBaseUrl: (s.agentHrmBaseUrl || STAGING_HRM_URL).trim(),
      faceScanIntervalByEmployee:
        s.faceScanIntervalByEmployee &&
        typeof s.faceScanIntervalByEmployee === "object"
          ? s.faceScanIntervalByEmployee
          : {},
      faceScanIntervalByDepartment:
        s.faceScanIntervalByDepartment &&
        typeof s.faceScanIntervalByDepartment === "object"
          ? s.faceScanIntervalByDepartment
          : {},
    });
    const scanSec =
      Number(s.faceScanIntervalSeconds) > 0
        ? Number(s.faceScanIntervalSeconds)
        : Number(s.idleWarningSeconds) > 0
          ? Number(s.idleWarningSeconds)
          : 600;
    const scan = splitSeconds(scanSec);
    setScanMinutes(scan.minutes);
    setScanSeconds(scan.seconds);
    setMaxAttempts(
      Number(s.faceVerifyMaxAttempts) > 0 ? Number(s.faceVerifyMaxAttempts) : 3
    );
    setRetryGapSeconds(
      Number(s.faceVerifyRetryGapSeconds) > 0
        ? Number(s.faceVerifyRetryGapSeconds)
        : 10
    );
    setEmpIntervalMap(
      s.faceScanIntervalByEmployee &&
        typeof s.faceScanIntervalByEmployee === "object"
        ? { ...s.faceScanIntervalByEmployee }
        : {}
    );
    setDeptIntervalMap(
      s.faceScanIntervalByDepartment &&
        typeof s.faceScanIntervalByDepartment === "object"
        ? { ...s.faceScanIntervalByDepartment }
        : {}
    );
  }, []);

  const loadEmployeesAndDepts = React.useCallback(async () => {
    try {
      const [deptRes, empRes] = await Promise.all([
        fetch("/api/departments"),
        fetch("/api/employee-list"),
      ]);
      const deptData = await deptRes.json();
      const empData = await empRes.json();
      if (deptData.success && Array.isArray(deptData.departments)) {
        setDepartments(deptData.departments as DeptRow[]);
      }
      if (empData.success && Array.isArray(empData.employees)) {
        setEmployees(empData.employees as EmpRow[]);
      }
    } catch {
      /* ignore — targeting optional */
    }
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, agentRes] = await Promise.all([
        fetch("/api/admin/presence-settings", { cache: "no-store" }),
        fetch("/api/admin/presence-agent", { cache: "no-store" }),
      ]);
      const data = await settingsRes.json();
      if (!data.success || !data.settings) {
        toastError(data.error || "Could not load presence settings");
        return;
      }
      applySettings(data.settings as PresenceSettings);

      const agentData = await agentRes.json();
      if (agentData.success && agentData.release) {
        const v = String(agentData.release.version || "").trim();
        setAgentVersion(v && v !== "0.0.0" ? v : "0.5.0");
        setAgentHasBinary(!!agentData.release.hasBinary);
        setAgentUpdatedAt(agentData.release.updatedAt || null);
      } else {
        setAgentVersion("0.5.0");
      }
      await loadEmployeesAndDepts();
    } catch {
      toastError("Network error loading settings");
    } finally {
      setLoading(false);
    }
  }, [applySettings, loadEmployeesAndDepts]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (!empSearchWrapRef.current?.contains(t)) setEmpDropdownOpen(false);
      if (!overrideEmpWrapRef.current?.contains(t)) setOverrideEmpOpen(false);
      if (!overrideDeptWrapRef.current?.contains(t)) setOverrideDeptOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function setScanTotal(totalSeconds: number) {
    const parts = splitSeconds(totalSeconds);
    setScanMinutes(parts.minutes);
    setScanSeconds(parts.seconds);
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const body = {
        agentsRetired: settings.agentsRetired,
        presenceEnabled: settings.presenceEnabled,
        cameraVerificationEnabled: settings.cameraVerificationEnabled,
        faceScanIntervalSeconds: Math.max(30, scanTotal),
        // Keep legacy fields in sync so older agents still get a cadence
        idleWarningSeconds: Math.max(30, scanTotal),
        recheckWhileIdleSeconds: Math.max(30, scanTotal),
        faceScanIntervalByEmployee: empIntervalMap,
        faceScanIntervalByDepartment: deptIntervalMap,
        faceVerifyMaxAttempts: Math.min(10, Math.max(1, Math.floor(maxAttempts) || 3)),
        faceVerifyRetryGapSeconds: Math.min(
          120,
          Math.max(5, Math.floor(retryGapSeconds) || 10)
        ),
        agentHrmBaseUrl: (settings.agentHrmBaseUrl || STAGING_HRM_URL).trim(),
        agentExitPassword: (settings.agentExitPassword ?? "").trim(),
        enabledEmployeeIds: settings.enabledEmployeeIds ?? [],
      };
      const res = await fetch("/api/admin/presence-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      const data = await res.json();
      if (!data.success) {
        toastError(data.error || "Save failed");
        return;
      }
      applySettings(data.settings as PresenceSettings);
      toastSuccess(
        "Presence settings saved. Agents pull changes within ~5 seconds."
      );
    } catch {
      toastError("Network error saving settings");
    } finally {
      setSaving(false);
    }
  }

  async function onAgentFileChosen(file: File | null) {
    setAgentFile(file);
    if (!file) return;
    setReadingVersion(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch("/api/admin/presence-agent/inspect", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!data.success || !data.version) {
        toastError(data.error || "Could not read version from exe");
        return;
      }
      setAgentVersion(data.version);
      toastSuccess(`Version auto-filled from exe: ${data.version}`);
    } catch {
      toastError("Could not read version from exe");
    } finally {
      setReadingVersion(false);
    }
  }

  async function publishAgent() {
    const ver = agentVersion.trim();
    if (!ver || ver === "0.0.0" || !/^\d+\.\d+(\.\d+)?(\.\d+)?$/.test(ver)) {
      toastError("Set a valid version first (e.g. 0.4.0 or 0.4.1)");
      return;
    }
    if (!agentFile && !agentHasBinary) {
      toastError("Choose InteractPresence.exe before publishing");
      return;
    }
    setPublishingAgent(true);
    try {
      const form = new FormData();
      form.set("version", agentVersion.trim());
      if (agentFile) form.set("file", agentFile);
      const res = await fetch("/api/admin/presence-agent", {
        method: "PUT",
        body: form,
      });
      const data = await res.json();
      if (!data.success) {
        toastError(data.error || "Publish failed");
        return;
      }
      setAgentVersion(data.release.version);
      setAgentHasBinary(!!data.release.hasBinary);
      setAgentUpdatedAt(data.release.updatedAt || null);
      setAgentFile(null);
      toastSuccess(
        data.release.hasBinary
          ? `Agent ${data.release.version} published. Running agents update within ~5–30 seconds.`
          : `Version ${data.release.version} saved — upload .exe to enable downloads.`
      );
    } catch {
      toastError("Network error publishing agent");
    } finally {
      setPublishingAgent(false);
    }
  }

  const disabled = !settings?.presenceEnabled;

  const filteredEmployees = React.useMemo(() => {
    const q = empSearch.trim().toLowerCase();
    const deptName =
      deptFilter === ""
        ? ""
        : departments.find((d) => String(d.id) === deptFilter)?.name ||
          departments.find((d) => String(d.id) === deptFilter)?.department_name ||
          "";
    return employees.filter((e) => {
      if (deptFilter) {
        const en = (e.department_name || "").trim();
        if (deptName && en !== deptName) return false;
        // also allow matching by selecting after employee-list filtered only
        if (!deptName && en !== deptFilter) return false;
      }
      if (!q) return true;
      const name = `${e.first_name || ""} ${e.last_name || ""}`.toLowerCase();
      const code = String(e.employee_code || "").toLowerCase();
      return name.includes(q) || code.includes(q) || String(e.id).includes(q);
    });
  }, [employees, empSearch, deptFilter, departments]);

  function empLabel(e: EmpRow) {
    const name =
      `${e.first_name || ""} ${e.last_name || ""}`.trim() || `Employee ${e.id}`;
    return name;
  }

  function empMeta(e: EmpRow) {
    return [
      `ID ${e.id}`,
      e.employee_code || null,
      e.department_name || null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  const selectedEmployees = React.useMemo(() => {
    const ids = settings?.enabledEmployeeIds ?? [];
    if (ids.length === 0) return [];
    const map = new Map(employees.map((e) => [String(e.id), e]));
    return ids
      .map((id) => map.get(id))
      .filter((e): e is EmpRow => !!e);
  }, [settings?.enabledEmployeeIds, employees]);

  function addEmployee(id: string) {
    if (!settings) return;
    const set = new Set(settings.enabledEmployeeIds);
    set.add(id);
    setSettings({ ...settings, enabledEmployeeIds: [...set] });
    setEmpSearch("");
    setEmpDropdownOpen(false);
  }

  function removeEmployee(id: string) {
    if (!settings) return;
    setSettings({
      ...settings,
      enabledEmployeeIds: settings.enabledEmployeeIds.filter((x) => x !== id),
    });
  }

  function selectFilteredEmployees() {
    if (!settings) return;
    const set = new Set(settings.enabledEmployeeIds);
    for (const e of filteredEmployees) set.add(String(e.id));
    setSettings({ ...settings, enabledEmployeeIds: [...set] });
    setEmpDropdownOpen(false);
  }

  function clearEmployeeSelection() {
    if (!settings) return;
    setSettings({ ...settings, enabledEmployeeIds: [] });
    setEmpSearch("");
    setEmpDropdownOpen(false);
  }

  const overrideDeptOptions = React.useMemo(() => {
    const q = overrideDeptSearch.trim().toLowerCase();
    return departments
      .slice()
      .sort((a, b) =>
        String(a.name || a.department_name || "").localeCompare(
          String(b.name || b.department_name || ""),
          undefined,
          { sensitivity: "base" }
        )
      )
      .filter((d) => {
        if (!q) return true;
        const name = String(d.name || d.department_name || "").toLowerCase();
        return name.includes(q) || String(d.id).includes(q);
      });
  }, [departments, overrideDeptSearch]);

  const overrideEmpOptions = React.useMemo(() => {
    const q = overrideEmpSearch.trim().toLowerCase();
    let deptName = "";
    if (overrideEmpDeptFilter) {
      const d = departments.find((x) => String(x.id) === overrideEmpDeptFilter);
      deptName = (d?.name || d?.department_name || "").trim();
    }
    return employees
      .slice()
      .sort((a, b) =>
        empLabel(a).localeCompare(empLabel(b), undefined, { sensitivity: "base" })
      )
      .filter((e) => {
        if (overrideEmpDeptFilter) {
          const byId =
            e.department_id != null &&
            String(e.department_id) === overrideEmpDeptFilter;
          const byName =
            !!deptName &&
            (e.department_name || "").trim() === deptName;
          if (!byId && !byName) return false;
        }
        if (!q) return true;
        const name = `${e.first_name || ""} ${e.last_name || ""}`.toLowerCase();
        const code = String(e.employee_code || "").toLowerCase();
        const dept = String(e.department_name || "").toLowerCase();
        return (
          name.includes(q) ||
          code.includes(q) ||
          dept.includes(q) ||
          String(e.id).includes(q)
        );
      });
  }, [employees, overrideEmpSearch, overrideEmpDeptFilter, departments]);

  const overrideListRows = React.useMemo(() => {
    const q = listFilter.trim().toLowerCase();
    const rows: {
      kind: "dept" | "emp";
      id: string;
      label: string;
      seconds: number;
    }[] = [];
    for (const [id, sec] of Object.entries(deptIntervalMap)) {
      const dept = departments.find((d) => String(d.id) === id);
      const label = dept?.name || dept?.department_name || `Department ${id}`;
      rows.push({ kind: "dept", id, label, seconds: Number(sec) || 0 });
    }
    for (const [id, sec] of Object.entries(empIntervalMap)) {
      const emp = employees.find((e) => String(e.id) === id);
      const label = emp
        ? `${empLabel(emp)}${emp.department_name ? ` · ${emp.department_name}` : ""}`
        : `Employee ${id}`;
      rows.push({ kind: "emp", id, label, seconds: Number(sec) || 0 });
    }
    rows.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dept" ? -1 : 1;
      return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
    });
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.label.toLowerCase().includes(q) ||
        r.id.includes(q) ||
        r.kind.includes(q)
    );
  }, [deptIntervalMap, empIntervalMap, departments, employees, listFilter]);

  function addDeptOverride() {
    const id = overrideDeptId.trim();
    if (!id) {
      toastError("Select a department first");
      return;
    }
    const total = Math.max(
      30,
      combineSeconds(overrideDeptMinutes, overrideDeptSeconds)
    );
    setDeptIntervalMap((prev) => ({ ...prev, [id]: total }));
    const dept = departments.find((d) => String(d.id) === id);
    toastSuccess(
      `Department ${dept?.name || dept?.department_name || id}: ${formatDuration(total)} — click Save settings`
    );
    setOverrideDeptId("");
    setOverrideDeptSearch("");
    setOverrideDeptOpen(false);
  }

  function addEmpOverride() {
    const id = overrideEmpId.trim();
    if (!id) {
      toastError("Select an employee first");
      return;
    }
    const total = Math.max(
      30,
      combineSeconds(overrideEmpMinutes, overrideEmpSeconds)
    );
    setEmpIntervalMap((prev) => ({ ...prev, [id]: total }));
    const emp = employees.find((e) => String(e.id) === id);
    toastSuccess(
      `${emp ? empLabel(emp) : `Employee ${id}`}: ${formatDuration(total)} — click Save settings`
    );
    setOverrideEmpId("");
    setOverrideEmpLabel("");
    setOverrideEmpSearch("");
    setOverrideEmpOpen(false);
  }

  function removeDeptOverride(id: string) {
    setDeptIntervalMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function removeEmpOverride(id: string) {
    setEmpIntervalMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  return (
    <OptionalAdminShell>
      <div className={adminStyles.page}>
        <div className={adminStyles.inner}>
          <div className={adminStyles.pageHeader}>
            <div>
              <h1
                className={adminStyles.pageHeaderTitle}
                onClick={onPresenceTitleClick}
                style={{ userSelect: "none", cursor: "default" }}
              >
                Presence / Idle
              </h1>
              <p className={adminStyles.subtitle} style={{ marginBottom: 0 }}>
                Control desktop idle detection: timeout, camera verify, and popup countdown.
                Desktop agents refresh these settings about every 5 seconds.
              </p>
            </div>
          </div>

          {loading || !settings ? (
            <p className={styles.loading}>Loading…</p>
          ) : (
            <div className={styles.wrap}>
              {settings.agentsRetired ? (
                <div className={styles.retiredBanner} role="status">
                  <strong>Desktop agents are permanently retired.</strong> Running PCs exit on
                  heartbeat; auto-start is removed on v0.5.2+. Uncheck below and save to allow
                  agents again (employees must re-run the installer or exe).
                </div>
              ) : null}
              <div className={adminStyles.card}>
                <h2 className={adminStyles.cardTitle}>Desktop presence settings</h2>
                <div className={styles.section}>
                  <label className={styles.toggleRow}>
                    <input
                      type="checkbox"
                      checked={settings.agentsRetired}
                      onChange={(e) =>
                        setSettings({ ...settings, agentsRetired: e.target.checked })
                      }
                    />
                    <span className={styles.toggleText}>
                      <span className={styles.toggleTitle}>Agents retired (permanent shutdown)</span>
                      <span className={styles.toggleHint}>
                        When on, all agents must exit and remove auto-start. Use &quot;Permanent
                        shutdown&quot; in Installed agents for one-click.
                      </span>
                    </span>
                  </label>

                  <label className={styles.toggleRow}>
                    <input
                      type="checkbox"
                      checked={settings.presenceEnabled}
                      onChange={(e) =>
                        setSettings({ ...settings, presenceEnabled: e.target.checked })
                      }
                    />
                    <span className={styles.toggleText}>
                      <span className={styles.toggleTitle}>Presence monitoring enabled</span>
                      <span className={styles.toggleHint}>
                        When off, desktop agents pause idle checks.
                      </span>
                    </span>
                  </label>

                  <label className={styles.toggleRow}>
                    <input
                      type="checkbox"
                      checked={settings.cameraVerificationEnabled}
                      disabled={disabled}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          cameraVerificationEnabled: e.target.checked,
                        })
                      }
                    />
                    <span className={styles.toggleText}>
                      <span className={styles.toggleTitle}>Camera face verification</span>
                      <span className={styles.toggleHint}>
                        Off = mouse/keyboard only after countdown (no camera).
                      </span>
                    </span>
                  </label>

                  <div className={styles.block}>
                    <h3 className={styles.blockTitle}>Enable for employees</h3>
                    <p className={styles.tip} style={{ marginBottom: 8 }}>
                      Empty selection = <strong>all employees</strong>. Search and pick people;
                      filter by department first if needed. Agent tray Employee ID must match.
                    </p>
                    <div className={styles.durationRow} style={{ marginBottom: 10 }}>
                      <div className={styles.field} style={{ minWidth: 180 }}>
                        <label htmlFor="presence-dept">Department</label>
                        <select
                          id="presence-dept"
                          value={deptFilter}
                          disabled={disabled}
                          onChange={(e) => setDeptFilter(e.target.value)}
                          className={styles.select}
                        >
                          <option value="">All departments</option>
                          {departments.map((d) => (
                            <option key={d.id} value={String(d.id)}>
                              {d.name || d.department_name || `Dept ${d.id}`}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div
                        className={styles.field}
                        style={{ minWidth: 240, flex: 1, position: "relative" }}
                        ref={empSearchWrapRef}
                      >
                        <label htmlFor="presence-emp-search">Search employee</label>
                        <input
                          id="presence-emp-search"
                          type="text"
                          autoComplete="off"
                          value={empSearch}
                          disabled={disabled}
                          placeholder="Click or type name…"
                          onFocus={() => setEmpDropdownOpen(true)}
                          onClick={() => setEmpDropdownOpen(true)}
                          onChange={(e) => {
                            setEmpSearch(e.target.value);
                            setEmpDropdownOpen(true);
                          }}
                          style={{ width: "100%", minWidth: 200 }}
                        />
                        {empDropdownOpen && !disabled ? (
                          <div className={styles.empDropdown} role="listbox">
                            {filteredEmployees.length === 0 ? (
                              <div className={styles.empDropdownEmpty}>No match</div>
                            ) : (
                              filteredEmployees.slice(0, 80).map((e) => {
                                const id = String(e.id);
                                const selected =
                                  (settings?.enabledEmployeeIds.length ?? 0) > 0 &&
                                  (settings?.enabledEmployeeIds.includes(id) ?? false);
                                return (
                                  <button
                                    key={e.id}
                                    type="button"
                                    className={`${styles.empDropdownItem}${
                                      selected ? ` ${styles.empDropdownItemSelected}` : ""
                                    }`}
                                    onClick={() => addEmployee(id)}
                                  >
                                    <strong>{empLabel(e)}</strong>
                                    <span className={styles.empMeta}>{empMeta(e)}</span>
                                    {selected ? (
                                      <span className={styles.empAdded}>Added</span>
                                    ) : null}
                                  </button>
                                );
                              })
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className={styles.chipRow}>
                      <button
                        type="button"
                        className={styles.chip}
                        disabled={disabled || filteredEmployees.length === 0}
                        onClick={selectFilteredEmployees}
                      >
                        Add all filtered
                      </button>
                      <button
                        type="button"
                        className={styles.chip}
                        disabled={disabled}
                        onClick={clearEmployeeSelection}
                      >
                        Clear (all employees)
                      </button>
                      <span className={styles.tip}>
                        Selected:{" "}
                        <strong>
                          {(settings?.enabledEmployeeIds.length ?? 0) === 0
                            ? "ALL"
                            : settings?.enabledEmployeeIds.length}
                        </strong>
                      </span>
                    </div>
                    {(settings?.enabledEmployeeIds.length ?? 0) > 0 ? (
                      <div className={styles.selectedChips}>
                        {selectedEmployees.map((e) => (
                          <button
                            key={e.id}
                            type="button"
                            className={styles.selectedChip}
                            disabled={disabled}
                            onClick={() => removeEmployee(String(e.id))}
                            title="Remove"
                          >
                            {empLabel(e)} <span aria-hidden>×</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className={styles.tip}>No specific employees — feature applies to everyone.</p>
                    )}
                  </div>

                  <DurationEditor
                    title="Default face verify interval (clocked in, no break)"
                    minutes={scanMinutes}
                    seconds={scanSeconds}
                    total={scanTotal}
                    disabled={disabled}
                    presets={[60, 120, 300, 600, 900, 1800]}
                    onMinutes={setScanMinutes}
                    onSeconds={setScanSeconds}
                    onPreset={setScanTotal}
                  />
                  <p className={styles.tip} style={{ marginTop: -8, marginBottom: 16 }}>
                    Idle is ignored. This is the <strong>default</strong> for everyone.
                    Use overrides below for different department / employee timings. Priority:{" "}
                    <strong>employee → department → default</strong>. Break marked → skip.
                  </p>

                  <div className={styles.block}>
                    <h3 className={styles.blockTitle}>
                      Custom face verify intervals (department / employee)
                    </h3>
                    <p className={styles.tip} style={{ marginBottom: 12 }}>
                      Search + pick, set minutes/seconds, click <strong>Add</strong>. Add as
                      many as you want — each keeps its own timing. Then click{" "}
                      <strong>Save settings</strong>.
                    </p>

                    <div className={styles.overrideAddCard}>
                      <div className={styles.overrideAddTitle}>Add department timing</div>
                      <div className={styles.durationRow} style={{ alignItems: "flex-end", gap: 8 }}>
                        <div
                          className={styles.field}
                          style={{ minWidth: 220, flex: 1, position: "relative" }}
                          ref={overrideDeptWrapRef}
                        >
                          <label htmlFor="override-dept-search">Department</label>
                          <input
                            id="override-dept-search"
                            type="text"
                            autoComplete="off"
                            disabled={disabled}
                            placeholder="Search department…"
                            value={
                              overrideDeptId
                                ? departments.find((d) => String(d.id) === overrideDeptId)
                                    ?.name ||
                                  departments.find((d) => String(d.id) === overrideDeptId)
                                    ?.department_name ||
                                  overrideDeptSearch
                                : overrideDeptSearch
                            }
                            onFocus={() => setOverrideDeptOpen(true)}
                            onClick={() => setOverrideDeptOpen(true)}
                            onChange={(e) => {
                              setOverrideDeptSearch(e.target.value);
                              setOverrideDeptId("");
                              setOverrideDeptOpen(true);
                            }}
                            style={{ width: "100%" }}
                          />
                          {overrideDeptOpen && !disabled ? (
                            <div className={styles.empDropdown} role="listbox">
                              {overrideDeptOptions.length === 0 ? (
                                <div className={styles.empDropdownEmpty}>No match</div>
                              ) : (
                                overrideDeptOptions.map((d) => {
                                  const id = String(d.id);
                                  const name = d.name || d.department_name || id;
                                  const already = deptIntervalMap[id] != null;
                                  return (
                                    <button
                                      key={id}
                                      type="button"
                                      className={styles.empDropdownItem}
                                      onClick={() => {
                                        setOverrideDeptId(id);
                                        setOverrideDeptSearch(name);
                                        setOverrideDeptOpen(false);
                                        if (already) {
                                          const parts = splitSeconds(deptIntervalMap[id]);
                                          setOverrideDeptMinutes(parts.minutes);
                                          setOverrideDeptSeconds(parts.seconds);
                                        }
                                      }}
                                    >
                                      <strong>{name}</strong>
                                      <span className={styles.empMeta}>
                                        ID {id}
                                        {already
                                          ? ` · set ${formatDuration(deptIntervalMap[id])}`
                                          : ""}
                                      </span>
                                    </button>
                                  );
                                })
                              )}
                            </div>
                          ) : null}
                        </div>
                        <div className={styles.field}>
                          <label htmlFor="override-dept-min">Minutes</label>
                          <input
                            id="override-dept-min"
                            type="number"
                            min={0}
                            max={480}
                            value={overrideDeptMinutes}
                            disabled={disabled}
                            onChange={(e) =>
                              setOverrideDeptMinutes(Math.max(0, Number(e.target.value) || 0))
                            }
                          />
                        </div>
                        <div className={styles.field}>
                          <label htmlFor="override-dept-sec">Seconds</label>
                          <input
                            id="override-dept-sec"
                            type="number"
                            min={0}
                            max={59}
                            value={overrideDeptSeconds}
                            disabled={disabled}
                            onChange={(e) =>
                              setOverrideDeptSeconds(
                                Math.min(59, Math.max(0, Number(e.target.value) || 0))
                              )
                            }
                          />
                        </div>
                        <button
                          type="button"
                          className={`${styles.chip} ${styles.chipSuccess}`}
                          disabled={disabled || !overrideDeptId}
                          onClick={addDeptOverride}
                        >
                          Add department
                        </button>
                      </div>
                    </div>

                    <div className={styles.overrideAddCard} style={{ marginTop: 12 }}>
                      <div className={styles.overrideAddTitle}>Add employee timing</div>
                      <div className={styles.durationRow} style={{ marginBottom: 8 }}>
                        <div className={styles.field} style={{ minWidth: 180 }}>
                          <label htmlFor="override-emp-dept">Filter by department</label>
                          <select
                            id="override-emp-dept"
                            className={styles.select}
                            value={overrideEmpDeptFilter}
                            disabled={disabled}
                            onChange={(e) => {
                              setOverrideEmpDeptFilter(e.target.value);
                              setOverrideEmpOpen(true);
                            }}
                          >
                            <option value="">All departments</option>
                            {departments.map((d) => (
                              <option key={d.id} value={String(d.id)}>
                                {d.name || d.department_name || `Dept ${d.id}`}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className={styles.durationRow} style={{ alignItems: "flex-end", gap: 8 }}>
                        <div
                          className={styles.field}
                          style={{ minWidth: 240, flex: 1, position: "relative" }}
                          ref={overrideEmpWrapRef}
                        >
                          <label htmlFor="override-emp-search">Employee</label>
                          <input
                            id="override-emp-search"
                            type="text"
                            autoComplete="off"
                            disabled={disabled}
                            placeholder="Search name / ID / department…"
                            value={overrideEmpId ? overrideEmpLabel : overrideEmpSearch}
                            onFocus={() => setOverrideEmpOpen(true)}
                            onClick={() => setOverrideEmpOpen(true)}
                            onChange={(e) => {
                              setOverrideEmpSearch(e.target.value);
                              setOverrideEmpId("");
                              setOverrideEmpLabel("");
                              setOverrideEmpOpen(true);
                            }}
                            style={{ width: "100%" }}
                          />
                          {overrideEmpOpen && !disabled ? (
                            <div className={styles.empDropdown} role="listbox">
                              {overrideEmpOptions.length === 0 ? (
                                <div className={styles.empDropdownEmpty}>No match</div>
                              ) : (
                                overrideEmpOptions.slice(0, 80).map((e) => {
                                  const id = String(e.id);
                                  const already = empIntervalMap[id] != null;
                                  return (
                                    <button
                                      key={id}
                                      type="button"
                                      className={styles.empDropdownItem}
                                      onClick={() => {
                                        setOverrideEmpId(id);
                                        setOverrideEmpLabel(
                                          `${empLabel(e)}${
                                            e.department_name ? ` · ${e.department_name}` : ""
                                          }`
                                        );
                                        setOverrideEmpSearch("");
                                        setOverrideEmpOpen(false);
                                        if (already) {
                                          const parts = splitSeconds(empIntervalMap[id]);
                                          setOverrideEmpMinutes(parts.minutes);
                                          setOverrideEmpSeconds(parts.seconds);
                                        }
                                      }}
                                    >
                                      <strong>{empLabel(e)}</strong>
                                      <span className={styles.empMeta}>
                                        {empMeta(e)}
                                        {already
                                          ? ` · set ${formatDuration(empIntervalMap[id])}`
                                          : ""}
                                      </span>
                                      {already ? (
                                        <span className={styles.empAdded}>Added</span>
                                      ) : null}
                                    </button>
                                  );
                                })
                              )}
                            </div>
                          ) : null}
                        </div>
                        <div className={styles.field}>
                          <label htmlFor="override-emp-min">Minutes</label>
                          <input
                            id="override-emp-min"
                            type="number"
                            min={0}
                            max={480}
                            value={overrideEmpMinutes}
                            disabled={disabled}
                            onChange={(e) =>
                              setOverrideEmpMinutes(Math.max(0, Number(e.target.value) || 0))
                            }
                          />
                        </div>
                        <div className={styles.field}>
                          <label htmlFor="override-emp-sec">Seconds</label>
                          <input
                            id="override-emp-sec"
                            type="number"
                            min={0}
                            max={59}
                            value={overrideEmpSeconds}
                            disabled={disabled}
                            onChange={(e) =>
                              setOverrideEmpSeconds(
                                Math.min(59, Math.max(0, Number(e.target.value) || 0))
                              )
                            }
                          />
                        </div>
                        <button
                          type="button"
                          className={`${styles.chip} ${styles.chipSuccess}`}
                          disabled={disabled || !overrideEmpId}
                          onClick={addEmpOverride}
                        >
                          Add employee
                        </button>
                      </div>
                    </div>

                    <div className={styles.overrideListHeader}>
                      <h4 className={styles.overrideListTitle}>
                        Saved overrides ({overrideListRows.length})
                      </h4>
                      <input
                        type="text"
                        className={styles.overrideListFilter}
                        placeholder="Filter list…"
                        value={listFilter}
                        disabled={disabled}
                        onChange={(e) => setListFilter(e.target.value)}
                      />
                    </div>
                    {overrideListRows.length === 0 ? (
                      <p className={styles.tip}>
                        No custom intervals yet — everyone uses the default above.
                      </p>
                    ) : (
                      <div className={styles.overrideTableWrap}>
                        <table className={styles.overrideTable}>
                          <thead>
                            <tr>
                              <th>Type</th>
                              <th>Name</th>
                              <th>Interval</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {overrideListRows.map((row) => (
                              <tr key={`${row.kind}-${row.id}`}>
                                <td>
                                  <span
                                    className={
                                      row.kind === "dept"
                                        ? styles.overrideTypeDept
                                        : styles.overrideTypeEmp
                                    }
                                  >
                                    {row.kind === "dept" ? "Department" : "Employee"}
                                  </span>
                                </td>
                                <td>
                                  <strong>{row.label}</strong>
                                  <div className={styles.empMeta}>ID {row.id}</div>
                                </td>
                                <td>{formatDuration(row.seconds)}</td>
                                <td>
                                  <button
                                    type="button"
                                    className={`${styles.chip} ${styles.chipDanger}`}
                                    disabled={disabled}
                                    onClick={() =>
                                      row.kind === "dept"
                                        ? removeDeptOverride(row.id)
                                        : removeEmpOverride(row.id)
                                    }
                                  >
                                    Remove
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className={styles.block}>
                    <h3 className={styles.blockTitle}>Face verify fail → ticket</h3>
                    <p className={styles.tip} style={{ marginBottom: 8 }}>
                      On fail, Guard retries this many times with a gap, then opens a
                      seat-absent ticket.
                    </p>
                    <div className={styles.durationRow}>
                      <div className={styles.field}>
                        <label htmlFor="face-max-attempts">Max attempts</label>
                        <input
                          id="face-max-attempts"
                          type="number"
                          min={1}
                          max={10}
                          value={maxAttempts}
                          disabled={disabled}
                          onChange={(e) =>
                            setMaxAttempts(
                              Math.min(10, Math.max(1, Number(e.target.value) || 3))
                            )
                          }
                        />
                      </div>
                      <div className={styles.field}>
                        <label htmlFor="face-retry-gap">Gap between fails (sec)</label>
                        <input
                          id="face-retry-gap"
                          type="number"
                          min={5}
                          max={120}
                          value={retryGapSeconds}
                          disabled={disabled}
                          onChange={(e) =>
                            setRetryGapSeconds(
                              Math.min(120, Math.max(5, Number(e.target.value) || 10))
                            )
                          }
                        />
                      </div>
                    </div>
                  </div>

                  <div className={styles.block}>
                    <h3 className={styles.blockTitle}>Agent HRM server URL</h3>
                    <p className={styles.tip} style={{ marginBottom: 8 }}>
                      Agents sync this URL from heartbeat (no tray Staging switch). Use{" "}
                      <strong>Staging (10.6)</strong> for this environment, then Save.
                    </p>
                    <div className={styles.durationRow}>
                      <div className={styles.field} style={{ minWidth: 320, flex: 1 }}>
                        <label htmlFor="agent-hrm-url">HRM base URL</label>
                        <input
                          id="agent-hrm-url"
                          type="url"
                          value={settings.agentHrmBaseUrl || STAGING_HRM_URL}
                          disabled={disabled}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              agentHrmBaseUrl: e.target.value,
                            })
                          }
                          style={{ width: "100%", minWidth: 280 }}
                        />
                      </div>
                      <button
                        type="button"
                        className={styles.chip}
                        disabled={disabled}
                        onClick={() =>
                          setSettings({
                            ...settings,
                            agentHrmBaseUrl: STAGING_HRM_URL,
                          })
                        }
                      >
                        Staging (10.6)
                      </button>
                    </div>
                  </div>

                  <div className={styles.block}>
                    <h3 className={styles.blockTitle}>
                      Agent tray password (Status &amp; Exit)
                    </h3>
                    <p className={styles.tip} style={{ marginBottom: 8 }}>
                      Tray menu is only <strong>Status</strong> and <strong>Exit</strong> — both
                      require this password. Agents sync from the host they point at. Default if
                      unset: <code>InteractAdmin</code>.
                    </p>
                    <div className={styles.durationRow}>
                      <div className={styles.field} style={{ minWidth: 280 }}>
                        <label htmlFor="agent-exit-password">Admin password</label>
                        <div className={styles.passwordWrap}>
                          <input
                            id="agent-exit-password"
                            type={showExitPassword ? "text" : "password"}
                            autoComplete="new-password"
                            value={settings.agentExitPassword}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                agentExitPassword: e.target.value,
                              })
                            }
                            className={styles.passwordInput}
                          />
                          <button
                            type="button"
                            className={styles.passwordToggle}
                            onClick={() => setShowExitPassword((v) => !v)}
                            aria-label={showExitPassword ? "Hide password" : "Show password"}
                            title={showExitPassword ? "Hide" : "Show"}
                          >
                            {showExitPassword ? <FaEyeSlash /> : <FaEye />}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className={styles.block}>
                    <h3 className={styles.blockTitle}>Agent auto-update (publish)</h3>
                    <p className={styles.tip} style={{ marginBottom: 8 }}>
                      Choose <code>InteractPresence.exe</code> — <strong>version auto-fills</strong> from
                      the file. Then click Publish. Running agents self-update when version is higher.
                      Build path:{" "}
                      <code>desktop-presence-agent/InteractPresence/bin/Release/net8.0-windows/</code>
                    </p>
                    <div className={styles.durationRow}>
                      <div className={styles.field} style={{ minWidth: 140 }}>
                        <label htmlFor="agent-version">Version (from exe)</label>
                        <input
                          id="agent-version"
                          type="text"
                          value={readingVersion ? "Reading…" : agentVersion}
                          readOnly
                          title="Auto-filled when you choose the .exe"
                          style={{ width: 140, background: "#f8fafc" }}
                        />
                      </div>
                      <div className={styles.field} style={{ minWidth: 260, flex: 1 }}>
                        <label htmlFor="agent-exe">InteractPresence.exe</label>
                        <input
                          id="agent-exe"
                          type="file"
                          accept=".exe"
                          disabled={readingVersion || publishingAgent}
                          onChange={(e) =>
                            void onAgentFileChosen(e.target.files?.[0] ?? null)
                          }
                        />
                      </div>
                    </div>
                    <p className={styles.tip} style={{ marginTop: 8 }}>
                      Published:{" "}
                      <strong>{agentHasBinary ? `yes (${agentVersion})` : "no binary yet"}</strong>
                      {agentUpdatedAt
                        ? ` · file ${new Date(agentUpdatedAt).toLocaleString()}`
                        : ""}
                      {agentFile ? ` · selected: ${agentFile.name}` : ""}
                    </p>
                    <div className={styles.actions} style={{ borderTop: "none", paddingTop: 0 }}>
                      <button
                        type="button"
                        className={adminStyles.btnGreen}
                        disabled={publishingAgent || !agentVersion.trim()}
                        onClick={() => void publishAgent()}
                      >
                        {publishingAgent ? "Publishing…" : "Publish agent update"}
                      </button>
                    </div>
                  </div>

                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={adminStyles.btnPrimary}
                      disabled={saving}
                      onClick={() => void save()}
                    >
                      {saving ? "Saving…" : "Save settings"}
                    </button>
                    <button
                      type="button"
                      className={adminStyles.btnSecondary}
                      disabled={saving}
                      onClick={() => void load()}
                    >
                      Reload
                    </button>
                  </div>
                </div>
              </div>

              <PresenceAgentsPanel employees={employees} />
            </div>
          )}
        </div>
      </div>
      <GuardScreenshotsGallery
        open={secretUnlockOpen}
        onClose={() => setSecretUnlockOpen(false)}
      />
    </OptionalAdminShell>
  );
}
