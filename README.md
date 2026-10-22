# uniCloud 迁移部署指南（HBuilderX）

> 本文档面向「**我生成代码，你用 HBuilderX 部署**」的协作方式：
> 本工程已迁出原仓库，独立存放在
> `E:\Project\HBuilderX_Project\今天吃什么`（HBuilderX 项目名 `今天吃什么`），
> 你只需按下面的步骤在 HBuilderX 里上传云函数、导入数据、运行。
>
> 生成数据与跑测试的脚本仍留在原仓库 `E:\软件应用开发\tools\`，
> 它们会自动定位到本工程目录（解析逻辑见 `tools/uni_app_paths.mjs`）。

---

## 当前部署状态（2026-10-12 已完成）

以下步骤均已执行完毕，下面的部署章节可作为**重新部署时的操作手册**：

| 步骤 | 状态 | 说明 |
|---|---|---|
| 工程导入 HBuilderX | ✅ | 项目名 `今天吃什么` |
| 关联云服务空间 | ✅ | `myspace` / `mp-67cd4ac5-6d7a-4db2-b4f2-5b114b2ead32` |
| 上传 DB Schema | ✅ | `recipes`、`recommendation_history` 两个集合已创建 |
| 导入菜谱数据 | ✅ | **110 条**（`R-001`…`R-110`），云端实测 58.5 KB |
| 上传云函数 | ✅ | `recommend`、`aiParseRequest`、`stats` 三个均已部署 |
| 模型环境变量 | ⬜ 未配置 | 只需配 `DASHSCOPE_API_KEY` 即启用；不配走关键词解析（识图不可用） |

云端实地核对结果（由 `stats` 云函数返回）：

```json
{ "recipes": { "count": 110, "complete": true, "missing": 0,
               "firstId": "R-001", "lastId": "R-110", "avgSteps": 4.52 },
  "storage": { "percent": 0.00279, "exceeded": false, "level": "ok" } }
```

---

## 0. 这次迁移做了什么

原链路是 `Vue3 + FastAPI + Supabase`，现在整体搬到 **uni-app + uniCloud（阿里云）**：

| 项目 | 迁移前（Supabase） | 迁移后（uniCloud） |
|---|---|---|
| 前端 | Vue 3 + Vite（Web） | **uni-app**（一套代码跑 H5 / 小程序 / App） |
| 菜谱数据 | Supabase `recipes` 表（PostgreSQL） | uniCloud `recipes` 集合（文档型） |
| 历史记录 | Supabase `recommendation_history` 表 | uniCloud `recommendation_history` 集合 |
| 推荐计算 | FastAPI `services.py` / Supabase Edge Function | **uniCloud 云函数 `recommend`** |
| 权限控制 | RLS 策略 | **DB Schema** 的 `permission` 配置 |
| 离线兜底 | `frontend/public/data/recipes.json` | 本工程 `static/data/recipes.json` |

**服务空间信息（已续费）**

- 服务空间名称：`myspace`
- SpaceID：`mp-67cd4ac5-6d7a-4db2-b4f2-5b114b2ead32`
- 供应商：阿里云

**降级链（三级，任一可用即不白屏）**

```
① uniCloud 云函数 recommend   （云端计算 + 自动写历史）
        ↓ 失败
② uniCloud 数据库直连 + 本地规则（云函数没部署 / 额度用尽时仍可用）
        ↓ 失败
