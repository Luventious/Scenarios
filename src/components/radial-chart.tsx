"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
/** 视框比扇面略高，底边留 32px 呼吸位，避免内圈贴着卡片边线 */
const VIEW_H = 700;
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
 * （r1|r2、r2|r3、r3|r4）呈清晰层间分界
 */
const ZONE_GAP_DEG = CELL_GAP_DEG * 3;
/** 圆角扇形基准圆角半径 */
const CORNER_R = 7;
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
/** 展开动画的收拢角度：全部格子从扇面起点（左端射线）像纸扇一样张开 */
const ANCHOR = START_DEG * DEG;
/** 首次出场：整扇连续展开时长 */
const UNFOLD_MS = 1240;
/** 筛选后的重排补间时长 */
const MORPH_MS = 560;

const RADIUS_ORDER: RadiusKey[] = ["r1", "r2", "r3", "r4"];

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

/** 出场缓动：起步快、收尾慢而稳，像纸扇一次顺滑张开 */
function easeOutQuart(t: number): number {
  return 1 - (1 - t) ** 4;
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
  const fs = Math.min(cap, (arcLen - 5) / (n * 1.06));
  if (fs >= 7.5) return { fontSize: fs, text: name };
  const fsTrunc = Math.min(7.5, cap);
  const m = Math.floor((arcLen - 5) / (fsTrunc * 1.06));
  if (m >= 2) return { fontSize: fsTrunc, text: `${name.slice(0, m - 1)}…` };
  return null;
}

/**
 * 分区织纹 path（源纹理的极坐标映射，静态几何、不随格子补间变化）：
 * - parallel（笔刷纹）：纹理线与渐变流向平行 → 从内圈放射到外沿的细线
 * - cross（纸张纹）：纹理线与渐变流向垂直 → 同心弧线
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

/** 收拢态：所有扇区角度压到扇面起点，半径保持不变（纸扇合拢的一瞬） */
function collapseLayout(layout: Layout): Layout {
  return {
    ...layout,
    bands: layout.bands.map((b) => ({ ...b, a0: ANCHOR, a1: ANCHOR })),
    cells: layout.cells.map((c) => ({
      ...c,
      a0: ANCHOR,
      a1: ANCHOR,
      mid: ANCHOR,
    })),
    placeholders: layout.placeholders.map((p) => ({
      ...p,
      a0: ANCHOR,
      a1: ANCHOR,
    })),
  };
}

/**
 * 布局插值：角度与半径同时补间，保证筛选重排时格子既不跳变也不塌缩；
 * 新出现的格子从自身中角零宽生长，消失的格子直接淡出（由 React 卸载）。
 */
function lerpLayout(from: Layout, to: Layout, t: number): Layout {
  const fromCells = new Map(from.cells.map((c) => [c.scene.id, c]));
  const fromBands = new Map(from.bands.map((b) => [b.key, b]));
  const fromPlaceholders = new Map(
    from.placeholders.map((p) => [`${p.relation}:${p.radius}`, p]),
  );

  const cells = to.cells.map((tc) => {
    const fc = fromCells.get(tc.scene.id);
    if (!fc) {
      const mid = (tc.a0 + tc.a1) / 2;
      const a0 = mid + (tc.a0 - mid) * t;
      const a1 = mid + (tc.a1 - mid) * t;
      return { ...tc, a0, a1, mid: (a0 + a1) / 2 };
    }
    const a0 = fc.a0 + (tc.a0 - fc.a0) * t;
    const a1 = fc.a1 + (tc.a1 - fc.a1) * t;
    return {
      ...tc,
      a0,
      a1,
      mid: (a0 + a1) / 2,
      r0: fc.r0 + (tc.r0 - fc.r0) * t,
      r1: fc.r1 + (tc.r1 - fc.r1) * t,
    };
  });

  const bands = to.bands.map((tb) => {
    const fb = fromBands.get(tb.key);
    if (!fb) return tb;
    return {
      ...tb,
      a0: fb.a0 + (tb.a0 - fb.a0) * t,
      a1: fb.a1 + (tb.a1 - fb.a1) * t,
    };
  });

  const placeholders = to.placeholders.map((tp) => {
    const fp = fromPlaceholders.get(`${tp.relation}:${tp.radius}`);
    if (!fp) return tp;
    return {
      ...tp,
      a0: fp.a0 + (tp.a0 - fp.a0) * t,
      a1: fp.a1 + (tp.a1 - fp.a1) * t,
      r0: fp.r0 + (tp.r0 - fp.r0) * t,
      r1: fp.r1 + (tp.r1 - fp.r1) * t,
    };
  });

  return { ...to, cells, bands, placeholders };
}

