"use client";

import React from "react";
import adminStyles from "../admin-page.module.css";
import styles from "../presence-idle/presence-idle.module.css";
import { toastError, toastSuccess } from "@/lib/app-toast";

type ProfileLite = {
  employeeId: string;
  name: string;
  pseudonym: string;
  department: string;
  health: "healthy" | "stale" | "offline";
};

type FrameMeta = {
  employeeId: string;
  updatedAt: string;
  size: number;
  name: string | null;
  pseudonym: string | null;
};

type Props = {
  profiles: ProfileLite[];
  onClose: () => void;
};

function frameUrl(employeeId: string, updatedAt: string) {
  return `/api/admin/guard-live/frame?employeeId=${encodeURIComponent(employeeId)}&v=${encodeURIComponent(updatedAt)}`;
}

/**
 * Canvas painter — never blanks the surface. New JPEG is drawn only after decode.
 * This removes the <img src> swap flash that still caused jerk after preload.
 */
function SmoothLiveCanvas({
  employeeId,
  updatedAt,
  className,
  fit = "contain",
}: {
  employeeId: string;
  updatedAt: string;
  className: string;
  fit?: "contain" | "cover";
}) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const lastAtRef = React.useRef("");
  const hasFrameRef = React.useRef(false);
  const [ready, setReady] = React.useState(false);
  const genRef = React.useRef(0);

  const paint = React.useCallback(
    (bitmap: ImageBitmap | HTMLImageElement) => {
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;
      const cssW = Math.max(1, Math.floor(wrap.clientWidth));
      const cssH = Math.max(1, Math.floor(wrap.clientHeight));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const pw = Math.max(1, Math.floor(cssW * dpr));
      const ph = Math.max(1, Math.floor(cssH * dpr));
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) return;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      // Keep previous pixels until we draw — never clear to black mid-frame.
      const iw = "width" in bitmap ? bitmap.width : (bitmap as HTMLImageElement).naturalWidth;
      const ih = "height" in bitmap ? bitmap.height : (bitmap as HTMLImageElement).naturalHeight;
      if (!iw || !ih) return;
      let dw = pw;
      let dh = ph;
      let dx = 0;
      let dy = 0;
      const scale =
        fit === "cover"
          ? Math.max(pw / iw, ph / ih)
          : Math.min(pw / iw, ph / ih);
      dw = iw * scale;
      dh = ih * scale;
      dx = (pw - dw) / 2;
      dy = (ph - dh) / 2;
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, pw, ph);
      ctx.drawImage(bitmap as CanvasImageSource, dx, dy, dw, dh);
      hasFrameRef.current = true;
      setReady(true);
    },
    [fit]
  );

  React.useEffect(() => {
    if (!updatedAt || updatedAt === lastAtRef.current) return;
    const gen = ++genRef.current;
    const url = frameUrl(employeeId, updatedAt);
    let cancelled = false;
    let objectUrl: string | null = null;

    (async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok || cancelled || gen !== genRef.current) return;
        const blob = await res.blob();
        if (cancelled || gen !== genRef.current) return;
        objectUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.decoding = "async";
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("decode"));
          img.src = objectUrl!;
        });
        if (cancelled || gen !== genRef.current) return;
        if (typeof createImageBitmap === "function") {
          try {
            const bmp = await createImageBitmap(img);
            if (cancelled || gen !== genRef.current) {
              bmp.close();
              return;
            }
            paint(bmp);
            bmp.close();
          } catch {
            paint(img);
          }
        } else {
          paint(img);
        }
        lastAtRef.current = updatedAt;
      } catch {
        /* keep last painted frame */
      } finally {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [employeeId, updatedAt, paint]);

  React.useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      // Re-paint isn't needed for size-only — next frame will fit. Avoid flicker.
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className={styles.liveCanvasWrap}>
      <canvas
        ref={canvasRef}
        className={className}
        aria-label="Live screen"
      />
      {!ready ? (
        <span className={styles.liveTileWait}>Waiting for stream…</span>
      ) : null}
    </div>
  );
}