③ 本地内置 recipes.json + 本地规则（彻底断网也能演示）
```

---

## 1. 目录结构

本工程即当前目录（`E:\Project\HBuilderX_Project\今天吃什么`）：

```
今天吃什么/
├── manifest.json                       # 应用配置（appid / vueVersion / h5 router）
├── pages.json                          # 页面路由与导航栏样式
├── main.js                             # createSSRApp 入口
├── App.vue                             # 全局样式 + uniCloud.init（非 H5 端）
├── index.html                          # H5 模板
├── uni.scss                            # 全局 SCSS 设计令牌（与 Web 端同源）
├── .gitignore
│
├── pages/index/index.vue               # 首页：Hero + 表单 + 结果 + 历史
│
├── components/
│   ├── AiAssistant.vue                 # AI 助手悬浮窗（悬浮球 + 弹出面板：一句话 / 拍照识图）
│   ├── PlannerForm.vue                 # 需求表单（人数 / 用时 / 忌口 / 口味，接收 AI 回填结果）
│   ├── RecipeCard.vue                  # 菜谱卡片（含推荐理由与命中标签）
│   ├── RecipeDetail.vue                # 菜谱详情弹窗（完整食材 + 全部步骤）
│   ├── HistoryPanel.vue                # 推荐历史（可折叠）
│   ├── EmptyState.vue                  # 空状态 + 放宽建议
│   └── ResultSkeleton.vue              # 加载骨架屏
│
├── composables/
│   └── useRecommendation.js            # 状态机 + 表单校验 + 草稿持久化 + 文本 / 图片解析
│
├── api/
│   ├── client.js                       # 统一接口（推荐三级降级 + 文本 / 图片解析）
│   └── ruleEngine.js                   # 本地规则推荐（与云函数同语义）
│
├── utils/
│   ├── validators.js                   # 表单校验（与云函数 validate 对齐）
│   ├── image.js                        # 拍照/选图 → 压缩 → data URL（识图入参）
│   └── format.js                       # 时间 / 序号 / 匹配口径文案
│
├── static/data/recipes.json            # 110 道菜谱（离线兜底，自动生成）
│
└── uniCloud-aliyun/                    # ← 云空间代码目录（HBuilderX 识别）
    ├── database/
    │   ├── recipes.schema.json         # 菜谱集合结构与权限
    │   ├── recommendation_history.schema.json
    │   └── recipes.json                # ← 110 行 JSON Lines，控制台「导入」用
    └── cloudfunctions/
        ├── recommend/
        │   ├── index.js                # 推荐云函数（结果为每条附 reason / fitTags）
        │   └── package.json
        ├── aiParseRequest/
        │   ├── index.js                # 文本 / 图片需求解析（模型 + 识图 + 关键词回退）
        │   └── package.json
        └── stats/
            ├── index.js                # 云端数据核对（条数/齐全性/实测字节/阈值）
            └── package.json
