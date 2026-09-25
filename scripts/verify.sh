#!/bin/sh
# verify 一次性服务：代码测试 → 构建检查 → 健康地址冒烟，以退出码汇报结果。
set -eu

APP_URL="${APP_URL:-http://app:80}"

echo "==> [1/3] 代码测试（node --test）"
npm test

echo "==> [2/3] 构建检查（npm run build）"
npm run build
[ -f dist/index.html ] || { echo "构建产物缺失 dist/index.html"; exit 1; }

echo "==> [3/3] 健康地址冒烟（$APP_URL）"
i=0
body=""
until [ "$i" -ge 30 ]; do
  if body=$(wget -q -O - "$APP_URL/health" 2>/dev/null); then
    [ "$body" = "ok" ] && break
  fi
  i=$((i + 1))
  sleep 1
done
if [ "$body" != "ok" ]; then
  echo "健康检查失败：$APP_URL/health 未返回 ok"
  exit 1
fi
echo "    /health 返回 ok"

home=$(wget -q -O - "$APP_URL/" 2>/dev/null || true)
echo "$home" | grep -q "地震预警短二进制码编配工作台" || {
  echo "首页冒烟失败：$APP_URL/ 未包含应用标题"
  exit 1
}
echo "    / 首页包含应用标题"

echo "VERIFY OK：代码测试、构建检查、健康地址冒烟全部通过"
exit 0
