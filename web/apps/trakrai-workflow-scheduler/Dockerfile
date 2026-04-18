FROM node:20-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY apps/trakrai-workflow-scheduler ./apps/trakrai-workflow-scheduler
COPY packages/core ./packages/core
COPY packages/trakrai-apps ./packages/trakrai-apps
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile
RUN pnpm --filter trakrai-workflow-scheduler build

WORKDIR /app/apps/trakrai-workflow-scheduler
ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
