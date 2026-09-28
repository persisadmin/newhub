import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["mongodb", "bcryptjs", "pdf-parse", "mammoth"],
};

export default nextConfig;
