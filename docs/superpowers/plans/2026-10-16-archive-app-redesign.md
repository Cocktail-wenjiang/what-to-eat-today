# 家常食谱档案 App 重做实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** 将现有 uni-app 的首页、推荐、历史、问答和菜谱详情统一为“家常食谱档案”移动 App 视觉系统，同时保留现有数据与交互逻辑。

**Architecture:** 使用 `uni.scss` 作为唯一设计令牌源，页面和组件只引用 `--archive-*` 变量。保留现有 Vue 模板与脚本逻辑，集中替换重复的 Apple/Space 样式覆盖，并用统一的档案式分隔线、索引标签、纸张面板和内容语气调整产品表现。

**Tech Stack:** uni-app、Vue 3 `<script setup>`、SCSS/CSS 变量、现有 uniCloud 云函数与本地 JSON 数据。

---

### Task 1: 建立全局档案主题令牌

**Files:**
- Modify: `uni.scss`
- Modify: `App.vue`

- [ ] **Step 1: 将全局变量收敛到档案系统**

在 `uni.scss` 中定义暖米纸、橄榄绿、番茄红、墨色、灰棕、边框、阴影和间距变量；在 `App.vue` 的 `:root` 中只保留 `--archive-*` 变量和兼容性字体栈。删除 `--apple-*`、`--space-*` 变量及对应主题类。

```scss
--archive-paper: #f1ead9;
--archive-paper-deep: #e7ddc9;
--archive-card: #fffaf0;
--archive-ink: #342d24;
--archive-soft: #766d60;
--archive-muted: #9b917f;
--archive-olive: #81905e;
--archive-olive-soft: #e6ead7;
--archive-tomato: #a54532;
--archive-tomato-soft: #f4e0d9;
--archive-line: #c9bda8;
--archive-line-soft: rgba(111, 94, 70, .18);
--archive-shadow: 0 16rpx 36rpx rgba(77, 56, 31, .09);
```

- [ ] **Step 2: 保持全局重置可用**

保留 `box-sizing`、页面背景、文字抗锯齿和减少动态规则；将默认页面背景与文字色改为 `var(--archive-paper)` 和 `var(--archive-ink)`。

- [ ] **Step 3: 运行静态检查**

Run: `rg -n "--apple-|--space-" App.vue uni.scss`

Expected: no matches.

### Task 2: 重做首页与表单/推荐模块

**Files:**
- Modify: `pages/index/index.vue`
- Modify: `components/PlannerForm.vue`
- Modify: `components/RecipeCard.vue`
- Modify: `components/ResultSkeleton.vue`
- Modify: `components/EmptyState.vue`

- [ ] **Step 1: 保留首页脚本与事件，调整首页文案和结构标签**

把首页可见文案统一为“今日菜单”“留下记录”“问一问”“这顿饭，几分钟”等短句。保留现有表单提交、推荐筛选、打开详情、清空和跳转逻辑，不改 `useRecommendation` 的输入输出。

- [ ] **Step 2: 将首页外壳替换为档案页面层级**

首页样式使用纸张背景、细边框和双线/虚线分隔。顶部品牌栏保留日期与导航，Hero 改成紧凑的“今日菜单”标题区；推荐区使用首条主图卡片和后续档案列表。移除浮夸渐变、玻璃模糊、圆形 AI 入口和多个主题覆盖。

- [ ] **Step 3: 统一表单状态**

`PlannerForm.vue` 的输入框使用纸张底色、细边框和番茄红焦点；偏好项使用小型索引条而不是大胶囊；主按钮统一番茄红，次按钮为透明纸张边框；错误、成功和加载状态只引用档案令牌。

- [ ] **Step 4: 统一菜谱卡片与空态**

`RecipeCard.vue`、`ResultSkeleton.vue`、`EmptyState.vue` 使用同一图片比例、同一标题层级、同一分隔线和同一 44px 触控高度。分数用橄榄绿/番茄红数字表达，标签改为短索引文本，空态文案改为“还没有找到合适的菜”“换个条件再试试”。

- [ ] **Step 5: 运行模板编译检查**

Run: `npm run build:h5`

Expected: build completes without Vue template or style compilation errors.

### Task 3: 统一历史、问答和详情页面

**Files:**
- Modify: `components/HistoryPanel.vue`
- Modify: `components/AiAssistant.vue`
- Modify: `components/RecipeDetail.vue`
- Modify: `pages/qa/qa.vue`

- [ ] **Step 1: 重做历史档案表现**

历史模块使用时间线、日期索引和档案条目；重放操作使用统一文本按钮。保留加载、空态、分页/展开和重放回填逻辑。

- [ ] **Step 2: 重做问一问入口与问答页**

保留问答请求、超时、引用和清空逻辑。把入口从浮动 AI 视觉改为首页中的边注条；问答页使用纸张底、两种边框色的对话条、索引式示例问题和统一底部输入栏。文案使用“问一问”“可以问做法、火候和食材搭配”。

- [ ] **Step 3: 重做菜谱详情**

详情抽屉使用米纸面板，封面、时间和分数位于上方，内容分成“需要的食材”“做法步骤”“小提示”。步骤编号为档案索引数字；关闭按钮、标签、列表分隔线和安全区统一使用档案令牌。

- [ ] **Step 4: 删除所有旧主题覆盖**

对修改过的组件执行：每个文件只保留一个最终主题样式块；删除引用 `--apple-*` 或 `--space-*` 的规则，删除深色渐变和玻璃拟态覆盖。

- [ ] **Step 5: 运行静态检查**

Run: `rg -n "--apple-|--space-|linear-gradient|backdrop-filter" App.vue uni.scss pages components`

Expected: no theme variable matches; any remaining `linear-gradient` or `backdrop-filter` must be absent from app UI files.

### Task 4: 移动端验证与修正

**Files:**
- Modify: any files from Tasks 1-3 if verification exposes layout issues.

- [ ] **Step 1: 启动 H5 预览**

Run: `npm run dev:h5`

Expected: local H5 preview starts and shows the redesigned home page.

- [ ] **Step 2: 验证首页关键流程**

在 390px 宽度下检查：输入人数/时长、选择偏好、提交推荐、点击菜谱详情、关闭详情、进入问一问。确认长菜名、错误信息和按钮文字不溢出。

- [ ] **Step 3: 验证问答页与历史模块**

检查问答空态、示例问题、输入栏和清空按钮；检查历史空态与至少一条历史记录的显示。确认页面没有主题切换后残留的深色样式。

- [ ] **Step 4: 运行最终验证**

Run: `npm run build:h5`

Expected: build succeeds; `rg -n "--apple-|--space-" App.vue uni.scss pages components` returns no matches.
