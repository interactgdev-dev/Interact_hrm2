"use client";
import LayoutDashboard from "../layout-dashboard";
import React, { useEffect, useMemo, useState } from "react";
import {
  getDateStringInTimeZone,
  getTimeStringInTimeZone,
  SERVER_TIMEZONE,
} from "../../lib/timezone";
import { FaFilter, FaSort, FaSortUp, FaSortDown } from "react-icons/fa";

type LeaveSortKey =
  | "employee_id"
  | "employee_name"
  | "pseudonym"
  | "department_name"
  | "leave_category"
  | "start_date"
  | "total_days"
  | "status"
  | "requested_at";

type SortDirection = "asc" | "desc";

export default function LeavePage() {
  const [leaves, setLeaves] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedLeave, setSelectedLeave] = useState<any | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [rejectRemark, setRejectRemark] = useState("");
  const [balanceInfo, setBalanceInfo] = useState<any | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: LeaveSortKey; direction: SortDirection } | null>(null);

  // WebSocket for real-time updates
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_ENABLE_WS !== "true") return;

    let ws: WebSocket | null = null;
    let cancelled = false;

    const setupRealtime = async () => {
      try {
        const protocol = window.location.protocol === "https:" ? "wss" : "ws";
        ws = new WebSocket(`${protocol}://${window.location.host}/api/ws`);
        ws.onmessage = () => {
          fetchLeaves();
        };
        ws.onerror = () => {
          // Keep silent; realtime is optional and HTTP fetch remains the source of truth.
        };
      } catch {
        // Realtime is optional.
      }
    };

    setupRealtime();

    return () => {
      cancelled = true;
      ws?.close();
    };
  }, []);

  // Fetch all leave requests
  const fetchLeaves = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/leaves");
      const data = await res.json();
      if (data.success) {
        const empRes = await fetch("/api/employee-list");
        const empData = await empRes.json();
        const empMap = new Map<string, { employee_name: string; pseudonym: string; department_name: string }>();
        if (empData.success && Array.isArray(empData.employees)) {
          empData.employees.forEach((emp: any) => {
            const fullName = `${emp?.first_name || ""} ${emp?.last_name || ""}`.trim();
            const profile = {
              employee_name: fullName || "-",
              pseudonym: emp.pseudonym || "-",
              department_name: emp.department_name || "-",
            };
            // Map by numeric id and employee_code for resilient lookup.
            if (emp?.id !== undefined && emp?.id !== null) {
              empMap.set(String(emp.id).trim(), profile);
            }
            if (emp?.employee_code) {
              empMap.set(String(emp.employee_code).trim(), profile);
            }
          });
        }
        const enrichedLeaves = (data.leaves || []).map((l: any) => {
          const employeeKey = String(l?.employee_id ?? "").trim();
          const emp = empMap.get(employeeKey);
          return {
            ...l,
            employee_name: l?.employee_name || emp?.employee_name || "-",
            pseudonym: emp?.pseudonym || "-",
            department_name: emp?.department_name || "-",
          };
        });
        setLeaves(enrichedLeaves);
      } else {
        setError(data.error || "Failed to fetch leaves");
      }
    } catch (e) {
      setError("Failed to fetch leaves");
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchLeaves();
  }, []);

  const handleDocumentDownload = (docPath: string) => {
    // docPath is like /uploads/uuid.pdf
    const filename = docPath.split('/').pop() || docPath;
    const link = document.createElement('a');
    link.href = `/api/attachments/download?filename=${encodeURIComponent(filename)}`;
    link.download = filename;
    link.click();
  };

  // Approve/Reject handlers
  const handleAction = async (id: number, status: "approved" | "rejected") => {
    try {
      await fetch("/api/leaves", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status, admin_remark: status === "rejected" ? rejectRemark : undefined }),
      });
      fetchLeaves();
      setModalOpen(false);
    } catch {
      // Optionally show error
    }
  };

  // Modal for leave details
  const openModal = async (leave: any) => {
    setSelectedLeave(leave);
    setModalOpen(true);
    setRejectRemark("");
    try {
      if (leave?.employee_id) {
        const res = await fetch(`/api/leave-balance?employee_id=${leave.employee_id}`);
        const data = await res.json();
        if (data.success) {
          setBalanceInfo(data);
        } else {
          setBalanceInfo(null);
        }
      } else {
        setBalanceInfo(null);
      }
    } catch {
      setBalanceInfo(null);
    }
  };
  const closeModal = () => {
    setModalOpen(false);
    setSelectedLeave(null);
    setRejectRemark("");
    setBalanceInfo(null);
  };

  const handleFilterClick = (key: LeaveSortKey) => {
    setSortConfig((prev) => {
      if (prev?.key === key) return null;
      return { key, direction: "asc" };
    });
  };

  const handleSortToggle = (key: LeaveSortKey) => {
    setSortConfig((prev) => {
      if (!prev || prev.key !== key) return { key, direction: "asc" };
      return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
    });
  };

  const getSortIcon = (key: LeaveSortKey) => {
    if (!sortConfig || sortConfig.key !== key) return <FaSort style={{ opacity: 0.75 }} />;
    return sortConfig.direction === "asc" ? <FaSortUp /> : <FaSortDown />;
  };

  const sortedLeaves = useMemo(() => {
    if (!sortConfig) return leaves;
    const { key, direction } = sortConfig;
    const getText = (v: unknown) => String(v || "").toLowerCase();

    return [...leaves].sort((a, b) => {
      let cmp = 0;
      switch (key) {
        case "employee_id":
        case "total_days":
          cmp = Number(a[key] || 0) - Number(b[key] || 0);
          break;
        case "employee_name":
        case "pseudonym":
        case "department_name":
        case "leave_category":
          cmp = getText(a[key]).localeCompare(getText(b[key]), undefined, { sensitivity: "base" });
          break;
        case "status":
          cmp = getText(a.status).localeCompare(getText(b.status), undefined, { sensitivity: "base" });
          break;
        case "start_date":
          cmp = new Date(a.start_date || 0).getTime() - new Date(b.start_date || 0).getTime();
          break;
        case "requested_at":
          cmp = new Date(a.requested_at || 0).getTime() - new Date(b.requested_at || 0).getTime();
          break;
        default:
          cmp = 0;
      }
      return direction === "asc" ? cmp : -cmp;
    });
  }, [leaves, sortConfig]);

  const sortButtonStyle: React.CSSProperties = {
    border: "none",
    background: "transparent",
    color: "#fff",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0",
    fontSize: "0.8rem",
  };

  const renderSortableHeader = (label: string, key: LeaveSortKey) => {
    const isActive = sortConfig?.key === key;

    return (
      <div style={{ display: "grid", gridTemplateColumns: "38px 1fr", alignItems: "center", gap: 6, width: "100%" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <button
            type="button"
            onClick={() => handleFilterClick(key)}
            style={{ ...sortButtonStyle, opacity: isActive ? 1 : 0.78 }}
            title={isActive ? `Clear ${label} sort` : `Apply ${label} sort`}
            aria-label={isActive ? `Clear ${label} sort` : `Apply ${label} sort`}
          >
            <FaFilter />
          </button>
          <button
            type="button"
            onClick={() => handleSortToggle(key)}
            style={sortButtonStyle}
            title={`Toggle sort direction for ${label}`}
            aria-label={`Toggle sort direction for ${label}`}
          >
            {getSortIcon(key)}
          </button>
        </div>
        <span style={{ lineHeight: 1.2 }}>{label}</span>
      </div>
    );
  };

  return (
    <LayoutDashboard>
      <style>{`
        .leave-table-wrapper::-webkit-scrollbar { height: 10px; }
        .leave-table-wrapper::-webkit-scrollbar-track { background: #e2e8f0; border-radius: 999px; }
        .leave-table-wrapper::-webkit-scrollbar-thumb { background: #94a3b8; border-radius: 999px; }
        .leave-table-wrapper::-webkit-scrollbar-thumb:hover { background: #64748b; }
      `}</style>
      <div style={{ maxWidth: 1020, margin: "0 auto", padding: 24 }}>
        <div style={{ background: "#fff", borderRadius: 12, padding: "14px 18px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)", marginBottom: 18 }}>
          <h1 style={{ color: "#2b6cb0", fontWeight: 700, fontSize: "1.5rem", margin: 0 }}>Leave Requests</h1>
        </div>
        {loading ? (
          <div>Loading...</div>
        ) : error ? (
          <div style={{ color: "#e74c3c" }}>{error}</div>
        ) : (
          <div className="leave-table-wrapper" style={{ overflowX: "auto", overflowY: "auto", maxHeight: "74vh", width: "100%", maxWidth: "100%", border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", boxShadow: "0 2px 8px #e2e8f0", paddingBottom: 6, scrollbarWidth: "thin" as const, WebkitOverflowScrolling: "touch" }}>
          <table style={{ width: "max-content", minWidth: "100%", borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 12 }}>
              <tr style={{ background: "linear-gradient(135deg, #0052CC 0%, #00B8A9 100%)", color: "#fff" }}>
                <th style={thStyle}>{renderSortableHeader("Id", "employee_id")}</th>
                <th style={thStyle}>{renderSortableHeader("Full Name", "employee_name")}</th>
                <th style={thStyle}>{renderSortableHeader("P.Name", "pseudonym")}</th>
                <th style={thStyle}>{renderSortableHeader("Department", "department_name")}</th>
                <th style={thStyle}>{renderSortableHeader("Category", "leave_category")}</th>
                <th style={thStyle}>{renderSortableHeader("Dates", "start_date")}</th>
                <th style={thStyle}>{renderSortableHeader("Days", "total_days")}</th>
                <th style={thStyle}>{renderSortableHeader("Status", "status")}</th>
                <th style={thStyle}>{renderSortableHeader("Requested At", "requested_at")}</th>
                <th style={thActionsStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedLeaves.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: "center", color: "#888", padding: 16 }}>No leave requests yet.</td></tr>
              )}
              {sortedLeaves.map((l, idx) => (
                <tr key={l?.id ?? `${l?.employee_id || "emp"}-${l?.start_date || "start"}-${l?.end_date || "end"}-${idx}`}>
                  {(() => {
                    const status = String(l?.status || "pending").toLowerCase();
                    const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
                    const statusColor =
                      status === "approved" ? "#27ae60" : status === "rejected" ? "#e74c3c" : "#e67e22";
                    return (
                      <>
                  <td style={tdAlignedStyle}>{l.employee_id}</td>
                  <td style={tdAlignedStyle}>{l.employee_name || ""}</td>
                  <td style={tdAlignedStyle}>{l.pseudonym || "-"}</td>
                  <td style={tdAlignedStyle}>{l.department_name || "-"}</td>
                  <td style={tdAlignedStyle}>{l.leave_category}</td>
                    <td style={tdAlignedStyle}>{formatDate(l.start_date)} - {formatDate(l.end_date)}</td>
                  <td style={tdAlignedStyle}>{l.total_days}</td>
                  <td style={{ ...tdAlignedStyle, color: statusColor, fontWeight: 600 }}>{statusLabel}</td>
                  <td style={tdAlignedStyle}>{l.requested_at ? formatDateTime(l.requested_at) : ""}</td>
                  <td style={tdActionsStyle}>
                    <div style={actionButtonsRowStyle}>
                      <button onClick={() => openModal(l)} style={btnView}>View</button>
                      {status === "pending" && (
                        <>
                          <button onClick={() => handleAction(l.id, "approved")} style={btnApprove}>Approve</button>
                          <button onClick={() => handleAction(l.id, "rejected")} style={btnReject}>Reject</button>
                        </>
                      )}
                    </div>
                  </td>
                      </>
                    );
                  })()}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}

        {/* Modal for leave details */}
        {modalOpen && selectedLeave && (
          <div style={modalOverlay} onClick={closeModal}>
            <div style={modalContent} onClick={e => e.stopPropagation()}>
              <h2 style={{ color: "#2b6cb0", fontWeight: 700, fontSize: "1.3rem", marginBottom: 10 }}>Leave Details</h2>
              <div><b>Employee ID:</b> {selectedLeave.employee_id}</div>
              <div><b>Category:</b> {selectedLeave.leave_category}</div>
                <div><b>Dates:</b> {formatDate(selectedLeave.start_date)} - {formatDate(selectedLeave.end_date)} ({selectedLeave.total_days} days)</div>
              <div>
                <b>Status:</b>{" "}
                <span
                  style={{
                    color:
                      String(selectedLeave?.status || "pending").toLowerCase() === "approved"
                        ? "#27ae60"
                        : String(selectedLeave?.status || "pending").toLowerCase() === "rejected"
                          ? "#e74c3c"
                          : "#e67e22",
                    fontWeight: 600,
                  }}
                >
                  {(() => {
                    const status = String(selectedLeave?.status || "pending").toLowerCase();
                    return status.charAt(0).toUpperCase() + status.slice(1);
                  })()}
                </span>
              </div>
              <div><b>Reason (Employee):</b> <span style={{ color: "#333" }}>{selectedLeave.reason}</span></div>
              {selectedLeave.admin_remark && (
                <div><b>Admin Remarks:</b> <span style={{ color: "#333" }}>{selectedLeave.admin_remark}</span></div>
              )}
              {balanceInfo && (
                <div style={{ marginTop: 10 }}>
                  <b>Current Balances:</b>
                  <div>{(balanceInfo.employment_status === 'Probation' ? 'Leave Balance' : 'Annual Leave Balance')}: {balanceInfo.annualBalance} / {balanceInfo.annualAllowance}</div>
                  <div>Bereavement Balance: {balanceInfo.bereavementBalance} / 3</div>
                </div>
              )}
              <div><b>Documents:</b> {(() => { const docs = typeof selectedLeave.document_paths === 'string' ? JSON.parse(selectedLeave.document_paths || '[]') : selectedLeave.document_paths; return Array.isArray(docs) && docs.length > 0 ? docs.map((d: string) => <span key={d} style={{marginRight: 8}}><button style={{background: '#3478f6', color: '#fff', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer'}} onClick={() => handleDocumentDownload(d)}>📄 {d}</button></span>) : <span style={{color: '#999'}}>No documents</span>; })()}</div>
              <div><b>Requested At:</b> {selectedLeave.requested_at ? formatDateTime(selectedLeave.requested_at) : ""}</div>
              {String(selectedLeave?.status || "pending").toLowerCase() === "pending" && (
                <div style={{ marginTop: 18 }}>
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontWeight: 600 }}>Admin Remarks (for rejection)</label>
                    <textarea value={rejectRemark} onChange={e => setRejectRemark(e.target.value)} rows={2} style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #ccc" }} placeholder="Reason for rejection (optional but recommended)" />
                  </div>
                  <button onClick={() => handleAction(selectedLeave.id, "approved")} style={btnApprove}>Approve</button>
                  <button onClick={() => handleAction(selectedLeave.id, "rejected")} style={btnReject}>Reject</button>
                </div>
              )}
              <button onClick={closeModal} style={btnClose}>Close</button>
            </div>
          </div>
        )}
      </div>
    </LayoutDashboard>
  );
}
// Format date as dd/mm/yyyy using Asia/Karachi timezone
function formatDate(dateString: string) {
  if (!dateString) return "";
  const dateKey = getDateStringInTimeZone(dateString, SERVER_TIMEZONE);
  const [year, month, day] = dateKey.split("-");
  return `${day}/${month}/${year}`;
}

// Format date-time as dd/mm/yyyy hh:mm:ss using Asia/Karachi timezone
function formatDateTime(dateTimeString: string) {
  if (!dateTimeString) return "";
  const dateKey = getDateStringInTimeZone(dateTimeString, SERVER_TIMEZONE);
  const timeStr = getTimeStringInTimeZone(dateTimeString, SERVER_TIMEZONE);
  const [year, month, day] = dateKey.split("-");
  return `${day}/${month}/${year} ${timeStr}`;
}

const thStyle: React.CSSProperties = { padding: "10px 10px", fontWeight: 700, color: "#fff", borderBottom: "1px solid #e2e8f0", textAlign: "left", fontSize: "12px", whiteSpace: "nowrap", verticalAlign: "middle" };
const tdStyle = { padding: "8px 10px", borderBottom: "1px solid #f0f0f0", fontSize: "13px", whiteSpace: "nowrap", verticalAlign: "middle" };
const tdAlignedStyle: React.CSSProperties = { ...tdStyle, paddingLeft: 54 };
const thActionsStyle: React.CSSProperties = { ...thStyle, minWidth: 220 };
const tdActionsStyle: React.CSSProperties = { ...tdStyle, minWidth: 230, paddingRight: 10 };
const actionButtonsRowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap", minWidth: 210 };
const btnApprove = { background: "#27ae60", color: "#fff", border: "none", borderRadius: 6, padding: "4px 12px", marginRight: 6, cursor: "pointer" };
const btnReject = { background: "#e74c3c", color: "#fff", border: "none", borderRadius: 6, padding: "4px 12px", cursor: "pointer" };
const btnView = { background: "#3478f6", color: "#fff", border: "none", borderRadius: 6, padding: "4px 12px", marginRight: 6, cursor: "pointer" };
const btnClose = { background: "#888", color: "#fff", border: "none", borderRadius: 6, padding: "4px 18px", marginTop: 18, cursor: "pointer" };
const modalOverlay: React.CSSProperties = { position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", background: "rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 };
const modalContent = { background: "#fff", borderRadius: 12, padding: 32, minWidth: 350, maxWidth: 500, boxShadow: "0 2px 16px #888" };