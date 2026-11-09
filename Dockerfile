# 远程服务版镜像：只跑 Node 服务端 + 静态前端，不带 Electron。
FROM node:20-alpine AS build
WORKDIR /src
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build \
  && pnpm exec esbuild server/index.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --target=node20 \
    --external:vite \
    --external:bufferutil \
    --external:utf-8-validate \
    --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
    --outfile=build/server.mjs

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PLAYGO_PROD=1 \
    PLAYGO_ROOT=/app \
    PLAYGO_HOST=0.0.0.0 \
    PORT=8787

COPY --from=build /src/build/server.mjs ./server.mjs
COPY --from=build /src/dist ./dist

USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/api/health >/dev/null || exit 1

CMD ["node", "server.mjs", "--prod"]
