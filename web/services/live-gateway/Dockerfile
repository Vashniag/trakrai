FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json ./
RUN pnpm install
COPY tsconfig.json ./
COPY src/ ./src/
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json .
RUN pnpm install --prod
EXPOSE 4000
CMD ["node", "dist/index.js"]
