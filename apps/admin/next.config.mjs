/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: true,
  // Allow dev requests forwarded through VS Code port-forwarding / devtunnels
  allowedDevOrigins: ["*.devtunnels.ms"],
};

export default nextConfig;
