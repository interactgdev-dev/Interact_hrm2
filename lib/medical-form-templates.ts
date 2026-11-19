import type { FormFieldDef } from "@/lib/form-schema";

/** Section banner — rendered as heading in fill/preview UIs (not submitted). */
function heading(key: string, label: string, description?: string): FormFieldDef {
  return {
    key,
    label,
    type: "heading",
    readonly: true,
    ...(description ? { options: [description] } : {}),
  };
}

function text(
  key: string,
  label: string,
  opts?: Partial<FormFieldDef>
): FormFieldDef {
  return { key, label, type: "text", required: true, filled_by: "employee", ...opts };
}

function dateField(
  key: string,
  label: string,
  opts?: Partial<FormFieldDef>
): FormFieldDef {
  return { key, label, type: "date", required: true, filled_by: "employee", ...opts };
}

function select(
  key: string,
  label: string,
  options: string[],
  opts?: Partial<FormFieldDef>
): FormFieldDef {
  return {
    key,
    label,
    type: "select",
    options,
    required: true,
    filled_by: "employee",
    ...opts,
  };
}

function checks(
  key: string,
  label: string,
  options: string[],
  opts?: Partial<FormFieldDef>
): FormFieldDef {
  return {
    key,
    label,
    type: "checkbox",
    options,
    required: true,
    filled_by: "employee",
    ...opts,
  };
}

function familyMemberBlock(n: number): FormFieldDef[] {
  return [
    heading(
      `section_family_${n}`,
      n === 1
        ? "4. Family Member 1 (spouse, children, parents)"
        : `4. Family Member ${n}`,
      n === 1
        ? "Only legally married spouse, dependent children and dependent parents can be covered. Start with one member — use Add another family member if needed."
        : undefined
    ),
    text(`family_${n}_full_name`, `Family member ${n} - Full name`, { required: false }),
    select(
      `family_${n}_relationship`,
      `Family member ${n} - Relationship`,
      ["Spouse", "Child", "Parent"],
      { required: false }
    ),
    dateField(`family_${n}_dob`, `Family member ${n} - Date of birth`, { required: false }),
    text(
      `family_${n}_cnic`,
      `Family member ${n} - CNIC / B-Form number`,
      { required: false }
    ),
    select(
      `family_${n}_dependent`,
      `Family member ${n} - Student / dependent?`,
      ["Financially dependent", "Student", "Both", "Not applicable"],
      { required: false }
    ),
  ];
}

function pdfUpload(key: string, label: string, description?: string): FormFieldDef {
  return {
    key,
    label,
    type: "file",
    required: false,
    filled_by: "employee",
    ...(description ? { options: [description] } : {}),
  };
}

export const MEDICAL_SUBSCRIPTION_DESCRIPTION =
  "Employee Medical Benefits Policy - Voluntary (Opt-in) Subscription. Effective 1st October 2026.\n\n" +
  "Eligibility: confirmed full-time employees are covered from 1st October 2026. Employees who have recently joined or are on probation can subscribe after completing probation and confirmation.\n\n" +
  "Please complete in BLOCK LETTERS. Photocopies of CNIC / B-Form / birth certificates must be given to HR (see Documents section).";