```

> 数据文件由 `tools/generate_recipes.mjs` 统一生成，**不要手工编辑**。
> 改菜谱：改 `tools/recipes_dataset.mjs`（主数据）和 `tools/recipes_steps.mjs`（步骤），
> 然后运行 `node tools/generate_recipes.mjs` 重新同步。

---

## 2. HBuilderX 部署步骤

### 第 1 步：导入项目

1. 打开 HBuilderX → **文件 → 打开目录** → 选择 `E:\Project\HBuilderX_Project\今天吃什么`
2. 左侧项目树应出现 `uniCloud-aliyun` 目录（若没有，说明目录名或层级不对）

### 第 2 步：关联云服务空间

1. 在项目树中**右键 `uniCloud-aliyun`** → **关联云服务空间或项目**
2. 选择服务空间 `myspace`（SpaceID `mp-67cd4ac5-6d7a-4db2-b4f2-5b114b2ead32`）
3. 关联成功后，`uniCloud-aliyun` 会显示为已关联状态

> 如果列表里没有 `myspace`，点「**新建云服务空间**」或先在
> [uniCloud 控制台](https://unicloud.dcloud.net.cn/) 确认服务空间已续费、未过期。

### 第 3 步：上传数据库 Schema（建集合 + 设权限）

1. 展开 `uniCloud-aliyun → database`
2. 选中 `recipes.schema.json` 和 `recommendation_history.schema.json`
3. **右键 → 上传 DB Schema**
4. 上传成功后，控制台左侧「云数据库」里会出现 `recipes`、`recommendation_history` 两个集合

**权限说明（写死在 schema 里，不需要手动配）**

| 集合 | read | create | update | delete |
|---|---|---|---|---|
| `recipes` | ✅ 所有人可读 | ❌ | ❌ | ❌ |
| `recommendation_history` | ✅ 所有人可读 | ✅ 所有人可写 | ❌ | ❌ |

> `recipes` 只允许读，保证菜谱库不被前端篡改；
> `recommendation_history` 允许前端写入，这样「云函数没部署」时直连降级也能记历史。

### 第 4 步：导入 110 道菜谱数据

1. 打开 [uniCloud 控制台](https://unicloud.dcloud.net.cn/) → 选择 `myspace` 服务空间
2. 左侧 **云数据库** → 选择 `recipes` 集合
3. 点 **导入** → 选择文件 `uniCloud-aliyun/database/recipes.json`（在本工程目录下）
4. 文件格式选 **JSON Lines**（每行一个 JSON 对象），冲突处理选 **合并（upsert）**
5. 导入完成后，`recipes` 集合应有 **110 条**记录，`_id` 形如 `R-001` … `R-110`

> **为什么用 JSON Lines**：uniCloud 控制台导入支持 JSON Lines / CSV。
> 我们的文件每行一个菜谱对象，并显式带了 `_id`，所以**重复导入是安全的**
> （同 `_id` 会覆盖而非重复插入）。

**验证**：在 `recipes` 集合里筛选 `_id == "R-001"`，应看到「微波蒸蛋」，`steps` 数组有 5 个元素。

#### 导入后如何核对（推荐用 `stats` 云函数）

本地脚本只能估算，**真实条数与字节要问云端**。项目自带核对云函数 `stats`：

1. HBuilderX 里**右键 `uniCloud-aliyun/cloudfunctions/stats`** → **上传部署**
2. 再右键 `stats` → **运行（运行测试）**，测试参数填：
   ```json
   {"expected": 110}
   ```
   （或在 uniCloud 控制台 → 云函数 → `stats` → 云端运行，参数同上）
3. 返回结果解读：

| 字段 | 含义 |
|---|---|
| `recipes.count` | 云端实际条数（**应为 110**） |
| `recipes.complete` | 是否达到 `expected`；`false` 说明还没导全 |
| `recipes.missing` | 还差几条 |
| `recipes.firstId` / `lastId` | 首尾 `_id`（应 `R-001` / `R-110`） |
| `recipes.avgSteps` | 平均步骤数（应 ≥ 4） |
| `recipes.jsonBytes` | **实测** JSON 字节（服务端逐条统计，比本地估算权威） |
| `storage.percent` / `exceeded` | 存储使用率 / 是否超 3/4 |

> `stats` 读的是**云端真实数据**，所以它是「导入是否成功」的权威判据；
> 而 `tools/monitor_cloud_storage.mjs` 读本地文件、用于**写入前预防**。两者互补。

### 第 5 步：上传云函数

三个云函数都要上传（`recommend` 推荐、`aiParseRequest` 自然语言解析、`stats` 云端核对）：

1. 展开 `uniCloud-aliyun → cloudfunctions`
2. **右键 `recommend` 目录 → 上传部署**
3. **右键 `aiParseRequest` 目录 → 上传部署**
4. **右键 `stats` 目录 → 上传部署**（若第 4 步已上传可跳过）
5. 等待右下角提示「上传成功」

> 云函数依赖的 `package.json` 已就绪（无第三方依赖，纯 Node 原生）。
> 阿里云版会在你首次上传时自动初始化运行环境。
> **`aiParseRequest` 不配任何环境变量也能用**——文字解析会走内置关键词规则；
> 但**拍照识图必须配模型密钥**（关键词规则替代不了识图）。见第 6 节。

### 第 6 步：运行到浏览器

1. HBuilderX 顶部菜单 **运行 → 运行到浏览器 → Chrome**
2. 首次运行会编译，等待控制台出现 `vite v5 ... dev server running at`
3. 页面加载后应看到：
   - Hero 区显示「**110** 道可做菜谱」
   - 提交表单后返回 3 道菜谱
   - 右下角有 **AI 悬浮球**（点开可输入一句话或拍照）

> **界面约定（重要）**：面向用户的界面**只呈现产品信息**，
> 不显示数据链路、云端配额、集合名、接口原始报错等实现细节。
> 排查用的链路信息一律走浏览器控制台（`[channel]` / `[pool]` / `[history]` 前缀）。

---

## 3. 验证清单

部署完成后逐项对照：

- [ ] `uniCloud-aliyun` 已关联服务空间 `myspace`
- [ ] `recipes` 集合有 **110** 条记录，`_id` 为 `R-001` ~ `R-110`
- [ ] `recommendation_history` 集合已创建（初始为空）
- [ ] `recommend` / `aiParseRequest` / `stats` 三个云函数均上传成功
- [ ] 运行到浏览器后，Hero 显示「110 道可做菜谱」
- [ ] 界面上**不出现**任何链路 / 配额 / 集合名 / 接口原始报错等实现细节
- [ ] 选择「清淡 / 30 分钟」提交 → 返回 3 道菜谱，均 ≤30 分钟且含「清淡」标签
- [ ] 每张卡片显示推荐理由（「适合这次安排：…」）与命中标签（如「30分钟内」「清淡」）
- [ ] 点右下角 AI 悬浮球 → 输入「两个人吃，清淡点，30分钟内，不要花生」→ 点「帮我解析」
      → 悬浮窗自动收起，表单被自动填好，表单上方出现理解结果提示条
- [ ] 点悬浮球 → 点「拍照识图」选一张菜或食材的照片 → 出现缩略图，表单被自动填好
      （未配模型环境变量时，这一步会提示「暂时没能认出这张图」——属预期行为）
- [ ] 点击「查看完整做法」→ 弹窗显示完整食材与 **全部步骤**（≥4 步）
- [ ] uniCloud 控制台 → `recommendation_history` 集合 → 出现新记录
- [ ] 「最近推荐」面板显示刚生成的记录，可点「用这组条件」重新推荐

### 验证降级链（可选，但建议做一次）

链路切换**不再在界面上提示**（属实现细节），改为看浏览器控制台：

1. **关掉云函数**：控制台 → 云函数 → `recommend` → 停用
   → 刷新页面，控制台出现 `[channel] 云函数不可用，尝试降级：`，推荐仍可用
2. **再断网**（或临时把 `api/client.js` 的 `ENABLE_DB_DIRECT` 改成 `false`）
   → 控制台出现 `[channel] 云库直连不可用，尝试降级：`，
   推荐仍可用（读 `static/data/recipes.json`）

---

## 4. 常见问题

**Q：Hero 显示「— 道可做菜谱」？**
A：说明菜谱池没读到（界面不会提示具体原因，属预期行为）。按顺序查：
1. `recipes` 集合是否已导入 110 条？
2. `recipes.schema.json` 是否已上传？（没上传集合不存在，读会直接报错）
3. `uniCloud-aliyun` 是否已关联 `myspace`？
4. 打开浏览器控制台看 `[pool]` / `[channel]` 开头的告警，里面有具体原因。

**Q：报错 `FUNCTION_NOT_FOUND` / `云函数不存在`？**
A：`recommend` 云函数没上传成功。右键 `recommend` 目录 → 上传部署。
（不影响使用，会自动降级到直连通道。）

**Q：点「帮我解析」提示「当前环境未启用 uniCloud」或解析无反应？**
A：`aiParseRequest` 云函数没上传。右键 `aiParseRequest` 目录 → 上传部署。
（不影响使用，用户仍可直接填表提交推荐。）

**Q：解析出来的口味/人数不对？**
A：没配模型环境变量时走的是内置关键词规则，它只认「N个人」「N分钟」
「清淡/高蛋白/素食/快捷」「不要/不吃 XX」这几类表达，对口语容错有限。
配好第 6 节的 `DASHSCOPE_API_KEY` 后改由大模型解析，容错明显更好。
无论哪种，解析结果都只是**回填到表单**，你可以改完再提交。

**Q：点「拍照识图」提示「暂时没能认出这张图」？**
A：两种可能——没配模型环境变量（识图必须依赖多模态模型，关键词规则替代不了），
或者模型服务不可达。先确认第 6 节的环境变量已配，再看云函数日志里的
`[aiParseRequest]` 告警。识图失败**不会**假装成功，也不会阻断你手工填表。

**Q：报错 `当前环境未启用 uniCloud`？**
A：`uniCloud-aliyun` 目录没关联服务空间。回到第 2 步。

**Q：导入数据报错「_id 不合法」？**
A：确认选的是 **JSON Lines** 格式，且 `_id` 字段是字符串（`"R-001"`，带引号）。
文件由脚本生成，格式是对的；若你手改过请重新运行 `node tools/generate_recipes.mjs`。

**Q：为什么 `count()` 取 `res.total`，而页面里取 `res.result.total`？**
A：uniCloud 两个端返回结构不同（官方文档 `clientdb.html` 明确说明
「database 接口返回的数据结构多了一层 result」）：

| 位置 | `.get()` | `.count()` | `.add()` |
|---|---|---|---|
| 云函数端（服务端） | `res.data` | `res.total` | `res.id` |
| 客户端（页面里） | `res.result.data` | `res.result.total` | `res.result.id` |

本项目里：`uniCloud-aliyun/cloudfunctions/recommend/index.js` 走服务端结构，
`api/client.js` 走客户端结构。**改代码时别把两者搞混**。

**Q：菜谱超过 100 条会不会读不全？**
A：不会。uniCloud 单次查询默认上限 100 条，云函数和 `api/client.js` 都做了
`skip/limit` 分批拉取（`tools/test_uni_cloud_function.mjs` 有 250 条的回归用例）。

---

## 5. 本地回归测试（不需要云空间）

改完代码后，可以先在本地跑一遍纯逻辑测试，确认推荐语义没被改坏。

> 测试脚本与 `package.json` 在**原仓库** `E:\软件应用开发`，
> 它们会通过 `tools/uni_app_paths.mjs` 自动定位到本工程目录，无需手工改路径。

```bash
cd E:\软件应用开发