export default function GuardLiveView({ profiles, onClose }: Props) {
  const [running, setRunning] = React.useState(false);
  const [frames, setFrames] = React.useState<Record<string, FrameMeta>>({});
  const [focusId, setFocusId] = React.useState<string | null>(null);
  const [starting, setStarting] = React.useState(false);

  const stop = React.useCallback(async () => {
    try {
      await fetch("/api/admin/guard-live", { method: "DELETE" });
    } catch {
      /* ignore */
    }
    setRunning(false);
    setFocusId(null);
  }, []);

  const start = React.useCallback(async () => {
    setStarting(true);
    try {
      const res = await fetch("/api/admin/guard-live", { method: "POST" });
      const data = await res.json();
      if (!data.success) {
        toastError(data.error || "Could not start live view");
        return;
      }
      setRunning(true);
      toastSuccess("Live view on — agents join within a few seconds");
    } catch {
      toastError("Network error starting live view");
    } finally {
      setStarting(false);
    }
  }, []);

  React.useEffect(() => {
    void start();
    return () => {
      void stop();
    };
  }, [start, stop]);

  React.useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const q = focusId
          ? `?focus=${encodeURIComponent(focusId)}`
          : "?focus=";
        const res = await fetch(`/api/admin/guard-live${q}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (cancelled) return;
        if (res.status === 401 || data.locked) {
          toastError("Gallery locked");
          onClose();
          return;
        }
        if (!data.success || !data.session?.active) {
          setRunning(false);
          return;
        }
        const nextList = (data.frames || []) as FrameMeta[];
        setFrames((prev) => {
          const next: Record<string, FrameMeta> = { ...prev };
          let changed = false;
          for (const f of nextList) {
            const old = prev[f.employeeId];
            if (!old || old.updatedAt !== f.updatedAt) {
              next[f.employeeId] = f;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      } catch {
        /* retry */
      } finally {
        if (!cancelled) {
          const delay = focusId ? 320 : 550;
          timer = setTimeout(() => void poll(), delay);
        }
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [running, focusId, onClose]);

  async function handleClose() {
    await stop();
    onClose();
  }

  const focusProfile = profiles.find((p) => p.employeeId === focusId) || null;
  const focusMeta = focusId ? frames[focusId] : null;

  return (
    <div className={styles.galleryWrap}>
      <div className={styles.detailHeader}>
        <button
          type="button"
          className={adminStyles.btnSecondary}
          onClick={() => void handleClose()}
        >
          ← Profiles
        </button>
        <div>
          <h2 className={styles.detailTitle}>Live screens</h2>
          <p className={styles.detailSub}>
            All installed agents stream here. Click a tile for a larger view.
            Needs Guard <strong>1.2.48+</strong>.
          </p>
        </div>
        <button
          type="button"
          className={adminStyles.btnSecondary}
          disabled={starting}
          onClick={() => void (running ? stop() : start())}
        >
          {starting ? "Starting…" : running ? "Pause stream" : "Resume stream"}
        </button>
      </div>

      {!running ? (
        <p className={styles.tip}>Live stream paused. Resume to watch again.</p>
      ) : (
        <div className={styles.liveGrid}>
          {profiles.map((p) => {
            const meta = frames[p.employeeId];
            return (
              <button
                key={p.employeeId}
                type="button"
                className={styles.liveTile}
                onClick={() => setFocusId(p.employeeId)}
              >
                <div className={styles.liveTileHead}>
                  <span className={styles.liveTileName}>{p.name}</span>
                  <span
                    className={
                      p.health === "healthy"
                        ? styles.healthOk
                        : p.health === "stale"
                          ? styles.healthWarn
                          : styles.healthBad
                    }
                  >
                    {p.health === "healthy"
                      ? "Online"
                      : p.health === "stale"
                        ? "Stale"
                        : "Offline"}
                  </span>
                </div>
                <div className={styles.liveTileStage}>
                  {meta ? (
                    <SmoothLiveCanvas
                      employeeId={p.employeeId}
                      updatedAt={meta.updatedAt}
                      className={styles.liveTileImg}
                    />
                  ) : (
                    <span className={styles.liveTileWait}>
                      Waiting for stream…
                    </span>
                  )}
                </div>
                {p.pseudonym || p.department ? (
                  <span className={styles.liveTileMeta}>
                    {[p.pseudonym, p.department].filter(Boolean).join(" · ")}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {focusId ? (
        <div
          className={styles.modalBackdrop}
          role="dialog"
          aria-modal="true"
          onClick={() => setFocusId(null)}
        >
          <div
            className={styles.modalPanel}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalActions}>
              <strong style={{ flex: 1, fontSize: 14 }}>
                {focusProfile?.name || `Employee ${focusId}`}
                {focusProfile?.pseudonym
                  ? ` · ${focusProfile.pseudonym}`
                  : ""}
              </strong>
              <button
                type="button"
                className={adminStyles.btnSecondary}
                onClick={() => setFocusId(null)}
              >
                Close
              </button>
            </div>
            <div className={styles.modalBody}>
              {focusMeta ? (
                <div className={styles.liveFocusStage}>
                  <SmoothLiveCanvas
                    employeeId={focusId}
                    updatedAt={focusMeta.updatedAt}
                    className={styles.liveFocusCanvas}
                  />
                </div>
              ) : (
                <p className={styles.tip}>Waiting for live frames…</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
