/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // Allow access from any Tailscale device via MagicDNS
  experimental: {
    // Allows server to respond to any Host header (needed for Tailscale MagicDNS)
  },
};
module.exports = nextConfig;
