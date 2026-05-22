"use client";
import React from "react";
import { useRouter, usePathname } from "next/navigation";
import styles from "./layout-dashboard.module.css";
import "./globals.css";
import "./dashboard/nexatech-theme.module.css";
import { FaTachometerAlt, FaUserShield, FaCalendarAlt, FaClock, FaUserPlus, FaIdBadge, FaListAlt, FaPray, FaClipboardList, FaBuilding, FaCog, FaUser, FaChartBar, FaKey, FaCalendarCheck, FaEdit, FaCoffee, FaFileAlt, FaDollarSign, FaExchangeAlt } from "react-icons/fa";
import { FiChevronDown, FiChevronRight } from "react-icons/fi";

/** Sub-menu row ~44–48px; avoids clipping last link when dropdown grows */
function sidebarDropdownMaxHeightPx(itemCount: number) {
	return Math.min(960, Math.max(100, itemCount * 50 + 16));
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
					{ name: "Attendance Summary", path: "/attendance-summary", icon: <FaClipboardList /> },
					{ name: "Break Summary", path: "/break-summary", icon: <FaCoffee /> },
					{ name: "Prayer Break Summary", path: "/prayer-summary", icon: <FaPray /> },
					{ name: "Manage Attendance", path: "/admin/manage-attendance", icon: <FaClipboardList /> },
					{ name: "Manage Breaks", path: "/admin/manage-breaks", icon: <FaCoffee /> },
					{ name: "Monthly Attendance", path: "/admin/monthly-attendance", icon: <FaFileAlt /> },
					{ name: "Tungsten IN/OUT", path: "/admin/tungsten-in-out", icon: <FaExchangeAlt /> },
					{ name: "Employee Report", path: "/attendance/employee-report", icon: <FaClipboardList /> },
				]
			},
			{ name: "Recruitment", path: "/recruitment", icon: <FaUserPlus /> },
			{
				name: "Onboard",
				icon: <FaUserPlus />,
				dropdown: [
					{ name: "Add Employee", path: "/add-employee", icon: <FaUserPlus /> },
					{ name: "Employee List", path: "/admin/employee-list", icon: <FaListAlt /> },
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
				]
			},
			{ name: "Events", path: "/admin/events", icon: <FaCalendarAlt /> },
			{ name: "Departments", path: "/admin/departments", icon: <FaBuilding /> },
			{ name: "Roles & Permissions", path: "/admin/roles-permissions", icon: <FaCog /> },
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
	const [menuOpen, setMenuOpen] = React.useState(false);
	const [attendanceDropdownOpen, setAttendanceDropdownOpen] = React.useState(false);
	const [onboardDropdownOpen, setOnboardDropdownOpen] = React.useState(false);
	const [ptoDropdownOpen, setPtoDropdownOpen] = React.useState(false);
	const [shiftsDropdownOpen, setShiftsDropdownOpen] = React.useState(false);
	const [payrollDropdownOpen, setPayrollDropdownOpen] = React.useState(false);
	const menuRef = React.useRef<HTMLDivElement>(null);
	const router = useRouter();
	const pathname = usePathname();
	const isTimePage = pathname === "/time";
	const isEmployeeCredentialsPage = pathname === "/admin/employee-credentials";

	// Attendance dropdown should stay open if any of its links is active
	React.useEffect(() => {
		const attendanceLinks = sidebarLinks.find(g => g.group === "HR")?.links.find(l => l.name === "Attendance")?.dropdown || [];
		if (attendanceLinks.some(l => pathname === l.path)) {
			setAttendanceDropdownOpen(true);
		}
	}, [pathname]);

	React.useEffect(() => {
		function handleClickOutside(event: MouseEvent) {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
				setMenuOpen(false);
			}
		}
		if (menuOpen) {
			window.addEventListener("mousedown", handleClickOutside);
			return () => window.removeEventListener("mousedown", handleClickOutside);
		}
	}, [menuOpen]);

	return (
		<>
			<div className={styles.topBar}>
				<div className={styles.topBarLeft}>
					<span className={styles.sidebarTitle}>Interact Global</span>
					<span className={styles.sidebarMenuIcon}>&#9776;</span>
				</div>
				<div className={styles.topBarRight}>
					<div className={styles.topBarProfile}>
						{/* If user image exists, show image, else show initials */}
						{false ? (
							<span className={styles.topBarProfilePic} style={{backgroundImage: "url('https://ui-avatars.com/api/?name=Admin')"}}></span>
						) : (
							<span className={styles.topBarProfileInitials}>A</span>
						)}
						<span className={styles.topBarProfileName}>Admin</span>
						<div className={styles.profileMenuWrapper} ref={menuRef}>
							<button
								className={styles.profileMenuButton}
								onClick={() => setMenuOpen((open) => !open)}
								aria-label="Open menu"
							>
								<span style={{ fontSize: "1.7rem", color: "#fff" }}>⋮</span>
							</button>
							{menuOpen && (
								<div className={styles.profileMenuDropdown}>
									<button
										className={styles.logoutButton}
										onClick={() => {
											if (typeof window !== "undefined") {
												localStorage.removeItem("loginId");
											}
											router.push("/auth");
										}}
									>
										Logout
									</button>
								</div>
							)}
						</div>
					</div>
				</div>
			</div>
			<div className={styles.layout}>
				<aside className={styles.sidebar}>
					<nav className={styles.nav}>
						{sidebarLinks.map((group, idx) => (
							<div key={group.group}>
								{group.group !== "Main" && (
									<div
										style={{
											fontSize: "0.95rem",
											color: "#bfc8e2",
											fontWeight: 600,
											margin: "16px 0 8px 32px",
										}}
									>
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
														className={styles.navItem}
														style={{
															display: "flex",
															alignItems: "center",
															cursor: "pointer",
															borderRadius: 8,
															padding: "10px 22px",
															fontSize: "0.93rem",
															background: payrollDropdownOpen ? "#181c2b" : (link.dropdown.some(subLink => pathname === subLink.path) ? "#1a2032" : undefined),
															transition: "background 0.25s"
														}}
														onClick={() => setPayrollDropdownOpen(open => !open)}
													>
														<span className={styles.navIcon}>{link.icon}</span>
														<span>{link.name}</span>
														<span style={{ marginLeft: 8, fontSize: "1.15rem", color: "#bfc8e2", display: "flex", alignItems: "center" }}>
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
														style={{
															background: "#232b3e",
															borderRadius: 12,
															boxShadow: payrollDropdownOpen ? "0 8px 32px rgba(44,62,80,0.18)" : "none",
															minWidth: 170,
															padding: payrollDropdownOpen ? "4px 0" : "0 0",
															marginTop: 0,
															display: "flex",
															flexDirection: "column",
															gap: 0,
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
																	className={isActive ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem}
																	style={{
																		padding: "7px 22px 7px 38px",
																		fontSize: "0.85rem",
																		borderRadius: 7,
																		background: isActive ? "#1a2032" : "none",
																		marginBottom: 1,
																		minWidth: 0,
																		transition: "background 0.2s, color 0.2s"
																	}}
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
														className={styles.navItem}
														style={{
															display: "flex",
															alignItems: "center",
															cursor: "pointer",
															borderRadius: 8,
															padding: "10px 22px",
															fontSize: "0.93rem",
															background: ptoDropdownOpen ? "#181c2b" : (link.dropdown.some(subLink => pathname === subLink.path) ? "#1a2032" : undefined),
															transition: "background 0.25s"
														}}
														onClick={() => setPtoDropdownOpen(open => !open)}
													>
														<span className={styles.navIcon}>{link.icon}</span>
														<span>{link.name}</span>
														<span style={{ marginLeft: 8, fontSize: "1.15rem", color: "#bfc8e2", display: "flex", alignItems: "center" }}>
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
														style={{
															background: "#232b3e",
															borderRadius: 12,
															boxShadow: ptoDropdownOpen ? "0 8px 32px rgba(44,62,80,0.18)" : "none",
															minWidth: 170,
															padding: ptoDropdownOpen ? "4px 0" : "0 0",
															marginTop: 0,
															display: "flex",
															flexDirection: "column",
															gap: 0,
														}}
													>
														{link.dropdown.map((subLink) => {
															const isActive = pathname === subLink.path;
															return (
																<div
																	key={subLink.name}
																	onClick={() => { router.push(subLink.path); }}
																	className={isActive ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem}
																	style={{
																		padding: "7px 22px 7px 38px",
																		fontSize: "0.85rem",
																		borderRadius: 7,
																		background: isActive ? "#1a2032" : "none",
																		marginBottom: 1,
																		minWidth: 0,
																		transition: "background 0.2s, color 0.2s"
																	}}
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
														className={styles.navItem}
														style={{
															display: "flex",
															alignItems: "center",
															cursor: "pointer",
															borderRadius: 8,
															padding: "10px 22px",
															fontSize: "0.93rem",
															background: shiftsDropdownOpen ? "#181c2b" : (link.dropdown.some(subLink => pathname === subLink.path) ? "#1a2032" : undefined),
															transition: "background 0.25s"
														}}
														onClick={() => setShiftsDropdownOpen(open => !open)}
													>
														<span className={styles.navIcon}>{link.icon}</span>
														<span>{link.name}</span>
														<span style={{ marginLeft: 8, fontSize: "1.15rem", color: "#bfc8e2", display: "flex", alignItems: "center" }}>
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
														style={{
															background: "#232b3e",
															borderRadius: 12,
															boxShadow: shiftsDropdownOpen ? "0 8px 32px rgba(44,62,80,0.18)" : "none",
															minWidth: 170,
															padding: shiftsDropdownOpen ? "4px 0" : "0 0",
															marginTop: 0,
															display: "flex",
															flexDirection: "column",
															gap: 0,
														}}
													>
														{link.dropdown.map((subLink) => {
															const isActive = pathname === subLink.path;
															return (
																<div
																	key={subLink.name}
																	onClick={() => { router.push(subLink.path); }}
																	className={isActive ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem}
																	style={{
																		padding: "7px 22px 7px 38px",
																		fontSize: "0.85rem",
																		borderRadius: 7,
																		background: isActive ? "#1a2032" : "none",
																		marginBottom: 1,
																		minWidth: 0,
																		transition: "background 0.2s, color 0.2s"
																	}}
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
														className={styles.navItem}
														style={{
															display: "flex",
															alignItems: "center",
															cursor: "pointer",
															borderRadius: 8,
															padding: "10px 22px",
															fontSize: "0.93rem",
															background: attendanceDropdownOpen ? "#181c2b" : (link.dropdown.some(subLink => pathname === subLink.path) ? "#1a2032" : undefined),
															transition: "background 0.25s"
														}}
														onClick={() => setAttendanceDropdownOpen(open => !open)}
													>
														<span className={styles.navIcon}>{link.icon}</span>
														<span>{link.name}</span>
														<span style={{ marginLeft: 8, fontSize: "1.15rem", color: "#bfc8e2", display: "flex", alignItems: "center" }}>
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
														style={{
															background: "#232b3e",
															borderRadius: 12,
															boxShadow: attendanceDropdownOpen ? "0 8px 32px rgba(44,62,80,0.18)" : "none",
															minWidth: 170,
															padding: attendanceDropdownOpen ? "4px 0" : "0 0",
															marginTop: 0,
															display: "flex",
															flexDirection: "column",
															gap: 0,
														}}
													>
														{link.dropdown.map((subLink) => {
															const isActive = pathname === subLink.path;
															return (
																<div
																	key={subLink.name}
																	onClick={() => { router.push(subLink.path); }}
																	className={isActive ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem}
																	style={{
																		padding: "7px 22px 7px 38px",
																		fontSize: "0.85rem",
																		borderRadius: 7,
																		background: isActive ? "#1a2032" : "none",
																		marginBottom: 1,
																		minWidth: 0,
																		transition: "background 0.2s, color 0.2s"
																	}}
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
														className={styles.navItem}
														style={{
															display: "flex",
															alignItems: "center",
															cursor: "pointer",
															borderRadius: 8,
															padding: "10px 22px",
															fontSize: "0.93rem",
															background: onboardDropdownOpen ? "#181c2b" : (link.dropdown.some(subLink => pathname === subLink.path) ? "#1a2032" : undefined),
															transition: "background 0.25s"
														}}
														onClick={() => setOnboardDropdownOpen(open => !open)}
													>
														<span className={styles.navIcon}>{link.icon}</span>
														<span>{link.name}</span>
														<span style={{ marginLeft: 8, fontSize: "1.15rem", color: "#bfc8e2", display: "flex", alignItems: "center" }}>
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
														style={{
															background: "#232b3e",
															borderRadius: 12,
															boxShadow: onboardDropdownOpen ? "0 8px 32px rgba(44,62,80,0.18)" : "none",
															minWidth: 170,
															padding: onboardDropdownOpen ? "4px 0" : "0 0",
															marginTop: 0,
															display: "flex",
															flexDirection: "column",
															gap: 0,
														}}
													>
														{link.dropdown.map((subLink) => {
															const isActive = pathname === subLink.path;
															return (
																<div
																	key={subLink.name}
																	onClick={() => { router.push(subLink.path); }}
																	className={isActive ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem}
																	style={{
																		padding: "7px 22px 7px 38px",
																		fontSize: "0.85rem",
																		borderRadius: 7,
																		background: isActive ? "#1a2032" : "none",
																		marginBottom: 1,
																		minWidth: 0,
																		transition: "background 0.2s, color 0.2s"
																	}}
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
					className={`${styles.contentArea} ${isTimePage ? styles.contentAreaTimePage : ""} ${isEmployeeCredentialsPage ? styles.contentAreaEmployeeCredentialsPage : ""}`}
				>
					<main
						className={`${styles.main} ${isTimePage ? styles.mainTimePage : ""} ${isEmployeeCredentialsPage ? styles.mainEmployeeCredentialsPage : ""}`}
					>
						{children}
					</main>
				</div>
			</div>
		</>
	 );
}
