/**
 * 场景数据快照：把「后台表格」（飞书多维表格）或内置数据固化成
 * public/data/scenes.json，供纯静态部署（腾讯云 COS / 任意静态托管）使用。
 *
 * 用法：
 *   pnpm scenes:snapshot            # 已配置飞书凭证则拉飞书，否则用内置数据
 *   pnpm scenes:snapshot --builtin  # 强制使用内置数据
 *
 * 退出码：拉取飞书失败时非 0（避免把兜底数据当成真实数据静默发布）。
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import {
  builtinDataset,
  fetchFeishuDataset,
  getFeishuConfig,
} from "../src/lib/feishu";
import type { SceneDataset } from "../src/lib/types";

// 与 Next 的 .env 优先级保持一致：.env.local 覆盖 .env
loadEnv({ path: [".env.local", ".env"], quiet: true });

const OUT_DIR = path.resolve(process.cwd(), "public/data");
const OUT_FILE = path.join(OUT_DIR, "scenes.json");

async function main(): Promise<void> {
  const forceBuiltin = process.argv.includes("--builtin");
  const cfg = forceBuiltin ? null : getFeishuConfig();

  let dataset: SceneDataset;
  if (cfg) {
    console.log("[scenes:snapshot] 读取飞书多维表格…");
    dataset = await fetchFeishuDataset(cfg);
    console.log(
      `[scenes:snapshot] 飞书：${dataset.scenes.length} 个场景` +
        (dataset.skippedCount ? `，跳过 ${dataset.skippedCount} 条无法识别的记录` : ""),
    );
  } else {
    if (!forceBuiltin) {
      console.warn(
        "[scenes:snapshot] 未配置 FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_WIKI_TOKEN，" +
          "改用内置场景数据。",
      );
    }
    dataset = builtinDataset();
    console.log(`[scenes:snapshot] 内置：${dataset.scenes.length} 个场景`);
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
  console.log(
    `[scenes:snapshot] 已写入 ${path.relative(process.cwd(), OUT_FILE)}` +
      `（${(Buffer.byteLength(JSON.stringify(dataset)) / 1024).toFixed(1)} KB，` +
      `source=${dataset.source}）`,
  );
}

main().catch((err: unknown) => {
  console.error(
    `[scenes:snapshot] 失败：${err instanceof Error ? err.message : String(err)}`,
  );
  process.exitCode = 1;
});
