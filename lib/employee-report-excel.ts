import ExcelJS from "exceljs";

export const EMPLOYEE_REPORT_HEADERS = [
  "Date",
  "Employee Name",
  "Tungsten Punch In",
  "HRM Clock In",
  "HRM Clock Out",
  "Tungsten Punch Out",
  "Department",
] as const;

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFB4C6E7" },
};

const ROW_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF8FAFC" },
};

const THIN_BORDER: Partial<ExcelJS.Border> = {
  style: "thin",
  color: { argb: "FFD0D7E2" },
};

export type EmployeeReportExcelRow = {
  cells: (string | number)[];
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
  let n = 2;
  while (used.has(candidate)) {
    candidate = sanitizeSheetName(`${base.slice(0, 18)} ${n}`).slice(0, 31);
    n += 1;
  }
  used.add(candidate);
  return candidate;
}

function addEmployeeSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  dataRows: EmployeeReportExcelRow[],
) {
  const sheet = workbook.addWorksheet(sheetName);

  const headerRow = sheet.addRow([...EMPLOYEE_REPORT_HEADERS]);
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
    row.eachCell((cell) => {
      cell.fill = ROW_FILL;
      cell.border = {
        top: THIN_BORDER,
        left: THIN_BORDER,
        bottom: THIN_BORDER,
        right: THIN_BORDER,
      };
      cell.alignment = { vertical: "middle" };
    });
  });

  sheet.views = [{ state: "frozen", ySplit: 1 }];
  const widths = [12, 24, 16, 14, 14, 16, 14];
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
}

export async function downloadEmployeeReportExcel(
  sheets: { name: string; rows: EmployeeReportExcelRow[] }[],
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
  const downloadName = fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`;
  try {
    const { reportClientFileDownload } = await import(
      "@/lib/client-activity-download"
    );
    reportClientFileDownload(blob, downloadName, {
      detail: `Downloaded "${downloadName}" via employee report export (${blob.size} B)`,
    });
  } catch {
    /* ignore */
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = downloadName;
  link.click();
  URL.revokeObjectURL(url);
}
