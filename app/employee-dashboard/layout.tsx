"use client";
import React from "react";
import { useRouter, usePathname } from "next/navigation";
import { FaTachometerAlt, FaClock, FaCalendarAlt, FaCoffee, FaUser } from "react-icons/fa";
import styles from "../layout-dashboard.module.css";

const employeeTabs = [
  { name: "Dashboard", path: "/employee-dashboard", icon: <FaTachometerAlt /> },
  { name: "My Info", path: "/employee-dashboard/my-info", icon: <FaUser /> },
  { name: "Time", path: "/employee-dashboard/time", icon: <FaClock /> },
  { name: "Leave", path: "/employee-dashboard/leave", icon: <FaCalendarAlt /> }
];

export default function EmployeeDashboardLayout({ children }: { children: React.ReactNode }) {
    // ...existing code...
  const router = useRouter();
  const pathname = usePathname();
  // Get employee name from API using loginId
  const [employeeName, setEmployeeName] = React.useState<string>("");
  React.useEffect(() => {
    if (typeof window !== "undefined") {
      const loginId = localStorage.getItem("loginId");
      if (!loginId) {
        // Auto-logout: redirect to login if loginId missing (e.g., after cache clear)
        window.location.href = "/auth";
        return;
      }
      // ...existing code for fetching employee name...
      let apiUrl = "/api/hrm_employees?";
      if (loginId.includes("@")) {
        apiUrl += `email=${loginId}`;
      } else {
        apiUrl += `username=${loginId}`;
      }
      Promise.all([
        fetch(apiUrl).then(res => res.json()).catch(e => ({ success: false, error: e })),
        fetch(`/api/hrm_employees?employeeId=${loginId}`).then(res => res.json()).catch(e => ({ success: false, error: e }))
      ]).then(([data1, data2]) => {
        const data = (data1.success ? data1 : data2);
        if (data.success && data.employee) {
          const name = (data.employee.first_name || "") + (data.employee.last_name ? " " + data.employee.last_name : "");
          setEmployeeName(name.trim());
        } else {
          setEmployeeName("Employee");
        }
      })
      .catch(err => {
        setEmployeeName("Employee");
      });
    }
  }, []);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

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
              <span className={styles.topBarProfilePic} style={{backgroundImage: "url('https://ui-avatars.com/api/?name=" + employeeName + "')"}}></span>
            ) : (
              <span className={styles.topBarProfileInitials}>{employeeName ? employeeName[0] : "E"}</span>
            )}
            <span className={styles.topBarProfileName}>{employeeName || "Employee"}</span>
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
            {employeeTabs.map((tab, idx) => {
              const isActive = pathname === tab.path;
              return (
                <div
                  key={tab.path || idx}
                  onClick={() => router.push(tab.path)}
                  className={isActive ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem}
                >
                  <span className={styles.navIcon}>{tab.icon}</span>
                  <span>{tab.name}</span>
                </div>
              );
            })}
          </nav>
        </aside>
        <div className={styles.contentArea}>
          <main className={styles.main}>{children}</main>
        </div>
      </div>
    </>
  );
}
