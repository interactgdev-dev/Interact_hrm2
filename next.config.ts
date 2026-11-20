import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** face-api / tfjs are browser-only; avoid server bundle resolution issues on Linux CI. */
  serverExternalPackages: ["@tensorflow/tfjs", "@vladmandic/face-api", "tesseract.js"],
  /** Smaller client graphs for icon-heavy admin/employee shells. */
  experimental: {
    optimizePackageImports: ["react-icons", "react-icons/fa", "react-icons/fi"],
  },
  async redirects() {
    return [
      {
        source: "/",
        destination: "/auth",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        // Model weights are static — cache hard so tab reopen loads from disk
        // instead of re-downloading several MB on every fresh session.
        source: "/models/face-api/:file*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
  poweredByHeader: false,
};

export default nextConfig;
