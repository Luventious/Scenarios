import { BUILTIN_SCENES, RADII, RELATIONS } from "./builtin-data";
import type { SceneDataset } from "./types";

/** 数据实际命中来源：服务端接口（飞书实时）/ 构建期快照（静态托管）/ 前端内置兜底 */
export type SceneDatasetOrigin = "api" | "snapshot" | "fallback";

export interface SceneDatasetLoad {
  dataset: SceneDataset;
  origin: SceneDatasetOrigin;
}

/**
 * 部署子路径（与 next.config 的 basePath 同源，构建期由 NEXT_PUBLIC_BASE_PATH 注入）。
 * 运行时手写 fetch 不受 Next basePath 自动改写，必须自己拼前缀，
 * 否则站点放进桶内子目录（如与博客共用一个桶）时，数据请求会打到站点根路径上去。
 */
const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/+$/, "");

/**
 * 构建期快照路径。纯静态部署（腾讯云 COS 等）没有 /api 路由，
 * 由 `pnpm scenes:snapshot` 把飞书表格导出到这里。
 */
export const SCENES_SNAPSHOT_URL = `${BASE_PATH}/data/scenes.json`;

function isSceneDataset(value: unknown): value is SceneDataset {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<SceneDataset> & { error?: string; message?: string };
  return (
    !body.error &&
    Array.isArray(body.scenes) &&
    Array.isArray(body.radii) &&
    Array.isArray(body.relations)
  );
}

async function readDataset(
  url: string,
  signal?: AbortSignal,
): Promise<SceneDataset> {
  const resp = await fetch(url, { signal, cache: "no-store" });
  if (!resp.ok) throw new Error(`${url} 返回 ${resp.status}`);
  const body: unknown = await resp.json();
  if (!isSceneDataset(body)) {
    const body2 = body as { message?: string } | null;
    throw new Error(body2?.message ?? `${url} 返回的数据集格式不正确`);
  }
  return body;
}

/** 没有服务端时的兜底数据集（内置 56 条），保证页面永远有内容可渲染 */
function fallbackDataset(): SceneDataset {
  return {
    source: "builtin",
    radii: RADII,
    relations: RELATIONS,
    scenes: BUILTIN_SCENES,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * 按优先级加载场景数据：
 * - 服务端运行时：`/api/scenes`（飞书凭证在服务端，表格改完刷新即生效）→ 快照 → 内置兜底
 * - 纯静态导出（STATIC_EXPORT=1）：静态构建里没有接口，先读快照，避免一次无意义的 404
 */
export async function loadSceneDataset(
  signal?: AbortSignal,
): Promise<SceneDatasetLoad> {
  const apiEndpoint = {
    origin: "api" as const,
    url: `${BASE_PATH}/api/scenes`,
  };
  const snapshotEndpoint = {
    origin: "snapshot" as const,
    url: SCENES_SNAPSHOT_URL,
  };
  const isStaticExport = process.env.NEXT_PUBLIC_STATIC_EXPORT === "1";
  const endpoints = isStaticExport
    ? [snapshotEndpoint, apiEndpoint]
    : [apiEndpoint, snapshotEndpoint];

  const failures: string[] = [];
  for (const { origin, url } of endpoints) {
    try {
      return { dataset: await readDataset(url, signal), origin };
    } catch (err: unknown) {
      if (signal?.aborted) throw err;
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }

  console.warn(
    `[scenes] 接口与快照均不可用，回退内置数据：${failures.join("；")}`,
  );
  return { dataset: fallbackDataset(), origin: "fallback" };
}
