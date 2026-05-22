
"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import styles from "./login.module.css";

export default function LoginPage() {
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const id = loginId.trim().toLowerCase();
    // Admin login (local, not DB)
    const validAdmin =
      ((id === "admin@interact.com" || id === "interactadmin" || id === "admin") && password === "interact123");
    if (validAdmin) {
      if (typeof window !== "undefined") {
        localStorage.setItem("loginId", loginId);
      }
      router.push("/dashboard");
      setLoading(false);
      return;
    }
    // Employee login via backend
    try {
      const res = await fetch("/api/employee-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, password })
      });
      const data = await res.json();
      if (data.success) {
        if (typeof window !== "undefined") {
          localStorage.setItem("loginId", loginId);
          localStorage.setItem("userRole", data.role || "Officer");
        }
        const role = data.role || "Officer";
        // Route based on role
        if (role === "BOD/CEO") router.push("/bod-dashboard");
        else if (role === "HOD") router.push("/hod-dashboard");
        else if (role === "Management") router.push("/management-dashboard");
        else if (role === "Leader") router.push("/leader-dashboard");
        else router.push("/employee-dashboard");
      } else {
        setError(data.error || "Invalid credentials. Please try again.");
      }
    } catch (err) {
      setError("Login failed. Please try again.");
    }
    setLoading(false);
  };

  return (
    <div className={styles.splitWrap}>
      {/* Left side: animated brand frame */}
      <section className={styles.leftPanel}>
        <div className={styles.leftContent}>
          <div className={styles.brandLockup}>
            <span className={styles.kicker}>WELCOME TO</span>
            <h1 className={styles.brandTitle}><span className={styles.shimmer}>INTERACT GLOBAL</span></h1>
            <h2 className={styles.brandSub}>HRM PLATFORM</h2>
          </div>
          <p className={styles.brandText}>Secure, Fast And Smart Employee Management.</p>
        </div>
        {/* Decorative animations are in CSS via ::before/::after */}
      </section>

      {/* Right side: logo + login form */}
      <section className={styles.rightPanel}>
        <div className={styles.formWrap}>
          <Image src="/logo1.png" alt="Interact Logo" width={96} height={96} className={styles.logoImage} />
          <h3 className={styles.formTitle}>Sign in to continue</h3>

          <form className={styles.form} onSubmit={handleSubmit}>
            <input
              type="text"
              placeholder="Email or Username"
              className={styles.input}
              value={loginId}
              onChange={e => setLoginId(e.target.value)}
              required
            />
            <div className={styles.passwordWrapper}>
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                className={styles.input}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className={styles.togglePasswordBtn}
                onClick={() => setShowPassword(!showPassword)}
                aria-label="Toggle password visibility"
              >
                {showPassword ? <FaEyeSlash /> : <FaEye />}
              </button>
            </div>
            <div className={styles.rowBetween}>
              <label className={styles.remember}><input type="checkbox" /> Remember me</label>
              <a className={styles.linkBtn} onClick={() => router.push('/auth/forgot-password')}>Forgot password?</a>
            </div>
            <button type="submit" className={styles.button} disabled={loading}>
              {loading ? "Logging in..." : "Login"}
            </button>
          </form>

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.rightFooter}>Powered by <a href="https://interactglobals.com/" target="_blank" rel="noopener noreferrer">Interact Global</a><em> v1.0</em></div>
        </div>
      </section>
    </div>
  );
}
