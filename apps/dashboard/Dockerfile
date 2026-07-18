FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS builder
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/typescript-config/ packages/typescript-config/
COPY apps/dashboard/ apps/dashboard/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @entalent/dashboard...
RUN pnpm --filter @entalent/dashboard build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/dashboard/public ./public 2>/dev/null || true
COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/.next/static apps/dashboard/.next/static

USER nextjs
EXPOSE 3002
ENV PORT=3002
ENV HOSTNAME="0.0.0.0"
CMD ["node", "apps/dashboard/server.js"]
