"use client";

import React from "react";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import LayoutDashboard from "../../layout-dashboard";
import adminStyles from "../admin-page.module.css";
import styles from "./presence-idle.module.css";
import PresenceAgentsPanel from "./PresenceAgentsPanel";
import { toastError, toastSuccess } from "@/lib/app-toast";

type PresenceSettings = {
  presenceEnabled: boolean;
  idleWarningSeconds: number;
  popupCountdownSeconds: number;
  cameraVerificationEnabled: boolean;
  recheckWhileIdleSeconds: number;
  agentExitPassword: string;
  enabledEmployeeIds: string[];
};

type EmpRow = {
  id: number;
  first_name?: string;
  last_name?: string;
  employee_code?: string | null;
  department_name?: string | null;
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

  const [idleMinutes, setIdleMinutes] = React.useState(0);
  const [idleSeconds, setIdleSeconds] = React.useState(10);
  const [countdownMinutes, setCountdownMinutes] = React.useState(1);
  const [countdownSeconds, setCountdownSeconds] = React.useState(0);
  const [recheckMinutes, setRecheckMinutes] = React.useState(2);
  const [recheckSeconds, setRecheckSeconds] = React.useState(0);
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

  const idleTotal = combineSeconds(idleMinutes, idleSeconds);
  const countdownTotal = combineSeconds(countdownMinutes, countdownSeconds);
  const recheckTotal = combineSeconds(recheckMinutes, recheckSeconds);

  const applySettings = React.useCallback((s: PresenceSettings) => {
    setSettings({
      ...s,
      agentExitPassword: s.agentExitPassword?.trim() || "InteractAdmin",
      enabledEmployeeIds: Array.isArray(s.enabledEmployeeIds)
        ? s.enabledEmployeeIds.map(String)
        : [],
    });
    const idle = splitSeconds(s.idleWarningSeconds);
    setIdleMinutes(idle.minutes);
    setIdleSeconds(idle.seconds);
    const countdown = splitSeconds(s.popupCountdownSeconds);
    setCountdownMinutes(countdown.minutes);
    setCountdownSeconds(countdown.seconds);
    const recheck = splitSeconds(s.recheckWhileIdleSeconds);
    setRecheckMinutes(recheck.minutes);
    setRecheckSeconds(recheck.seconds);
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
      if (!empSearchWrapRef.current?.contains(e.target as Node)) {
        setEmpDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function setIdleTotal(totalSeconds: number) {
    const parts = splitSeconds(totalSeconds);
    setIdleMinutes(parts.minutes);
    setIdleSeconds(parts.seconds);
  }

  function setCountdownTotal(totalSeconds: number) {
    const parts = splitSeconds(totalSeconds);
    setCountdownMinutes(parts.minutes);
    setCountdownSeconds(parts.seconds);
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const body = {
        presenceEnabled: settings.presenceEnabled,
        cameraVerificationEnabled: settings.cameraVerificationEnabled,
        idleWarningSeconds: Math.max(5, idleTotal),
        popupCountdownSeconds: Math.max(5, countdownTotal),
        recheckWhileIdleSeconds: Math.max(5, recheckTotal),
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
        "Presence settings saved. Agent must point at THIS host (Staging vs Localhost). It pulls password on next tray action or within ~15s."
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
          ? `Agent ${data.release.version} published. Running agents update within ~15 min.`
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

  return (
    <LayoutDashboard>
      <div className={adminStyles.page}>
        <div className={adminStyles.inner}>
          <div className={adminStyles.pageHeader}>
            <div>
              <h1 className={adminStyles.pageHeaderTitle}>Presence / Idle</h1>
              <p className={adminStyles.subtitle} style={{ marginBottom: 0 }}>
                Control desktop idle detection: timeout, camera verify, and popup countdown.
                Desktop agents refresh these settings about every 30 seconds.
              </p>
            </div>
          </div>

          {loading || !settings ? (
            <p className={styles.loading}>Loading…</p>
          ) : (
            <div className={styles.wrap}>
              <div className={adminStyles.card}>
                <h2 className={adminStyles.cardTitle}>Desktop presence settings</h2>
                <div className={styles.section}>
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
                    title='Idle timeout before "Are you there?" popup'
                    minutes={idleMinutes}
                    seconds={idleSeconds}
                    total={idleTotal}
                    disabled={disabled}
                    presets={[5, 10, 30, 60, 300, 1800]}
                    onMinutes={setIdleMinutes}
                    onSeconds={setIdleSeconds}
                    onPreset={setIdleTotal}
                  />

                  <DurationEditor
                    title="Popup countdown"
                    minutes={countdownMinutes}
                    seconds={countdownSeconds}
                    total={countdownTotal}
                    disabled={disabled}
                    maxMinutes={30}
                    presets={[5, 10, 30, 60]}
                    onMinutes={setCountdownMinutes}
                    onSeconds={setCountdownSeconds}
                    onPreset={setCountdownTotal}
                  />

                  <DurationEditor
                    title="Recheck while still idle (after a check finishes)"
                    minutes={recheckMinutes}
                    seconds={recheckSeconds}
                    total={recheckTotal}
                    disabled={disabled}
                    maxMinutes={120}
                    onMinutes={setRecheckMinutes}
                    onSeconds={setRecheckSeconds}
                  />

                  <div className={styles.block}>
                    <h3 className={styles.blockTitle}>Agent exit password (admin only)</h3>
                    <p className={styles.tip} style={{ marginBottom: 8 }}>
                      Employees cannot Exit the tray agent without this password.
                      Agents sync from the <strong>same host</strong> they point at (Staging
                      and Localhost passwords are separate). Click Save, then on the agent use
                      tray → <strong>Sync settings from HRM now</strong> or any admin action.
                      Default if unset: <code>InteractAdmin</code>.
                    </p>
                    <div className={styles.durationRow}>
                      <div className={styles.field} style={{ minWidth: 280 }}>
                        <label htmlFor="agent-exit-password">Exit password</label>
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

              <p className={styles.tip}>
                Tip: for quick testing use the <strong>5 sec</strong> / <strong>30 sec</strong> chips,
                Save, wait ~30s for the desktop agent, then leave the PC idle.
              </p>
            </div>
          )}
        </div>
      </div>
    </LayoutDashboard>
  );
}
