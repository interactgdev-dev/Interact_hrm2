"use client";

import Link from "next/link";
import { FaArrowLeft } from "react-icons/fa";
import styles from "./back-to-dashboard.module.css";

type Props = {
  href?: string;
  label?: string;
  className?: string;
};

export function BackToDashboard({
  href = "/employee-dashboard",
  label = "Dashboard",
  className,
}: Props) {
  return (
    <Link
      href={href}
      className={className ? `${styles.backLink} ${className}` : styles.backLink}
    >
      <FaArrowLeft aria-hidden /> {label}
    </Link>
  );
}
