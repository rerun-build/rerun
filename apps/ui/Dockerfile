# The web app of Rerun. Built from the repository root: docker build -f apps/ui/Dockerfile .
# The NEXT_PUBLIC_* values are read by the browser bundle, so they are baked in at build time.
FROM node:26-bookworm-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN npm install -g corepack && corepack enable
WORKDIR /app

FROM base AS build
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
ARG NEXT_PUBLIC_ADMIN_EMAILS
ARG NEXT_PUBLIC_OAUTH_PROVIDERS
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_HCAPTCHA_SITE_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=$NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN \
    NEXT_PUBLIC_ADMIN_EMAILS=$NEXT_PUBLIC_ADMIN_EMAILS \
    NEXT_PUBLIC_OAUTH_PROVIDERS=$NEXT_PUBLIC_OAUTH_PROVIDERS \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY \
    NEXT_PUBLIC_HCAPTCHA_SITE_KEY=$NEXT_PUBLIC_HCAPTCHA_SITE_KEY \
    NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN --mount=type=cache,id=rerun-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store --filter rerun... --filter @rerun/contracts
RUN --mount=type=cache,id=rerun-ui-next-cache,target=/app/apps/ui/.next/cache \
    pnpm --filter @rerun/contracts build && pnpm --filter rerun build

FROM base
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build /app /app
WORKDIR /app/apps/ui
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start"]
