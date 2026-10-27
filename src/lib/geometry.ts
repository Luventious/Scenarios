import type {
  RadiusKey,
  RelationKey,
  SceneItem,
} from "./types";

export interface Cell {
  scene: SceneItem;
  /** 起始角（弧度） */
  a0: number;
  /** 结束角（弧度） */
  a1: number;
  /** 内半径 */
  r0: number;
  /** 外半径 */
  r1: number;
  /** 角度中点（弧度） */
  mid: number;
}

export interface RelationBand {
  key: RelationKey;
  a0: number;
  a1: number;
  count: number;
}

/**
 * 空扇区占位块：该（关系×半径）组合暂无场景数据时，
 * 用空白色块占满该分区，维持矩阵的完整网格结构
 */
export interface PlaceholderCell {
  relation: RelationKey;
  radius: RadiusKey;
  a0: number;
  a1: number;
  r0: number;
  r1: number;
}

export interface Layout {
  cells: Cell[];
  bands: RelationBand[];
  placeholders: PlaceholderCell[];
  /** 各类别在每个半径层的格数，用于层环统计 */
  radiusCount: Record<RadiusKey, number>;
}

export interface LayoutOptions {
  /** 扇形起始角（度），12 点钟方向为 -90 */
  startAngleDeg: number;
  /** 扇形总跨度（度） */
  sweepDeg: number;
  /** 最内层半径 */
  innerRadius: number;
  /** 每层径向厚度（按 radiusOrder 顺序，长度须一致） */
  ringDepths: number[];
  /** 类别之间的间隙（弧度） */
  bandGap: number;
  /** 同层相邻场景的间隙（弧度） */
  cellGap: number;
  /** 相邻出行半径层（扇区）之间的缝隙（弧度）：比区内 cellGap 宽，随半径同比例缩放 */
  zoneGap: number;
  /** true = 类别角宽按其场景数量占比；false = 六类均分 */
  proportional: boolean;
  /** 参与角度分配的场景（筛选后命中的场景） */
  activeScenes: SceneItem[];
  /** 全部场景（未命中的仍输出 cell，交由视图置灰） */
  allScenes: SceneItem[];
  relationOrder: RelationKey[];
  radiusOrder: RadiusKey[];
}

const DEG = Math.PI / 180;

/** 场景有效权重：飞书《占比》字段，缺省/非法时按等权 1 处理 */
function weightOf(scene: SceneItem): number {
  return typeof scene.weight === "number" && scene.weight > 0
    ? scene.weight
    : 1;
}

