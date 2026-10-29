#!/bin/bash
# 纯静态部署构建（腾讯云 COS / 任意静态托管）：产出 out/
# 1) 把后台表格（飞书多维表格，未配置则内置数据）固化为 public/data/scenes.json
# 2) output: export 静态导出 —— 没有 Node 运行时，页面数据读 /data/scenes.json 快照
set -Eeuo pipefail

cd "$(dirname "$0")/.."

echo "[build:static] 1/2 生成场景数据快照…"
pnpm scenes:snapshot

echo "[build:static] 2/2 静态导出 next build（output: export）…"
STATIC_EXPORT=1 NEXT_PUBLIC_STATIC_EXPORT=1 pnpm next build --webpack

if [[ ! -f out/index.html ]]; then
  echo "[build:static] 未生成 out/index.html，构建可能被跳过" >&2
  exit 1
fi
echo "[build:static] 完成：out/ 可直接上传到 COS 桶根目录"
