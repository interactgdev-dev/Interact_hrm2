"use client";

import React from "react";
import { EmployeeAvatar } from "../../components/EmployeeAvatar";
import {
  fetchEmployeeHierarchy,
  peekEmployeeHierarchyCache,
  type EmployeeHierarchy,
  type HierarchyPerson,
} from "../../employee-hierarchy-api";
import { BackToDashboard } from "../components/BackToDashboard";
import styles from "./my-team.module.css";

/** Friendly chip labels (DM = Data Mining). */
function chipDisplayLabel(chip: string): string {
  if (chip === "DM") return "Data Mining";
  return chip;
}

function roleBadgeClass(role: string) {
  if (role === "Leader" || role === "HOD" || role === "Management") {
    return styles.memberRoleLead;
  }
  if (role === "Officer") return styles.memberRoleOfficer;
  return "";
}

function isInactiveStatus(status: string | null | undefined): boolean {
  const s = String(status || "").trim().toLowerCase();
  return (
    s === "inactive" ||
    s === "disabled" ||
    s === "terminated" ||
    s === "left"
  );
}

function PersonCard({ person }: { person: HierarchyPerson }) {
  return (
    <article className={styles.memberCard}>
      <div className={styles.avatarWrap}>
        <EmployeeAvatar
          name={person.name}
          initials={person.initials}
          photo={person.photo}
          size="lg"
          ring={person.photo ? "green" : "none"}
          className={styles.memberAvatar}
        />
      </div>
      <div className={styles.memberName}>{person.name}</div>
      <span className={`${styles.memberRole} ${roleBadgeClass(person.role)}`}>
        {person.role}
      </span>
      {person.jobTitle ? (
        <div className={styles.memberJob}>{person.jobTitle}</div>
      ) : person.pseudonym ? (
        <div className={styles.memberJob}>{person.pseudonym}</div>
      ) : null}
      {person.departmentName ? (
        <div className={styles.memberDept}>{person.departmentName}</div>
      ) : null}
    </article>
  );
}

export default function MyTeamPage() {
  const [employeeId, setEmployeeId] = React.useState("");
  const [hierarchy, setHierarchy] = React.useState<EmployeeHierarchy | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [selectedDept, setSelectedDept] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const id =
      localStorage.getItem("employeeId") || localStorage.getItem("loginId") || "";
    setEmployeeId(id);
  }, []);

  React.useEffect(() => {
    if (!employeeId) return;
    const cached = peekEmployeeHierarchyCache(employeeId);
    if (cached !== undefined) {
      setHierarchy(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    void fetchEmployeeHierarchy(employeeId)
      .then(setHierarchy)
      .finally(() => setLoading(false));
  }, [employeeId]);

  const ownedDepartments = hierarchy?.ownedDepartments ?? [];
  const ownedKey = ownedDepartments.join("|");
  const isCeoView = Boolean(hierarchy?.isDeptHeadCeo && ownedDepartments.length > 0);

  // Reset / default selected dept when CEO hierarchy loads
  React.useEffect(() => {
    if (!isCeoView) {
      setSelectedDept(null);
      return;
    }
    const depts = ownedKey ? ownedKey.split("|") : [];
    setSelectedDept((prev) =>
      prev && depts.includes(prev) ? prev : depts[0] ?? null,
    );
  }, [isCeoView, ownedKey]);

  const team = React.useMemo(() => {
    const raw = hierarchy?.teamMembers ?? [];
    const byId = new Map<string, HierarchyPerson>();
    for (const member of raw) {
      const id = String(member.id || "").trim();
      if (!id || byId.has(id)) continue;
      if (isInactiveStatus(member.status)) continue;
      byId.set(id, member);
    }
    return [...byId.values()];
  }, [hierarchy?.teamMembers]);

  const visibleTeam = React.useMemo(() => {
    if (!isCeoView || !selectedDept) return team;
    const want = selectedDept.toLowerCase();
    return team.filter((m) => {
      const chip = String(m.orgChip || "").trim().toLowerCase();
      return chip === want;
    });
  }, [isCeoView, selectedDept, team]);

  const selectedLabel = selectedDept ? chipDisplayLabel(selectedDept) : null;

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <div>
            <BackToDashboard />
            <p className={styles.eyebrow}>
              {isCeoView ? "Your departments" : "Department"}
            </p>
            <h1 className={styles.title}>My Team</h1>
            <p className={styles.sub}>
              {isCeoView
                ? selectedLabel
                  ? `Active employees in ${selectedLabel}`
                  : "Select a department to view active employees"
                : hierarchy?.departmentName
                  ? `Everyone in ${hierarchy.departmentName} — with profile photos`
                  : "Your department colleagues"}
            </p>
          </div>
          <span className={styles.count}>
            {isCeoView && !selectedDept
              ? `${ownedDepartments.length} departments`
              : `${visibleTeam.length} people`}
          </span>
        </header>

        {isCeoView ? (
          <div className={styles.deptChips} role="tablist" aria-label="Departments">
            {ownedDepartments.map((chip) => {
              const active = selectedDept === chip;
              const count = team.filter(
                (m) =>
                  String(m.orgChip || "").trim().toLowerCase() ===
                  chip.toLowerCase(),
              ).length;
              return (
                <button
                  key={chip}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`${styles.deptChip} ${active ? styles.deptChipActive : ""}`}
                  onClick={() => setSelectedDept(chip)}
                >
                  <span className={styles.deptChipLabel}>{chipDisplayLabel(chip)}</span>
                  <span className={styles.deptChipCount}>{count}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {loading ? (
          <div className={styles.empty}>Loading your team…</div>
        ) : isCeoView && !selectedDept ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>Select a department</p>
            <p>Click a department above to see its active employees.</p>
          </div>
        ) : visibleTeam.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>No teammates found</p>
            <p>
              {isCeoView
                ? `No active employees in ${selectedLabel || "this department"}.`
                : "Colleagues in your department will appear here with their profile photos."}
            </p>
          </div>
        ) : (
          <div className={styles.grid}>
            {visibleTeam.map((member) => (
              <PersonCard key={member.id} person={member} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
