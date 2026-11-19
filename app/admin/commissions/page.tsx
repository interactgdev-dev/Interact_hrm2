"use client";

import React, { useEffect, useState, useRef } from "react";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import styles from "../../break-summary/break-summary.module.css";
import { FaFileExcel, FaUpload, FaDownload } from "react-icons/fa";
import { EmployeeTableNameCell } from "../../components/EmployeeTableNameCell";
import { useEmployeeDetailPopup } from "../../components/use-employee-detail-popup";
import { toastError, toastInfo } from "@/lib/app-toast";

export default function CommissionsPage() {
  const [commissionsData, setCommissionsData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { openFromRow, popup, getPhoto } = useEmployeeDetailPopup();

  useEffect(() => {
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
      toastInfo("Please select a month first");
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
      toastError("Failed to download template");
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!selectedMonth) {
      toastInfo("Please select a month first");
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
        fetchCommissionsData();
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
    <OptionalAdminShell>
      <div className={styles.breakSummaryContainer}>
        <h1 className={styles.pageTitle}>Employee Commissions & Incentives</h1>

        <div className={styles.breakSummaryFilters}>
          <label style={{ fontWeight: 600 }}>Month:</label>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className={styles.breakSummaryDate}
          />

          <button
            type="button"
            onClick={handleDownloadTemplate}
            disabled={!selectedMonth || isLoading}
            className={styles.breakSummaryXLSButton}
            style={{ opacity: selectedMonth && !isLoading ? 1 : 0.6 }}
          >
            <FaDownload />
            Download Template
          </button>

          <label
            className={styles.breakSummaryXLSButton}
            style={{
              opacity: selectedMonth && !isLoading ? 1 : 0.6,
              cursor: selectedMonth && !isLoading ? "pointer" : "not-allowed",
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

        {uploadStatus && (
          <div
            style={{
              padding: "12px 16px",
              borderRadius: 10,
              background: uploadStatus.includes("✅") ? "#d1fae5" : "#fee2e2",
              border: `1px solid ${uploadStatus.includes("✅") ? "#6ee7b7" : "#fca5a5"}`,
              marginBottom: 20,
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {uploadStatus}
          </div>
        )}

        <h3 style={{ margin: "0 0 12px", fontSize: "1rem", fontWeight: 700, color: "#611f69" }}>
          Uploaded Commissions ({commissionsData.length} employees)
        </h3>

        {isLoading ? (
          <div className={styles.breakSummaryNoRecords}>Loading...</div>
        ) : commissionsData.length > 0 ? (
          <div className={styles.breakSummaryTableWrapper}>
            <table className={styles.breakSummaryTable}>
              <thead>
                <tr>
                  <th>Employee ID</th>
                  <th>Employee Name</th>
                  <th>6H Train Amt</th>
                  <th>Arrears</th>
                  <th>KPI Add</th>
                  <th>Commission</th>
                  <th>Existing Client Incentive</th>
                  <th>Trainer Incentive</th>
                  <th>Floor Incentive</th>
                </tr>
              </thead>
              <tbody>
                {commissionsData.map((comm: any) => (
                  <tr key={comm.employee_id}>
                    <td>{comm.employee_id}</td>
                    <td>
                      <EmployeeTableNameCell
                        name={comm.employee_name}
                        employeeId={comm.employee_id}
                        photo={getPhoto(comm.employee_id)}
                        onOpen={() =>
                          openFromRow({
                            employee_id: comm.employee_id,
                            employee_name: comm.employee_name,
                          })
                        }
                      />
                    </td>
                    <td>{comm.train_6h_amt || 0}</td>
                    <td>{comm.arrears || 0}</td>
                    <td>{comm.kpi_add || 0}</td>
                    <td>{comm.commission || 0}</td>
                    <td>{comm.existing_client_incentive || 0}</td>
                    <td>{comm.trainer_incentive || 0}</td>
                    <td>{comm.floor_incentive || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.breakSummaryNoRecords}>
            <FaFileExcel style={{ fontSize: 48, marginBottom: 15, color: "#611f69" }} />
            <p style={{ fontSize: 16, marginBottom: 10 }}>No commissions data found for this month</p>
            <p style={{ fontSize: 14, color: "#94a3b8" }}>
              Download template, fill the data, and upload to add commissions
            </p>
          </div>
        )}
      </div>
      {popup}
    </OptionalAdminShell>
  );
}
