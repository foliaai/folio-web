/** @type {import('next').NextConfig} */
const skillServiceUrl =
  process.env.SKILL_SERVICE_URL || "http://localhost:8001";
const authServiceUrl =
  process.env.AUTH_SERVICE_URL || "http://localhost:8003";

const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  turbopack: {},
  allowedDevOrigins: ["192.168.35.11"],
  devIndicators: false,
  async rewrites() {
    return [
      {
        source: "/skill-api/:path*",
        destination: `${skillServiceUrl}/:path*`,
      },
      // 统一认证服务：登录 / 用户资料 / 全局设置。
      // 前端调 /auth-api/<子路径>，实际转发到 auth-server 的 /api/<子路径>，
      // 如 /auth-api/auth/oa/login -> :8003/api/auth/oa/login。
      {
        source: "/auth-api/:path*",
        destination: `${authServiceUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
