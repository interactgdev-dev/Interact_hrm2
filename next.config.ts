import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** face-api / tfjs are browser-only; avoid server bundle resolution issues on Linux CI. */
  serverExternalPackages: ["@tensorflow/tfjs", "@vladmandic/face-api"],
  async redirects() {
    return [
      {
        source: "/",
        destination: "/auth",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    // Runtime files under public/uploads are not in the build snapshot — proxy
    // legacy /uploads/* links (tickets, leave docs, etc.) through the API streamer.
    return [
      {
        source: "/uploads/:path*",
        destination: "/api/uploads/:path*",
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
