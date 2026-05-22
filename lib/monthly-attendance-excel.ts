import ExcelJS from "exceljs";

export const MONTHLY_ATTENDANCE_HEADERS = [
  "Day",
  "Date",
  "Clock In",
  "Clock Out",
  "Total W.H",
  "Assigned W.H",
  "OverTime",
  "Tardy Count",
  "Status",
  "Deduction",
] as const;

/** Light steel blue header (matches reference export) */
const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFB4C6E7" },
};

const YELLOW_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFFF00" },
};

const RED_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFC7CE" },
};

const THIN_BORDER: Partial<ExcelJS.Border> = {
  style: "thin",
  color: { argb: "FFD0D7E2" },
};

export type MonthlyAttendanceExcelRow = {
  cells: (string | number)[];
  status: string;
  isSummary?: boolean;
};

function sanitizeSheetName(name: string): string {
  const cleaned = String(name || "Employee")
    .replace(/[\\/*?:\[\]]/g, "")
    .trim();
  return (cleaned || "Employee").slice(0, 31);
}

function uniqueSheetName(base: string, used: Set<string>): string {
  let candidate = sanitizeSheetName(base);
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  const id = base.replace(/\s+/g, "").slice(0, 8);
  candidate = sanitizeSheetName(`${base.slice(0, 20)} ${id}`).slice(0, 31);
  let n = 2;
  while (used.has(candidate)) {
    candidate = sanitizeSheetName(`${base.slice(0, 18)} ${n}`).slice(0, 31);
    n += 1;
  }
  used.add(candidate);
  return candidate;
}

export function statusRowFill(status: string): ExcelJS.Fill | undefined {
  const s = String(status || "").trim();
  if (s === "Tardy") return YELLOW_FILL;
  if (s === "Half Day" || s === "Absent") return RED_FILL;
  return undefined;
}

function applyRowStyle(row: ExcelJS.Row, status: string, isSummary: boolean) {
  const fill = isSummary ? undefined : statusRowFill(status);
  row.eachCell((cell) => {
    cell.border = {
      top: THIN_BORDER,
      left: THIN_BORDER,
      bottom: THIN_BORDER,
      right: THIN_BORDER,
    };
    cell.alignment = { vertical: "middle" };
    if (fill) {
      cell.fill = fill;
    }
    if (isSummary) {
      cell.font = { bold: true };
    }
  });
}

function addEmployeeSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  dataRows: MonthlyAttendanceExcelRow[],
) {
  const sheet = workbook.addWorksheet(sheetName);

  const headerRow = sheet.addRow([...MONTHLY_ATTENDANCE_HEADERS]);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = { bold: true, color: { argb: "FF000000" }, size: 11 };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = {
      top: THIN_BORDER,
      left: THIN_BORDER,
      bottom: THIN_BORDER,
      right: THIN_BORDER,
    };
  });

  dataRows.forEach((rowData) => {
    const row = sheet.addRow(rowData.cells);
    applyRowStyle(row, rowData.status, Boolean(rowData.isSummary));
  });

  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const widths = [8, 12, 12, 12, 11, 13, 11, 11, 14, 11];
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  return sheet;
}

export async function downloadMonthlyAttendanceExcel(
  sheets: { name: string; rows: MonthlyAttendanceExcelRow[] }[],
  fileName: string,
) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Interact HRM";
  const usedNames = new Set<string>();

  sheets.forEach(({ name, rows }) => {
    const tabName = uniqueSheetName(name, usedNames);
    addEmployeeSheet(workbook, tabName, rows);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}
