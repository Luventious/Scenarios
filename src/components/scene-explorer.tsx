"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Database,
  Loader2,
  Minus,
  MousePointerClick,
  Plus,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import RadialChart from "@/components/radial-chart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { loadSceneDataset } from "@/lib/scenes-client";
import type { SceneDatasetOrigin } from "@/lib/scenes-client";
import { cn } from "@/lib/utils";
import type {
  GradientStop,
  RadiusKey,
  RadiusMeta,
  RadiusTexture,
  RelationKey,
  SceneDataset,
  SceneItem,
} from "@/lib/types";

const RADIUS_KEYS: RadiusKey[] = ["r1", "r2", "r3", "r4"];
const RELATION_KEYS: RelationKey[] = [
  "solo",
  "intimate",
  "family",
  "pet",
  "interest",
  "business",
];

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** 数据源徽章文案：区分「实时接口 / 构建快照 / 前端兑底」三种命中方式 */
function datasetBadge(
  source: SceneDataset["source"],
  origin: SceneDatasetOrigin | null,
): string {
  if (source !== "feishu") return "内置场景集";
  return origin === "snapshot" ? "飞书快照" : "飞书多维表格";
}

function datasetLabel(
  source: SceneDataset["source"],
  origin: SceneDatasetOrigin | null,
): string {
  if (source !== "feishu") return "数据来自内置场景集";
  if (origin === "snapshot") {
    return "数据来自构建期导出的飞书快照（静态托管模式，改表后需重新发布）";
  }
  return "数据来自飞书多维表格（实时读取）";
}

/** 图例色带：竖向渐变，方向与「内圈→外沿」一致 */
function gradientCss(meta: RadiusMeta | undefined): string {
  if (!meta) return "#dbe6de";
  if (!meta.gradient) return meta.color;
  return `linear-gradient(180deg, ${meta.gradient
    .map(([t, c]: GradientStop) => `${c} ${(t * 100).toFixed(0)}%`)
    .join(", ")})`;
}

interface SceneDetailProps {
  scene: SceneItem;
  radiusName: string;
  radiusColor: string;
  relationName: string;
  onClose: () => void;
}

/** 选中场景详情（左栏与移动端抽屉共用） */
function SceneDetail({
  scene,
  radiusName,
  radiusColor,
  relationName,
  onClose,
}: SceneDetailProps) {
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[9.5px] tracking-[0.2em] text-muted-foreground">
            SELECTED
          </p>
          <h2 className="mt-1.5 font-serif text-[16px] leading-snug font-semibold text-ink">
            {scene.name}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭详情"
          className="-mt-1 -mr-1 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-paper hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper/70 px-2.5 py-0.5 text-[10.5px] text-ink-soft">
          <span
            className="size-1.5 rounded-full"
            style={{ backgroundColor: radiusColor }}
          />
          {radiusName}
        </span>
        <span className="rounded-full border border-line bg-paper/70 px-2.5 py-0.5 text-[10.5px] text-ink-soft">
          {relationName}
        </span>
        {scene.weightLabel && (
          <span className="rounded-full bg-mint px-2.5 py-0.5 text-[10.5px] text-sage-deep">
            占比 {scene.weightLabel}
          </span>
        )}
      </div>
      <p className="mt-2.5 text-[12px] leading-[1.8] text-ink-soft">
        {scene.description}
      </p>
    </div>
  );
}

interface RadiusLegendProps {
  radii: RadiusMeta[];
  hits: (key: RadiusKey) => number;
  selected: Set<RadiusKey>;
  onToggle: (key: RadiusKey) => void;
  hasActiveFilter: boolean;
}

