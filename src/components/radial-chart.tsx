"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  GradientStop,
  RadiusKey,
  RadiusTexture,
  RelationKey,
  SceneItem,
} from "@/lib/types";
import {
  arcPath,
  buildLayout,
  polar,
  roundedSectorPath,
  type Cell,
  type Layout,
} from "@/lib/geometry";

// 120° 扇形几何（圆心靠右下，扇面自 -180° 张至 -60°，朝左上方向展开）
const VIEW_W = 1010;
const VIEW_H = 680;
const CX = 658;
const CY = 668;
const INNER = 104;
/**
 * 各半径层径向厚度递增（内薄外厚）：靠近圆心的格子上下边缘小、
 * 远离圆心的格子上下边缘大，扇形从内圈细长放射条渐变为外圈宽扁弧条
 */
const RING_DEPTHS = [88, 112, 128, 148];
/** 场景区外沿半径（INNER + 各层厚度之和） */
const OUTER_R = INNER + RING_DEPTHS.reduce((a, b) => a + b, 0);
/** 各半径层外沿半径（r1→r4 依次为 192/304/432/580），用于每层一体的径向渐变 */
const ZONE_EDGES = RING_DEPTHS.map(
  (_, i) => INNER + RING_DEPTHS.slice(0, i + 1).reduce((a, b) => a + b, 0),
);
const START_DEG = -180;
const SWEEP_DEG = 120;
const BAND_GAP_DEG = 0.8;
/**
 * 各向同性缝隙（弧度）：横向与纵向缝隙均取 cellGap × 半径 像素，
 * 任意半径处格子四周缝宽一致，内密外疏呈放射节奏
 */
const CELL_GAP_DEG = 0.55;
/**
 * 扇区（出行半径层）间缝隙：比区内格子缝隙宽 ×3，三条内部边界
 * （r1|r2、r2|r3、r3|r4）呈清晰层间分界；与各向同性缝隙一样按
 * zoneGap × 半径 取像素——任意半径处层间缝恒为区内竖向缝的 3 倍，
 * 节奏同源、和谐一致
 */
const ZONE_GAP_DEG = CELL_GAP_DEG * 3;
/** 圆角扇形基准圆角半径 */
const CORNER_R = 6;
/**
 * 关系标题区（无填充色带，艺术字 + 经纬刻度）：
 * 细弧经纬线 596 / 思源宋体中文标题 616 / Playfair 斜体英文注记 638 / 呼吸外弧 648
 */
const HAIRLINE_R = 596;
const CN_R = 616;
const EN_R = 638;
/** 呼吸外弧 */
const BREATH_R = 648;

const DEG = Math.PI / 180;

const RADIUS_ORDER: RadiusKey[] = ["r1", "r2", "r3", "r4"];

/**
 * 确定性伪随机（0~1，FNV-1a 字符串哈希）：扇区出场乱序的种子——
 * 服务端与客户端结果一致（避免水合抖动），重渲染/筛选时顺序稳定不闪烁
 */