# 1) 数据校验 + 同步四处数据文件
node tools/generate_recipes.mjs

# 2) 云函数契约测试（mock uniCloud，覆盖校验/筛选/降级/分批/容错）
node tools/test_uni_cloud_function.mjs

# 3) 核对云函数 stats 的契约测试（条数/齐全性/实测字节/阈值）
node tools/test_stats_function.mjs

# 4) 需求解析云函数契约测试（关键词 / 边界收敛 / 模型 / 识图 / 回退）
node tools/test_ai_parse_function.mjs

# 或一次跑完（等价于 npm test）
npm test
```

上面四个脚本**全部不联网**。要验证真实网关是否可用，另跑真机探针
（需要环境变量 `DASHSCOPE_API_KEY`，见第 6 节）：

```bash
npm run probe:ai
```

四个脚本都通过，说明云函数与数据没问题，再上传 HBuilderX 即可。

> 第 4 个测试会在进程内摘掉 `DASHSCOPE_API_KEY`、`AI_API_KEY` 等环境变量并替换
> `globalThis.fetch`，保证无论开发机是否配置了模型密钥，测试都**不会真的发网络请求**，
> 且模型成功 / 失败两条分支都可复现。

---

## 6. 需求解析（`aiParseRequest`）

首页右下角有一个常驻的 **AI 悬浮球**（墨色圆形按钮，避开品牌标记的番茄红，避免被误认为重复的品牌位）。
点开后弹出居中面板，提供两种输入方式：

- **一句话**：输入文字后点「帮我解析」，或点四条快捷语句直接触发；
- **拍照识图**：点「拍照识图」拍照或从相册选图，识别食材 / 菜品后回填条件。

两种方式解析出的 `{ servings, max_minutes, preference, allergy }` 都会**回填表单**，
用户确认后再提交推荐——解析本身不触发推荐，也不写入历史。

**交互闭环**：解析成功后悬浮窗**自动收起**并滚动到表单，理解结果以提示条形式挂在表单上方
（9 秒后自动消失）；解析失败则悬浮窗**保持打开**并就地显示原因，用户可立刻重试或直接手工填表。

> 悬浮窗的可见性由页面持有（`aiOpen`），而不是组件内部状态——因为「成功即收起」必须由页面
> 在拿到解析结果之后决定。组件只负责输入与呈现，图片编码与云端请求仍归 `useRecommendation`。

**三条解析路径**（云函数内部自动选择，客户端无感）：

| 路径 | 触发条件 | 返回 `source` | 附带字段 |
|---|---|---|---|
| 文本 + 大模型 | 配好密钥，且只传文字 | `model` | — |
| 图片 + 多模态模型 | 配好密钥，且传了图片 | `vision` | `recognized.dish` / `recognized.ingredients` |
| 关键词解析 | 未配置模型 / 请求失败 / 返回非法 JSON（**仅限纯文字**） | `keyword-fallback` | — |

> `source` 与 `recognized` 都是**内部字段**，只用于控制台排查与文案拼装，
> 界面不展示，也不会渲染成「AI 理解 / 关键词理解」之类的标签。

### 启用大模型解析（可选）

在 **uniCloud 控制台 → 云函数 → `aiParseRequest` → 环境变量** 添加密钥即可。
**只需要配密钥这一个变量**，地址与模型都有默认值（千问网关 + `qwen3.8-omni-flash`）：

| 变量名 | 必填 | 说明 | 缺省值 |
|---|---|---|---|
| `DASHSCOPE_API_KEY` | 是 | 模型服务密钥（兼容旧名 `AI_API_KEY` / `OPENAI_API_KEY`） | — |
| `AI_API_URL` | 否 | OpenAI 兼容协议地址（兼容旧名 `OPENAI_BASE_URL`） | `https://maas.qianwenaiapi.com/compatible-mode/v1` |
| `AI_MODEL` | 否 | 模型名 | `qwen3.8-omni-flash` |
| `AI_NATIVE_BASE_URL` | 否 | 千问原生接口前缀，仅识图兜底用 | `https://maas.qianwenaiapi.com/api/v1` |

