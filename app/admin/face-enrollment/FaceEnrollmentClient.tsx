"use client";

import React from "react";
import LayoutDashboard from "../../layout-dashboard";
import styles from "./face-enrollment.module.css";
import tableStyles from "../../break-summary/break-summary.module.css";
import { EmployeeTableNameCell } from "../../components/EmployeeTableNameCell";
import { useEmployeeDetailPopup } from "../../components/use-employee-detail-popup";
import {
  descriptorToJson,
  ensureFaceModelsLoaded,
  preloadFaceRuntime,
  scanBlob,
  scanVideoFrame,
} from "@/lib/face-client-engine";
import { enrollmentPhotoApiUrl } from "@/lib/enrollment-photo-url";
import { FaceScanViewport } from "@/app/components/FaceScanHud";
import { FaToggleOff, FaToggleOn } from "react-icons/fa";
import { toastError, toastSuccess } from "@/lib/app-toast";

type EmployeeOption = {
  id: number;
  first_name?: string;
  last_name?: string;
  pseudonym?: string;
  employee_code?: string;
};

type EnrollmentPhoto = {
  id: number;
  local_path: string | null;
  face_descriptor?: string | null;
  source: "upload" | "webcam";
  created_at: string;
  compreface_image_id: string;
};

type ServiceStatus = {
  configured?: boolean;
  reachable?: boolean;
  error?: string;
  subjectCount?: number;
  recommendedMin?: number;
  recommendedMax?: number;
};

type EmployeeVerificationRow = {
  id: number;
  name: string;
  pseudonym: string | null;
  employee_code: string | null;
  department: string | null;
  face_verification_enabled: boolean;
  photo_count: number;
  descriptor_count: number;
};

type ListSearchMode = "name" | "pseudonym" | "both";

