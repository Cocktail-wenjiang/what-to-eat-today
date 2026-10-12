# 实验一架构落地说明

项目采用实验一确定的 Python + FastAPI、UniApp（Vue3）用户端、Vue3 + Element Plus 管理后台、LangChain + 第三方模型 API、Supabase、阿里云 OSS、Render 架构。

当前实验四 MVP 先用本地 SQLite 代替 Supabase，使用规则推荐代替模型调用，接口和模块边界保持一致。这样可离线启动、复测，并且后续仅需替换数据仓库和 ModelGateway 实现。

## 实时推送通道（SSE）

用户端与管理后台共用一套服务端单向推送通道，均基于 Server-Sent Events。选择 SSE 而非 WebSocket 的依据：两端场景本质都是「服务端 → 客户端」单向事件流，SSE 基于 HTTP、浏览器原生支持自动重连，实现与部署成本更低。

| 端点 | 方法 | 用途 | 消费方 |
| --- | --- | --- | --- |
| `/api/recommend/stream` | POST | 逐帧下发匹配进度与菜谱 | 用户端（`api/client.js` 的 `requestRecommendationStream`） |
| `/api/admin/stream` | GET | 广播推荐事件，供后台监控 | 管理后台监控页（`admin/index.html`，EventSource） |

用户端采用 POST + `fetch` + `ReadableStream` 而非 `EventSource`：推荐是一次性创建操作、参数需放在请求体，且一次性请求不需要自动重连（重连会导致重复推荐）。管理后台采用 `EventSource`：它是需要长期保活与断线重连的只读订阅。

### 事件流转

1. 用户端 POST `/api/recommend/stream`，后端按 `start -> recipe* -> done` 顺序产出事件；
2. 每帧写入 `app/events.py` 的进程内事件总线（`EventBus.publish`）；
3. 管理后台订阅者队列收到广播，经 `/api/admin/stream` 实时下发。

### 降级策略

前端 `requestRecommendationStream` 抛错时，`useRecommendation` 自动降级到 `requestRecommendation`（后端同步 → 本地种子兜底），保证实时通道不可用时页面依然可用，仅通道标识从「实时推送」变为「后端服务」或「本地兜底」。

### 边界与演进

- `EventBus` 为单进程内存实现，仅在单实例部署下有效；多实例部署时替换为 Redis Pub/Sub 或消息队列，`subscribe` / `publish` 契约保持不变；
- 单个订阅者缓冲上限 100 条，溢出时丢弃最旧事件，保证发布方永不阻塞；
- `/api/recommend`（同步版）保留兼容，与流式版共用 `services._match_recipes` 匹配逻辑，两条链路结果一致。
