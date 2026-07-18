FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS builder
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ packages/
COPY apps/worker/ apps/worker/
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @entalent/worker... build

FROM base AS runner
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ packages/
COPY apps/worker/ apps/worker/
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/packages/*/dist packages/
COPY --from=builder /app/apps/worker/dist apps/worker/dist/

ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "apps/worker/dist/main.js"]