/**
 * 布局动画控制器：单一 rAF 时间轴驱动，取代「逐格 CSS pop」的碎片化节奏。
 * 首次挂载从合拢态一次性连续展开（UNFOLD_MS），
 * 之后的筛选/开关变化从当前画面平滑补间到新布局（MORPH_MS）。
 * reveal 返回出场进度（0~1），供文字/织纹等非几何元素对齐同一节奏淡入。
 */
function useAnimatedLayout(target: Layout): { layout: Layout; reveal: number } {
  const [state, setState] = useState(() => ({
    layout: collapseLayout(target),
    reveal: 0,
  }));
  const currentRef = useRef<Layout>(state.layout);
  /** 出场展开是否已完整跑完一次（StrictMode 二次挂载时会重新完整展开） */
  const settledRef = useRef(false);

  useEffect(() => {
    // 尊重系统的减少动效偏好：直接落到目标布局
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      currentRef.current = target;
      settledRef.current = true;
      setState({ layout: target, reveal: 1 });
      return;
    }
    // 首次：从合拢态连续展开；之后：从当前画面平滑补间到新布局
    const from = currentRef.current;
    const first = !settledRef.current;
    const duration = first ? UNFOLD_MS : MORPH_MS;
    const startedAt = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const raw = Math.min(1, (now - startedAt) / duration);
      const eased = first ? easeOutQuart(raw) : easeInOutCubic(raw);
      const layout = lerpLayout(from, target, eased);
      currentRef.current = layout;
      setState({ layout, reveal: first ? raw : 1 });
      if (raw < 1) {
        raf = requestAnimationFrame(tick);
      } else if (first) {
        settledRef.current = true;
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return state;
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
  /**
   * 悬停更新节流：同一格内移动小于 6px 时复用旧状态对象，
   * 避免 mousemove 每像素重渲染整张扇形（保持 hover 跟手且不掉帧）
   */
  const updateHover = useCallback((next: HoverInfo) => {
    setHover((prev) =>
      prev &&
      prev.cell.scene.id === next.cell.scene.id &&
      prev.flip === next.flip &&
      Math.hypot(prev.px - next.px, prev.py - next.py) < 6
        ? prev
        : next,
    );
  }, []);
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

  const updateHoverBand = useCallback(
    (next: { key: RelationKey; px: number; py: number; flip: boolean }) => {
      setHoverBand((prev) =>
        prev &&
        prev.key === next.key &&
        prev.flip === next.flip &&
        Math.hypot(prev.px - next.px, prev.py - next.py) < 6
          ? prev
          : next,
      );
    },
    [],
  );

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

  const { layout, reveal } = useAnimatedLayout(target);

  /** 文字/织纹淡入节奏：跟扇形展开共用一条时间轴，收尾时贴合 */
  const labelOpacity =
    reveal >= 1 ? 1 : Math.max(0, Math.min(1, (reveal - 0.3) / 0.42));
  const chromeOpacity =
    reveal >= 1 ? 1 : Math.max(0, Math.min(1, (reveal - 0.45) / 0.4));

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

  // 关系标题排版基于目标布局（避免展开过程中字号抖动）
  const bandFit = useMemo(() => {
    const map = new Map<
      RelationKey,
      { cnFs: number; showEn: boolean; en: string }
    >();
    target.bands.forEach((band, i) => {
      const name = relationNames[band.key] ?? band.key;
      const n = Array.from(name).length;
      const cnArcLen = (band.a1 - band.a0) * CN_R;
      map.set(band.key, {
        cnFs: Math.min(26, (cnArcLen - (n - 1) * 3) / n),
        showEn: (band.a1 - band.a0) * EN_R >= 104,
        en: `N°0${i + 1} · ${RELATION_EN[band.key] ?? ""}`,
      });
    });
    return map;
  }, [target, relationNames]);

  // 分区织纹：静态几何仅取决于层边界与纹理配置，不随格子补间重算
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

  /** 容器像素 -> viewBox 坐标（xMidYMid meet：内容等比缩放居中） */
  const toSvgPoint = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const svg = svgRef.current;
      if (!svg) return { x: CX, y: CY };
      const rect = svg.getBoundingClientRect();
      const s = Math.min(rect.width / VIEW_W, rect.height / VIEW_H);
      if (s === 0) return { x: CX, y: CY };
      return {
        x: (clientX - rect.left - (rect.width - VIEW_W * s) / 2) / s,
        y: (clientY - rect.top - (rect.height - VIEW_H * s) / 2) / s,
      };
    },
    [],
  );

  /** viewBox -> 容器像素（xMidYMid meet：扇形居中） */
  const toClient = useCallback(
    (vx: number, vy: number): { px: number; py: number } => {
      const svg = svgRef.current;
      if (!svg) return { px: 0, py: 0 };
      const rect = svg.getBoundingClientRect();
      const s = Math.min(rect.width / VIEW_W, rect.height / VIEW_H);
      return {
        px: vx * s + (rect.width - VIEW_W * s) / 2,
        py: vy * s + (rect.height - VIEW_H * s) / 2,
      };
    },
    [],
  );

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

  const zoomAtCenter = useCallback(
    (factor: number) => {
      zoomToPoint(CX, CY, factor);
    },
    [zoomToPoint],
  );

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
   * 滚轮缩放：仅 ⌘/Ctrl + 滚轮触发。页面本身可纵向滚动，
   * 裸滚轮保持页面滚动，避免鼠标悬停在图上时「卡住」页面。
   */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const p = toSvgPoint(e.clientX, e.clientY);
      zoomToPoint(p.x, p.y, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [toSvgPoint, zoomToPoint]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      (e.target as Element).setPointerCapture?.(e.pointerId);
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
      const start = dragStart.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      // 3px 死区：轻点格子的抖动不会被误判为拖拽
      if (!dragging && Math.hypot(dx, dy) < 3) return;
      if (!dragging) setDragging(true);
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const s = Math.min(rect.width / VIEW_W, rect.height / VIEW_H) || 1;
      setPan({
        x: start.px + dx / s,
        y: start.py + dy / s,
      });
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

  /** 内圈扇骨细弧：给扇面一个轻盈的「握柄」 */
  const spineArc = useMemo(() => {
    const p0 = polar(CX, CY, INNER - 10, START_DEG * DEG);
    const p1 = polar(CX, CY, INNER - 10, (START_DEG + SWEEP_DEG) * DEG);
    return `M ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} A ${INNER - 10} ${INNER - 10} 0 0 1 ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
  }, []);

  const hoverTip = (
    info: { px: number; py: number; flip: boolean },
    children: React.ReactNode,
  ) => (
    <div
      className="chart-tooltip pointer-events-none absolute z-20 w-[248px] rounded-2xl border border-line bg-white/95 p-3.5 shadow-lift backdrop-blur-sm"
      style={{
        left: info.px,
        top: info.py,
        transform: info.flip
          ? "translate(calc(-100% - 16px), -50%)"
          : "translate(16px, -50%)",
      }}
    >
      {children}
    </div>
  );

  return (
    <div className="relative h-full w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        className={`h-full w-full touch-pan-y select-none ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
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
              同一半径处所有格子取同一色 → 整层读作一块完整渐变面料 */}
          {RADIUS_ORDER.map((key, i) => {
            const zoneInner = i === 0 ? INNER : ZONE_EDGES[i - 1];
            const zoneOuter = ZONE_EDGES[i];
            const depth = zoneOuter - zoneInner;
            // 缺省时该层退化为纯色（同色两端点）
            const stops: GradientStop[] = radiusGradients[key] ?? [
              [0, radiusColors[key]],
              [1, radiusColors[key]],
            ];
            const mapped = stops
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
            <stop offset={INNER / OUTER_R} stopColor="#eef5f0" />
            <stop offset={1} stopColor="#e5eee8" />
          </radialGradient>
        </defs>

        <g
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transition: dragging
              ? "none"
              : "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          {/* 内圈扇骨 + 外沿呼吸弧（展开末尾随 chrome 一起浮现） */}
          <g style={{ opacity: chromeOpacity }}>
            <path
              d={spineArc}
              fill="none"
              stroke="#3f7560"
              strokeOpacity={0.16}
              strokeWidth={2}
              strokeLinecap="round"
              pointerEvents="none"
            />
            <path
              d={breatheArc}
              fill="none"
              stroke="#3f7560"
              strokeWidth={1}
              className="breathe-arc"
              pointerEvents="none"
            />
          </g>

          <g>
            {/* 关系半径标题：无填充色带，艺术字 + 细弧经纬刻度（沿弧弯曲排布，全程无颠倒） */}
            {layout.bands.map((band) => {
              const name = relationNames[band.key] ?? band.key;
              const fit = bandFit.get(band.key);
              const cnFs = fit?.cnFs ?? 0;
              const showEn = fit?.showEn ?? false;
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
              const showTip = (px: number, py: number, flip: boolean) =>
                updateHoverBand({ key: band.key, px, py, flip });
              return (
                <g
                  key={band.key}
                  style={{
                    opacity: (bandDim ? 0.34 : 1) * chromeOpacity,
                    transition: "opacity 260ms ease",
                  }}
                >
                  {/* 悬停命中区（透明扇区） */}
                  <path
                    d={arcPath(CX, CY, band.a0, band.a1, 586, 646)}
                    fill="transparent"
                    style={{ cursor: "pointer" }}
                    onMouseEnter={(e) => {
                      const p = toSvgPoint(e.clientX, e.clientY);
                      const c = toClient(p.x, p.y);
                      const rect = svgRef.current?.getBoundingClientRect();
                      showTip(
                        c.px,
                        c.py,
                        c.px > (rect?.width ?? 0) * 0.55,
                      );
                    }}
                    onMouseMove={(e) => {
                      const p = toSvgPoint(e.clientX, e.clientY);
                      const c = toClient(p.x, p.y);
                      const rect = svgRef.current?.getBoundingClientRect();
                      showTip(
                        c.px,
                        c.py,
                        c.px > (rect?.width ?? 0) * 0.55,
                      );
                    }}
                    onMouseLeave={() => setHoverBand(null)}
                  />
                  {/* 细弧经纬线 */}
                  <path
                    d={`M ${hp0.x.toFixed(1)} ${hp0.y.toFixed(1)} A ${HAIRLINE_R} ${HAIRLINE_R} 0 0 1 ${hp1.x.toFixed(1)} ${hp1.y.toFixed(1)}`}
                    fill="none"
                    stroke="#3f7560"
                    strokeOpacity={0.2}
                    strokeWidth={1}
                    pointerEvents="none"
                  />
                  {/* 边界经纬刻度 */}
                  <line
                    x1={t0a.x}
                    y1={t0a.y}
                    x2={t0b.x}
                    y2={t0b.y}
                    stroke="#3f7560"
                    strokeOpacity={0.28}
                    strokeWidth={1}
                    pointerEvents="none"
                  />
                  {/* 中文标题：思源宋体 墨绿大字（沿弧弯曲） */}
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
                        fill="#2d5540"
                        fontSize={cnFs.toFixed(1)}
                        fontWeight={600}
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
                        fill="#86998d"
                        fontSize={10.5}
                        fontStyle="italic"
                        letterSpacing={2.2}
                        textAnchor="middle"
                        dominantBaseline="central"
                        style={{ fontFamily: "var(--font-display)" }}
                      >
                        <textPath href={`#enl-${band.key}`} startOffset="50%">
                          {fit?.en ?? ""}
                        </textPath>
                      </text>
                    </>
                  )}
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
                  stroke="#3f7560"
                  strokeOpacity={0.28}
                  strokeWidth={1}
                  pointerEvents="none"
                  style={{ opacity: chromeOpacity }}
                />
              );
            })()}

            {/* 空扇区占位色块（该分区暂无场景数据，维持矩阵网格完整） */}
            {layout.placeholders.map((ph) => (
              <path
                key={`ph-${ph.relation}-${ph.radius}`}
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
              const fill = isActive
                ? `url(#grad-${cell.scene.radius})`
                : "#e7eee9";
              const fit = fitMap.get(cell.scene.id) ?? null;
              const rLabel = Math.max((cell.r0 + cell.r1) / 2, INNER + 2);
              // 沿弧弯曲：文字经 textPath 贴格子中弧（a0→a1 顺时针），字字相随圆弧
              const da = Math.min((cell.a1 - cell.a0) * 0.04, 0.012);
              const lp0 = polar(CX, CY, rLabel, cell.a0 + da);
              const lp1 = polar(CX, CY, rLabel, cell.a1 - da);
              const showTip = (px: number, py: number, flip: boolean) =>
                updateHover({ cell, px, py, flip });
              return (
                <g key={cell.scene.id}>
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
                      isSelected
                        ? "#2f6b51"
                        : isHover
                          ? "rgba(255,255,255,0.92)"
                          : "none"
                    }
                    strokeWidth={isSelected ? 2 : 1.4}
                    style={{
                      transition:
                        "fill 240ms ease, stroke 160ms ease, opacity 240ms ease",
                      cursor: "pointer",
                      filter:
                        isHover || isSelected
                          ? "drop-shadow(0 4px 9px rgba(31,58,45,0.22))"
                          : "none",
                    }}
                    onMouseEnter={(e) => {
                      const p = toSvgPoint(e.clientX, e.clientY);
                      const c = toClient(p.x, p.y);
                      const rect = svgRef.current?.getBoundingClientRect();
                      showTip(c.px, c.py, c.px > (rect?.width ?? 0) * 0.55);
                    }}
                    onMouseMove={(e) => {
                      const p = toSvgPoint(e.clientX, e.clientY);
                      const c = toClient(p.x, p.y);
                      const rect = svgRef.current?.getBoundingClientRect();
                      showTip(c.px, c.py, c.px > (rect?.width ?? 0) * 0.55);
                    }}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => onSelect(cell.scene)}
                  />
                  {fit && labelOpacity > 0 && (
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
                        fill={isActive ? "#1f3a2d" : "#96a89c"}
                        fontSize={fit.fontSize}
                        fontWeight={500}
                        textAnchor="middle"
                        dominantBaseline="central"
                        stroke={isActive ? "rgba(255,255,255,0.9)" : "none"}
                        strokeWidth={2.4}
                        style={{
                          transition: "fill 240ms ease, opacity 200ms ease",
                          paintOrder: "stroke",
                          opacity: isActive ? labelOpacity : labelOpacity * 0.8,
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
                style={{ opacity: chromeOpacity }}
              />
            ))}
          </g>
        </g>
      </svg>

      {/* 场景悬停详情 */}
      {hover &&
        hoverTip(
          hover,
          <>
            <div className="flex items-start gap-2">
              <span
                className="mt-1 inline-block size-2 shrink-0 rounded-full"
                style={{
                  backgroundColor: radiusColors[hover.cell.scene.radius],
                }}
              />
              <span className="font-serif text-[15px] font-semibold text-ink">
                {hover.cell.scene.name}
              </span>
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-soft">
              {hover.cell.scene.description}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-2 text-[11px] text-muted-foreground">
              <span className="text-ink-soft">
                {relationNames[hover.cell.scene.relation]}
              </span>
              <span className="size-0.5 rounded-full bg-line" />
              <span>
                {radiusNames[hover.cell.scene.radius] ??
                  hover.cell.scene.radius.toUpperCase()}
              </span>
              {hover.cell.scene.weightLabel && (
                <>
                  <span className="size-0.5 rounded-full bg-line" />
                  <span className="text-sage-deep">
                    占比 {hover.cell.scene.weightLabel}
                  </span>
                </>
              )}
            </div>
          </>,
        )}

      {/* 类别悬停说明 */}
      {hoverBand &&
        hoverTip(
          hoverBand,
          <>
            <div className="font-serif text-[15px] font-semibold text-ink">
              {relationNames[hoverBand.key]}
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-soft">
              {relationDescs[hoverBand.key]}
            </p>
            <div className="mt-2.5 border-t border-line pt-2 text-[11px] text-muted-foreground">
              命中{" "}
              <span className="font-semibold text-sage-deep">
                {activeScenes.filter((s) => s.relation === hoverBand.key).length}
              </span>{" "}
              个场景
            </div>
          </>,
        )}
    </div>
  );
}
