import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../lib/db";
import ExcelJS from "exceljs";
import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";

type RowResult = {
  row: number;
  status: "inserted" | "updated" | "skipped" | "failed";
  reason?: string;
  employeeId?: number;
};

type TemplateCol = {
  header: string;
  field: string;
  required?: boolean;
  group: string;
  width?: number;
  list?: string[];
  date?: boolean;
};

const MATCH_GROUP = "MATCH KEYS — keep ID when updating";
const PERSONAL_GROUP = "PERSONAL DETAILS — required";
const CONTACT_GROUP = "CONTACT DETAILS";
const EMERGENCY_GROUP = "EMERGENCY CONTACTS";
const JOB_GROUP = "JOB DETAILS";
const ALLOWANCE_GROUP = "ALLOWANCES";
const SALARY_GROUP = "SALARY";

const TEMPLATE_COLUMNS: TemplateCol[] = [
  { header: "Employee ID", field: "id", group: MATCH_GROUP, width: 12 },
  { header: "Employee Code", field: "employee_code", group: MATCH_GROUP, width: 16 },
  { header: "First Name *", field: "first_name", required: true, group: PERSONAL_GROUP, width: 16 },
  { header: "Last Name *", field: "last_name", required: true, group: PERSONAL_GROUP, width: 16 },
  { header: "Father Name *", field: "father_name", required: true, group: PERSONAL_GROUP, width: 18 },
  { header: "Pseudo Name *", field: "pseudonym", required: true, group: PERSONAL_GROUP, width: 16 },
  { header: "Date of Birth *", field: "dob", required: true, group: PERSONAL_GROUP, width: 16, date: true },
  {
    header: "Gender *",
    field: "gender",
    required: true,
    group: PERSONAL_GROUP,
    width: 12,
    list: ["male", "female", "other"],
  },
  {
    header: "Marital Status *",
    field: "marital_status",
    required: true,
    group: PERSONAL_GROUP,
    width: 16,
    list: ["single", "married", "other"],
  },
  { header: "Nationality *", field: "nationality", required: true, group: PERSONAL_GROUP, width: 14 },
  {
    header: "Blood Group *",
    field: "blood_group",
    required: true,
    group: PERSONAL_GROUP,
    width: 14,
    list: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
  },
  { header: "CNIC Number *", field: "cnic_number", required: true, group: PERSONAL_GROUP, width: 18 },
  { header: "CNIC Issuance Date *", field: "cnic_issuance_date", required: true, group: PERSONAL_GROUP, width: 20, date: true },
  { header: "CNIC Expiry Date *", field: "cnic_expiry_date", required: true, group: PERSONAL_GROUP, width: 20, date: true },
  {
    header: "Employment Status *",
    field: "employment_status",
    required: true,
    group: PERSONAL_GROUP,
    width: 20,
    list: ["Probation", "Permanent"],
  },
  {
    header: "Employment Type *",
    field: "employment_type",
    required: true,
    group: PERSONAL_GROUP,
    width: 18,
    list: ["Full Time", "Part Time"],
  },
  { header: "Working Hours", field: "working_hours", group: PERSONAL_GROUP, width: 16 },
  {
    header: "Role *",
    field: "role",
    required: true,
    group: PERSONAL_GROUP,
    width: 14,
    list: ["BOD/CEO", "HOD", "Management", "Leader", "Officer"],
  },
  { header: "Username", field: "username", group: PERSONAL_GROUP, width: 14 },
  { header: "Password", field: "password", group: PERSONAL_GROUP, width: 14 },
  {
    header: "Status",
    field: "status",
    group: PERSONAL_GROUP,
    width: 14,
    list: ["active", "disabled"],
  },
  { header: "Present Street", field: "street1", group: CONTACT_GROUP, width: 22 },
  { header: "Present City", field: "city", group: CONTACT_GROUP, width: 14 },
  { header: "Present State", field: "state", group: CONTACT_GROUP, width: 14 },
  { header: "Present ZIP", field: "zip", group: CONTACT_GROUP, width: 12 },
  { header: "Present Country", field: "country", group: CONTACT_GROUP, width: 16 },
  { header: "Permanent Street", field: "permanent_street", group: CONTACT_GROUP, width: 22 },
  { header: "Permanent City", field: "permanent_city", group: CONTACT_GROUP, width: 14 },
  { header: "Permanent State", field: "permanent_state", group: CONTACT_GROUP, width: 14 },
  { header: "Permanent ZIP", field: "permanent_zip", group: CONTACT_GROUP, width: 12 },
  { header: "Permanent Country", field: "permanent_country", group: CONTACT_GROUP, width: 16 },
  { header: "Mobile", field: "phone_mobile", group: CONTACT_GROUP, width: 14 },
  { header: "Work Phone", field: "phone_work", group: CONTACT_GROUP, width: 14 },
  { header: "Work Email", field: "email_work", group: CONTACT_GROUP, width: 22 },
  { header: "Personal Email", field: "email_other", group: CONTACT_GROUP, width: 22 },
  { header: "Emergency 1 Name", field: "emergency1_name", group: EMERGENCY_GROUP, width: 18 },
  { header: "Emergency 1 Relation", field: "emergency1_relation", group: EMERGENCY_GROUP, width: 18 },
  { header: "Emergency 1 Phone", field: "emergency1_phone", group: EMERGENCY_GROUP, width: 16 },
  { header: "Emergency 2 Name", field: "emergency2_name", group: EMERGENCY_GROUP, width: 18 },
  { header: "Emergency 2 Relation", field: "emergency2_relation", group: EMERGENCY_GROUP, width: 18 },
  { header: "Emergency 2 Phone", field: "emergency2_phone", group: EMERGENCY_GROUP, width: 16 },
  { header: "Date of Joining", field: "joined_date", group: JOB_GROUP, width: 16, date: true },
  { header: "Job Title", field: "job_title", group: JOB_GROUP, width: 18 },
  { header: "Job Specification", field: "job_specification", group: JOB_GROUP, width: 20 },
  { header: "Department", field: "department", group: JOB_GROUP, width: 18 },
  { header: "Location", field: "location", group: JOB_GROUP, width: 16 },
  { header: "Fuel Allowance", field: "fuel_allowance", group: ALLOWANCE_GROUP, width: 16 },
  { header: "CT Deduction", field: "company_transport_deduction", group: ALLOWANCE_GROUP, width: 16 },
  {
    header: "Pay Frequency",
    field: "salary_frequency",
    group: SALARY_GROUP,
    width: 14,
    list: ["Monthly", "Weekly", "Yearly"],
  },
  {
    header: "Currency",
    field: "salary_currency",
    group: SALARY_GROUP,
    width: 12,
    list: ["PKR", "USD", "INR", "AED"],
  },
  { header: "Salary Amount", field: "salary_amount", group: SALARY_GROUP, width: 14 },
  { header: "Salary Comments", field: "salary_comments", group: SALARY_GROUP, width: 20 },
  { header: "Bank Name", field: "routing_number", group: SALARY_GROUP, width: 18 },
  { header: "Account Number", field: "account_number", group: SALARY_GROUP, width: 20 },
];

