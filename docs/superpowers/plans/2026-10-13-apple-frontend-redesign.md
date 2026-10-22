# Apple 风格前端重设计实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 uni-app 前端重做为 Apple 风格的轻量、克制、内容优先界面，同时保留推荐、AI 解析、拍照、问答和历史记录能力。

**Architecture:** 保留现有页面路由、组合式业务状态和云函数调用，只重做模板层级与 scoped 样式。首页采用白色工作台、顶部毛玻璃导航、两列首屏和三列菜谱网格；AI 助手、详情页、问答页共享同一套系统色、圆角、分隔线和动效令牌。

**Tech Stack:** uni-app、Vue 3 `<script setup>`、rpx/CSS、现有 GSAP H5 动效、现有 uniCloud API。

---

### Task 1: 建立 Apple 视觉令牌

**Files:**
- Modify: `App.vue`
- Modify: `uni.scss`
- Modify: `pages.json`

- [ ] 更新全局背景、文字、分隔线、系统蓝和状态色；保留平台字体栈，不引入新依赖。
- [ ] 将导航栏与页面背景统一为 `#f5f5f7`，导航文字设为深色。
- [ ] 运行 JSON 解析检查，确保配置仍可被 HBuilderX 读取。

### Task 2: 重做首页工作台

**Files:**
- Modify: `pages/index/index.vue`

- [ ] 将顶部品牌栏改为 Apple 风格毛玻璃导航，并增加“推荐 / 问一问”入口。
- [ ] 将首屏改成大标题、说明、主行动按钮、菜谱统计和右侧食材视觉区域。
- [ ] 将结果工具改为轻量分段控件和标签筛选，菜谱列表改为响应式网格。
- [ ] 增加页面滚动到规划表单的动作，不改变推荐请求逻辑。
- [ ] 为桌面、平板、移动端分别设置稳定的网格和触控尺寸。

### Task 3: 重做表单、菜谱和历史模块

**Files:**
- Modify: `components/PlannerForm.vue`
- Modify: `components/RecipeCard.vue`
- Modify: `components/HistoryPanel.vue`
- Modify: `components/EmptyState.vue`
- Modify: `components/ResultSkeleton.vue`
- Modify: `components/RecipeDetail.vue`

- [ ] 将表单改为白色分组卡片、圆角输入、系统蓝主按钮和清晰状态条。
- [ ] 将菜谱卡片改为图像/编号/用时/标签/步骤的内容层级，支持三列到单列响应式布局。
- [ ] 将历史记录改为 Apple Notes 风格的列表卡片。
- [ ] 将空状态、加载状态和详情弹层统一为同一套材质与动效。

### Task 4: 重做 AI 助手和问答页

**Files:**
- Modify: `components/AiAssistant.vue`
- Modify: `pages/qa/qa.vue`

- [ ] 将 AI 悬浮入口改为带标题的半透明胶囊，减少“孤立悬浮球”感。
- [ ] 将面板改为 iOS 底部 sheet：标题栏、消息流、快捷建议、输入栏和安全区适配。
- [ ] 将问答页改为同一套系统导航、消息气泡和输入区。
- [ ] 保持发送、拍照、清空、新对话和云端问答行为不变。

### Task 5: 验证

**Files:**
- Inspect: all modified `.vue`, `App.vue`, `uni.scss`, `pages.json`

- [ ] 运行 JSON 配置解析。
- [ ] 运行 Vue 标签配对和关键引用静态检查。
- [ ] 在 HBuilderX 中运行 H5 预览，检查 1440px、768px、390px 三种宽度。
- [ ] 验证 AI 面板展开、快捷语句、发送、表单推荐、详情弹层和问答入口。
