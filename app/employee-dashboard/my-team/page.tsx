"use client";

import React from "react";
import { EmployeeAvatar } from "../../components/EmployeeAvatar";
import {
  fetchEmployeeHierarchy,
  peekEmployeeHierarchyCache,
  type EmployeeHierarchy,
  type HierarchyPerson,
} from "../../employee-hierarchy-api";
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
    <div className={styles.memberCard}>
      <EmployeeAvatar
        name={person.name}
        initials={person.initials}
        photo={person.photo}
        size="md"
        className={styles.memberAvatar}
      />
      <div className={styles.memberName}>{person.name}</div>
      <span className={`${styles.memberRole} ${roleBadgeClass(person.role)}`}>
        {person.role}
      </span>
      {person.jobTitle ? (
        <div className={styles.memberJob}>{person.jobTitle}</div>
      ) : person.pseudonym ? (
        <div className={styles.memberJob}>{person.pseudonym}</div>
      ) : null}
    </div>
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

  const team = hierarchy?.teamMembers ?? [];

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>My Team</h1>
            <p className={styles.sub}>
              {hierarchy?.departmentName || "Direct reports"}
            </p>
          </div>
          <span className={styles.count}>{team.length} members</span>
        </div>

        {loading ? (
          <div className={styles.empty}>Loading team…</div>
        ) : team.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>No team members yet</p>
            <p>
              When you are assigned as a team lead or manager, your team will
              appear here with photos and roles.
            </p>
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
