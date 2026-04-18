FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json ./
RUN pnpm install --no-frozen-lockfile
COPY tsconfig.json ./
COPY src/ ./src/
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate \
    && apk add --no-cache wget
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json .
RUN pnpm install --prod --no-frozen-lockfile
EXPOSE 4000
CMD ["node", "dist/index.js"]
