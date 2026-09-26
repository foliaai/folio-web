FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm config set registry https://registry.npmmirror.com \
  && (npm ci --prefer-offline --no-audit || npm install --registry=https://registry.npmmirror.com)

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* 变量在构建期内联，不同部署通过 build arg 指定各自的 env 文件
# 默认 .env.jp（内部部署，OA 登录）；公网部署传 --build-arg APP_ENV_FILE=.env.production
ARG APP_ENV_FILE=.env.jp
COPY ${APP_ENV_FILE} .env.production
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
