"use client";

import React, { useEffect, useState, useRef } from "react";
import LayoutDashboard from "../../layout-dashboard";
import styles from "../../attendance-summary/attendance-summary.module.css";
import { FaFileExcel, FaUpload, FaDownload } from "react-icons/fa";

export default function CommissionsPage() {
  const [commissionsData, setCommissionsData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Set current month as default
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    setSelectedMonth(currentMonth);
  }, []);

  useEffect(() => {
    if (selectedMonth) {
      fetchCommissionsData();
    }
  }, [selectedMonth]);

  const fetchCommissionsData = async () => {
    if (!selectedMonth) return;
    
    setIsLoading(true);
    try {
      const response = await fetch(`/api/commissions?month=${selectedMonth}`);
      const result = await response.json();
      
      if (result.success) {
        setCommissionsData(result.data || []);
      }
    } catch (error) {
      console.error("Error fetching commissions:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadTemplate = async () => {
    if (!selectedMonth) {
      alert("Please select a month first");
      return;
    }

    try {
      const response = await fetch(`/api/commissions/download-template?month=${selectedMonth}`);
      
      if (!response.ok) {
        throw new Error("Failed to download template");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Commissions_Template_${selectedMonth}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Error downloading template:", error);
      alert("Failed to download template");
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!selectedMonth) {
      alert("Please select a month first");
      return;
    }

    setUploadStatus("Uploading...");
    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("month", selectedMonth);

      const response = await fetch("/api/commissions/upload-template", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        setUploadStatus(`✅ Successfully uploaded ${result.successCount} records`);
        fetchCommissionsData(); // Refresh data
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      } else {
        setUploadStatus(`❌ Upload failed: ${result.error}`);
      }
    } catch (error) {
      console.error("Error uploading file:", error);
      setUploadStatus("❌ Failed to upload file");
    } finally {
      setIsLoading(false);
      setTimeout(() => setUploadStatus(""), 5000);
    }
  };

  return (
    <LayoutDashboard>
      <div className={styles.attendanceSummaryContainer} style={{ minHeight: 'calc(100vh - 96px)' }}>
        <h1 style={{ color: "#22223B", marginBottom: 20 }}>Employee Commissions & Incentives</h1>
        
        {/* Month Selection & Actions */}
        <div style={{ 
          display: "flex", 
          gap: 15, 
          alignItems: "center", 
          marginBottom: 20,
          flexWrap: "wrap"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontWeight: 600, color: "#22223B" }}>Month:</label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                border: "1px solid #d1d5db",
                fontSize: 14,
              }}
            />
          </div>

          <button
            onClick={handleDownloadTemplate}
            disabled={!selectedMonth || isLoading}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 20px",
              background: "linear-gradient(135deg, #00B8A9 0%, #0052CC 100%)",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: selectedMonth && !isLoading ? "pointer" : "not-allowed",
              fontWeight: 600,
              fontSize: 14,
              opacity: selectedMonth && !isLoading ? 1 : 0.6,
            }}
          >
            <FaDownload />
            Download Template
          </button>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 20px",
              background: "linear-gradient(135deg, #0052CC 0%, #00B8A9 100%)",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: selectedMonth && !isLoading ? "pointer" : "not-allowed",
              fontWeight: 600,
              fontSize: 14,
              opacity: selectedMonth && !isLoading ? 1 : 0.6,
            }}
          >
            <FaUpload />
            Upload Template
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileUpload}
              disabled={!selectedMonth || isLoading}
              style={{ display: "none" }}
            />
          </label>
        </div>

        {/* Upload Status */}
        {uploadStatus && (
          <div style={{
            padding: "12px 16px",
            borderRadius: 6,
            background: uploadStatus.includes("✅") ? "#d1fae5" : "#fee2e2",
            border: `1px solid ${uploadStatus.includes("✅") ? "#6ee7b7" : "#fca5a5"}`,
            marginBottom: 20,
            fontSize: 14,
            fontWeight: 600,
          }}>
            {uploadStatus}
          </div>
        )}

        {/* Commissions Data Table */}
        <div style={{ marginTop: 20 }}>
          <h3 style={{ color: "#22223B", marginBottom: 15 }}>
            Uploaded Commissions ({commissionsData.length} employees)
          </h3>
          
          {isLoading ? (
            <div style={{ textAlign: "center", padding: 40, color: "#666" }}>
              Loading...
            </div>
          ) : commissionsData.length > 0 ? (
            <div style={{ overflow: 'hidden', position: 'relative' }}>
              <div style={{ overflowX: 'auto', overflowY: 'hidden', border: '1px solid #e2e8f0', borderRadius: 8, width: 'calc(100vw - 290px)', maxHeight: '600px', boxSizing: 'border-box' }}>
                <table style={{
                  width: "1400px",
                  borderCollapse: "collapse",
                  background: "#fff",
                }}>
                <thead>
                  <tr style={{
                    background: "linear-gradient(90deg, #0052CC 0%, #00B8A9 100%)",
                    color: "#fff",
                  }}>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 13, whiteSpace: "nowrap" }}>Employee ID</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 13, whiteSpace: "nowrap" }}>Employee Name</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 13, whiteSpace: "nowrap" }}>6H Train Amt</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 13, whiteSpace: "nowrap" }}>Arrears</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 13, whiteSpace: "nowrap" }}>KPI Add</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 13, whiteSpace: "nowrap" }}>Commission</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 13, whiteSpace: "nowrap" }}>Existing Client Incentive</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 13, whiteSpace: "nowrap" }}>Trainer Incentive</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 13, whiteSpace: "nowrap" }}>Floor Incentive</th>
                  </tr>
                </thead>
                <tbody>
                  {commissionsData.map((comm: any, idx: number) => (
                    <tr
                      key={comm.employee_id}
                      style={{
                        borderBottom: "1px solid #e2e8f0",
                        background: idx % 2 === 0 ? "#fff" : "#f9fafb",
                      }}
                    >
                      <td style={{ padding: "10px 16px", fontSize: 14 }}>{comm.employee_id}</td>
                      <td style={{ padding: "10px 16px", fontSize: 14 }}>{comm.employee_name}</td>
                      <td style={{ padding: "10px 16px", fontSize: 14 }}>{comm.train_6h_amt || 0}</td>
                      <td style={{ padding: "10px 16px", fontSize: 14 }}>{comm.arrears || 0}</td>
                      <td style={{ padding: "10px 16px", fontSize: 14 }}>{comm.kpi_add || 0}</td>
                      <td style={{ padding: "10px 16px", fontSize: 14 }}>{comm.commission || 0}</td>
                      <td style={{ padding: "10px 16px", fontSize: 14 }}>{comm.existing_client_incentive || 0}</td>
                      <td style={{ padding: "10px 16px", fontSize: 14 }}>{comm.trainer_incentive || 0}</td>
                      <td style={{ padding: "10px 16px", fontSize: 14 }}>{comm.floor_incentive || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          ) : (
            <div style={{
              background: "#fff",
              padding: 40,
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              textAlign: "center",
              color: "#666",
            }}>
              <FaFileExcel style={{ fontSize: 48, marginBottom: 15, color: "#0052CC" }} />
              <p style={{ fontSize: 16, marginBottom: 10 }}>No commissions data found for this month</p>
              <p style={{ fontSize: 14, color: "#999" }}>
                Download template, fill the data, and upload to add commissions
              </p>
            </div>
          )}
        </div>
      </div>
    </LayoutDashboard>
  );
}
