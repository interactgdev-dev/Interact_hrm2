"use client";
import React from "react";
import { useRouter, usePathname } from "next/navigation";
import styles from "./layout-dashboard.module.css";
import "./globals.css";
import "./dashboard/nexatech-theme.module.css";
import { FaTachometerAlt, FaUserShield, FaCalendarAlt, FaClock, FaUserPlus, FaIdBadge, FaListAlt, FaClipboardList, FaBuilding, FaCog, FaUser, FaChartBar, FaKey, FaCalendarCheck, FaEdit, FaCoffee, FaFileAlt, FaWallet, FaChartLine, FaCreditCard, FaHandshake, FaNotesMedical, FaExchangeAlt, FaTicketAlt, FaFolderOpen, FaDesktop, FaImages } from "react-icons/fa";
import { FiChevronDown, FiChevronRight } from "react-icons/fi";
import { EmployeeAvatar } from "./components/EmployeeAvatar";
import { AdminProfileMenu } from "./components/AdminProfileMenu";
import { ShellImageUpload } from "./components/ShellImageUpload";
import { InteractGlobeLogo } from "./employee-dashboard/components/InteractGlobeLogo";
import {
	fetchShellBranding,
	removeCompanyLogo,
	saveCompanyLogo,
} from "./shell-branding-api";
import { toastError } from "@/lib/app-toast";
import { ADMIN_PATH_TO_EMPLOYEE } from "@/lib/access-control/menu-registry";
import {
	isEmployeeBrowserSession,
	markAdminPortal,
	isAdminBrowserSession,
} from "@/lib/access-control/employee-shell";

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
					{ name: "Manage Leave", path: "/admin/manage-leaves?tab=requests", icon: <FaEdit /> },
					{ name: "Calendar", path: "/admin/calendar", icon: <FaCalendarAlt /> },
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
			{ name: "Form Templates", path: "/admin/formats-library", icon: <FaFileAlt /> },
			{ name: "Medical Tracker", path: "/admin/medical-tracker", icon: <FaNotesMedical /> },
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
				icon: <FaWallet />,
				dropdown: [
					{ name: "Monthly Payroll", path: "/admin/monthly-payroll", icon: <FaFileAlt /> },
					{ name: "Commissions", path: "/admin/commissions", icon: <FaChartLine /> },
					{ name: "Advance", path: "/admin/advance", icon: <FaCreditCard /> },
					{ name: "Loan", path: "/admin/loan", icon: <FaHandshake /> },
					{ name: "Claims", path: "/admin/claims", icon: <FaNotesMedical /> },
					{ name: "Financial History", path: "/admin/employee-financial-history", icon: <FaFileAlt /> },
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

const ADMIN_PREFETCH_PATHS = [
	"/dashboard",
	"/admin/employee-list",
	"/admin/tickets",
	"/admin/monthly-attendance",
	"/admin/monthly-payroll",
	"/admin/manage-leaves",
	"/admin/manage-attendance",
	"/admin/shift-management",
	"/admin/employee-files",
	"/admin/formats-library",
	"/admin/system-control",
	"/summaries",
	"/add-employee",
];

function runWhenIdle(cb: () => void, timeout = 3500) {
	if (typeof window === "undefined") return () => {};
	const idle =
		"requestIdleCallback" in window
			? (
					window as Window & {
						requestIdleCallback: (
							fn: () => void,
							opts?: { timeout: number },
						) => number;
						cancelIdleCallback?: (id: number) => void;
					}
				)
			: null;
	const id = idle
		? idle.requestIdleCallback(cb, { timeout })
		: window.setTimeout(cb, Math.min(timeout, 1200));
	return () => {
		if (idle) idle.cancelIdleCallback?.(id);
		else window.clearTimeout(id as number);
	};
}

export default function LayoutDashboard({ children }: { children: React.ReactNode }) {
	const [attendanceDropdownOpen, setAttendanceDropdownOpen] = React.useState(false);
	const [onboardDropdownOpen, setOnboardDropdownOpen] = React.useState(false);
	const [ptoDropdownOpen, setPtoDropdownOpen] = React.useState(false);
	const [shiftsDropdownOpen, setShiftsDropdownOpen] = React.useState(false);
	const [payrollDropdownOpen, setPayrollDropdownOpen] = React.useState(false);
	const [sidebarOpen, setSidebarOpen] = React.useState(false);
	const [navPeek, setNavPeek] = React.useState(false);
	const [isDesktopNav, setIsDesktopNav] = React.useState(true);
	const [companyLogo, setCompanyLogo] = React.useState<string | null>(null);
	const [adminAvatar, setAdminAvatar] = React.useState<string | null>(null);
	const navGroups = sidebarLinks;
	const [accessRestricted, setAccessRestricted] = React.useState(false);
	const router = useRouter();
	const pathname = usePathname();
	const isTimePage = pathname === "/time";
	// Only omit admin chrome when this page is nested under the employee layout route.
	const embedInEmployeeShell = Boolean(pathname?.startsWith("/employee-dashboard"));
	const sidebarVisible = isDesktopNav ? navPeek : sidebarOpen;
	const contentPushed = isDesktopNav && navPeek;

	React.useEffect(() => {
		if (typeof window === "undefined") return;
		const mq = window.matchMedia("(min-width: 1025px)");
		const sync = () => setIsDesktopNav(mq.matches);
		sync();
		mq.addEventListener("change", sync);
		return () => mq.removeEventListener("change", sync);
	}, []);

	React.useEffect(() => {
		setSidebarOpen(false);
		setNavPeek(false);
	}, [pathname]);

	// Prefetch common admin routes after first paint — same pattern as employee dashboard.
	React.useEffect(() => {
		if (embedInEmployeeShell) return;
		return runWhenIdle(() => {
			for (const path of ADMIN_PREFETCH_PATHS) {
				try {
					router.prefetch(path);
				} catch {
					/* ignore */
				}
			}
		}, 5000);
	}, [router, embedInEmployeeShell]);

	React.useEffect(() => {
		return runWhenIdle(() => {
			void fetchShellBranding()
				.then((branding) => {
					setCompanyLogo(branding.companyLogo);
					setAdminAvatar(branding.adminAvatar);
				})
				.catch(() => {
					/* keep placeholders */
				});
		}, 2000);
	}, []);

	// Heal leftover employee keys when admin is logged in (restores full sidebar).
	React.useEffect(() => {
		if (typeof window === "undefined") return;
		if (pathname?.startsWith("/employee-dashboard")) return;
		if (isAdminBrowserSession()) {
			markAdminPortal();
			setAccessRestricted(false);
		}
	}, [pathname]);

	// Employee portal on an admin URL → send them back to employee-dashboard equivalents.
	// Admin portal always keeps the full admin sidebar (never stripped).
	React.useEffect(() => {
		if (typeof window === "undefined") return;
		if (pathname?.startsWith("/employee-dashboard")) return;
		if (!isEmployeeBrowserSession()) {
			setAccessRestricted(false);
			return;
		}

		setAccessRestricted(true);
		const path = pathname || "";
		const mapped = ADMIN_PATH_TO_EMPLOYEE[path];
		if (mapped) {
			window.location.replace(mapped);
			return;
		}
		for (const [adminPath, empPath] of Object.entries(ADMIN_PATH_TO_EMPLOYEE)) {
			if (path === adminPath || path.startsWith(`${adminPath}/`)) {
				window.location.replace(empPath);
				return;
			}
		}
		if (
			path.startsWith("/admin") ||
			path.startsWith("/summaries") ||
			path === "/leave" ||
			path.startsWith("/attendance")
		) {
			window.location.replace("/employee-dashboard");
		}
	}, [pathname]);

	// Close the mobile drawer whenever the route changes (after a nav tap).
	React.useEffect(() => {
		setSidebarOpen(false);
	}, [pathname]);

	// Attendance dropdown should stay open if any of its links is active
	React.useEffect(() => {
		const attendanceLinks =
			navGroups.find((g) => g.group === "HR")?.links.find((l) => l.name === "Attendance")
				?.dropdown || [];
		if (attendanceLinks.some((l) => pathname === l.path)) {
			setAttendanceDropdownOpen(true);
		}
	}, [pathname, navGroups]);

	if (embedInEmployeeShell) {
		return <>{children}</>;
	}

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
								if (accessRestricted) return;
								const prev = companyLogo;
								setCompanyLogo(dataUrl);
								void saveCompanyLogo(file).catch(() => {
									setCompanyLogo(prev);
									toastError("Could not save company logo.");
								});
							}}
							onRemove={() => {
								if (accessRestricted) return;
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
				{/* Desktop: left-edge hover dock — slide in/out + content width reflow */}
				<div
					className={`${styles.sidebarDock}${sidebarVisible ? ` ${styles.sidebarDockOpen}` : ""}`}
					onMouseEnter={() => {
						if (isDesktopNav) setNavPeek(true);
					}}
					onMouseLeave={() => {
						if (isDesktopNav) setNavPeek(false);
					}}
				>
					<div className={styles.sidebarRail} aria-hidden title="Hover to open menu" />
					<aside
						className={`${styles.sidebar}${sidebarVisible ? ` ${styles.sidebarSlideIn}` : ""}${sidebarOpen && !isDesktopNav ? ` ${styles.sidebarOpen}` : ""}`}
					>
					<div className={styles.sidebarHeader}>
						<InteractGlobeLogo className={styles.sidebarGlobe} />
						<div className={styles.sidebarBrandText}>
							<span className={styles.sidebarBrandName}>INTERACT</span>
							<span className={styles.sidebarBrandSub}>GLOBAL</span>
						</div>
					</div>
					<nav className={styles.nav}>
						{navGroups.map((group, idx) => (
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
				</div>
				<div
					className={`${styles.contentArea}${isTimePage ? ` ${styles.contentAreaTimePage}` : ""}${contentPushed ? ` ${styles.contentPushed}` : ""}`}
				>
					<main
						className={`${styles.main} ${isTimePage ? styles.mainTimePage : ""}`}
					>
						{children}
					</main>
				</div>
			</div>
		</>
	);
}
