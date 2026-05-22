"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./auth/auth.module.css";

import Image from "next/image";

export default function LoginPage() {
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Debug: log values
    console.log("Login Attempt:", { loginId, password });
    // NEW admin credentials
    const validAdmin =
      ((loginId.trim().toLowerCase() === "admin@interact.com" || loginId.trim().toLowerCase() === "interactadmin" || loginId.trim().toLowerCase() === "admin") && password === "interact123");
    if (validAdmin) {
      router.push("/admin");
    } else {
      setError(`Login failed for: ${loginId}`);
      alert(`Login failed for: ${loginId}\nPassword: ${password}`);
    }
  };

  return (
    <div className={styles.loginContainer}>
      <div className={styles.glassCard}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", marginBottom: "18px" }}>
          <Image src="/logo.png" alt="Interact HRM Logo" width={80} height={80} style={{ borderRadius: "16px" }} />
          <h1 className={styles.companyName}>Interact HRM</h1>
        </div>
        <form className={styles.form} onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Email or Username"
            className={styles.input}
            value={loginId}
            onChange={e => setLoginId(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            className={styles.input}
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
          <button type="submit" className={styles.button}>
            Login
          </button>
        </form>
        {error && <div style={{ color: "red", marginTop: 12 }}>{error}</div>}
        <div className={styles.footer}>
          <span>Powered by Interact Global</span>
        </div>
      </div>
    </div>
  );
}