> 模型名说明：原缺省值 `qwen3.8-flash` 在本账号下调用返回 403 `AccessDenied.Unpurchased`（未开通），
> 会让问答与解析全部失败。实测同密钥下仅 `qwen3.8-omni-flash` 可用，故切换为它。
> 若在网关后台开通了其它模型，改 `AI_MODEL` 即可，无需改代码。

**不配置也能用**——会走关键词解析（但关键词解析**替代不了识图**，见下）。
密钥只存在于云端环境变量，**不会下发到客户端**，也不进客户端打包产物。

> **关于云端 Node 版本**：阿里云云函数运行时当前是 **Node 16**，
> 而全局 `fetch` 要 Node 18+ 才有。`aiParseRequest` 已做双路径适配——
> 优先用 `fetch`，没有则退回 uniCloud 内置的 `uniCloud.httpclient`，
> 因此**不需要**为了模型解析去改运行时版本。

### 为什么关掉了深度思考

`enable_thinking` 显式设为 `false`。原因有二：

1. 结构化解析需要 `response_format: {type:'json_object'}` 强约束输出，
   而思考模式下部分模型不接受该参数，会直接报错或退化成纯文本；
2. 把一句话映射成四个字段不需要推理链，关闭后延迟明显更低。

若网关仍然拒绝 `response_format`（返回 400），云函数会**自动去掉该参数重试一次**；
再失败才回退关键词解析。模型输出带 ```json 围栏、或前后夹带解释文字，都能被正确提取。

### 拍照识图的实现要点

- **图片编码在客户端**：`utils/image.js` 负责选图、按需压缩、转 data URL。
  超过 600 KB 会按 60 → 40 的力度递进压缩，仍超限则提示换一张小图（不把超限数据发到云端）。
  压缩分两条实现——小程序 / App 用 `uni.compressImage`，H5 用 canvas 降采样
  （`uni.compressImage` 在 H5 不可用，而手机直出原图常达数 MB，不做这一步会一律撞上限）。
- **云端两条协议**：先走 OpenAI 兼容协议的 `image_url` + data URL；
  若网关/模型对图片入参支持不一致而失败，自动改用千问原生多模态接口兜底。
- **失败不静默降级**：识图失败会返回 error 并提示「暂时没能认出这张图」，
  **不会**退化成关键词结果——否则用户会误以为照片被识别了，条件其实是猜的。

### 实测结论（2026-10-12 真机联调）

`npm run probe:ai` 会加载**云函数源码本体**去打真实网关（而非重新实现一遍），
因此结论可直接代表生产行为：

| 项 | 实测结果 |
|---|---|
| 文本解析 | HTTP 200，`source = model`；`response_format` 与 `enable_thinking:false` **均被接受**（未触发 400 重试） |
| 识图 | HTTP 200，`image_url` + base64 data URL **被接受**（未触发原生接口兜底） |
| 耗时 | 文本 3.5 ~ 7.1 s；识图 3.7 ~ 4.7 s |
| 识别质量 | 真实菜品图 → 菜品「香煎豆腐时蔬能量碗」+ 8 项食材，口味自动推断为「高蛋白」 |

两个由此得出的结论：

1. **模型仍会给输出套 ```json 围栏**，即便已经设了 `response_format: json_object`。
   所以 `extractJson()` 的围栏剥离是**必需逻辑，不是冗余防御**。
