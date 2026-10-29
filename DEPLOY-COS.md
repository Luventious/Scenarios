# 部署到腾讯云 COS（scene.shangqing.site）

本文回答两件事：**场景数据能不能不写死在代码里**、**怎么把这个站点放到腾讯云 COS 并绑定 `scene.shangqing.site`**。

---

## 一、场景数据从哪里来

场景**不是写死在前端**：页面启动时按优先级加载数据，内置的 56 条只是最后一层兜底。

| 优先级 | 数据源 | 何时生效 | 改数据后如何看到 |
| --- | --- | --- | --- |
| 1 | `/api/scenes`（服务端读飞书多维表格） | 用 `pnpm dev` / `pnpm start` 跑 Node 服务时 | 刷新页面（服务端 60s 内缓存，开发模式每次实时拉取） |
| 2 | `/data/scenes.json`（构建期快照） | 纯静态托管（COS） | 重新 `pnpm build:static` + 上传 |
| 3 | 内置 56 条（`src/lib/builtin-data.ts`） | 上面两级都不可用时 | 改代码 |

加载逻辑在 [src/lib/scenes-client.ts](src/lib/scenes-client.ts)，飞书适配在 [src/lib/feishu.ts](src/lib/feishu.ts)。左上角徽章会显示当前命中的数据源：`飞书多维表格`（实时）/ `飞书快照`（静态）/ `内置场景集`（兜底）。

### 用飞书多维表格当后台（推荐）

多维表格就是后台：运营同学直接在表格里增删改，前端自动跟上。

**表格结构**（列名可在 `DEFAULT_FIELD_MAP` 改）：

| 列名 | 必填 | 取值 |
| --- | --- | --- |
| 场景名称 | ✅ | 文本，如「周末撤「野」局」 |
| 出行半径 | ✅ | `r1`–`r4`，或层名：高频生活半径 / 都市探索半径 / 近郊短途逃离半径 / 远方奔赴半径 |
| 关系半径 | ✅ | 个人独处 / 亲密关系 / 家庭亲子 / 人与宠物 / 兴趣趣缘 / 职场商务 |
| 场景释义 | — | 详情面板正文 |
| 占比 | — | `高` / `中` / `低`（映射权重 3/2/1），或数字 / 带 `%` 的文本；决定 R3/R4 格子面积 |

字段缺失或标签认不出的行会被跳过，并在统计条上显示「N 条未识别」，不会让整张图挂掉。

**接入步骤**

1. 飞书开放平台 → 创建**企业自建应用**，记录 `App ID` / `App Secret`。
2. 给应用开通权限：`bitable:app:readonly`（多维表格读取）+ `wiki:wiki:readonly`（若用知识库链接）。改完权限需**创建并发布版本**才生效。
3. 把这个应用加为目标知识库/多维表格的**协作者**（可阅读）。否则 token 正常但读记录会 403。
4. 项目根目录建 `.env.local`：

   ```bash
   FEISHU_APP_ID=cli_xxx
   FEISHU_APP_SECRET=xxx
   # 三选一，优先级从高到低：
   FEISHU_WIKI_TOKEN=BqQpwxcQHi9GX2kkWAXcyrJMndh   # 车生活场景库（默认值，可省略）
   # FEISHU_BITABLE_APP_TOKEN=bascnxxxx            # 直接给多维表格 app_token
   # FEISHU_BITABLE_TABLE_ID=tblxxxx               # 缺省自动取第一张数据表
   ```

   `.env.local` 已在 `.gitignore` 里，**不要把凭证提交进仓库**。

5. 验证：`pnpm dev` 后刷新页面，徽章应变成「飞书多维表格」；或 `curl -s localhost:5000/api/scenes | head -c 200` 看 `"source":"feishu"`。

### 静态托管下的数据（COS 没有 Node 运行时）

COS 只托管静态文件，跑不了 `/api/scenes`，所以构建时把表格「拍照」成 JSON：

```bash
pnpm scenes:snapshot          # 有飞书凭证 → 拉表；没有 → 用内置数据
pnpm scenes:snapshot --builtin
```

产物是 `public/data/scenes.json`，随 `out/` 一起发布。**表格改完后**：重跑一条命令即可

```bash
pnpm build:static && coscli sync ./out/ cos://<桶别名>/ -r --delete
```

也可以挂到 CI（例如每天或表格变更后触发），把「改表 → 上线」变成无人值守。

> 想把数据存到别处也只要满足这个 JSON 契约（`source / radii / relations / scenes / fetchedAt`），前端不做来源假设。

**要不要自带后台界面？** 目前没有内置的 `/admin` 编辑页：那需要额外引入数据库 + 登录鉴权 + 写入接口，和「一张表就是后台」的目标重复。飞书多维表格已经覆盖了在线编辑、多人协作、权限、字段校验，是最省事的后台。

---

## 二、部署到腾讯云 COS

### 0. 先确认备案（中国大陆地域的硬门槛）

- 存储桶在**中国大陆地域**（北京/上海/广州…）时，绑定自定义域名 `scene.shangqing.site` **必须先完成网站 ICP 备案**，否则域名无法绑定、访问会被拦截。
- 不想备案就只能选**中国香港 / 新加坡**等境外地域，访问速度略差但免备案。
- 若前面再挂 CDN 加速，CDN 的**加速区域**同样受备案约束（选「中国境外」可免备案）。

