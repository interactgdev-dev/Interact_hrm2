import ExcelJS from "exceljs";
import { isAbsentOrHalfDayStatus, isTardyStatus, normalizeAttendanceStatus } from "./attendance-status";
import { sanitizeSheetName } from "./monthly-attendance-excel";

export const DEDUCTION_SUMMARY_HEADERS = [
  "Date",
  "T.Punch in",
  "Clock In",
  "Clock Out",
  "T.Punch out",
  "Total Working Hours",
  "Status",
  "Tardy Count",
  "Tardy Note",
  "Deduction",
] as const;

const COL_COUNT = DEDUCTION_SUMMARY_HEADERS.length;

const YELLOW_EMPLOYEE_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFFF00" },
};

const BLUE_TITLE_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F4E79" },
};

const GREY_HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD9D9D9" },
};

const BLACK_BORDER: Partial<ExcelJS.Border> = {
  style: "thin",
  color: { argb: "FF000000" },
};

const RED_BOLD_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFC00000" },
  size: 11,
};

const TARDY_ROW_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFFF00" },
};

const COLUMN_WIDTHS = [14, 14, 14, 14, 14, 18, 18, 12, 28, 12];

export type DeductionSummaryDayRow = {
  date: string;
  tPunchIn: string;
  clockIn: string;
  clockOut: string;
  tPunchOut: string;
  totalWorkingHours: string;
  status: string;
  tardyCount: number | string;
  tardyNote: string;
  deduction: string;
};

export type DeductionSummaryEmployeeBlock = {
  employeeName: string;
  rows: DeductionSummaryDayRow[];
  totalDeduction: number;
};

function applyBlackBorder(cell: ExcelJS.Cell) {
  cell.border = {
    top: BLACK_BORDER,
    left: BLACK_BORDER,
    bottom: BLACK_BORDER,
    right: BLACK_BORDER,
  };
}

function addMergedBannerRow(
  sheet: ExcelJS.Worksheet,
  text: string,
  fill: ExcelJS.Fill,
  font: Partial<ExcelJS.Font>,
  height: number,
) {
  const row = sheet.addRow([text]);
  const rowNumber = row.number;
  sheet.mergeCells(rowNumber, 1, rowNumber, COL_COUNT);
  const cell = sheet.getCell(rowNumber, 1);
  cell.value = text;
  cell.fill = fill;
  cell.font = font;
  cell.alignment = { horizontal: "center", vertical: "middle" };
  row.height = height;
  for (let c = 1; c <= COL_COUNT; c += 1) {
    applyBlackBorder(sheet.getCell(rowNumber, c));
  }
}

/** Append one employee's deduction block (banner → header → rows → total) to a sheet. */
function appendEmployeeBlock(
  sheet: ExcelJS.Worksheet,
  block: DeductionSummaryEmployeeBlock,
) {
  addMergedBannerRow(sheet, block.employeeName, YELLOW_EMPLOYEE_FILL, {
    bold: true,
    color: { argb: "FF000000" },
    size: 12,
  }, 24);

  addMergedBannerRow(sheet, "Deduction Summary", BLUE_TITLE_FILL, {
    bold: true,
    color: { argb: "FFFFFFFF" },
    size: 11,
  }, 22);

  const headerRow = sheet.addRow([...DEDUCTION_SUMMARY_HEADERS]);
  headerRow.height = 20;
  headerRow.eachCell((cell) => {
    cell.fill = GREY_HEADER_FILL;
    cell.font = { bold: true, color: { argb: "FF000000" }, size: 11 };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    applyBlackBorder(cell);
  });

  block.rows.forEach((row) => {
    const status = normalizeAttendanceStatus(row.status);
    const dataRow = sheet.addRow([
      row.date,
      row.tPunchIn,
      row.clockIn,
      row.clockOut,
      row.tPunchOut,
      row.totalWorkingHours || "--",
      status,
      row.tardyCount === 0 || row.tardyCount === "" ? "" : row.tardyCount,
      row.tardyNote || "",
      row.deduction,
    ]);
    const tardyRow = isTardyStatus(status);
    const absentOrHalfRow = isAbsentOrHalfDayStatus(status);
    dataRow.eachCell((cell, colNumber) => {
      cell.alignment = { horizontal: "center", vertical: "middle" };
      applyBlackBorder(cell);
      if (tardyRow) {
        cell.fill = TARDY_ROW_FILL;
      } else if (absentOrHalfRow) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFC7CE" },
        };
      }
      if (colNumber === COL_COUNT) {
        cell.font = RED_BOLD_FONT;
      }
    });
  });

  const totalRow = sheet.addRow([
    ...Array(COL_COUNT - 2).fill(""),
    "Total",
    `${block.totalDeduction}%`,
  ]);
  totalRow.eachCell((cell, colNumber) => {
    cell.alignment = { horizontal: "center", vertical: "middle" };
    applyBlackBorder(cell);
    if (colNumber === COL_COUNT - 1 || colNumber === COL_COUNT) {
      cell.font = RED_BOLD_FONT;
    }
  });
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

export async function downloadDeductionSummaryExcel(
  blocks: DeductionSummaryEmployeeBlock[],
  fileName: string,
) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Interact HRM";
  const usedNames = new Set<string>();

  const exportBlocks = blocks.length
    ? blocks
    : [{ employeeName: "No employees", rows: [], totalDeduction: 0 }];

  // One sheet tab per employee (pseudo name when assigned) — matches attendance export.
  exportBlocks.forEach((block) => {
    const sheet = workbook.addWorksheet(
      uniqueSheetName(block.employeeName || "Employee", usedNames),
    );
    appendEmployeeBlock(sheet, block);
    COLUMN_WIDTHS.forEach((w, i) => {
      sheet.getColumn(i + 1).width = w;
    });
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

export function parseDeductionPercent(deduction: string): number {
  if (!deduction || !String(deduction).endsWith("%")) return 0;
  const n = parseFloat(String(deduction).replace("%", ""));
  return Number.isNaN(n) ? 0 : n;
}
