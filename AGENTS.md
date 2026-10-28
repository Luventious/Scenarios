# 项目上下文

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4

## 目录结构

```
├── public/                 # 静态资源
├── scripts/                # 构建与启动脚本
│   ├── build.sh            # 构建脚本
│   ├── dev.sh              # 开发环境启动脚本
│   ├── prepare.sh          # 预处理脚本
│   └── start.sh            # 生产环境启动脚本
├── src/
│   ├── app/                # 页面路由与布局
│   ├── components/ui/      # Shadcn UI 组件库
│   ├── hooks/              # 自定义 Hooks
│   ├── lib/                # 工具库
│   │   └── utils.ts        # 通用工具函数 (cn)
│   └── server.ts           # 自定义服务端入口
├── next.config.ts          # Next.js 配置
├── package.json            # 项目依赖管理
└── tsconfig.json           # TypeScript 配置
```

- 项目文件（如 app 目录、pages 目录、components 等）默认初始化到 `src/` 目录下。

## 包管理规范

**仅允许使用 pnpm** 作为包管理器，**严禁使用 npm 或 yarn**。
**常用命令**：
- 安装依赖：`pnpm add <package>`
- 安装开发依赖：`pnpm add -D <package>`
- 安装所有依赖：`pnpm install`
- 移除依赖：`pnpm remove <package>`

## 开发规范

### 编码规范

- 默认按 TypeScript `strict` 心智写代码；优先复用当前作用域已声明的变量、函数、类型和导入，禁止引用未声明标识符或拼错变量名。
- 禁止隐式 `any` 和 `as any`；函数参数、返回值、解构项、事件对象、`catch` 错误在使用前应有明确类型或先完成类型收窄，并清理未使用的变量和导入。

### next.config 配置规范

- 配置的路径不要写死绝对路径，必须使用 path.resolve(__dirname, ...)、import.meta.dirname 或 process.cwd() 动态拼接。

### Hydration 问题防范

1. 严禁在 JSX 渲染逻辑中直接使用 typeof window、Date.now()、Math.random() 等动态数据。**必须使用 'use client' 并配合 useEffect + useState 确保动态内容仅在客户端挂载后渲染**；同时严禁非法 HTML 嵌套（如 <p> 嵌套 <div>）。
2. **禁止使用 head 标签**，优先使用 metadata，详见文档：https://nextjs.org/docs/app/api-reference/functions/generate-metadata
   1. 三方 CSS、字体等资源可在 `globals.css` 中顶部通过 `@import` 引入或使用 next/font
   2. preload, preconnect, dns-prefetch 通过 ReactDOM 的 preload、preconnect、dns-prefetch 方法引入
   3. json-ld 可阅读 https://nextjs.org/docs/app/guides/json-ld

## UI 设计与组件规范 (UI & Styling Standards)

- 模板默认预装核心组件库 `shadcn/ui`，位于`src/components/ui/`目录下
- Next.js 项目**必须默认**采用 shadcn/ui 组件、风格和规范，**除非用户指定用其他的组件和规范。**

## 业务模块地图（车生活场景矩阵）

