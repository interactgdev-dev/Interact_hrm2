"use client";

import React, { useMemo, useState } from "react";
import { ModalPortal } from "@/app/components/ModalPortal";
import styles from "./system-control-demo.module.css";
import {
  childRoles,
  deptNameById,
  deptRootForRole,
  deptSectionLabel,
  empNameById,
  employeesInOrgDept,
  findOrgDeptManager,
  listOrgDeptChips,
  ORG_DEPT_MANAGER_NAME,
  resolveOrgCeoCards,
  type DemoEmployee,
  type RoleDef,
} from "./system-control-data";
import { ORG_ROLE_OPTIONS, normalizeOrgRole, orgRoleLabel } from "@/lib/org-role";
import { effectiveAccessSlugs } from "@/lib/access-control/effective-slugs";

type Props = {
  allRoles: RoleDef[];
  customRoles: RoleDef[];
  employees: DemoEmployee[];
  employeeCountByRole: (roleId: string) => number;
  permCountByRole: (roleId: string) => number;
  totalPermCount: number;
  onReparent: (childId: string, newParentId: string | null) => void;
  onInsertAbove: (draggedId: string, targetId: string) => void;
  onMakeSibling: (draggedId: string, targetId: string) => void;
  onResetChart: () => void;
  onAddChild: (parentId: string) => void;
  /** Create a new role that becomes the manager of this role. */
  onAddAbove: (roleId: string) => void;
  onRename: (roleId: string, name: string) => void;
  onDelete: (roleId: string) => void;
  /** Delete the HR employee (and unassign System Control roles). */
  onDeleteEmployee: (employeeId: string) => void;
  /** Change Add Employee org role → default dept-scoped permissions. */
  onChangeEmployeeOrgRole: (employeeId: string, orgRole: string) => void;
  onManage: (roleId: string) => void;
  onUpdateLevel: (roleId: string, level: number) => void;
  onUpdateProfilePhoto: (employeeId: string, photo: string) => void;
  onRemoveProfilePhoto: (employeeId: string) => void;
  onUpdateRolePhoto: (roleId: string, photo: string) => void;
  onRemoveRolePhoto: (roleId: string) => void;
  rolePhotos: Record<string, string>;
  isRoleLocked: (roleId: string) => boolean;
  isCustomRole: (roleId: string) => boolean;
  readOnly?: boolean;
};

function accentOf(role: RoleDef | undefined) {
  return role?.accent || "#9333ea";
}

function tierFooterClass(tier: RoleDef["tier"] | undefined, styles: Record<string, string>) {
  const map: Record<string, string> = {
    board: styles.orgCardFooterBoard,
    partner: styles.orgCardFooterPartner,
    director: styles.orgCardFooterDirector,
    manager: styles.orgCardFooterManager,
    lead: styles.orgCardFooterLead,
    staff: styles.orgCardFooterStaff,
    support: styles.orgCardFooterSupport,
    junior: styles.orgCardFooterJunior,
  };
  return tier ? map[tier] || "" : "";
}

function deptFooterForRole(allRoles: RoleDef[], role: RoleDef) {
  const rootId = deptRootForRole(allRoles, role.id);
  if (rootId) {
    const root = allRoles.find((r) => r.id === rootId);
    if (root) {
      return { label: deptSectionLabel(root.name), color: accentOf(root) };
    }
  }
  if (role.tier === "board") return { label: "Executive Board", color: "#8b5cf6" };
  return { label: role.scopeLabel, color: accentOf(role) };
}

function parentRole(allRoles: RoleDef[], role: RoleDef) {
  if (!role.parentId) return null;
  return allRoles.find((r) => r.id === role.parentId) ?? null;
}

/** "Managing Partner — IT & Technology" → "IT & Technology" for dept box headers */
function deptBoxLabel(name: string): string {
  const dash = name.indexOf("—");
  if (dash >= 0) return name.slice(dash + 1).trim();
  return name;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* ── inline icons (kept tiny so cards stay compact) ─────────────── */
function IconEdit() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}
function IconTrashSmall() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}