const REQUIRED_PERSONAL_FIELDS = TEMPLATE_COLUMNS.filter((c) => c.required).map((c) => c.field);

function nz(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const HEADER_MAP: Record<string, string> = {
  firstname: "first_name",
  lastname: "last_name",
  surname: "last_name",
  fathername: "father_name",
  pseudonym: "pseudonym",
  pseudoname: "pseudonym",
  middlename: "pseudonym",
  employeecode: "employee_code",
  employeeid: "id",
  empid: "id",
  id: "id",
  dob: "dob",
  dateofbirth: "dob",
  gender: "gender",
  maritalstatus: "marital_status",
  nationality: "nationality",
  bloodgroup: "blood_group",
  cnic: "cnic_number",
  cnicnumber: "cnic_number",
  cnicissuancedate: "cnic_issuance_date",
  dateofissuance: "cnic_issuance_date",
  cnicexpirydate: "cnic_expiry_date",
  dateofexpiryoofcnic: "cnic_expiry_date",
  dateofexpirycnic: "cnic_expiry_date",
  employmentstatus: "employment_status",
  employmenttype: "employment_type",
  workinghours: "working_hours",
  username: "username",
  password: "password",
  status: "status",
  role: "role",
  designation: "job_title",
  presentstreet: "street1",
  street: "street1",
  street1: "street1",
  address: "street1",
  presentcity: "city",
  city: "city",
  presentstate: "state",
  state: "state",
  presentzip: "zip",
  zip: "zip",
  presentcountry: "country",
  country: "country",
  permanentstreet: "permanent_street",
  permanentcity: "permanent_city",
  permanentstate: "permanent_state",
  permanentzip: "permanent_zip",
  permanentcountry: "permanent_country",
  mobile: "phone_mobile",
  phone: "phone_mobile",
  phonemobile: "phone_mobile",
  workphone: "phone_work",
  workemail: "email_work",
  emailwork: "email_work",
  personalemail: "email_other",
  emailother: "email_other",
  emergency1name: "emergency1_name",
  emergency1relation: "emergency1_relation",
  emergency1phone: "emergency1_phone",
  emergency2name: "emergency2_name",
  emergency2relation: "emergency2_relation",
  emergency2phone: "emergency2_phone",
  dateofjoining: "joined_date",
  joineddate: "joined_date",
  jobtitle: "job_title",
  jobspecification: "job_specification",
  department: "department",
  location: "location",
  fuelallowance: "fuel_allowance",
  ctdeduction: "company_transport_deduction",
  payfrequency: "salary_frequency",
  currency: "salary_currency",
  salaryamount: "salary_amount",
  amount: "salary_amount",
  salarycomments: "salary_comments",
  bankname: "routing_number",
  routingnumber: "routing_number",
  accountnumber: "account_number",
};

for (const col of TEMPLATE_COLUMNS) {
  HEADER_MAP[normalizeHeader(col.header)] = col.field;
  HEADER_MAP[col.field.replace(/_/g, "")] = col.field;
}

function excelDate(value: any): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const epoch = new Date(Math.round((value - 25569) * 86400 * 1000));
    if (!Number.isNaN(epoch.getTime())) {
      return epoch.toISOString().slice(0, 10);
    }
  }
  const s = String(value).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return nz(s);
}

function cellText(value: any): any {
  if (value == null) return value;
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray((value as any).richText)) {
      return (value as any).richText.map((t: any) => t?.text || "").join("");
    }
    if ("result" in value) return (value as any).result;
    if ("text" in value && typeof (value as any).text === "string") return (value as any).text;
  }
  return value;
}

