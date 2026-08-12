"use client";
import React, { useState, useEffect } from "react";
// ...existing code...
import Image from "next/image";
import styles from "./add-employee.module.css";
import AttachmentsUploader from "./AttachmentsUploader";
import { toastError, toastInfo, toastSuccess } from "@/lib/app-toast";

const employeeTabs = [
  { name: "Personal Details" },
  { name: "Contact Details" },
  { name: "Emergency Contacts" },
  { name: "Job Details" },
  { name: "Allowances" },
  { name: "Salary" },
  { name: "Appraisal" },
  { name: "Attachments" },
];

export default function AddEmployeeForm({
  edit = false,
  employeeId: editEmployeeId = null,
  onSaved,
}: {
  edit?: boolean;
  employeeId?: string | null;
  onSaved?: () => void;
}) {
  // Departments state for dropdown
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);

  // Fetch departments on mount
  useEffect(() => {
    fetch('/api/departments')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setDepartments(data);
        } else if (data.departments) {
          setDepartments(data.departments);
        }
      })
      .catch(() => setDepartments([]));
  }, []);
  const isEdit = edit;
  
  // Emergency Contacts state
  const [emergencyContacts, setEmergencyContacts] = useState([
    { contact_name: '', relationship: '', phone: '' },
    { contact_name: '', relationship: '', phone: '' }
  ]);

  // Emergency Contacts handlers
  const handleEmergencyContactsChange = (index: number, field: string, value: string) => {
    setEmergencyContacts(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleEmergencyContactsSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId) {
      toastInfo('Please save Personal Details first.');
      return;
    }
    try {
      const res = await fetch('/api/employee_emergency_contacts', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: employeeId, contacts: emergencyContacts })
      });
      const data = await res.json();
      if (data.success) {
        toastSuccess('Emergency contacts saved!');
        setActiveTab('Job Details');
      } else {
        toastError('Save failed: ' + (data.error || 'Unknown'));
      }
    } catch (err) {
      toastError('Save failed: ' + String(err));
    }
  };

  // Contact Details handler
  const handleContactSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId) {
      toastInfo('Please save Personal Details first.');
      return;
    }
    try {
      const res = await fetch('/api/employee_contacts', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: employeeId,
          street1: contactAddress.street1,
          street2: "",
          city: contactAddress.city,
          state: contactAddress.state,
          zip: contactAddress.zip,
          country: contactAddress.country,
          permanent_street: permanentAddress.street,
          permanent_city: permanentAddress.city,
          permanent_state: permanentAddress.state,
          permanent_zip: permanentAddress.zip,
          permanent_country: permanentAddress.country,
          phone_home: "",
          phone_mobile: contactTelephone.mobile,
          phone_work: contactTelephone.work,
          email_work: contactEmail.work,
          email_other: contactEmail.other
        })
      });
      const data = await res.json();
      if (data.success) {
        toastSuccess('Contact details saved!');
        setActiveTab('Emergency Contacts');
      } else {
        toastError('Save failed: ' + (data.error || 'Unknown'));
      }
    } catch (err) {
      toastError('Save failed: ' + String(err));
    }
  };

  // Job Details state
  const [jobDetails, setJobDetails] = useState({
    joinedDate: "",
    firstAppraisalMonths: "",
    secondAppraisalMonths: "",
    jobTitle: "",
    jobSpecification: "",
    jobCategory: "",
    subUnit: "",
    location: "",
    employmentStatus: "",
    includeContract: false,
    departmentId: ""
  });

  // Job Details handler
  const handleJobDetailsSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId) {
      toastInfo('Please save Personal Details first.');
      return;
    }
    try {
      const res = await fetch('/api/employee_jobs', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: employeeId,
          joinedDate: jobDetails.joinedDate,
          firstAppraisalMonths: jobDetails.firstAppraisalMonths
            ? Number(jobDetails.firstAppraisalMonths)
            : null,
          secondAppraisalMonths: jobDetails.secondAppraisalMonths
            ? Number(jobDetails.secondAppraisalMonths)
            : null,
          jobTitle: jobDetails.jobTitle,
          jobSpecification: jobDetails.jobSpecification,
          jobCategory: jobDetails.jobCategory,
          subUnit: jobDetails.subUnit,
          location: jobDetails.location,
          employmentStatus: jobDetails.employmentStatus,
          includeContract: jobDetails.includeContract,
          departmentId: jobDetails.departmentId ? parseInt(jobDetails.departmentId) : null
        })
      });
      const data = await res.json();
      if (data.success) {
        toastSuccess('Job details saved!');
        setActiveTab('Allowances');
      } else {
        toastError('Save failed: ' + (data.error || 'Unknown'));
      }
    } catch (err) {
      toastError('Save failed: ' + String(err));
    }
  };

  // Allowances — defaults used by Monthly Payroll (Fuel + CTD)
  const [fuelAllowance, setFuelAllowance] = useState("");
  const [companyTransportDeduction, setCompanyTransportDeduction] = useState("");
  const [travelAllowanceType, setTravelAllowanceType] = useState<"fuel" | "ctd" | "">("");

  const handleAllowancesSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId) {
      toastInfo('Please save Personal Details first.');
      return;
    }
    try {
      const res = await fetch('/api/employee_salaries', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: employeeId,
          fuel_allowance:
            travelAllowanceType === "fuel"
              ? fuelAllowance === ""
                ? null
                : Number(fuelAllowance)
              : null,
          company_transport_deduction:
            travelAllowanceType === "ctd"
              ? companyTransportDeduction === ""
                ? null
                : Number(companyTransportDeduction)
              : null,
          allowancesOnly: true,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toastSuccess('Allowances saved!');
        setActiveTab('Salary');
      } else {
        toastError('Save failed: ' + (data.error || 'Unknown'));
      }
    } catch (err) {
      toastError('Save failed: ' + String(err));
    }
  };

  // Salary Details handler
  const handleSalarySave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId) {
      toastInfo('Please save Personal Details first.');
      return;
    }
    try {
      const res = await fetch('/api/employee_salaries', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: employeeId,
          ...salaryDetails
        })
      });
      const data = await res.json();
      if (data.success) {
        toastSuccess('Salary details saved!');
        setActiveTab('Appraisal');
        if (onSaved) onSaved();
      } else {
        toastError('Save failed: ' + (data.error || 'Unknown'));
      }
    } catch (err) {
      toastError('Save failed: ' + String(err));
    }
  };

  const handleAppraisalSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId) {
      toastInfo('Please save Personal Details first.');
      return;
    }
    try {
      const res = await fetch('/api/employee_jobs', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: employeeId,
          joinedDate: jobDetails.joinedDate,
          firstAppraisalMonths: jobDetails.firstAppraisalMonths
            ? Number(jobDetails.firstAppraisalMonths)
            : null,
          secondAppraisalMonths: jobDetails.secondAppraisalMonths
            ? Number(jobDetails.secondAppraisalMonths)
            : null,
          jobTitle: jobDetails.jobTitle,
          jobSpecification: jobDetails.jobSpecification,
          jobCategory: jobDetails.jobCategory,
          subUnit: jobDetails.subUnit,
          location: jobDetails.location,
          employmentStatus: jobDetails.employmentStatus,
          includeContract: jobDetails.includeContract,
          departmentId: jobDetails.departmentId ? parseInt(jobDetails.departmentId) : null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toastSuccess('Appraisal details saved!');
        setActiveTab('Attachments');
      } else {
        toastError('Save failed: ' + (data.error || 'Unknown'));
      }
    } catch (err) {
      toastError('Save failed: ' + String(err));
    }
  };

  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [fatherName, setFatherName] = useState("");
  const [employeeId, setEmployeeId] = useState<string | null>(editEmployeeId);
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("");
  const [maritalStatus, setMaritalStatus] = useState("");
  const [nationality, setNationality] = useState("");
  const [bloodGroup, setBloodGroup] = useState("");
  const [cnicNumber, setCnicNumber] = useState("");
  const [cnicIssuanceDate, setCnicIssuanceDate] = useState("");
  const [cnicExpiryDate, setCnicExpiryDate] = useState("");
  const [employmentStatus, setEmploymentStatus] = useState("");
  const [employmentType, setEmploymentType] = useState("");
  const [workingHours, setWorkingHours] = useState<string>("");
  // Role selection for hrm_employees
  const roleOptions = ["BOD/CEO", "HOD", "Management", "Leader", "Officer"] as const;
  const [role, setRole] = useState<string>("Officer");
  const [createLogin, setCreateLogin] = useState(false);
  const [profileImg, setProfileImg] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState("disabled");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [activeTab, setActiveTab] = useState(employeeTabs[0].name);
  useEffect(() => {
    setStatus(createLogin ? "active" : "disabled");
  }, [createLogin]);
  
  const [contactAddress, setContactAddress] = useState({ street1: "", street2: "", city: "", state: "", zip: "", country: "" });
  const [permanentAddress, setPermanentAddress] = useState({
    street: "",
    city: "",
    state: "",
    zip: "",
    country: "",
  });
  const [contactTelephone, setContactTelephone] = useState({ mobile: "", work: "" });
  const [contactEmail, setContactEmail] = useState({ work: "", other: "" });
  

  
  const [salaryDetails, setSalaryDetails] = useState({
    component: "",
    payGrade: "",
    payFrequency: "",
    currency: "",
    amount: "",
    comments: "",
    directDeposit: false,
    accountNumber: "",
    accountType: "",
    routingNumber: "",
    depositAmount: ""
  });

  // Helper function to format date to YYYY-MM-DD for date input
  function formatDateForInput(dateString: string | null | undefined): string {
    if (!dateString) return "";
    try {
      // Handle various date formats
      let date: Date;
      
      // If already in YYYY-MM-DD format
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        return dateString;
      }
      
      // Try parsing as ISO string or standard date
      date = new Date(dateString);
      
      // Check if date is valid
      if (isNaN(date.getTime())) {
        return "";
      }
      
      // Format as YYYY-MM-DD
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    } catch (e) {
      return "";
    }
  }

  // Prefill all form states in edit mode
  useEffect(() => {
    if (isEdit && editEmployeeId) {
      console.log('Fetching employee data for:', editEmployeeId);
      // 1. Personal Details
      fetch(`/api/hrm_employees?employeeId=${editEmployeeId}`)
        .then(res => res.json())
        .then(data => {
          console.log('HRM Employee data:', data);
          if (data.success && data.employee) {
            setFirstName(data.employee.first_name || "");
            setMiddleName(data.employee.pseudonym || data.employee.middle_name || "");
            setLastName(data.employee.last_name || "");
            setFatherName(data.employee.father_name || "");
            setEmployeeId(String(data.employee.id || editEmployeeId || ""));
            setDob(formatDateForInput(data.employee.dob));
            setGender(data.employee.gender || "");
            setMaritalStatus(data.employee.marital_status || "");
            setNationality(data.employee.nationality || "");
            setBloodGroup(data.employee.blood_group || "");
            setCnicNumber(data.employee.cnic_number || "");
            setCnicIssuanceDate(formatDateForInput(data.employee.cnic_issuance_date));
            setCnicExpiryDate(formatDateForInput(data.employee.cnic_expiry_date));
            setEmploymentStatus(data.employee.employment_status || "");
            setEmploymentType(data.employee.employment_type || "");
            setWorkingHours(
              data.employee.working_hours != null && data.employee.working_hours !== ""
                ? String(data.employee.working_hours)
                : ""
            );
            setProfileImg(data.employee.profile_img || null);
            setUsername(data.employee.username || "");
              // Set status to "enabled" - default for login details
              setStatus("enabled");
            setRole(data.employee.role || "Officer");
            setCreateLogin(!!data.employee.username);
              // Pre-fill password fields in edit mode with existing password
              if (data.employee.password) {
                setPassword(data.employee.password);
                setConfirmPassword(data.employee.password);
              }
          }
        })
        .catch(err => console.error('Error fetching personal details:', err));
      // 2. Contact Details - try both id and employee_code
      Promise.all([
        fetch(`/api/employee_contacts?employeeId=${editEmployeeId}`).then(r => r.json()),
        fetch(`/api/employee_contacts?employeeId=${employeeId}`).then(r => r.json())
      ]).then(([data1, data2]) => {
        const data = (data1.success ? data1 : data2);
        console.log('Contact data:', data);
        if (data.success && data.contact) {
          setContactAddress({
            street1: [data.contact.street1, data.contact.street2]
              .map((s: string) => (s || "").trim())
              .filter(Boolean)
              .join(", "),
            street2: "",
            city: data.contact.city || "",
            state: data.contact.state || "",
            zip: data.contact.zip || "",
            country: data.contact.country || ""
          });
          setPermanentAddress({
            street: data.contact.permanent_street || "",
            city: data.contact.permanent_city || "",
            state: data.contact.permanent_state || "",
            zip: data.contact.permanent_zip || "",
            country: data.contact.permanent_country || "",
          });
          setContactTelephone({
            mobile: data.contact.phone_mobile || "",
            work: data.contact.phone_work || ""
          });
          setContactEmail({
            work: data.contact.email_work || "",
            other: data.contact.email_other || ""
          });
        }
      })
      .catch(err => console.error('Error fetching contact details:', err));
      // 3. Emergency Contacts
      Promise.all([
        fetch(`/api/employee_emergency_contacts?employeeId=${editEmployeeId}`).then(r => r.json()),
        fetch(`/api/employee_emergency_contacts?employeeId=${employeeId}`).then(r => r.json())
      ]).then(([data1, data2]) => {
        const data = (data1.success ? data1 : data2);
        console.log('Emergency contacts data:', data);
        if (data.success && Array.isArray(data.contacts)) {
          setEmergencyContacts([
            data.contacts[0] || { contact_name: '', relationship: '', phone: '' },
            data.contacts[1] || { contact_name: '', relationship: '', phone: '' }
          ]);
        }
      })
      .catch(err => console.error('Error fetching emergency contacts:', err));
      // 4. Job Details
      Promise.all([
        fetch(`/api/employee_jobs?employeeId=${editEmployeeId}`).then(r => r.json()),
        fetch(`/api/employee_jobs?employeeId=${employeeId}`).then(r => r.json())
      ]).then(([data1, data2]) => {
        const data = (data1.success ? data1 : data2);
        console.log('Job details data:', data);
        if (data.success && data.job) {
          setJobDetails({
            joinedDate: formatDateForInput(data.job.joined_date),
            firstAppraisalMonths:
              data.job.first_appraisal_months != null
                ? String(data.job.first_appraisal_months)
                : "",
            secondAppraisalMonths:
              data.job.second_appraisal_months != null
                ? String(data.job.second_appraisal_months)
                : "",
            jobTitle: data.job.job_title || "",
            jobSpecification: data.job.job_specification || "",
            jobCategory: data.job.job_category || "",
            subUnit: data.job.sub_unit || "",
            location: data.job.location || "",
            employmentStatus: data.job.employment_status || "",
            includeContract: !!data.job.include_contract,
            departmentId: data.job.department_id ? String(data.job.department_id) : ""
          });
        }
      })
      .catch(err => console.error('Error fetching job details:', err));
      // 5. Salary Details
      Promise.all([
        fetch(`/api/employee_salaries?employeeId=${editEmployeeId}`).then(r => r.json()),
        fetch(`/api/employee_salaries?employeeId=${employeeId}`).then(r => r.json())
      ]).then(([data1, data2]) => {
        const data = (data1.success ? data1 : data2);
        console.log('Salary data:', data);
        if (data.success && data.salary) {
          setSalaryDetails(s => ({
            ...s,
            component: data.salary.component || "",
            payGrade: data.salary.pay_grade || "",
            payFrequency: data.salary.pay_frequency || "",
            currency: data.salary.currency || "",
            amount: data.salary.amount || "",
            comments: data.salary.comments || "",
            directDeposit: !!data.salary.direct_deposit,
            accountNumber: data.salary.account_number || "",
            accountType: data.salary.account_type || "",
            routingNumber: data.salary.routing_number || "",
            depositAmount: data.salary.deposit_amount || ""
          }));
          if (data.salary.fuel_allowance != null && data.salary.fuel_allowance !== "") {
            setFuelAllowance(String(data.salary.fuel_allowance));
          }
          if (
            data.salary.company_transport_deduction != null &&
            data.salary.company_transport_deduction !== ""
          ) {
            setCompanyTransportDeduction(String(data.salary.company_transport_deduction));
          }
          if (data.salary.fuel_allowance != null && data.salary.fuel_allowance !== "") {
            setTravelAllowanceType("fuel");
          } else if (
            data.salary.company_transport_deduction != null &&
            data.salary.company_transport_deduction !== ""
          ) {
            setTravelAllowanceType("ctd");
          }
        }
      })
      .catch(err => console.error('Error fetching salary details:', err));
    }
  }, [isEdit, editEmployeeId]);

  // Sync employment status from Personal Details to Job Details
  useEffect(() => {
    if (employmentStatus) {
      setJobDetails(prev => ({
        ...prev,
        employmentStatus: employmentStatus
      }));
    }
  }, [employmentStatus]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size <= 1024 * 1024) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          setProfileImg(ev.target?.result as string);
        };
        reader.readAsDataURL(file);
      } else {
        toastInfo("File size must be less than 1MB");
      }
    }
  };

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (createLogin && password !== confirmPassword) {
      toastError('Password and Confirm Password do not match');
      return;
    }
    if (!employmentType) {
      toastError("Please select Employment Type");
      return;
    }
    if (employmentType === "Part Time") {
      const n = Number(workingHours);
      if (!Number.isInteger(n) || n < 1 || n > 6) {
        toastError("Part Time: select working hours from 1 to 6");
        return;
      }
    }
    // Do not require employeeId before save; it will be set after backend returns it
    const hrmPayload: any = {
      first_name: firstName || '',
      middle_name: middleName || '',
      last_name: lastName || '',
      father_name: fatherName || '',
      employee_code: '', // optional, not used for assignment
      dob: dob || '',
      gender: gender || '',
      marital_status: maritalStatus || '',
      nationality: nationality || '',
      blood_group: bloodGroup || '',
      cnic_number: cnicNumber || '',
      cnic_issuance_date: cnicIssuanceDate || '',
      cnic_expiry_date: cnicExpiryDate || '',
      employment_status: employmentStatus || '',
      employment_type: employmentType || '',
      working_hours:
        employmentType === "Full Time"
          ? 9
          : employmentType === "Part Time"
            ? Number(workingHours) || null
            : null,
      profile_img: profileImg || '',
      username: createLogin ? username : '',
      password: createLogin ? password : '',
      status: createLogin ? 'active' : 'disabled',
      role: role || 'Officer'
    };
    // Removed unused payload and reference to finalEmployeeId
    const editIdentifier = String(employeeId || editEmployeeId || '').trim();
    const editTargetPayload = /^\d+$/.test(editIdentifier)
      ? { id: Number(editIdentifier) }
      : { employee_code: editIdentifier };

    let hrmRes = await fetch('/api/hrm_employees', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isEdit ? { ...hrmPayload, ...editTargetPayload } : hrmPayload)
    });
    let hrmData = await hrmRes.json();
    if (!hrmData.success) {
      if (hrmData.error) {
        toastError('Save failed: ' + hrmData.error);
      } else {
        toastError('Save failed: Unknown');
      }
      return;
    }
    if (!isEdit && hrmData.id) {
      setEmployeeId(hrmData.id.toString());
    }
    toastSuccess(isEdit ? 'Employee updated.' : 'Employee saved.');
    setActiveTab('Contact Details');
  }

  return (
    <div className={styles.pageShell}>
      <aside className={styles.stepNav}>
        <p className={styles.stepNavTitle}>Onboarding steps</p>
        <nav className={styles.nav}>
          {employeeTabs.map(tab => {
            const isActive = activeTab === tab.name;
            return (
              <button
                type="button"
                key={tab.name}
                onClick={() => setActiveTab(tab.name)}
                className={isActive ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem}
              >
                {tab.name}
              </button>
            );
          })}
        </nav>
      </aside>
      <div className={styles.formPanel}>
        <div className={styles.formCard}>
          <header className={styles.formHeader}>
            <h1 className={styles.heading}>{isEdit ? "Edit Employee" : "Add Employee"}</h1>
            <p className={styles.subheading}>
              {activeTab} — complete the fields below and save to continue onboarding.
            </p>
          </header>
          {activeTab === "Personal Details" && (
            <form className={styles.form} onSubmit={handleSave}>
              <div className={styles.profileRow}>
                <div className={styles.profileImg}>
                  <Image src={profileImg || "/avatar.svg"} alt="Profile" width={90} height={90} />
                  <label htmlFor="profileImg" className={styles.uploadBtn}>
                    +
                    <input id="profileImg" type="file" accept=".jpg,.png,.gif" style={{ display: "none" }} onChange={handleImageChange} />
                  </label>
                </div>
                <p className={styles.note}>
                  Accepts jpg, png, gif up to 1MB.<br />Recommended dimensions: 200px × 200px
                </p>
              </div>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>First Name</label>
                  <input className={styles.input} type="text" placeholder="First Name" value={firstName} onChange={e => setFirstName(e.target.value)} required />
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>Last Name</label>
                  <input className={styles.input} type="text" placeholder="Last Name" value={lastName} onChange={e => setLastName(e.target.value)} required />
                </div>
              </div>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>Father Name</label>
                  <input className={styles.input} type="text" placeholder="Father Name" value={fatherName} onChange={e => setFatherName(e.target.value)} />
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>Pseudo Name</label>
                  <input className={styles.input} type="text" placeholder="Pseudonym" value={middleName} onChange={e => setMiddleName(e.target.value)} />
                </div>
              </div>
              <div>
                <label className={styles.fieldLabel}>Employee Id</label>
                <input className={styles.input} type="text" placeholder="Employee Id (auto)" value={employeeId || ''} readOnly />
              </div>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>Date of Birth</label>
                  <input className={styles.input} type="date" placeholder="Date of Birth" value={dob} onChange={e => setDob(e.target.value)} />
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>Gender</label>
                  <select className={styles.select} value={gender} onChange={e => setGender(e.target.value)}>
                    <option value="">Gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>Marital Status</label>
                  <select className={styles.select} value={maritalStatus} onChange={e => setMaritalStatus(e.target.value)}>
                    <option value="">Marital Status</option>
                    <option value="single">Single</option>
                    <option value="married">Married</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div>
                <label className={styles.fieldLabel}>Nationality</label>
                <div className={styles.row}>
                  <input className={styles.input} type="text" placeholder="Nationality" value={nationality} onChange={e => setNationality(e.target.value)} />
                </div>
              </div>
              <div>
                <label className={styles.fieldLabel}>Blood Group</label>
                <div className={styles.row}>
                  <select className={styles.select} value={bloodGroup} onChange={e => setBloodGroup(e.target.value)}>
                    <option value="">Select Blood Group</option>
                    <option value="A+">A+</option>
                    <option value="A-">A-</option>
                    <option value="B+">B+</option>
                    <option value="B-">B-</option>
                    <option value="AB+">AB+</option>
                    <option value="AB-">AB-</option>
                    <option value="O+">O+</option>
                    <option value="O-">O-</option>
                  </select>
                </div>
              </div>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>CNIC #</label>
                  <input className={styles.input} type="text" placeholder="CNIC #" value={cnicNumber} onChange={e => setCnicNumber(e.target.value)} />
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>CNIC Issuance Date</label>
                  <input className={styles.input} type="date" value={cnicIssuanceDate} onChange={e => setCnicIssuanceDate(e.target.value)} />
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>CNIC Expiry Date</label>
                  <input className={styles.input} type="date" value={cnicExpiryDate} onChange={e => setCnicExpiryDate(e.target.value)} />
                </div>
              </div>
              <div>
                <label className={styles.fieldLabel}>Employment Status</label>
                <select 
                  className={styles.select} 
                  value={employmentStatus} 
                  onChange={e => setEmploymentStatus(e.target.value)} 
                  required
                >
                  <option value="">Select Employment Status</option>
                  <option value="Probation">Probation</option>
                  <option value="Permanent">Permanent</option>
                </select>
              </div>
              <div>
                <label className={styles.fieldLabel}>Employment Type</label>
                <select
                  className={styles.select}
                  value={employmentType}
                  onChange={(e) => {
                    const next = e.target.value;
                    setEmploymentType(next);
                    if (next === "Full Time") {
                      setWorkingHours("9");
                    } else if (next === "Part Time") {
                      setWorkingHours((prev) => {
                        const n = Number(prev);
                        return n >= 1 && n <= 6 ? String(n) : "";
                      });
                    } else {
                      setWorkingHours("");
                    }
                  }}
                  required
                >
                  <option value="">Select Employment Type</option>
                  <option value="Full Time">Full Time</option>
                  <option value="Part Time">Part Time</option>
                </select>
              </div>
              {employmentType === "Full Time" ? (
                <div>
                  <label className={styles.fieldLabel}>Working Hours</label>
                  <input
                    className={styles.input}
                    type="text"
                    value="9 hours"
                    readOnly
                    style={{ background: "#f8fafc", color: "#334155", cursor: "default" }}
                  />
                </div>
              ) : null}
              {employmentType === "Part Time" ? (
                <div>
                  <label className={styles.fieldLabel}>Working Hours</label>
                  <select
                    className={styles.select}
                    value={workingHours}
                    onChange={(e) => setWorkingHours(e.target.value)}
                    required
                  >
                    <option value="">Select hours (1–6)</option>
                    {[1, 2, 3, 4, 5, 6].map((h) => (
                      <option key={h} value={String(h)}>
                        {h} {h === 1 ? "hour" : "hours"}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div>
                <label className={styles.fieldLabel}>Role</label>
                <select className={styles.select} value={role} onChange={e => setRole(e.target.value)} required>
                  <option value="">Select Role</option>
                  <option value="BOD/CEO">BOD/CEO</option>
                  <option value="HOD">HOD</option>
                  <option value="Management">Management</option>
                  <option value="Leader">Leader</option>
                  <option value="Officer">Officer</option>
                </select>
              </div>
              <div className={styles.toggleRow}>
                <span className={styles.toggleLabel}>Create Login Details</span>
                <label style={{ display: "inline-block", position: "relative", width: 40, height: 22 }}>
                  <input type="checkbox" checked={createLogin} onChange={e => setCreateLogin(e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
                  <span style={{ position: "absolute", cursor: "pointer", top: 0, left: 0, right: 0, bottom: 0, background: createLogin ? "#611f69" : "#E2E8F0", borderRadius: 22, transition: "background 0.2s" }}></span>
                  <span style={{ position: "absolute", left: createLogin ? 20 : 2, top: 2, width: 18, height: 18, background: "#fff", borderRadius: "50%", boxShadow: "0 1px 4px rgba(97,31,105,0.15)", transition: "left 0.2s" }}></span>
                </label>
              </div>
              {createLogin && (
                <div className={styles.loginBox}>
                  <div className={styles.row}>
                    <div className={styles.field}>
                      <label className={styles.fieldLabel}>Username*</label>
                      <input className={styles.input} type="text" placeholder="Username*" value={username} onChange={e => setUsername(e.target.value)} required />
                    </div>
                    <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 8 }}>
                      <div className={styles.field}>
                        <label className={styles.fieldLabel}>Status</label>
                        <div style={{ display: "flex", gap: 12 }}>
                          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                            <input type="radio" name="status" value="enabled" checked={status === "enabled"} onChange={() => setStatus("enabled")}/>
                            <span className={status === "enabled" ? styles.radioLabelActive : styles.radioLabel}>Enabled</span>
                          </label>
                          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                            <input type="radio" name="status" value="disabled" checked={status === "disabled"} onChange={() => setStatus("disabled")}/>
                            <span className={status === "disabled" ? styles.radioLabelActive : styles.radioLabel}>Disabled</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className={styles.row}>
                    <div className={styles.field}>
                      <label className={styles.fieldLabel}>Password*</label>
                      <input className={styles.input} type="password" placeholder="Password*" value={password} onChange={e => setPassword(e.target.value)} required={!isEdit} />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.fieldLabel}>Confirm Password*</label>
                      <input className={styles.input} type="password" placeholder="Confirm Password*" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required={!isEdit} />
                    </div>
                  </div>
                  <div className={styles.note}>
                    For a strong password, please use a hard to guess combination of text with upper and lower case characters, symbols and numbers
                    {isEdit && " (Leave empty to keep current password)"}
                  </div>
                </div>
              )}
              <div className={styles.actions}>
                <button type="button" className={styles.cancelBtn}>Cancel</button>
                <button type="submit" className={styles.saveBtn}>Save</button>
              </div>
            </form>
          )}
          {activeTab === "Contact Details" && (
            <div>
              {employeeId && (
                <div className={styles.employeeBadge}>
                  Employee: {firstName} {lastName} (ID: {employeeId})
                </div>
              )}
              <form className={styles.form} style={{ width: "100%" }} onSubmit={handleContactSave}>
                <p className={styles.sectionTitle}>Current Address</p>
                <div className={styles.row}>
                  <div className={styles.field} style={{ flex: 1, minWidth: "100%" }}>
                    <label className={styles.fieldLabel}>Street/House/Area</label>
                    <input
                      className={styles.input}
                      type="text"
                      placeholder="Street/House/Area"
                      value={contactAddress.street1}
                      onChange={e => setContactAddress(a => ({ ...a, street1: e.target.value, street2: "" }))}
                      required
                    />
                  </div>
                </div>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>City</label>
                    <input className={styles.input} type="text" placeholder="City" value={contactAddress.city} onChange={e => setContactAddress(a => ({ ...a, city: e.target.value }))} required />
                  </div>
                </div>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>State/Province</label>
                    <input className={styles.input} type="text" placeholder="State/Province" value={contactAddress.state} onChange={e => setContactAddress(a => ({ ...a, state: e.target.value }))} required />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Zip/Postal Code</label>
                    <input className={styles.input} type="text" placeholder="Zip/Postal Code" value={contactAddress.zip} onChange={e => setContactAddress(a => ({ ...a, zip: e.target.value }))} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Country</label>
                    <select className={styles.select} value={contactAddress.country} onChange={e => setContactAddress(a => ({ ...a, country: e.target.value }))} required>
                      <option value="">-- Select --</option>
                      <option value="Pakistan">Pakistan</option>
                      <option value="India">India</option>
                      <option value="UAE">UAE</option>
                      <option value="USA">USA</option>
                      <option value="UK">UK</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>
                <p className={styles.sectionTitle}>Permanent Address</p>
                <div className={styles.row}>
                  <div className={styles.field} style={{ flex: 1, minWidth: "100%" }}>
                    <label className={styles.fieldLabel}>Street/House/Area</label>
                    <input
                      className={styles.input}
                      type="text"
                      placeholder="Street/House/Area"
                      value={permanentAddress.street}
                      onChange={e => setPermanentAddress(a => ({ ...a, street: e.target.value }))}
                    />
                  </div>
                </div>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>City</label>
                    <input className={styles.input} type="text" placeholder="City" value={permanentAddress.city} onChange={e => setPermanentAddress(a => ({ ...a, city: e.target.value }))} />
                  </div>
                </div>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>State/Province</label>
                    <input className={styles.input} type="text" placeholder="State/Province" value={permanentAddress.state} onChange={e => setPermanentAddress(a => ({ ...a, state: e.target.value }))} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Zip/Postal Code</label>
                    <input className={styles.input} type="text" placeholder="Zip/Postal Code" value={permanentAddress.zip} onChange={e => setPermanentAddress(a => ({ ...a, zip: e.target.value }))} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Country</label>
                    <select className={styles.select} value={permanentAddress.country} onChange={e => setPermanentAddress(a => ({ ...a, country: e.target.value }))}>
                      <option value="">-- Select --</option>
                      <option value="Pakistan">Pakistan</option>
                      <option value="India">India</option>
                      <option value="UAE">UAE</option>
                      <option value="USA">USA</option>
                      <option value="UK">UK</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>
                <p className={styles.sectionTitle}>Telephone</p>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Personal Mobile</label>
                    <input className={styles.input} type="text" placeholder="Personal Mobile" value={contactTelephone.mobile} onChange={e => setContactTelephone(t => ({ ...t, mobile: e.target.value }))} required />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Work</label>
                    <input className={styles.input} type="text" placeholder="Work" value={contactTelephone.work} onChange={e => setContactTelephone(t => ({ ...t, work: e.target.value }))} />
                  </div>
                </div>
                <p className={styles.sectionTitle}>Email</p>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Work Email</label>
                    <input className={styles.input} type="email" placeholder="Work Email" value={contactEmail.work} onChange={e => setContactEmail(em => ({ ...em, work: e.target.value }))} required />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Personal Email</label>
                    <input className={styles.input} type="email" placeholder="Personal Email" value={contactEmail.other} onChange={e => setContactEmail(em => ({ ...em, other: e.target.value }))} />
                  </div>
                </div>
                <div className={styles.actionsLeft}>
                  <button type="submit" className={styles.saveBtn}>Save</button>
                </div>
              </form>
            </div>
          )}
          {activeTab === "Emergency Contacts" && (
            <div>
              {employeeId && (
                <div className={styles.employeeBadge}>
                  Employee: {firstName} {lastName} (ID: {employeeId})
                </div>
              )}
              <form className={styles.form} style={{ width: '100%' }} onSubmit={handleEmergencyContactsSave}>
                <p className={styles.sectionTitle}>Emergency Contact 1</p>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Name</label>
                    <input className={styles.input} placeholder="Name" value={emergencyContacts[0].contact_name} onChange={e => handleEmergencyContactsChange(0, 'contact_name', e.target.value)} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Relationship</label>
                    <input className={styles.input} placeholder="Relationship" value={emergencyContacts[0].relationship} onChange={e => handleEmergencyContactsChange(0, 'relationship', e.target.value)} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Phone</label>
                    <input className={styles.input} placeholder="Phone" value={emergencyContacts[0].phone} onChange={e => handleEmergencyContactsChange(0, 'phone', e.target.value)} />
                  </div>
                </div>
                <p className={styles.sectionTitle}>Emergency Contact 2</p>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Name</label>
                    <input className={styles.input} placeholder="Name" value={emergencyContacts[1].contact_name} onChange={e => handleEmergencyContactsChange(1, 'contact_name', e.target.value)} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Relationship</label>
                    <input className={styles.input} placeholder="Relationship" value={emergencyContacts[1].relationship} onChange={e => handleEmergencyContactsChange(1, 'relationship', e.target.value)} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Phone</label>
                    <input className={styles.input} placeholder="Phone" value={emergencyContacts[1].phone} onChange={e => handleEmergencyContactsChange(1, 'phone', e.target.value)} />
                  </div>
                </div>
                <div className={styles.actionsLeft}>
                  <button type="submit" className={styles.saveBtn}>Save</button>
                </div>
              </form>
            </div>
          )}
          {activeTab === "Job Details" && (
            <div>
              {employeeId && (
                <div className={styles.employeeBadge}>
                  Employee: {firstName} {lastName} (ID: {employeeId})
                </div>
              )}
              <form className={styles.form} style={{ width: "100%" }} onSubmit={handleJobDetailsSave}>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Date of Joining</label>
                    <input className={styles.input} type="date" placeholder="Date of Joining" value={jobDetails.joinedDate} onChange={e => setJobDetails(j => ({ ...j, joinedDate: e.target.value }))} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Job Title</label>
                    <input className={styles.input} type="text" placeholder="Job Title" value={jobDetails.jobTitle} onChange={e => setJobDetails(j => ({ ...j, jobTitle: e.target.value }))} />
                  </div>
                </div>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Job Specification</label>
                    <input className={styles.input} type="text" placeholder="Job Specification" value={jobDetails.jobSpecification} onChange={e => setJobDetails(j => ({ ...j, jobSpecification: e.target.value }))} />
                  </div>
                </div>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Department</label>
                    <select className={styles.select} value={jobDetails.departmentId || ""} onChange={e => setJobDetails(j => ({ ...j, departmentId: e.target.value }))} required>
                      <option value="">-- Select Department --</option>
                      {departments.map(dep => (
                        <option key={dep.id} value={dep.id}>{dep.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Location</label>
                    <input className={styles.input} type="text" placeholder="Location" value={jobDetails.location} onChange={e => setJobDetails(j => ({ ...j, location: e.target.value }))} />
                  </div>
                </div>
                <div className={styles.actionsLeft}>
                  <button type="submit" className={styles.saveBtn}>Save</button>
                </div>
              </form>
            </div>
          )}
          {activeTab === "Allowances" && (
            <div>
              {employeeId && (
                <div className={styles.employeeBadge}>
                  Employee: {firstName} {lastName} (ID: {employeeId})
                </div>
              )}
              <form className={styles.form} style={{ width: "100%" }} onSubmit={handleAllowancesSave}>
                <p className={styles.note}>
                  These defaults feed Monthly Payroll. You can still override Fuel Allowance and Company Transport Deduction (CTD) per month on the payroll page.
                </p>
                <p className={styles.sectionTitle}>Travel Allowance</p>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Type</label>
                    <select
                      className={styles.select}
                      value={travelAllowanceType}
                      onChange={(e) =>
                        setTravelAllowanceType(e.target.value as "fuel" | "ctd" | "")
                      }
                    >
                      <option value="">-- Select --</option>
                      <option value="fuel">Fuel Allowance</option>
                      <option value="ctd">CT Deduction</option>
                    </select>
                  </div>
                </div>
                {travelAllowanceType === "fuel" && (
                  <div className={styles.row}>
                    <div className={styles.field}>
                      <label className={styles.fieldLabel}>Fuel Allowance</label>
                      <input
                        className={styles.input}
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="e.g. 5000"
                        value={fuelAllowance}
                        onChange={(e) => setFuelAllowance(e.target.value)}
                      />
                    </div>
                  </div>
                )}
                {travelAllowanceType === "ctd" && (
                  <div className={styles.row}>
                    <div className={styles.field}>
                      <label className={styles.fieldLabel}>CT Deduction</label>
                      <input
                        className={styles.input}
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="e.g. 3000"
                        value={companyTransportDeduction}
                        onChange={(e) => setCompanyTransportDeduction(e.target.value)}
                      />
                    </div>
                  </div>
                )}
                <div className={styles.actionsLeft}>
                  <button type="submit" className={styles.saveBtn}>Save</button>
                </div>
              </form>
            </div>
          )}
          {activeTab === "Salary" && (
            <div>
              {employeeId && (
                <div className={styles.employeeBadge}>
                  Employee: {firstName} {lastName} (ID: {employeeId})
                </div>
              )}
              <form className={styles.form} style={{ width: "100%" }} onSubmit={handleSalarySave}>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Pay Frequency</label>
                    <select className={styles.select} value={salaryDetails.payFrequency} onChange={e => setSalaryDetails(s => ({ ...s, payFrequency: e.target.value }))}>
                      <option value="">-- Select --</option>
                      <option value="Monthly">Monthly</option>
                      <option value="Weekly">Weekly</option>
                      <option value="Yearly">Yearly</option>
                    </select>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Currency</label>
                    <select className={styles.select} value={salaryDetails.currency} onChange={e => setSalaryDetails(s => ({ ...s, currency: e.target.value }))}>
                      <option value="">-- Select --</option>
                      <option value="PKR">PKR</option>
                      <option value="USD">USD</option>
                      <option value="INR">INR</option>
                      <option value="AED">AED</option>
                    </select>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Amount*</label>
                    <input className={styles.input} type="number" placeholder="Amount*" value={salaryDetails.amount} onChange={e => setSalaryDetails(s => ({ ...s, amount: e.target.value }))} />
                  </div>
                </div>
                <div className={styles.row}>
                  <textarea className={styles.input} placeholder="Comments" value={salaryDetails.comments} onChange={e => setSalaryDetails(s => ({ ...s, comments: e.target.value }))} style={{ minHeight: 60, resize: "vertical" }} />
                </div>
                <div style={{ margin: "18px 0 10px 0", display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontWeight: 600 }}>Include Direct Deposit Details</span>
                  <label style={{ display: "inline-block", position: "relative", width: 40, height: 22 }}>
                    <input type="checkbox" checked={salaryDetails.directDeposit} onChange={e => setSalaryDetails(s => ({ ...s, directDeposit: e.target.checked }))} style={{ opacity: 0, width: 0, height: 0 }} />
                    <span style={{ position: "absolute", cursor: "pointer", top: 0, left: 0, right: 0, bottom: 0, background: salaryDetails.directDeposit ? "#FFA726" : "#E2E8F0", borderRadius: 22, transition: "background 0.2s" }}></span>
                    <span style={{ position: "absolute", left: salaryDetails.directDeposit ? 20 : 2, top: 2, width: 18, height: 18, background: "#fff", borderRadius: "50%", boxShadow: "0 1px 4px rgba(0,82,204,0.12)", transition: "left 0.2s" }}></span>
                  </label>
                </div>
                {salaryDetails.directDeposit && (
                  <div>
                    <div className={styles.row}>
                      <div className={styles.field}>
                        <label className={styles.fieldLabel}>Account Number / IBAN</label>
                        <input className={styles.input} type="text" placeholder="Account Number / IBAN" value={salaryDetails.accountNumber} onChange={e => setSalaryDetails(s => ({ ...s, accountNumber: e.target.value }))} />
                      </div>
                      <div className={styles.field}>
                        <label className={styles.fieldLabel}>Bank Name</label>
                        <input className={styles.input} type="text" placeholder="Bank Name" value={salaryDetails.routingNumber} onChange={e => setSalaryDetails(s => ({ ...s, routingNumber: e.target.value }))} />
                      </div>
                    </div>
                  </div>
                )}
                <div className={styles.actions}>
                  <button type="button" className={styles.cancelBtn}>Cancel</button>
                  <button type="submit" className={styles.saveBtn}>Save</button>
                </div>
              </form>
            </div>
          )}
          {activeTab === "Appraisal" && (
            <div>
              {employeeId && (
                <div className={styles.employeeBadge}>
                  Employee: {firstName} {lastName} (ID: {employeeId})
                </div>
              )}
              <form className={styles.form} style={{ width: "100%" }} onSubmit={handleAppraisalSave}>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>1st Appraisal Timing</label>
                    <select
                      className={styles.select}
                      value={jobDetails.firstAppraisalMonths}
                      onChange={(e) =>
                        setJobDetails((j) => ({ ...j, firstAppraisalMonths: e.target.value }))
                      }
                    >
                      <option value="">Select 1st appraisal</option>
                      <option value="3">After 3 months</option>
                      <option value="6">After 6 months</option>
                    </select>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>2nd Appraisal Timing</label>
                    <select
                      className={styles.select}
                      value={jobDetails.secondAppraisalMonths}
                      onChange={(e) =>
                        setJobDetails((j) => ({ ...j, secondAppraisalMonths: e.target.value }))
                      }
                    >
                      <option value="">Select 2nd appraisal</option>
                      <option value="7">After 7 months</option>
                      <option value="8">After 8 months</option>
                      <option value="12">Annual (12 months)</option>
                    </select>
                  </div>
                </div>
                <div className={styles.actionsLeft}>
                  <button type="submit" className={styles.saveBtn}>Save</button>
                </div>
              </form>
            </div>
          )}
          {activeTab === "Attachments" && (
            <div>
              {employeeId ? (
                <AttachmentsUploader employeeId={employeeId} />
              ) : (
                <div style={{ color: '#C00', fontWeight: 500 }}>Please save Personal Details first.</div>
              )}
            </div>
          )}
          <p className={styles.requiredNote}>* Required</p>
        </div>
      </div>
    </div>
  );
}
