"use client";
import React from "react";
import { useRouter, usePathname } from "next/navigation";
import styles from "./layout-dashboard.module.css";
import "./globals.css";
import "./dashboard/nexatech-theme.module.css";
import { FaTachometerAlt, FaUserShield, FaCalendarAlt, FaClock, FaUserPlus, FaIdBadge, FaListAlt, FaClipboardList, FaBuilding, FaCog, FaUser, FaChartBar, FaKey, FaCalendarCheck, FaEdit, FaCoffee, FaFileAlt, FaDollarSign, FaExchangeAlt, FaTicketAlt, FaFolderOpen, FaDesktop, FaImages } from "react-icons/fa";
import { FiChevronDown, FiChevronRight } from "react-icons/fi";
import { EmployeeAvatar } from "./components/EmployeeAvatar";
import { AdminProfileMenu } from "./components/AdminProfileMenu";
import { AdminActivityProbe } from "./components/AdminActivityProbe";
import { ShellImageUpload } from "./components/ShellImageUpload";
import {
	fetchShellBranding,
	removeCompanyLogo,
	saveCompanyLogo,
} from "./shell-branding-api";
import { toastError } from "@/lib/app-toast";

/** Sub-menu row ~44–48px; full height so items are not clipped inside scrollable nav */
function sidebarDropdownMaxHeightPx(itemCount: number) {
	return Math.max(100, itemCount * 50 + 16);
}

const sidebarLinks = [
	{
		group: "Main",
		links: [
			{ name: "Dashboard", path: "/dashboard", icon: <FaTachometerAlt /> },
			{ name: "Admin", path: "/admin", icon: <FaUserShield /> },
		],
	},
	{
		group: "HR",
		links: [
			{
				name: "PTO",
				icon: <FaCalendarAlt />,
				dropdown: [
					{ name: "Leave", path: "/leave", icon: <FaCalendarAlt /> },
					{ name: "Manage Leave", path: "/admin/manage-leaves", icon: <FaEdit /> },
					{ name: "Calendar", path: "/admin/calendar", icon: <FaCalendarAlt /> },
					{ name: "Leave Summary", path: "/admin/monthly-leave-summary", icon: <FaClipboardList /> },
				]
			},
			{
				name: "Attendance",
				icon: <FaClipboardList />,
				dropdown: [
					{ name: "Summaries", path: "/summaries", icon: <FaClipboardList /> },
					{ name: "Manage Attendance", path: "/admin/manage-attendance", icon: <FaClipboardList /> },
					{ name: "Manage Breaks", path: "/admin/manage-breaks", icon: <FaCoffee /> },
					{ name: "Monthly Attendance", path: "/admin/monthly-attendance", icon: <FaFileAlt /> },
					{ name: "Tungsten IN/OUT", path: "/admin/tungsten-in-out", icon: <FaExchangeAlt /> },
					{ name: "Presence / Idle", path: "/admin/presence-idle", icon: <FaDesktop /> },
					{ name: "Employee Report", path: "/attendance/employee-report", icon: <FaClipboardList /> },
				]
			},
			{ name: "Recruitment", path: "/recruitment", icon: <FaUserPlus /> },
			{ name: "Ticket Inbox", path: "/admin/tickets", icon: <FaTicketAlt /> },
			{ name: "Employee Files", path: "/admin/employee-files", icon: <FaFolderOpen /> },
			{ name: "Formats Library", path: "/admin/formats-library", icon: <FaFileAlt /> },
			{ name: "Pending Appraisals", path: "/admin/pending-appraisals", icon: <FaClipboardList /> },
			{
				name: "Onboard",
				icon: <FaUserPlus />,
				dropdown: [
					{ name: "Add Employee", path: "/add-employee", icon: <FaUserPlus /> },
					{ name: "Employee List", path: "/admin/employee-list", icon: <FaListAlt /> },
					{ name: "Face Enrollment", path: "/admin/face-enrollment", icon: <FaUser /> },
					{ name: "Employee Credentials", path: "/admin/employee-credentials", icon: <FaKey /> },
				]
			},
			{
				name: "Shifts",
				icon: <FaCalendarCheck />,
				dropdown: [
					{ name: "Shift Scheduler", path: "/admin/shift-scheduler", icon: <FaCalendarCheck /> },
					{ name: "Shift Management", path: "/admin/shift-management", icon: <FaClock /> },
				]
			},
			{
				name: "Payroll",
				icon: <FaDollarSign />,
				dropdown: [
					{ name: "Monthly Payroll", path: "/admin/monthly-payroll", icon: <FaFileAlt /> },
					{ name: "Commissions", path: "/admin/commissions", icon: <FaDollarSign /> },
					{ name: "Advance", path: "/admin/advance", icon: <FaDollarSign /> },
					{ name: "Loan", path: "/admin/loan", icon: <FaDollarSign /> },
					{ name: "Request Inbox", path: "/admin/financial-requests", icon: <FaClipboardList /> },
				]
			},
			{ name: "Events", path: "/admin/events", icon: <FaCalendarAlt /> },
			{ name: "Departments", path: "/admin/departments", icon: <FaBuilding /> },
			{ name: "Login Carousel", path: "/admin/login-carousel", icon: <FaImages /> },
			{ name: "System Control", path: "/admin/system-control", icon: <FaCog /> },
		],
	},
	{
		group: "Personal",
		links: [
			{ name: "My Info", path: "/my-info", icon: <FaUser /> },
			{ name: "Performance", path: "/performance", icon: <FaChartBar /> },
		],
	},
];