export const MEDICAL_SUBSCRIPTION_SCHEMA: FormFieldDef[] = [
  heading("section_1", "1. Employee Details"),
  text("employee_name", "Full name", {
    autofill: "employee.full_name",
    readonly: true,
  }),
  text("employee_id", "Employee ID", {
    autofill: "employee.id",
    readonly: true,
  }),
  text("cnic_number", "CNIC number", {}),
  dateField("date_of_birth", "Date of birth"),
  text("designation", "Designation", {
    autofill: "employee.job_title",
    readonly: true,
    required: false,
  }),
  text("department", "Department", {
    autofill: "employee.department",
    readonly: true,
    required: false,
  }),
  text("reporting_manager", "Reporting manager"),
  text("mobile_number", "Mobile number"),
  text("email_official", "Email (official)"),
  select("employment_status", "Current employment status", [
    "Confirmed full-time",
    "Probationary (not yet eligible - subscribe after confirmation)",
    "Other",
  ]),

  heading("section_2", "2. Employment Details"),
  dateField("date_of_joining", "Date of joining"),
  dateField("date_of_confirmation", "Date of confirmation", { required: false }),
  select("employment_type", "Employment type", [
    "Full-time",
    "Part-time",
    "Contract",
    "Intern",
    "Consultant",
  ]),

  heading(
    "section_3",
    "3. Subscription Details",
    "IPD coverage (up to PKR 150,000 per policy year, per covered individual) is the same for all tiers."
  ),
  dateField("subscription_start_date", "Requested subscription start date", {
    required: false,
  }),
  select("opd_plan_tier", "OPD plan tier", [
    "Standard - annual OPD limit PKR 24,000 - PKR 1,000 per month",
    "Enhanced - annual OPD limit PKR 40,000 - PKR 2,200 per month",
    "Premium - annual OPD limit PKR 50,000 - PKR 3,000 per month",
  ]),
  select("coverage_requested", "Coverage requested", [
    "Employee only",
    "Employee + dependents",
  ]),

  ...familyMemberBlock(1),
  ...familyMemberBlock(2),
  ...familyMemberBlock(3),
  ...familyMemberBlock(4),
  ...familyMemberBlock(5),
  ...familyMemberBlock(6),
  ...familyMemberBlock(7),
  ...familyMemberBlock(8),

  heading(
    "section_5",
    "5. Documents - ONE combined PDF",
    "Put ALL documents in ONE scanned PDF (max 10 MB), in order: (1) Your CNIC front/back (2) Spouse CNIC if covered (3) Children B-Form/CNIC + birth certificate (4) Parents CNIC. File name: EmployeeID_YourName_Medical_Documents.pdf — incomplete documents will be returned."
  ),
  pdfUpload(
    "documents_pdf",
    "Upload combined PDF",
    "PDF only · max 10 MB. HR can open this file from the submitted form."
  ),
  checks(
    "documents_included",
    "Documents included in my single PDF",
    [
      "Employee CNIC copy",
      "Spouse CNIC copy",
      "Children - B-Form (or CNIC) copies and birth certificates",
      "Parents - CNIC copies",
      "Not applicable (employee only)",
    ],
    { required: false }
  ),

  heading("section_6", "6. Declaration & Consent"),
  checks(
    "declaration_1",
    "Declaration 1 — I confirm that all information and documents provided in this form are true and complete.",
    ["I agree"]
  ),
  checks(
    "declaration_2",
    "Declaration 2 — I have read the Employee Medical Benefits Policy and understand its coverage limits, exclusions and claim procedure.",
    ["I agree"]
  ),
  checks(
    "declaration_3",
    "Declaration 3 — I authorize Interact Global to deduct the monthly amount applicable to my selected OPD plan tier from my salary from the subscription start date.",
    ["I agree"]
  ),
  checks(
    "declaration_4",
    "Declaration 4 — I understand that only the persons listed in this form and verified by HR are covered, and I will inform HR within 30 days of any change (marriage, birth, death, change in dependency, or my exit).",
    ["I agree"]
  ),
  checks(
    "declaration_5",
    "Declaration 5 — I understand that if I am on probation or have recently joined, my coverage starts only after completion of probation and confirmation.",
    ["I agree"]
  ),
  checks(
    "declaration_6",
    "Declaration 6 — I understand that false information may result in cancellation of coverage and rejection of claims, and that the policy is subject to management approval and may be amended with prior notice.",
    ["I agree"]
  ),
  text("employee_signature", "Employee signature (type your full name)"),
  dateField("signature_date", "Date"),
];

export const MEDICAL_CLAIM_DESCRIPTION =
  "Employee Medical Benefits Policy - Claim Submission.\n\n" +
  "Submit one form per claim (one patient, one treatment or hospital stay). OPD claims are reimbursed up to the annual OPD limit of your plan tier (Standard PKR 24,000, Enhanced PKR 40,000, Premium PKR 50,000 per policy year). This limit is shared by you and all your covered family members. IPD claims are covered up to PKR 150,000 per policy year.\n\n" +
  "Claims must be submitted within 30 days of the treatment or purchase. Keep your original prescription, receipts and hospital bills safe — HR may ask to see the originals.";