2. 文本解析实测最慢 **7.1 s**，因此客户端超时由 8 s 提到 **25 s**（`AI_PARSE_TIMEOUT_MS`）。
   原先复用 `TIMEOUT_MS = 8000`，首次调用叠加冷启动已逼近上限，会被误判成「网络不太顺畅」。

想校验识别质量（例如换了模型），加 `--image` 指定一张真实菜品图：

```bash
cd E:\软件应用开发
npm run probe:ai -- --image "E:/path/to/dish.jpg"
```

### 字段边界（与 `validators.js`、`recommend.validate()` 三处一致）

| 字段 | 范围 | 说明 |
|---|---|---|
| `servings` | 1 ~ 20 整数 | 模型返回越界值会被收敛 |
| `max_minutes` | **5 ~ 240** 整数 | 低于 5 会被抬到 5（否则 `recommend` 会拒绝） |
| `preference` | 清淡 / 高蛋白 / 素食 / 快捷 / 不限 | 未知值回退「不限」 |
| `allergy` | ≤ 30 字 | 超长截断 |
| `recognized.dish` | ≤ 20 字 | 仅识图分支返回 |
| `recognized.ingredients` | 最多 8 项，每项 ≤ 12 字 | 仅识图分支返回 |
| 输入文本 | ≤ 120 字 | 超长截断 |
| 输入图片 | ≤ 900 KB（data URL 字符数） | 超限返回「图片有点大」 |

