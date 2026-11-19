"use client";

import dynamic from "next/dynamic";

const FaceEnrollmentClient = dynamic(() => import("./FaceEnrollmentClient"), {
  ssr: false,
  loading: () => (
    <div style={{ padding: 24, textAlign: "center", color: "#64748b" }}>
      Loading face enrollment…
    </div>
  ),
});

export default function FaceEnrollmentLoader() {
  return <FaceEnrollmentClient />;
}