function hashRand(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * 出场延迟：层序主导从里到外（r1→r4 每层 +150ms），
 * 层内按 id 哈希随机错峰（0~260ms）——扇区从里到外跳出、顺序随机
 */
function enterDelayMs(radius: RadiusKey, seed: string): number {
  return RADIUS_ORDER.indexOf(radius) * 150 + hashRand(seed) * 260;
}
const RELATION_ORDER: RelationKey[] = [
  "solo",
  "intimate",
  "family",
  "pet",
  "interest",
  "business",
];

/** 关系类别英文注记（杂志风斜体小字，与序号组合成 N°01 · XXX） */
const RELATION_EN: Record<RelationKey, string> = {
  solo: "ME TIME",
  intimate: "INTIMACY",
  family: "FAMILY",
  pet: "PETS",
  interest: "INTERESTS",
  business: "BUSINESS",
};

export interface HoverInfo {
  cell: Cell;
  px: number;
  py: number;
  flip: boolean;
}

interface RadialChartProps {
  scenes: SceneItem[];
  radiusColors: Record<RadiusKey, string>;
  /** 各层渐变停靠点（位置 0=深端、1=浅端），驱动每层一体的径向渐变填充 */
  radiusGradients: Partial<Record<RadiusKey, GradientStop[]>>;
  /** 各层分区织纹：平行渐变流向=放射细线（笔刷纹）/ 垂直=同心弧线（纸张纹） */
  radiusTextures: Partial<Record<RadiusKey, RadiusTexture>>;
  relationNames: Record<RelationKey, string>;
  radiusNames: Record<RadiusKey, string>;
  relationDescs: Record<RelationKey, string>;
  activeScenes: SceneItem[];
  proportional: boolean;
  selectedId: string | null;
  onSelect: (scene: SceneItem) => void;
  zoomInTick: number;
  zoomOutTick: number;
  resetTick: number;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

interface CellLabel {
  fontSize: number;
  text: string;
}

/**
 * 文字方向规范：全部沿弧弯曲排布——文字经 textPath 贴在格子中弧
 * （r=格子中径，a0→a1 顺时针弧），每个字沿圆弧弯曲、字字相随，
 * 阅读方向沿弧顺时针，全程无颠倒翻转。
 * 字号按「弧长 × 行高」双约束自适应（6–13.5px）：
 * - 弧长约束：fs ≤ (arcLen - 5) / (n × 1.06)，单行完整排布所需宽度
 * - 行高约束：fs ≤ thick - 2，R1/R2 堆叠行薄时字号随行厚收缩、文字不溢出
 * 弧长不足时按弧长截断并加省略号；连 2 个字都放不下的窄格不渲染文字，
 * 由 hover tooltip 补全。
 */
function fitCellText(name: string, cell: Cell): CellLabel | null {
  const midR = (cell.r0 + cell.r1) / 2;
  const arcLen = (cell.a1 - cell.a0) * midR;
  const thick = cell.r1 - cell.r0;
  const n = name.length;
  const cap = Math.min(13.5, thick - 2);
  if (cap < 6) return null;
  // 1. 完整显示（弧长与行高双约束）
  const fs = Math.min(cap, (arcLen - 5) / (n * 1.06));
  if (fs >= 7.5) return { fontSize: fs, text: name };
  // 2. 截断显示（保留 m-1 字 + 省略号），字号随行高收缩但不低于 6px
  const fsTrunc = Math.min(7.5, cap);
  const m = Math.floor((arcLen - 5) / (fsTrunc * 1.06));
  if (m >= 2) return { fontSize: fsTrunc, text: `${name.slice(0, m - 1)}…` };
  return null;
}

/**
 * 分区织纹 path（源纹理的极坐标映射，静态几何、不随格子补间变化）：
 * - parallel（笔刷纹）：纹理线与渐变流向平行 → 从内圈放射到外沿的细线，
 *   沿角度方向按 period 排布（间距以层中部半径为基准，内密外疏）
 * - cross（纸张纹）：纹理线与渐变流向垂直 → 同心弧线，
 *   沿半径方向按 period 排布（条带宽 width、间隙 period-width，与源节奏一致）
 * 覆层横跨整层环带（含格子缝隙），让整区读作一块织纹渐变面料
 */
function buildTextureD(
  tex: RadiusTexture,
  zoneInner: number,
  zoneOuter: number,
): string {
  const half = tex.width / 2;
  const rIn = zoneInner + half;
  const rOut = zoneOuter - half;
  const a0 = START_DEG * DEG;
  const a1 = (START_DEG + SWEEP_DEG) * DEG;
  const segs: string[] = [];
  if (tex.orient === "parallel") {
    const midR = (zoneInner + zoneOuter) / 2;
    const stepDeg = (tex.period / midR) * (180 / Math.PI);
    for (let d = START_DEG; d <= START_DEG + SWEEP_DEG + 1e-9; d += stepDeg) {
      const p0 = polar(CX, CY, rIn, d * DEG);
      const p1 = polar(CX, CY, rOut, d * DEG);
      segs.push(
        `M ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} L ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`,
      );
    }
  } else {
    let center = tex.period - half;
    while (center + half <= zoneOuter - zoneInner) {
      const r = zoneInner + center;
      const p0 = polar(CX, CY, r, a0);
      const p1 = polar(CX, CY, r, a1);
      segs.push(
        `M ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`,
      );
      center += tex.period;
    }
  }
  return segs.join(" ");
}

/** 布局补间：角度/半径平滑过渡（动态填充重排动效） */
function useTweenLayout(target: Layout, duration = 420): Layout {
  const [current, setCurrent] = useState<Layout>(target);
  const prevRef = useRef<Layout | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const from = prevRef.current;
    prevRef.current = target;
    if (!from) {
      setCurrent(target);
      return;
    }
    const fromCells = new Map(from.cells.map((c) => [c.scene.id, c]));
    const fromBands = new Map(from.bands.map((b) => [b.key, b]));
    const fromPlaceholders = new Map(
      from.placeholders.map((p) => [`${p.relation}:${p.radius}`, p]),
    );
    const start = performance.now();
    const tick = (now: number) => {
      const raw = Math.min(1, (now - start) / duration);
      const e = easeInOutCubic(raw);
      const cells = target.cells.map((tc) => {
        const fc = fromCells.get(tc.scene.id);
        if (!fc) {
          const mid = (tc.a0 + tc.a1) / 2;
          return {
            ...tc,
            a0: mid + (tc.a0 - mid) * e,
            a1: mid + (tc.a1 - mid) * e,
            mid,
          };
        }
        const a0 = fc.a0 + (tc.a0 - fc.a0) * e;
        const a1 = fc.a1 + (tc.a1 - fc.a1) * e;
        return { ...tc, a0, a1, mid: (a0 + a1) / 2 };
      });
      const bands = target.bands.map((tb) => {
        const fb = fromBands.get(tb.key);
        if (!fb) return tb;
        return {
          ...tb,
          a0: fb.a0 + (tb.a0 - fb.a0) * e,
          a1: fb.a1 + (tb.a1 - fb.a1) * e,
        };
      });
      // 空扇区占位块随类别角宽一起补间（半径静态，仅角度变化）
      const placeholders = target.placeholders.map((tp) => {
        const fp = fromPlaceholders.get(`${tp.relation}:${tp.radius}`);
        if (!fp) return tp;
        return {
          ...tp,
          a0: fp.a0 + (tp.a0 - fp.a0) * e,
          a1: fp.a1 + (tp.a1 - fp.a1) * e,
        };
      });
      setCurrent({ ...target, cells, bands, placeholders });
      if (raw < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return current;
}

export default function RadialChart(props: RadialChartProps) {
  const {
    scenes,
    radiusColors,
    radiusGradients,
    radiusTextures,
    relationNames,
    radiusNames,
    relationDescs,
    activeScenes,
    proportional,
    selectedId,
    onSelect,
    zoomInTick,
    zoomOutTick,
    resetTick,
  } = props;

  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [hoverBand, setHoverBand] = useState<{
    key: RelationKey;
    px: number;
    py: number;
    flip: boolean;
  } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{
    x: number;
    y: number;
    px: number;
    py: number;
  } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const target = useMemo(
    () =>
      buildLayout({
        startAngleDeg: START_DEG,
        sweepDeg: SWEEP_DEG,
        innerRadius: INNER,
        ringDepths: RING_DEPTHS,
        bandGap: BAND_GAP_DEG * DEG,
        cellGap: CELL_GAP_DEG * DEG,
        zoneGap: ZONE_GAP_DEG * DEG,
        proportional,
        // 切割规则（geometry.ts 内置）：
        // R1/R2 只横切（每场景一行从里到外堆叠，角宽全开）；
        // R3/R4 横竖结合（二分行 + 行内按《占比》竖切，面积 ∝ 占比）
        activeScenes,
        allScenes: scenes,
        relationOrder: RELATION_ORDER,
        radiusOrder: RADIUS_ORDER,
      }),
    [scenes, activeScenes, proportional],
  );

  const layout = useTweenLayout(target);

  const activeIds = useMemo(
    () => new Set(activeScenes.map((s) => s.id)),
    [activeScenes],
  );

  // 文字自适应基于目标布局计算（过渡期间字号稳定不闪烁）
  const fitMap = useMemo(() => {
    const map = new Map<string, CellLabel | null>();
    for (const cell of target.cells) {
      map.set(cell.scene.id, fitCellText(cell.scene.name, cell));
    }
    return map;
  }, [target]);

  // 分区织纹：静态几何仅取决于层边界与纹理配置，不随格子补间重算；
  // 覆层贴合扇区内容区间（含区内格子缝隙），层间缝隙为净纸面分界——
  // 四层织物各自一体、互不越界
  const texturePaths = useMemo(() => {
    const seamA = ((ZONE_GAP_DEG - CELL_GAP_DEG) / 2) * DEG;
    return RADIUS_ORDER.flatMap((key, i) => {
      const tex = radiusTextures[key];
      if (!tex) return [];
      const zoneInnerRaw = i === 0 ? INNER : ZONE_EDGES[i - 1];
      const zoneInner = i > 0 ? zoneInnerRaw + seamA * zoneInnerRaw : INNER;
      const zoneOuterRaw = ZONE_EDGES[i];
      const zoneOuter =
        i < RADIUS_ORDER.length - 1
          ? zoneOuterRaw - seamA * zoneOuterRaw
          : zoneOuterRaw;
      return [
        {
          key,
          d: buildTextureD(tex, zoneInner, zoneOuter),
          color: tex.color,
          width: tex.width,
        },
      ];
    });
  }, [radiusTextures]);

  const zoomToPoint = useCallback(
    (sx: number, sy: number, factor: number) => {
      setZoom((z) => {
        const next = Math.max(0.7, Math.min(2.6, z * factor));
        setPan((prev) => ({
          x: sx - ((sx - prev.x) * next) / z,
          y: sy - ((sy - prev.y) * next) / z,
        }));
        return next;
      });
    },
    [],
  );

  const zoomAtCenter = useCallback((factor: number) => {
    zoomToPoint(CX, CY, factor);
  }, [zoomToPoint]);

  useEffect(() => {
    if (zoomInTick > 0) zoomAtCenter(1.18);
  }, [zoomInTick, zoomAtCenter]);

  useEffect(() => {
    if (zoomOutTick > 0) zoomAtCenter(1 / 1.18);
  }, [zoomOutTick, zoomAtCenter]);

  useEffect(() => {
    if (resetTick > 0) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
  }, [resetTick]);

  /**
   * 容器像素 -> viewBox 坐标（xMaxYMax meet：内容等比缩放、贴容器右下，
   * 需按 meet 实际缩放比与右下偏移做逆映射，不能用拉伸映射）
   */
  const toSvgPoint = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const svg = svgRef.current;
      if (!svg) return { x: CX, y: CY };
      const rect = svg.getBoundingClientRect();
      const s = Math.min(rect.width / VIEW_W, rect.height / VIEW_H);
      if (s === 0) return { x: CX, y: CY };
      return {
        x: (clientX - rect.left - (rect.width - VIEW_W * s)) / s,
        y: (clientY - rect.top - (rect.height - VIEW_H * s)) / s,
      };
    },
    [],
  );

  /** viewBox -> 容器像素（xMaxYMax meet：扇形贴容器右下） */
  const toClient = useCallback(
    (vx: number, vy: number): { px: number; py: number } => {
      const svg = svgRef.current;
      if (!svg) return { px: 0, py: 0 };
      const rect = svg.getBoundingClientRect();
      const s = Math.min(rect.width / VIEW_W, rect.height / VIEW_H);
      return {
        px: vx * s + (rect.width - VIEW_W * s),
        py: vy * s + (rect.height - VIEW_H * s),
      };
    },
    [],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      e.preventDefault();
      const p = toSvgPoint(e.clientX, e.clientY);
      zoomToPoint(p.x, p.y, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    },
    [toSvgPoint, zoomToPoint],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      (e.target as Element).setPointerCapture?.(e.pointerId);
      setDragging(true);
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        px: pan.x,
        py: pan.y,
      };
    },
    [pan.x, pan.y],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (dragging && dragStart.current) {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        const scale = VIEW_W / rect.width;
        setPan({
          x:
            dragStart.current.px +
            (e.clientX - dragStart.current.x) * scale,
          y:
            dragStart.current.py +
            (e.clientY - dragStart.current.y) * scale,
        });
      }
    },
    [dragging],
  );

  const handlePointerUp = useCallback(() => {
    setDragging(false);
    dragStart.current = null;
  }, []);

  const breatheArc = useMemo(() => {
    const p0 = polar(CX, CY, BREATH_R, START_DEG * DEG);
    const p1 = polar(CX, CY, BREATH_R, (START_DEG + SWEEP_DEG) * DEG);
    return `M ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} A ${BREATH_R} ${BREATH_R} 0 0 1 ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
  }, []);

  return (
    <div className="relative h-full w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMaxYMax meet"
        className={`h-full w-full select-none ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          handlePointerUp();
          setHover(null);
          setHoverBand(null);
        }}
        role="img"
        aria-label="出行半径与关系半径场景扇形矩阵"
      >
        <defs>
          {/* 各半径层一体径向渐变：每层一条多停靠点渐变从内圈贯穿到外圈，
              源渐变起点(0%)贴层内圈、终点(100%)贴层外沿；
              同一半径处所有格子取同一色 → 整层读作一块完整渐变面料，不逐格渐变 */}
          {RADIUS_ORDER.map((key, i) => {
            const stops = radiusGradients[key];
            const zoneInner = i === 0 ? INNER : ZONE_EDGES[i - 1];
            const zoneOuter = ZONE_EDGES[i];
            const depth = zoneOuter - zoneInner;
            const mapped = (stops ?? [
              [0, radiusColors[key]],
              [1, radiusColors[key]],
            ] as GradientStop[])
              .map(([t, c]) => ({
                offset: (zoneInner + t * depth) / zoneOuter,
                color: c,
              }))
              .sort((a, b) => a.offset - b.offset);
            return (
              <radialGradient
                key={key}
                id={`grad-${key}`}
                gradientUnits="userSpaceOnUse"
                cx={CX}
                cy={CY}
                r={zoneOuter}
              >
                {mapped.map((s) => (
                  <stop
                    key={`${s.offset}-${s.color}`}
                    offset={s.offset}
                    stopColor={s.color}
                  />
                ))}
              </radialGradient>
            );
          })}
          {/* 空扇区占位中性渐变：同样按径向一体（内浅外深，与环层节奏一致） */}
          <radialGradient
            id="grad-empty"
            gradientUnits="userSpaceOnUse"
            cx={CX}
            cy={CY}
            r={OUTER_R}
          >
            <stop offset={INNER / OUTER_R} stopColor="#e9ebef" />
            <stop offset={1} stopColor="#d6d9de" />
          </radialGradient>
        </defs>

        <g
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transition: dragging
              ? "none"
              : "transform 320ms cubic-bezier(0.34, 1.3, 0.64, 1)",
          }}
        >
          {/* 外沿呼吸弧（出场末尾淡入，随后持续呼吸） */}
          <g className="chart-fade" style={{ animationDelay: "600ms" }}>
            <path
              d={breatheArc}
              fill="none"
              stroke="#2f5f8f"
              strokeWidth={1}
              className="breathe-arc"
              pointerEvents="none"
            />
          </g>

          <g>
            {/* 关系半径标题：无填充色带，艺术字 + 细弧经纬刻度（沿弧弯曲排布，全程无颠倒） */}
            {layout.bands.map((band, i) => {
              const name = relationNames[band.key] ?? band.key;
              const en = `N°0${i + 1} · ${RELATION_EN[band.key] ?? ""}`;
              const n = Array.from(name).length;
              const cnArcLen = (band.a1 - band.a0) * CN_R;
              const cnFs = Math.min(26, (cnArcLen - (n - 1) * 3) / n);
              const showEn = (band.a1 - band.a0) * EN_R >= 112;
              // 标题弧线：贴 r=CN_R / EN_R 的顺时针弧（对称外扩防尾字截断），
              // 文字经 textPath 沿弧弯曲、居中于带中角
              const cnArc0 = polar(CX, CY, CN_R, band.a0 - 2 * DEG);
              const cnArc1 = polar(CX, CY, CN_R, band.a1 + 2 * DEG);
              const enArc0 = polar(CX, CY, EN_R, band.a0 - 8 * DEG);
              const enArc1 = polar(CX, CY, EN_R, band.a1 + 8 * DEG);
              const hp0 = polar(CX, CY, HAIRLINE_R, band.a0);
              const hp1 = polar(CX, CY, HAIRLINE_R, band.a1);
              const t0a = polar(CX, CY, 590, band.a0);
              const t0b = polar(CX, CY, 602, band.a0);
              const bandDim = activeScenes.length > 0 && band.count === 0;
              return (
                <g
                  key={band.key}
                  style={{
                    opacity: bandDim ? 0.35 : 1,
                    transition: "opacity 250ms ease",
                  }}
                >
                  {/* 悬停命中区（透明扇区） */}
                  <path
                    d={arcPath(CX, CY, band.a0, band.a1, 588, 646)}
                    fill="transparent"
                    style={{ cursor: "pointer" }}
                    onMouseEnter={(e) => {
                      const p = toSvgPoint(e.clientX, e.clientY);
                      const c = toClient(p.x, p.y);
                      const rect = svgRef.current?.getBoundingClientRect();
                      setHoverBand({
                        key: band.key,
                        px: c.px,
                        py: c.py,
                        flip: c.px > (rect?.width ?? 0) * 0.55,
                      });
                    }}
                    onMouseMove={(e) => {
                      const p = toSvgPoint(e.clientX, e.clientY);
                      const c = toClient(p.x, p.y);
                      const rect = svgRef.current?.getBoundingClientRect();
                      setHoverBand({
                        key: band.key,
                        px: c.px,
                        py: c.py,
                        flip: c.px > (rect?.width ?? 0) * 0.55,
                      });
                    }}
                    onMouseLeave={() => setHoverBand(null)}
                  />
                  {/* 标题区视觉整体淡入（悬停命中区不参与，保持即时交互） */}
                  <g className="chart-fade" style={{ animationDelay: "520ms" }}>
                  {/* 细弧经纬线 */}
                  <path
                    d={`M ${hp0.x.toFixed(1)} ${hp0.y.toFixed(1)} A ${HAIRLINE_R} ${HAIRLINE_R} 0 0 1 ${hp1.x.toFixed(1)} ${hp1.y.toFixed(1)}`}
                    fill="none"
                    stroke="#2f5f8f"
                    strokeOpacity={0.28}
                    strokeWidth={1}
                    pointerEvents="none"
                  />
                  {/* 边界经纬刻度 */}
                  <line
                    x1={t0a.x}
                    y1={t0a.y}
                    x2={t0b.x}
                    y2={t0b.y}
                    stroke="#2f5f8f"
                    strokeOpacity={0.35}
                    strokeWidth={1}
                    pointerEvents="none"
                  />
                  {/* 中文标题：思源宋体 墨蓝大字（沿弧弯曲） */}
                  {cnFs >= 12.5 && (
                    <>
                      <path
                        id={`cnl-${band.key}`}
                        d={`M ${cnArc0.x.toFixed(1)} ${cnArc0.y.toFixed(1)} A ${CN_R} ${CN_R} 0 0 1 ${cnArc1.x.toFixed(1)} ${cnArc1.y.toFixed(1)}`}
                        fill="none"
                        stroke="none"
                        pointerEvents="none"
                      />
                      <text
                        pointerEvents="none"
                        fill="#2f5f8f"
                        fontSize={cnFs.toFixed(1)}
                        fontWeight={700}
                        letterSpacing={3}
                        textAnchor="middle"
                        dominantBaseline="central"
                        style={{ fontFamily: "var(--font-serif)" }}
                      >
                        <textPath href={`#cnl-${band.key}`} startOffset="50%">
                          {name}
                        </textPath>
                      </text>
                    </>
                  )}
                  {/* 英文注记：Playfair 斜体（沿弧弯曲） */}
                  {showEn && (
                    <>
                      <path
                        id={`enl-${band.key}`}
                        d={`M ${enArc0.x.toFixed(1)} ${enArc0.y.toFixed(1)} A ${EN_R} ${EN_R} 0 0 1 ${enArc1.x.toFixed(1)} ${enArc1.y.toFixed(1)}`}
                        fill="none"
                        stroke="none"
                        pointerEvents="none"
                      />
                      <text
                        pointerEvents="none"
                        fill="#6c7178"
                        fontSize={11}
                        fontStyle="italic"
                        fontWeight={500}
                        letterSpacing={2.2}
                        textAnchor="middle"
                        dominantBaseline="central"
                        style={{ fontFamily: "var(--font-display)" }}
                      >
                        <textPath href={`#enl-${band.key}`} startOffset="50%">
                          {en}
                        </textPath>
                      </text>
                    </>
                  )}
                  </g>
                </g>
              );
            })}
            {/* 末段边界刻度 */}
            {(() => {
              const endA = (START_DEG + SWEEP_DEG) * DEG;
              const ta = polar(CX, CY, 590, endA);
              const tb = polar(CX, CY, 602, endA);
              return (
                <line
                  x1={ta.x}
                  y1={ta.y}
                  x2={tb.x}
                  y2={tb.y}
                  stroke="#2f5f8f"
                  strokeOpacity={0.35}
                  strokeWidth={1}
                  pointerEvents="none"
                />
              );
            })()}

            {/* 空扇区占位色块（该分区暂无场景数据，维持矩阵网格完整，
                与场景扇区同节奏出场） */}
            {layout.placeholders.map((ph) => (
              <path
                key={`ph-${ph.relation}-${ph.radius}`}
                className="sector-pop"
                style={{
                  animationDelay: `${Math.round(
                    enterDelayMs(ph.radius, `ph-${ph.relation}-${ph.radius}`),
                  )}ms`,
                }}
                d={roundedSectorPath(
                  CX,
                  CY,
                  ph.a0,
                  ph.a1,
                  ph.r0,
                  ph.r1,
                  CORNER_R,
                )}
                fill="url(#grad-empty)"
                pointerEvents="none"
              />
            ))}

            {/* 场景扇形 */}
            {layout.cells.map((cell) => {
              const isActive = activeIds.has(cell.scene.id);
              const isSelected = selectedId === cell.scene.id;
              const isHover = hover?.cell.scene.id === cell.scene.id;
              const base = radiusColors[cell.scene.radius];
              const fill = isActive
                ? `url(#grad-${cell.scene.radius})`
                : "#d9dce1";
              const fit = fitMap.get(cell.scene.id) ?? null;
              const rLabel = (cell.r0 + cell.r1) / 2;
              // 沿弧弯曲：文字经 textPath 贴格子中弧（a0→a1 顺时针），字字相随圆弧
              const lp0 = polar(CX, CY, rLabel, cell.a0);
              const lp1 = polar(CX, CY, rLabel, cell.a1);
              return (
                <g
                  key={cell.scene.id}
                  className="sector-pop"
                  style={{
                    animationDelay: `${Math.round(
                      enterDelayMs(cell.scene.radius, cell.scene.id),
                    )}ms`,
                  }}
                >
                  <path
                    d={roundedSectorPath(
                      CX,
                      CY,
                      cell.a0,
                      cell.a1,
                      cell.r0,
                      cell.r1,
                      CORNER_R,
                    )}
                    fill={fill}
                    stroke={
                      isSelected ? "#24272c" : isHover ? "#ffffff" : "none"
                    }
                    strokeWidth={isSelected ? 2.4 : 1.1}
                    style={{
                      transition: "fill 200ms ease",
                      cursor: "pointer",
                      opacity: isActive ? 1 : 0.55,
                      filter:
                        isHover || isSelected
                          ? `drop-shadow(0 0 5px ${isActive ? base : "transparent"}) brightness(1.05)`
                          : "none",
                    }}
                    onMouseEnter={(e) => {
                      const p = toSvgPoint(e.clientX, e.clientY);
                      const c = toClient(p.x, p.y);
                      const rect = svgRef.current?.getBoundingClientRect();
                      setHover({
                        cell,
                        px: c.px,
                        py: c.py,
                        flip: c.px > (rect?.width ?? 0) * 0.55,
                      });
                    }}
                    onMouseMove={(e) => {
                      const p = toSvgPoint(e.clientX, e.clientY);
                      const c = toClient(p.x, p.y);
                      const rect = svgRef.current?.getBoundingClientRect();
                      setHover({
                        cell,
                        px: c.px,
                        py: c.py,
                        flip: c.px > (rect?.width ?? 0) * 0.55,
                      });
                    }}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => onSelect(cell.scene)}
                  />
                  {fit && (
                    <>
                      <path
                        id={`scl-${cell.scene.id}`}
                        d={`M ${lp0.x.toFixed(2)} ${lp0.y.toFixed(2)} A ${rLabel.toFixed(2)} ${rLabel.toFixed(2)} 0 0 1 ${lp1.x.toFixed(2)} ${lp1.y.toFixed(2)}`}
                        fill="none"
                        stroke="none"
                        pointerEvents="none"
                      />
                      <text
                        pointerEvents="none"
                        fill={isActive ? "#ffffff" : "#868b93"}
                        fontSize={fit.fontSize}
                        fontWeight={500}
                        textAnchor="middle"
                        dominantBaseline="central"
                        stroke={isActive ? "rgba(28,44,66,0.26)" : "none"}
                        strokeWidth={2.2}
                        style={{
                          transition: "fill 200ms ease",
                          paintOrder: "stroke",
                        }}
                      >
                        <textPath href={`#scl-${cell.scene.id}`} startOffset="50%">
                          {fit.text}
                        </textPath>
                      </text>
                    </>
                  )}
                </g>
              );
            })}
            {/* 分区织纹覆层：每层按源纹理做极坐标映射（平行流向=放射笔刷细线 /
                垂直=同心纸张弧线），静态几何随扇面缩放平移，
                覆于整层环带（含缝隙）→ 整区读作一块织纹渐变面料 */}
            {texturePaths.map((t) => (
              <path
                key={`tex-${t.key}`}
                d={t.d}
                fill="none"
                stroke={t.color}
                strokeWidth={t.width}
                pointerEvents="none"
                className="chart-fade"
                style={{
                  animationDelay: `${RADIUS_ORDER.indexOf(t.key) * 150 + 300}ms`,
                }}
              />
            ))}
          </g>
        </g>
      </svg>

      {/* 场景悬停详情 */}
      {hover && (
        <div
          className="chart-tooltip pointer-events-none absolute z-20 w-60 rounded-md border border-[#d3d7dc] bg-[#fafbfc]/80 p-3 shadow-md backdrop-blur"
          style={{
            left: hover.px,
            top: hover.py,
            transform: hover.flip
              ? "translate(calc(-100% - 14px), -50%)"
              : "translate(14px, -50%)",
          }}
        >
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0"
              style={{
                backgroundColor: radiusColors[hover.cell.scene.radius],
              }}
            />
            <span className="text-[14px] font-semibold text-[#24272c]">
              {hover.cell.scene.name}
            </span>
          </div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#6c7178]">
            {hover.cell.scene.description}
          </p>
          <div className="mt-2 border-t border-[#dfe2e6] pt-1.5 text-[12px] text-[#6c7178]">
            {relationNames[hover.cell.scene.relation]} ·{" "}
            {radiusNames[hover.cell.scene.radius] ?? hover.cell.scene.radius.toUpperCase()}
          </div>
        </div>
      )}

      {/* 类别悬停说明 */}
      {hoverBand && (
        <div
          className="chart-tooltip pointer-events-none absolute z-20 w-64 rounded-md border border-[#d3d7dc] bg-[#fafbfc]/80 p-3 shadow-md backdrop-blur"
          style={{
            left: hoverBand.px,
            top: hoverBand.py,
            transform: hoverBand.flip
              ? "translate(calc(-100% - 14px), -50%)"
              : "translate(14px, -50%)",
          }}
        >
          <div className="text-[14px] font-semibold text-[#24272c]">
            {relationNames[hoverBand.key]}
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[#6c7178]">
            {relationDescs[hoverBand.key]}
          </p>
          <div className="mt-2 border-t border-[#dfe2e6] pt-1.5 text-[12px] text-[#6c7178]">
            命中{" "}
            {
              activeScenes.filter((s) => s.relation === hoverBand.key).length
            }{" "}
            个场景
          </div>
        </div>
      )}
    </div>
  );
}