/** 出行半径图例（全站唯一一处）：兼作图例与径向筛选 */
function RadiusLegend({
  radii,
  hits,
  selected,
  onToggle,
  hasActiveFilter,
}: RadiusLegendProps) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-serif text-[12.5px] font-semibold text-ink">
          出行半径
        </h2>
        <span className="text-[9.5px] tracking-[0.14em] text-muted-foreground">
          径向四层 · 点击筛选
        </span>
      </div>
      <ul className="mt-2 space-y-0.5">
        {radii.map((r) => {
          const hit = hits(r.key);
          const on = selected.has(r.key);
          const dim = hasActiveFilter && hit === 0;
          return (
            <li key={r.key}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(r.key)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors duration-200",
                  on ? "bg-mint/60" : "hover:bg-mint/35",
                  dim && "opacity-45",
                )}
              >
                <span
                  className="h-8 w-1.5 shrink-0 rounded-full ring-1 ring-black/5 ring-inset"
                  style={{ backgroundImage: gradientCss(r) }}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span
                      className={cn(
                        "text-[12px] text-ink",
                        on && "font-medium text-sage-deep",
                      )}
                    >
                      {r.name}
                    </span>
                    <span className="font-display text-[12px] text-muted-foreground">
                      {hit}
                    </span>
                  </span>
                  <span className="mt-0.5 line-clamp-1 text-[10px] leading-relaxed text-muted-foreground">
                    {r.description}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function SceneExplorer() {
  const [dataset, setDataset] = useState<SceneDataset | null>(null);
  const [origin, setOrigin] = useState<SceneDatasetOrigin | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [relationFilter, setRelationFilter] = useState<Set<RelationKey>>(
    new Set(),
  );
  const [radiusFilter, setRadiusFilter] = useState<Set<RadiusKey>>(new Set());
  const [proportional, setProportional] = useState(true);
  const [selected, setSelected] = useState<SceneItem | null>(null);

  const [zoomInTick, setZoomInTick] = useState(0);
  const [zoomOutTick, setZoomOutTick] = useState(0);
  const [resetTick, setResetTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    loadSceneDataset(controller.signal)
      .then(({ dataset: next, origin }) => {
        setOrigin(origin);
        setDataset(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "数据加载失败");
      });
    return () => {
      controller.abort();
    };
  }, []);

  const radiusColorMap = useMemo(() => {
    const map = {} as Record<RadiusKey, string>;
    dataset?.radii.forEach((r) => {
      map[r.key] = r.color;
    });
    return map;
  }, [dataset]);

  const radiusGradientMap = useMemo(() => {
    const map = {} as Partial<Record<RadiusKey, GradientStop[]>>;
    dataset?.radii.forEach((r) => {
      if (r.gradient) map[r.key] = r.gradient;
    });
    return map;
  }, [dataset]);

  const radiusTextureMap = useMemo(() => {
    const map = {} as Partial<Record<RadiusKey, RadiusTexture>>;
    dataset?.radii.forEach((r) => {
      if (r.texture) map[r.key] = r.texture;
    });
    return map;
  }, [dataset]);

  const radiusNameMap = useMemo(() => {
    const map = {} as Record<RadiusKey, string>;
    dataset?.radii.forEach((r) => {
      map[r.key] = r.name;
    });
    return map;
  }, [dataset]);

  const relationNameMap = useMemo(() => {
    const map = {} as Record<RelationKey, string>;
    dataset?.relations.forEach((r) => {
      map[r.key] = r.name;
    });
    return map;
  }, [dataset]);

  const relationDescMap = useMemo(() => {
    const map = {} as Record<RelationKey, string>;
    dataset?.relations.forEach((r) => {
      map[r.key] = r.description;
    });
    return map;
  }, [dataset]);

  const scenes = dataset?.scenes ?? [];

  const activeScenes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scenes.filter((s) => {
      if (relationFilter.size > 0 && !relationFilter.has(s.relation)) {
        return false;
      }
      if (radiusFilter.size > 0 && !radiusFilter.has(s.radius)) return false;
      if (q) {
        const hay = `${s.name} ${s.description}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [scenes, query, relationFilter, radiusFilter]);

  const hasFilter =
    query.trim() !== "" || relationFilter.size > 0 || radiusFilter.size > 0;

  const clearFilters = useCallback(() => {
    setQuery("");
    setRelationFilter(new Set());
    setRadiusFilter(new Set());
  }, []);

  const handleSelect = useCallback((scene: SceneItem) => {
    setSelected(scene);
  }, []);

  useEffect(() => {
    if (selected) {
      const next = scenes.find((s) => s.id === selected.id);
      if (next && next !== selected) setSelected(next);
    }
  }, [scenes, selected]);

  const radiusHit = useCallback(
    (key: RadiusKey) => activeScenes.filter((s) => s.radius === key).length,
    [activeScenes],
  );

  const toggleRadius = useCallback((key: RadiusKey) => {
    setRadiusFilter((prev) => toggleInSet(prev, key));
  }, []);

  return (
    <div className="min-h-[100dvh] lg:h-[100dvh] lg:overflow-hidden">
      <div className="flex flex-col lg:h-full lg:flex-row">
        {/* 左栏：标题 + 控件 + 出行半径图例 + 选中详情 */}
        <aside className="order-1 shrink-0 px-5 pt-5 sm:px-7 sm:pt-6 lg:h-full lg:w-[372px] lg:overflow-y-auto lg:overscroll-contain lg:border-r lg:border-line lg:px-7 lg:pt-7 xl:w-[412px] xl:px-8">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 place-items-center rounded-2xl bg-white text-sage-deep shadow-soft ring-1 ring-line">
                <span className="font-display text-[14px] leading-none italic">
                  W
                </span>
              </span>
              <div>
                <p className="font-display text-[17px] leading-none text-sage-deep italic">
                  Will On Wheel
                </p>
                <p className="mt-1.5 text-[9px] tracking-[0.32em] text-muted-foreground">
                  SCENE MATRIX
                </p>
              </div>
            </div>
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px]",
                error
                  ? "border-[#e6c9c5] bg-[#fbf2f0] text-[#a9504a]"
                  : "border-line bg-white/70 text-ink-soft",
              )}
              title={
                error
                  ? error
                  : dataset
                    ? datasetLabel(dataset.source, origin)
                    : "正在读取数据"
              }
            >
              <Database size={11} className={error ? "" : "text-sage"} />
              {error
                ? "读取失败"
                : dataset
                  ? datasetBadge(dataset.source, origin)
                  : "连接中" }
            </span>
          </div>

          <h1 className="mt-6 font-serif text-[25px] leading-[1.28] font-semibold text-ink xl:text-[28px]">
            车生活场景矩阵
          </h1>
          <p className="mt-2.5 max-w-[330px] text-[12px] leading-[1.85] text-ink-soft">
            径向四层是出行半径，角度六类是关系半径；每个格子都是一个真实场景，
            面积与占比同源。
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10.5px] text-muted-foreground">
            <span className="flex items-baseline gap-1">
              <b className="font-display text-[17px] leading-none font-normal text-ink">
                {scenes.length || "—"}
              </b>
              个场景
            </span>
            <span className="size-0.5 rounded-full bg-line" />
            <span className="flex items-baseline gap-1">
              命中
              <b className="font-display text-[17px] leading-none font-normal text-sage-deep">
                {activeScenes.length}
              </b>
            </span>
            <span className="size-0.5 rounded-full bg-line" />
            <span>6 类 × 4 层</span>
            {typeof dataset?.skippedCount === "number" &&
              dataset.skippedCount > 0 && (
                <span className="text-muted-foreground/70">
                  · {dataset.skippedCount} 条未识别
                </span>
              )}
          </div>

          <div className="relative mt-5">
            <Search
              size={14}
              className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="检索场景名称 / 关键词"
              className="h-9 rounded-full border-line bg-white/70 pl-9 text-[12px] shadow-none transition-colors placeholder:text-muted-foreground focus-visible:border-sage focus-visible:bg-white focus-visible:ring-sage/20"
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {RELATION_KEYS.map((key) => {
              const on = relationFilter.has(key);
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setRelationFilter((prev) => toggleInSet(prev, key))
                  }
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] whitespace-nowrap transition-all duration-200",
                    on
                      ? "border-sage-deep bg-sage-deep text-white"
                      : "border-line bg-white/70 text-ink-soft hover:border-sage/40 hover:bg-mint/45 hover:text-sage-deep",
                  )}
                >
                  {relationNameMap[key] ?? key}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <label
              htmlFor="proportional-switch"
              className="flex cursor-pointer items-center gap-2 text-[11px] whitespace-nowrap text-ink-soft"
            >
              <Switch
                id="proportional-switch"
                checked={proportional}
                onCheckedChange={setProportional}
                className="data-[state=checked]:bg-sage-deep"
              />
              按占比动态填充
            </label>
            {hasFilter && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] whitespace-nowrap text-sage-deep transition-colors hover:bg-mint/60"
              >
                <X size={11} />
                清除筛选
              </button>
            )}
          </div>

          <div className="mt-6 hidden border-t border-line/80 pt-4 lg:block">
            <RadiusLegend
              radii={dataset?.radii ?? []}
              hits={radiusHit}
              selected={radiusFilter}
              onToggle={toggleRadius}
              hasActiveFilter={activeScenes.length > 0}
            />
          </div>

          <div className="mt-5 hidden border-t border-line/80 pt-4 pb-8 lg:block">
            {selected ? (
              <div className="panel-in">
                <SceneDetail
                  scene={selected}
                  radiusName={radiusNameMap[selected.radius] ?? selected.radius}
                  radiusColor={radiusColorMap[selected.radius] ?? "#c8d6cd"}
                  relationName={relationNameMap[selected.relation] ?? ""}
                  onClose={() => setSelected(null)}
                />
              </div>
            ) : (
              <div className="flex items-start gap-2.5">
                <MousePointerClick
                  size={14}
                  className="mt-0.5 shrink-0 text-sage/80"
                  strokeWidth={1.6}
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  点击任意扇形，查看场景释义、关系归类与占比。
                </p>
              </div>
            )}
          </div>
        </aside>

        {/* 右侧：扇形全高铺展 */}
        <main className="relative order-2 h-[440px] shrink-0 sm:h-[540px] lg:h-full lg:min-h-0 lg:flex-1 lg:shrink">
          {dataset ? (
            <RadialChart
              scenes={scenes}
              radiusColors={radiusColorMap}
              radiusGradients={radiusGradientMap}
              radiusTextures={radiusTextureMap}
              radiusNames={radiusNameMap}
              relationNames={relationNameMap}
              relationDescs={relationDescMap}
              activeScenes={activeScenes}
              proportional={proportional}
              selectedId={selected?.id ?? null}
              onSelect={handleSelect}
              zoomInTick={zoomInTick}
              zoomOutTick={zoomOutTick}
              resetTick={resetTick}
            />
          ) : (
            <div className="grid h-full place-items-center">
              <div className="flex flex-col items-center gap-2.5 text-center">
                {error ? (
                  <>
                    <p className="text-[12.5px] text-[#a9504a]">数据加载失败</p>
                    <p className="max-w-[260px] text-[11px] leading-relaxed text-muted-foreground">
                      {error}
                    </p>
                  </>
                ) : (
                  <>
                    <Loader2 size={18} className="animate-spin text-sage" />
                    <p className="text-[12px] text-muted-foreground">
                      正在铺展场景…
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-full border border-line bg-white/75 p-1 shadow-soft backdrop-blur-sm sm:top-4 sm:right-5">
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-full text-ink-soft hover:bg-mint hover:text-sage-deep"
              onClick={() => setZoomOutTick((t) => t + 1)}
              aria-label="缩小"
            >
              <Minus size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-full text-ink-soft hover:bg-mint hover:text-sage-deep"
              onClick={() => setResetTick((t) => t + 1)}
              aria-label="复位视图"
            >
              <RotateCcw size={13} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-full text-ink-soft hover:bg-mint hover:text-sage-deep"
              onClick={() => setZoomInTick((t) => t + 1)}
              aria-label="放大"
            >
              <Plus size={14} />
            </Button>
          </div>

          <p className="pointer-events-none absolute right-4 bottom-3 hidden text-[10px] text-muted-foreground/80 sm:block lg:right-6 lg:bottom-5">
            ⌘/Ctrl + 滚轮缩放 · 拖拽平移
          </p>
        </main>

        {/* 移动端：图例置于图下，页面可纵向滚动 */}
        <div className="order-3 px-5 pt-5 pb-8 sm:px-7 lg:hidden">
          <div className="border-t border-line/80 pt-4">
            <RadiusLegend
              radii={dataset?.radii ?? []}
              hits={radiusHit}
              selected={radiusFilter}
              onToggle={toggleRadius}
              hasActiveFilter={activeScenes.length > 0}
            />
          </div>
          <p className="mt-4 text-[10px] leading-relaxed text-muted-foreground">
            场景数据来自飞书知识库，未配置凭证时使用内置场景集。
          </p>
        </div>
      </div>

      {/* 选中详情（移动端底部抽屉） */}
      {selected && (
        <div className="fixed inset-x-3 bottom-3 z-40 lg:hidden">
          <div className="sheet-up rounded-card border border-line bg-white/95 p-4 shadow-lift backdrop-blur-md">
            <SceneDetail
              scene={selected}
              radiusName={radiusNameMap[selected.radius] ?? selected.radius}
              radiusColor={radiusColorMap[selected.radius] ?? "#c8d6cd"}
              relationName={relationNameMap[selected.relation] ?? ""}
              onClose={() => setSelected(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
