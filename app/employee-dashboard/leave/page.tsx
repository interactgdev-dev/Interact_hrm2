"use client";

interface Leave {
  id: number;
  leave_category: string;
  start_date: string;
  end_date: string;
  total_days: number;
  reason: string;
  documents: string[];
  status: string;
  requested_at: string;
  document_paths?: string | string[];
  // Add any other fields you use from leave object
}
import React, { useState, useEffect, useRef } from "react";
import {
  getDateStringInTimeZone,
  getTimeStringInTimeZone,
  SERVER_TIMEZONE,
} from "../../../lib/timezone";

const LEAVE_CATEGORIES = [
  { value: "annual", label: "Annual" },
  { value: "casual", label: "Casual" },
  { value: "sick", label: "Sick" },
  { value: "bereavement", label: "Bereavement" },
  { value: "other", label: "Other" },
];



export default function LeavePage() {
  // State for employee info
  const [employeeId, setEmployeeId] = useState<string>("");
  const [employeeName, setEmployeeName] = useState<string>("");

  // Form state
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [leaveBalance, setLeaveBalance] = useState(20);
  const [annualAllowance, setAnnualAllowance] = useState(20);
  const [employmentStatus, setEmploymentStatus] = useState<string>("Permanent");
  const [bereavementBalance, setBereavementBalance] = useState(3);
  const [category, setCategory] = useState("annual");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [documents, setDocuments] = useState<File[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedLeave, setSelectedLeave] = useState<any | null>(null);
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Initialize employee info from localStorage
  useEffect(() => {
    const initEmployeeInfo = async () => {
      let empId = localStorage.getItem("employeeId") || "";
      let empName = localStorage.getItem("employeeName") || "";

      // If missing, try to fetch from backend
      if (!empId) {
        const loginId = localStorage.getItem("loginId");
        if (loginId) {
          try {
            const res = await fetch(`/api/hrm_employees?employeeId=${loginId}`);
            const data = await res.json();
            if (data.success && data.employee) {
              empId = String(data.employee.id || data.employee.employee_id || loginId);
              empName = `${data.employee.first_name || ""} ${data.employee.middle_name || ""} ${data.employee.last_name || ""}`.trim();
              localStorage.setItem("employeeId", empId);
              localStorage.setItem("employeeName", empName);
            }
          } catch (e) {
            console.log("Error fetching employee info:", e);
          }
        }
      }

      setEmployeeId(empId);
      setEmployeeName(empName);
    };

    initEmployeeInfo();
  }, []);

  // Close modal handler
  const closeModal = () => {
    setModalOpen(false);
    setSelectedLeave(null);
    setDocModalOpen(false);
    setSelectedDoc(null);
  };


// Format date as dd/mm/yyyy
function formatDate(dateString: string) {
  if (!dateString) return "";
  const d = new Date(dateString);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// Format datetime as dd/mm/yyyy hh:mm:ss in Asia/Karachi timezone
function formatDateTime(dateTimeString: string) {
  if (!dateTimeString) return "";
  const dateStr = getDateStringInTimeZone(dateTimeString, SERVER_TIMEZONE);
  const timeStr = getTimeStringInTimeZone(dateTimeString, SERVER_TIMEZONE);
  const [year, month, day] = dateStr.split("-");
  return `${day}/${month}/${year} ${timeStr}`;
}

  // Fetch leaves from backend
  const fetchLeaves = async () => {
    try {
      if (!employeeId) {
        console.log("Employee ID not available yet");
        return;
      }

      console.log("Fetching leaves for employee:", employeeId);

      // Fetch all leaves
      const res = await fetch(`/api/leaves?ts=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      const data = await res.json();
      if (data.success) {
        // Filter only this employee's leaves
        const myLeaves = data.leaves.filter((l: any) => l.employee_id == employeeId);
        console.log("My leaves:", myLeaves);
        setLeaves(myLeaves);
      }

      // Fetch dynamic leave balance from new endpoint
      console.log(`Calling /api/leave-balance?employee_id=${employeeId}`);
      const balanceRes = await fetch(`/api/leave-balance?employee_id=${employeeId}&ts=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      const balanceData = await balanceRes.json();
      console.log("Raw balance response:", balanceData);
      
      if (balanceData.success) {
        console.log("Annual Balance:", balanceData.annualBalance);
        console.log("Bereavement Balance:", balanceData.bereavementBalance);
        setLeaveBalance(balanceData.annualBalance || 0);
        setAnnualAllowance(balanceData.annualAllowance || 20);
        setBereavementBalance(balanceData.bereavementBalance || 0);
        setEmploymentStatus(balanceData.employment_status || "Permanent");
      } else {
        console.log("Balance API error:", balanceData.error);
      }
    } catch (err) {
      console.log("Fetch error:", err);
    }
  };

  useEffect(() => {
    if (employeeId) {
      fetchLeaves();
      
      // Refresh balance every 30 seconds to catch admin updates
      const intervalId = setInterval(() => {
        fetchLeaves();
      }, 30000); // 30 seconds
      
      return () => clearInterval(intervalId);
    }
  }, [employeeId]);

  // WebSocket for real-time updates
  useEffect(() => {
    if (!employeeId) return;
    
    try {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new window.WebSocket(`${protocol}://${window.location.host}/api/ws`);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "leave_update") fetchLeaves();
        } catch {}
      };
      return () => ws.close();
    } catch (e) {
      console.log("WebSocket error:", e);
    }
  }, [employeeId]);

  // Handle file input
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    // Only allow PDFs and max 100MB per file
    const validFiles = files.filter(f => f.type === "application/pdf" && f.size <= 100 * 1024 * 1024);
    setDocuments(validFiles);
  };

  // Handle leave apply
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      // Upload files first if any
      let uploadedFilePaths: string[] = [];
      if (documents.length > 0) {
        const formData = new FormData();
        formData.append("employee_id", employeeId || "");
        documents.forEach(file => {
          formData.append("files", file);
        });

        const uploadRes = await fetch("/api/attachments", {
          method: "POST",
          body: formData,
        });
        const uploadData = await uploadRes.json();
        if (!uploadData.success) {
          setError(uploadData.error || "Failed to upload documents");
          setSubmitting(false);
          return;
        }
        uploadedFilePaths = uploadData.files.map((f: any) => f.url);
      }

      // Create leave request with uploaded file paths
      const res = await fetch("/api/leaves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employeeId,
          employee_name: employeeName,
          leave_category: category,
          start_date: startDate,
          end_date: endDate,
          total_days: calcDays(startDate, endDate),
          reason,
          document_paths: uploadedFilePaths.length > 0 ? uploadedFilePaths : [],
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccess("Leave request submitted!");
        fetchLeaves();
        setCategory("annual");
        setStartDate("");
        setEndDate("");
        setReason("");
        setDocuments([]);
      } else {
        setError(data.error || "Failed to submit leave request");
      }
    } catch (err: any) {
      setError("Failed to submit leave request");
    }
    setSubmitting(false);
  };

  const handleDocumentDownload = (docPath: string) => {
    // docPath is like /uploads/uuid.pdf
    const filename = docPath.split('/').pop() || docPath;
    const link = document.createElement('a');
    link.href = `/api/attachments/download?filename=${encodeURIComponent(filename)}`;
    link.download = filename;
    link.click();
  };

  // Helper to calculate days
  function calcDays(start: string, end: string) {
    if (!start || !end) return 0;
    const s = new Date(start);
    const e = new Date(end);
    return Math.max(1, Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1 style={{ color: "#3478f6", fontWeight: 700, fontSize: "2rem", marginBottom: 18, background: "white", padding: "16px 24px", borderRadius: 8 }}>Leave Management</h1>
      <div style={{ marginBottom: 24, fontSize: "1.1rem", color: "#2b6cb0", display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: "white", padding: "16px 24px", borderRadius: 8 }}>
        <span>{employmentStatus === 'Probation' ? 'Leave Balance' : 'Annual Leave Balance'}: <b>{leaveBalance}</b> / {annualAllowance}</span>
        <span style={{ marginLeft: 'auto' }}>Bereavement Leave Balance: <b>{bereavementBalance}</b> / 3</span>
      </div>
      <form onSubmit={handleSubmit} style={{ background: "#f7fafc", borderRadius: 12, padding: 24, marginBottom: 32, boxShadow: "0 2px 8px #e2e8f0" }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={{ fontWeight: 700, color: "#000000" }}>Category</label>
            <select value={category} onChange={e => setCategory(e.target.value)} style={{ width: "100%", padding: 8, borderRadius: 6, border: "2px solid #90A4AE", color: "#000000", fontWeight: 600 }}>
              {LEAVE_CATEGORIES.map(cat => (
                <option key={cat.value} value={cat.value}>{cat.label}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={{ fontWeight: 700, color: "#000000" }}>Start Date</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required style={{ width: "100%", padding: 8, borderRadius: 6, border: "2px solid #90A4AE", color: "#000000", fontWeight: 600 }} />
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={{ fontWeight: 700, color: "#000000" }}>End Date</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} required style={{ width: "100%", padding: 8, borderRadius: 6, border: "2px solid #90A4AE", color: "#000000", fontWeight: 600 }} />
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <label style={{ fontWeight: 700, color: "#000000" }}>Reason</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} required rows={2} style={{ width: "100%", padding: 8, borderRadius: 6, border: "2px solid #90A4AE", color: "#000000", fontWeight: 600 }} />
        </div>
        <div style={{ marginTop: 16 }}>
          <label style={{ fontWeight: 700, color: "#000000" }}>Attach Documents (PDF only)</label>
          <div style={{ marginTop: 8 }}>
            <input
              id="fileInput"
              type="file"
              accept="application/pdf"
              multiple
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              onClick={() => document.getElementById('fileInput')?.click()}
              style={{
                background: '#2b6cb0',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '8px 16px',
                fontSize: '1rem',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Choose Files
            </button>
          </div>
          <div style={{ fontSize: "0.95rem", color: "#888", marginTop: 8 }}>
            {documents.length > 0 && (
              <div>
                <strong>Selected:</strong>
                {documents.map(f => <div key={f.name} style={{marginTop: 4}}>📄 {f.name}</div>)}
              </div>
            )}
          </div>
        </div>
        <button type="submit" disabled={submitting} style={{ marginTop: 18, background: "#2b6cb0", color: "#fff", border: "none", borderRadius: 8, padding: "10px 28px", fontSize: "1.1rem", fontWeight: 600, cursor: "pointer" }}>
          {submitting ? "Submitting..." : "Apply for Leave"}
        </button>
        {error && <div style={{ color: "#e74c3c", marginTop: 10 }}>{error}</div>}
        {success && <div style={{ color: "#27ae60", marginTop: 10 }}>{success}</div>}
      </form>

      {/* Leave Requests Table */}
      <h2 style={{ color: "#2b6cb0", fontWeight: 600, fontSize: "1.3rem", marginBottom: 10, background: "white", padding: "16px 24px", borderRadius: 8 }}>Your Leave Requests</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 8, boxShadow: "0 2px 8px #e2e8f0" }}>
          <thead>
            <tr style={{ background: "#f7fafc" }}>
              <th style={thStyle}>Category</th>
              <th style={thStyle}>Dates</th>
              <th style={thStyle}>Days</th>
              <th style={thStyle}>Reason</th>
              <th style={thStyle}>Documents</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Requested At</th>

            </tr>
          </thead>
          <tbody>
            {leaves.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: "center", color: "#888", padding: 16 }}>No leave requests yet.</td></tr>
            )}
            {leaves.map(l => (
              <tr key={l.id}>
                <td style={{...tdStyle, fontWeight: 700, color: "#000000"}}>{l.leave_category.charAt(0).toUpperCase() + l.leave_category.slice(1)}</td>
                <td style={tdStyle}>{formatDate(l.start_date)} - {formatDate(l.end_date)}</td>
                <td style={tdStyle}>{l.total_days}</td>
                <td style={tdStyle}><button style={{ background: '#3478f6', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', cursor: 'pointer' }} onClick={() => { setSelectedLeave(l); setModalOpen(true); }}>View</button></td>
                      {/* Modal for leave reason/details */}
                      {modalOpen && selectedLeave && (
                        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={closeModal}>
                          <div style={{ background: '#fff', borderRadius: 12, padding: 32, minWidth: 350, maxWidth: 500, boxShadow: '0 2px 16px #888' }} onClick={e => e.stopPropagation()}>
                            <h2 style={{ color: '#2b6cb0', fontWeight: 700, fontSize: '1.3rem', marginBottom: 10 }}>Leave Details</h2>
                            <div><b>Category:</b> {selectedLeave.leave_category}</div>
                            <div><b>Dates:</b> {formatDate(selectedLeave.start_date)} - {formatDate(selectedLeave.end_date)} ({selectedLeave.total_days} days)</div>
                            <div><b>Status:</b> <span style={{ color: selectedLeave.status === 'approved' ? '#27ae60' : selectedLeave.status === 'rejected' ? '#e74c3c' : '#e67e22', fontWeight: 600 }}>{selectedLeave.status.charAt(0).toUpperCase() + selectedLeave.status.slice(1)}</span></div>
                            <div><b>Reason:</b> <span style={{ color: '#333' }}>{selectedLeave.reason}</span></div>
                            {selectedLeave.admin_remark && (
                              <div><b>Admin Remarks:</b> <span style={{ color: selectedLeave.status === 'rejected' ? '#e74c3c' : '#333' }}>{selectedLeave.admin_remark}</span></div>
                            )}
                            <div><b>Documents:</b> {(() => { const docs = typeof selectedLeave.document_paths === 'string' ? JSON.parse(selectedLeave.document_paths || '[]') : selectedLeave.document_paths; return Array.isArray(docs) && docs.length > 0 ? docs.map((d: string) => <span key={d} style={{marginRight: 8}}><button style={{background: '#3478f6', color: '#fff', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: '0.9rem'}} onClick={() => handleDocumentDownload(d)}>📄 {d}</button></span>) : <span style={{color: '#999'}}>No documents</span>; })()}</div>
                            <div><b>Requested At:</b> {selectedLeave.requested_at ? formatDateTime(selectedLeave.requested_at) : ''}</div>
                            <button onClick={closeModal} style={{ background: '#888', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', marginTop: 18, fontWeight: 600, cursor: 'pointer' }}>Close</button>
                          </div>
                        </div>
                      )}
                <td style={tdStyle}>{(() => { const docs = typeof l.document_paths === 'string' ? JSON.parse(l.document_paths || '[]') : l.document_paths; return Array.isArray(docs) && docs.length > 0 ? docs.map((d: string) => <span key={d} style={{background: '#E8F4F8', padding: '2px 6px', borderRadius: 4, marginRight: 4, fontSize: '0.9rem'}}>{d}</span>) : <span style={{color: '#999'}}>None</span>; })()}</td>
                <td style={{ ...tdStyle, color: l.status === "approved" ? "#27ae60" : l.status === "rejected" ? "#e74c3c" : "#e67e22", fontWeight: 700 }}>{l.status.charAt(0).toUpperCase() + l.status.slice(1)}</td>
                <td style={tdStyle}>{l.requested_at ? formatDateTime(l.requested_at) : ""}</td>

              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: "10px 8px", fontWeight: 700, color: "#000000", borderBottom: "1px solid #e2e8f0", textAlign: "left" };
const tdStyle = { padding: "8px 8px", borderBottom: "1px solid #f0f0f0" };
