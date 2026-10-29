import type { NextConfig } from 'next';
import path from 'path';

// 纯静态部署（腾讯云 COS 等）：STATIC_EXPORT=1 pnpm build:static 会导出 out/
const staticExport = process.env.STATIC_EXPORT === '1';

// 部署到桶内子目录（如与博客共用的 COS 桶根目录已被占用）时必须设置，
// 形如 /scenarios（以 / 开头、不带结尾斜杠）；不设则按站点根路径导出。
// 同一变量以 NEXT_PUBLIC_ 前缀编译进客户端，供 scenes-client 的运行时 fetch 拼路径。
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const nextConfig: NextConfig = {
  // outputFileTracingRoot: path.resolve(__dirname, '../../'),  // Uncomment and add 'import path from "path"' if needed
  /* config options here */
  serverExternalPackages: ['coze-coding-dev-sdk'],
  // 静态导出没有 Node 运行时：页面数据走 /data/scenes.json 快照，图片不做按需优化
  ...(staticExport
    ? {
        output: 'export' as const,
        trailingSlash: true,
        ...(basePath ? { basePath } : {}),
      }
    : {}),
  webpack: (config, { dev }) => {
    if (dev && config.cache && config.cache.type === 'filesystem') {
      config.cache.cacheDirectory = path.resolve(
        'node_modules/.cache/next-webpack',
      );
    }
    return config;
  },
  // 预览面板通过 127.0.0.1 访问，需显式放行，否则 HMR/字体等 /_next/* 请求被判定为跨源
  allowedDevOrigins: ['*.dev.coze.site', '127.0.0.1', 'localhost'],
  images: {
    unoptimized: staticExport,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