export default function FaceEnrollmentAdminPage() {
  const [employees, setEmployees] = React.useState<EmployeeOption[]>([]);
  const [employeeId, setEmployeeId] = React.useState("");
  const [service, setService] = React.useState<ServiceStatus | null>(null);
  const [photos, setPhotos] = React.useState<EnrollmentPhoto[]>([]);
  const [subject, setSubject] = React.useState<string | null>(null);
  const [employeeName, setEmployeeName] = React.useState("");
  const [ready, setReady] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<"upload" | "webcam">("upload");
  const [cameraReady, setCameraReady] = React.useState(false);
  const [pendingFiles, setPendingFiles] = React.useState<string[]>([]);
  const [dragOver, setDragOver] = React.useState(false);
  const [modelsReady, setModelsReady] = React.useState(false);
  const [employeeRows, setEmployeeRows] = React.useState<EmployeeVerificationRow[]>([]);
  const [globalFaceEnabled, setGlobalFaceEnabled] = React.useState(true);
  const [listLoading, setListLoading] = React.useState(true);
  const [listError, setListError] = React.useState<string | null>(null);
  const [listSearch, setListSearch] = React.useState("");
  const [listSearchMode, setListSearchMode] = React.useState<ListSearchMode>("both");
  const [deptFilter, setDeptFilter] = React.useState("");
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const [employeePickerQuery, setEmployeePickerQuery] = React.useState("");
  const [employeePickerOpen, setEmployeePickerOpen] = React.useState(false);
  const { openFromRow, popup, getPhoto } = useEmployeeDetailPopup();

  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const employeePickerRef = React.useRef<HTMLDivElement>(null);

  const selectedEmployee = employees.find((e) => String(e.id) === employeeId);

  const displayName = (e: EmployeeOption) =>
    [e.first_name, e.last_name].filter(Boolean).join(" ").trim() || `Employee ${e.id}`;

  const filteredPickerEmployees = React.useMemo(() => {
    const q = employeePickerQuery.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) => {
      const name =
        [e.first_name, e.last_name].filter(Boolean).join(" ").trim().toLowerCase() ||
        `employee ${e.id}`;
      const pseudo = (e.pseudonym || "").toLowerCase();
      const id = String(e.id);
      return name.includes(q) || pseudo.includes(q) || id.includes(q);
    });
  }, [employees, employeePickerQuery]);

  React.useEffect(() => {
    if (!employeePickerOpen) return;
    const onDocClick = (ev: MouseEvent) => {
      if (!employeePickerRef.current?.contains(ev.target as Node)) {
        setEmployeePickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [employeePickerOpen]);

  const loadEmployeeList = React.useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const res = await fetch("/api/admin/face-enrollment/employees", { cache: "no-store" });
      const data = await res.json();
      if (data.success) {
        setEmployeeRows(data.employees || []);
        setGlobalFaceEnabled(Boolean(data.globalEnabled ?? true));
      } else {
        setListError(data.error || "Could not load employee list.");
      }
    } catch {
      setListError("Could not load employee list. Check server is running.");
    } finally {
      setListLoading(false);
    }
  }, []);

  const refreshServiceStatus = React.useCallback(async () => {
    try {
      const res = await fetch("/api/admin/face-enrollment/status", { cache: "no-store" });
      const data = await res.json();
      setService(data);
      return data as ServiceStatus;
    } catch {
      setService({ configured: false, reachable: false, error: "Could not check face verification API" });
      return null;
    }
  }, []);

  // Picker uses the same lightweight face-enrollment employees payload (not /api/employee-list).
  React.useEffect(() => {
    setEmployees(
      employeeRows.map((row) => {
        const parts = String(row.name || "")
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        return {
          id: row.id,
          first_name: parts[0] || row.name || `Employee ${row.id}`,
          last_name: parts.slice(1).join(" ") || undefined,
          pseudonym: row.pseudonym || undefined,
          employee_code: row.employee_code || undefined,
        };
      }),
    );
  }, [employeeRows]);

  React.useEffect(() => {
    let cancelled = false;

    // Paint the page as soon as list + status return — do not wait for TF/face-api models.
    Promise.all([loadEmployeeList(), refreshServiceStatus()])
      .catch(() => {
        if (!cancelled) setError("Failed to load page data");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // Start JS parse early; weight download continues in background.
    preloadFaceRuntime();
    ensureFaceModelsLoaded()
      .then(() => {
        if (!cancelled) setModelsReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setError(
            "Face engine failed to load. Run npm run face:setup, then refresh this page.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loadEmployeeList, refreshServiceStatus]);

  const handleVerificationToggle = async (row: EmployeeVerificationRow) => {
    const next = !row.face_verification_enabled;
    setEmployeeRows((prev) =>
      prev.map((e) => (e.id === row.id ? { ...e, face_verification_enabled: next } : e))
    );
    try {
      const res = await fetch("/api/admin/face-enrollment/employees", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: row.id, enabled: next }),
      });
      const data = await res.json();
      if (!data.success) {
        setEmployeeRows((prev) =>
          prev.map((e) =>
            e.id === row.id ? { ...e, face_verification_enabled: row.face_verification_enabled } : e
          )
        );
        setError(data.error || "Could not update face verification setting.");
      } else {
        setMessage(
          next
            ? `Face verification enabled for ${row.name}.`
            : `Face verification disabled for ${row.name} — clock/breaks work without camera.`
        );
      }
    } catch {
      setEmployeeRows((prev) =>
        prev.map((e) =>
          e.id === row.id ? { ...e, face_verification_enabled: row.face_verification_enabled } : e
        )
      );
      setError("Could not update face verification setting.");
    }
  };

  const backfillDescriptors = React.useCallback(
    async (photoList: EnrollmentPhoto[]): Promise<number> => {
      if (!modelsReady) return 0;
      let updated = 0;
      for (const photo of photoList) {
        if (photo.face_descriptor || !photo.local_path) continue;
        try {
          const imgRes = await fetch(enrollmentPhotoApiUrl(photo.id));
          if (!imgRes.ok) continue;
          const blob = await imgRes.blob();
          const scan = await scanBlob(blob);
          if (scan.status !== "ok") continue;
          const desc = scan.descriptor;
          const save = await fetch("/api/admin/face-enrollment/descriptor", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: photo.id,
              descriptor: descriptorToJson(desc),
            }),
          });
          if (save.ok) updated += 1;
        } catch {
          // skip single photo
        }
      }
      return updated;
    },
    [modelsReady]
  );

  const loadEnrollment = React.useCallback(async (id: string) => {
    if (!id) {
      setPhotos([]);
      setSubject(null);
      setReady(false);
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/face-enrollment?employeeId=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!data.success) {
        setError(data.error || "Failed to load enrollment");
        return;
      }
      setPhotos(data.photos || []);
      setSubject(data.subject || null);
      setEmployeeName(data.employee?.name || "");
      setReady(!!data.ready);

      if (data.needsDescriptorRefresh && modelsReady && (data.photos?.length ?? 0) > 0) {
        setMessage("Refreshing face profiles from saved photos…");
        const updated = await backfillDescriptors(data.photos || []);
        if (updated > 0) {
          const again = await fetch(
            `/api/admin/face-enrollment?employeeId=${encodeURIComponent(id)}`
          );
          const refreshed = await again.json();
          if (refreshed.success) {
            setPhotos(refreshed.photos || []);
            setReady(!!refreshed.ready);
            setMessage(
              refreshed.ready
                ? `Face profiles ready (${refreshed.descriptorCount} photos). Employee can verify now.`
                : `Updated ${updated} photo(s). Add more photos if needed (${refreshed.descriptorCount}/3 minimum).`
            );
          }
        } else {
          setMessage(
            "Could not refresh profiles from saved files. Re-upload or recapture photos."
          );
        }
      }
    } catch {
      setError("Failed to load enrollment");
    }
  }, [backfillDescriptors, modelsReady]);

  React.useEffect(() => {
    void loadEnrollment(employeeId);
  }, [employeeId, loadEnrollment]);

  const stopCamera = React.useCallback(() => {
    setCameraReady(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = React.useCallback(async () => {
    setError(null);
    setCameraReady(false);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera not supported in this browser");
      }
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { min: 480, ideal: 1280 },
          height: { min: 360, ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Camera access denied";
      const insecure =
        typeof window !== "undefined" && !window.isSecureContext
          ? " This site is not HTTPS — use the Upload tab or add SSL on the server."
          : " Allow camera in browser site settings (Chrome → lock icon → Camera).";
      setError(`${msg}.${insecure}`);
    }
  }, [stopCamera]);

  React.useEffect(() => {
    if (tab !== "webcam" || !employeeId) {
      stopCamera();
      return;
    }
    const t = setTimeout(() => void startCamera(), 300);
    return () => {
      clearTimeout(t);
      stopCamera();
    };
  }, [tab, employeeId, startCamera, stopCamera]);

  const waitForVideoFrame = () =>
    new Promise<void>((resolve) => {
      const video = videoRef.current;
      if (!video) {
        resolve();
        return;
      }
      if ("requestVideoFrameCallback" in video) {
        (video as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => void })
          .requestVideoFrameCallback(() => resolve());
        return;
      }
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

  const captureBlob = async (): Promise<Blob | null> => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || video.videoWidth === 0) return null;

    await waitForVideoFrame();

    const cropRatio = 0.78;
    const cropSize = Math.min(video.videoWidth, video.videoHeight) * cropRatio;
    const sx = (video.videoWidth - cropSize) / 2;
    const sy = (video.videoHeight - cropSize) / 2;
    const size = Math.max(720, Math.round(cropSize));

    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.translate(size, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, cropSize, cropSize, 0, 0, size, size);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  };

  const enrollBlob = async (
    blob: Blob,
    source: "upload" | "webcam",
    precomputedDescriptor?: Float32Array
  ) => {
    if (!employeeId) {
      setError("Select an employee first.");
      return false;
    }
    if (photos.length >= (service?.recommendedMax ?? 5)) {
      setError(`Maximum ${service?.recommendedMax ?? 5} photos reached.`);
      return false;
    }

    if (!modelsReady) {
      setError("Face engine is still loading. Wait a moment and try again.");
      return false;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    let descriptor = precomputedDescriptor;
    if (!descriptor) {
      const scan = await scanBlob(blob);
      if (scan.status === "multiple") {
        setError(
          `Multiple faces detected (${scan.count}). Use a photo with only one person in the frame.`
        );
        setBusy(false);
        return false;
      }
      if (scan.status !== "ok") {
        setError(
          source === "webcam"
            ? "No face detected. Look at the camera, hold still, and try again."
            : "No face detected. Use a front-facing photo with one face, better lighting, and try again."
        );
        setBusy(false);
        return false;
      }
      descriptor = scan.descriptor;
    }

    const fd = new FormData();
    fd.append("employee_id", employeeId);
    fd.append(
      "employee_name",
      employeeName || (selectedEmployee ? displayName(selectedEmployee) : "Employee")
    );
    fd.append("source", source);
    fd.append("file", blob, "face.jpg");
    fd.append("descriptor", JSON.stringify(descriptorToJson(descriptor)));

    try {
      const res = await fetch("/api/admin/face-enrollment", { method: "POST", body: fd });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || "Enrollment failed");
        return false;
      }
      setPhotos(data.photos || []);
      setSubject(data.subject || subject);
      setReady(!!data.ready);
      setMessage(
        data.ready
          ? "Photo enrolled. Employee is ready for strong face verification (3+ photos)."
          : `Photo enrolled (${data.photoCount}/${service?.recommendedMin ?? 3} minimum for verification).`
      );
      void loadEmployeeList();
      return true;
    } catch {
      setError("Enrollment request failed. Check server console.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const processFiles = async (files: FileList | File[]) => {
    if (!employeeId) {
      setError("Select an employee first.");
      return;
    }
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!list.length) {
      setError("Please choose JPEG or PNG image files.");
      return;
    }
    setPendingFiles(list.map((f) => f.name));
    let ok = 0;
    for (const file of list) {
      if (photos.length + ok >= (service?.recommendedMax ?? 5)) break;
      const success = await enrollBlob(file, "upload");
      if (success) ok += 1;
      else break;
    }
    setPendingFiles([]);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) void processFiles(e.target.files);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) void processFiles(e.dataTransfer.files);
  };

  const handleWebcamCapture = async () => {
    if (!cameraReady) {
      setError("Wait for camera preview to load, or click Restart camera.");
      return;
    }
    const video = videoRef.current;
    if (!video || !modelsReady) {
      setError("Face engine is still loading. Wait a moment and try again.");
      return;
    }

    setBusy(true);
    setError(null);

    const scan = await scanVideoFrame(video);
    if (scan.status === "multiple") {
      setError(
        `Multiple faces detected (${scan.count}). Only one person should be in the frame.`
      );
      setBusy(false);
      return;
    }
    if (scan.status !== "ok") {
      setError("No face detected. Look at the camera, hold still, and try again.");
      setBusy(false);
      return;
    }
    const descriptor = scan.descriptor;

    const blob = await captureBlob();
    if (!blob || blob.size < 3000) {
      setError("Could not capture from camera. Hold still and try again.");
      setBusy(false);
      return;
    }

    await enrollBlob(blob, "webcam", descriptor);
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Remove this enrollment photo?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/face-enrollment/photo?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || "Delete failed");
        return;
      }
      await loadEnrollment(employeeId);
      void loadEmployeeList();
      setMessage("Photo removed.");
    } catch {
      setError("Delete failed");
    } finally {
      setBusy(false);
    }
  };

  const tableRows = React.useMemo((): EmployeeVerificationRow[] => {
    if (employeeRows.length > 0) return employeeRows;
    return employees.map((e) => ({
      id: e.id,
      name: displayName(e),
      pseudonym: e.pseudonym?.trim() || null,
      employee_code: e.employee_code ?? null,
      department: null,
      face_verification_enabled: false,
      photo_count: 0,
      descriptor_count: 0,
    }));
  }, [employeeRows, employees]);

  const filteredTableRows = React.useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    return tableRows.filter((row) => {
      if (deptFilter && (row.department || "") !== deptFilter) return false;
      if (!q) return true;
      const name = row.name.toLowerCase();
      const pseudo = (row.pseudonym || "").toLowerCase();
      const id = String(row.id);

      if (listSearchMode === "name") {
        return name.includes(q) || id.includes(q);
      }
      if (listSearchMode === "pseudonym") {
        return pseudo.includes(q);
      }
      return name.includes(q) || pseudo.includes(q) || id.includes(q);
    });
  }, [listSearch, listSearchMode, tableRows, deptFilter]);

  const departmentOptions = React.useMemo(() => {
    const set = new Set<string>();
    for (const row of tableRows) {
      const d = (row.department || "").trim();
      if (d) set.add(d);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [tableRows]);

  async function setVerificationBulk(enabled: boolean) {
    if (!globalFaceEnabled || filteredTableRows.length === 0 || bulkBusy) return;
    const ids = filteredTableRows.map((r) => r.id);
    setBulkBusy(true);
    setEmployeeRows((prev) =>
      prev.map((e) =>
        ids.includes(e.id) ? { ...e, face_verification_enabled: enabled } : e
      )
    );
    try {
      const res = await fetch("/api/admin/face-enrollment/employees", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeIds: ids, enabled }),
      });
      const data = await res.json();
      if (!data.success) {
        await loadEmployeeList();
        toastError(data.error || "Bulk update failed");
        return;
      }
      toastSuccess(
        enabled
          ? `Active: ${data.updated ?? ids.length} employees (filtered list)`
          : `Inactive: ${data.updated ?? ids.length} employees (filtered list)`
      );
    } catch {
      await loadEmployeeList();
      toastError("Bulk update failed");
    } finally {
      setBulkBusy(false);
    }
  }

  const serviceOk = modelsReady && (service?.configured ?? true);
  const canAddPhotos =
    !!employeeId && !busy && modelsReady && photos.length < (service?.recommendedMax ?? 5);

  return (
    <LayoutDashboard>
      <div className={styles.page}>
        <div className={styles.pageHeader}>
          <h1 className={styles.title}>Face Enrollment</h1>
          <div className={styles.statusBar}>
            <span
              className={`${styles.pill} ${serviceOk ? styles.pillOk : service?.configured ? styles.pillWarn : styles.pillErr}`}
            >
              {serviceOk ? "Engine ready" : modelsReady ? "Checking…" : "Loading…"}
            </span>
            {employeeId && (
              <span className={`${styles.pill} ${ready ? styles.pillOk : styles.pillWarn}`}>
                {photos.length}/{service?.recommendedMax ?? 5} photos
                {ready ? " · Ready" : ""}
              </span>
            )}
          </div>
        </div>

        {(error || message) && (
          <div className={`${styles.alert} ${error ? styles.alertError : styles.alertSuccess}`}>
            {error || message}
          </div>
        )}

        <div className={styles.grid}>
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Employee</h2>
            <div className={styles.employeePicker} ref={employeePickerRef}>
              <input
                id="employee-select"
                type="search"
                className={styles.select}
                placeholder="Search by name or pseudonym…"
                value={
                  employeePickerOpen
                    ? employeePickerQuery
                    : selectedEmployee
                      ? `${displayName(selectedEmployee)}${
                          selectedEmployee.pseudonym
                            ? ` · ${selectedEmployee.pseudonym}`
                            : ""
                        } · ID ${selectedEmployee.id}`
                      : employeePickerQuery
                }
                onChange={(e) => {
                  setEmployeePickerQuery(e.target.value);
                  setEmployeePickerOpen(true);
                  if (employeeId) setEmployeeId("");
                }}
                onFocus={() => {
                  setEmployeePickerOpen(true);
                  if (selectedEmployee) {
                    setEmployeePickerQuery("");
                  }
                }}
                disabled={loading || busy}
                autoComplete="off"
                aria-label="Search employee by name or pseudonym"
                aria-expanded={employeePickerOpen}
                aria-controls="employee-picker-list"
              />
              {employeePickerOpen && !loading ? (
                <ul id="employee-picker-list" className={styles.employeePickerList} role="listbox">
                  {filteredPickerEmployees.length === 0 ? (
                    <li className={styles.employeePickerEmpty}>No employees match</li>
                  ) : (
                    filteredPickerEmployees.map((e) => (
                      <li key={e.id}>
                        <button
                          type="button"
                          className={`${styles.employeePickerOption}${
                            String(e.id) === employeeId ? ` ${styles.employeePickerOptionActive}` : ""
                          }`}
                          role="option"
                          aria-selected={String(e.id) === employeeId}
                          onClick={() => {
                            setEmployeeId(String(e.id));
                            setEmployeePickerQuery("");
                            setEmployeePickerOpen(false);
                          }}
                        >
                          <span className={styles.employeePickerName}>{displayName(e)}</span>
                          <span className={styles.employeePickerMeta}>
                            {e.pseudonym ? `${e.pseudonym} · ` : ""}ID {e.id}
                          </span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              ) : null}
            </div>
          </div>

          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Add photos</h2>
            <div className={styles.tabs}>
              <button
                type="button"
                className={tab === "upload" ? styles.tabActive : styles.tab}
                onClick={() => setTab("upload")}
                disabled={!employeeId || busy}
              >
                Upload
              </button>
              <button
                type="button"
                className={tab === "webcam" ? styles.tabActive : styles.tab}
                onClick={() => setTab("webcam")}
                disabled={!employeeId || busy}
              >
                Webcam
              </button>
            </div>

            {!employeeId ? (
              <p className={styles.emptyState}>Select an employee</p>
            ) : tab === "upload" ? (
              <>
                <input
                  ref={fileRef}
                  id="face-file-input"
                  className={styles.hiddenFileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/jpg"
                  multiple
                  onChange={handleFileInput}
                />
                <div
                  className={`${styles.uploadZone} ${dragOver ? styles.uploadZoneActive : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                >
                  <p className={styles.uploadLabel}>Drop photos or browse</p>
                  <button
                    type="button"
                    className={styles.btnPrimary}
                    disabled={!canAddPhotos}
                    onClick={() => fileRef.current?.click()}
                  >
                    {busy ? "Uploading…" : "Choose files"}
                  </button>
                </div>
                {pendingFiles.length > 0 && (
                  <ul className={styles.fileList}>
                    {pendingFiles.map((name) => (
                      <li key={name}>Uploading {name}…</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <>
                {typeof window !== "undefined" && !window.isSecureContext ? (
                  <p className={styles.blockedNote}>
                    Camera is blocked on <strong>HTTP</strong> (browser security). Use the{" "}
                    <strong>Upload</strong> tab here, or enable <strong>HTTPS</strong> on staging
                    (e.g. nginx + SSL). Code cannot override this.
                  </p>
                ) : null}
                <FaceScanViewport
                  videoRef={videoRef}
                  className={styles.enrollScanViewport}
                  autoPlay
                  mode={
                    busy
                      ? "capturing"
                      : !cameraReady || !modelsReady
                        ? "initializing"
                        : "scanning"
                  }
                  statusLine={
                    busy
                      ? "SAVING BIOMETRIC SAMPLE"
                      : cameraReady && modelsReady
                        ? "READY TO CAPTURE"
                        : "INITIALIZING SENSORS"
                  }
                  subjectName={
                    employeeName || (selectedEmployee ? displayName(selectedEmployee) : undefined)
                  }
                  subjectId={selectedEmployee?.employee_code || employeeId || undefined}
                  captureCurrent={photos.length}
                  captureTotal={service?.recommendedMax ?? 5}
                  loadingLabel={
                    busy ? "Please wait…" : !cameraReady ? "Starting camera…" : "Loading face engine…"
                  }
                  onVideoLoaded={() => setCameraReady(true)}
                />
                <canvas ref={canvasRef} style={{ display: "none" }} />
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.btn}
                    onClick={() => void startCamera()}
                    disabled={!employeeId || busy}
                  >
                    Restart
                  </button>
                  <button
                    type="button"
                    className={styles.btnPrimary}
                    onClick={() => void handleWebcamCapture()}
                    disabled={!canAddPhotos || !cameraReady}
                  >
                    {busy ? "Saving…" : "Capture"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className={styles.card} style={{ marginBottom: 16 }}>
          <h2 className={styles.cardTitle}>Enrolled photos</h2>
          {!employeeId ? (
            <p className={styles.emptyState}>—</p>
          ) : photos.length === 0 ? (
            <p className={styles.emptyState}>No photos yet</p>
          ) : (
            <div className={styles.photoGrid}>
              {photos.map((p) => (
                <div key={p.id} className={styles.photoCard}>
                  {p.local_path ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={enrollmentPhotoApiUrl(p.id)}
                      alt="Enrolled"
                      className={styles.photoImg}
                    />
                  ) : (
                    <div className={styles.photoImg} />
                  )}
                  <div className={styles.photoMeta}>
                    <div>{p.source === "webcam" ? "Webcam" : "Upload"}</div>
                    <button
                      type="button"
                      className={styles.btnDanger}
                      style={{ marginTop: 6, width: "100%" }}
                      disabled={busy}
                      onClick={() => void handleDelete(p.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Face verification</h2>
          {listError && <div className={`${styles.alert} ${styles.alertError}`}>{listError}</div>}
          {listLoading ? (
            <p className={styles.loadingText}>Loading…</p>
          ) : tableRows.length === 0 ? (
            <p className={styles.emptyState}>No employees</p>
          ) : (
            <>
              <div className={tableStyles.breakSummaryFilters}>
                <div className={styles.searchModeGroup} role="group" aria-label="Search by">
                  <button
                    type="button"
                    className={
                      listSearchMode === "name" ? styles.searchModeActive : styles.searchModeBtn
                    }
                    onClick={() => setListSearchMode("name")}
                  >
                    Name
                  </button>
                  <button
                    type="button"
                    className={
                      listSearchMode === "pseudonym"
                        ? styles.searchModeActive
                        : styles.searchModeBtn
                    }
                    onClick={() => setListSearchMode("pseudonym")}
                  >
                    Pseudonym
                  </button>
                  <button
                    type="button"
                    className={
                      listSearchMode === "both" ? styles.searchModeActive : styles.searchModeBtn
                    }
                    onClick={() => setListSearchMode("both")}
                  >
                    Both
                  </button>
                </div>
                <select
                  className={tableStyles.breakSummaryInput}
                  value={deptFilter}
                  onChange={(e) => setDeptFilter(e.target.value)}
                  aria-label="Department"
                  style={{ flex: "0 1 200px", minWidth: 160 }}
                >
                  <option value="">All departments</option>
                  {departmentOptions.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                <input
                  type="search"
                  className={tableStyles.breakSummaryInput}
                  placeholder={
                    listSearchMode === "name"
                      ? "Search by name or ID…"
                      : listSearchMode === "pseudonym"
                        ? "Search by pseudonym…"
                        : "Search by name or pseudonym…"
                  }
                  value={listSearch}
                  onChange={(e) => setListSearch(e.target.value)}
                  style={{ flex: "1 1 220px", minWidth: 180 }}
                />
                <button
                  type="button"
                  className={styles.searchModeBtn}
                  disabled={!globalFaceEnabled || bulkBusy || filteredTableRows.length === 0}
                  onClick={() => void setVerificationBulk(true)}
                  title="Set Active for filtered rows"
                >
                  Active all
                </button>
                <button
                  type="button"
                  className={styles.searchModeBtn}
                  disabled={!globalFaceEnabled || bulkBusy || filteredTableRows.length === 0}
                  onClick={() => void setVerificationBulk(false)}
                  title="Set Inactive for filtered rows"
                >
                  Inactive all
                </button>
              </div>
              <div className={`${tableStyles.breakSummaryTableWrapper} ${styles.enrollCompactWrapper}`}>
              <table className={`${tableStyles.breakSummaryTable} ${styles.enrollCompactTable}`}>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Department</th>
                    <th>Photos</th>
                    <th>Verification</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTableRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className={tableStyles.breakSummaryNoRecords}>
                        No employees match your search
                      </td>
                    </tr>
                  ) : (
                  filteredTableRows.map((row) => (
                    <tr
                      key={row.id}
                      className={String(row.id) === employeeId ? styles.selectedRow : undefined}
                      onClick={() => setEmployeeId(String(row.id))}
                      style={{ cursor: "pointer" }}
                    >
                      <td>{row.id}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <EmployeeTableNameCell
                          name={row.name}
                          employeeId={row.id}
                          photo={getPhoto(row.id)}
                          onOpen={() =>
                            openFromRow({
                              employee_id: row.id,
                              employee_name: row.name,
                              pseudonym: row.pseudonym,
                              department_name: row.department,
                            })
                          }
                        />
                        {row.pseudonym ? (
                          <div className={styles.empCode}>{row.pseudonym}</div>
                        ) : row.employee_code ? (
                          <div className={styles.empCode}>{row.employee_code}</div>
                        ) : null}
                      </td>
                      <td>{row.department || "—"}</td>
                      <td>
                        <span
                          className={`${styles.enrollBadge} ${
                            row.descriptor_count >= 3 ? styles.enrollReady : styles.enrollPending
                          }`}
                        >
                          {row.descriptor_count}/3
                        </span>
                      </td>
                      <td>
                        <div
                          className={styles.toggleCell}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className={`${styles.toggleBtn} ${
                              row.face_verification_enabled ? styles.toggleOn : styles.toggleOff
                            }`}
                            disabled={!globalFaceEnabled}
                            onClick={() => void handleVerificationToggle(row)}
                          >
                            {row.face_verification_enabled ? <FaToggleOn /> : <FaToggleOff />}
                          </button>
                          <span className={styles.toggleLabel}>
                            {row.face_verification_enabled ? "Active" : "Inactive"}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))
                  )}
                </tbody>
              </table>
            </div>
            </>
          )}
        </div>
      </div>
      {popup}
    </LayoutDashboard>
  );
}