| 文件 | 职责 | 关键导出 |
| --- | --- | --- |
| `src/lib/types.ts` | 数据契约：`SceneItem`（含 `weight?` 占比）、`RadiusMeta`（含 `GradientStop[]` 多停靠点渐变与 `RadiusTexture` 分区织纹）、`RelationMeta`、`SceneDataset` | `RadiusKey`、`RelationKey`、`GradientStop`、`RadiusTexture` |
| `src/lib/builtin-data.ts` | 内置 56 个车生活场景、4 个出行半径元数据、6 类关系半径元数据 | `RADII`、`RELATIONS`、`BUILTIN_SCENES` |
| `src/lib/feishu.ts` | 飞书多维表格适配：tenant token 获取、wiki 链接 token 解析、数据表自动发现、分页拉取、字段解析/归一化（含《占比》weight）；未配置凭证时回退内置数据 | `getFeishuConfig`、`fetchFeishuDataset`、`parseFeishuRecords`、`builtinDataset` |
| `src/lib/geometry.ts` | 动态扇形填充算法：类别角宽按活跃场景数占比（`proportional`）；R1/R2 每场景一行从里到外堆叠（只横切，角宽全开），R3/R4 二分行 + 行内按《占比》竖切（格子面积 ∝ 占比，缺省等权）；缝隙体系：区内各向同性 `cellGap×r`，扇区（出行半径层）间 `zoneGap×r`（= 区内 3 倍，仅三条内部边界）；空（关系×半径）分区输出占位色块（`placeholders`）维持矩阵网格完整；极坐标/扇区 path 生成 | `buildLayout`、`arcPath`、`polar`、`Layout`、`Cell`、`PlaceholderCell` |
| `src/components/radial-chart.tsx` | SVG 径向扇形矩阵（120° 扇面，等比居中 `xMidYMid meet`）：单一 rAF 时间轴驱动的「折扇展开」出场动画（全部扇区角度先收拢到扇面起点，再连续张开；取代逐格 CSS pop）+ 筛选后角度/半径补间、⌘/Ctrl+滚轮与按钮缩放、拖拽平移（3px 死区）、悬停 tooltip（6px 节流）、点击选中、无填充色带的艺术字关系标题（细弧经纬线 + 思源宋体中文 + Playfair 斜体英文注记）、场景名与标题均沿弧弯曲排布（textPath 贴弧线居中）、墨绿字 + 白色 halo、字号「弧长×行高」双约束自适应；每层一条多停靠点径向一体渐变 + 分区织纹极坐标覆层 | `RadialChart`（默认导出）、`HoverInfo` |
| `src/components/scene-explorer.tsx` | 页面主组件（杂志式纵向排布，不再一屏锁死）：页头 + 标题区统计条 + 胶囊筛选控制条 + 图表卡（卡内含缩放三键与 HOW TO READ 注解）+ 侧栏（出行半径图例 / 选中详情，lg 起 sticky）；移动端详情改为底部抽屉 | `SceneExplorer`（默认导出） |
| `src/app/globals.css` | 全局设计令牌（`paper/ink/sage/mint/line`、`radius-card`、`shadow-soft|lift`、`ease-soft`）+ 纸感环境底 + `.rise-in/.sheet-up/.breathe-arc` 动效基元；规范见 `DESIGN.md` | - |
| `src/app/api/scenes/route.ts` | `GET /api/scenes`：飞书已配置则真实调用飞书 API（失败返回 502），否则返回内置数据集 | - |

### 飞书数据源接入

- 必填环境变量：`FEISHU_APP_ID`、`FEISHU_APP_SECRET`；数据源定位三选一（优先级从高到低）：
  1. `FEISHU_BITABLE_APP_TOKEN`：直接指定多维表格（可配合 `FEISHU_BITABLE_TABLE_ID`，缺省自动取第一张数据表）；
  2. `FEISHU_WIKI_TOKEN`：飞书 wiki 链接 token（`https://xxx.feishu.cn/wiki/<token>`），经 `/wiki/v2/spaces/get_node` 解析为 bitable `obj_token`，再自动发现第一张数据表；**未配置时默认指向车生活场景库 wiki（BqQpwxcQHi9GX2kkWAXcyrJMndh）**；
  3. 可选 `FEISHU_BITABLE_VIEW_ID` 指定视图。
- 默认列名映射（`feishu.ts` 的 `DEFAULT_FIELD_MAP`）：场景名称 / 出行半径（值为 r1–r4 或层名称）/ 关系半径（值为分类名称）/ 场景释义 / 占比（支持「高/中/低」档位 → 相对权重 3/2/1，或数值小数/带 % 文本；缺失/非法按等权处理）。占比同时保留原始档位文本（`weightLabel`）用于详情展示。
- 真实调用飞书开放平台：`/auth/v3/tenant_access_token/internal` + `/wiki/v2/spaces/get_node` + `/bitable/v1/apps/{app_token}/tables` + `/bitable/v1/apps/{app_token}/tables/{table_id}/records/search`（分页 page_size=200）。
- 飞书应用（自建应用）需在开放平台开通「云文档」/「多维表格」读取权限，且该应用需被添加为 wiki 知识库协作者，否则 token 可用但记录读取会 403。

## 构建与测试命令

- 开发：`pnpm run dev`；生产构建：`pnpm run build`；启动：`pnpm run start`
- 静态检查：`pnpm ts-check`、`pnpm lint --quiet`
- 接口冒烟：`GET /api/scenes` 返回 JSON，须含 `source/radii/relations/scenes/fetchedAt`

