import type {
  RadiusKey,
  RelationKey,
  SceneItem,
} from "./types";
import { BUILTIN_SCENES, RADII, RELATIONS } from "./builtin-data";
import type { SceneDataset } from "./types";

/** 飞书多维表格字段映射（可按知识库实际列名覆盖） */
export interface FeishuFieldMap {
  name: string;
  radius: string;
  relation: string;
  description: string;
  /** 占比列：驱动 R3/R4 格子面积分配 */
  weight: string;
}

export const DEFAULT_FIELD_MAP: FeishuFieldMap = {
  name: "场景名称",
  radius: "出行半径",
  relation: "关系半径",
  description: "场景释义",
  weight: "占比",
};

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  /** 多维表格 app_token（与 wikiToken 至少提供一个） */
  appToken?: string;
  /** 飞书 wiki 链接 token（形如 https://xxx.feishu.cn/wiki/<token>），自动解析为 bitable app_token */
  wikiToken?: string;
  /** 数据表 id；缺省时自动取多维表格中的第一张表 */
  tableId?: string;
  viewId?: string;
  fieldMap: FeishuFieldMap;
}

export function getFeishuConfig(): FeishuConfig | null {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  const appToken = process.env.FEISHU_BITABLE_APP_TOKEN;
  const wikiToken = process.env.FEISHU_WIKI_TOKEN;
  const tableId = process.env.FEISHU_BITABLE_TABLE_ID;
  if (!appId || !appSecret || (!appToken && !wikiToken)) return null;
  return {
    appId,
    appSecret,
    appToken: appToken || undefined,
    wikiToken: appToken ? undefined : wikiToken,
    tableId: tableId || undefined,
    viewId: process.env.FEISHU_BITABLE_VIEW_ID,
    fieldMap: DEFAULT_FIELD_MAP,
  };
}

interface FeishuTokenResp {
  code: number;
  msg: string;
  tenant_access_token?: string;
}

interface FeishuSearchResp {
  code: number;
  msg: string;
  data?: {
    items?: Array<{ record_id: string; fields: Record<string, unknown> }>;
    page_token?: string;
    has_more?: boolean;
  };
}

async function fetchTenantToken(cfg: FeishuConfig): Promise<string> {
  const resp = await fetch(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        app_id: cfg.appId,
        app_secret: cfg.appSecret,
      }),
      cache: "no-store",
    },
  );
  const data = (await resp.json()) as FeishuTokenResp;
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`飞书 token 获取失败: ${data.code} ${data.msg}`);
  }
  return data.tenant_access_token;
}

/** 飞书富文本/文本字段 -> 纯文本 */
function textValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((seg) => {
        if (typeof seg === "string") return seg;
        if (seg && typeof seg === "object" && "text" in seg) {
          return String((seg as { text: unknown }).text ?? "");
        }
        return "";
      })
      .join("")
      .trim();
  }
  if (typeof value === "object") {
    const obj = value as { text?: unknown; name?: unknown };
    if (typeof obj.text === "string") return obj.text.trim();
    if (typeof obj.name === "string") return obj.name.trim();
  }
  return "";
}

const RADIUS_BY_NAME = new Map<string, RadiusKey>([
  ["r1", "r1"],
  ["r2", "r2"],
  ["r3", "r3"],
  ["r4", "r4"],
]);
for (const meta of RADII) RADIUS_BY_NAME.set(meta.name, meta.key);

const RELATION_BY_NAME = new Map<string, RelationKey>();
for (const meta of RELATIONS) RELATION_BY_NAME.set(meta.name, meta.key);

function normalizeRadius(raw: string): RadiusKey | null {
  return RADIUS_BY_NAME.get(raw.trim()) ?? null;
}

function normalizeRelation(raw: string): RelationKey | null {
  return RELATION_BY_NAME.get(raw.trim()) ?? null;
}

/** 《占比》档位 -> 相对权重映射（面积分配用） */
const WEIGHT_LEVELS: Record<string, number> = {
  高: 3,
  中: 2,
  低: 1,
};

/**
 * 解析《占比》字段：支持「高/中/低」档位与数值（小数或带 % 文本）两种形态。
 * 档位映射为相对权重（高=3/中=2/低=1）；返回原始档位文本用于详情展示；
 * 缺失/非法时两者皆 undefined（布局按等权处理）
 */
function parseWeight(value: unknown): { weight?: number; label?: string } {
  if (value == null) return {};
  if (typeof value === "number" && Number.isFinite(value)) {
    return { weight: value, label: String(value) };
  }
  const raw = textValue(value).trim();
  if (!raw) return {};
  const level = WEIGHT_LEVELS[raw];
  if (level !== undefined) return { weight: level, label: raw };
  const num = Number.parseFloat(raw.replace(/[%％]/g, ""));
  if (Number.isFinite(num)) return { weight: num, label: raw };
  return {};
}

