/** Instant route fallback while the next page chunk loads (same idea as employee-dashboard). */
export default function RouteLoading({ label = "Loading…" }: { label?: string }) {
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
      aria-label={label}
    >
      {label}
    </div>
  );
}
