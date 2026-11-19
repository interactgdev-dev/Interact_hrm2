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

function roleBadgeClass(role: string) {
  if (role === "Leader" || role === "HOD" || role === "Management") {
    return styles.memberRoleLead;
  }
  if (role === "Officer") return styles.memberRoleOfficer;
  return "";
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

  const team = React.useMemo(() => {
    const raw = hierarchy?.teamMembers ?? [];
    const byId = new Map<string, HierarchyPerson>();
    for (const member of raw) {
      const id = String(member.id || "").trim();
      if (!id || byId.has(id)) continue;
      byId.set(id, member);
    }
    return [...byId.values()];
  }, [hierarchy?.teamMembers]);

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <div>
            <BackToDashboard />
            <p className={styles.eyebrow}>Department</p>
            <h1 className={styles.title}>My Team</h1>
            <p className={styles.sub}>
              {hierarchy?.departmentName
                ? `Everyone in ${hierarchy.departmentName} — with profile photos`
                : "Your department colleagues"}
            </p>
          </div>
          <span className={styles.count}>{team.length} people</span>
        </header>

        {loading ? (
          <div className={styles.empty}>Loading your team…</div>
        ) : team.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>No teammates found</p>
            <p>Colleagues in your department will appear here with their profile photos.</p>
          </div>
        ) : (
          <div className={styles.grid}>
            {team.map((member) => (
              <PersonCard key={member.id} person={member} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
