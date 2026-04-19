FROM node:22-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app
RUN apk add --no-cache wget

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/live-gateway ./apps/live-gateway
COPY packages/core ./packages/core
COPY packages/trakrai-apps ./packages/trakrai-apps

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @trakrai/live-gateway build

WORKDIR /app/apps/live-gateway
ENV NODE_ENV=production

EXPOSE 4000
CMD ["node", "dist/index.js"]
