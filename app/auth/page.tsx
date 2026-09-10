
"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { FaEye, FaEyeSlash, FaUser } from "react-icons/fa";
import {
  loadSavedLogins,
  persistSavedLogin,
  type SavedLogin,
} from "@/lib/saved-login-client";
import styles from "./login.module.css";
import { AuthLoginCarousel } from "./AuthLoginCarousel";

type CarouselSlideDto = { id: number; url: string };
type CarouselSettingsDto = {
  enabled: boolean;
  intervalMs: number;
  animation: "fade" | "fade-zoom" | "slide";
  includeBrandSlide: boolean;
};

export default function LoginPage() {
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [showSavedPicker, setShowSavedPicker] = useState(false);
  const [savedLogins, setSavedLogins] = useState<SavedLogin[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [carouselImages, setCarouselImages] = useState<CarouselSlideDto[]>([]);
  const [carouselSettings, setCarouselSettings] = useState<CarouselSettingsDto>({
    enabled: true,
    intervalMs: 5000,
    animation: "fade",
    includeBrandSlide: true,
  });

  const syncSavedLogins = useCallback(async () => {
    const saved = await loadSavedLogins();
    setSavedLogins(saved);
    if (saved.length > 0) setRememberMe(true);
    return saved;
  }, []);

  useEffect(() => {
    void syncSavedLogins();
  }, [syncSavedLogins]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/login-carousel", { cache: "no-store" });
        const data = await res.json();
        if (cancelled || !data.success) return;
        if (data.settings) {
          setCarouselSettings({
            enabled: data.settings.enabled !== false,
            intervalMs: Number(data.settings.intervalMs) || 5000,
            animation: data.settings.animation || "fade",
            includeBrandSlide: data.settings.includeBrandSlide !== false,
          });
        }
        if (Array.isArray(data.slides)) {
          setCarouselImages(
            data.slides.map((s: { id: number; url: string }) => ({
              id: s.id,
              url: s.url,
            }))
          );
        }
      } catch {
        /* keep brand-only fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persistCredentials = useCallback(
    async (id: string, pass: string) => {
      if (!rememberMe) return;
      const ok = await persistSavedLogin(id, pass);
      if (ok) {
        const updated = await loadSavedLogins();
        setSavedLogins(updated);
      }
    },
    [rememberMe]
  );

  const performLogin = useCallback(
    async (rawLoginId: string, rawPassword: string) => {
      setError("");
      setLoading(true);
      const trimmedLoginId = rawLoginId.trim();
      const id = trimmedLoginId.toLowerCase();
      const isAdminId =
        id === "admin@interact.com" || id === "interactadmin" || id === "admin";

      if (isAdminId) {
        const adminRes = await fetch("/api/admin-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ loginId: trimmedLoginId, password: rawPassword }),
        });
        const adminData = await adminRes.json();
        if (adminData.success) {
          if (typeof window !== "undefined") {
            localStorage.setItem("loginId", trimmedLoginId);
          }
          await persistCredentials(trimmedLoginId, rawPassword);
          router.push("/dashboard");
          setLoading(false);
          return;
        }
        setError(adminData.error || "Invalid admin credentials.");
        setLoading(false);
        return;
      }

      try {
        const res = await fetch("/api/employee-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ loginId: trimmedLoginId, password: rawPassword }),
        });
        const data = await res.json();
        if (data.success) {
          if (typeof window !== "undefined") {
            localStorage.setItem("loginId", trimmedLoginId);
            localStorage.setItem("userRole", data.role || data.employee?.role || "Officer");
          }
          await persistCredentials(trimmedLoginId, rawPassword);
          // Keep role in localStorage for My Team / hierarchy. Dedicated
          // bod|hod|management|leader dashboard routes do not exist → always employee-dashboard.
          router.push("/employee-dashboard");
        } else {
          setError(data.error || "Invalid credentials. Please try again.");
        }
      } catch {
        setError("Login failed. Please try again.");
      }
      setLoading(false);
    },
    [persistCredentials, router]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await performLogin(loginId, password);
  };

  const handleUseSaved = (saved: SavedLogin) => {
    setLoginId(saved.loginId);
    setPassword(saved.password);
    setShowSavedPicker(false);
  };

  const openSavedPickerIfNeeded = () => {
    void syncSavedLogins().then((saved) => {
      if (saved.length > 0) setShowSavedPicker(true);
    });
  };

  const closeSavedPicker = () => {
    window.setTimeout(() => setShowSavedPicker(false), 180);
  };

  const hasSavedPanel = showSavedPicker && savedLogins.length > 0;

  return (
    <div className={styles.splitWrap}>
      <section className={styles.leftPanel}>
        <a
          className={styles.topLogo}
          href="https://interactglobals.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Image
            src="/logo1.png"
            alt="Interact Global"
            width={120}
            height={96}
            className={styles.topLogoImg}
            priority
          />
        </a>
        <AuthLoginCarousel
          images={carouselImages}
          includeBrandSlide={carouselSettings.includeBrandSlide}
          enabled={carouselSettings.enabled}
          intervalMs={carouselSettings.intervalMs}
          animation={carouselSettings.animation}
          brand={
            <>
              <div className={styles.brandLockup}>
                <span className={styles.kicker}>WELCOME TO</span>
                <h1 className={styles.brandTitle}>
                  <span className={styles.shimmer}>INTERACT GLOBAL</span>
                </h1>
                <h2 className={styles.brandSub}>HRM PLATFORM</h2>
              </div>

              <p className={styles.brandText}>
                Your day, your team, your records — in one calm workspace.
              </p>

              <div className={styles.wordStrip} aria-label="What you can manage">
                <span>Attendance</span>
                <span className={styles.dot} aria-hidden />
                <span>Leave</span>
                <span className={styles.dot} aria-hidden />
                <span>Payroll</span>
                <span className={styles.dot} aria-hidden />
                <span>My Team</span>
              </div>

              <p className={styles.heroFoot}>Sign in on the right to continue.</p>
            </>
          }
        />
      </section>

      <section className={styles.rightPanel}>
        <div className={`${styles.formWrap} ${hasSavedPanel ? styles.formWrapWithSaved : ""}`}>
          <div className={styles.loginCard}>
            <div className={styles.logoWrap}>
              <Image
                src="/logo1.png"
                alt="Interact Global"
                width={110}
                height={90}
                className={styles.logoImage}
                priority
              />
            </div>
            <h3 className={styles.formTitle}>Sign in to continue</h3>
            <p className={styles.formSubtitle}>
              Enter your credentials to access the HRM workspace
            </p>

            <div className={styles.formRow}>
              <form className={styles.form} onSubmit={handleSubmit} method="post" autoComplete="on">
                <input
                  type="text"
                  name="username"
                  autoComplete="username"
                  placeholder="Email, username, or employee ID"
                  className={styles.input}
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  onFocus={openSavedPickerIfNeeded}
                  onClick={openSavedPickerIfNeeded}
                  onBlur={closeSavedPicker}
                  required
                />
                <div className={styles.passwordWrapper}>
                  <input
                    type={showPassword ? "text" : "password"}
                    name="password"
                    autoComplete="current-password"
                    placeholder="Password"
                    className={styles.input}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={openSavedPickerIfNeeded}
                    onClick={openSavedPickerIfNeeded}
                    onBlur={closeSavedPicker}
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
                  <label className={styles.remember}>
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                    />
                    Remember me
                  </label>
                  <a
                    className={styles.linkBtn}
                    onClick={() => router.push("/auth/forgot-password")}
                  >
                    Forgot password?
                  </a>
                </div>
                <button type="submit" className={styles.button} disabled={loading}>
                  {loading ? "Logging in..." : "Login"}
                </button>
              </form>

              {hasSavedPanel ? (
                <aside
                  className={styles.savedPanel}
                  onMouseDown={(e) => e.preventDefault()}
                  aria-label="Saved logins on this device"
                >
                  <div className={styles.savedPanelTitle}>Saved on this device</div>
                  <div className={styles.savedPanelList}>
                    {savedLogins.map((saved) => (
                      <button
                        key={saved.loginId}
                        type="button"
                        className={styles.savedAccountBtn}
                        onClick={() => handleUseSaved(saved)}
                      >
                        <FaUser className={styles.savedAccountIcon} aria-hidden />
                        <span className={styles.savedAccountText}>
                          <strong>{saved.loginId}</strong>
                          <span>Saved password</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </aside>
              ) : null}
            </div>

            {error && <div className={styles.error}>{error}</div>}
          </div>

          <div className={styles.rightFooter}>
            Powered by{" "}
            <a href="https://interactglobals.com/" target="_blank" rel="noopener noreferrer">
              Interact Global
            </a>
            <em> v1.0</em>
          </div>
        </div>
      </section>
    </div>
  );
}