### 1. 本地构建

```bash
pnpm install
pnpm build:static     # = scenes:snapshot + output: export，产物在 out/
```

检查产物：

```bash
ls out/index.html out/404.html out/data/scenes.json out/_next
```

### 2. 创建存储桶并上传

1. 控制台 → 对象存储 → 创建存储桶：地域按上面备案结论选，访问权限选**公有读私有写**。
2. 上传 `out/` 里的**内容**（不是 `out` 目录本身）到桶根目录。推荐用 COSCLI：

   ```bash
   coscli config init                      # 首次：填 SecretId / SecretKey
   coscli sync ./out/ cos://<桶别名>/ -r --delete
   ```

   注意 `-r` 同步目录内容、`--delete` 清掉旧版本残留的 hash 文件。

### 3. 开启静态网站

桶 → **基础配置 → 静态网站** → 开启：

- 索引文档：`index.html`
- 错误文档：`404.html`
- 本站只有首页一个路由（`trailingSlash: true`），**不需要**配 SPA 全站回退；把错误文档设成 `index.html` 反而会让不存在的资源也返回 200，掩盖真实 404。

### 4. 绑定域名

桶 → **域名与传输管理 → 自定义源站域名 → 添加域名**：

- 域名：`scene.shangqing.site`
- 源站类型：**静态网站源站**（不是默认源站，否则索引页/错误页规则不生效）

然后在 DNS 服务商（腾讯云 DNSPod / Cloudflare 等）给 `scene` 记录加 CNAME，指向控制台给出的那个 COS 域名。**同一主机名不能同时存在 A/AAAA 与 CNAME**，先把旧解析删掉：

```bash
dig CNAME scene.shangqing.site
curl -I http://scene.shangqing.site/
```

### 5. 开启 HTTPS

- COS 自定义域名支持**直接绑定证书**：先在「SSL 证书」申请/上传覆盖 `scene.shangqing.site` 的证书，再回到 COS 的自定义域名里选择该证书。
- 也可以走 CDN：域名 → CDN，回源到 COS 静态网站域名，证书绑在 CDN 上，DNS 指向 CDN 的 CNAME。CDN 还能按文件类型配缓存规则、做刷新预热。

验收：

```bash
curl -Iv https://scene.shangqing.site/            # 证书链覆盖该域名
curl -I https://scene.shangqing.site/data/scenes.json
```

### 6. 缓存与更新

- `_next/static/*` 带内容哈希，可长缓存：`Cache-Control: public,max-age=31536000,immutable`。
- `index.html`、`data/scenes.json` 用短缓存（如 `max-age=60`）或发布后刷新，否则改完数据用户可能还看到旧表。
- 走 CDN 时，覆盖上传不会自动失效缓存，需要「刷新预热 → URL/目录刷新」，常规生效时间约 5 分钟。

### 7. 已知的 COS 行为（容易踩）

- **2024-01-01 之后新建的桶**，用 COS 默认域名在浏览器打开网页文件会被强制下载（`Content-Disposition: attachment`），必须走自定义域名访问。
- COS 不会把 `/foo` 自动映射到 `/foo.html`；本项目静态产物是 `index.html` + `data/scenes.json` + `_next/*`，不依赖该行为。
- 纯静态站点没有后端：`out/api/scenes` 是构建期固化的一个静态 JSON 文件（`revalidate = 60` 在导出时被忽略）。前端在静态模式下会优先读 `/data/scenes.json`，两者内容一致。
- 页面字体走 `fonts.googleapis.cn`，属外部请求；若要完全自托管，可改为 `next/font` 本地字体（需要额外改动，未默认启用）。
- 同源部署无需 CORS；只有当 JSON 放在**另一个域名**的桶里时，才需要在那个桶配置「跨域访问 CORS」，Origin 填 `https://scene.shangqing.site`。

---

## 三、日常发布清单

```bash
# 1. 改完飞书表格后，重新快照 + 构建
pnpm build:static

# 2. 同步到桶（会自动删除旧 hash 文件）
coscli sync ./out/ cos://<桶别名>/ -r --delete

# 3. 若走 CDN，刷新首页与数据文件
#    CDN 控制台 → 刷新预热 → URL 刷新：https://scene.shangqing.site/ 、/data/scenes.json
```

参考文档：

- [Next.js 静态导出](https://nextjs.org/docs/app/guides/static-exports)
- [COS 设置静态网站](https://cloud.tencent.com/document/product/436/32670)
- [COS 开启自定义源站域名](https://cloud.tencent.com/document/product/436/36638)
- [COS 存储桶切换自定义域名及备案要求](https://cloud.tencent.com/document/product/436/102509)
- [COS 自定义域名 HTTPS 配置](https://cloud.tencent.com/document/product/436/11142)
- [COS 默认域名安全管理通知（强制下载）](https://cloud.tencent.com/document/product/436/96243)
- [COSCLI sync](https://cloud.tencent.com/document/product/436/63670)
- [COS 跨域访问 CORS](https://cloud.tencent.com/document/product/436/13318)