export function buildLayout(opts: LayoutOptions): Layout {
  const {
    startAngleDeg,
    sweepDeg,
    innerRadius,
    ringDepths,
    bandGap,
    cellGap,
    zoneGap,
    proportional,
    activeScenes,
    allScenes,
    relationOrder,
    radiusOrder,
  } = opts;

  const totalSweep = sweepDeg * DEG;
  const start = startAngleDeg * DEG;
  const usableBands = relationOrder.length;
  const usableSweep = totalSweep - bandGap * (usableBands - 1);

  // 每个类别按"活跃场景数"决定角宽（动态扇形填充）
  const activeCountByRelation = new Map<RelationKey, number>();
  for (const key of relationOrder) activeCountByRelation.set(key, 0);
  for (const s of activeScenes) {
    activeCountByRelation.set(
      s.relation,
      (activeCountByRelation.get(s.relation) ?? 0) + 1,
    );
  }
  const totalActive = activeScenes.length;

  let cursor = start;
  const bands: RelationBand[] = [];
  const bandRange = new Map<RelationKey, { a0: number; a1: number }>();

  relationOrder.forEach((key, i) => {
    let width: number;
    if (totalActive === 0 || !proportional) {
      width = usableSweep / usableBands;
    } else {
      const count = activeCountByRelation.get(key) ?? 0;
      // 零命中类别保留一个最小宽度，保证结构可读
      const minWidth = usableSweep * 0.03;
      const flexWidth = usableSweep - minWidth * usableBands;
      width =
        minWidth + flexWidth * (count / totalActive);
    }
    const a0 = cursor;
    const a1 = cursor + width;
    bands.push({
      key,
      a0,
      a1,
      count: activeCountByRelation.get(key) ?? 0,
    });
    bandRange.set(key, { a0, a1 });
    cursor = a1 + (i < usableBands - 1 ? bandGap : 0);
  });

  // 类别内部切割规则（维持扇面结构不变）：
  // - R1/R2（内两层）只横切：每场景一行、从里到外堆叠，角宽占满类别区间；
  // - R3/R4 横竖结合：径向二分上下两行（横切，行厚 ∝ 行占比和），
  //   行内沿角度按《占比》分配角宽（竖切）—— 格子面积严格 ∝ 占比。
  // 占比缺失时全部按等权 1 处理，退化为均分。
  const cells: Cell[] = [];
  const placeholders: PlaceholderCell[] = [];
  const radiusCount: Record<RadiusKey, number> = {
    r1: 0,
    r2: 0,
    r3: 0,
    r4: 0,
  };

  for (const key of relationOrder) {
    const range = bandRange.get(key);
    if (!range) continue;
    for (const rKey of radiusOrder) {
      const group = allScenes.filter(
        (s) => s.relation === key && s.radius === rKey,
      );
      const rIndex = radiusOrder.indexOf(rKey);
      const ringDepth = ringDepths[rIndex] ?? ringDepths[0];
      const layerR0 =
        innerRadius +
        ringDepths
          .slice(0, rIndex)
          .reduce((acc: number, d: number) => acc + d, 0);
      // 扇区内容径向区间：三条内部边界（r1|r2、r2|r3、r3|r4）两侧各让半缝，
      // 使层间缝隙 = zoneGap（比区内 cellGap 宽、仍随半径同比例缩放）；
      // 扇面内外沿（白心侧 / 标题区侧）维持原区内半缝节奏不变
      const seamA = (zoneGap - cellGap) / 2;
      const contentR0 = rIndex > 0 ? layerR0 + seamA * layerR0 : layerR0;
      const layerR1 = layerR0 + ringDepth;
      const contentR1 =
        rIndex < radiusOrder.length - 1
          ? layerR1 - seamA * layerR1
          : layerR1;
      if (group.length === 0) {
        // 空扇区：占位色块填满整格（缝隙节奏与真实格子一致），
        // 保证 6 类 × 4 层矩阵结构完整、无空洞
        placeholders.push({
          relation: key,
          radius: rKey,
          a0: range.a0 + cellGap / 2,
          a1: range.a1 - cellGap / 2,
          r0: contentR0 + (cellGap * contentR0) / 2,
          r1: contentR1 - (cellGap * contentR1) / 2,
        });
        continue;
      }
      radiusCount[rKey] += group.length;
      const n = group.length;

      /**
       * 在径向 [r0, r1] 上排放一行场景（竖切）：
       * m=1 占满类别角宽；m>=2 按《占比》分配角宽。
       * 缝隙规则与全局一致：每格两侧各收半缝（横向），
       * 内外弧各让半缝（纵向），缝隙像素 = cellGap × 半径（各向同性）
       */
      const pushRow = (scenes: SceneItem[], r0: number, r1: number) => {
        const m = scenes.length;
        if (m === 0) return;
        const rIn = r0 + (cellGap * r0) / 2;
        const rOut = r1 - (cellGap * r1) / 2;
        if (m === 1) {
          const a0 = range.a0 + cellGap / 2;
          const a1 = range.a1 - cellGap / 2;
          cells.push({
            scene: scenes[0],
            a0,
            a1,
            r0: rIn,
            r1: rOut,
            mid: (a0 + a1) / 2,
          });
          return;
        }
        const sum = scenes.reduce((acc, s) => acc + weightOf(s), 0);
        const usable = range.a1 - range.a0 - cellGap * m;
        let cursor = range.a0 + cellGap / 2;
        for (const s of scenes) {
          const w = (usable * weightOf(s)) / sum;
          cells.push({
            scene: s,
            a0: cursor,
            a1: cursor + w,
            r0: rIn,
            r1: rOut,
            mid: cursor + w / 2,
          });
          cursor += w + cellGap;
        }
      };

      if (rIndex <= 1) {
        // R1/R2 只横切：n 个场景从里到外堆叠成 n 行，行厚均分，
        // 每行角宽全开（不竖切）
        const rowDepth = (contentR1 - contentR0) / n;
        group.forEach((scene, i) => {
          pushRow(
            [scene],
            contentR0 + i * rowDepth,
            contentR0 + (i + 1) * rowDepth,
          );
        });
      } else if (n === 1) {
        // R3/R4 单场景：整层一个大格
        pushRow(group, contentR0, contentR1);
      } else {
        // R3/R4 横竖结合：先横切二分上下两行，行厚 ∝ 行占比和；
        // 场景名长者排外行（半径更大、弧长更长，标签更易排布）；
        // 再行内按占比竖切，格子面积 = 角宽 × 行厚 × 中径 ∝ 占比
        const sorted = [...group].sort(
          (a, b) => b.name.length - a.name.length,
        );
        const outerCount = Math.ceil(n / 2);
        const outer = sorted.slice(0, outerCount);
        const inner = sorted.slice(outerCount);
        const pOut = outer.reduce((acc, s) => acc + weightOf(s), 0);
        const pIn = inner.reduce((acc, s) => acc + weightOf(s), 0);
        const dOut =
          ((contentR1 - contentR0) * pOut) / (pOut + pIn || 1);
        // 外行占 [contentR0 + dIn, contentR1]，内行占 [contentR0, contentR0 + dIn]
        pushRow(outer, contentR1 - dOut, contentR1);
        if (inner.length > 0) {
          pushRow(inner, contentR0, contentR1 - dOut);
        }
      }
    }
  }

  return { cells, bands, placeholders, radiusCount };
}

