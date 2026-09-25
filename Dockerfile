# ---------- 构建阶段：代码测试 + 构建检查，产出静态站点 ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY tests ./tests
COPY scripts ./scripts
RUN node --test tests/*.test.mjs && node scripts/build.mjs

# ---------- 运行阶段：nginx 托管静态文件 ----------
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/health || exit 1
