FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS builder
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/ packages/
COPY apps/worker/ apps/worker/
COPY apps/api/package.json apps/api/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @entalent/worker... build
RUN pnpm deploy --filter @entalent/worker --prod /app/deploy

FROM base AS runner
WORKDIR /app
COPY --from=builder /app/deploy ./
COPY --from=builder /app/apps/worker/dist/ dist/

ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "dist/main.js"]
