"use client";

import React, { useMemo, useState } from "react";
import styles from "./system-control-demo.module.css";
import hStyles from "./assign-hierarchy-demo.module.css";

export type RoleOption = { id: string; name: string };

export type DeptDemo = {
  id: string;
  name: string;
  managerId: string | null;
};

export type EmployeeOrgDemo = {
  id: string;
  name: string;
  departmentId: string;
  roleId: string;
};

const INITIAL_DEPARTMENTS: DeptDemo[] = [
  { id: "hr", name: "HR", managerId: "1042" },
  { id: "production", name: "Production", managerId: "1088" },
  { id: "sales", name: "Sales", managerId: "1302" },
  { id: "executive", name: "Executive", managerId: "1001" },
];

export const INITIAL_ORG_EMPLOYEES: EmployeeOrgDemo[] = [
  { id: "1001", name: "CEO Office", departmentId: "executive", roleId: "ceo" },
  { id: "1042", name: "Sara Ali", departmentId: "hr", roleId: "hr" },
  { id: "1045", name: "Ali Hassan", departmentId: "hr", roleId: "officer" },
  { id: "1088", name: "Ahmed Khan", departmentId: "production", roleId: "manager" },
  { id: "1201", name: "Usman Raza", departmentId: "production", roleId: "team_lead" },
  { id: "1205", name: "Fatima Noor", departmentId: "production", roleId: "officer" },
  { id: "1210", name: "Bilal Hussain", departmentId: "production", roleId: "officer" },
  { id: "1220", name: "Kamran Siddiqui", departmentId: "production", roleId: "officer" },
  { id: "1302", name: "Hina Shah", departmentId: "sales", roleId: "manager" },
  { id: "1315", name: "Omar Farooq", departmentId: "sales", roleId: "officer" },
  { id: "1320", name: "Ayesha Malik", departmentId: "sales", roleId: "officer" },
];

/** teamLeadId → member employee ids */
export const INITIAL_TEAM_MEMBERS: Record<string, string[]> = {
  "1201": ["1205", "1210", "1220"],
};

type AssignView = "hierarchy" | "departments" | "teams" | "employees";

type Props = {
  roles: RoleOption[];
  onToast: (msg: string) => void;
};

function roleName(roles: RoleOption[], id: string) {
  return roles.find((r) => r.id === id)?.name || id;
}

