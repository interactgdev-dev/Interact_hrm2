import type { TicketThreadMessage } from "@/lib/ticket-thread";
import styles from "./TicketThread.module.css";

type Props = {
  messages: TicketThreadMessage[];
  compact?: boolean;
};

export default function TicketThread({ messages, compact = false }: Props) {
  if (!messages.length) return null;

  return (
    <div className={`${styles.thread} ${compact ? styles.threadCompact : ""}`}>
      {messages.map((m) => (
        <div
          key={m.id}
          className={`${styles.row} ${m.role === "admin" ? styles.rowAdmin : styles.rowEmployee}`}
        >
          <div
            className={`${styles.bubble} ${m.role === "admin" ? styles.bubbleAdmin : styles.bubbleEmployee}`}
          >
            <div className={styles.bubbleHead}>
              <span className={styles.author}>{m.author}</span>
              <span className={styles.time}>{new Date(m.created_at).toLocaleString()}</span>
            </div>
            <p className={styles.body}>{m.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
