export default function EmployeeDashboardLoading() {
  const panel = {
    borderRadius: 16,
    background: "#e8eaee",
    minHeight: 220,
  } as const;
  const pulse = {
    borderRadius: 14,
    background: "#e8eaee",
    minHeight: 84,
  } as const;

  return (
    <div
      style={{
        maxWidth: 1280,
        margin: "0 auto",
        padding: "8px 24px 32px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
      aria-busy
      aria-live="polite"
      aria-label="Loading dashboard"
    >
      <div style={{ height: 72, borderRadius: 14, background: "#e8eaee", maxWidth: 420 }} />
      <div style={{ display: "grid", gridTemplateColumns: "1.05fr 1fr", gap: 14 }}>
        <div style={panel} />
        <div style={panel} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
        <div style={pulse} />
        <div style={pulse} />
        <div style={pulse} />
        <div style={pulse} />
        <div style={pulse} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.1fr 1.1fr", gap: 14 }}>
        <div style={{ ...panel, minHeight: 200 }} />
        <div style={{ ...panel, minHeight: 200 }} />
        <div style={{ ...panel, minHeight: 200 }} />
      </div>
    </div>
  );
}
