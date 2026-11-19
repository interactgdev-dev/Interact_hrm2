"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ModalPortal } from "@/app/components/ModalPortal";
import styles from "./system-control-demo.module.css";
import type { DemoEmployee, RoleDef } from "./system-control-data";
import { isSystemRole, scopeLabelFromScope } from "./system-control-data";

type Step = "details" | "assign";

type Props = {
  open: boolean;
  onClose: () => void;
  allRoles: RoleDef[];
  employees: DemoEmployee[];
  name: string;
  onNameChange: (v: string) => void;
  cloneFrom: string;
  onCloneFromChange: (id: string) => void;
  portal: string;
  onPortalChange: (v: string) => void;
  scope: string;
  onScopeChange: (v: string) => void;
  selectedEmployeeIds: string[];
  onToggleEmployee: (employeeId: string) => void;
  onCreate: () => void;
  creating?: boolean;
};

export default function NewRoleModal({
  open,
  onClose,
  allRoles,
  employees,
  name,
  onNameChange,
  cloneFrom,
  onCloneFromChange,
  portal,
  onPortalChange,
  scope,
  onScopeChange,
  selectedEmployeeIds,
  onToggleEmployee,
  onCreate,
  creating = false,
}: Props) {
  const [step, setStep] = useState<Step>("details");
  const [empQuery, setEmpQuery] = useState("");

  useEffect(() => {
    if (open) {
      setStep("details");
      setEmpQuery("");
    }
  }, [open]);

  const cloneName = allRoles.find((r) => r.id === cloneFrom)?.name || cloneFrom;

  const filteredEmployees = useMemo(() => {
    const q = empQuery.trim().toLowerCase();
    const list = [...employees].sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return list;
    return list.filter((e) => {
      const hay = `${e.name} ${e.pseudonym || ""} ${e.id}`.toLowerCase();
      return hay.includes(q);
    });
  }, [employees, empQuery]);

  if (!open) return null;

  function goNext() {
    if (!name.trim()) return;
    setStep("assign");
  }

  return (
    <ModalPortal>
      <div
        className={styles.modalOverlay}
        data-hrm-modal-overlay
        role="presentation"
        onClick={onClose}
      >
        <div
          className={styles.modalCard}
          role="dialog"
          aria-labelledby="new-role-title"
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: 560 }}
        >
          <h2 id="new-role-title" className={styles.modalTitle}>
            Create new role
          </h2>
          <p className={styles.modalSub}>
            Name the role, assign people, then set permissions on the Permissions
            matrix so they get the matching dashboard.
          </p>

          <div className={styles.newRoleSteps} role="tablist" aria-label="Create role steps">
            <button
              type="button"
              role="tab"
              aria-selected={step === "details"}
              className={`${styles.newRoleStepBtn} ${
                step === "details" ? styles.newRoleStepBtnActive : ""
              }`}
              onClick={() => setStep("details")}
            >
              1. Role name
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={step === "assign"}
              className={`${styles.newRoleStepBtn} ${
                step === "assign" ? styles.newRoleStepBtnActive : ""
              }`}
              onClick={() => {
                if (name.trim()) setStep("assign");
              }}
              disabled={!name.trim()}
            >
              2. Assign employees
            </button>
          </div>

          {step === "details" ? (
            <div className={styles.fieldGrid}>
              <div className={styles.field} style={{ gridColumn: "1 / -1" }}>
                <label>Role display name</label>
                <input
                  value={name}
                  onChange={(e) => onNameChange(e.target.value)}
                  placeholder="e.g. Night Shift Manager"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      goNext();
                    }
                  }}
                />
              </div>
              <div className={styles.field} style={{ gridColumn: "1 / -1" }}>
                <label>Clone permissions from</label>
                <select
                  value={cloneFrom}
                  onChange={(e) => onCloneFromChange(e.target.value)}
                >
                  {allRoles
                    .filter((r) => !isSystemRole(r.id))
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className={styles.field}>
                <label>Portal / dashboard</label>
                <select
                  value={portal}
                  onChange={(e) => onPortalChange(e.target.value)}
                >
                  <option value="admin-dashboard">Admin dashboard</option>
                  <option value="leader-dashboard">Team Lead dashboard</option>
                  <option value="employee-dashboard">Employee dashboard</option>
                </select>
              </div>
              <div className={styles.field}>
                <label>Data scope</label>
                <select
                  value={scope}
                  onChange={(e) => onScopeChange(e.target.value)}
                >
                  <option value="ALL">ALL company</option>
                  <option value="DEPARTMENT">DEPARTMENT</option>
                  <option value="TEAM">TEAM</option>
                  <option value="SELF">SELF</option>
                </select>
              </div>
            </div>
          ) : (
            <div>
              <div className={styles.field} style={{ marginBottom: 10 }}>
                <label htmlFor="new-role-emp-search">Assign employees (optional)</label>
                <input
                  id="new-role-emp-search"
                  value={empQuery}
                  onChange={(e) => setEmpQuery(e.target.value)}
                  placeholder="Search by name or P.Name…"
                  autoFocus
                />
              </div>
              <div className={styles.newRoleEmpList}>
                {filteredEmployees.length === 0 ? (
                  <div className={styles.permSelectEmpty}>No employees found</div>
                ) : (
                  filteredEmployees.map((emp) => {
                    const checked = selectedEmployeeIds.includes(emp.id);
                    return (
                      <label key={emp.id} className={styles.newRoleEmpRow}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleEmployee(emp.id)}
                        />
                        <span>
                          {emp.name}
                          {emp.pseudonym ? ` (${emp.pseudonym})` : ""}
                        </span>
                        <span className={styles.newRoleEmpMeta}>
                          {emp.departmentName || emp.id}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
              <div className={styles.newRolePermPreview}>
                <strong>{selectedEmployeeIds.length}</strong> employee(s) selected.
                Permissions start from <strong>{cloneName}</strong> (
                {scopeLabelFromScope(scope)}). After create, use the matrix{" "}
                <em>below</em> on this Permissions tab to fine-tune — then Save role
                so their dashboard matches.
              </div>
            </div>
          )}

          {step === "details" ? (
            <div className={styles.previewChipBox}>
              <span className={styles.previewChip}>Portal: {portal}</span>
              <span className={styles.previewChip}>
                Scope: {scopeLabelFromScope(scope)}
              </span>
            </div>
          ) : null}

          <div className={styles.modalActions}>
            <button
              type="button"
              className={styles.btnGhost}
              onClick={onClose}
              disabled={creating}
            >
              Cancel
            </button>
            {step === "details" ? (
              <button
                type="button"
                className={styles.btnSolidPurple}
                onClick={goNext}
                disabled={!name.trim()}
              >
                Next: Assign employees
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={styles.btnGhost}
                  onClick={() => setStep("details")}
                  disabled={creating}
                >
                  Back
                </button>
                <button
                  type="button"
                  className={styles.btnSolidPurple}
                  onClick={onCreate}
                  disabled={creating || !name.trim()}
                >
                  {creating ? "Creating…" : "Create role"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
