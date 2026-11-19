export function ManualStatusBadge({
  title = "Manual status — set by admin",
}: {
  title?: string;
}) {
  return (
    <span
      title={title}
      aria-label={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        marginLeft: 6,
        minWidth: 18,
        height: 18,
        padding: "0 4px",
        borderRadius: 4,
        background: "#2b6cb0",
        color: "#fff",
        fontSize: "0.68rem",
        fontWeight: 800,
        lineHeight: 1,
        verticalAlign: "middle",
        boxShadow: "0 1px 3px rgba(43,108,176,0.35)",
      }}
    >
      M
    </span>
  );
}
