"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  ZoomIn,
  ZoomOut,
  Maximize,
  Database,
  X,
} from "lucide-react";
import RadialChart from "@/components/radial-chart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type {
  GradientStop,
  RadiusKey,
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

export default function SceneExplorer() {
  const [dataset, setDataset] = useState<SceneDataset | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [relations, setRelations] = useState<Set<RelationKey>>(new Set());
  const [radii, setRadii] = useState<Set<RadiusKey>>(new Set());
  const [proportional, setProportional] = useState(true);
  const [selected, setSelected] = useState<SceneItem | null>(null);

  const [zoomInTick, setZoomInTick] = useState(0);
  const [zoomOutTick, setZoomOutTick] = useState(0);
  const [resetTick, setResetTick] = useState(0);

  useEffect(() => {
    let aborted = false;
    fetch("/api/scenes")
      .then(async (resp) => {
        const body = (await resp.json()) as SceneDataset & {
          error?: string;
          message?: string;
        };
        if (!resp.ok) {
          throw new Error(body.message ?? "场景数据加载失败");
        }
        if (!aborted) {
          setDataset(body);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!aborted) {
          setError(err instanceof Error ? err.message : "数据加载失败");
        }
      });
    return () => {
      aborted = true;
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
      if (relations.size > 0 && !relations.has(s.relation)) return false;
      if (radii.size > 0 && !radii.has(s.radius)) return false;
      if (q) {
        const hay = `${s.name} ${s.description}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [scenes, query, relations, radii]);

  const hasFilter =
    query.trim() !== "" || relations.size > 0 || radii.size > 0;

  const clearFilters = useCallback(() => {
    setQuery("");
    setRelations(new Set());
    setRadii(new Set());
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

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#eff1f3] text-[#24272c]">
      {/* 顶栏（单行紧凑） */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#dfe2e6] px-4 py-2.5 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="font-script shrink-0 text-[22px] font-bold leading-none text-[#009933]">
            Will On Wheel
          </span>
          <h1 className="truncate text-[13px] font-bold tracking-wide text-[#222222] sm:text-[15px]">
            场景矩阵
          </h1>
          <span className="hidden shrink-0 text-[11px] text-[#555555] md:inline">
            出行半径 × 关系半径
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-[#6c7178]">
          <Database size={13} />
          {error ? (
            <span className="text-[#c2453a]">数据读取失败：{error}</span>
          ) : dataset ? (
            <span>
              {dataset.source === "feishu" ? "飞书知识库" : "内置场景集"} ·{" "}
              {scenes.length} 场景
              {typeof dataset.skippedCount === "number" &&
                dataset.skippedCount > 0 && (
                  <span className="text-[#9aa0a8]">
                    {" "}
                    （{dataset.skippedCount} 条未识别已跳过）
                  </span>
                )}
            </span>
          ) : (
            <span>数据加载中…</span>
          )}
        </div>
      </header>

      {/* 控制条（单行，可横向滚动） */}
      <section className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-[#dfe2e6] px-4 py-2 sm:px-6">
        <div className="relative w-44 shrink-0 sm:w-52">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#868b93]"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="检索场景名称 / 关键词"
            className="h-8 rounded-none border-[#d3d7dc] bg-[#fafbfc] pl-8 text-[12px] shadow-none focus-visible:ring-[#2f5f8f]"
          />
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {RELATION_KEYS.map((key) => {
            const on = relations.has(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => setRelations((prev) => toggleInSet(prev, key))}
                className={`border px-2 py-1 text-[11.5px] whitespace-nowrap transition-colors ${
                  on
                    ? "border-[#2f5f8f] bg-[#2f5f8f] text-[#eff1f3]"
                    : "border-[#d3d7dc] bg-[#fafbfc] text-[#565b62] hover:border-[#2f5f8f]"
                }`}
              >
                {relationNameMap[key] ?? key}
              </button>
            );
          })}
        </div>

        <span className="h-4 w-px shrink-0 bg-[#d3d7dc]" />

        <div className="flex shrink-0 items-center gap-1">
          {RADIUS_KEYS.map((key) => {
            const on = radii.has(key);
            const meta = dataset?.radii.find((r) => r.key === key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => setRadii((prev) => toggleInSet(prev, key))}
                className={`flex items-center gap-1.5 border px-2 py-1 text-[11.5px] whitespace-nowrap transition-colors ${
                  on
                    ? "border-[#24272c] bg-[#24272c] text-[#eff1f3]"
                    : "border-[#d3d7dc] bg-[#fafbfc] text-[#565b62] hover:border-[#24272c]"
                }`}
              >
                <span
                  className="inline-block h-2 w-2"
                  style={{ backgroundColor: meta?.color ?? "#999" }}
                />
                {meta?.name ?? key.toUpperCase()}
              </button>
            );
          })}
        </div>

        <label
          htmlFor="proportional-switch"
          className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11.5px] text-[#565b62]"
        >
          <Switch
            id="proportional-switch"
            checked={proportional}
            onCheckedChange={setProportional}
            className="data-[state=checked]:bg-[#2f5f8f]"
          />
          动态填充
        </label>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 rounded-none border-[#d3d7dc] bg-[#fafbfc]"
            onClick={() => setZoomInTick((t) => t + 1)}
            aria-label="放大"
          >
            <ZoomIn size={14} />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 rounded-none border-[#d3d7dc] bg-[#fafbfc]"
            onClick={() => setZoomOutTick((t) => t + 1)}
            aria-label="缩小"
          >
            <ZoomOut size={14} />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 rounded-none border-[#d3d7dc] bg-[#fafbfc]"
            onClick={() => setResetTick((t) => t + 1)}
            aria-label="复位视图"
          >
            <Maximize size={13} />
          </Button>
          {hasFilter && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-1 whitespace-nowrap text-[11.5px] text-[#2f5f8f] underline-offset-2 hover:underline"
            >
              清除筛选
            </button>
          )}
        </div>
      </section>

      {/* 主图区（占满剩余空间，扇形贴右下角） */}
      <main className="relative min-h-0 flex-1">
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
          <div className="flex h-full items-center justify-center text-[13px] text-[#868b93]">
            {error ? `加载失败：${error}` : "正在解析场景数据…"}
          </div>
        )}

        {/* 图例浮层（左上） */}
        {dataset && (
          <div className="panel-in pointer-events-none absolute left-4 top-3 max-w-[300px] border border-[#dfe2e6] bg-[#fafbfc]/90 p-3 shadow-sm backdrop-blur-sm sm:left-6 sm:top-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[11px] tracking-widest text-[#868b93]">
                出行半径 · 径向四层
              </span>
              <span className="text-[11px] text-[#868b93]">
                命中{" "}
                <strong className="text-[13px] font-bold text-[#009933]">
                  {activeScenes.length}
                </strong>
                /{scenes.length}
              </span>
            </div>
            <div className="mt-2 flex flex-col gap-2">
              {dataset.radii.map((r) => (
                <div key={r.key}>
                  <div className="flex items-center gap-1.5">
                    <span
                      className="rounded-[3px] px-1.5 py-[3px] text-[11px] font-bold leading-none text-white"
                      style={{
                        backgroundImage: r.gradient
                          ? `linear-gradient(90deg, ${r.gradient
                              .map(
                                ([t, c]) =>
                                  `${c} ${(t * 100).toFixed(0)}%`,
                              )
                              .join(", ")})`
                          : r.color,
                      }}
                    >
                      {r.name}
                    </span>
                    <span className="text-[10.5px] text-[#868b93]">
                      {radiusHit(r.key)}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] leading-snug text-[#868b93]">
                    {r.description}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-2 border-t border-[#dfe2e6] pt-1.5 text-[10.5px] leading-relaxed text-[#868b93]">
              角度方向 = 关系半径六类，径向四层可点选上方出行半径标签筛选
            </p>
          </div>
        )}

        {/* 选中详情浮层（左下） */}
        {selected && (
          <div className="panel-in absolute bottom-3 left-4 max-w-[340px] border border-[#dfe2e6] bg-[#fafbfc]/95 p-3.5 shadow-md backdrop-blur-sm sm:bottom-5 sm:left-6">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-[14px] font-semibold text-[#24272c]">
                {selected.name}
              </h3>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="mt-0.5 text-[#868b93] transition-colors hover:text-[#24272c]"
                aria-label="关闭详情"
              >
                <X size={14} />
              </button>
            </div>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-[#6c7178]">
              {selected.description}
            </p>
            <div className="mt-2 flex items-center gap-2 border-t border-[#dfe2e6] pt-2 text-[11px]">
              <span className="flex items-center gap-1.5 text-[#24272c]">
                <span
                  className="inline-block h-2 w-2"
                  style={{
                    backgroundColor: radiusColorMap[selected.radius],
                  }}
                />
                {dataset?.radii.find((r) => r.key === selected.radius)?.name}
              </span>
              <span className="h-3 w-px bg-[#d3d7dc]" />
              <span className="text-[#6c7178]">
                {relationNameMap[selected.relation]}
              </span>
              {selected.weightLabel && (
                <>
                  <span className="h-3 w-px bg-[#d3d7dc]" />
                  <span className="font-semibold text-[#009933]">
                    占比 {selected.weightLabel}
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        {/* 操作提示 */}
        <p className="pointer-events-none absolute bottom-3 right-4 hidden text-[10.5px] text-[#9aa0a8] sm:block">
          滚轮缩放 · 拖拽平移 · 点击扇形查看详情
        </p>
      </main>
    </div>
  );
}
