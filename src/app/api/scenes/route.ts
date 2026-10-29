import { NextResponse } from "next/server";
import {
  builtinDataset,
  fetchFeishuDataset,
  getFeishuConfig,
} from "@/lib/feishu";

// 数据源随时可能在飞书表格里被编辑：服务端按 60s ISR 重新拉取（开发模式下每次请求都重算），
// 既保住「改表即生效」，也让纯静态导出（STATIC_EXPORT=1）能在构建期把它固化成文件。
export const revalidate = 60;

// 场景数据：已配置飞书凭证时读取飞书多维表格，否则回退内置数据集
export async function GET() {
  const cfg = getFeishuConfig();
  if (cfg) {
    try {
      const dataset = await fetchFeishuDataset(cfg);
      return NextResponse.json(dataset);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "未知飞书读取错误";
      return NextResponse.json(
        { error: "feishu_fetch_failed", message },
        { status: 502 },
      );
    }
  }
  return NextResponse.json(builtinDataset());
}
