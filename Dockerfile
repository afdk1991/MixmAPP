# MixmAPP API 镜像
# 说明：API 由 tsup 打包，第三方 npm 依赖不打进 dist，所以运行层用 pnpm deploy 产出的独立目录。
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

# 先只拷依赖清单，最大化利用层缓存
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY services/api/package.json services/api/
COPY packages/ids/package.json packages/ids/
COPY packages/contracts/package.json packages/contracts/
COPY apps/app/package.json apps/app/
COPY apps/mobile/package.json apps/mobile/
RUN pnpm install --frozen-lockfile --filter "@mixmapp/api..." --filter "@mixmapp/ids" --filter "@mixmapp/contracts"

# 再拷源码并构建
COPY tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
COPY infra ./infra
RUN pnpm --filter @mixmapp/api build \
 && pnpm --filter @mixmapp/api deploy --prod /out/app

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY --from=builder /out/app ./
# 迁移脚本按 cwd/infra/sql 查找 SQL，镜像里带上
COPY --from=builder /repo/infra ./infra

EXPOSE 8080
# 未配置 DATABASE_URL 时进程会 fail-fast 退出，健康检查同样覆盖这种情况
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/readyz" >/dev/null 2>&1 || exit 1

CMD ["node", "dist/index.js"]