/** 极坐标 -> 直角坐标（y 向下为正，角度按屏幕顺时针） */
export function polar(
  cx: number,
  cy: number,
  r: number,
  angleRad: number,
): { x: number; y: number } {
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}

/** 生成环形扇区 path */
export function arcPath(
  cx: number,
  cy: number,
  a0: number,
  a1: number,
  r0: number,
  r1: number,
): string {
  const p0 = polar(cx, cy, r1, a0);
  const p1 = polar(cx, cy, r1, a1);
  const p2 = polar(cx, cy, r0, a1);
  const p3 = polar(cx, cy, r0, a0);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return [
    `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)}`,
    `A ${r1} ${r1} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
    `L ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
    `A ${r0} ${r0} 0 ${large} 0 ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`,
    "Z",
  ].join(" ");
}

/**
 * 圆角环形扇区 path：四个角以二次贝塞尔圆滑过渡。
 * rr 自动 clamp 到格子的角宽/径向厚度内，窄格退化为小圆角。
 */
export function roundedSectorPath(
  cx: number,
  cy: number,
  a0: number,
  a1: number,
  r0: number,
  r1: number,
  cornerRadius: number,
): string {
  const arcSpan = a1 - a0;
  const rr = Math.max(
    0.5,
    Math.min(
      cornerRadius,
      (r1 - r0) * 0.28,
      arcSpan * r0 * 0.24,
      arcSpan * r1 * 0.24,
    ),
  );
  // 外弧两端 / 内弧两端的圆角对应的角偏移
  const daOut = Math.min(rr / r1, arcSpan * 0.24);
  const daIn = Math.min(rr / r0, arcSpan * 0.24);

  const q1 = polar(cx, cy, r1, a0 + daOut); // 外弧起点
  const q2 = polar(cx, cy, r1, a1 - daOut); // 外弧终点
  const c2 = polar(cx, cy, r1, a1); // 角点：外弧 a1 端
  const e2 = polar(cx, cy, r1 - rr, a1); // 径向边起点（外向内）
  const e3 = polar(cx, cy, r0 + rr, a1); // 径向边终点
  const c3 = polar(cx, cy, r0, a1); // 角点：内弧 a1 端
  const q3 = polar(cx, cy, r0, a1 - daIn); // 内弧终点
  const q4 = polar(cx, cy, r0, a0 + daIn); // 内弧起点
  const c4 = polar(cx, cy, r0, a0); // 角点：内弧 a0 端
  const e4 = polar(cx, cy, r0 + rr, a0); // 内侧径向边
  const e1 = polar(cx, cy, r1 - rr, a0); // 外侧径向边
  const c1 = polar(cx, cy, r1, a0); // 角点：外弧 a0 端

  const f = (v: number) => v.toFixed(2);
  return [
    `M ${f(q1.x)} ${f(q1.y)}`,
    `A ${f(r1)} ${f(r1)} 0 0 1 ${f(q2.x)} ${f(q2.y)}`,
    `Q ${f(c2.x)} ${f(c2.y)} ${f(e2.x)} ${f(e2.y)}`,
    `L ${f(e3.x)} ${f(e3.y)}`,
    `Q ${f(c3.x)} ${f(c3.y)} ${f(q3.x)} ${f(q3.y)}`,
    `A ${f(r0)} ${f(r0)} 0 0 0 ${f(q4.x)} ${f(q4.y)}`,
    `Q ${f(c4.x)} ${f(c4.y)} ${f(e4.x)} ${f(e4.y)}`,
    `L ${f(e1.x)} ${f(e1.y)}`,
    `Q ${f(c1.x)} ${f(c1.y)} ${f(q1.x)} ${f(q1.y)}`,
    "Z",
  ].join(" ");
}
