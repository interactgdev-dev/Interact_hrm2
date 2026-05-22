import React from "react";
import Link from "next/link";
import styles from "./auth.module.css";

export default function LoginPage() {
  return (
    <div className={styles.loginContainer}>
      <div className={styles.glassCard}>
        <h1 className={styles.title}>Interact HRM</h1>
        <h2 className={styles.subtitle}>Admin Login</h2>
        <form className={styles.form}>
          <input
            type="email"
            placeholder="Email"
            className={styles.input}
            required
          />
          <input
            type="password"
            placeholder="Password"
            className={styles.input}
            required
          />
          <button type="submit" className={styles.button}>
            Login
          </button>
        </form>
        <div className={styles.footer}>
          <span>Powered by Interact HRM</span>
        </div>
      </div>
    </div>
  );
}