export default function AssignHierarchyPanel({ roles, onToast }: Props) {
  const [view, setView] = useState<AssignView>("hierarchy");
  const [departments, setDepartments] = useState<DeptDemo[]>(INITIAL_DEPARTMENTS);
  const [employees, setEmployees] = useState<EmployeeOrgDemo[]>(INITIAL_ORG_EMPLOYEES);
  const [teamMembers, setTeamMembers] = useState<Record<string, string[]>>(INITIAL_TEAM_MEMBERS);

  const [deptSetupId, setDeptSetupId] = useState("production");
  const [deptManagerPick, setDeptManagerPick] = useState("1088");
  const [bulkDeptRole, setBulkDeptRole] = useState("officer");

  const [teamLeadPick, setTeamLeadPick] = useState("1201");
  const [teamDeptId, setTeamDeptId] = useState("production");
  const [teamPickDraft, setTeamPickDraft] = useState<Set<string>>(
    () => new Set(INITIAL_TEAM_MEMBERS["1201"] || []),
  );

  const [empDeptFilter, setEmpDeptFilter] = useState("all");

  const empById = useMemo(() => {
    const m = new Map<string, EmployeeOrgDemo>();
    employees.forEach((e) => m.set(e.id, e));
    return m;
  }, [employees]);

  const deptById = useMemo(() => {
    const m = new Map<string, DeptDemo>();
    departments.forEach((d) => m.set(d.id, d));
    return m;
  }, [departments]);

  const teamLeadsInDept = (deptId: string) =>
    employees.filter((e) => e.departmentId === deptId && e.roleId === "team_lead");

  const officersInDept = (deptId: string) =>
    employees.filter(
      (e) =>
        e.departmentId === deptId &&
        (e.roleId === "officer" || e.roleId === "team_lead"),
    );

  const membersOfLead = (leadId: string) => teamMembers[leadId] || [];

  const unassignedOfficers = (deptId: string) => {
    const assigned = new Set<string>();
    Object.values(teamMembers).flat().forEach((id) => assigned.add(id));
    return employees.filter(
      (e) =>
        e.departmentId === deptId &&
        e.roleId === "officer" &&
        !assigned.has(e.id),
    );
  };

  function saveDepartmentManager() {
    const dept = deptById.get(deptSetupId);
    if (!dept) return;
    setDepartments((prev) =>
      prev.map((d) => (d.id === deptSetupId ? { ...d, managerId: deptManagerPick } : d)),
    );
    setEmployees((prev) =>
      prev.map((e) => {
        if (e.id === deptManagerPick) {
          return { ...e, departmentId: deptSetupId, roleId: "manager" };
        }
        return e;
      }),
    );
    const mgr = empById.get(deptManagerPick);
    onToast(
      `${mgr?.name || deptManagerPick} is now Manager of ${dept.name} — sees full department data`,
    );
  }

  function assignWholeDepartmentRole() {
    const dept = deptById.get(deptSetupId);
    if (!dept) return;
    const mgrId = dept.managerId;
    setEmployees((prev) =>
      prev.map((e) => {
        if (e.departmentId !== deptSetupId) return e;
        if (e.id === mgrId) return { ...e, roleId: "manager" };
        if (e.roleId === "manager" || e.roleId === "team_lead") return e;
        return { ...e, roleId: bulkDeptRole };
      }),
    );
    onToast(
      `All non-manager staff in ${dept.name} set to role "${roleName(roles, bulkDeptRole)}"`,
    );
  }

  function onTeamLeadChange(leadId: string) {
    setTeamLeadPick(leadId);
    const lead = empById.get(leadId);
    if (lead) setTeamDeptId(lead.departmentId);
    setTeamPickDraft(new Set(teamMembers[leadId] || []));
  }

  function saveTeamMembers() {
    const lead = empById.get(teamLeadPick);
    if (!lead) return;
    setTeamMembers((prev) => ({
      ...prev,
      [teamLeadPick]: Array.from(teamPickDraft),
    }));
    setEmployees((prev) =>
      prev.map((e) => {
        if (teamPickDraft.has(e.id)) {
          return { ...e, departmentId: lead.departmentId, roleId: "officer" };
        }
        return e;
      }),
    );
    onToast(
      `Team saved: ${lead.name} now has ${teamPickDraft.size} members (view-only team attendance)`,
    );
  }

  function updateEmployee(
    empId: string,
    patch: Partial<Pick<EmployeeOrgDemo, "roleId" | "departmentId">>,
  ) {
    setEmployees((prev) =>
      prev.map((e) => (e.id === empId ? { ...e, ...patch } : e)),
    );
  }

  function saveEmployeeRow(emp: EmployeeOrgDemo) {
    if (emp.roleId === "manager") {
      setDepartments((prev) =>
        prev.map((d) =>
          d.id === emp.departmentId ? { ...d, managerId: emp.id } : d,
        ),
      );
    }
    if (emp.roleId === "team_lead" && !teamMembers[emp.id]) {
      setTeamMembers((prev) => ({ ...prev, [emp.id]: [] }));
    }
    onToast(
      `${emp.name} → ${roleName(roles, emp.roleId)} @ ${deptById.get(emp.departmentId)?.name}`,
    );
  }

  const filteredEmpRows = useMemo(() => {
    if (empDeptFilter === "all") return employees;
    return employees.filter((e) => e.departmentId === empDeptFilter);
  }, [employees, empDeptFilter]);

  const treeText = useMemo(() => {
    const lines: string[] = ["COMPANY", ""];
    for (const dept of departments) {
      lines.push(`▸ ${dept.name.toUpperCase()} DEPARTMENT`);
      const mgr = dept.managerId ? empById.get(dept.managerId) : null;
      lines.push(
        mgr
          ? `  ├── [MANAGER] ${mgr.name} (${mgr.id}) → controls ALL ${dept.name} records`
          : `  ├── [MANAGER] — not assigned —`,
      );
      const leads = teamLeadsInDept(dept.id);
      if (leads.length === 0) {
        const direct = employees.filter(
          (e) =>
            e.departmentId === dept.id &&
            e.roleId === "officer" &&
            !Object.values(teamMembers).flat().includes(e.id),
        );
        for (const off of direct) {
          lines.push(`  └── [OFFICER] ${off.name} → reports to Manager`);
        }
      } else {
        leads.forEach((tl, ti) => {
          const isLastTl = ti === leads.length - 1;
          const prefix = isLastTl ? "  └──" : "  ├──";
          lines.push(`${prefix} [TEAM LEAD] ${tl.name} → view-only team attendance`);
          const members = membersOfLead(tl.id);
          members.forEach((mid, mi) => {
            const m = empById.get(mid);
            const last = mi === members.length - 1;
            const branch = isLastTl ? "      " : "  │   ";
            lines.push(
              `${branch}${last ? "└──" : "├──"} [OFFICER] ${m?.name || mid} → in ${tl.name}'s team`,
            );
          });
        });
        const unassigned = unassignedOfficers(dept.id);
        if (unassigned.length > 0) {
          lines.push(`  └── [UNASSIGNED] ${unassigned.map((u) => u.name).join(", ")}`);
        }
      }
      lines.push("");
    }
    return lines.join("\n");
  }, [departments, employees, teamMembers, empById]);

  const subTabs: { id: AssignView; label: string; hint: string }[] = [
    {
      id: "hierarchy",
      label: "Hierarchy view",
      hint: "Company-wide org chart: Department → Manager → Team Lead → Officers",
    },
    {
      id: "departments",
      label: "Department & Manager",
      hint: "Assign a department head (Manager) and manage department-wide role defaults",
    },
    {
      id: "teams",
      label: "Team Lead & members",
      hint: "Select a Team Lead, then assign officers to their team",
    },
    {
      id: "employees",
      label: "All employees",
      hint: "View and edit role, department, and reporting relationships in one table",
    },
  ];

  return (
    <div className={hStyles.assignWrap}>
      <div className={hStyles.explainCard}>
        <strong>Assign Users — purpose</strong>
        <br />
        This section defines the <strong>organizational hierarchy</strong>, not just system roles.
        Use it to establish who reports to whom and what data each person can see:
        <br />
        ① <strong>Department → Manager</strong> — assigns a department head; that manager receives
        full visibility and control over all records within the department.
        <br />
        ② <strong>Team Lead → Team members</strong> — groups officers under a Team Lead; the lead
        can view team attendance and related summaries only (read-only, no edits).
        <br />
        ③ <strong>Officer → Department + Team Lead</strong> — places staff in a department and,
        where applicable, under a Team Lead within the manager reporting chain.
        <br />
        The <strong>Permissions</strong> tab controls feature access (menus and actions). This tab
        controls <strong>organizational placement</strong> — department membership, management
        structure, and team assignment.
      </div>

      <div className={hStyles.subTabBar}>
        {subTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`${hStyles.subTab} ${view === t.id ? hStyles.subTabActive : ""}`}
            onClick={() => setView(t.id)}
            title={t.hint}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p style={{ fontSize: "0.85rem", color: "#718096", margin: "0 0 16px" }}>
        {subTabs.find((t) => t.id === view)?.hint}
      </p>

      {/* HIERARCHY VIEW */}
      {view === "hierarchy" && (
        <>
          <div className={hStyles.deptGrid}>
            {departments.map((dept) => {
              const mgr = dept.managerId ? empById.get(dept.managerId) : null;
              const leads = teamLeadsInDept(dept.id);
              return (
                <div key={dept.id} className={hStyles.deptCard}>
                  <div className={hStyles.deptCardHead}>
                    <h3>{dept.name}</h3>
                    <p>Department · {employees.filter((e) => e.departmentId === dept.id).length} staff</p>
                  </div>
                  <div className={hStyles.deptCardBody}>
                    <div className={hStyles.managerRow}>
                      <span className={hStyles.managerBadge}>Manager</span>
                      <span>
                        {mgr ? (
                          <>
                            <strong>{mgr.name}</strong>
                            <span className={hStyles.tagMgr}>sees all {dept.name}</span>
                          </>
                        ) : (
                          "Not assigned — go to Department tab"
                        )}
                      </span>
                    </div>

                    {leads.length === 0 ? (
                      <div className={hStyles.unassignedBox}>
                        No Team Lead — officers report directly to Manager
                      </div>
                    ) : (
                      leads.map((tl) => (
                        <div key={tl.id} className={hStyles.teamBlock}>
                          <div className={hStyles.teamLeadRow}>
                            <span className={hStyles.tlBadge}>Team Lead</span>
                            <strong>{tl.name}</strong>
                            <span className={hStyles.tagTl}>view team only</span>
                          </div>
                          <ul className={hStyles.memberList}>
                            {membersOfLead(tl.id).map((mid) => {
                              const m = empById.get(mid);
                              return (
                                <li key={mid}>
                                  <span className={hStyles.memberDot} />
                                  {m?.name || mid}
                                  <span className={hStyles.officerBadge}>Officer</span>
                                </li>
                              );
                            })}
                            {membersOfLead(tl.id).length === 0 && (
                              <li style={{ color: "#a0aec0" }}>No members — assign in Teams tab</li>
                            )}
                          </ul>
                        </div>
                      ))
                    )}

                    {unassignedOfficers(dept.id).length > 0 && (
                      <div className={hStyles.unassignedBox}>
                        <strong>Not in any team:</strong>{" "}
                        {unassignedOfficers(dept.id)
                          .map((u) => u.name)
                          .join(", ")}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className={hStyles.panelSection} style={{ marginTop: 20 }}>
            <h3 className={hStyles.panelSectionTitle}>Live hierarchy tree (after save)</h3>
            <pre className={hStyles.hierarchyTree}>{treeText}</pre>
          </div>
        </>
      )}

      {/* DEPARTMENT & MANAGER */}
      {view === "departments" && (
        <div className={hStyles.panelSection}>
          <h3 className={hStyles.panelSectionTitle}>Assign Manager to Department</h3>
          <p style={{ fontSize: "0.88rem", color: "#718096", marginTop: 0 }}>
            Select an employee as department Manager. They become Head of Department (HOD) and gain
            department-scoped access to monthly attendance, leave approval (first step), and related
            reports.
          </p>

          <div className={hStyles.formRow}>
            <div className={hStyles.formField}>
              <label>Department</label>
              <select
                value={deptSetupId}
                onChange={(e) => {
                  setDeptSetupId(e.target.value);
                  const d = departments.find((x) => x.id === e.target.value);
                  if (d?.managerId) setDeptManagerPick(d.managerId);
                }}
              >
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className={hStyles.formField}>
              <label>Assign as Manager (HOD)</label>
              <select
                value={deptManagerPick}
                onChange={(e) => setDeptManagerPick(e.target.value)}
              >
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} — {deptById.get(e.departmentId)?.name} ({roleName(roles, e.roleId)})
                  </option>
                ))}
              </select>
            </div>
            <button type="button" className={styles.btnPrimary} onClick={saveDepartmentManager}>
              Save department manager
            </button>
          </div>

          <hr style={{ border: "none", borderTop: "1px solid #e2e8f0", margin: "20px 0" }} />

          <h3 className={hStyles.panelSectionTitle}>Bulk: set role for whole department</h3>
          <p style={{ fontSize: "0.88rem", color: "#718096", marginTop: 0 }}>
            Apply a single role to all staff in a department (excluding the Manager and any Team
            Leads). Useful for onboarding batches, e.g. setting new hires to Officer.
          </p>
          <div className={hStyles.formRow}>
            <div className={hStyles.formField}>
              <label>Department</label>
              <select value={deptSetupId} onChange={(e) => setDeptSetupId(e.target.value)}>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className={hStyles.formField}>
              <label>Role for all staff (except Manager)</label>
              <select value={bulkDeptRole} onChange={(e) => setBulkDeptRole(e.target.value)}>
                {roles
                  .filter((r) => !["super_admin", "ceo"].includes(r.id))
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
            </div>
            <button type="button" className={styles.btnSecondary} onClick={assignWholeDepartmentRole}>
              Apply to department
            </button>
          </div>

          <div className={hStyles.scopeNote}>
            <strong>Manager scope:</strong> Ahmed Khan (Production) → attendance summary, monthly
            attendance, leave list — sab <em>Production</em> filter par. Sales data nahi dikhega.
          </div>
        </div>
      )}

      {/* TEAM LEAD & MEMBERS */}
      {view === "teams" && (
        <div className={hStyles.panelSection}>
          <h3 className={hStyles.panelSectionTitle}>Team Lead → select team members</h3>
          <p style={{ fontSize: "0.88rem", color: "#718096", marginTop: 0 }}>
            Select a <strong>Team Lead</strong>, then choose the officers in the same department
            who belong to their team. Leads with team leave permission can view team leave
            applications; 1st-step / 2nd-step approve is granted separately in Permissions.
          </p>

          <div className={hStyles.formRow}>
            <div className={hStyles.formField}>
              <label>Team Lead</label>
              <select value={teamLeadPick} onChange={(e) => onTeamLeadChange(e.target.value)}>
                {employees
                  .filter((e) => e.roleId === "team_lead")
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} — {deptById.get(e.departmentId)?.name}
                    </option>
                  ))}
                {employees.filter((e) => e.roleId === "team_lead").length === 0 && (
                  <option value="">No team leads — set role in Employees tab</option>
                )}
              </select>
            </div>
            <div className={hStyles.formField}>
              <label>Department (auto)</label>
              <select value={teamDeptId} disabled>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className={hStyles.formField}>
              <label>Make employee Team Lead</label>
              <select
                defaultValue=""
                onChange={(e) => {
                  const id = e.target.value;
                  if (!id) return;
                  updateEmployee(id, { roleId: "team_lead", departmentId: teamDeptId });
                  onTeamLeadChange(id);
                  onToast(`${empById.get(id)?.name} promoted to Team Lead`);
                  e.target.value = "";
                }}
              >
                <option value="">Promote officer to Team Lead…</option>
                {officersInDept(teamDeptId)
                  .filter((e) => e.roleId === "officer")
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <p style={{ fontWeight: 600, fontSize: "0.9rem", marginBottom: 8 }}>
            Team members for {empById.get(teamLeadPick)?.name}:
          </p>
          <div className={hStyles.memberPickGrid}>
            {officersInDept(teamDeptId)
              .filter((e) => e.id !== teamLeadPick && e.roleId === "officer")
              .map((e) => {
                const checked = teamPickDraft.has(e.id);
                return (
                  <label
                    key={e.id}
                    className={`${hStyles.memberPick} ${checked ? hStyles.memberPickChecked : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = new Set(teamPickDraft);
                        if (next.has(e.id)) next.delete(e.id);
                        else next.add(e.id);
                        setTeamPickDraft(next);
                      }}
                    />
                    <span>
                      {e.name}
                      <span className={hStyles.officerBadge}>Officer</span>
                    </span>
                  </label>
                );
              })}
            {employees
              .filter((e) => e.departmentId === teamDeptId && e.roleId === "manager")
              .map((e) => (
                <div
                  key={e.id}
                  className={`${hStyles.memberPick} ${hStyles.memberPickDisabled}`}
                >
                  <input type="checkbox" disabled />
                  <span>
                    {e.name}
                    <span className={hStyles.tagMgr}>Manager — not in team</span>
                  </span>
                </div>
              ))}
          </div>

          <div className={styles.btnRow} style={{ marginTop: 16 }}>
            <button type="button" className={styles.btnPrimary} onClick={saveTeamMembers}>
              Save team members
            </button>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={() => setTeamPickDraft(new Set())}
            >
              Clear selection
            </button>
          </div>

          <div className={hStyles.resultPreview}>
            <h4>After save — Team Lead experience</h4>
            When Usman Raza signs in, the <strong>My Team</strong> tab displays read-only attendance
            for Fatima, Bilal, and Kamran. Department Manager Ahmed Khan retains full Production
            department visibility.
          </div>
        </div>
      )}

      {/* ALL EMPLOYEES TABLE */}
      {view === "employees" && (
        <>
          <div className={hStyles.formRow}>
            <div className={hStyles.formField} style={{ maxWidth: 220 }}>
              <label>Filter department</label>
              <select value={empDeptFilter} onChange={(e) => setEmpDeptFilter(e.target.value)}>
                <option value="all">All departments</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Department</th>
                  <th>System role</th>
                  <th>Reports to (Manager)</th>
                  <th>Team Lead</th>
                  <th>Save</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmpRows.map((emp) => {
                  const dept = deptById.get(emp.departmentId);
                  const mgrId = dept?.managerId;
                  const mgr = mgrId ? empById.get(mgrId) : null;
                  const leadEntry = Object.entries(teamMembers).find(([, ids]) =>
                    ids.includes(emp.id),
                  );
                  const lead = leadEntry ? empById.get(leadEntry[0]) : null;

                  return (
                    <tr key={emp.id}>
                      <td>{emp.id}</td>
                      <td>
                        <strong>{emp.name}</strong>
                        {emp.roleId === "manager" && (
                          <span className={hStyles.tagMgr}>Manager</span>
                        )}
                        {emp.roleId === "team_lead" && (
                          <span className={hStyles.tagTl}>TL</span>
                        )}
                      </td>
                      <td>
                        <select
                          value={emp.departmentId}
                          onChange={(e) =>
                            updateEmployee(emp.id, { departmentId: e.target.value })
                          }
                        >
                          {departments.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          value={emp.roleId}
                          onChange={(e) => updateEmployee(emp.id, { roleId: e.target.value })}
                        >
                          {roles.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {emp.roleId === "manager" ? (
                          <span className={hStyles.tagDept}>Head of {dept?.name}</span>
                        ) : mgr ? (
                          mgr.name
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {emp.roleId === "team_lead" ? (
                          <span>{membersOfLead(emp.id).length} members</span>
                        ) : lead ? (
                          lead.name
                        ) : emp.roleId === "officer" ? (
                          <span style={{ color: "#a0aec0" }}>Direct → Manager</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className={styles.btnSecondary}
                          style={{ padding: "6px 12px", fontSize: "0.8rem" }}
                          onClick={() => saveEmployeeRow(emp)}
                        >
                          Save
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className={styles.previewBox}>
            <strong>Three distinct configuration layers:</strong>
            <br />
            1) <strong>Role</strong> (Permissions tab) — feature access, menus, and actions
            <br />
            2) <strong>Department</strong> (this tab) — data scope for Managers
            <br />
            3) <strong>Team membership</strong> (Teams tab) — read-only visibility for Team Leads
          </div>
        </>
      )}
    </div>
  );
}
