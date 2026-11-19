import PresenceSilentClient from "./PresenceSilentClient";

/**
 * Server reads query so first paint is already the FaceVerify embed card —
 * avoids blank/white WebView slab while client useEffect runs.
 */
export default async function PresenceSilentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return typeof v === "string" ? v : Array.isArray(v) ? v[0] ?? "" : "";
  };

  const employeeId = (one("employeeId") || one("employee_id")).trim();
  const employeeName = one("employeeName").trim();
  const checkId = (one("checkId") || one("check_id")).trim() || null;
  const embed = one("embed") === "1";
  const warm = one("warm") === "1";

  return (
    <PresenceSilentClient
      initialEmployeeId={employeeId}
      initialEmployeeName={employeeName}
      initialCheckId={checkId}
      initialEmbed={embed}
      warmOnly={warm}
    />
  );
}
