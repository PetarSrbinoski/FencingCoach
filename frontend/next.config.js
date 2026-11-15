/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // Optional local preview: keep phone requests same-origin and dev artifacts
  // separate from the production build. Normal deployments are unchanged.
  ...(process.env.COACH_PREVIEW_API_URL ? {
    distDir: ".next-coach-preview",
    env: { NEXT_PUBLIC_API_BASE_URL: "/api" },
    async rewrites() {
      const upstream = new URL(process.env.COACH_PREVIEW_API_URL).origin;
      return [{ source: "/api/:path*", destination: `${upstream}/:path*` }];
    },
  } : {}),
};
module.exports = nextConfig;
