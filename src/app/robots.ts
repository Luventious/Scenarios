import { MetadataRoute } from 'next';

// 纯静态导出（STATIC_EXPORT=1）要求 metadata 路由静态化，robots 本身无需运行时代价
export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/_next/', '/static/'],
    },
  };
}