### 解析失败时

**不会阻断推荐**。解析失败只在输入框下方显示提示，用户仍可直接填写表单并提交。

---

## 7. 云端存储用量监控（不超过 3/4）

项目内置了一道「存储闸门」，保证写入云端的菜谱数据**不超过配额的 3/4**。

**配额基准**（阿里云免费服务空间，见 [官方价格页](https://doc.dcloud.net.cn/uniCloud/price.html)）：

| 资源 | 额度 |
|---|---|
| 云数据库 容量 | **2 GB** ← 本项目菜谱 / 历史所在 |
| 云存储 容量 | 5 GB（本项目未使用） |
| 集合数量上限 | 100 |

**阈值 = 75% × 2 GB = 1.5 GB**，超过即告警并阻断写入。

### 两种监控方式

> 同样在原仓库 `E:\软件应用开发` 下执行。
> **用量面板只服务运维，已从用户界面移除**——终端用户不需要看到配额与集合名。

```bash
cd E:\软件应用开发

# 1) 单次检测（含进度条与 75% 阈值线）
node tools/monitor_cloud_storage.mjs

# 2) 实时监控：每 5 秒刷新一次（Ctrl+C 退出）
npm run watch:storage
# 等价于 node tools/monitor_cloud_storage.mjs --watch 5

# 3) 其他用法
node tools/monitor_cloud_storage.mjs --history 2000   # 附带历史集合估算
node tools/monitor_cloud_storage.mjs --json           # 机器可读，便于自动化
node tools/monitor_cloud_storage.mjs --fail-on-warn   # 超阈值时以退出码 1 结束
```

**云端实地核对**：部署 `cloudfunctions/stats` 并运行，返回条数 / 齐全性 /
实测字节 / 阈值判定，是最权威的口径。

**结构性闸门**：`tools/generate_recipes.mjs` 在写入任何数据文件**之前**先做估算，
一旦预计超过 3/4 就立即 `exit(1)` 中止，**不会产生半成品文件**。
所以「不超 3/4」不靠人工自觉，而是流程强制的。

> 口径说明：脚本统计的是项目侧数据文件的真实字节数，再按 BSON 开销（+8%）
> 与索引摊销折算，属**保守估算（偏高）**。真实占用以 uniCloud 控制台
> 「服务空间 → 资源用量监控」为准，两者通常同量级。
>
> 配额常量集中在 `tools/cloud_storage_quota.mjs`（Node 侧单一事实来源），
> 云函数 `stats/index.js` 内有同值副本，**改配额或阈值时两处必须同步**。

---

## 8. 与旧链路的对应关系

若你想对照旧实现，各模块的对应关系如下（新文件路径均相对**本工程根目录**）：

| 旧文件（Supabase 版） | 新文件（uniCloud 版） |
|---|---|
| `frontend/src/App.vue` | `pages/index/index.vue` |
| `frontend/src/components/*.vue` | `components/*.vue` |
| `frontend/src/composables/useRecommendation.js` | `composables/useRecommendation.js` |
| `frontend/src/api/client.js` | `api/client.js` |
| `frontend/src/api/ruleEngine.js` | `api/ruleEngine.js` |
| `frontend/src/utils/validators.js` | `utils/validators.js` |
| `frontend/src/utils/format.js` | `utils/format.js` |
| `supabase/functions/recommend/index.ts` | `uniCloud-aliyun/cloudfunctions/recommend/index.js` |
| （无对应，新增能力） | `uniCloud-aliyun/cloudfunctions/aiParseRequest/index.js` |
| （无对应，新增能力） | `uniCloud-aliyun/cloudfunctions/stats/index.js` |
| `supabase/schema.sql`（建表 + RLS + 数据） | `uniCloud-aliyun/database/*.schema.json` + `recipes.json` |

**推荐语义完全保留**（`tools/test_uni_cloud_function.mjs` 有回归用例）：

- `minutes <= max_minutes` —— 硬性上限
- `allergy` 对 `ingredients + tags` 做子串匹配 —— 硬性排除
- `preference` 命中则 `mode = recommend-cloud`，无命中则放开口味兜底 `mode = rule-fallback`
- 结果按用时升序，最多 3 条，稳定的推荐顺序
