export default function GenerateTicketLoading() {
  return (
    <div
      style={{
        padding: "28px 24px",
        color: "#94a3b8",
        fontSize: 14,
        fontWeight: 600,
      }}
      aria-busy
      aria-live="polite"
    >
      Loading…
    </div>
  );
}