/** 将飞书记录解析为场景项；非法/缺字段记录丢弃并计数 */
export function parseFeishuRecords(
  records: Array<{ record_id: string; fields: Record<string, unknown> }>,
  fieldMap: FeishuFieldMap,
): { scenes: SceneItem[]; skipped: number } {
  const scenes: SceneItem[] = [];
  let skipped = 0;
  for (const rec of records) {
    const name = textValue(rec.fields[fieldMap.name]);
    const radius = normalizeRadius(
      textValue(rec.fields[fieldMap.radius]),
    );
    const relation = normalizeRelation(
      textValue(rec.fields[fieldMap.relation]),
    );
    if (!name || !radius || !relation) {
      skipped += 1;
      continue;
    }
    const { weight, label } = parseWeight(rec.fields[fieldMap.weight]);
    scenes.push({
      id: rec.record_id,
      name,
      radius,
      relation,
      description: textValue(rec.fields[fieldMap.description]),
      ...(weight !== undefined ? { weight, weightLabel: label } : {}),
    });
  }
  return { scenes, skipped };
}

interface FeishuWikiNodeResp {
  code: number;
  msg: string;
  data?: { node?: { obj_token?: string; obj_type?: string } };
}

interface FeishuTablesResp {
  code: number;
  msg: string;
  data?: { items?: Array<{ table_id: string; name: string }> };
}

/**
 * 解析飞书 wiki 链接 token -> 多维表格 app_token。
 * GET /wiki/v2/spaces/get_node?token=<wiki_token>&obj_type=wiki
 */
async function resolveWikiAppToken(
  token: string,
  wikiToken: string,
): Promise<string> {
  const resp = await fetch(
    `https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(wikiToken)}&obj_type=wiki`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );
  const data = (await resp.json()) as FeishuWikiNodeResp;
  const node = data.code === 0 ? data.data?.node : undefined;
  if (data.code !== 0 || !node?.obj_token) {
    throw new Error(`飞书 wiki 节点解析失败: ${data.code} ${data.msg}`);
  }
  if (node.obj_type && node.obj_type !== "bitable") {
    throw new Error(
      `飞书 wiki 节点不是多维表格 (obj_type=${node.obj_type})`,
    );
  }
  return node.obj_token;
}

/** 未配置 tableId 时，取多维表格中的第一张数据表 */
async function resolveFirstTableId(
  token: string,
  appToken: string,
): Promise<string> {
  const resp = await fetch(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables?page_size=20`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );
  const data = (await resp.json()) as FeishuTablesResp;
  if (data.code !== 0 || !data.data?.items?.length) {
    throw new Error(`飞书数据表读取失败: ${data.code} ${data.msg}`);
  }
  return data.data.items[0].table_id;
}

/** 拉取飞书多维表格全部分页记录并解析为数据集 */
export async function fetchFeishuDataset(
  cfg: FeishuConfig,
): Promise<SceneDataset> {
  const token = await fetchTenantToken(cfg);
  const appToken =
    cfg.appToken ??
    (await resolveWikiAppToken(token, cfg.wikiToken as string));
  const tableId = cfg.tableId ?? (await resolveFirstTableId(token, appToken));

  const url =
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}` +
    `/tables/${tableId}/records/search` +
    (cfg.viewId ? `?view_id=${encodeURIComponent(cfg.viewId)}` : "");

  const records: Array<{
    record_id: string;
    fields: Record<string, unknown>;
  }> = [];
  let pageToken: string | undefined;
  do {
    const pageUrl = pageToken
      ? `${url}${cfg.viewId ? "&" : "?"}page_token=${encodeURIComponent(pageToken)}`
      : url;
    const resp = await fetch(pageUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ page_size: 200 }),
      cache: "no-store",
    });
    const data = (await resp.json()) as FeishuSearchResp;
    if (data.code !== 0 || !data.data) {
      throw new Error(`飞书记录读取失败: ${data.code} ${data.msg}`);
    }
    if (data.data.items) records.push(...data.data.items);
    pageToken = data.data.has_more ? data.data.page_token : undefined;
  } while (pageToken);

  const { scenes, skipped } = parseFeishuRecords(records, cfg.fieldMap);
  // 全部记录都无法映射（列名不符/标签未识别）时给出可操作的诊断，
  // 避免渲染一张"零场景"的空图
  if (records.length > 0 && scenes.length === 0) {
    const fieldNames =
      Object.keys(records[0]?.fields ?? {}).join("、") || "（无任何字段）";
    throw new Error(
      `飞书记录字段映射失败：已读取 ${records.length} 条记录，但按列名` +
        `「${cfg.fieldMap.name}」「${cfg.fieldMap.radius}」「${cfg.fieldMap.relation}」` +
        `未匹配到任何有效场景。表中实际字段：${fieldNames}`,
    );
  }
  return {
    source: "feishu",
    radii: RADII,
    relations: RELATIONS,
    scenes,
    ...(skipped > 0 ? { skippedCount: skipped } : {}),
    fetchedAt: new Date().toISOString(),
  };
}

export function builtinDataset(): SceneDataset {
  return {
    source: "builtin",
    radii: RADII,
    relations: RELATIONS,
    scenes: BUILTIN_SCENES,
    fetchedAt: new Date().toISOString(),
  };
}
