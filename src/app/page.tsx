import type { Metadata } from 'next';
import SceneExplorer from '@/components/scene-explorer';

export const metadata: Metadata = {
  title: '场景矩阵 · 出行半径 × 关系半径',
  description:
    '基于飞书知识库场景数据，以出行半径与关系半径为二维坐标，动态生成扇形填充的场景矩阵可视化图表。',
};

export default function Home() {
  return <SceneExplorer />;
}
