import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: '场景矩阵 | 出行半径 × 关系半径',
    template: '%s | 场景矩阵',
  },
  description:
    '基于飞书知识库场景数据，以出行半径与关系半径为二维坐标，动态生成扇形填充的场景矩阵可视化图表。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="font-sans text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