function ProfilePhoto({
  photo,
  initialsNode,
  onRemove,
  wrapClass,
  imgClass,
}: {
  photo: string | null;
  initialsNode: React.ReactNode;
  onRemove?: () => void;
  wrapClass: string;
  imgClass: string;
}) {
  if (!photo) return <>{initialsNode}</>;
  return (
    <span className={wrapClass}>
      <img src={photo} alt="" className={imgClass} />
      {onRemove && (
        <button
          type="button"
          className={styles.orgPhotoRemove}
          title="Remove photo"
          aria-label="Remove profile photo"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <IconTrashSmall />
        </button>
      )}
    </span>
  );
}
function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}
function IconArrowUp() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </svg>
  );
}
function IconEye({ off }: { off: boolean }) {
  return off ? (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M6.61 6.61A18.5 18.5 0 0 0 2 12s3 8 10 8a9.12 9.12 0 0 0 5.39-1.61" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export default function OrgChartTab({
  allRoles,
  customRoles,
  employees,
  employeeCountByRole,
  permCountByRole,
  totalPermCount,
  onReparent,
  onInsertAbove,
  onMakeSibling,
  onResetChart,
  onAddChild,
  onAddAbove,
  onRename,
  onDelete,
  onDeleteEmployee,
  onChangeEmployeeOrgRole,
  onManage,
  onUpdateLevel,
  onUpdateProfilePhoto,
  onRemoveProfilePhoto,
  onUpdateRolePhoto,
  onRemoveRolePhoto,
  rolePhotos,
  isRoleLocked,
  isCustomRole,
  readOnly = false,
}: Props) {
  const roots = useMemo(() => childRoles(allRoles, null), [allRoles]);

  const guard =
    <T extends (...args: any[]) => void>(fn: T): T =>
      ((...args: any[]) => {
        if (readOnly) return;
        fn(...args);
      }) as T;

  const reparent = guard(onReparent);
  const insertAbove = guard(onInsertAbove);
  const makeSibling = guard(onMakeSibling);
  const resetChart = guard(onResetChart);
  const addChild = guard(onAddChild);
  const addAbove = guard(onAddAbove);
  const rename = guard(onRename);
  const deleteRole = guard(onDelete);
  const deleteEmployee = guard(onDeleteEmployee);
  const changeEmployeeOrgRole = guard(onChangeEmployeeOrgRole);
  const updateLevel = guard(onUpdateLevel);
  const updateProfilePhoto = guard(onUpdateProfilePhoto);
  const removeProfilePhoto = guard(onRemoveProfilePhoto);
  const updateRolePhoto = guard(onUpdateRolePhoto);
  const removeRolePhoto = guard(onRemoveRolePhoto);

  const [empEditId, setEmpEditId] = useState<string | null>(null);
  const [empOrgRoleDraft, setEmpOrgRoleDraft] = useState<string>(
    ORG_ROLE_OPTIONS[0].value,
  );

  const empEditing = empEditId
    ? employees.find((e) => e.id === empEditId) ?? null
    : null;

  function openEmployeeEdit(emp: DemoEmployee) {
    if (readOnly) return;
    setEmpEditId(emp.id);
    setEmpOrgRoleDraft(normalizeOrgRole(emp.legacyRole || "Officer"));
  }

  function primaryEmployee(roleId: string) {
    const matches = employeesForRole(roleId);
    // Prefer someone with an explicit System Control assign
    return (
      matches.find((e) => {
        const explicit =
          (Array.isArray(e.accessRoleSlugs) && e.accessRoleSlugs.length) ||
          Boolean(e.accessRoleSlug);
        return explicit;
      }) ??
      matches[0] ??
      null
    );
  }

  function employeesForRole(roleId: string) {
    return employees.filter((e) => effectiveAccessSlugs(e).includes(roleId));
  }

  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  // Drop intent based on cursor position over the target card:
  //  "above"   → dragged role becomes the target's manager
  //  "sibling" → dragged role becomes a parallel sibling
  //  "child"   → dragged role reports to the target
  type DropMode = "child" | "above" | "sibling";
  type DropEdge = "top" | "bottom" | "left" | "right";
  const [dropMode, setDropMode] = useState<DropMode>("child");
  const [siblingSide, setSiblingSide] = useState<"left" | "right">("right");
  // Which edge of the target the cursor is nearest — drives the joint symbol.
  const [dropEdge, setDropEdge] = useState<DropEdge>("bottom");
  // Mirror drag state in refs so handlers read the CURRENT value synchronously;
  // React state is async/batched and the first dragover could otherwise skip
  // preventDefault and silently block the drop.
  const dragIdRef = React.useRef<string | null>(null);
  const dropModeRef = React.useRef<DropMode>("child");
  // Click-and-drag panning of the empty canvas surface (replaces scrollbars).
  const panRef = React.useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  // Role ids whose card is hidden — their direct reports visually attach to the
  // hidden role's parent (only the card disappears, not the subtree).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // role currently open in the centered edit modal
  const [editId, setEditId] = useState<string | null>(null);
  // role open in the right-side detail drawer
  const [panelRoleId, setPanelRoleId] = useState<string | null>(null);
  /** "all" = full role tree; otherwise HRM department chip label */
  const [deptView, setDeptView] = useState<string>("all");
  const [panelEmployeeId, setPanelEmployeeId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState<string>("");
  const [levelDraft, setLevelDraft] = useState<string>("");
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const dragMovedRef = React.useRef(false);

  const canvasRef = React.useRef<HTMLDivElement>(null);
  const treeRef = React.useRef<HTMLDivElement>(null);
  // Load at 30% so the whole chart is visible on refresh; user can zoom in,
  // pan, or use the scrollbars from there.
  const [zoom, setZoom] = useState(0.3);
  const zoomRef = React.useRef(zoom);
  zoomRef.current = zoom;

  const MIN_ZOOM = 0.2;
  const MAX_ZOOM = 1.4;
  const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

  // Compute the zoom that makes the whole tree fit inside the canvas.
  const fitToScreen = React.useCallback(() => {
    const canvas = canvasRef.current;
    const tree = treeRef.current;
    if (!canvas || !tree) return;
    const cw = canvas.clientWidth - 44;
    const ch = canvas.clientHeight - 44;
    const rect = tree.getBoundingClientRect();
    // getBoundingClientRect already includes the current zoom, so undo it.
    const tw = rect.width / zoomRef.current;
    const th = rect.height / zoomRef.current;
    if (tw <= 0 || th <= 0) return;
    setZoom(clampZoom(Math.min(cw / tw, ch / th)));
    canvas.scrollTo({ left: 0, top: 0 });
  }, []);

  const zoomIn = () => setZoom((z) => clampZoom(z + 0.1));
  const zoomOut = () => setZoom((z) => clampZoom(z - 0.1));
  const resetZoom = () => {
    setZoom(1);
    canvasRef.current?.scrollTo({ left: 0, top: 0 });
  };

  const editing = editId ? allRoles.find((r) => r.id === editId) ?? null : null;
  const panelRole = panelRoleId ? allRoles.find((r) => r.id === panelRoleId) ?? null : null;
  const panelEmployee = panelEmployeeId
    ? employees.find((e) => e.id === panelEmployeeId) ?? null
    : panelRole
      ? primaryEmployee(panelRole.id)
      : null;
  const filledRoles = allRoles.filter((r) => employeeCountByRole(r.id) > 0).length;
  const openRoles = allRoles.length - filledRoles;

  const deptChips = useMemo(() => listOrgDeptChips(employees), [employees]);
  const ceoCards = useMemo(() => resolveOrgCeoCards(employees), [employees]);
  const deptManager =
    deptView === "all" ? null : findOrgDeptManager(employees, deptView);
  const deptStaff =
    deptView === "all"
      ? []
      : employeesInOrgDept(employees, deptView).filter(
          (e) => !deptManager || e.id !== deptManager.id,
        );
  const managerHint =
    deptView === "all"
      ? null
      : ORG_DEPT_MANAGER_NAME[deptView] ||
        ORG_DEPT_MANAGER_NAME[
          Object.keys(ORG_DEPT_MANAGER_NAME).find(
            (k) => k.toLowerCase() === deptView.toLowerCase(),
          ) || ""
        ] ||
        null;

  function photoForRole(roleId: string, emp: DemoEmployee | null) {
    if (emp?.profilePhoto) return emp.profilePhoto;
    return rolePhotos[roleId] ?? null;
  }

  function handlePhotoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || (!panelRole && !panelEmployee)) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      if (panelEmployee) {
        updateProfilePhoto(panelEmployee.id, reader.result);
      } else if (panelRole) {
        updateRolePhoto(panelRole.id, reader.result);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function openPhotoPicker() {
    if (!panelRole && !panelEmployee) return;
    fileInputRef.current?.click();
  }

  function removePhotoForRole(roleId: string, emp: DemoEmployee | null) {
    if (emp?.profilePhoto) {
      removeProfilePhoto(emp.id);
      return;
    }
    if (rolePhotos[roleId]) {
      removeRolePhoto(roleId);
    }
  }

  React.useEffect(() => {
    if (editing) {
      setNameDraft(editing.name);
      setLevelDraft(String(editing.hierarchyLevel));
    }
  }, [editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleDrop(targetId: string) {
    const sourceId = dragIdRef.current ?? dragId;
    if (sourceId && sourceId !== targetId) {
      const mode = dropModeRef.current;
      if (mode === "above") insertAbove(sourceId, targetId);
      else if (mode === "sibling") makeSibling(sourceId, targetId);
      else reparent(sourceId, targetId);
    }
    dragIdRef.current = null;
    setDragId(null);
    setDropTargetId(null);
  }

  // Pan starts only on the empty surface, never on a card (so card drag-to-
  // reparent keeps working).
  function startPan(e: React.MouseEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-orgcard]")) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    panRef.current = {
      x: e.clientX,
      y: e.clientY,
      sl: canvas.scrollLeft,
      st: canvas.scrollTop,
    };
    setIsPanning(true);
  }

  React.useEffect(() => {
    if (!isPanning) return;
    function move(e: MouseEvent) {
      const canvas = canvasRef.current;
      const p = panRef.current;
      if (!canvas || !p) return;
      canvas.scrollLeft = p.sl - (e.clientX - p.x);
      canvas.scrollTop = p.st - (e.clientY - p.y);
    }
    function up() {
      setIsPanning(false);
      panRef.current = null;
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [isPanning]);

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Direct children promoted up through any hidden intermediate roles. */
  function visibleKids(roleId: string): RoleDef[] {
    const out: RoleDef[] = [];
    for (const child of childRoles(allRoles, roleId)) {
      if (collapsed.has(child.id)) {
        out.push(...visibleKids(child.id));
      } else {
        out.push(child);
      }
    }
    return out;
  }

  function hiddenDirectKids(roleId: string): RoleDef[] {
    return childRoles(allRoles, roleId).filter((c) => collapsed.has(c.id));
  }

  function renderChildList(parentId: string): React.ReactNode {
    const hidden = hiddenDirectKids(parentId);
    const visible = visibleKids(parentId);
    if (hidden.length === 0 && visible.length === 0) return null;
    return (
      <>
        {hidden.length > 0 && (
          <div className={styles.orgHiddenRestoreBar}>
            {hidden.map((h) => (
              <button
                key={h.id}
                type="button"
                className={styles.orgHiddenRestoreBtn}
                onClick={() => toggleCollapse(h.id)}
              >
                Show: {h.name}
              </button>
            ))}
          </div>
        )}
        {visible.length > 0 && (
          <ul className={styles.orgList}>
            {visible.map((kid) => renderNode(kid))}
          </ul>
        )}
      </>
    );
  }

  function commitEdit() {
    if (!editing) return;
    const name = nameDraft.trim();
    if (name && name !== editing.name) rename(editing.id, name);
    const lvl = parseInt(levelDraft, 10);
    if (!Number.isNaN(lvl) && lvl !== editing.hierarchyLevel) {
      updateLevel(editing.id, lvl);
    }
    setEditId(null);
  }

  /** Prefer assigned access role slug for dept-view card actions. */
  function roleIdForEmployee(emp: DemoEmployee): string | null {
    const slugs = effectiveAccessSlugs(emp);
    const leadSlug = slugs.find((s) => s.startsWith("team_lead_"));
    if (leadSlug && allRoles.some((r) => r.id === leadSlug)) return leadSlug;
    if (emp.roleId && allRoles.some((r) => r.id === emp.roleId)) return emp.roleId;
    for (const s of slugs) {
      if (allRoles.some((r) => r.id === s)) return s;
    }
    return emp.roleId || null;
  }

  function renderDeptPersonCard(
    emp: DemoEmployee,
    opts: { manager?: boolean; meta: string },
  ): React.ReactNode {
    const roleId = roleIdForEmployee(emp);
    const role = roleId ? allRoles.find((r) => r.id === roleId) ?? null : null;
    const canAct = !readOnly;

    return (
      <div
        key={emp.id}
        data-orgcard=""
        className={[
          styles.orgPersonCard,
          opts.manager ? styles.orgPersonCardManager : "",
          panelEmployeeId === emp.id ? styles.orgPersonCardSelected : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {opts.manager ? (
          <span className={styles.orgPersonBadge}>Manager</span>
        ) : null}

        {canAct ? (
          <div className={styles.orgCardActions}>
            <button
              type="button"
              className={styles.orgCardBtn}
              title="Change employee role"
              aria-label={`Change role for ${emp.name}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                openEmployeeEdit(emp);
              }}
            >
              <IconEdit />
            </button>
            <button
              type="button"
              className={styles.orgCardBtn}
              title="Delete employee"
              aria-label={`Delete employee ${emp.name}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                deleteEmployee(emp.id);
              }}
            >
              <IconTrash />
            </button>
          </div>
        ) : null}

        <button
          type="button"
          className={styles.orgPersonCardMain}
          onClick={() => {
            setPanelEmployeeId(emp.id);
            setPanelRoleId(roleId);
          }}
        >
          <span className={styles.orgPersonAvatar}>
            {emp.profilePhoto ? (
              <img
                src={emp.profilePhoto}
                alt=""
                className={styles.orgPersonPhoto}
              />
            ) : (
              <span>{emp.initials || initials(emp.name)}</span>
            )}
          </span>
          <span className={styles.orgPersonName}>{emp.name}</span>
          <span className={styles.orgPersonMeta}>
            {orgRoleLabel(emp.legacyRole) !== "Officer"
              ? `${orgRoleLabel(emp.legacyRole)}${
                  role?.name && role.name !== orgRoleLabel(emp.legacyRole)
                    ? ` · ${role.name}`
                    : ""
                }`
              : role?.name && opts.meta !== role.name
                ? opts.meta
                : opts.meta || role?.name || "Staff"}
          </span>
        </button>
      </div>
    );
  }

  function renderNode(role: RoleDef): React.ReactNode {
    if (collapsed.has(role.id)) return null;

    const kids = childRoles(allRoles, role.id);
    const accent = accentOf(role);
    const locked = isRoleLocked(role.id);
    const isDropping = dropTargetId === role.id && dragId !== role.id;
    const isDroppingAbove = isDropping && dropMode === "above";
    const isDroppingChild = isDropping && dropMode === "child";
    const isDroppingSibling = isDropping && dropMode === "sibling";
    const isDragging = dragId === role.id;
    const isPanelOpen = panelRoleId === role.id;
    const emp = primaryEmployee(role.id);
    const deptFooter = deptFooterForRole(allRoles, role);
    const footerClass = tierFooterClass(role.tier, styles);
    const cardPhoto = photoForRole(role.id, emp);
    const userCount = employeeCountByRole(role.id);

    return (
      <li key={role.id} className={styles.orgItem}>
        <div
          data-orgcard=""
          className={[
            styles.orgCard,
            role.tier === "board" ? styles.orgCardBoard : "",
            isPanelOpen ? styles.orgCardSelected : "",
            isDroppingChild ? styles.orgCardDrop : "",
            isDroppingAbove ? styles.orgCardDropAbove : "",
            isDroppingSibling ? styles.orgCardDropSibling : "",
            isDroppingSibling && siblingSide === "left"
              ? styles.orgCardDropSiblingLeft
              : "",
            isDroppingSibling && siblingSide === "right"
              ? styles.orgCardDropSiblingRight
              : "",
            isDragging ? styles.orgCardDragging : "",
          ]
            .filter(Boolean)
            .join(" ")}
          draggable={!locked}
          onDragStart={(e) => {
            if (locked) {
              e.preventDefault();
              return;
            }
            dragMovedRef.current = false;
            dragIdRef.current = role.id;
            setDragId(role.id);
            e.dataTransfer.effectAllowed = "move";
            try {
              e.dataTransfer.setData("text/plain", role.id);
            } catch {
              /* ignore */
            }
          }}
          onDrag={() => {
            dragMovedRef.current = true;
          }}
          onDragEnd={() => {
            dragIdRef.current = null;
            setDragId(null);
            setDropTargetId(null);
          }}
          onDragOver={(e) => {
            const source = dragIdRef.current;
            if (!source || source === role.id) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            // Pick the NEAREST edge to whichever side the cursor came in from:
            //  top → ABOVE (manager), bottom → CHILD (reports),
            //  left/right → SIBLING (parallel, same manager).
            const rect = e.currentTarget.getBoundingClientRect();
            const yRatio = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
            const xRatio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
            const dTop = yRatio;
            const dBottom = 1 - yRatio;
            const dLeft = xRatio;
            const dRight = 1 - xRatio;
            const nearest = Math.min(dTop, dBottom, dLeft, dRight);
            let edge: DropEdge;
            let mode: DropMode;
            if (nearest === dLeft) {
              edge = "left";
              mode = "sibling";
              if (siblingSide !== "left") setSiblingSide("left");
            } else if (nearest === dRight) {
              edge = "right";
              mode = "sibling";
              if (siblingSide !== "right") setSiblingSide("right");
            } else if (nearest === dTop) {
              edge = "top";
              mode = "above";
            } else {
              edge = "bottom";
              mode = "child";
            }
            dropModeRef.current = mode;
            if (dropTargetId !== role.id) setDropTargetId(role.id);
            if (dropMode !== mode) setDropMode(mode);
            if (dropEdge !== edge) setDropEdge(edge);
          }}
          onDragLeave={() => {
            if (dropTargetId === role.id) setDropTargetId(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            handleDrop(role.id);
          }}
        >
          {isDropping && (
            <>
              <span
                className={`${styles.orgJoint} ${
                  dropEdge === "top"
                    ? styles.orgJointTop
                    : dropEdge === "bottom"
                      ? styles.orgJointBottom
                      : dropEdge === "left"
                        ? styles.orgJointLeft
                        : styles.orgJointRight
                }`}
                aria-hidden
              >
                <span className={styles.orgJointDot} />
              </span>
              <span
                className={`${styles.orgJointLabel} ${
                  dropEdge === "top"
                    ? styles.orgJointLabelTop
                    : dropEdge === "bottom"
                      ? styles.orgJointLabelBottom
                      : dropEdge === "left"
                        ? styles.orgJointLabelLeft
                        : styles.orgJointLabelRight
                }`}
              >
                {dropEdge === "top"
                  ? "↑ Becomes manager"
                  : dropEdge === "bottom"
                    ? "↓ Reports here"
                    : "↔ Parallel role"}
              </span>
            </>
          )}

          <button
            type="button"
            className={styles.orgCardMain}
            onClick={() => {
              if (dragMovedRef.current) return;
              setPanelEmployeeId(null);
              setPanelRoleId(role.id);
            }}
          >
            <span className={styles.orgCardPhoto}>
              <ProfilePhoto
                photo={cardPhoto}
                wrapClass={styles.orgPhotoWrap}
                imgClass={styles.orgCardPhotoImg}
                onRemove={() => removePhotoForRole(role.id, emp)}
                initialsNode={
                  <span
                    className={styles.orgCardPhotoInitials}
                    style={{ background: `${accent}18`, color: accent }}
                  >
                    {emp ? emp.initials : initials(role.name)}
                  </span>
                }
              />
            </span>
            <span className={styles.orgCardInfo}>
              {emp ? (
                <>
                  <span className={styles.orgCardPersonName}>{emp.name}</span>
                  <span className={styles.orgCardRoleTitle}>{role.name}</span>
                </>
              ) : (
                <span className={styles.orgCardPersonName}>{role.name}</span>
              )}
              {emp?.pseudonym && (
                <span className={styles.orgCardPill}>{emp.pseudonym}</span>
              )}
              {!emp && userCount > 0 && (
                <span className={styles.orgCardPillMuted}>{userCount} users</span>
              )}
            </span>
          </button>

          <div
            className={`${styles.orgCardFooter} ${footerClass}`}
            style={{ background: deptFooter.color }}
          >
            {deptFooter.label}
          </div>

          <div className={styles.orgCardActions}>
            <button
              type="button"
              className={styles.orgCardBtn}
              title="Add role above"
              aria-label={`Add role above ${role.name}`}
              disabled={locked}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                addAbove(role.id);
              }}
            >
              <IconArrowUp />
            </button>
            <button
              type="button"
              className={styles.orgCardBtn}
              title="Add role under"
              aria-label={`Add role under ${role.name}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                addChild(role.id);
              }}
            >
              <IconPlus />
            </button>
            <button
              type="button"
              className={styles.orgCardBtn}
              title="Edit role"
              aria-label={`Edit ${role.name}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setEditId(role.id);
              }}
            >
              <IconEdit />
            </button>
            <button
              type="button"
              className={styles.orgCardBtn}
              title={locked ? "This role cannot be deleted" : "Delete role"}
              aria-label={`Delete ${role.name}`}
              disabled={locked}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                deleteRole(role.id);
              }}
            >
              <IconTrash />
            </button>
            <button
              type="button"
              className={styles.orgCardBtn}
              title="Hide this role — direct reports move up to the manager above"
              aria-label={`Hide ${role.name}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                toggleCollapse(role.id);
              }}
            >
              <IconEye off={false} />
            </button>
          </div>
        </div>

        {kids.length > 0 &&
          (role.tier === "board" ? (
            <div className={styles.orgDeptRow}>
              {kids.map((kid) => (
                <div key={kid.id} className={styles.orgDeptBox}>
                  <div className={styles.orgDeptBoxTitle}>{deptBoxLabel(kid.name)}</div>
                  <ul className={styles.orgList}>{renderNode(kid)}</ul>
                </div>
              ))}
            </div>
          ) : (
            renderChildList(role.id)
          ))}
      </li>
    );
  }

  return (
    <div className={styles.orgWrap}>
      <div className={styles.orgTopBar}>
        <div className={styles.orgTopIntro}>
          <p className={styles.orgTopEyebrow}>System Control</p>
          <div className={styles.orgTopStats}>
            <span>
              <strong>{allRoles.length}</strong> roles
            </span>
            <span className={styles.orgTopDivider}>·</span>
            <span>
              <strong>{filledRoles}</strong> filled
            </span>
            <span className={styles.orgTopDivider}>·</span>
            <span>
              <strong>{openRoles}</strong> open
            </span>
          </div>
        </div>
        <div className={styles.orgTopActions}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className={styles.orgPhotoInput}
            onChange={handlePhotoPick}
          />
          <button
            type="button"
            className={styles.orgPhotoBtn}
            disabled={!panelRole && !panelEmployee}
            title={
              panelRole || panelEmployee
                ? panelEmployee
                  ? `Upload photo for ${panelEmployee.name}`
                  : `Upload photo for ${panelRole?.name}`
                : "Select a role or person first"
            }
            onClick={openPhotoPicker}
          >
            Add profile photo
          </button>
        </div>
      </div>

      <div className={styles.orgHintBar}>
        Drag a card onto another — aim <strong>top</strong> to make manager,{" "}
        <strong>bottom</strong> to report, <strong>sides</strong> for parallel.
        Use department filters to inspect each team.
      </div>

      <div className={styles.orgDeptChipBar} role="tablist" aria-label="Department filter">
        <span className={styles.orgDeptChipLabel}>View</span>
        <div className={styles.orgDeptChipTrack}>
          <button
            type="button"
            role="tab"
            aria-selected={deptView === "all"}
            className={`${styles.orgDeptChip} ${deptView === "all" ? styles.orgDeptChipActive : ""}`}
            onClick={() => {
              setDeptView("all");
              setPanelEmployeeId(null);
            }}
          >
            All
          </button>
          {deptChips.map((chip) => (
            <button
              key={chip}
              type="button"
              role="tab"
              aria-selected={deptView === chip}
              className={`${styles.orgDeptChip} ${deptView === chip ? styles.orgDeptChipActive : ""}`}
              onClick={() => {
                setDeptView(chip);
                setPanelRoleId(null);
                setPanelEmployeeId(null);
              }}
            >
              {chip}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.orgCanvasWrap}>
        <div className={styles.orgZoomBar}>
          <button
            type="button"
            className={styles.orgZoomBtn}
            onClick={zoomOut}
            disabled={zoom <= MIN_ZOOM + 0.001}
            title="Zoom out"
            aria-label="Zoom out"
          >
            −
          </button>
          <span className={styles.orgZoomValue}>{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className={styles.orgZoomBtn}
            onClick={zoomIn}
            disabled={zoom >= MAX_ZOOM - 0.001}
            title="Zoom in"
            aria-label="Zoom in"
          >
            +
          </button>
          <span className={styles.orgZoomDivider} />
          <button
            type="button"
            className={styles.orgZoomText}
            onClick={fitToScreen}
            title="Fit whole chart in view"
          >
            Fit
          </button>
          <button
            type="button"
            className={styles.orgZoomText}
            onClick={resetZoom}
            title="Reset to 100%"
          >
            100%
          </button>
        </div>

        <div
          className={`${styles.orgCanvas} ${isPanning ? styles.orgCanvasPanning : ""}`}
          ref={canvasRef}
          onMouseDown={startPan}
        >
          <div
            className={styles.orgTree}
            ref={treeRef}
            style={{ zoom } as React.CSSProperties}
          >
            <header className={styles.orgChartHeader}>
              <p className={styles.orgChartEyebrow}>
                {deptView === "all" ? "Company overview" : "Department view"}
              </p>
              <h2 className={styles.orgChartTitle}>
                {deptView === "all"
                  ? "Organizational Chart"
                  : `${deptView} Department`}
              </h2>
              <p className={styles.orgChartSub}>
                {deptView === "all"
                  ? "Leadership at the top, then full reporting structure."
                  : deptView === "IT"
                    ? "Manager and team — Marketing staff included under IT."
                    : "Manager and assigned employees for this department."}
              </p>
            </header>

            {deptView === "all" ? (
              <>
                <section className={styles.orgCeoSection} aria-label="Executive leadership">
                  <div className={styles.orgSectionHead}>
                    <span className={styles.orgSectionRule} />
                    <h3 className={styles.orgSectionTitle}>Executive leadership</h3>
                    <span className={styles.orgSectionRule} />
                  </div>
                  <div className={styles.orgCeoRow}>
                    {ceoCards.map((ceo) => (
                      <button
                        key={ceo.id}
                        type="button"
                        data-orgcard
                        className={`${styles.orgPersonCard} ${styles.orgPersonCardCeo}`}
                        onClick={() => {
                          setPanelEmployeeId(
                            ceo.id.startsWith("ceo-placeholder") ? null : ceo.id,
                          );
                          setPanelRoleId(ceo.roleId || null);
                        }}
                      >
                        <span className={styles.orgPersonAvatar}>
                          {ceo.profilePhoto ? (
                            <img
                              src={ceo.profilePhoto}
                              alt=""
                              className={styles.orgPersonPhoto}
                            />
                          ) : (
                            <span>{ceo.initials || initials(ceo.name)}</span>
                          )}
                        </span>
                        <span className={styles.orgPersonName}>{ceo.name}</span>
                        <span className={styles.orgPersonMeta}>Chief Executive</span>
                      </button>
                    ))}
                  </div>
                </section>
                <div className={styles.orgSectionHead}>
                  <span className={styles.orgSectionRule} />
                  <h3 className={styles.orgSectionTitle}>Reporting structure</h3>
                  <span className={styles.orgSectionRule} />
                </div>
                {roots.length > 0 ? (
                  <ul className={styles.orgList}>{roots.map((r) => renderNode(r))}</ul>
                ) : (
                  <p className={styles.orgEmpty}>No roles yet.</p>
                )}
              </>
            ) : (
              <div className={styles.orgDeptPeople}>
                <div className={styles.orgDeptManagerBlock}>
                  <div className={styles.orgSectionHead}>
                    <span className={styles.orgSectionRule} />
                    <h3 className={styles.orgSectionTitle}>Department manager</h3>
                    <span className={styles.orgSectionRule} />
                  </div>
                  {deptManager &&
                  roleIdForEmployee(deptManager) &&
                  collapsed.has(roleIdForEmployee(deptManager)!) ? (
                    <button
                      type="button"
                      className={styles.orgShowHiddenBtn}
                      onClick={() => {
                        const rid = roleIdForEmployee(deptManager);
                        if (rid) toggleCollapse(rid);
                      }}
                    >
                      Show hidden manager
                    </button>
                  ) : deptManager ? (
                    renderDeptPersonCard(deptManager, {
                      manager: true,
                      meta:
                        managerHint ? `${deptView} · ${managerHint}` : String(deptView),
                    })
                  ) : (
                    <div
                      className={`${styles.orgPersonCard} ${styles.orgPersonCardManager} ${styles.orgPersonCardEmpty}`}
                    >
                      <span className={styles.orgPersonBadge}>Manager</span>
                      <span className={styles.orgPersonName}>
                        {managerHint
                          ? `${managerHint} — not found in HRM`
                          : "No manager mapped"}
                      </span>
                      <span className={styles.orgPersonMeta}>{deptView}</span>
                    </div>
                  )}
                </div>

                <div className={styles.orgDeptStaffBlock}>
                  <div className={styles.orgSectionHead}>
                    <span className={styles.orgSectionRule} />
                    <h3 className={styles.orgSectionTitle}>
                      Team
                      {deptView === "IT" ? " · includes Marketing" : ""}
                      <span className={styles.orgSectionCount}>
                        {
                          deptStaff.filter(
                            (e) => !e.roleId || !collapsed.has(e.roleId),
                          ).length
                        }
                      </span>
                    </h3>
                    <span className={styles.orgSectionRule} />
                  </div>
                  {deptStaff.length === 0 ? (
                    <p className={styles.orgEmpty}>No employees in this department.</p>
                  ) : (
                    <div className={styles.orgDeptStaffGrid}>
                      {deptStaff
                        .filter((emp) => !emp.roleId || !collapsed.has(emp.roleId))
                        .map((emp) =>
                          renderDeptPersonCard(emp, {
                            manager: false,
                            meta: (() => {
                              const slugs = effectiveAccessSlugs(emp);
                              const leadSlug = slugs.find((s) =>
                                s.startsWith("team_lead_"),
                              );
                              if (leadSlug) {
                                return (
                                  allRoles.find((r) => r.id === leadSlug)?.name ||
                                  orgRoleLabel(emp.legacyRole || "Leader")
                                );
                              }
                              if (emp.legacyRole) {
                                const label = orgRoleLabel(emp.legacyRole);
                                if (label !== "Team Lead") return label;
                              }
                              return (
                                allRoles.find((r) => r.id === emp.roleId)?.name ||
                                emp.departmentName ||
                                emp.pseudonym ||
                                "Staff"
                              );
                            })(),
                          }),
                        )}
                    </div>
                  )}
                  {deptStaff.some((e) => e.roleId && collapsed.has(e.roleId)) ? (
                    <button
                      type="button"
                      className={styles.orgShowHiddenBtn}
                      onClick={() => {
                        setCollapsed((prev) => {
                          const next = new Set(prev);
                          for (const e of deptStaff) {
                            if (e.roleId) next.delete(e.roleId);
                          }
                          return next;
                        });
                      }}
                    >
                      Show hidden cards
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>

        <button
          type="button"
          className={styles.orgResetBtn}
          onClick={resetChart}
          title="Reset all drag-drop hierarchy, names, levels and permissions to default"
        >
          Reset chart
        </button>
      </div>

      {editing && (
        <ModalPortal>
        <div
          className={styles.modalOverlay}
          data-hrm-modal-overlay
          role="presentation"
          onClick={() => setEditId(null)}
        >
          <div
            className={styles.orgEditModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="org-edit-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={styles.orgEditHead}
              style={{ borderTopColor: accentOf(editing) }}
            >
              <span
                className={styles.orgCardAvatar}
                style={{
                  background: `${accentOf(editing)}1a`,
                  color: accentOf(editing),
                }}
              >
                {initials(editing.name)}
              </span>
              <div className={styles.orgEditHeadText}>
                <div id="org-edit-title" className={styles.orgPanelTitle}>
                  {editing.name}
                </div>
                <div className={styles.orgCardSlug}>{editing.id}</div>
              </div>
              <button
                type="button"
                className={styles.orgEditClose}
                aria-label="Close"
                onClick={() => setEditId(null)}
              >
                ×
              </button>
            </div>

            <div className={styles.orgEditBody}>
              <label className={styles.orgPanelLabel}>Role name</label>
              <input
                className={styles.orgPanelInput}
                value={nameDraft}
                disabled={isRoleLocked(editing.id)}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit();
                }}
              />

              <label className={styles.orgPanelLabel}>
                Hierarchy level (lower = higher rank)
              </label>
              <input
                type="number"
                min={1}
                className={styles.orgPanelInput}
                value={levelDraft}
                disabled={isRoleLocked(editing.id)}
                onChange={(e) => setLevelDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit();
                }}
              />

              <div className={styles.orgPanelChips}>
                <span className={styles.roleChip}>{editing.portal}</span>
                <span className={styles.roleChip}>Scope: {editing.scopeLabel}</span>
              </div>

              <div className={styles.orgPanelStats}>
                <div>
                  <span className={styles.orgPanelStatValue}>
                    {employeeCountByRole(editing.id)}
                  </span>
                  <span className={styles.orgPanelStatLabel}>Users</span>
                </div>
                <div>
                  <span className={styles.orgPanelStatValue}>
                    {permCountByRole(editing.id)}/{totalPermCount}
                  </span>
                  <span className={styles.orgPanelStatLabel}>Permissions</span>
                </div>
              </div>

              <div className={styles.orgEditActions}>
                <button
                  type="button"
                  className={styles.btnSolidPurple}
                  onClick={() => {
                    addChild(editing.id);
                    setEditId(null);
                  }}
                >
                  + Add role under this
                </button>
                <button
                  type="button"
                  className={styles.btnOutlinePurple}
                  onClick={() => {
                    onManage(editing.id);
                    setEditId(null);
                  }}
                >
                  Manage permissions
                </button>
                <button
                  type="button"
                  className={styles.btnDangerSoft}
                  disabled={isRoleLocked(editing.id)}
                  title={
                    isRoleLocked(editing.id)
                      ? "Core system role cannot be deleted"
                      : "Delete role"
                  }
                  onClick={() => {
                    const id = editing.id;
                    setEditId(null);
                    deleteRole(id);
                  }}
                >
                  Delete role
                </button>
              </div>

              <p className={styles.orgPanelNote}>
                Deleting a role moves its direct reports up to its parent.
                Renames, levels, and permissions sync live to the other tabs.
              </p>
            </div>

            <div className={styles.orgEditFooter}>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => setEditId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.btnSolidPurple}
                disabled={isRoleLocked(editing.id)}
                onClick={commitEdit}
              >
                Save changes
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {(panelRole || panelEmployee) && (
        <>
          <button
            type="button"
            className={styles.orgDrawerBackdrop}
            aria-label="Close details"
            onClick={() => {
              setPanelRoleId(null);
              setPanelEmployeeId(null);
            }}
          />
          <aside className={styles.orgDrawer} aria-label="Role details">
            <button
              type="button"
              className={styles.orgDrawerClose}
              aria-label="Close"
              onClick={() => {
                setPanelRoleId(null);
                setPanelEmployeeId(null);
              }}
            >
              ×
            </button>

            <div className={styles.orgDrawerHero}>
              <span className={styles.orgDrawerAvatar}>
                <ProfilePhoto
                  photo={
                    panelEmployee?.profilePhoto ||
                    (panelRole ? photoForRole(panelRole.id, panelEmployee) : null)
                  }
                  wrapClass={styles.orgPhotoWrapDrawer}
                  imgClass={styles.orgDrawerPhotoImg}
                  onRemove={
                    panelRole
                      ? () => removePhotoForRole(panelRole.id, panelEmployee)
                      : panelEmployee?.profilePhoto
                        ? () => removeProfilePhoto(panelEmployee.id)
                        : undefined
                  }
                  initialsNode={
                    <span
                      style={{
                        background: `${accentOf(panelRole ?? undefined)}18`,
                        color: accentOf(panelRole ?? undefined),
                      }}
                    >
                      {panelEmployee
                        ? panelEmployee.initials
                        : initials(panelRole?.name || "?")}
                    </span>
                  }
                />
              </span>
              <h3 className={styles.orgDrawerName}>
                {panelEmployee?.name ?? panelRole?.name}
              </h3>
              {panelEmployee && panelRole && (
                <p className={styles.orgDrawerTitle}>{panelRole.name}</p>
              )}
              {panelRole && isCustomRole(panelRole.id) && (
                <span className={styles.orgDrawerBadge}>Custom role</span>
              )}
            </div>

            <div className={styles.orgDrawerTabs}>
              <span className={styles.orgDrawerTabActive}>Details</span>
            </div>

            <dl className={styles.orgDrawerDetails}>
              {panelRole && (
                <>
                  <div className={styles.orgDrawerRow}>
                    <dt>Reports to</dt>
                    <dd>
                      {parentRole(allRoles, panelRole)?.name ?? "— Top level —"}
                    </dd>
                  </div>
                  <div className={styles.orgDrawerRow}>
                    <dt>Direct reports</dt>
                    <dd>{childRoles(allRoles, panelRole.id).length}</dd>
                  </div>
                </>
              )}
              {panelEmployee && (
                <>
                  <div className={styles.orgDrawerRow}>
                    <dt>P.Name</dt>
                    <dd>{panelEmployee.pseudonym || "—"}</dd>
                  </div>
                  <div className={styles.orgDrawerRow}>
                    <dt>Employee ID</dt>
                    <dd>{panelEmployee.id}</dd>
                  </div>
                  <div className={styles.orgDrawerRow}>
                    <dt>Department</dt>
                    <dd>
                      {panelEmployee.departmentName ||
                        deptNameById(panelEmployee.departmentId)}
                    </dd>
                  </div>
                  <div className={styles.orgDrawerRow}>
                    <dt>Org role</dt>
                    <dd>{orgRoleLabel(panelEmployee.legacyRole)}</dd>
                  </div>
                  <div className={styles.orgDrawerRow}>
                    <dt>Reports to (person)</dt>
                    <dd>
                      {panelEmployee.reportsTo
                        ? empNameById(employees, panelEmployee.reportsTo) ?? "—"
                        : "— Top level —"}
                    </dd>
                  </div>
                </>
              )}
              {panelRole && (
                <>
                  <div className={styles.orgDrawerRow}>
                    <dt>Portal</dt>
                    <dd>{panelRole.portal}</dd>
                  </div>
                  <div className={styles.orgDrawerRow}>
                    <dt>Scope</dt>
                    <dd>{panelRole.scopeLabel}</dd>
                  </div>
                  <div className={styles.orgDrawerRow}>
                    <dt>Hierarchy level</dt>
                    <dd>{panelRole.hierarchyLevel}</dd>
                  </div>
                  <div className={styles.orgDrawerRow}>
                    <dt>Users in role</dt>
                    <dd>{employeeCountByRole(panelRole.id)}</dd>
                  </div>
                  <div className={styles.orgDrawerRow}>
                    <dt>Permissions</dt>
                    <dd>
                      {permCountByRole(panelRole.id)}/{totalPermCount}
                    </dd>
                  </div>
                </>
              )}
            </dl>

            {panelRole && employeesForRole(panelRole.id).length > 1 && (
              <div className={styles.orgDrawerMore}>
                <div className={styles.orgDrawerMoreTitle}>Also in this role</div>
                <ul className={styles.orgDrawerMoreList}>
                  {employeesForRole(panelRole.id)
                    .slice(1)
                    .map((e) => (
                      <li key={e.id}>{e.name}</li>
                    ))}
                </ul>
              </div>
            )}

            <div className={styles.orgDrawerActions}>
              <button
                type="button"
                className={styles.btnOutlinePurple}
                onClick={openPhotoPicker}
                disabled={!panelRole && !panelEmployee}
              >
                Upload profile photo
              </button>
              {panelEmployee && !readOnly && (
                <>
                  <button
                    type="button"
                    className={styles.btnSolidPurple}
                    onClick={() => {
                      openEmployeeEdit(panelEmployee);
                      setPanelRoleId(null);
                      setPanelEmployeeId(null);
                    }}
                  >
                    Change employee role
                  </button>
                  <button
                    type="button"
                    className={styles.btnDangerSoft}
                    onClick={() => {
                      deleteEmployee(panelEmployee.id);
                      setPanelRoleId(null);
                      setPanelEmployeeId(null);
                    }}
                  >
                    Delete employee
                  </button>
                </>
              )}
              {panelRole && (
                <>
                  <button
                    type="button"
                    className={styles.btnSolidPurple}
                    onClick={() => {
                      setEditId(panelRole.id);
                      setPanelRoleId(null);
                      setPanelEmployeeId(null);
                    }}
                  >
                    Edit role template
                  </button>
                  <button
                    type="button"
                    className={styles.btnOutlinePurple}
                    onClick={() => {
                      onManage(panelRole.id);
                      setPanelRoleId(null);
                      setPanelEmployeeId(null);
                    }}
                  >
                    Manage permissions
                  </button>
                </>
              )}
            </div>
          </aside>
        </>
      )}

      {empEditing && (
        <ModalPortal>
          <div
            className={styles.modalOverlay}
            data-hrm-modal-overlay
            role="presentation"
            onClick={() => setEmpEditId(null)}
          >
            <div
              className={styles.orgEditModal}
              role="dialog"
              aria-modal="true"
              aria-labelledby="org-emp-edit-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className={styles.orgEditHead}>
                <span className={styles.orgCardAvatar}>
                  {empEditing.initials || initials(empEditing.name)}
                </span>
                <div className={styles.orgEditHeadText}>
                  <div id="org-emp-edit-title" className={styles.orgPanelTitle}>
                    {empEditing.name}
                  </div>
                  <div className={styles.orgCardSlug}>
                    ID {empEditing.id}
                    {empEditing.departmentName
                      ? ` · ${empEditing.departmentName}`
                      : ""}
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.orgEditClose}
                  aria-label="Close"
                  onClick={() => setEmpEditId(null)}
                >
                  ×
                </button>
              </div>

              <div className={styles.orgEditBody}>
                <label className={styles.orgPanelLabel} htmlFor="org-emp-role">
                  Org role (same as Add Employee)
                </label>
                <select
                  id="org-emp-role"
                  className={styles.orgPanelInput}
                  value={empOrgRoleDraft}
                  onChange={(e) => setEmpOrgRoleDraft(e.target.value)}
                >
                  {ORG_ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className={styles.modalSub} style={{ marginTop: 8 }}>
                  Team Lead / Manager / CEO get that role&apos;s default
                  permissions for their department. Refine later in Permissions.
                </p>
                <div className={styles.orgEditActions}>
                  <button
                    type="button"
                    className={styles.btnSolidPurple}
                    onClick={() => {
                      changeEmployeeOrgRole(empEditing.id, empOrgRoleDraft);
                      setEmpEditId(null);
                    }}
                  >
                    Save role
                  </button>
                  <button
                    type="button"
                    className={styles.btnDangerSoft}
                    onClick={() => {
                      deleteEmployee(empEditing.id);
                      setEmpEditId(null);
                    }}
                  >
                    Delete employee
                  </button>
                  <button
                    type="button"
                    className={styles.btnGhost}
                    onClick={() => setEmpEditId(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}