function parseEmployeeId(value: any): number | null {
  const raw = cellText(value);
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

function pickValue(sheetVal: any, existingVal: any) {
  return sheetVal != null && String(sheetVal).trim() !== "" ? sheetVal : existingVal ?? null;
}

function isBlankRow(values: Record<string, any>) {
  return Object.values(values).every((v) => v == null || String(v).trim() === "");
}

function ymdExport(value: any): string {
  if (value == null || value === "") return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const raw = String(value).trim();
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function normalizeExportStatus(status: any): string {
  const s = String(status || "").toLowerCase();
  if (s === "enabled" || s === "active") return "active";
  if (s === "disabled" || s === "inactive") return "disabled";
  return s || "";
}

async function loadEmployeeExportRows(ids?: number[]) {
  const uniqueIds = [...new Set((ids || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!uniqueIds.length) return [];

  const placeholders = uniqueIds.map(() => "?").join(",");
  const [emps]: any = await pool.query(
    `SELECT e.id, e.first_name, e.last_name, e.father_name, e.pseudonym, e.employee_code,
            e.dob, e.gender, e.marital_status, e.nationality, e.blood_group,
            e.cnic_number, e.cnic_issuance_date, e.cnic_expiry_date,
            e.employment_status, e.employment_type, e.working_hours, e.role,
            e.username, e.status
     FROM hrm_employees e
     WHERE e.id IN (${placeholders})
     ORDER BY e.id`,
    uniqueIds
  );
  const employees = Array.isArray(emps) ? emps : [];
  const contactMap = new Map<string, any>();
  const jobMap = new Map<string, any>();
  const salaryMap = new Map<string, any>();
  const emergencyMap = new Map<string, any[]>();

  try {
    const [rows]: any = await pool.query(
      `SELECT employee_id, street1, city, state, zip, country,
              permanent_street, permanent_city, permanent_state, permanent_zip, permanent_country,
              phone_mobile, phone_work, email_work, email_other
       FROM employee_contacts ORDER BY id ASC`
    );
    for (const row of rows || []) {
      const id = String(row.employee_id ?? "");
      if (id && !contactMap.has(id)) contactMap.set(id, row);
    }
  } catch {
    /* optional */
  }

  try {
    const [rows]: any = await pool.query(
      `SELECT j.employee_id, j.joined_date, j.job_title, j.job_specification, j.location, d.name AS department
       FROM employee_jobs j
       LEFT JOIN departments d ON j.department_id = d.id
       ORDER BY j.id ASC`
    );
    for (const row of rows || []) {
      const id = String(row.employee_id ?? "");
      if (id && !jobMap.has(id)) jobMap.set(id, row);
    }
  } catch {
    /* optional */
  }

  try {
    const [rows]: any = await pool.query(
      `SELECT employee_id, amount, pay_frequency, currency, comments, account_number, routing_number,
              fuel_allowance, company_transport_deduction, component
       FROM employee_salaries ORDER BY id ASC`
    );
    for (const row of rows || []) {
      const id = String(row.employee_id ?? "");
      if (!id) continue;
      const existing = salaryMap.get(id);
      if (!existing) {
        salaryMap.set(id, { ...row });
        continue;
      }
      const amt = Number(row.amount);
      if (Number.isFinite(amt) && amt > 0) {
        existing.amount = Number(existing.amount || 0) + amt;
      }
      if (!existing.routing_number && row.routing_number) existing.routing_number = row.routing_number;
      if (!existing.account_number && row.account_number) existing.account_number = row.account_number;
      if (!existing.fuel_allowance && row.fuel_allowance) existing.fuel_allowance = row.fuel_allowance;
      if (!existing.company_transport_deduction && row.company_transport_deduction) {
        existing.company_transport_deduction = row.company_transport_deduction;
      }
    }
  } catch {
    /* optional */
  }

  try {
    const [rows]: any = await pool.query(
      `SELECT employee_id, contact_name, relationship, phone FROM employee_emergency_contacts ORDER BY id ASC`
    );
    for (const row of rows || []) {
      const id = String(row.employee_id ?? "");
      if (!id) continue;
      const list = emergencyMap.get(id) || [];
      if (list.length < 2) list.push(row);
      emergencyMap.set(id, list);
    }
  } catch {
    /* optional */
  }

  return employees.map((emp: any) => {
    const id = String(emp.id ?? "");
    const contact = contactMap.get(id) || {};
    const job = jobMap.get(id) || {};
    const salary = salaryMap.get(id) || {};
    const emergencies = emergencyMap.get(id) || [];
    return {
      id: emp.id,
      employee_code: emp.employee_code || "",
      first_name: emp.first_name || "",
      last_name: emp.last_name || "",
      father_name: emp.father_name || "",
      pseudonym: emp.pseudonym || "",
      dob: ymdExport(emp.dob),
      gender: emp.gender || "",
      marital_status: emp.marital_status || "",
      nationality: emp.nationality || "",
      blood_group: emp.blood_group || "",
      cnic_number: emp.cnic_number || "",
      cnic_issuance_date: ymdExport(emp.cnic_issuance_date),
      cnic_expiry_date: ymdExport(emp.cnic_expiry_date),
      employment_status: emp.employment_status || "",
      employment_type: emp.employment_type || "",
      working_hours: emp.working_hours ?? "",
      role: emp.role || "",
      username: emp.username || "",
      password: "",
      status: normalizeExportStatus(emp.status),
      street1: contact.street1 || "",
      city: contact.city || "",
      state: contact.state || "",
      zip: contact.zip || "",
      country: contact.country || "",
      permanent_street: contact.permanent_street || "",
      permanent_city: contact.permanent_city || "",
      permanent_state: contact.permanent_state || "",
      permanent_zip: contact.permanent_zip || "",
      permanent_country: contact.permanent_country || "",
      phone_mobile: contact.phone_mobile || "",
      phone_work: contact.phone_work || "",
      email_work: contact.email_work || "",
      email_other: contact.email_other || "",
      emergency1_name: emergencies[0]?.contact_name || "",
      emergency1_relation: emergencies[0]?.relationship || "",
      emergency1_phone: emergencies[0]?.phone || "",
      emergency2_name: emergencies[1]?.contact_name || "",
      emergency2_relation: emergencies[1]?.relationship || "",
      emergency2_phone: emergencies[1]?.phone || "",
      joined_date: ymdExport(job.joined_date),
      job_title: job.job_title || "",
      job_specification: job.job_specification || "",
      department: job.department || "",
      location: job.location || "",
      fuel_allowance: salary.fuel_allowance ?? "",
      company_transport_deduction: salary.company_transport_deduction ?? "",
      salary_frequency: salary.pay_frequency || "",
      salary_currency: salary.currency || "",
      salary_amount: salary.amount ?? "",
      salary_comments: salary.comments || "",
      routing_number: salary.routing_number || "",
      account_number: salary.account_number || "",
    };
  });
}

async function findExistingEmployeeId(
  conn: any,
  opts: { id?: number | null; employee_code?: string | null; username?: string | null; cnic_number?: string | null }
): Promise<number | null> {
  if (opts.id && Number.isFinite(opts.id) && opts.id > 0) {
    const [rows]: any = await conn.execute("SELECT id FROM hrm_employees WHERE id = ? LIMIT 1", [opts.id]);
    if (rows?.[0]?.id) return Number(rows[0].id);
  }
  if (opts.employee_code) {
    const [rows]: any = await conn.execute(
      "SELECT id FROM hrm_employees WHERE employee_code = ? LIMIT 1",
      [opts.employee_code]
    );
    if (rows?.[0]?.id) return Number(rows[0].id);
  }
  if (opts.username) {
    const [rows]: any = await conn.execute("SELECT id FROM hrm_employees WHERE username = ? LIMIT 1", [opts.username]);
    if (rows?.[0]?.id) return Number(rows[0].id);
  }
  if (opts.cnic_number) {
    const [rows]: any = await conn.execute(
      "SELECT id FROM hrm_employees WHERE cnic_number = ? LIMIT 1",
      [opts.cnic_number]
    );
    if (rows?.[0]?.id) return Number(rows[0].id);
  }
  return null;
}

async function firstIdForEmployee(conn: any, table: string, employeeId: number): Promise<number | null> {
  const allowed = new Set([
    "employee_contacts",
    "employee_jobs",
    "employee_salaries",
    "employee_emergency_contacts",
  ]);
  if (!allowed.has(table)) throw new Error("Invalid table");
  const [rows]: any = await conn.execute(
    `SELECT id FROM ${table} WHERE employee_id = ? ORDER BY id ASC LIMIT 1`,
    [employeeId]
  );
  return rows?.[0]?.id != null ? Number(rows[0].id) : null;
}

async function upsertContact(conn: any, employeeId: number, rowData: Record<string, any>) {
  const street1 = nz(rowData.street1);
  const city = nz(rowData.city);
  const state = nz(rowData.state);
  const zip = nz(rowData.zip);
  const country = nz(rowData.country);
  const permanent_street = nz(rowData.permanent_street);
  const permanent_city = nz(rowData.permanent_city);
  const permanent_state = nz(rowData.permanent_state);
  const permanent_zip = nz(rowData.permanent_zip);
  const permanent_country = nz(rowData.permanent_country);
  const phone_mobile = nz(rowData.phone_mobile);
  const phone_work = nz(rowData.phone_work);
  const email_work = nz(rowData.email_work);
  const email_other = nz(rowData.email_other);
  const anyContact =
    street1 ||
    city ||
    state ||
    zip ||
    country ||
    permanent_street ||
    permanent_city ||
    phone_mobile ||
    phone_work ||
    email_work ||
    email_other;
  if (!anyContact) return;

  const existingId = await firstIdForEmployee(conn, "employee_contacts", employeeId);
  const values = [
    street1,
    null,
    city,
    state,
    zip,
    country,
    permanent_street,
    permanent_city,
    permanent_state,
    permanent_zip,
    permanent_country,
    null,
    phone_mobile,
    phone_work,
    email_work,
    email_other,
  ];
  if (existingId) {
    await conn.execute(
      `UPDATE employee_contacts
       SET street1 = ?, street2 = ?, city = ?, state = ?, zip = ?, country = ?,
           permanent_street = ?, permanent_city = ?, permanent_state = ?, permanent_zip = ?, permanent_country = ?,
           phone_home = ?, phone_mobile = ?, phone_work = ?, email_work = ?, email_other = ?
       WHERE id = ?`,
      [...values, existingId]
    );
    return;
  }
  await conn.execute(
    `INSERT INTO employee_contacts (employee_id, street1, street2, city, state, zip, country, permanent_street, permanent_city, permanent_state, permanent_zip, permanent_country, phone_home, phone_mobile, phone_work, email_work, email_other)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [employeeId, ...values]
  );
}

async function upsertEmergencies(conn: any, employeeId: number, rowData: Record<string, any>) {
  const incoming = [
    {
      name: nz(rowData.emergency1_name),
      rel: nz(rowData.emergency1_relation),
      phone: nz(rowData.emergency1_phone),
    },
    {
      name: nz(rowData.emergency2_name),
      rel: nz(rowData.emergency2_relation),
      phone: nz(rowData.emergency2_phone),
    },
  ];
  const [existing]: any = await conn.execute(
    `SELECT id FROM employee_emergency_contacts WHERE employee_id = ? ORDER BY id ASC`,
    [employeeId]
  );
  const ids = (existing || []).map((r: any) => Number(r.id));
  for (let i = 0; i < incoming.length; i++) {
    const e = incoming[i];
    if (!(e.name || e.rel || e.phone)) continue;
    if (ids[i]) {
      await conn.execute(
        `UPDATE employee_emergency_contacts SET contact_name = ?, relationship = ?, phone = ? WHERE id = ?`,
        [e.name, e.rel, e.phone, ids[i]]
      );
    } else {
      await conn.execute(
        `INSERT INTO employee_emergency_contacts (employee_id, contact_name, relationship, phone) VALUES (?, ?, ?, ?)`,
        [employeeId, e.name, e.rel, e.phone]
      );
    }
  }
}

async function upsertJob(
  conn: any,
  employeeId: number,
  rowData: Record<string, any>,
  employment_status: string | null
) {
  const jobTitle = nz(rowData.job_title);
  const jobSpec = nz(rowData.job_specification);
  const location = nz(rowData.location);
  const joinedDate = excelDate(rowData.joined_date);
  const deptName = nz(rowData.department);
  let departmentId: number | null = null;
  if (deptName) {
    const [deptRows]: any = await conn.execute(`SELECT id FROM departments WHERE name = ? LIMIT 1`, [deptName]);
    if (deptRows?.[0]?.id) departmentId = Number(deptRows[0].id);
  }
  if (!(jobTitle || jobSpec || location || joinedDate || departmentId || employment_status)) return;

  const existingId = await firstIdForEmployee(conn, "employee_jobs", employeeId);
  if (existingId) {
    // Blank / unmatched Department must not clear an existing assignment
    let nextDeptId = departmentId;
    if (!deptName || departmentId == null) {
      const [cur]: any = await conn.execute(
        `SELECT department_id FROM employee_jobs WHERE id = ? LIMIT 1`,
        [existingId],
      );
      if (cur?.[0]?.department_id != null) nextDeptId = Number(cur[0].department_id);
    }
    await conn.execute(
      `UPDATE employee_jobs
       SET joined_date = COALESCE(?, joined_date),
           job_title = COALESCE(?, job_title),
           job_specification = COALESCE(?, job_specification),
           location = COALESCE(?, location),
           employment_status = COALESCE(?, employment_status),
           department_id = ?
       WHERE id = ?`,
      [joinedDate, jobTitle, jobSpec, location, employment_status, nextDeptId, existingId]
    );
    return;
  }
  await conn.execute(
    `INSERT INTO employee_jobs (employee_id, joined_date, first_appraisal_months, second_appraisal_months, job_title, job_specification, job_category, sub_unit, location, employment_status, include_contract, department_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [employeeId, joinedDate, null, null, jobTitle, jobSpec, null, null, location, employment_status, 0, departmentId]
  );
}

async function upsertSalary(conn: any, employeeId: number, rowData: Record<string, any>) {
  const salaryAmount = nz(rowData.salary_amount);
  const fuel = nz(rowData.fuel_allowance);
  const ctd = nz(rowData.company_transport_deduction);
  const account_number = nz(rowData.account_number);
  const routing_number = nz(rowData.routing_number);
  if (!(salaryAmount || fuel || ctd || account_number || routing_number)) return;

  const existingId = await firstIdForEmployee(conn, "employee_salaries", employeeId);
  const payFrequency = nz(rowData.salary_frequency);
  const currency = nz(rowData.salary_currency) || "PKR";
  const comments = nz(rowData.salary_comments);
  const directDeposit = account_number || routing_number ? 1 : 0;
  if (existingId) {
    await conn.execute(
      `UPDATE employee_salaries
       SET pay_frequency = ?, currency = ?, amount = ?, comments = ?, direct_deposit = ?,
           account_number = ?, routing_number = ?, fuel_allowance = ?, company_transport_deduction = ?
       WHERE id = ?`,
      [payFrequency, currency, salaryAmount, comments, directDeposit, account_number, routing_number, fuel, ctd, existingId]
    );
    return;
  }
  await conn.execute(
    `INSERT INTO employee_salaries (employee_id, component, pay_grade, pay_frequency, currency, amount, comments, direct_deposit, account_number, account_type, routing_number, deposit_amount, fuel_allowance, company_transport_deduction)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      employeeId,
      "Basic",
      null,
      payFrequency,
      currency,
      salaryAmount,
      comments,
      directDeposit,
      account_number,
      null,
      routing_number,
      null,
      fuel,
      ctd,
    ]
  );
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const wantTemplate = searchParams.get("template");
    const wantExport = searchParams.get("export");
    if (!wantTemplate && !wantExport) {
      return NextResponse.json(
        { success: false, error: "Missing parameter. Use ?template=1 or ?export=1." },
        { status: 400 }
      );
    }
    const isExport = Boolean(wantExport);
    const exportIds = (searchParams.get("ids") || "")
      .split(",")
      .map((v) => Number(v.trim()))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (isExport && exportIds.length === 0) {
      return NextResponse.json(
        { success: false, error: "Select at least one employee to export." },
        { status: 400 }
      );
    }

    let departments: string[] = [];
    try {
      const [rows]: any = await pool.query("SELECT name FROM departments ORDER BY name");
      departments = (rows || []).map((r: any) => String(r.name || "").trim()).filter(Boolean);
    } catch {
      departments = [];
    }

    const dataRows = isExport ? await loadEmployeeExportRows(exportIds) : [];

    const wb = new ExcelJS.Workbook();
    wb.creator = "Interact HRM";
    const ws = wb.addWorksheet("Employees", { views: [{ state: "frozen", ySplit: 3 }] });
    const lists = wb.addWorksheet("Lists");
    lists.state = "hidden";

    const instructions = wb.addWorksheet("Instructions");
    instructions.columns = [{ width: 92 }];
    instructions.addRow(["How to use this template"]);
    instructions.getRow(1).font = { bold: true, size: 14, color: { argb: "FF611F69" } };
    [
      "1. One employee per row on the Employees sheet. Do not change or delete the header rows.",
      "2. Employee ID is locked on export so it cannot be changed. Do not unprotect or replace it.",
      "3. Import updates a matched employee (ID, then Code, then Username, then CNIC). No duplicate is created.",
      "4. Leave Employee ID blank only for NEW employees. Existing rows must keep their ID.",
      "5. YELLOW columns are Personal Details and are MANDATORY.",
      "6. Dates: type as 2000-01-18 (year-month-day). Password is never exported; fill it only to change login password.",
      "7. Gender: male / female / other. Marital Status: single / married / other.",
      "8. Employment Status: Probation or Permanent. Employment Type: Full Time or Part Time.",
      "9. Role: BOD/CEO, HOD, Management, Leader, or Officer.",
      "10. Save the file and use Import XLS on Employee List or Add Employee.",
    ].forEach((line) => instructions.addRow([line]));
    instructions.getCell("A6").fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFF2CC" },
    };

    const listDefs: { heading: string; values: string[] }[] = [
      { heading: "gender", values: ["male", "female", "other"] },
      { heading: "marital", values: ["single", "married", "other"] },
      { heading: "blood", values: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] },
      { heading: "emp_status", values: ["Probation", "Permanent"] },
      { heading: "emp_type", values: ["Full Time", "Part Time"] },
      { heading: "role", values: ["BOD/CEO", "HOD", "Management", "Leader", "Officer"] },
      { heading: "status", values: ["active", "disabled"] },
      { heading: "freq", values: ["Monthly", "Weekly", "Yearly"] },
      { heading: "currency", values: ["PKR", "USD", "INR", "AED"] },
      { heading: "department", values: departments.length ? departments : ["IT"] },
    ];
    listDefs.forEach((def, i) => {
      const col = i + 1;
      lists.getCell(1, col).value = def.heading;
      def.values.forEach((v, idx) => {
        lists.getCell(idx + 2, col).value = v;
      });
    });

    const groupRow = ws.addRow(TEMPLATE_COLUMNS.map((c) => c.group));
    const headerRow = ws.addRow(TEMPLATE_COLUMNS.map((c) => c.header));
    groupRow.height = 28;
    headerRow.height = 32;
    headerRow.font = { bold: true, color: { argb: "FF0F172A" } };
    groupRow.font = { bold: true, size: 11, color: { argb: "FF0F172A" } };

    let mergeStart = 1;
    for (let i = 1; i <= TEMPLATE_COLUMNS.length; i++) {
      const current = TEMPLATE_COLUMNS[i - 1].group;
      const next = TEMPLATE_COLUMNS[i]?.group;
      if (next !== current) {
        if (i > mergeStart) {
          ws.mergeCells(1, mergeStart, 1, i);
        }
        const cell = groupRow.getCell(mergeStart);
        cell.value = current;
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        mergeStart = i + 1;
      }
    }

    const lastDataRow = Math.max(52, 2 + (isExport ? dataRows.length : 0) + 20);

    TEMPLATE_COLUMNS.forEach((col, i) => {
      const c = i + 1;
      ws.getColumn(c).width = col.date ? 18 : col.width || 16;
      const fill = col.required
        ? { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFFE599" } }
        : col.group === MATCH_GROUP
          ? { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFD4C4E8" } }
          : { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFE2E8F0" } };
      groupRow.getCell(c).fill = fill;
      headerRow.getCell(c).fill = fill;
      headerRow.getCell(c).font = { bold: true, color: { argb: "FF0F172A" } };
      headerRow.getCell(c).alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
      groupRow.getCell(c).protection = { locked: true };
      headerRow.getCell(c).protection = { locked: true };
      for (let r = 3; r <= lastDataRow; r++) {
        const cell = ws.getCell(r, c);
        cell.font = { color: { argb: "FF0F172A" } };
        cell.alignment = { vertical: "middle", wrapText: false };
        if (col.required) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8DC" } };
        }
        if (col.date) {
          cell.numFmt = "@";
        }
        cell.protection = { locked: col.field === "id" || false };
        if (col.list && col.list.length) {
          cell.dataValidation = {
            type: "list",
            allowBlank: !col.required,
            formulae: [`"${col.list.join(",")}"`],
            showErrorMessage: true,
            errorTitle: "Invalid value",
            error: `Use one of: ${col.list.join(", ")}`,
          };
        }
      }
    });

    if (!isExport) {
      const exampleByField: Record<string, string> = {
        first_name: "EXAMPLE",
        last_name: "Row",
        father_name: "M. Rafique",
        pseudonym: "Demo",
        dob: "2000-01-18",
        gender: "male",
        marital_status: "single",
        nationality: "Pakistani",
        blood_group: "B+",
        cnic_number: "35202-1234567-1",
        cnic_issuance_date: "2018-06-01",
        cnic_expiry_date: "2028-06-01",
        employment_status: "Permanent",
        employment_type: "Full Time",
        working_hours: "9",
        role: "Officer",
        status: "active",
      };
      const exampleRow = ws.getRow(3);
      exampleRow.height = 22;
      TEMPLATE_COLUMNS.forEach((col, i) => {
        const value = exampleByField[col.field];
        if (value == null) return;
        const cell = exampleRow.getCell(i + 1);
        cell.value = value;
        cell.font = { color: { argb: "FF0F172A" }, italic: true };
      });
    } else {
      dataRows.forEach((rowValues, idx) => {
        const excelRow = ws.getRow(3 + idx);
        excelRow.height = 20;
        TEMPLATE_COLUMNS.forEach((col, i) => {
          const raw = (rowValues as Record<string, unknown>)[col.field];
          if (raw == null || raw === "") return;
          const cell = excelRow.getCell(i + 1);
          cell.value = typeof raw === "number" ? raw : String(raw);
          cell.protection = { locked: col.field === "id" };
        });
      });
    }

    const deptListIndex = listDefs.findIndex((d) => d.heading === "department");
    const deptCol = TEMPLATE_COLUMNS.findIndex((c) => c.field === "department") + 1;
    if (deptCol > 0 && deptListIndex >= 0) {
      const excelCol = String.fromCharCode(65 + deptListIndex);
      const last = Math.max(2, (listDefs[deptListIndex].values.length || 1) + 1);
      for (let r = 3; r <= lastDataRow; r++) {
        ws.getCell(r, deptCol).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [`Lists!$${excelCol}$2:$${excelCol}$${last}`],
          showErrorMessage: false,
        };
      }
    }

    if (isExport) {
      await ws.protect("", {
        selectLockedCells: true,
        selectUnlockedCells: true,
        formatCells: true,
        sort: false,
        autoFilter: false,
        insertRows: false,
        deleteRows: false,
        insertColumns: false,
        deleteColumns: false,
      });
    }

    const buf = await wb.xlsx.writeBuffer();
    const filename = isExport ? "employee-list-export.xlsx" : "employee-import-template.xlsx";
    return new NextResponse(Buffer.from(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: "file is required (.xlsx)" }, { status: 400 });
    }
    const sourceRaw = String(form.get("source") || "unknown").trim().toLowerCase();
    const source =
      sourceRaw === "employee-list" || sourceRaw === "add-employee" ? sourceRaw : "unknown";
    const uploadedBy = String(form.get("uploaded_by") || "").trim() || null;

    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);
    const originalFilename = String(file.name || "employee-import.xlsx").slice(0, 255);
    const ext = path.extname(originalFilename).toLowerCase() || ".xlsx";
    const safeExt = ext === ".xls" || ext === ".xlsx" ? ext : ".xlsx";
    const storedFilename = `${new Date().toISOString().slice(0, 10)}_${randomUUID()}${safeExt}`;
    const relativePath = `/uploads/employee-imports/${storedFilename}`;

    // Keep a durable copy for audit / proof (best-effort — import still runs if archive fails)
    let archiveId: number | null = null;
    try {
      const absDir = path.join(process.cwd(), "public", "uploads", "employee-imports");
      await fs.mkdir(absDir, { recursive: true });
      await fs.writeFile(path.join(absDir, storedFilename), fileBuffer);
      const [ins]: any = await pool.execute(
        `INSERT INTO employee_import_uploads
          (original_filename, stored_filename, relative_path, source, uploaded_by, file_size, mime_type)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          originalFilename,
          storedFilename,
          relativePath,
          source,
          uploadedBy,
          fileBuffer.length,
          file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ],
      );
      archiveId = Number(ins?.insertId) || null;
    } catch (archiveErr) {
      console.error("Employee import archive failed:", archiveErr);
    }

    const wb = new ExcelJS.Workbook();
    // @ts-ignore ExcelJS accepts Buffer/Uint8Array at runtime
    await wb.xlsx.load(fileBuffer);
    const ws = wb.worksheets.find((s) => s.name === "Employees") || wb.worksheets[0];
    if (!ws) return NextResponse.json({ success: false, error: "No sheet found" }, { status: 400 });

    const row1Text = String(ws.getRow(1).getCell(1).value ?? "").trim();
    const row2Text = String(ws.getRow(2).getCell(1).value ?? "").trim();
    const headerRowNumber = /employee id|first name/i.test(row2Text) || /match keys|personal details/i.test(row1Text)
      ? 2
      : 1;
    const dataStart = headerRowNumber + 1;

    const headerToField = new Map<number, string>();
    const headerRow = ws.getRow(headerRowNumber);
    for (let col = 1; col <= Math.max(TEMPLATE_COLUMNS.length, headerRow.cellCount || 0); col++) {
      const rawHeader = String(cellText(headerRow.getCell(col).value) ?? "").trim();
      if (!rawHeader) continue;
      const normalized = normalizeHeader(rawHeader);
      const fieldName = HEADER_MAP[normalized] || rawHeader.toLowerCase().replace(/\s+/g, "_");
      headerToField.set(col, fieldName);
    }
    if (headerToField.size < 8) {
      TEMPLATE_COLUMNS.forEach((col, i) => headerToField.set(i + 1, col.field));
    }

    const results: RowResult[] = [];
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (let r = dataStart; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const rowData: Record<string, any> = {};
      headerToField.forEach((fieldName, colIndex) => {
        rowData[fieldName] = cellText(row.getCell(colIndex).value);
      });
      if (isBlankRow(rowData)) continue;

      try {
        const first_name = nz(rowData.first_name);
        if (/^example$/i.test(first_name || "")) continue;
        const last_name = nz(rowData.last_name);
        const father_name = nz(rowData.father_name);
        const pseudonym = nz(rowData.pseudonym) || nz(rowData.middle_name);
        const dob = excelDate(rowData.dob);
        const gender = nz(rowData.gender)?.toLowerCase() || null;
        const marital_status = nz(rowData.marital_status)?.toLowerCase() || null;
        const nationality = nz(rowData.nationality);
        const blood_group = nz(rowData.blood_group);
        const cnic_number = nz(rowData.cnic_number);
        const cnic_issuance_date = excelDate(rowData.cnic_issuance_date);
        const cnic_expiry_date = excelDate(rowData.cnic_expiry_date);
        const employment_status = nz(rowData.employment_status);
        const employment_type = nz(rowData.employment_type);
        const role = nz(rowData.role) || "Officer";
        const username = nz(rowData.username);
        const password = nz(rowData.password);
        let status = (nz(rowData.status) || "").toLowerCase();
        if (status === "enabled") status = "active";
        if (!status) status = username ? "active" : "disabled";

        const sheetId = parseEmployeeId(rowData.id) ?? parseEmployeeId(row.getCell(1).value);
        const employee_code = nz(rowData.employee_code);

        const missing = REQUIRED_PERSONAL_FIELDS.filter((field) => {
          const valueMap: Record<string, any> = {
            first_name,
            last_name,
            father_name,
            pseudonym,
            dob,
            gender,
            marital_status,
            nationality,
            blood_group,
            cnic_number,
            cnic_issuance_date,
            cnic_expiry_date,
            employment_status,
            employment_type,
            role,
          };
          return !valueMap[field];
        });

        const empTypeFromSheet =
          employment_type === "Part Time" || employment_type === "Full Time" ? employment_type : null;
        let hoursVal: number | null = null;
        if (empTypeFromSheet === "Full Time") {
          hoursVal = 9;
        } else if (empTypeFromSheet === "Part Time") {
          const n = Number(nz(rowData.working_hours));
          if (!Number.isInteger(n) || n < 1 || n > 6) {
            skipped++;
            results.push({
              row: r,
              status: "skipped",
              reason: "Part Time requires Working Hours 1–6",
            });
            continue;
          }
          hoursVal = n;
        }

        let conn: any = await pool.getConnection();
        try {
          await conn.beginTransaction();
          const existingId = await findExistingEmployeeId(conn, {
            id: sheetId,
            employee_code,
            username,
            cnic_number,
          });

          if (!existingId && missing.length) {
            await conn.rollback();
            skipped++;
            results.push({
              row: r,
              status: "skipped",
              reason: `Personal Details required: ${missing.join(", ")}`,
            });
            continue;
          }

          let existing: any = null;
          if (existingId) {
            const [existingRows]: any = await conn.execute(
              "SELECT * FROM hrm_employees WHERE id = ? LIMIT 1",
              [existingId]
            );
            existing = existingRows?.[0] || null;
          }

          const firstNameVal = pickValue(first_name, existing?.first_name);
          const lastNameVal = pickValue(last_name, existing?.last_name);
          const fatherNameVal = pickValue(father_name, existing?.father_name);
          const pseudonymVal = pickValue(pseudonym, existing?.pseudonym);
          const dobVal = pickValue(dob, existing?.dob ? ymdExport(existing.dob) : null);
          const genderVal = pickValue(gender, existing?.gender);
          const maritalVal = pickValue(marital_status, existing?.marital_status);
          const nationalityVal = pickValue(nationality, existing?.nationality);
          const bloodVal = pickValue(blood_group, existing?.blood_group);
          const cnicVal = pickValue(cnic_number, existing?.cnic_number);
          const cnicIssuanceVal = pickValue(
            cnic_issuance_date,
            existing?.cnic_issuance_date ? ymdExport(existing.cnic_issuance_date) : null
          );
          const cnicExpiryVal = pickValue(
            cnic_expiry_date,
            existing?.cnic_expiry_date ? ymdExport(existing.cnic_expiry_date) : null
          );
          const employmentStatusVal = pickValue(employment_status, existing?.employment_status);
          const empType =
            empTypeFromSheet ||
            (existing?.employment_type === "Part Time" || existing?.employment_type === "Full Time"
              ? existing.employment_type
              : null);
          const hoursFinal =
            hoursVal != null
              ? hoursVal
              : existing?.working_hours != null
                ? Number(existing.working_hours)
                : empType === "Full Time"
                  ? 9
                  : null;
          const roleVal = pickValue(role === "Officer" && !nz(rowData.role) ? null : role, existing?.role) || "Officer";
          const statusVal = pickValue(
            status === "disabled" && !nz(rowData.status) ? null : status,
            existing?.status
          ) || (username ? "active" : "disabled");

          if (username && !password && !existingId) {
            await conn.rollback();
            skipped++;
            results.push({ row: r, status: "skipped", reason: "Password is required when Username is filled" });
            continue;
          }

          if (existingId && username && !password) {
            const currentUsername = nz(existing?.username);
            if (username !== currentUsername) {
              await conn.rollback();
              skipped++;
              results.push({
                row: r,
                status: "skipped",
                reason: "Password is required when changing Username",
              });
              continue;
            }
          }

          let employeeId = existingId;
          if (existingId) {
            const sets = [
              "first_name = ?",
              "pseudonym = ?",
              "last_name = ?",
              "father_name = ?",
              "dob = ?",
              "gender = ?",
              "marital_status = ?",
              "nationality = ?",
              "blood_group = ?",
              "status = ?",
              "role = ?",
              "cnic_number = ?",
              "cnic_issuance_date = ?",
              "cnic_expiry_date = ?",
              "employment_status = ?",
              "employment_type = ?",
              "working_hours = ?",
            ];
            const params: any[] = [
              firstNameVal,
              pseudonymVal,
              lastNameVal,
              fatherNameVal,
              dobVal,
              genderVal,
              maritalVal,
              nationalityVal,
              bloodVal,
              statusVal,
              roleVal,
              cnicVal,
              cnicIssuanceVal,
              cnicExpiryVal,
              employmentStatusVal,
              empType,
              hoursFinal,
            ];
            if (employee_code) {
              sets.push("employee_code = ?");
              params.push(employee_code);
            }
            if (username) {
              sets.push("username = ?");
              params.push(username);
            }
            if (password) {
              sets.push("password = ?");
              params.push(password);
            }
            params.push(existingId);
            await conn.execute(`UPDATE hrm_employees SET ${sets.join(", ")} WHERE id = ?`, params);
          } else {
            const [res]: any = await conn.execute(
              `INSERT INTO hrm_employees (first_name, pseudonym, last_name, father_name, employee_code, dob, gender, marital_status, nationality, blood_group, profile_img, username, password, status, role, cnic_number, cnic_issuance_date, cnic_expiry_date, employment_status, employment_type, working_hours, face_verification_enabled)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
              [
                first_name,
                pseudonym,
                last_name,
                father_name,
                employee_code,
                dob,
                gender,
                marital_status,
                nationality,
                blood_group,
                null,
                username,
                password,
                status,
                role,
                cnic_number,
                cnic_issuance_date,
                cnic_expiry_date,
                employment_status,
                empType,
                hoursVal,
              ]
            );
            employeeId = Number(res.insertId);
          }

          if (!employeeId) {
            throw new Error("Could not resolve employee id");
          }

          await upsertContact(conn, employeeId, rowData);
          await upsertEmergencies(conn, employeeId, rowData);
          await upsertJob(conn, employeeId, rowData, employmentStatusVal || employment_status);
          await upsertSalary(conn, employeeId, rowData);

          await conn.commit();
          if (existingId) {
            results.push({ row: r, status: "updated", employeeId });
            updated++;
          } else {
            results.push({ row: r, status: "inserted", employeeId });
            inserted++;
          }
        } catch (rowErr: any) {
          try {
            await conn.rollback();
          } catch {}
          failed++;
          results.push({
            row: r,
            status: "failed",
            reason: rowErr?.sqlMessage || rowErr?.message || String(rowErr),
          });
        } finally {
          try {
            conn.release();
          } catch {}
        }
      } catch (err) {
        failed++;
        results.push({ row: r, status: "failed", reason: (err as any)?.message || String(err) });
      }
    }

    if (archiveId) {
      try {
        const summary = { inserted, updated, skipped, failed, results: results.slice(0, 200) };
        await pool.execute(
          `UPDATE employee_import_uploads
           SET inserted_count = ?, updated_count = ?, skipped_count = ?, failed_count = ?, summary_json = ?
           WHERE id = ?`,
          [inserted, updated, skipped, failed, JSON.stringify(summary), archiveId],
        );
      } catch (summaryErr) {
        console.error("Employee import archive summary update failed:", summaryErr);
      }
    }

    return NextResponse.json({
      success: true,
      summary: { inserted, updated, skipped, failed },
      results,
      archive: archiveId
        ? { id: archiveId, path: relativePath, original_filename: originalFilename }
        : null,
    });
  } catch (err) {
    console.error("Employee import crashed:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
