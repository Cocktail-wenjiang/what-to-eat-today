# AI 接入人性化体验实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 uni-app + uniCloud 主链路中加入自然语言需求解析、确认式回填和生活化推荐说明，同时保留规则推荐与离线降级。

**Architecture:** 页面通过 `api/client.js` 调用新的 `aiParseRequest` uniCloud 云函数。云函数优先使用可选的大模型环境变量配置，失败时使用纯 JavaScript 关键词解析，返回标准化表单字段和确认文案。推荐云函数在每个结果中生成结构化的 `reason`，客户端将其展示在菜谱卡片中。AI 解析失败不阻断原表单推荐。

**Tech Stack:** uni-app / Vue 3, uniCloud 阿里云云函数, JavaScript, Node.js contract tests.

---

### Task 1: 增加 AI 解析云函数

**Files:**
- Create: `uni-app/uniCloud-aliyun/cloudfunctions/aiParseRequest/index.js`
- Create: `uni-app/uniCloud-aliyun/cloudfunctions/aiParseRequest/package.json`

- [ ] 实现输入校验、关键词解析、可选模型调用和标准响应。
- [ ] 返回 `fields`、`confidence`、`summary`、`source`，模型失败时返回 fallback。
- [ ] 不把密钥或模型请求放到客户端。

### Task 2: 扩展 uniCloud 客户端接口

**Files:**
- Modify: `uni-app/api/client.js`

- [ ] 增加 `parseNaturalLanguage`，调用 `aiParseRequest` 并处理超时/错误。
- [ ] 保持云函数、直连、本地推荐链路不变。
- [ ] 增加统一生活化理由生成的本地兜底方法。

### Task 3: 增强推荐结果契约

**Files:**
- Modify: `uni-app/uniCloud-aliyun/cloudfunctions/recommend/index.js`
- Modify: `uni-app/api/client.js`

- [ ] 为每个结果增加 `reason` 和 `fitTags`。
- [ ] 历史快照继续保存完整结果，兼容旧记录。
- [ ] 客户端本地规则结果也生成同样字段。

### Task 4: 增加自然语言输入与确认交互

**Files:**
- Modify: `uni-app/components/PlannerForm.vue`
- Modify: `uni-app/pages/index/index.vue`
- Modify: `uni-app/composables/useRecommendation.js`

- [ ] 增加日常表达输入框和快捷语句。
- [ ] 增加解析中、解析成功、解析失败状态。
- [ ] 解析结果以“我理解的是”展示，允许用户继续编辑后提交。
- [ ] 将解析字段回填现有表单，不改变原校验规则。

### Task 5: 展示生活化推荐说明

**Files:**
- Modify: `uni-app/components/RecipeCard.vue`

- [ ] 展示推荐理由和匹配标签。
- [ ] 对旧数据没有 `reason` 时使用客户端生成的兼容文案。
- [ ] 保持移动端布局和现有详情入口。

### Task 6: 测试与文档

**Files:**
- Create: `tools/test_ai_parse_function.mjs`
- Modify: `uni-app/README.md`

- [ ] 覆盖自然语言关键词解析、边界截断、模型失败回退。
- [ ] 运行既有推荐契约测试。
- [ ] 运行前端构建。
- [ ] 补充 uniCloud 环境变量和部署说明。

