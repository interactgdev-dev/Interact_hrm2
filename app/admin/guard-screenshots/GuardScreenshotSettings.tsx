"use client";

import React from "react";
import adminStyles from "../admin-page.module.css";
import styles from "../presence-idle/presence-idle.module.css";
import { toastError, toastSuccess } from "@/lib/app-toast";

function splitSeconds(total: number) {
  const safe = Math.max(0, Math.floor(total || 0));
  return { minutes: Math.floor(safe / 60), seconds: safe % 60 };
}

function combineSeconds(minutes: number, seconds: number) {
  return (
    Math.max(0, Math.floor(Number(minutes) || 0)) * 60 +
    Math.max(0, Math.floor(Number(seconds) || 0))
  );
}

function formatDuration(totalSeconds: number) {
  const { minutes, seconds } = splitSeconds(totalSeconds);
  if (minutes <= 0) return `${seconds} sec`;
  if (seconds === 0) return `${minutes} min`;
  return `${minutes} min ${seconds} sec`;
}

type QualityPreset = {
  id: string;
  label: string;
  hint: string;
  quality: number;
  scale: number;
};

const QUALITY_PRESETS: QualityPreset[] = [
  {
    id: "high",
    label: "High",
    hint: "Best clarity · larger uploads (avoid with 100+ PCs)",
    quality: 70,
    scale: 80,
  },
  {
    id: "medium",
    label: "Medium",
    hint: "Balanced · use if few PCs online",
    quality: 45,
    scale: 50,
  },
  {
    id: "low",
    label: "Low",
    hint: "Recommended · smallest files · avoids 502 under load",
    quality: 35,
    scale: 40,
  },
];

function matchPreset(quality: number, scale: number): string | "custom" {
  const hit = QUALITY_PRESETS.find((p) => p.quality === quality && p.scale === scale);
  return hit?.id ?? "custom";
}

/**
 * Auto screenshot enable + interval + image quality — gallery page only.
 * Does not touch Presence Idle / face-verify settings.
 */
