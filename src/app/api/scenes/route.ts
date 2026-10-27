import { NextResponse } from "next/server";
import {
  builtinDataset,
  fetchFeishuDataset,
  getFeishuConfig,
} from "@/lib/feishu";

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