export const MEDICAL_CLAIM_SCHEMA: FormFieldDef[] = [
  heading("section_1", "1. Employee and Patient Details"),
  text("employee_id", "Employee ID", {
    autofill: "employee.id",
    readonly: true,
  }),
  text("employee_name", "Employee full name", {
    autofill: "employee.full_name",
    readonly: true,
  }),
  select("patient_is", "Patient is", ["Myself", "Spouse", "Child", "Parent"]),
  text("patient_full_name", "Patient full name"),
  select("claim_type", "Claim type", ["OPD (outpatient)", "IPD (hospitalization)"]),

  heading(
    "section_2a",
    "2A. OPD (Outpatient) Claim",
    "Covers doctor consultation fees, prescribed diagnostic/lab tests and prescribed medicines. Treatment without a doctor's prescription, self-medication, OTC and wellness products are not reimbursable. Fill this section only for OPD claims."
  ),
  dateField("opd_treatment_date", "OPD - Date of treatment / purchase", {
    required: false,
  }),
  text("opd_doctor_clinic", "OPD - Doctor / clinic name", { required: false }),
  checks(
    "opd_included",
    "OPD - What is included in this claim",
    [
      "Doctor consultation fee",
      "Prescribed diagnostic / lab tests",
      "Prescribed medicines",
    ],
    { required: false }
  ),
  text("opd_total_amount", "OPD - Total bill amount (PKR)", { required: false }),
  checks(
    "opd_prescription_receipts",
    "OPD - I have a valid doctor's prescription and the original paid receipts/invoices for this claim.",
    ["I agree"],
    { required: false }
  ),
  checks(
    "opd_30_day_rule",
    "OPD - This claim is being submitted within 30 days of the treatment or purchase date.",
    ["I agree"],
    { required: false }
  ),
  select(
    "opd_details_confirm",
    "OPD - Details are complete",
    ["I confirm the OPD details above are correct"],
    { required: false }
  ),

  heading(
    "section_2b",
    "2B. IPD (Hospitalization) Claim",
    "Covers medically necessary hospitalization from illness, accident, surgery or maternity (normal delivery and C-section). Fill this section only for IPD claims."
  ),
  text("ipd_hospital_name", "IPD - Hospital name", { required: false }),
  dateField("ipd_admission_date", "IPD - Admission date", { required: false }),
  dateField("ipd_discharge_date", "IPD - Discharge date", { required: false }),
  select(
    "ipd_reason",
    "IPD - Reason for hospitalization",
    [
      "Illness",
      "Accident",
      "Surgery",
      "Maternity - normal delivery",
      "Maternity - C-section",
    ],
    { required: false }
  ),
  select(
    "ipd_hr_informed",
    "IPD - Was HR informed in advance?",
    ["Yes, informed in advance", "No, it was an emergency", "No"],
    { required: false }
  ),
  text("ipd_total_amount", "IPD - Total hospital bill amount (PKR)", {
    required: false,
  }),
  checks(
    "ipd_30_day_rule",
    "IPD - This claim is being submitted within 30 days of the treatment or discharge date.",
    ["I agree"],
    { required: false }
  ),

  heading(
    "section_3",
    "3. Documents - ONE combined PDF",
    "Put ALL documents for this claim in ONE scanned PDF. OPD: (1) prescription (2) paid receipts. IPD: (1) discharge summary (2) itemized bills (3) medical records. Max 10 MB."
  ),
  pdfUpload(
    "documents_pdf",
    "Upload claim PDF",
    "PDF only · max 10 MB. HR can open this file from the submitted claim."
  ),
  checks(
    "documents_included",
    "Documents included in my PDF",
    [
      "Original doctor's prescription",
      "Paid receipts / invoices",
      "Hospital discharge summary",
      "Itemized hospital bills",
      "Medical records",
    ],
    { required: false }
  ),

  heading("section_4", "4. Declaration & Signature"),
  checks(
    "declaration_1",
    "Declaration 1 — I confirm that all information and documents provided in this claim are true and complete.",
    ["I agree"]
  ),
  checks(
    "declaration_2",
    "Declaration 2 — I understand that false information or documents may lead to rejection of this claim and cancellation of my coverage.",
    ["I agree"]
  ),
  checks(
    "declaration_3",
    "Declaration 3 — I understand that reimbursement is subject to the policy limits, exclusions and HR verification, and that the decision of Management/HR is final.",
    ["I agree"]
  ),
  text("employee_signature", "Employee signature (type your full name)"),
  dateField("signature_date", "Date"),
];

export type MedicalTemplateSeed = {
  title: string;
  description: string;
  category: string;
  form_schema: FormFieldDef[];
};

export const MEDICAL_FORM_SEEDS: MedicalTemplateSeed[] = [
  {
    title: "Interact Global - Medical Benefits Subscription Form",
    description: MEDICAL_SUBSCRIPTION_DESCRIPTION,
    category: "medical",
    form_schema: MEDICAL_SUBSCRIPTION_SCHEMA,
  },
  {
    title: "Interact Global - Medical Claim Form",
    description: MEDICAL_CLAIM_DESCRIPTION,
    category: "medical",
    form_schema: MEDICAL_CLAIM_SCHEMA,
  },
];
