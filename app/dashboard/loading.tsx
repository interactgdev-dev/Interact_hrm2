export default function DashboardLoading() {
  const panel = {
    borderRadius: 16,
    background: "#e8eaee",
    minHeight: 180,
  } as const;
  return (
    <div
      style={{
        maxWidth: 1280,
        margin: "0 auto",
        padding: "16px 24px 32px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
      aria-busy
      aria-live="polite"
      aria-label="Loading dashboard"
    >
      <div style={{ height: 64, borderRadius: 14, background: "#e8eaee", maxWidth: 360 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <div style={{ ...panel, minHeight: 96 }} />
        <div style={{ ...panel, minHeight: 96 }} />
        <div style={{ ...panel, minHeight: 96 }} />
        <div style={{ ...panel, minHeight: 96 }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 14 }}>
        <div style={panel} />
        <div style={panel} />
      </div>
    </div>
  );
}