export default function GuardScreenshotSettings() {
  const [enabled, setEnabled] = React.useState(false);
  const [minutes, setMinutes] = React.useState(5);
  const [seconds, setSeconds] = React.useState(0);
  const [jpegQuality, setJpegQuality] = React.useState(55);
  const [scalePercent, setScalePercent] = React.useState(70);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const total = combineSeconds(minutes, seconds);
  const presetId = matchPreset(jpegQuality, scalePercent);

  const applyInterval = React.useCallback((totalSeconds: number) => {
    const parts = splitSeconds(Math.max(5, totalSeconds));
    setMinutes(parts.minutes);
    setSeconds(parts.seconds);
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/presence-settings", { cache: "no-store" });
      const data = await res.json();
      if (!data.success || !data.settings) {
        toastError(data.error || "Could not load screenshot settings");
        return;
      }
      setEnabled(!!data.settings.screenshotCaptureEnabled);
      applyInterval(data.settings.screenshotIntervalSeconds ?? 300);
      setJpegQuality(
        Math.min(95, Math.max(10, Number(data.settings.screenshotJpegQuality) || 55))
      );
      setScalePercent(
        Math.min(100, Math.max(25, Number(data.settings.screenshotScalePercent) || 70))
      );
    } catch {
      toastError("Network error loading screenshot settings");
    } finally {
      setLoading(false);
    }
  }, [applyInterval]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/presence-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        body: JSON.stringify({
          screenshotCaptureEnabled: enabled,
          screenshotIntervalSeconds: Math.min(3600, Math.max(5, total || 5)),
          screenshotJpegQuality: Math.min(95, Math.max(10, jpegQuality || 55)),
          screenshotScalePercent: Math.min(100, Math.max(25, scalePercent || 70)),
        }),
        cache: "no-store",
      });
      const data = await res.json();
      if (!data.success) {
        toastError(data.error || "Save failed");
        return;
      }
      setEnabled(!!data.settings?.screenshotCaptureEnabled);
      applyInterval(data.settings?.screenshotIntervalSeconds ?? total);
      setJpegQuality(
        Math.min(95, Math.max(10, Number(data.settings?.screenshotJpegQuality) || jpegQuality))
      );
      setScalePercent(
        Math.min(100, Math.max(25, Number(data.settings?.screenshotScalePercent) || scalePercent))
      );
      toastSuccess("Screenshot settings saved. Agents pick up within a few seconds.");
    } catch {
      toastError("Network error saving screenshot settings");
    } finally {
      setSaving(false);
    }
  }

  const presets = [180, 300, 600];
  const disabled = loading || saving;

  return (
    <div className={styles.section} style={{ marginBottom: 16 }}>
      <h2 className={styles.blockTitle} style={{ marginBottom: 10 }}>
        Capture settings
      </h2>

      <label className={styles.toggleRow}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span className={styles.toggleText}>
          <span className={styles.toggleTitle}>Auto screenshots (Interact Guard)</span>
          <span className={styles.toggleHint}>
            When on, each PC uploads in its own time-slot (not all at once).
            Images stay in memory only — never kept on the PC after upload.
            Prefer Low + 5 min when many agents are online.
          </span>
        </span>
      </label>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>Auto screenshot interval</h3>
        <div className={styles.durationRow}>
          <div className={styles.field}>
            <label htmlFor="shot-gallery-min">Minutes</label>
            <input
              id="shot-gallery-min"
              type="number"
              min={0}
              max={60}
              value={minutes}
              disabled={disabled || !enabled}
              onChange={(e) => setMinutes(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="shot-gallery-sec">Seconds</label>
            <input
              id="shot-gallery-sec"
              type="number"
              min={0}
              max={59}
              value={seconds}
              disabled={disabled || !enabled}
              onChange={(e) =>
                setSeconds(Math.min(59, Math.max(0, Number(e.target.value) || 0)))
              }
            />
          </div>
          <span className={styles.total}>{formatDuration(Math.max(5, total))}</span>
        </div>
        <div className={styles.chips} style={{ marginTop: 8 }}>
          {presets.map((sec) => (
            <button
              key={sec}
              type="button"
              className={`${styles.chip}${Math.max(5, total) === sec ? ` ${styles.chipActive}` : ""}`}
              disabled={disabled || !enabled}
              onClick={() => applyInterval(sec)}
            >
              {formatDuration(sec)}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>Image quality</h3>
        <p className={styles.tip} style={{ marginBottom: 8 }}>
          Files stay on the server only. Medium/Low keeps HRM stable with many
          agents. Needs Guard <strong>1.2.59+</strong>.
        </p>
        <div className={styles.chips}>
          {QUALITY_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`${styles.chip}${presetId === p.id ? ` ${styles.chipActive}` : ""}`}
              disabled={disabled || !enabled}
              title={p.hint}
              onClick={() => {
                setJpegQuality(p.quality);
                setScalePercent(p.scale);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        {presetId === "custom" ? (
          <p className={styles.tip} style={{ marginTop: 8 }}>
            Current saved values do not match a preset. Pick Low, Medium, or High,
            then save.
          </p>
        ) : (
          <p className={styles.tip} style={{ marginTop: 8 }}>
            {QUALITY_PRESETS.find((p) => p.id === presetId)?.hint}
          </p>
        )}
      </div>

      <div className={styles.actions} style={{ marginTop: 10 }}>
        <button
          type="button"
          className={adminStyles.btnPrimary}
          disabled={disabled}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : loading ? "Loading…" : "Save screenshot settings"}
        </button>
        <button
          type="button"
          className={adminStyles.btnSecondary}
          disabled={disabled}
          onClick={() => void load()}
        >
          Reload
        </button>
      </div>
    </div>
  );
}
