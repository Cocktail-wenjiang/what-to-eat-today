# 市集杂志感移动端前端重设计实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 Vue 3 “今天吃什么”推荐页改造成移动端优先的市集杂志风格，并接入可清理、尊重减弱动效偏好的 GSAP 动画。

**Architecture:** 保持现有推荐组合式函数与组件事件契约不变，集中改造全局设计令牌、App 页面骨架、表单/卡片/详情的局部样式；GSAP 只在 App 根组件中通过 `gsap.context` 管理首屏和结果列表动画。

**Tech Stack:** Vue 3、Vite、GSAP 3、CSS media queries、现有 FastAPI/API 适配层。

---

### Task 1: 安装动画依赖并更新全局设计令牌

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/style.css`

- [ ] **Step 1: 添加 GSAP 运行时依赖**

在 `frontend/package.json` 的 `dependencies` 中加入 `"gsap": "^3.13.0"`，然后运行 `pnpm install` 更新锁文件。

- [ ] **Step 2: 替换全局主题变量和基础布局**

把 `frontend/src/style.css` 更新为纸张底色、番茄红、橄榄绿和深墨色令牌，增加背景纹理、Fraunces 字体加载、统一按钮焦点态、移动端安全区和减弱动效规则。保留 `.app-shell`、`.topbar`、`.page-wrap`、`.footer` 等现有公共选择器，避免组件结构断裂。

- [ ] **Step 3: 构建检查**

运行 `pnpm --dir frontend build`，预期 Vite 输出成功且无模块解析错误。

### Task 2: 改造 App 首屏结构并接入 GSAP

**Files:**
- Modify: `frontend/src/App.vue`

- [ ] **Step 1: 引入 GSAP 生命周期依赖**

在 `<script setup>` 中引入 `onUnmounted`、`nextTick` 已有依赖和 `{ gsap } from 'gsap'`，增加 `appRef`、`animationContext`，并用 `gsap.context` 作用域化 `.reveal`、`.hero-seal` 和 `.floating-note` 选择器。

- [ ] **Step 2: 编排首屏时间线**

在 `onMounted` 中创建包含 `autoAlpha`、`y`、`scale` 和 `rotation` 的时间线；读取 `window.matchMedia('(prefers-reduced-motion: reduce)')`，减弱动效时将所有 duration 设为 0。使用 `onUnmounted` 调用 `animationContext?.revert()`。

- [ ] **Step 3: 更新模板层级**

保留现有结果计算和事件处理，给根节点、品牌、Hero 文本、统计项、徽章、表单包装节点增加 ref/class，加入杂志式副标题和可理解的状态文案；结果区结构仍向 `PlannerForm`、`RecipeCard`、`HistoryPanel` 传递原 props/events。

- [ ] **Step 4: 更新 App 局部样式**

将 Hero 改为深墨色封面板，使用番茄红标签、橄榄绿徽章和移动端单列排版；结果筛选控件改为可横向滚动的工具带；卡片列表在桌面为两列、手机为单列；保留结果空态和筛选行为。

### Task 3: 重设计输入表单与推荐卡片

**Files:**
- Modify: `frontend/src/components/PlannerForm.vue`
- Modify: `frontend/src/components/RecipeCard.vue`

- [ ] **Step 1: 调整表单视觉层级**

保留所有输入、校验和 emit 事件，增加字段序号、编辑式分组标题和更明显的主行动按钮；桌面使用三列字段，手机改为两列数值输入加全宽忌口输入，口味按钮可横向滚动。

- [ ] **Step 2: 调整卡片模板展示**

保留菜谱字段读取和详情事件，增加可访问的 accent 标记、食材数量、编号和“查看做法”按钮的清晰层级，不引入新的数据字段依赖。

- [ ] **Step 3: 调整卡片样式与交互**

用不同的 CSS 变量为三张卡片提供番茄红、鼠尾草绿、芥末黄强调色；加入 hover/active 的 transform 和阴影，避免布局属性动画；手机端卡片保持稳定高度和 44px 操作目标。

### Task 4: 将详情改成移动端底部抽屉并整理历史面板

**Files:**
- Modify: `frontend/src/components/RecipeDetail.vue`
- Modify: `frontend/src/components/HistoryPanel.vue`

- [ ] **Step 1: 保留详情可访问性契约**

继续支持 `Escape`、遮罩关闭、Tab 焦点循环、打开时锁定 body 滚动和关闭时恢复；仅调整面板定位和视觉，不改变 recipe 字段。

- [ ] **Step 2: 实现响应式抽屉布局**

桌面端使用居中面板，手机端将 `.detail-panel` 固定到视口底部，设置顶部圆角、最大高度、safe-area padding 和拖拽感顶部装饰条；关闭按钮保持至少 44px。

- [ ] **Step 3: 整理历史列表样式**

保留展开、回放、加载和空态逻辑，使用时间轴式边线、番茄色时间标记和全宽回放按钮，手机端改为纵向单列。

### Task 5: 运行验证并修正移动端问题

**Files:**
- Modify: any frontend files required by verification findings

- [ ] **Step 1: 运行构建验证**

运行 `pnpm --dir frontend build`，确认退出码为 0。

- [ ] **Step 2: 启动本地开发服务器**

运行 `pnpm --dir frontend dev --host 127.0.0.1`，记录实际本地 URL。

- [ ] **Step 3: 进行移动端浏览器验证**

使用本地浏览器在 390x844 和 1440x900 视口检查首屏、表单、结果卡片、详情抽屉和历史面板；确认控制台没有 Vue/GSAP 运行时错误，点击推荐和详情按钮仍可用。

- [ ] **Step 4: 处理发现的问题并重复构建**

针对溢出、文字遮挡、点击区域不足或动画未清理的问题修改对应文件，重新运行构建并复测受影响视口。