export default function LayoutDashboard({ children }: { children: React.ReactNode }) {
	const [attendanceDropdownOpen, setAttendanceDropdownOpen] = React.useState(false);
	const [onboardDropdownOpen, setOnboardDropdownOpen] = React.useState(false);
	const [ptoDropdownOpen, setPtoDropdownOpen] = React.useState(false);
	const [shiftsDropdownOpen, setShiftsDropdownOpen] = React.useState(false);
	const [payrollDropdownOpen, setPayrollDropdownOpen] = React.useState(false);
	const [sidebarOpen, setSidebarOpen] = React.useState(false);
	const [companyLogo, setCompanyLogo] = React.useState<string | null>(null);
	const [adminAvatar, setAdminAvatar] = React.useState<string | null>(null);
	const router = useRouter();
	const pathname = usePathname();
	const isTimePage = pathname === "/time";

	React.useEffect(() => {
		void fetchShellBranding()
			.then((branding) => {
				setCompanyLogo(branding.companyLogo);
				setAdminAvatar(branding.adminAvatar);
			})
			.catch(() => {
				/* keep placeholders */
			});
	}, []);

	// Close the mobile drawer whenever the route changes (after a nav tap).
	React.useEffect(() => {
		setSidebarOpen(false);
	}, [pathname]);

	// Attendance dropdown should stay open if any of its links is active
	React.useEffect(() => {
		const attendanceLinks = sidebarLinks.find(g => g.group === "HR")?.links.find(l => l.name === "Attendance")?.dropdown || [];
		if (attendanceLinks.some(l => pathname === l.path)) {
			setAttendanceDropdownOpen(true);
		}
	}, [pathname]);

	return (
		<>
			<div className={styles.topBar}>
				<div className={styles.topBarSidebarSlot}>
					<span
						className={styles.sidebarMenuIcon}
						role="button"
						tabIndex={0}
						aria-label="Toggle menu"
						onClick={() => setSidebarOpen((open) => !open)}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") setSidebarOpen((open) => !open);
						}}
					>
						&#9776;
					</span>
					<div className={styles.topBarBrandGroup}>
						<ShellImageUpload
							variant="logo"
							image={companyLogo}
							title="Upload company logo"
							onImage={(dataUrl, file) => {
								const prev = companyLogo;
								setCompanyLogo(dataUrl);
								void saveCompanyLogo(file).catch(() => {
									setCompanyLogo(prev);
									toastError("Could not save company logo.");
								});
							}}
							onRemove={() => {
								const prev = companyLogo;
								setCompanyLogo(null);
								void removeCompanyLogo().catch(() => {
									setCompanyLogo(prev);
									toastError("Could not remove company logo.");
								});
							}}
						/>
					</div>
				</div>
				<div className={styles.topBarMain}>
				<div className={styles.topBarRight}>
					<div className={styles.topBarProfile}>
						<EmployeeAvatar
							name="Admin"
							initials="A"
							photo={adminAvatar}
							size="md"
						/>
						<span className={styles.topBarProfileName}>Admin</span>
						<AdminProfileMenu onAvatarUpdated={(dataUrl) => setAdminAvatar(dataUrl)} />
					</div>
				</div>
				</div>
			</div>
			<div className={styles.layout}>
				{sidebarOpen && (
					<div
						className={styles.sidebarOverlay}
						onClick={() => setSidebarOpen(false)}
						aria-hidden
					/>
				)}
				<aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ""}`}>
					<nav className={styles.nav}>
						{sidebarLinks.map((group, idx) => (
							<div key={group.group}>
								{group.group !== "Main" && (
									<div className={styles.navGroupLabel}>
										{group.group}
									</div>
								)}
								{group.links.map((link) => {
									// Payroll dropdown logic
									if (link.name === "Payroll" && link.dropdown) {
										const isPayrollSelected = payrollDropdownOpen || link.dropdown.some(subLink => pathname === subLink.path);
										return (
											<React.Fragment key={link.name}>
												<div key={link.name} style={{ position: "relative", zIndex: 2 }}>
													<div
														className={`${styles.navItem} ${(payrollDropdownOpen || link.dropdown.some(subLink => pathname === subLink.path)) ? styles.navItemOpen : ""}`}
														onClick={() => setPayrollDropdownOpen(open => !open)}
													>
														<span className={styles.navIcon}>{link.icon}</span>
														<span>{link.name}</span>
														<span className={styles.navChevron}>
															{payrollDropdownOpen ? <FiChevronDown /> : <FiChevronRight />}
														</span>
													</div>
												</div>
												<div
													style={{
														overflow: "hidden",
														maxHeight: payrollDropdownOpen ? sidebarDropdownMaxHeightPx(link.dropdown.length) : 0,
														opacity: payrollDropdownOpen ? 1 : 0,
														marginBottom: payrollDropdownOpen ? 2 : 0,
														transition: "max-height 0.38s cubic-bezier(0.4,0,0.2,1), opacity 0.25s, margin 0.3s",
													}}
												>
													<div
														className={`${styles.navDropdownPanel} ${payrollDropdownOpen ? styles.navDropdownPanelOpen : ""}`}
														style={{
															padding: payrollDropdownOpen ? "4px 0" : "0 0",
														}}
													>
														{link.dropdown.map((subLink) => {
															const isActive = pathname === subLink.path;
															return (
																<div
																	key={subLink.name}
																	onClick={() => {
																		router.push(subLink.path);
																		if (link.name === "Attendance") setAttendanceDropdownOpen(false);
																		if (link.name === "Payroll") setPayrollDropdownOpen(false);
																	}}
																	className={
																		isActive
																			? `${styles.navItem} ${styles.navSubItem} ${styles.navItemActive}`
																			: `${styles.navItem} ${styles.navSubItem}`
																	}
																>
																	<span className={styles.navIcon} style={{ fontSize: "1.02rem", minWidth: 22 }}>{subLink.icon}</span>
																	<span>{subLink.name}</span>
																</div>
															);
														})}
													</div>
												</div>
											</React.Fragment>
										);
									}
									// PTO dropdown logic
									if (link.name === "PTO" && link.dropdown) {
										const isPtoSelected = ptoDropdownOpen || link.dropdown.some(subLink => pathname === subLink.path);
										return (
											<React.Fragment key={link.name}>
												<div key={link.name} style={{ position: "relative", zIndex: 2 }}>
													<div
														className={`${styles.navItem} ${(ptoDropdownOpen || link.dropdown.some(subLink => pathname === subLink.path)) ? styles.navItemOpen : ""}`}
														onClick={() => setPtoDropdownOpen(open => !open)}
													>
														<span className={styles.navIcon}>{link.icon}</span>
														<span>{link.name}</span>
														<span className={styles.navChevron}>
															{ptoDropdownOpen ? <FiChevronDown /> : <FiChevronRight />}
														</span>
													</div>
												</div>
												<div
													style={{
														overflow: "hidden",
														maxHeight: ptoDropdownOpen ? sidebarDropdownMaxHeightPx(link.dropdown.length) : 0,
														opacity: ptoDropdownOpen ? 1 : 0,
														marginBottom: ptoDropdownOpen ? 2 : 0,
														transition: "max-height 0.38s cubic-bezier(0.4,0,0.2,1), opacity 0.25s, margin 0.3s",
													}}
												>
													<div
														className={`${styles.navDropdownPanel} ${ptoDropdownOpen ? styles.navDropdownPanelOpen : ""}`}
														style={{
															padding: ptoDropdownOpen ? "4px 0" : "0 0",
														}}
													>
														{link.dropdown.map((subLink) => {
															const isActive = pathname === subLink.path;
															return (
																<div
																	key={subLink.name}
																	onClick={() => { router.push(subLink.path); }}
																	className={
																		isActive
																			? `${styles.navItem} ${styles.navSubItem} ${styles.navItemActive}`
																			: `${styles.navItem} ${styles.navSubItem}`
																	}
																>
																	<span className={styles.navIcon} style={{ fontSize: "1.02rem", minWidth: 22 }}>{subLink.icon}</span>
																	<span>{subLink.name}</span>
																</div>
															);
														})}
													</div>
												</div>
											</React.Fragment>
										);
									}
									// Shifts dropdown logic
									if (link.name === "Shifts" && link.dropdown) {
										const isShiftsSelected = shiftsDropdownOpen || link.dropdown.some(subLink => pathname === subLink.path);
										return (
											<React.Fragment key={link.name}>
												<div key={link.name} style={{ position: "relative", zIndex: 2 }}>
													<div
														className={`${styles.navItem} ${(shiftsDropdownOpen || link.dropdown.some(subLink => pathname === subLink.path)) ? styles.navItemOpen : ""}`}
														onClick={() => setShiftsDropdownOpen(open => !open)}
													>
														<span className={styles.navIcon}>{link.icon}</span>
														<span>{link.name}</span>
														<span className={styles.navChevron}>
															{shiftsDropdownOpen ? <FiChevronDown /> : <FiChevronRight />}
														</span>
													</div>
												</div>
												<div
													style={{
														overflow: "hidden",
														maxHeight: shiftsDropdownOpen ? sidebarDropdownMaxHeightPx(link.dropdown.length) : 0,
														opacity: shiftsDropdownOpen ? 1 : 0,
														marginBottom: shiftsDropdownOpen ? 2 : 0,
														transition: "max-height 0.38s cubic-bezier(0.4,0,0.2,1), opacity 0.25s, margin 0.3s",
													}}
												>
													<div
														className={`${styles.navDropdownPanel} ${shiftsDropdownOpen ? styles.navDropdownPanelOpen : ""}`}
														style={{
															padding: shiftsDropdownOpen ? "4px 0" : "0 0",
														}}
													>
														{link.dropdown.map((subLink) => {
															const isActive = pathname === subLink.path;
															return (
																<div
																	key={subLink.name}
																	onClick={() => { router.push(subLink.path); }}
																	className={
																		isActive
																			? `${styles.navItem} ${styles.navSubItem} ${styles.navItemActive}`
																			: `${styles.navItem} ${styles.navSubItem}`
																	}
																>
																	<span className={styles.navIcon} style={{ fontSize: "1.02rem", minWidth: 22 }}>{subLink.icon}</span>
																	<span>{subLink.name}</span>
																</div>
															);
														})}
													</div>
												</div>
											</React.Fragment>
										);
									}
									// Attendance dropdown logic
									if (link.name === "Attendance" && link.dropdown) {
										// Attendance is selected if dropdown is open or any sublink is active
										const isAttendanceSelected = attendanceDropdownOpen || link.dropdown.some(subLink => pathname === subLink.path);
										return (
											<React.Fragment key={link.name}>
												<div key={link.name} style={{ position: "relative", zIndex: 2 }}>
													<div
														className={`${styles.navItem} ${(attendanceDropdownOpen || link.dropdown.some(subLink => pathname === subLink.path)) ? styles.navItemOpen : ""}`}
														onClick={() => setAttendanceDropdownOpen(open => !open)}
													>
														<span className={styles.navIcon}>{link.icon}</span>
														<span>{link.name}</span>
														<span className={styles.navChevron}>
															{attendanceDropdownOpen ? <FiChevronDown /> : <FiChevronRight />}
														</span>
													</div>
												</div>
												<div
													style={{
														overflow: "hidden",
														maxHeight: attendanceDropdownOpen ? sidebarDropdownMaxHeightPx(link.dropdown.length) : 0,
														opacity: attendanceDropdownOpen ? 1 : 0,
														marginBottom: attendanceDropdownOpen ? 2 : 0,
														transition: "max-height 0.38s cubic-bezier(0.4,0,0.2,1), opacity 0.25s, margin 0.3s",
													}}
												>
													<div
														className={`${styles.navDropdownPanel} ${attendanceDropdownOpen ? styles.navDropdownPanelOpen : ""}`}
														style={{
															padding: attendanceDropdownOpen ? "4px 0" : "0 0",
														}}
													>
														{link.dropdown.map((subLink) => {
															const isActive = pathname === subLink.path;
															return (
																<div
																	key={subLink.name}
																	onClick={() => { router.push(subLink.path); }}
																	className={
																		isActive
																			? `${styles.navItem} ${styles.navSubItem} ${styles.navItemActive}`
																			: `${styles.navItem} ${styles.navSubItem}`
																	}
																>
																	<span className={styles.navIcon} style={{ fontSize: "1.02rem", minWidth: 22 }}>{subLink.icon}</span>
																	<span>{subLink.name}</span>
																</div>
															);
														})}
													</div>
												</div>
											</React.Fragment>
										);
									}
									// Onboard dropdown logic
									if (link.name === "Onboard" && link.dropdown) {
										const isOnboardSelected = onboardDropdownOpen || link.dropdown.some(subLink => pathname === subLink.path);
										return (
											<React.Fragment key={link.name}>
												<div key={link.name} style={{ position: "relative", zIndex: 2 }}>
													<div
														className={`${styles.navItem} ${(onboardDropdownOpen || link.dropdown.some(subLink => pathname === subLink.path)) ? styles.navItemOpen : ""}`}
														onClick={() => setOnboardDropdownOpen(open => !open)}
													>
														<span className={styles.navIcon}>{link.icon}</span>
														<span>{link.name}</span>
														<span className={styles.navChevron}>
															{onboardDropdownOpen ? <FiChevronDown /> : <FiChevronRight />}
														</span>
													</div>
												</div>
												<div
													style={{
														overflow: "hidden",
														maxHeight: onboardDropdownOpen ? sidebarDropdownMaxHeightPx(link.dropdown.length) : 0,
														opacity: onboardDropdownOpen ? 1 : 0,
														marginBottom: onboardDropdownOpen ? 2 : 0,
														transition: "max-height 0.38s cubic-bezier(0.4,0,0.2,1), opacity 0.25s, margin 0.3s",
													}}
												>
													<div
														className={`${styles.navDropdownPanel} ${onboardDropdownOpen ? styles.navDropdownPanelOpen : ""}`}
														style={{
															padding: onboardDropdownOpen ? "4px 0" : "0 0",
														}}
													>
														{link.dropdown.map((subLink) => {
															const isActive = pathname === subLink.path;
															return (
																<div
																	key={subLink.name}
																	onClick={() => { router.push(subLink.path); }}
																	className={
																		isActive
																			? `${styles.navItem} ${styles.navSubItem} ${styles.navItemActive}`
																			: `${styles.navItem} ${styles.navSubItem}`
																	}
																>
																	<span className={styles.navIcon} style={{ fontSize: "1.02rem", minWidth: 22 }}>{subLink.icon}</span>
																	<span>{subLink.name}</span>
																</div>
															);
														})}
													</div>
												</div>
											</React.Fragment>
										);
									}
									// Normal links
									const isActive = pathname === link.path;
									return (
										<div
											key={link.name}
											onClick={() => { if (link.path) router.push(link.path); }}
											className={isActive ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem}
										>
											<span className={styles.navIcon}>{link.icon}</span>
											<span>{link.name}</span>
										</div>
									);
								})}
							</div>
						))}
					</nav>
				</aside>
				<div
					className={`${styles.contentArea} ${isTimePage ? styles.contentAreaTimePage : ""}`}
				>
					<main
						className={`${styles.main} ${isTimePage ? styles.mainTimePage : ""}`}
					>
						{children}
					</main>
				</div>
			</div>
			<AdminActivityProbe />
		</>
	);
}
