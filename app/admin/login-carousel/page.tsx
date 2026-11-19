"use client";

import React from "react";
import { FaImages, FaTrash, FaUpload } from "react-icons/fa";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import adminStyles from "../admin-page.module.css";
import styles from "./login-carousel.module.css";
import { toastError, toastSuccess } from "@/lib/app-toast";

type Settings = {
  enabled: boolean;
  intervalMs: number;
  animation: "fade" | "fade-zoom" | "slide";
  includeBrandSlide: boolean;
};

type Slide = {
  id: number;
  url: string;
  originalName: string | null;
  isActive: boolean;
  sortOrder: number;
  fileSize: number;
};

const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  intervalMs: 5000,
  animation: "fade",
  includeBrandSlide: true,
};

export default function LoginCarouselAdminPage() {
  const [settings, setSettings] = React.useState<Settings>(DEFAULT_SETTINGS);
  const [slides, setSlides] = React.useState<Slide[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/login-carousel", { cache: "no-store" });
      const data = await res.json();
      if (!data.success) {
        toastError(data.error || "Could not load carousel");
        return;
      }
      setSettings({
        enabled: data.settings?.enabled !== false,
        intervalMs: Number(data.settings?.intervalMs) || 5000,
        animation: data.settings?.animation || "fade",
        includeBrandSlide: data.settings?.includeBrandSlide !== false,
      });
      setSlides(Array.isArray(data.slides) ? data.slides : []);
    } catch {
      toastError("Network error loading carousel");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function saveSettings() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/login-carousel", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
        cache: "no-store",
      });
      const data = await res.json();
      if (!data.success) {
        toastError(data.error || "Save failed");
        return;
      }
      setSettings({
        enabled: data.settings.enabled !== false,
        intervalMs: Number(data.settings.intervalMs) || 5000,
        animation: data.settings.animation || "fade",
        includeBrandSlide: data.settings.includeBrandSlide !== false,
      });
      toastSuccess("Carousel settings saved");
    } catch {
      toastError("Network error saving settings");
    } finally {
      setSaving(false);
    }
  }

  async function onUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/admin/login-carousel", {
          method: "POST",
          body: fd,
        });
        const data = await res.json();
        if (!data.success) {
          toastError(data.error || `Failed: ${file.name}`);
          continue;
        }
      }
      toastSuccess("Image(s) uploaded");
      await load();
    } catch {
      toastError("Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function toggleActive(slide: Slide) {
    try {
      const res = await fetch("/api/admin/login-carousel", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: slide.id, isActive: !slide.isActive }),
      });
      const data = await res.json();
      if (!data.success) {
        toastError(data.error || "Update failed");
        return;
      }
      await load();
    } catch {
      toastError("Update failed");
    }
  }

  async function removeSlide(slide: Slide) {
    if (!window.confirm(`Delete “${slide.originalName || slide.id}”?`)) return;
    try {
      const res = await fetch(`/api/admin/login-carousel?id=${slide.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!data.success) {
        toastError(data.error || "Delete failed");
        return;
      }
      toastSuccess("Slide removed");
      await load();
    } catch {
      toastError("Delete failed");
    }
  }

  const intervalSec = Math.round((settings.intervalMs || 5000) / 1000);

  return (
    <OptionalAdminShell>
      <div className={adminStyles.page}>
        <div className={styles.wrap}>
          <header className={styles.header}>
            <div>
              <h1 className={styles.title}>
                <FaImages /> Login carousel
              </h1>
              <p className={styles.sub}>
                Upload images for the auth left panel. Welcome / Interact Global
                brand slide appears after every 3 images with smooth animation.
              </p>
            </div>
            <button
              type="button"
              className={adminStyles.btnPrimary}
              disabled={saving || loading}
              onClick={() => void saveSettings()}
            >
              {saving ? "Saving…" : "Save settings"}
            </button>
          </header>

          {loading ? (
            <p className={styles.hint}>Loading…</p>
          ) : (
            <>
              <section className={styles.card}>
                <h2 className={styles.cardTitle}>Playback</h2>
                <div className={styles.grid}>
                  <label className={styles.toggle}>
                    <input
                      type="checkbox"
                      checked={settings.enabled}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, enabled: e.target.checked }))
                      }
                    />
                    <span>Carousel enabled</span>
                  </label>
                  <label className={styles.toggle}>
                    <input
                      type="checkbox"
                      checked={settings.includeBrandSlide}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          includeBrandSlide: e.target.checked,
                        }))
                      }
                    />
                    <span>Include Welcome / Interact Global slide</span>
                  </label>
                  <div className={styles.field}>
                    <label htmlFor="anim">Animation</label>
                    <select
                      id="anim"
                      value={settings.animation}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          animation: e.target.value as Settings["animation"],
                        }))
                      }
                    >
                      <option value="fade">Smooth fade</option>
                      <option value="fade-zoom">Fade + soft zoom</option>
                      <option value="slide">Slide</option>
                    </select>
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="speed">
                      Speed ({intervalSec}s between slides)
                    </label>
                    <input
                      id="speed"
                      type="range"
                      min={2}
                      max={15}
                      step={1}
                      value={intervalSec}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          intervalMs: Number(e.target.value) * 1000,
                        }))
                      }
                    />
                  </div>
                </div>
              </section>

              <section className={styles.card}>
                <div className={styles.cardHead}>
                  <h2 className={styles.cardTitle}>Images</h2>
                  <button
                    type="button"
                    className={adminStyles.btnSecondary}
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                  >
                    <FaUpload /> {uploading ? "Uploading…" : "Upload images"}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    hidden
                    onChange={(e) => void onUpload(e.target.files)}
                  />
                </div>
                <p className={styles.hint}>
                  PNG / JPG / WEBP · max 12 MB each · full photo visible (contain)
                  with soft blurred edge fill (no hard white/black bars).
                </p>
                {slides.length === 0 ? (
                  <p className={styles.empty}>No images yet — brand slide alone will show.</p>
                ) : (
                  <ul className={styles.slideList}>
                    {slides.map((slide) => (
                      <li key={slide.id} className={styles.slideRow}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={slide.url} alt="" className={styles.thumb} />
                        <div className={styles.slideMeta}>
                          <strong>{slide.originalName || `Slide #${slide.id}`}</strong>
                          <span>
                            {(slide.fileSize / 1024).toFixed(0)} KB ·{" "}
                            {slide.isActive ? "Active" : "Hidden"}
                          </span>
                        </div>
                        <button
                          type="button"
                          className={styles.chip}
                          onClick={() => void toggleActive(slide)}
                        >
                          {slide.isActive ? "Hide" : "Show"}
                        </button>
                        <button
                          type="button"
                          className={styles.danger}
                          title="Delete"
                          onClick={() => void removeSlide(slide)}
                        >
                          <FaTrash />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </OptionalAdminShell>
  );
}
