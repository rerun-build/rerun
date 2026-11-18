import { withPostHogConfig } from "@posthog/nextjs-config";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

process.env.NEXT_PUBLIC_BUILD_SHA ??= process.env.NODE_ENV === "production" ? `build-${Date.now()}` : "dev";

const nextConfig: NextConfig = {
  allowedDevOrigins: [...(process.env.ALLOWED_DEV_ORIGINS?.split(",") ?? []), "*.conductor.show"],
  transpilePackages: ["@rerun/ui", "@rerun/emails", "@rerun/db", "@rerun/analytics", "@rerun/i18n"],
  serverExternalPackages: ["ssh2"],
  env: {
    NEXT_PUBLIC_BUILD_SHA: process.env.NEXT_PUBLIC_BUILD_SHA,
  },
  experimental: {
    serverActions: { bodySizeLimit: "64mb" },
    agentUpgrade: "security",
  },
  async redirects() {
    const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL;
    if (!adminUrl) return [];
    return [
      { source: "/logo", destination: `${adminUrl}/admin/brand/logo`, permanent: false },
      { source: "/brand/:path*", destination: `${adminUrl}/admin/brand/:path*`, permanent: false },
    ];
  },
  async rewrites() {
    return [
      { source: "/ingest/static/:path*", destination: "https://eu-assets.i.posthog.com/static/:path*" },
      { source: "/ingest/array/:path*", destination: "https://eu-assets.i.posthog.com/array/:path*" },
      { source: "/ingest/:path*", destination: "https://eu.i.posthog.com/:path*" },
    ];
  },
  skipTrailingSlashRedirect: true,
};

const posthogApiKey = process.env.POSTHOG_PERSONAL_API_KEY;
const posthogProjectId = process.env.POSTHOG_PROJECT_ID;
const reportsErrorsToPostHog = Boolean(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN);

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

export default withPostHogConfig(withNextIntl(nextConfig), {
  personalApiKey: posthogApiKey ?? "",
  projectId: posthogProjectId,
  host: "https://eu.posthog.com",
  sourcemaps: {
    enabled: Boolean(reportsErrorsToPostHog && posthogApiKey && posthogProjectId),
    releaseMode: "symbol-set",
    releaseName: "rerun-ui",
    releaseVersion: process.env.NEXT_PUBLIC_BUILD_SHA,
  },
});
