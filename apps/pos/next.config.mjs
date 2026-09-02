// Next.js static export — no Node server on the till device.
// Tauri packages the built output; PowerSync Tauri SDK handles all data I/O.

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  experimental: {
    typedRoutes: true,
  },
  // Custom access to Tauri APIs requires disabling React strict-mode double-invoke
  // for the sync engine, per PowerSync Tauri SDK docs.
  reactStrictMode: false,
};

export default nextConfig;
