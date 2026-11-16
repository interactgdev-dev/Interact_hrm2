"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";

const FaceEnrollmentClient = dynamic(() => import("./FaceEnrollmentClient"), {
  ssr: false,
  loading: () => (
    <div style={{ padding: 24, textAlign: "center", color: "#64748b" }}>
      Loading face enrollment…
    </div>
  ),
});

export default function FaceEnrollmentLoader() {
  // Kick off tfjs + face-api JS parse while the client chunk downloads.
  useEffect(() => {
    void import("@/lib/face-client-engine").then((m) => m.preloadFaceRuntime());
  }, []);

  return <FaceEnrollmentClient />;
}
