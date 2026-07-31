FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS builder
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/ packages/
COPY apps/api/ apps/api/
COPY apps/worker/package.json apps/worker/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @entalent/api... build
RUN pnpm deploy --filter @entalent/api --prod /app/deploy

FROM base AS runner
WORKDIR /app
COPY --from=builder /app/deploy ./
COPY --from=builder /app/apps/api/dist/ dist/

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/main.js"]
