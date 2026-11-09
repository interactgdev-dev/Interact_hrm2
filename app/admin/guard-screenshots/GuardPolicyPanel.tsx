"use client";

import React from "react";
import adminStyles from "../admin-page.module.css";
import styles from "../presence-idle/presence-idle.module.css";
import { toastError, toastSuccess } from "@/lib/app-toast";
import GuardPolicyInbox from "./GuardPolicyInbox";

type TabId = "inbox" | "words" | "websites" | "apps" | "uploads" | "settings";

type PolicySettings = {
  enabled: boolean;
  keywords: string[];
  websites: string[];
  apps: string[];
  uploads: string[];
  dedupMinutes: number;
};

function listToText(list: string[] | undefined) {
  return Array.isArray(list) ? list.join("\n") : "";
}

type Props = {
  onBack: () => void;
};

/** Secret panel inside Guard Screenshots (unlocked gallery only). */
export default function GuardPolicyPanel({ onBack }: Props) {
  const [tab, setTab] = React.useState<TabId>("inbox");
  const [enabled, setEnabled] = React.useState(true);
  const [keywordsText, setKeywordsText] = React.useState("");
  const [websitesText, setWebsitesText] = React.useState("");
  const [appsText, setAppsText] = React.useState("");
  const [uploadsText, setUploadsText] = React.useState("");
  const [dedupMinutes, setDedupMinutes] = React.useState(60);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/guard-keyword-watch", {
        cache: "no-store",
      });
      const data = await res.json();
      if (!data.success || !data.settings) {
        toastError(data.error || "Could not load policy settings");
        return;
      }
      const s = data.settings as PolicySettings;
      setEnabled(!!s.enabled);
      setKeywordsText(listToText(s.keywords));
      setWebsitesText(listToText(s.websites));
      setAppsText(listToText(s.apps));
      setUploadsText(listToText(s.uploads));
      setDedupMinutes(
        Math.min(24 * 60, Math.max(5, Number(s.dedupMinutes) || 60))
      );
    } catch {
      toastError("Network error loading policy");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/guard-keyword-watch", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
        body: JSON.stringify({
          enabled,
          keywords: keywordsText,
          websites: websitesText,
          apps: appsText,
          uploads: uploadsText,
          dedupMinutes,
        }),
        cache: "no-store",
      });
      const data = await res.json();
      if (!data.success) {
        toastError(data.error || "Save failed");
        return;
      }
      const s = data.settings as PolicySettings;
      setEnabled(!!s.enabled);
      setKeywordsText(listToText(s.keywords));
      setWebsitesText(listToText(s.websites));
      setAppsText(listToText(s.apps));
      setUploadsText(listToText(s.uploads));
      setDedupMinutes(
        Math.min(24 * 60, Math.max(5, Number(s.dedupMinutes) || dedupMinutes))
      );
      toastSuccess(
        "Policy saved. Matches go to the secret Policy inbox only."
      );
    } catch {
      toastError("Network error saving policy");
    } finally {
      setSaving(false);
    }
  }

  const disabled = loading || saving;
  const tabs: { id: TabId; label: string }[] = [
    { id: "inbox", label: "Policy inbox" },
    { id: "words", label: "Words (OCR)" },
    { id: "websites", label: "Websites" },
    { id: "apps", label: "Apps" },
    { id: "uploads", label: "Uploads" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <div className={styles.section}>
      <div className={styles.detailHeader}>
        <button type="button" className={styles.navBackBtn} onClick={onBack}>
          ← Profiles
        </button>
        <div>
          <h2 className={styles.detailTitle}>Policy</h2>
          <p className={styles.detailSub}>
            Secret alerts for restricted words, sites, apps, uploads — not shown
            in Admin Ticket Inbox
          </p>
        </div>
      </div>

      {tab !== "inbox" ? (
        <label className={styles.toggleRow} style={{ marginBottom: 14 }}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={disabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span className={styles.toggleText}>
            <span className={styles.toggleTitle}>Enable policy alerts</span>
            <span className={styles.toggleHint}>
              Off = Image to text still works; no auto tickets.
            </span>
          </span>
        </label>
      ) : null}

      <div className={styles.chips} style={{ marginBottom: 14 }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`${styles.chip}${tab === t.id ? ` ${styles.chipActive}` : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "inbox" ? <GuardPolicyInbox /> : null}

      {tab === "words" ? (
        <div className={styles.block}>
          <h3 className={styles.blockTitle}>Restricted words / phrases</h3>
          <p className={styles.tip} style={{ marginBottom: 8 }}>
            Always checked on every Image→Text / screenshot OCR. One per line.
          </p>
          <textarea
            className={styles.scanOutput}
            rows={12}
            value={keywordsText}
            disabled={disabled}
            onChange={(e) => setKeywordsText(e.target.value)}
          />
        </div>
      ) : null}

      {tab === "websites" ? (
        <div className={styles.block}>
          <h3 className={styles.blockTitle}>Restricted websites</h3>
          <p className={styles.tip} style={{ marginBottom: 8 }}>
            Domain or URL fragment in browser titles / OCR. One per line.
          </p>
          <textarea
            className={styles.scanOutput}
            rows={12}
            value={websitesText}
            disabled={disabled}
            onChange={(e) => setWebsitesText(e.target.value)}
          />
        </div>
      ) : null}

      {tab === "apps" ? (
        <div className={styles.block}>
          <h3 className={styles.blockTitle}>Restricted apps</h3>
          <p className={styles.tip} style={{ marginBottom: 8 }}>
            App or exe name from Guard activity. One per line.
          </p>
          <textarea
            className={styles.scanOutput}
            rows={12}
            value={appsText}
            disabled={disabled}
            onChange={(e) => setAppsText(e.target.value)}
          />
        </div>
      ) : null}

      {tab === "uploads" ? (
        <div className={styles.block}>
          <h3 className={styles.blockTitle}>Restricted uploads / file actions</h3>
          <p className={styles.tip} style={{ marginBottom: 8 }}>
            Extensions or dialog phrases (.torrent, choose file). One per line.
          </p>
          <textarea
            className={styles.scanOutput}
            rows={12}
            value={uploadsText}
            disabled={disabled}
            onChange={(e) => setUploadsText(e.target.value)}
          />
        </div>
      ) : null}

      {tab === "settings" ? (
        <div className={styles.block}>
          <h3 className={styles.blockTitle}>Ticket rules</h3>
          <div className={styles.durationRow}>
            <div className={styles.field} style={{ minWidth: 200 }}>
              <label htmlFor="gp-dedup">Minutes between tickets</label>
              <input
                id="gp-dedup"
                type="number"
                min={5}
                max={1440}
                value={dedupMinutes}
                disabled={disabled}
                onChange={(e) =>
                  setDedupMinutes(
                    Math.min(1440, Math.max(5, Number(e.target.value) || 5))
                  )
                }
              />
            </div>
            <span className={styles.total}>{dedupMinutes} min</span>
          </div>
          <p className={styles.tip} style={{ marginTop: 8 }}>
            Silent alerts — only in this Policy inbox (not Admin Ticket Inbox).
          </p>
        </div>
      ) : null}

      {tab !== "inbox" ? (
        <div className={styles.actions} style={{ marginTop: 14 }}>
          <button
            type="button"
            className={adminStyles.btnPrimary}
            disabled={disabled}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : loading ? "Loading…" : "Save policy"}
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
      ) : null}
    </div>
  );
}
