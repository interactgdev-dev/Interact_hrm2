"use client";
import React, { useState } from "react";
import styles from "../../add-employee/add-employee.module.css";
import { useRouter, usePathname } from "next/navigation";

const employeeTabs = [
	{ name: "Employee List", path: "/employee-list" },
	{ name: "Personal Details", path: "/employee-details/personal" },
	{ name: "Contact Details", path: "/employee-details/contact" },
	{ name: "Emergency Contacts", path: "/employee-details/emergency" },
	{ name: "Dependents", path: "/employee-details/dependents" },
	{ name: "Job", path: "/employee-details/job" },
	{ name: "Salary", path: "/employee-details/salary" },
];

export default function JobPage() {
	const router = useRouter();
	const pathname = usePathname();
	const [job, setJob] = useState({
		joinedDate: "",
		jobTitle: "",
		jobSpecification: "Not Defined",
		jobCategory: "",
		subUnit: "",
		location: "",
		employmentStatus: "",
		includeContract: false,
	});

	async function handleSave(e: React.FormEvent) {
		e.preventDefault();
		const eid = window.prompt('Enter Employee ID to save job details for (employee_id):');
		if (!eid) { alert('Employee ID is required'); return; }
		const payload = { details: { employeeId: eid, job } };
		try {
			// Example placeholder for saving job details
			const res = await fetch('/api/employee_jobs', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			const data = await res.json();
			if (data.success) alert('Job details saved'); else alert('Save failed: ' + (data.error || 'Unknown'));
		} catch (err) { alert('Save failed: ' + String(err)); }
	}

	return (
		<div
			style={{
				display: "flex",
				minHeight: "100vh",
				background: "#F7FAFC",
			}}
		>
			<aside className={styles.sidebar}>
				<div
					style={{
						width: "100%",
						display: "flex",
						justifyContent: "center",
						alignItems: "center",
						margin: "18px 0 12px 0",
					}}
				>
					<button
						aria-label="Back to Dashboard"
						onClick={() => router.push("/dashboard")}
						style={{
							background: "#fff",
							border: "none",
							borderRadius: "50%",
							boxShadow: "0 2px 8px rgba(0,82,204,0.10)",
							width: 44,
							height: 44,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							cursor: "pointer",
						}}
					>
						<svg
							width="28"
							height="28"
							viewBox="0 0 28 28"
							fill="none"
							xmlns="http://www.w3.org/2000/svg"
						>
							<circle cx="14" cy="14" r="14" fill="#0052CC" />
							<path
								d="M16.5 9L12.5 14L16.5 19"
								stroke="#fff"
								strokeWidth="2.2"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
					</button>
				</div>
				<nav className={styles.nav}>
					{employeeTabs.map((tab) => {
						const isActive = pathname === tab.path;
						return (
							<div
								key={tab.name}
								onClick={() => router.push(tab.path)}
								className={
									isActive
										? `${styles.navItem} ${styles.navItemActive}`
										: styles.navItem
								}
							>
								<span>{tab.name}</span>
							</div>
						);
					})}
				</nav>
			</aside>
			<div
				style={{
					flex: 1,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<div className={styles.formCard}>
					<h2 className={styles.heading}>Job Details</h2>
					<form className={styles.form} style={{ width: "100%" }} onSubmit={handleSave}>
						<div className={styles.row}>
							<input
								className={styles.input}
								type="date"
								placeholder="Joined Date"
								value={job.joinedDate}
								onChange={(e) =>
									setJob((j) => ({
										...j,
										joinedDate: e.target.value,
									}))
								}
							/>
							<select
								className={styles.select}
								value={job.jobTitle}
								onChange={(e) =>
									setJob((j) => ({ ...j, jobTitle: e.target.value }))
								}
							>
								<option value="">-- Select Job Title --</option>
								<option value="Software Engineer">
									Software Engineer
								</option>
								<option value="HR Manager">HR Manager</option>
								<option value="Accountant">Accountant</option>
								<option value="Other">Other</option>
							</select>
							<input
								className={styles.input}
								type="text"
								placeholder="Job Specification"
								value={job.jobSpecification}
								onChange={(e) =>
									setJob((j) => ({
										...j,
										jobSpecification: e.target.value,
									}))
								}
							/>
						</div>
						<div className={styles.row}>
							<select
								className={styles.select}
								value={job.jobCategory}
								onChange={(e) =>
									setJob((j) => ({ ...j, jobCategory: e.target.value }))
								}
							>
								<option value="">-- Select Job Category --</option>
								<option value="IT">IT</option>
								<option value="HR">HR</option>
								<option value="Finance">Finance</option>
								<option value="Other">Other</option>
							</select>
							<select
								className={styles.select}
								value={job.subUnit}
								onChange={(e) =>
									setJob((j) => ({ ...j, subUnit: e.target.value }))
								}
							>
								<option value="">-- Select Sub Unit --</option>
								<option value="Development">Development</option>
								<option value="Recruitment">Recruitment</option>
								<option value="Accounts">Accounts</option>
								<option value="Other">Other</option>
							</select>
							<select
								className={styles.select}
								value={job.location}
								onChange={(e) =>
									setJob((j) => ({ ...j, location: e.target.value }))
								}
							>
								<option value="">-- Select Location --</option>
								<option value="Lahore">Lahore</option>
								<option value="Karachi">Karachi</option>
								<option value="Islamabad">Islamabad</option>
								<option value="Other">Other</option>
							</select>
						</div>
						<div className={styles.row}>
							<select
								className={styles.select}
								value={job.employmentStatus}
								onChange={(e) =>
									setJob((j) => ({ ...j, employmentStatus: e.target.value }))
								}
							>
								<option value="">-- Select Employment Status --</option>
								<option value="Permanent">Permanent</option>
								<option value="Contract">Contract</option>
								<option value="Intern">Intern</option>
								<option value="Other">Other</option>
							</select>
						</div>
						<div
							style={{
								margin: "18px 0 10px 0",
								display: "flex",
								alignItems: "center",
								gap: 12,
							}}
						>
							<span style={{ fontWeight: 600 }}>
								Include Employment Contract Details
							</span>
							<label
								style={{
									display: "inline-block",
									position: "relative",
									width: 40,
									height: 22,
								}}
							>
								<input
									type="checkbox"
									checked={job.includeContract}
									onChange={(e) =>
										setJob((j) => ({
											...j,
											includeContract: e.target.checked,
										}))
									}
									style={{
										opacity: 0,
										width: 0,
										height: 0,
									}}
								/>
								<span
									style={{
										position: "absolute",
										cursor: "pointer",
										top: 0,
										left: 0,
										right: 0,
										bottom: 0,
										background: job.includeContract
											? "#0052CC"
											: "#E2E8F0",
										borderRadius: 22,
										transition: "background 0.2s",
									}}
								></span>
								<span
									style={{
										position: "absolute",
										left: job.includeContract ? 20 : 2,
										top: 2,
										width: 18,
										height: 18,
										background: "#fff",
										borderRadius: "50%",
										boxShadow:
											"0 1px 4px rgba(0,82,204,0.12)",
										transition: "left 0.2s",
									}}
								></span>
							</label>
						</div>
						<div
							style={{
								display: "flex",
								justifyContent: "flex-end",
								marginTop: 18,
							}}
						>
							<button
								type="submit"
								style={{
									background: "#8BC34A",
									color: "#fff",
									border: "none",
									borderRadius: 8,
									padding: "10px 32px",
									fontWeight: 600,
									fontSize: "1.08rem",
									cursor: "pointer",
									boxShadow: "0 2px 8px rgba(0,82,204,0.10)",
								}}
							>
								Save
							</button>
						</div>
					</form>
				</div>
			</div>
		</div>
	);
}
