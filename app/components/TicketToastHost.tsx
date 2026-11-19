"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { FaTicketAlt } from "react-icons/fa";
import { categoryLabel, ticketTypeLabel } from "../../lib/ticket-catalog";
import { lookupEmployeeDirectory } from "../../lib/employee-directory-client-cache";
import { employeeInitials } from "../../lib/employee-photo-shared";
import {
  DEMO_TICKET_TOAST,
  DEMO_TICKET_TOAST_EVENT,
  type TicketToastPayload,
} from "../../lib/ticket-toast-demo";
import {
  demoTicketEmployeeContext,
  resolveTicketToastPhoto,
} from "../../lib/ticket-toast-photo";
import {
  shouldShowTicketCreated,
  shouldShowTicketUpdate,
  ticketToastTarget,
  wsTicketToToastPayload,
} from "../../lib/ticket-toast-routing";
import { playTicketSound, warmTicketSound } from "../../lib/ticket-toast-sound";
import { EmployeeAvatar } from "./EmployeeAvatar";
import styles from "./admin-ticket-toast.module.css";

type ToastItem = TicketToastPayload & { key: string };

async function enrichToastPayload(ticket: TicketToastPayload): Promise<TicketToastPayload> {
  const ids = [
    ticket.employee_id,
    typeof window !== "undefined" ? localStorage.getItem("employeeId") : null,
    typeof window !== "undefined" ? localStorage.getItem("loginId") : null,
  ]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);

  let entry = await lookupEmployeeDirectory(ticket.employee_id, ticket.employee_name);
  if (!entry?.pseudonym) {
    for (const id of ids) {
      if (id === ticket.employee_id) continue;
      const match = await lookupEmployeeDirectory(id, ticket.employee_name);
      if (match?.pseudonym) {
        entry = match;
        break;
      }
    }
  }

  const photo = await resolveTicketToastPhoto(ticket.employee_id, ticket.employee_photo);
  return {
    ...ticket,
    employee_pseudonym:
      entry?.pseudonym?.trim() || ticket.employee_pseudonym?.trim() || null,
    employee_photo: photo ?? ticket.employee_photo ?? null,
  };
}

export function TicketToastHost() {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  const pushToast = React.useCallback((ticket: TicketToastPayload) => {
    const { _skipSound, ...toastData } = ticket;

    void (async () => {
      if (!_skipSound) await playTicketSound();
      const key = `${toastData.kind ?? "created"}-${toastData.id}-${Date.now()}`;
      setToasts((prev) => [{ ...toastData, key }, ...prev].slice(0, 4));
      void enrichToastPayload(toastData).then((enriched) => {
        setToasts((prev) =>
          prev.map((item) => (item.key === key ? { ...item, ...enriched } : item))
        );
      });
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.key !== key));
      }, 9000);
    })();
  }, []);

  React.useEffect(() => {
    warmTicketSound();
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("demoTicketToast") !== "1") return;

    const searchAtFire = window.location.search;
    const w = window as typeof window & { __hrmDemoToastGuard?: string };
    if (w.__hrmDemoToastGuard === searchAtFire) return;
    w.__hrmDemoToastGuard = searchAtFire;

    pushToast({
      ...DEMO_TICKET_TOAST,
      ...demoTicketEmployeeContext(),
    });

    params.delete("demoTicketToast");
    const qs = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`
    );

    window.setTimeout(() => {
      if (w.__hrmDemoToastGuard === searchAtFire) w.__hrmDemoToastGuard = undefined;
    }, 2000);
  }, [pathname, pushToast]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    const onDemo = (evt: Event) => {
      const detail = (evt as CustomEvent<TicketToastPayload>).detail;
      pushToast({
        ...DEMO_TICKET_TOAST,
        ...demoTicketEmployeeContext(),
        ...detail,
      });
    };
    window.addEventListener(DEMO_TICKET_TOAST_EVENT, onDemo);

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closedByUnmount = false;

    const handleWsMessage = (evt: MessageEvent) => {
      try {
        const msg = JSON.parse(evt.data.toString());
        const path = window.location.pathname || "/";

        // Guard policy alerts are inbox-only (silent: true).
        if (msg?.silent) return;

        if (msg?.type === "ticket_created" && msg?.ticket) {
          const payload = wsTicketToToastPayload(msg.ticket, "created");
          if (payload && shouldShowTicketCreated(path)) pushToast(payload);
        }

        if (msg?.type === "ticket_update" && msg?.ticket) {
          const payload = wsTicketToToastPayload(msg.ticket, "updated");
          if (payload && shouldShowTicketUpdate(path, payload.employee_id)) {
            pushToast(payload);
          }
        }
      } catch {
        /* ignore */
      }
    };

    const connectWs = () => {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${protocol}://${window.location.host}/api/ws`);
      ws.onmessage = handleWsMessage;
      ws.onerror = () => ws?.close();
      ws.onclose = () => {
        ws = null;
        if (!closedByUnmount) reconnectTimer = setTimeout(connectWs, 3000);
      };
    };

    connectWs();

    return () => {
      closedByUnmount = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      window.removeEventListener(DEMO_TICKET_TOAST_EVENT, onDemo);
      ws?.close();
    };
  }, [pushToast]);

  const dismiss = (key: string) => {
    setToasts((prev) => prev.filter((t) => t.key !== key));
  };

  if (toasts.length === 0) return null;

  return (
    <div className={styles.toastStack} aria-live="polite">
      {toasts.map((t) => {
        const isUpdate = t.kind === "updated";
        const title = t.subject || (isUpdate ? "Your ticket was updated" : "New support request");
        const target = ticketToastTarget(pathname, t.id);

        return (
          <div
            key={t.key}
            className={styles.toast}
            role="button"
            tabIndex={0}
            onClick={() => router.push(target)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") router.push(target);
            }}
          >
            <EmployeeAvatar
              className={styles.toastAvatar}
              name={t.employee_name}
              initials={employeeInitials(t.employee_name)}
              photo={t.employee_photo}
              size="lg"
              ring="purple"
            />
            <div className={styles.toastBody}>
              <div className={styles.toastHeader}>
                <span className={styles.toastBadge}>
                  <FaTicketAlt aria-hidden />
                  {isUpdate ? "Ticket update" : "New ticket"}
                </span>
                <span className={styles.toastNumber}>{t.ticket_number}</span>
              </div>
              <div className={styles.toastTitle}>{title}</div>
              {isUpdate && t.preview ? (
                <div className={styles.toastPreview}>{t.preview}</div>
              ) : null}
              <div className={styles.toastNameBlock}>
                <div className={styles.toastNameRow}>
                  <span className={styles.toastEmployeeName}>{t.employee_name}</span>
                  {t.employee_pseudonym ? (
                    <span className={styles.toastPseudonym}>{t.employee_pseudonym}</span>
                  ) : null}
                </div>
              </div>
              <div className={styles.toastMeta}>
                <span className={styles.toastChip}>{categoryLabel(t.category)}</span>
                <span className={styles.toastDot} aria-hidden>·</span>
                {ticketTypeLabel(t.category, t.ticket_type)}
              </div>
            </div>
            <button
              type="button"
              className={styles.toastClose}
              aria-label="Dismiss"
              onClick={(e) => {
                e.stopPropagation();
                dismiss(t.key);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

export const AdminTicketToastHost = TicketToastHost;
