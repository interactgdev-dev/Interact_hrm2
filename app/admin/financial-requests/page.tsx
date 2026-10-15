"use client";

import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import React from "react";
import { createPortal } from "react-dom";
import adminStyles from "../admin-page.module.css";
import { EmployeeTableNameCell } from "../../components/EmployeeTableNameCell";
import { useEmployeeDetailPopup } from "../../components/use-employee-detail-popup";
import { toastError } from "@/lib/app-toast";

type FinancialRequest = {
  id: number;
  employee_id: string;
  employee_name: string;
  request_type: "advance" | "loan";
  amount: number;
  installments?: number | null;
  start_month?: string | null;
  reason?: string | null;
  status: string;
  requested_at: string;
  photo?: string | null;
  initials?: string;
};

export default function AdminFinancialRequestsPage() {
  const [requests, setRequests] = React.useState<FinancialRequest[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState<"pending" | "all">("pending");
  const [rejectRemark, setRejectRemark] = React.useState("");
  const [modalId, setModalId] = React.useState<number | null>(null);
  const [processing, setProcessing] = React.useState(false);
  const { openFromRow, popup, getPhoto } = useEmployeeDetailPopup();

  const fetchRequests = React.useCallback(async () => {
    setLoading(true);
    try {
      const q =
        filter === "pending"
          ? "/api/financial-requests?status=pending"
          : "/api/financial-requests";
      const res = await fetch(`${q}&ts=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      if (data.success) setRequests(data.requests || []);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  React.useEffect(() => {
    void fetchRequests();
  }, [fetchRequests]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}/api/ws`);
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data.toString());
        if (msg?.type === "financial_request_update") void fetchRequests();
      } catch {
        /* ignore */
      }
    };
    return () => ws.close();
  }, [fetchRequests]);

  const handleAction = async (id: number, status: "approved" | "rejected") => {
    setProcessing(true);
    try {
      const res = await fetch("/api/financial-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          status,
          admin_remark: status === "rejected" ? rejectRemark : "",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setModalId(null);
        setRejectRemark("");
        void fetchRequests();
      } else {
        toastError(data.error || "Action failed");
      }
    } catch {
      toastError("Action failed");
    } finally {
      setProcessing(false);
    }
  };

  const typeLabel = (t: string) => (t === "advance" ? "Advance" : "Loan");

  const statusBadgeClass = (status: string) => {
    if (status === "pending") return adminStyles.badgePending;
    if (status === "approved") return adminStyles.badgeApproved;
    return adminStyles.badgeRejected;
  };

  return (
    <OptionalAdminShell>
      <div className={adminStyles.page}>
        <div className={adminStyles.inner}>
          <h1 className={adminStyles.title}>Payroll requests</h1>
          <p className={adminStyles.subtitle}>
            Review employee advance and loan requests. Approved items are added to payroll.
          </p>

          <div className={adminStyles.tabRow}>
            <button
              type="button"
              onClick={() => setFilter("pending")}
              className={`${adminStyles.tabBtn} ${filter === "pending" ? adminStyles.tabBtnActive : ""}`}
            >
              Pending
            </button>
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`${adminStyles.tabBtn} ${filter === "all" ? adminStyles.tabBtnActive : ""}`}
            >
              All
            </button>
          </div>

          {loading ? (
            <p className={adminStyles.muted}>Loading…</p>
          ) : requests.length === 0 ? (
            <div className={adminStyles.empty}>
              No {filter === "pending" ? "pending " : ""}requests.
            </div>
          ) : (
            <div className={adminStyles.requestList}>
              {requests.map((req) => (
                <div key={req.id} className={adminStyles.requestCard}>
                  <EmployeeTableNameCell
                    name={req.employee_name}
                    employeeId={req.employee_id}
                    photo={req.photo ?? getPhoto(req.employee_id)}
                    onOpen={() =>
                      openFromRow({
                        employee_id: req.employee_id,
                        employee_name: req.employee_name,
                      })
                    }
                  />
                  <div className={adminStyles.requestBody}>
                    <div className={adminStyles.requestMeta}>
                      <span className={`${adminStyles.badge} ${adminStyles.badgeType}`}>
                        {typeLabel(req.request_type)}
                      </span>
                      <span className={`${adminStyles.badge} ${statusBadgeClass(req.status)}`}>
                        {req.status}
                      </span>
                    </div>
                    <div className={adminStyles.amount}>
                      PKR {Number(req.amount).toLocaleString()}
                    </div>
                    {req.request_type === "loan" && (
                      <div className={adminStyles.muted}>
                        {req.installments} installments · starts {req.start_month}
                      </div>
                    )}
                    {req.reason && (
                      <div className={adminStyles.muted} style={{ marginTop: 8, color: "#475569" }}>
                        {req.reason}
                      </div>
                    )}
                    <div className={adminStyles.muted} style={{ marginTop: 6, fontSize: 12, color: "#94a3b8" }}>
                      {new Date(req.requested_at).toLocaleString()}
                    </div>
                  </div>
                  {req.status === "pending" && (
                    <div className={adminStyles.actions}>
                      <button
                        type="button"
                        disabled={processing}
                        onClick={() => handleAction(req.id, "approved")}
                        className={adminStyles.btnApprove}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={processing}
                        onClick={() => setModalId(req.id)}
                        className={adminStyles.btnReject}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {modalId !== null &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className={adminStyles.modalBackdrop}
            onClick={() => setModalId(null)}
          >
            <div
              className={adminStyles.modal}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className={adminStyles.modalTitle}>Reject request</h3>
              <textarea
                value={rejectRemark}
                onChange={(e) => setRejectRemark(e.target.value)}
                placeholder="Optional remark for employee…"
                rows={3}
                className={adminStyles.textarea}
              />
              <div className={adminStyles.modalActions}>
                <button
                  type="button"
                  onClick={() => setModalId(null)}
                  className={adminStyles.btnSecondary}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={processing}
                  onClick={() => handleAction(modalId, "rejected")}
                  className={adminStyles.btnReject}
                  style={{ background: "#dc2626", color: "#fff" }}
                >
                  Confirm reject
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {popup}
    </OptionalAdminShell>
  );
}
