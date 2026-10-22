<template>
	<view ref="pageRoot" class="app-shell">
		<!-- ===== 顶部品牌栏 =====
		     页面已设 navigationStyle: custom（原生导航栏会与品牌栏重复），
		     小程序右上角胶囊按钮是浮层，故右侧内边距按胶囊实际位置动态避让 -->
		<view class="topbar" :style="topbarRightReserve ? { paddingRight: topbarRightReserve + 'px' } : null">
			<view class="brand">
				<view class="brand-mark"><text>食</text></view>
				<view class="brand-text">
					<text class="brand-name">今天吃什么</text>
					<text class="brand-sub">家常菜谱 · 每日一页</text>
				</view>
			</view>
			<view class="topbar-nav">
				<view class="nav-item nav-active"><text>推荐</text></view>
				<view class="nav-item" @tap="openQa"><text>问一问</text></view>
			</view>
			<view class="topbar-note"><text>{{ heroDate }}</text><text class="note-dot">●</text></view>
		</view>

		<view class="page-wrap">
			<!-- ===== 首屏 ===== -->
			<view class="hero">
				<image class="hero-backdrop" :src="featuredImage" mode="aspectFill" aria-hidden="true" />
				<view class="hero-copy">
					<view class="hero-meta"><text class="eyebrow">今日菜单</text><text class="hero-date">{{ heroDate }}</text></view>
					<view class="hero-title">
						<text>今天这顿，</text>
						<text class="hero-em">慢慢选。</text>
					</view>
					<text class="hero-lede">记下人数、时间和口味，从手边的食材开始安排。</text>
					<view class="hero-actions">
						<view class="hero-primary" @tap="scrollToPlanner"><text>记下条件</text><text class="hero-primary-arrow">↘</text></view>
						<view class="hero-secondary" @tap="openAi"><text>问一问</text></view>
					</view>
					<view class="hero-stats">
					<view class="stat">
						<text class="stat-num">{{ recipeCount }}</text>
						<text class="stat-label">道家常菜谱</text>
					</view>
					<view class="stat">
						<text class="stat-num">{{ fastestMinutes }}<text v-if="fastestMinutes !== '—'" class="stat-unit">min</text></text>
						<text class="stat-label">最快上桌</text>
					</view>
					<view class="stat">
						<text class="stat-num">1<text class="stat-unit">句</text></text>
						<text class="stat-label">句话说明</text>
					</view>
					</view>
				</view>
				<view class="hero-visual" aria-hidden="true">
					<view class="hero-visual-label"><text>家常菜谱 · 01</text><text class="hero-visual-dot">●</text></view>
					<view class="hero-visual-caption"><text>从手边的食材开始</text><text>好好吃饭</text></view>
				</view>
			</view>

			<!-- ===== 解析成功提示 =====
			     贴在表单上方：这里才是被填好的条件所在处，用户一眼能看到「填了什么」 -->
			<view v-if="aiNotice" class="ai-notice">
				<text class="ai-notice-text">{{ aiNotice }}</text>
			</view>

			<!-- ===== 需求表单 ===== -->
			<PlannerForm
				:form="form"
				:errors="errors"
				:loading="loading"
				:status-text="statusText"
				:status="status"
				@submit="handleSubmit"
				@reset="reset"
				@validate="validateField"
				@choose-preference="choosePreference"
			/>

			<!-- ===== 结果区 ===== -->
			<view id="planner-results" class="results-section">
				<view class="results-heading">
					<view>
						<text class="section-kicker">02 / 推荐菜谱</text>
						<text class="section-title">给今天的你</text>
					</view>
					<view v-if="results.length" class="result-tools">
						<text class="result-meta">
							{{ displayedResults.length }} / {{ results.length }} 道<text v-if="matchNote"> · {{ matchNote }}</text>
						</text>
						<view
							v-for="tag in availableTags"
							:key="tag"
							class="tool-chip"
							:class="{ active: activeTag === tag }"
							@tap="toggleTag(tag)"
						>
							<text>{{ tag }}</text>
						</view>
						<view
							v-if="activeTag"
							class="tool-clear"
							@tap="clearFilters"
						>
							<text>清除筛选</text>
						</view>
					</view>
				</view>

				<ResultSkeleton v-if="status === 'loading'" />

				<EmptyState
					v-else-if="status === 'error'"
					variant="error"
					:message="errorMessage"
					@retry="handleSubmit"
				/>

				<EmptyState
					v-else-if="!results.length"
					:variant="emptyVariant"
					:suggestions="suggestions"
					@retry="relaxAndRetry"
					@apply="applySuggestion"
				/>

				<view v-else-if="filteredEmpty" class="filtered-empty">
					<text class="filtered-text">「{{ activeTag }}」暂时没有合适的菜。</text>
					<view class="empty-action" @tap="clearFilters"><text>清除筛选</text></view>
				</view>

				<view v-else ref="recipeList" class="recipe-list">
					<!-- 用于 Flip 捕获筛选前后的卡片布局 -->
					<RecipeCard
						v-for="(recipe, index) in displayedResults"
						:key="recipe.recipeId || index"
						:recipe="recipe"
						:index="index"
						@detail="openDetail"
					/>
				</view>
			</view>

			<!-- ===== 历史记录 ===== -->
			<HistoryPanel
				:items="history"
				:loading="historyLoading"
				@replay="replay"
			/>

			<!-- ===== 问一问入口 =====
			     从「挑一道菜」到「问一个问题」：给想了解做法/搭配的用户一个自然出口 -->
			<view class="ask-entry" @tap="openQa">
				<view class="ask-entry-main">
					<text class="ask-entry-kicker">ASK</text>
					<text class="ask-entry-title">问一问</text>
					<text class="ask-entry-desc">某道菜怎么做、食材怎么搭，都可以问问。</text>
				</view>
				<view class="ask-entry-arrow"><text>↗</text></view>
			</view>

		</view>

		<view class="footer">
			<text>今天吃什么 · 家常菜谱档案</text>
			<text>菜谱与营养信息仅供参考，特殊饮食需求请遵医嘱</text>
		</view>

		<RecipeDetail :recipe="activeRecipe" @close="closeDetail" />

		<!-- ===== AI 助手悬浮窗（一句话 / 拍照识图入口，对话流形态） ===== -->
		<AiAssistant
			:visible="aiOpen"
			:parsing="aiParsing"
			:messages="aiMessages"
			@open="openAi"
			@close="closeAi"
			@send="handleAiSend"
			@reset-chat="resetAiChat"
		/>

		<view class="mobile-tabbar">
			<view class="tab-item tab-active" @tap="scrollToTop"><text class="tab-icon tab-home">⌂</text><text>推荐</text></view>
			<view class="tab-item" @tap="scrollToPlanner"><text class="tab-icon tab-plan">＋</text><text>记下条件</text></view>
			<view class="tab-item" @tap="openQa"><text class="tab-icon tab-report">▥</text><text>问一问</text></view>
			<view class="tab-item" @tap="scrollToHistory"><text class="tab-icon tab-me">◉</text><text>我的</text></view>
		</view>
	</view>
</template>

<script setup>
/**
 * 首页
 * 负责：页面骨架（品牌栏 / Hero / 表单 / 结果 / 历史 / 页脚）
 *       结果区的标签筛选、空状态建议、以及把结果滚动到可视区。
 */
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useRecommendation } from '../../composables/useRecommendation.js'
import PlannerForm from '../../components/PlannerForm.vue'
import RecipeCard from '../../components/RecipeCard.vue'
import RecipeDetail from '../../components/RecipeDetail.vue'
import HistoryPanel from '../../components/HistoryPanel.vue'
import ResultSkeleton from '../../components/ResultSkeleton.vue'
import EmptyState from '../../components/EmptyState.vue'
import AiAssistant from '../../components/AiAssistant.vue'
import { modeLabel } from '../../utils/format.js'
import { countStrictMatches } from '../../api/ruleEngine.js'
import { ensureRecipePool } from '../../api/client.js'
// #ifdef H5
import { gsap } from 'gsap'
import { Flip } from 'gsap/Flip'
gsap.registerPlugin(Flip)
// #endif

const {
	form,
	errors,
	results,
	history,
	loading,
	historyLoading,
	status,
	errorMessage,
	usedMode,
	hasSubmitted,
	statusText,
	aiParsing,
	aiMessage,
	aiError,
	aiMessages,
	submit,
	sendAiMessage,
	resetAiChat,
	loadHistory,
	replay,
	reset,
	validateField,
	choosePreference
} = useRecommendation()

/** 当前打开详情的菜谱 */
const activeRecipe = ref(null)
const pageRoot = ref(null)
const heroDate = new Date().toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })

/**
 * 品牌栏右侧避让宽度。
 *
 * pages.json 设了 `navigationStyle: "custom"`——因为原生导航栏与页面自带的品牌栏内容重复
 * （H5 下会同时出现「今天吃什么」导航栏和「eat well / 今天吃什么」品牌栏）。
 * 关掉原生导航栏后页面会顶到屏幕最上方：竖向由 CSS 的 `var(--status-bar-height)` 兜住，
 * 但小程序右上角的胶囊按钮是浮层、不占文档流，只能按它的实际位置算一个右内边距。
 * H5 / App 端没有胶囊，保持 0。
 */
const topbarRightReserve = ref(0)
// #ifndef H5
onMounted(() => {
	const rect =
		typeof uni.getMenuButtonBoundingClientRect === 'function'
			? uni.getMenuButtonBoundingClientRect()
			: null
	if (rect && rect.width) {
		const { windowWidth } = uni.getSystemInfoSync()
		topbarRightReserve.value = Math.max(0, windowWidth - rect.left + 8)
	}
})
// #endif

let motionContext
let motionMedia
let resultMotion

// ===== AI 助手悬浮窗 =====
/** 悬浮窗是否展开（可见性由页面持有） */
const aiOpen = ref(false)
/** 关闭面板后的提示条文案；错误不在此展示，错误留在对话里让用户就地重说 */
const aiNotice = ref('')
let noticeTimer = null

function openAi() {
	aiOpen.value = true
	// 只清掉上一次的提示条；**对话本身保留**——多轮对话的价值就在于能接着上一句说
	aiNotice.value = ''
}

function scrollToPlanner() {
	uni.pageScrollTo({ selector: '.planner', duration: 360 })
}

function closeAi() {
	aiOpen.value = false
	// 对话流里解析成功不再自动收起面板，所以「理解结果」改在用户主动关闭时展示：
	// 这一刻用户回到表单，正是想确认「到底填了什么」的时候。
	if (aiMessage.value && !aiError.value) showAiNotice(aiMessage.value)
}

/** 把提示条滚到可视区。
 *
 * H5 端 `uni.pageScrollTo` 会**忽略 `offsetTop`**（实测 -40 / -16 / 0 / 16 四种取值 scrollY 完全一致），
 * 所以 H5 自己按文档位置滚，好在提示条上方留出与页面左右边距同量级的呼吸空间
 * （页面已设 navigationStyle: custom，没有导航栏兜底，不加偏移会贴到屏幕最顶边）；
 * 其他端用 `offsetTop` 负值达到同样效果。
 */
function scrollToNotice() {
	// #ifdef H5
	const el = document.querySelector('.ai-notice')
	if (el) {
		const reduce =
			typeof window.matchMedia === 'function' &&
			window.matchMedia('(prefers-reduced-motion: reduce)').matches
		window.scrollTo({
			top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - 16),
			behavior: reduce ? 'auto' : 'smooth'
		})
		return
	}
	// #endif
	uni.pageScrollTo({
		selector: '.ai-notice',
		offsetTop: -16,
		duration: 260,
		fail: () => uni.pageScrollTo({ selector: '.planner', duration: 260 })
	})
}

/**
 * 展示「我理解的是…」提示条：挂在表单上方 + 滚到可视区，9 秒后自动消失。
 *
 * 滚动目标是提示条而不是 `.planner`：提示条在表单上方，滚到表单会把提示条顶出可视区，
 * 用户就看不到「AI 到底填了什么」，只看到表单莫名其妙变了。
 */
function showAiNotice(text) {
	aiNotice.value = text
	if (noticeTimer) clearTimeout(noticeTimer)
	noticeTimer = setTimeout(() => {
		aiNotice.value = ''
	}, 9000)
	// 提示条此刻刚由 v-if 渲染出来，等一次 DOM 更新再滚
	nextTick(scrollToNotice)
}

// ===== 结果区标签筛选 =====
const activeTag = ref('')
const recipeList = ref(null)
let filterAnimating = false

/** 当前结果中出现过的全部标签 */
const availableTags = computed(() => {
	const set = new Set()
	results.value.forEach((r) => (r.tags || []).forEach((t) => set.add(t)))
	return Array.from(set)
})

/** 应用标签筛选后的列表 */
const displayedResults = computed(() => {
	if (!activeTag.value) return results.value
	return results.value.filter((r) => (r.tags || []).includes(activeTag.value))
})

/** 筛选后为空但原本有结果时，提示用户 */
const filteredEmpty = computed(
	() => results.value.length > 0 && displayedResults.value.length === 0
)

function recipeListElement() {
	const node = recipeList.value
	return node && (node.$el || node)
}

function setActiveTag(tag) {
	const nextTag = activeTag.value === tag ? '' : tag
	// #ifdef H5
	const root = recipeListElement()
	const cards = root ? root.querySelectorAll('.recipe-card') : []
	const state = cards.length ? Flip.getState(cards) : null
	filterAnimating = Boolean(state)
	activeTag.value = nextTag
	if (state) {
		nextTick(() => {
			Flip.from(state, {
				duration: 0.42,
				ease: 'power2.inOut',
				nested: true,
				scale: false,
				absolute: false,
				clearProps: 'transform'
			})
		})
	}
	// #ifndef H5
	activeTag.value = nextTag
	// #endif
}

function toggleTag(tag) {
	setActiveTag(tag)
}
function clearFilters() {
	if (activeTag.value) setActiveTag(activeTag.value)
}

// ===== 空状态的可操作建议 =====
/**
 * 依次尝试放宽单个条件，统计各方案能严格命中多少条，
 * 只保留有命中的方案，按命中数降序，最多 3 条。
 *
 * 注意用 countStrictMatches 而非 recommendByRules：
 * 后者带降级兜底（软条件无命中时会放开口味），
 * 会让「口味改为不限」这类建议的增量被掩盖。
 */
const recipePool = ref([])

const suggestions = computed(() => {
	if (status.value !== 'empty' || !hasSubmitted.value) return []

	const base = {
		servings: Number(form.servings),
		max_minutes: Number(form.max_minutes),
		preference: form.preference,
		allergy: form.allergy
	}
	const pool = recipePool.value
	if (!pool.length) return []

	const candidates = []

	// 放宽用时到 60 分钟
	if (base.max_minutes < 60) {
		const count = countStrictMatches(pool, { ...base, max_minutes: 60 })
		if (count) {
			candidates.push({ label: '把用时放宽到 60 分钟', count, patch: { max_minutes: 60 } })
		}
	}

	// 口味改为不限
	if (base.preference !== '不限') {
		const count = countStrictMatches(pool, { ...base, preference: '不限' })
		if (count) {
			candidates.push({ label: '口味改为「不限」', count, patch: { preference: '不限' } })
		}
	}

	// 去掉忌口
	if (base.allergy) {
		const count = countStrictMatches(pool, { ...base, allergy: '' })
		if (count) {
			candidates.push({ label: `去掉忌口「${base.allergy}」`, count, patch: { allergy: '' } })
		}
	}

	// 用时过紧时，同时放宽用时+口味往往才是真正可行的方案
	if (base.max_minutes < 60 && base.preference !== '不限') {
		const count = countStrictMatches(pool, { ...base, max_minutes: 60, preference: '不限' })
		if (count) {
			const already = candidates.some((c) => c.count === count)
			if (!already) {
				candidates.push({
					label: '用时放宽到 60 分钟 + 口味不限',
					count,
					patch: { max_minutes: 60, preference: '不限' }
				})
			}
		}
	}

	return candidates.sort((a, b) => b.count - a.count).slice(0, 3)
})

/**
 * 菜谱池缓存（供建议计算与 Hero 数字用），首次需要时加载。
 * 加载顺序：uniCloud 云库 → 本地种子。
 * 之所以需要本地兜底：云库不可达时若不回退，
 * 建议列表会静默退化为无效的「放宽条件重新推荐」按钮。
 */
let poolLoading = false
async function loadRecipePool() {
	if (recipePool.value.length || poolLoading) return
	poolLoading = true
	try {
		recipePool.value = await ensureRecipePool()
	} finally {
		poolLoading = false
	}
}

/** Hero 展示的菜谱总数，未加载完成时显示占位 */
const recipeCount = computed(() =>
	recipePool.value.length ? String(recipePool.value.length) : '—'
)

/** Hero 展示的最快上桌时间：取自菜谱池实际数据，避免写死数字与真实数据不符 */
const fastestMinutes = computed(() => {
	const times = recipePool.value
		.map((r) => Number(r.minutes))
		.filter((n) => Number.isFinite(n))
	return times.length ? String(Math.min(...times)) : '—'
})

const featuredImage = computed(() => {
	const recipe = results.value[0] || recipePool.value[0]
	return recipe && recipe.image ? recipe.image : '/static/images/recipes/R-001.jpg'
})

/** 结果口径提示：仅在放宽口味条件后给出，精确命中时不展示内部模式名 */
const matchNote = computed(() => modeLabel(usedMode.value))

/** 空状态形态：未搜索 / 搜索后无结果 */
const emptyVariant = computed(() => (hasSubmitted.value ? 'empty' : 'idle'))

// #ifdef H5
/**
 * GSAP 作用域元素。
 *
 * uni-app H5 会把 `<view>` 编译成组件（产物里是 `_component_v_uni_view`），
 * 所以 `<view ref="pageRoot">` 拿到的 `pageRoot.value` 是**组件实例**而不是 DOM 元素。
 * 直接把实例当 scope 传给 gsap，会让 `gsap.utils.selector()` 打
 * 「Invalid scope」警告并静默退化成 document 作用域——那样 `.recipe-card` 之类的
 * 选择器就管不住范围了。这里统一取组件实例的根元素。
 */
function gsapScope() {
	const node = pageRoot.value
	if (!node) return null
	return node.$el || node
}
// #endif

onMounted(() => {
	loadRecipePool()
	loadHistory()
	// #ifdef H5
	const scopeEl = gsapScope()
	if (scopeEl) {
		motionMedia = gsap.matchMedia()
		motionContext = gsap.context(() => {
			motionMedia.add('(prefers-reduced-motion: no-preference)', () => {
			const intro = gsap.timeline({ defaults: { ease: 'power3.out' } })
			intro.from('.brand, .topbar-note', { y: -12, autoAlpha: 0, duration: 0.55, stagger: 0.08 })
				.from('.hero-meta, .hero-title, .hero-lede', { y: 22, autoAlpha: 0, duration: 0.68, stagger: 0.12 }, '-=0.25')
				.from('.hero-stats .stat', { y: 14, autoAlpha: 0, duration: 0.48, stagger: 0.1 }, '-=0.2')
				.from('.hero-stamp', { scale: 0.8, rotation: -9, autoAlpha: 0, duration: 0.65 }, '-=0.5')
				.from('.planner', { y: 28, autoAlpha: 0, duration: 0.65 }, '-=0.35')
			}, scopeEl)
		}, scopeEl)
	}
	// #endif
})

onBeforeUnmount(() => {
	if (noticeTimer) clearTimeout(noticeTimer)
	// #ifdef H5
	resultMotion?.revert()
	motionMedia?.revert()
	motionContext?.revert()
	// #endif
})

// uni-app 页面级生命周期：从后台回前台时刷新历史
onShow(() => {
	loadHistory()
})

/** 应用某条放宽建议并重新推荐 */
async function applySuggestion(patch) {
	Object.assign(form, patch)
	await handleSubmit()
}

/**
 * 发一条消息给 AI（文字 / 照片）。
 *
 * 对话流里**不自动收起面板**：用户随时可以接着说「再快一点」。
 * 失败也不阻断流程——错误作为一条 AI 回话留在对话里，用户就地重说即可。
 */
async function handleAiSend(payload) {
	await sendAiMessage(payload || {})
}

function openDetail(recipe) {
	activeRecipe.value = recipe
}

function closeDetail() {
	activeRecipe.value = null
}

/** 打开知识问答页 */
function openQa() {
	uni.navigateTo({ url: '/pages/qa/qa' })
}

function scrollToTop() {
	uni.pageScrollTo({ scrollTop: 0, duration: 320 })
}

function scrollToHistory() {
	uni.pageScrollTo({ selector: '.history-panel', duration: 320 })
}

/** 提交后滚动到结果区，让用户立刻看到反馈 */
async function handleSubmit() {
	activeTag.value = ''
	await submit()
	if (status.value === 'success' || status.value === 'empty') {
		await nextTick()
		uni.pageScrollTo({ selector: '.results-section', duration: 260 })
	}
}

/** 空状态里的通用「放宽条件」：用时 +30 分钟、口味不限 */
async function relaxAndRetry() {
	form.max_minutes = Math.min(60, Number(form.max_minutes) + 30)
	form.preference = '不限'
	await handleSubmit()
}

watch(status, (value) => {
	if (value === 'empty') loadRecipePool()
})

// #ifdef H5
// Results arrive asynchronously; animate only after Vue renders the new cards.
watch(displayedResults, (items) => {
	if (filterAnimating) {
		filterAnimating = false
		return
	}
	resultMotion?.revert()
	const scopeEl = gsapScope()
	if (!items.length || !scopeEl) return
	resultMotion = gsap.matchMedia()
	resultMotion.add('(prefers-reduced-motion: no-preference)', () => {
		gsap.from('.recipe-card', {
			y: 20, autoAlpha: 0, duration: 0.5, stagger: 0.09,
			ease: 'power3.out', clearProps: 'transform,opacity,visibility'
		})
	}, scopeEl)
}, { flush: 'post' })
// #endif
</script>

<style scoped>
.app-shell { min-height: 100vh; color: #262820; background: #f6f1e7; }
.topbar { display: flex; align-items: center; justify-content: space-between; padding: 30rpx 42rpx 26rpx; }
/* pages.json 设了 navigationStyle: custom，小程序/App 端页面会顶到屏幕最上方，
   这里把品牌栏推到状态栏之下；H5 没有状态栏（该变量为 0），沿用上面的 padding 即可。 */
/* #ifndef H5 */
.topbar { padding-top: calc(var(--status-bar-height) + 30rpx); }
/* #endif */
.brand { display: flex; align-items: center; }
.brand-mark { width: 68rpx; height: 68rpx; display: flex; align-items: center; justify-content: center; margin-right: 20rpx; border-radius: 50%; background: #d94b36; color: #fff8ed; font-family: Georgia, serif; font-size: 34rpx; font-weight: 700; }
.brand-name { display: block; color: #262820; font-family: Georgia, serif; font-size: 29rpx; font-weight: 700; }
.brand-sub { display: block; margin-top: 5rpx; color: #767466; font-size: 21rpx; }
.topbar-note { display: flex; align-items: center; gap: 12rpx; color: #767466; font-family: Georgia, serif; font-size: 17rpx; letter-spacing: .08em; }
.note-dot { color: #87934b; font-size: 15rpx; }
.page-wrap { padding: 0 30rpx 76rpx; }
/* AI 解析结果提示条：与表单同宽同底色，读起来像表单的一部分而非系统弹窗 */
.ai-notice { display: flex; align-items: flex-start; margin-top: 30rpx; padding: 20rpx 24rpx; border-left: 4rpx solid #87934b; background: #fffcf5; }
.ai-notice-text { flex: 1; min-width: 0; color: #55564c; font-size: 24rpx; line-height: 1.7; overflow-wrap: anywhere; }
.hero { min-height: 570rpx; box-sizing: border-box; position: relative; overflow: hidden; padding: 54rpx 42rpx 40rpx; background: #292d25; color: #fff9ee; }
.hero::after { content: ''; position: absolute; right: -120rpx; top: 138rpx; width: 450rpx; height: 450rpx; border: 1px solid rgba(246,241,231,.14); border-radius: 50%; box-shadow: 0 0 0 36rpx rgba(246,241,231,.035), 0 0 0 72rpx rgba(246,241,231,.025); }
.hero-meta { display: flex; align-items: center; justify-content: space-between; position: relative; z-index: 1; }
.eyebrow { color: #bdc57e; font-family: Georgia, serif; font-size: 19rpx; font-weight: 700; letter-spacing: .12em; }
.hero-date { color: rgba(255,249,238,.55); font-family: Georgia, serif; font-size: 19rpx; }
.hero-title { display: flex; flex-direction: column; position: relative; z-index: 1; margin-top: 58rpx; color: #fff9ee; font-family: 'Songti SC', 'Noto Serif CJK SC', serif; font-size: 60rpx; line-height: 1.22; font-weight: 600; }
.hero-em { color: #e67b5c; }
.hero-lede { display: block; position: relative; z-index: 1; max-width: 460rpx; margin-top: 22rpx; color: rgba(255,249,238,.76); font-size: 25rpx; line-height: 1.7; }
.hero-art { position: absolute; right: -22rpx; top: 250rpx; width: 194rpx; height: 214rpx; z-index: 1; pointer-events: none; }
.hero-stamp { position: absolute; right: 38rpx; top: 98rpx; z-index: 1; width: 95rpx; height: 95rpx; display: flex; flex-direction: column; align-items: center; justify-content: center; box-sizing: border-box; border: 1px solid #bdc57e; border-radius: 50%; color: #dce1aa; font-size: 17rpx; line-height: 1.35; transform: rotate(9deg); }
.stamp-star { font-size: 17rpx; }
.hero-stats { display: flex; position: relative; z-index: 1; margin-top: 45rpx; padding-top: 24rpx; border-top: 1px solid rgba(255,249,238,.2); }
.stat { flex: 1; min-width: 0; margin-right: 12rpx; }
.stat-num { display: block; color: #e8bb70; font-family: Georgia, serif; font-size: 38rpx; line-height: 1; font-weight: 700; }
.stat-unit { margin-left: 5rpx; font-size: 20rpx; }
.stat-label { display: block; margin-top: 10rpx; color: rgba(255,249,238,.67); font-size: 20rpx; }
.results-section { margin-top: 96rpx; }
.results-heading { margin-bottom: 30rpx; }
.section-kicker { display: block; color: #d94b36; font-family: Georgia, serif; font-size: 19rpx; font-weight: 700; letter-spacing: .12em; }
.section-title { display: block; margin-top: 9rpx; color: #292d25; font-family: 'Songti SC', 'Noto Serif CJK SC', serif; font-size: 39rpx; font-weight: 700; }
.result-tools { display: flex; flex-wrap: wrap; align-items: center; margin-top: 20rpx; }
.result-meta { margin-right: 14rpx; color: #767466; font-size: 22rpx; }
.tool-chip { min-height: 58rpx; display: flex; align-items: center; padding: 0 20rpx; margin: 0 10rpx 10rpx 0; border: 1px solid #d9d3c7; border-radius: 30rpx; background: transparent; color: #55564c; font-size: 21rpx; }
.tool-chip.active { border-color: #87934b; background: #e5e7d3; color: #4f5a2d; font-weight: 700; }
.tool-clear { min-height: 58rpx; display: flex; align-items: center; color: #d94b36; font-size: 21rpx; }
.recipe-list { display: flex; flex-direction: column; }
.filtered-empty { padding: 70rpx 30rpx; display: flex; flex-direction: column; align-items: center; border: 1px dashed #c9c1b3; }
.filtered-text { margin-bottom: 25rpx; color: #767466; font-size: 25rpx; }
.filtered-empty .empty-action { min-height: 80rpx; padding: 0 36rpx; display: flex; align-items: center; background: #d94b36; color: #fff9ee; font-size: 24rpx; }
/* 问一问入口：左侧橄榄色竖条与「为什么推荐」的浅绿块呼应，右侧番茄红箭头指向动作 */
.ask-entry { display: flex; align-items: center; justify-content: space-between; margin-top: 40rpx; padding: 30rpx 30rpx 30rpx 32rpx; border: 1px solid #ddd5c7; border-left: 5rpx solid #87934b; border-radius: 4rpx; background: #fffcf5; }
.ask-entry-main { flex: 1; min-width: 0; }
.ask-entry-kicker { display: block; color: #87934b; font-family: Georgia, serif; font-size: 19rpx; font-weight: 700; letter-spacing: .14em; }
.ask-entry-title { display: block; margin-top: 9rpx; color: #292d25; font-family: 'Songti SC', 'Noto Serif CJK SC', serif; font-size: 36rpx; font-weight: 700; }
.ask-entry-desc { display: block; margin-top: 12rpx; color: #767466; font-size: 23rpx; line-height: 1.65; }
.ask-entry-arrow { display: flex; align-items: center; justify-content: center; width: 72rpx; height: 72rpx; margin-left: 20rpx; flex-shrink: 0; border-radius: 50%; background: #d94b36; color: #fff9ee; font-size: 30rpx; }
.ask-entry:active { transform: scale(.99); }
.footer { display: flex; flex-direction: column; align-items: center; padding: 32rpx 38rpx calc(56rpx + env(safe-area-inset-bottom)); }
.footer text { color: #767466; font-size: 20rpx; line-height: 1.8; text-align: center; }
@media screen and (min-width: 700px) { .page-wrap { max-width: 1000px; margin: 0 auto; } .hero { min-height: 520rpx; padding-left: 68rpx; } .hero-title { font-size: 72rpx; } }
@media (prefers-reduced-motion: reduce) { .app-shell * { scroll-behavior: auto !important; } }
</style>

<style scoped>
/* Archive skin: final page-level rules keep the mobile app coherent after legacy skins compile. */
.app-shell { background: var(--archive-paper) !important; color: var(--archive-ink) !important; padding-bottom: calc(118rpx + env(safe-area-inset-bottom)) !important; }
.topbar { padding: 18rpx 28rpx !important; background: rgba(241,234,217,.96) !important; border-bottom: 1px solid var(--archive-line-soft) !important; backdrop-filter: none !important; }
.brand-mark { width: 58rpx !important; height: 58rpx !important; margin-right: 16rpx !important; border-radius: 50% !important; background: var(--archive-olive) !important; color: #fffaf0 !important; box-shadow: none !important; }
.brand-name { color: var(--archive-ink) !important; font-family: 'Songti SC', 'Noto Serif CJK SC', serif !important; }
.brand-sub, .topbar-note { color: var(--archive-soft) !important; }
.nav-item { color: var(--archive-soft) !important; border-radius: 2rpx !important; }
.nav-active { color: var(--archive-tomato) !important; background: transparent !important; }
.nav-active::after { background: var(--archive-tomato) !important; }
.page-wrap { padding: 18rpx 20rpx 80rpx !important; }
.hero { display: flex !important; flex-direction: column !important; min-height: 0 !important; padding: 0 !important; border: 1px solid var(--archive-line-soft) !important; border-radius: 4rpx !important; background: var(--archive-card) !important; box-shadow: var(--archive-shadow) !important; }
.hero-backdrop { position: relative !important; order: 2 !important; inset: auto !important; width: 100% !important; height: 330rpx !important; opacity: 1 !important; transform: none !important; filter: saturate(.9) !important; object-fit: cover !important; }
.hero-copy { order: 1 !important; min-height: 0 !important; padding: 32rpx 28rpx 28rpx !important; color: var(--archive-ink) !important; }
.hero::before, .hero::after, .hero-visual { display: none !important; }
.hero-meta { color: var(--archive-soft) !important; }
.eyebrow { color: var(--archive-tomato) !important; font-family: Georgia, serif !important; letter-spacing: .08em !important; }
.hero-date { color: var(--archive-muted) !important; }
.hero-title { margin-top: 34rpx !important; color: var(--archive-ink) !important; font: 600 54rpx/1.18 'Songti SC', 'Noto Serif CJK SC', serif !important; letter-spacing: 0 !important; text-shadow: none !important; }
.hero-em { color: var(--archive-tomato) !important; }
.hero-lede { color: var(--archive-soft) !important; }
.hero-primary { min-height: 76rpx !important; border-radius: 2rpx !important; background: var(--archive-tomato) !important; box-shadow: none !important; }
.hero-secondary { min-height: 76rpx !important; border: 1px solid var(--archive-line) !important; border-radius: 2rpx !important; color: var(--archive-ink) !important; background: transparent !important; }
.hero-stats { border-top-color: var(--archive-line-soft) !important; }
.stat-num { color: var(--archive-ink) !important; }
.stat-unit { color: var(--archive-olive) !important; }
.stat-label { color: var(--archive-soft) !important; }
.ai-notice { border-left-color: var(--archive-olive) !important; background: var(--archive-olive-soft) !important; }
.results-section { margin-top: 48rpx !important; }
.section-kicker { color: var(--archive-tomato) !important; }
.section-title { color: var(--archive-ink) !important; font-family: 'Songti SC', 'Noto Serif CJK SC', serif !important; }
.tool-chip { border-color: var(--archive-line) !important; border-radius: 2rpx !important; background: transparent !important; color: var(--archive-soft) !important; }
.tool-chip.active { border-color: var(--archive-olive) !important; background: var(--archive-olive) !important; color: #fffaf0 !important; }
.tool-clear { color: var(--archive-tomato) !important; }
.recipe-list { display: flex !important; flex-direction: column !important; gap: 14rpx !important; }
.filtered-empty { border-radius: 2rpx !important; background: var(--archive-card) !important; }
.ask-entry { border-radius: 2rpx !important; background: var(--archive-card) !important; box-shadow: var(--archive-shadow) !important; }
.ask-entry-kicker { color: var(--archive-tomato) !important; }
.ask-entry-arrow { border-radius: 2rpx !important; background: var(--archive-olive-soft) !important; color: var(--archive-olive) !important; }
.footer { border-top-color: var(--archive-line-soft) !important; }
.footer text { color: var(--archive-muted) !important; }
.mobile-tabbar { right: 0 !important; bottom: 0 !important; left: 0 !important; width: 100% !important; min-height: 108rpx !important; padding: 10rpx 14rpx calc(10rpx + env(safe-area-inset-bottom)) !important; border: 0 !important; border-top: 1px solid var(--archive-line-soft) !important; border-radius: 0 !important; background: rgba(255,250,240,.98) !important; box-shadow: none !important; backdrop-filter: none !important; }
.tab-item { min-height: 88rpx !important; color: var(--archive-soft) !important; background: transparent !important; }
.tab-active { color: var(--archive-tomato) !important; }
@media (max-width: 620px) { .hero-title { font-size: 52rpx !important; } .hero-backdrop { height: 280rpx !important; } }
</style>

<style scoped>
/* Final app skin overrides the legacy web skin above. */
.app-shell { min-height: 100vh !important; padding-bottom: calc(118rpx + env(safe-area-inset-bottom)) !important; color: #f7f3eb !important; background: #101112 !important; }
.topbar { padding: 18rpx 28rpx !important; border-bottom-color: rgba(255,255,255,.09) !important; background: rgba(16,17,18,.72) !important; backdrop-filter: blur(28px) saturate(150%) !important; }
.brand-mark { background: #ff6b45 !important; color: #fff8ef !important; box-shadow: 0 8rpx 24rpx rgba(255,107,69,.25) !important; }
.brand-name { color: #faf7f0 !important; }
.brand-sub, .topbar-note { color: rgba(247,243,235,.5) !important; }
.nav-item { min-height: 70rpx !important; padding: 0 18rpx !important; border-radius: 36rpx !important; color: rgba(247,243,235,.58) !important; }
.nav-active { color: #fff !important; background: rgba(255,255,255,.1) !important; }
.nav-active::after { background: #ff7b51 !important; }
.page-wrap { max-width: 760px !important; padding: 22rpx 22rpx 40rpx !important; }
.hero { display: block !important; position: relative !important; min-height: 720rpx !important; overflow: hidden !important; border: 1px solid rgba(255,255,255,.14) !important; border-radius: 36rpx !important; background: #25201c !important; box-shadow: 0 28rpx 80rpx rgba(0,0,0,.34) !important; }
.hero-backdrop { position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; opacity: .88 !important; transform: scale(1.04) !important; filter: saturate(1.12) contrast(1.04) !important; }
.hero::before { content: '' !important; position: absolute !important; inset: 0 !important; z-index: 1 !important; background: linear-gradient(180deg, rgba(12,12,12,.18) 0%, rgba(12,12,12,.12) 28%, rgba(12,12,12,.9) 100%) !important; }
.hero-copy { position: relative !important; z-index: 2 !important; display: flex !important; flex-direction: column !important; min-height: 720rpx !important; box-sizing: border-box !important; padding: 34rpx 30rpx 28rpx !important; }
.hero-title { margin-top: auto !important; color: #fffaf1 !important; font-size: 66rpx !important; line-height: 1.08 !important; letter-spacing: -.055em !important; text-shadow: 0 8rpx 24rpx rgba(0,0,0,.28) !important; }
.hero-em { color: #ff8b5d !important; }
.hero-lede { color: rgba(255,250,241,.78) !important; }
.hero-primary { background: #ff6b45 !important; color: #fff !important; box-shadow: 0 12rpx 30rpx rgba(255,107,69,.3) !important; }
.hero-secondary { border-color: rgba(255,255,255,.18) !important; color: #fff !important; background: rgba(255,255,255,.13) !important; backdrop-filter: blur(20px) !important; }
.hero-stats { border-top-color: rgba(255,255,255,.18) !important; }
.stat-num { color: #fff !important; }
.stat-unit, .section-kicker, .history-kicker, .ask-entry-kicker { color: #ff9d62 !important; }
.stat-label { color: rgba(255,255,255,.58) !important; }
.hero-visual { position: absolute !important; inset: 0 !important; z-index: 2 !important; min-height: 0 !important; pointer-events: none !important; }
.hero-visual-label { top: 30rpx !important; left: 30rpx !important; right: 30rpx !important; color: rgba(255,255,255,.72) !important; }
.hero-visual-dot { color: #ff8b5d !important; }
.hero-visual-caption { right: 30rpx !important; bottom: 30rpx !important; left: 30rpx !important; color: rgba(255,255,255,.62) !important; }
.results-section { margin-top: 58rpx !important; }
.section-title, .history-title, .ask-entry-title { color: #fffaf2 !important; }
.result-meta, .filtered-text, .ask-entry-desc { color: rgba(247,243,235,.52) !important; }
.tool-chip { border-color: rgba(255,255,255,.15) !important; background: rgba(255,255,255,.06) !important; color: rgba(255,255,255,.72) !important; backdrop-filter: blur(16px) !important; }
.tool-chip.active { border-color: rgba(255,139,93,.72) !important; background: rgba(255,107,69,.2) !important; color: #ffb36b !important; }
.tool-clear { color: #ff9d62 !important; }
.ask-entry { border-color: rgba(255,255,255,.12) !important; background: rgba(255,255,255,.07) !important; box-shadow: 0 16rpx 36rpx rgba(0,0,0,.18) !important; backdrop-filter: blur(22px) !important; }
.ask-entry-arrow { background: rgba(255,107,69,.18) !important; color: #ff9d62 !important; }
.footer { border-top-color: rgba(255,255,255,.08) !important; }
.footer text { color: rgba(247,243,235,.38) !important; }
.mobile-tabbar { position: fixed !important; right: 18rpx !important; bottom: calc(18rpx + env(safe-area-inset-bottom)) !important; left: 18rpx !important; z-index: 400 !important; display: flex !important; min-height: 96rpx !important; padding: 8rpx !important; border: 1px solid rgba(255,255,255,.16) !important; border-radius: 32rpx !important; background: rgba(255,252,249,.86) !important; box-shadow: 0 16rpx 40rpx rgba(90,62,52,.16) !important; backdrop-filter: blur(26px) saturate(150%) !important; }
.tab-item { display: flex !important; flex: 1 !important; flex-direction: column !important; align-items: center !important; justify-content: center !important; min-height: 78rpx !important; border-radius: 24rpx !important; color: rgba(255,255,255,.5) !important; }
.tab-icon { color: inherit !important; }
.tab-active { color: #fff !important; background: rgba(255,107,69,.2) !important; }
@media (max-width: 620px) { .hero, .hero-copy { min-height: 660rpx !important; } .hero-title { font-size: 58rpx !important; } .page-wrap { padding: 16rpx !important; } }
</style>

<style scoped>
/* Last-pass palette: warm ivory and coral, inspired by music discovery apps. */
.app-shell { background: #f5f1ed !important; color: #2b2524 !important; }
.topbar { background: rgba(245,241,237,.8) !important; border-bottom-color: rgba(64,47,43,.1) !important; }
.brand-mark { background: #e95543 !important; color: #fffaf6 !important; box-shadow: 0 8rpx 22rpx rgba(233,85,67,.2) !important; }
.brand-name { color: #2b2524 !important; }
.brand-sub, .topbar-note { color: rgba(43,37,36,.48) !important; }
.nav-item { color: rgba(43,37,36,.52) !important; }
.nav-active { color: #2b2524 !important; background: rgba(255,255,255,.68) !important; }
.nav-active::after { background: #e95543 !important; }
.hero { background: #d8c7ba !important; box-shadow: 0 24rpx 64rpx rgba(113,76,58,.16) !important; }
.hero::before { background: linear-gradient(180deg, rgba(45,28,22,.06), rgba(38,25,21,.74)) !important; }
.eyebrow { color: #ffd0a1 !important; }
.hero-em { color: #ffad78 !important; }
.hero-primary { background: #e95543 !important; box-shadow: 0 12rpx 28rpx rgba(233,85,67,.28) !important; }
.hero-secondary { border-color: rgba(255,255,255,.52) !important; background: rgba(255,255,255,.2) !important; }
.section-kicker, .history-kicker, .ask-entry-kicker, .stat-unit { color: #d94d3e !important; }
.section-title, .history-title, .ask-entry-title, .stat-num { color: #2b2524 !important; }
.stat-label, .result-meta, .filtered-text, .ask-entry-desc { color: rgba(43,37,36,.56) !important; }
.tool-chip { border-color: rgba(75,52,47,.14) !important; background: rgba(255,255,255,.58) !important; color: rgba(43,37,36,.68) !important; }
.tool-chip.active { border-color: #e95543 !important; background: #fff0eb !important; color: #d94d3e !important; }
.tool-clear { color: #d94d3e !important; }
.ask-entry { border-color: rgba(75,52,47,.12) !important; background: rgba(255,255,255,.58) !important; box-shadow: 0 14rpx 32rpx rgba(90,62,52,.08) !important; }
.ask-entry-arrow { background: #fff0eb !important; color: #d94d3e !important; }
.footer { border-top-color: rgba(75,52,47,.1) !important; }
.footer text { color: rgba(43,37,36,.42) !important; }
.mobile-tabbar { background: rgba(255,252,249,.86) !important; border-color: rgba(90,62,52,.14) !important; box-shadow: 0 16rpx 40rpx rgba(90,62,52,.16) !important; }
.tab-item { color: rgba(43,37,36,.46) !important; }
.tab-active { color: #d94d3e !important; background: #fff0eb !important; }
</style>

<style scoped>
/* Final light mood pass: the warm red and ivory palette keeps the image inviting. */
.app-shell { background: #f5f1ed !important; color: #2b2524 !important; }
.topbar { background: rgba(245,241,237,.8) !important; border-bottom-color: rgba(64,47,43,.1) !important; }
.brand-mark { background: #e95543 !important; color: #fffaf6 !important; box-shadow: 0 8rpx 22rpx rgba(233,85,67,.2) !important; }
.brand-name { color: #2b2524 !important; }
.brand-sub, .topbar-note { color: rgba(43,37,36,.48) !important; }
.nav-item { color: rgba(43,37,36,.52) !important; }
.nav-active { color: #2b2524 !important; background: rgba(255,255,255,.68) !important; }
.nav-active::after { background: #e95543 !important; }
.hero { background: #d8c7ba !important; box-shadow: 0 24rpx 64rpx rgba(113,76,58,.16) !important; }
.hero::before { background: linear-gradient(180deg, rgba(45,28,22,.06), rgba(38,25,21,.74)) !important; }
.eyebrow { color: #ffd0a1 !important; }
.hero-em { color: #ffad78 !important; }
.hero-primary { background: #e95543 !important; box-shadow: 0 12rpx 28rpx rgba(233,85,67,.28) !important; }
.hero-secondary { border-color: rgba(255,255,255,.52) !important; background: rgba(255,255,255,.2) !important; }
.section-kicker, .history-kicker, .ask-entry-kicker, .stat-unit { color: #d94d3e !important; }
.section-title, .history-title, .ask-entry-title, .stat-num { color: #2b2524 !important; }
.stat-label, .result-meta, .filtered-text, .ask-entry-desc { color: rgba(43,37,36,.56) !important; }
.tool-chip { border-color: rgba(75,52,47,.14) !important; background: rgba(255,255,255,.58) !important; color: rgba(43,37,36,.68) !important; }
.tool-chip.active { border-color: #e95543 !important; background: #fff0eb !important; color: #d94d3e !important; }
.tool-clear { color: #d94d3e !important; }
.ask-entry { border-color: rgba(75,52,47,.12) !important; background: rgba(255,255,255,.58) !important; box-shadow: 0 14rpx 32rpx rgba(90,62,52,.08) !important; }
.ask-entry-arrow { background: #fff0eb !important; color: #d94d3e !important; }
.footer { border-top-color: rgba(75,52,47,.1) !important; }
.footer text { color: rgba(43,37,36,.42) !important; }
.mobile-tabbar { background: rgba(255,252,249,.86) !important; border-color: rgba(90,62,52,.14) !important; box-shadow: 0 16rpx 40rpx rgba(90,62,52,.16) !important; }
.tab-item { color: rgba(43,37,36,.46) !important; }
.tab-active { color: #d94d3e !important; background: #fff0eb !important; }
</style>

<style scoped>
/* Final visual direction: warm editorial music-app light mode. */
.app-shell { background: #f5f1ed !important; color: #2b2524 !important; padding-bottom: calc(118rpx + env(safe-area-inset-bottom)) !important; }
.topbar { background: rgba(245,241,237,.78) !important; border-bottom-color: rgba(64,47,43,.1) !important; backdrop-filter: blur(28px) saturate(145%) !important; }
.brand-mark { background: #e95543 !important; color: #fffaf6 !important; box-shadow: 0 8rpx 22rpx rgba(233,85,67,.2) !important; }
.brand-name { color: #2b2524 !important; }
.brand-sub, .topbar-note { color: rgba(43,37,36,.48) !important; }
.nav-item { color: rgba(43,37,36,.52) !important; }
.nav-active { color: #2b2524 !important; background: rgba(255,255,255,.68) !important; box-shadow: 0 5rpx 16rpx rgba(93,62,52,.08) !important; }
.nav-active::after { background: #e95543 !important; }
.page-wrap { max-width: 760px !important; padding: 22rpx 22rpx 40rpx !important; }
.hero { border-color: rgba(255,255,255,.76) !important; background: #d8c7ba !important; box-shadow: 0 24rpx 64rpx rgba(113,76,58,.16) !important; }
.hero-backdrop { opacity: .93 !important; filter: saturate(.92) contrast(.97) !important; }
.hero::before { background: linear-gradient(180deg, rgba(45,28,22,.06), rgba(38,25,21,.74)) !important; }
.hero-copy { min-height: 720rpx !important; }
.eyebrow { color: #ffd0a1 !important; }
.hero-date { color: rgba(255,250,246,.76) !important; }
.hero-title { color: #fffaf6 !important; text-shadow: 0 8rpx 24rpx rgba(50,25,18,.2) !important; }
.hero-em { color: #ffad78 !important; }
.hero-lede { color: rgba(255,250,246,.84) !important; }
.hero-primary { background: #e95543 !important; box-shadow: 0 12rpx 28rpx rgba(233,85,67,.28) !important; }
.hero-secondary { border-color: rgba(255,255,255,.52) !important; background: rgba(255,255,255,.2) !important; color: #fffaf6 !important; }
.hero-stats { border-top-color: rgba(255,255,255,.34) !important; }
.stat-num { color: #fffaf6 !important; }
.stat-unit { color: #ffd0a1 !important; }
.stat-label { color: rgba(255,250,246,.7) !important; }
.hero-visual-label, .hero-visual-caption { color: rgba(255,250,246,.78) !important; }
.hero-visual-dot { color: #ffad78 !important; }
.section-kicker, .history-kicker, .ask-entry-kicker { color: #d94d3e !important; }
.section-title, .history-title, .ask-entry-title { color: #2b2524 !important; }
.result-meta, .filtered-text, .ask-entry-desc { color: rgba(43,37,36,.56) !important; }
.tool-chip { border-color: rgba(75,52,47,.14) !important; background: rgba(255,255,255,.58) !important; color: rgba(43,37,36,.68) !important; box-shadow: 0 5rpx 14rpx rgba(90,62,52,.05) !important; }
.tool-chip.active { border-color: #e95543 !important; background: #fff0eb !important; color: #d94d3e !important; }
.tool-clear { color: #d94d3e !important; }
.ask-entry { border-color: rgba(75,52,47,.12) !important; background: rgba(255,255,255,.58) !important; box-shadow: 0 14rpx 32rpx rgba(90,62,52,.08) !important; backdrop-filter: blur(22px) !important; }
.ask-entry-arrow { background: #fff0eb !important; color: #d94d3e !important; }
.footer { border-top-color: rgba(75,52,47,.1) !important; }
.footer text { color: rgba(43,37,36,.42) !important; }
.mobile-tabbar { background: rgba(255,252,249,.84) !important; border-color: rgba(90,62,52,.14) !important; box-shadow: 0 16rpx 40rpx rgba(90,62,52,.16) !important; }
.tab-item { color: rgba(43,37,36,.46) !important; }
.tab-active { color: #d94d3e !important; background: #fff0eb !important; }
@media (max-width: 620px) { .hero, .hero-copy { min-height: 660rpx !important; } .hero-title { font-size: 58rpx !important; } .page-wrap { padding: 16rpx !important; } }
</style>

<style scoped>
/* App direction: warm midnight glass, with the food image doing the visual work. */
.app-shell { min-height: 100vh; padding-bottom: calc(118rpx + env(safe-area-inset-bottom)); color: #f7f3eb; background: #101112; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'PingFang SC', sans-serif; }
.topbar { position: sticky; top: 0; z-index: 100; padding: 18rpx 28rpx; border-bottom: 1px solid rgba(255,255,255,.09); background: rgba(16,17,18,.72); backdrop-filter: blur(28px) saturate(150%); }
.brand-mark { width: 58rpx; height: 58rpx; margin-right: 16rpx; border-radius: 18rpx; background: #ff6b45; color: #fff8ef; box-shadow: 0 8rpx 24rpx rgba(255,107,69,.25); }
.brand-name { color: #faf7f0; font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif; font-size: 28rpx; }
.brand-sub { color: rgba(247,243,235,.5); }
.topbar-nav { gap: 4rpx; margin-right: 12rpx; }
.nav-item { min-height: 70rpx; padding: 0 18rpx; border-radius: 36rpx; color: rgba(247,243,235,.58); }
.nav-active { color: #fff; background: rgba(255,255,255,.1); }
.nav-active::after { background: #ff7b51; }
.topbar-note { color: rgba(247,243,235,.45); }
.page-wrap { max-width: 760px; padding: 22rpx 22rpx 40rpx; }
.hero { display: block; position: relative; min-height: 720rpx; overflow: hidden; border: 1px solid rgba(255,255,255,.14); border-radius: 36rpx; background: #25201c; box-shadow: 0 28rpx 80rpx rgba(0,0,0,.34); }
.hero-backdrop { position: absolute; inset: 0; width: 100%; height: 100%; opacity: .88; transform: scale(1.04); filter: saturate(1.12) contrast(1.04); }
.hero::before { content: ''; position: absolute; inset: 0; z-index: 1; background: linear-gradient(180deg, rgba(12,12,12,.18) 0%, rgba(12,12,12,.12) 28%, rgba(12,12,12,.9) 100%); }
.hero::after { display: none; }
.hero-copy { position: relative; z-index: 2; display: flex; flex-direction: column; min-height: 720rpx; box-sizing: border-box; padding: 34rpx 30rpx 28rpx; }
.hero-meta { color: rgba(255,255,255,.7); }
.eyebrow { color: #ffb36b; font-size: 18rpx; letter-spacing: .16em; }
.hero-date { color: rgba(255,255,255,.66); }
.hero-title { margin-top: auto; color: #fffaf1; font-size: 66rpx; line-height: 1.08; letter-spacing: -.055em; text-shadow: 0 8rpx 24rpx rgba(0,0,0,.28); }
.hero-em { color: #ff8b5d; }
.hero-lede { max-width: 520rpx; margin-top: 22rpx; color: rgba(255,250,241,.78); font-size: 25rpx; line-height: 1.65; }
.hero-actions { margin-top: 28rpx; gap: 12rpx; }
.hero-primary, .hero-secondary { min-height: 82rpx; border: 1px solid rgba(255,255,255,.18); border-radius: 42rpx; backdrop-filter: blur(20px); }
.hero-primary { padding: 0 26rpx; background: #ff6b45; color: #fff; box-shadow: 0 12rpx 30rpx rgba(255,107,69,.3); }
.hero-primary-arrow { color: #fff; }
.hero-secondary { padding: 0 24rpx; color: #fff; background: rgba(255,255,255,.13); }
.hero-stats { gap: 24rpx; margin-top: 28rpx; padding: 22rpx 20rpx 4rpx; border-top: 1px solid rgba(255,255,255,.18); }
.stat-num { color: #fff; font-size: 34rpx; }
.stat-unit { color: #ffb36b; }
.stat-label { color: rgba(255,255,255,.58); }
.hero-visual { position: absolute; inset: 0; z-index: 2; min-height: 0; pointer-events: none; }
.hero-visual-label { position: absolute; top: 30rpx; left: 30rpx; right: 30rpx; display: flex; justify-content: space-between; color: rgba(255,255,255,.72); font-size: 17rpx; letter-spacing: .14em; }
.hero-visual-dot { color: #ff8b5d; }
.hero-visual-caption { position: absolute; right: 30rpx; bottom: 30rpx; left: 30rpx; display: flex; justify-content: space-between; color: rgba(255,255,255,.62); font-size: 18rpx; }
.results-section { margin-top: 58rpx; scroll-margin-top: 120rpx; }
.section-kicker, .history-kicker, .ask-entry-kicker { color: #ff9d62; }
.section-title, .history-title, .ask-entry-title { color: #fffaf2; }
.result-meta, .filtered-text, .ask-entry-desc { color: rgba(247,243,235,.52); }
.tool-chip { border-color: rgba(255,255,255,.15); background: rgba(255,255,255,.06); color: rgba(255,255,255,.72); backdrop-filter: blur(16px); }
.tool-chip.active { border-color: rgba(255,139,93,.72); background: rgba(255,107,69,.2); color: #ffb36b; }
.tool-clear { color: #ff9d62; }
.filtered-empty { border-color: rgba(255,255,255,.14); background: rgba(255,255,255,.06); }
.filtered-empty .empty-action { background: #ff6b45; }
.ask-entry { border-color: rgba(255,255,255,.12); background: rgba(255,255,255,.07); box-shadow: 0 16rpx 36rpx rgba(0,0,0,.18); backdrop-filter: blur(22px); }
.ask-entry-arrow { background: rgba(255,107,69,.18); color: #ff9d62; }
.footer { padding-bottom: calc(30rpx + env(safe-area-inset-bottom)); border-top-color: rgba(255,255,255,.08); }
.footer text { color: rgba(247,243,235,.38); }
.mobile-tabbar { position: fixed; right: 18rpx; bottom: calc(18rpx + env(safe-area-inset-bottom)); left: 18rpx; z-index: 400; display: flex; align-items: center; justify-content: space-around; min-height: 96rpx; padding: 8rpx; border: 1px solid rgba(255,255,255,.16); border-radius: 32rpx; background: rgba(31,32,33,.82); box-shadow: 0 18rpx 50rpx rgba(0,0,0,.38); backdrop-filter: blur(26px) saturate(150%); }
.tab-item { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; min-height: 78rpx; border-radius: 24rpx; color: rgba(255,255,255,.5); font-size: 18rpx; transition: background .2s ease, color .2s ease; }
.tab-icon { margin-bottom: 5rpx; font-size: 31rpx; line-height: 1; }
.tab-active { color: #fff; background: rgba(255,107,69,.2); }
.tab-active .tab-icon { color: #ff986a; }
@media (min-width: 700px) { .mobile-tabbar { max-width: 420px; margin: 0 auto; } }
@media (max-width: 620px) { .page-wrap { padding: 16rpx 16rpx 38rpx; } .hero, .hero-copy { min-height: 660rpx; } .hero-title { font-size: 58rpx; } .hero-stats { gap: 14rpx; } .stat-label { font-size: 16rpx; } .recipe-list { gap: 16rpx; } }
@media (prefers-reduced-motion: reduce) { .tab-item { transition: none; } }
</style>

<style scoped>
.app-shell { min-height: 100vh; color: var(--apple-ink); background: var(--apple-bg); font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'PingFang SC', 'Microsoft YaHei', sans-serif; }
.app-shell::before { display: none; }
.topbar { position: sticky; top: 0; z-index: 100; min-height: 88rpx; padding: 18rpx 42rpx; border-bottom: 1px solid var(--apple-line-soft); background: rgba(245,245,247,.84); backdrop-filter: blur(24px); }
.brand { flex-shrink: 0; }
.brand-mark { width: 58rpx; height: 58rpx; margin-right: 16rpx; border-radius: 17rpx; background: var(--apple-ink); color: #fff; font-family: Georgia, serif; font-size: 27rpx; box-shadow: none; }
.brand-name { color: var(--apple-ink); font-size: 28rpx; font-weight: 700; letter-spacing: -.02em; }
.brand-sub { margin-top: 3rpx; color: var(--apple-muted); font-size: 17rpx; letter-spacing: .01em; }
.topbar-nav { display: flex; align-items: center; gap: 10rpx; margin-left: auto; margin-right: 32rpx; }
.nav-item { min-height: 64rpx; padding: 0 22rpx; display: flex; align-items: center; color: var(--apple-ink-soft); font-size: 22rpx; }
.nav-active { color: var(--apple-ink); font-weight: 700; }
.nav-active::after { content: ''; width: 8rpx; height: 8rpx; margin-left: 10rpx; border-radius: 50%; background: var(--apple-blue); }
.nav-item, .hero-primary, .hero-secondary, .tool-chip, .tool-clear, .ask-entry { min-height: 44px; }
.topbar-note { display: flex; align-items: center; gap: 10rpx; color: var(--apple-muted); font-size: 18rpx; }
.note-dot { color: var(--apple-green); font-size: 12rpx; }
.page-wrap { max-width: 1160px; margin: 0 auto; padding: 30rpx 34rpx 100rpx; }
.hero { display: grid; grid-template-columns: minmax(0, 1.12fr) minmax(310px, .88fr); min-height: 520rpx; overflow: hidden; border: 1px solid var(--apple-line-soft); border-radius: 30rpx; background: var(--apple-surface); box-shadow: var(--apple-shadow); }
.hero-copy { display: flex; flex-direction: column; padding: 54rpx 54rpx 42rpx; }
.hero-meta { display: flex; align-items: center; justify-content: space-between; color: var(--apple-muted); }
.eyebrow { color: var(--apple-blue); font-size: 19rpx; font-weight: 700; letter-spacing: .14em; }
.hero-date { color: var(--apple-muted); font-family: Georgia, serif; font-size: 19rpx; letter-spacing: .08em; }
.hero-title { display: flex; flex-direction: column; margin-top: 74rpx; color: var(--apple-ink); font-size: clamp(48rpx, 6vw, 76rpx); line-height: 1.12; font-weight: 700; letter-spacing: -.06em; }
.hero-em { color: var(--apple-blue); }
.hero-lede { max-width: 560rpx; margin-top: 26rpx; color: var(--apple-ink-soft); font-size: 26rpx; line-height: 1.75; }
.hero-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 14rpx; margin-top: 36rpx; }
.hero-primary, .hero-secondary { min-height: 76rpx; display: flex; align-items: center; justify-content: center; border-radius: 40rpx; font-size: 23rpx; transition: transform .2s ease, background .2s ease; }
.hero-primary { gap: 22rpx; padding: 0 27rpx; background: var(--apple-ink); color: #fff; font-weight: 700; }
.hero-primary-arrow { color: #b8d9ff; font-size: 30rpx; }
.hero-secondary { padding: 0 25rpx; border: 1px solid var(--apple-line); color: var(--apple-ink); background: var(--apple-surface); }
.hero-primary:active, .hero-secondary:active { transform: scale(.97); }
.hero-stats { display: flex; gap: 46rpx; margin-top: auto; padding-top: 30rpx; border-top: 1px solid var(--apple-line-soft); }
.stat { min-width: 0; }
.stat-num { display: block; color: var(--apple-ink); font-family: Georgia, serif; font-size: 36rpx; line-height: 1; font-weight: 700; }
.stat-unit { margin-left: 4rpx; color: var(--apple-muted); font-size: 17rpx; }
.stat-label { display: block; margin-top: 10rpx; color: var(--apple-muted); font-size: 18rpx; white-space: nowrap; }
.hero-visual { position: relative; min-height: 520rpx; overflow: hidden; background: #e8f2ff; }
.hero-visual::before { content: ''; position: absolute; inset: 0; background: linear-gradient(140deg, rgba(255,255,255,.38), transparent 46%), linear-gradient(180deg, transparent 50%, rgba(0,113,227,.11)); }
.hero-visual-label { position: absolute; top: 32rpx; left: 34rpx; right: 34rpx; z-index: 1; display: flex; align-items: center; justify-content: space-between; color: rgba(29,29,31,.56); font-size: 17rpx; font-weight: 700; letter-spacing: .12em; }
.hero-visual-dot { color: var(--apple-blue); font-size: 11rpx; }
.hero-art { position: absolute; right: 4%; bottom: 70rpx; width: 82%; height: 74%; object-fit: contain; filter: drop-shadow(0 24rpx 24rpx rgba(0,55,120,.16)); }
.hero-visual-caption { position: absolute; right: 34rpx; bottom: 30rpx; left: 34rpx; z-index: 1; display: flex; justify-content: space-between; gap: 12rpx; color: rgba(29,29,31,.74); font-size: 18rpx; }
.hero-visual-caption text:last-child { color: rgba(29,29,31,.5); }
.ai-notice { display: flex; align-items: flex-start; margin-top: 24rpx; padding: 20rpx 24rpx; border: 1px solid #c9ddf6; border-left: 4rpx solid var(--apple-blue); border-radius: 18rpx; background: var(--apple-blue-soft); }
.ai-notice-text { color: #2d5b8f; font-size: 23rpx; line-height: 1.7; }
.results-section { position: relative; margin-top: 76rpx; scroll-margin-top: 130rpx; }
.results-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 20rpx; flex-wrap: wrap; margin-bottom: 28rpx; }
.section-kicker { display: block; color: var(--apple-blue); font-size: 18rpx; font-weight: 700; letter-spacing: .14em; }
.section-title { display: block; margin-top: 8rpx; color: var(--apple-ink); font-size: 42rpx; font-weight: 700; letter-spacing: -.04em; }
.result-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 9rpx; }
.result-meta { margin-right: 5rpx; color: var(--apple-muted); font-size: 21rpx; }
.tool-chip { min-height: 58rpx; padding: 0 18rpx; display: flex; align-items: center; border: 1px solid var(--apple-line); border-radius: 30rpx; background: rgba(255,255,255,.6); color: var(--apple-ink-soft); font-size: 20rpx; }
.tool-chip.active { border-color: var(--apple-blue); background: var(--apple-blue-soft); color: var(--apple-blue); font-weight: 700; }
.tool-clear { min-height: 58rpx; display: flex; align-items: center; color: var(--apple-blue); font-size: 20rpx; }
.recipe-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18rpx; }
.filtered-empty { border-color: var(--apple-line); border-radius: 22rpx; background: var(--apple-surface); }
.filtered-text { color: var(--apple-ink-soft); }
.filtered-empty .empty-action { border-radius: 30rpx; background: var(--apple-blue); color: #fff; }
.ask-entry { display: flex; align-items: center; justify-content: space-between; margin-top: 34rpx; padding: 28rpx 30rpx; border: 1px solid var(--apple-line-soft); border-radius: 22rpx; background: var(--apple-surface); box-shadow: 0 10rpx 30rpx rgba(0,0,0,.04); }
.ask-entry-kicker { display: block; color: var(--apple-blue); font-size: 17rpx; font-weight: 700; letter-spacing: .14em; }
.ask-entry-title { display: block; margin-top: 7rpx; color: var(--apple-ink); font-size: 32rpx; font-weight: 700; }
.ask-entry-desc { display: block; margin-top: 10rpx; color: var(--apple-ink-soft); font-size: 22rpx; }
.ask-entry-arrow { width: 66rpx; height: 66rpx; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--apple-blue-soft); color: var(--apple-blue); font-size: 28rpx; }
.footer { display: flex; flex-direction: column; align-items: center; padding: 30rpx 38rpx calc(56rpx + env(safe-area-inset-bottom)); border-top: 1px solid var(--apple-line-soft); }
.footer text { color: var(--apple-muted); font-size: 19rpx; line-height: 1.8; text-align: center; }
@media (max-width: 900px) { .hero { grid-template-columns: 1fr; } .hero-visual { min-height: 300rpx; } .hero-art { right: 17%; width: 66%; height: 84%; bottom: 20rpx; } .hero-visual-caption { bottom: 22rpx; } .recipe-list { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 620px) { .topbar { padding: 16rpx 24rpx; } .topbar-nav { margin-right: 10rpx; } .nav-item { padding: 0 10rpx; font-size: 20rpx; } .topbar-note { display: none; } .page-wrap { padding: 18rpx 20rpx 80rpx; } .hero { border-radius: 24rpx; } .hero-copy { min-height: 560rpx; padding: 34rpx 28rpx 28rpx; } .hero-title { margin-top: 66rpx; font-size: 58rpx; } .hero-lede { font-size: 24rpx; } .hero-stats { gap: 22rpx; } .stat-label { font-size: 17rpx; } .hero-visual { min-height: 260rpx; } .hero-visual-label { top: 24rpx; left: 26rpx; right: 26rpx; } .hero-visual-caption { right: 26rpx; bottom: 20rpx; left: 26rpx; } .results-section { margin-top: 58rpx; } .section-title { font-size: 36rpx; } .recipe-list { grid-template-columns: 1fr; gap: 14rpx; } .results-heading { align-items: flex-start; } .result-tools { width: 100%; } .tool-chip, .tool-clear { min-height: 44px; } }
@media (prefers-reduced-motion: reduce) { .hero-primary, .hero-secondary { transition: none; } }
</style>

<style scoped>
/* Keep the skin last in the cascade so the app remains glassy after legacy styles compile. */
.app-shell { background: #f5f1ed !important; color: #2b2524 !important; padding-bottom: calc(118rpx + env(safe-area-inset-bottom)) !important; }
.topbar { padding: 18rpx 28rpx !important; background: rgba(245,241,237,.8) !important; border-bottom-color: rgba(64,47,43,.1) !important; backdrop-filter: blur(28px) saturate(145%) !important; }
.brand-mark { background: #e95543 !important; color: #fffaf6 !important; box-shadow: 0 8rpx 22rpx rgba(233,85,67,.2) !important; }
.brand-name { color: #2b2524 !important; }
.brand-sub, .topbar-note { color: rgba(43,37,36,.48) !important; }
.nav-item { min-height: 70rpx !important; padding: 0 18rpx !important; border-radius: 36rpx !important; color: rgba(43,37,36,.52) !important; }
.nav-active { color: #2b2524 !important; background: rgba(255,255,255,.68) !important; }
.page-wrap { max-width: 760px !important; padding: 22rpx 22rpx 40rpx !important; }
.hero { display: block !important; position: relative !important; min-height: 720rpx !important; overflow: hidden !important; border-radius: 36rpx !important; border-color: rgba(255,255,255,.76) !important; background: #d8c7ba !important; box-shadow: 0 24rpx 64rpx rgba(113,76,58,.16) !important; }
.hero-backdrop { position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; opacity: .88 !important; transform: scale(1.04) !important; filter: saturate(1.12) contrast(1.04) !important; }
.hero::before { content: '' !important; position: absolute !important; inset: 0 !important; z-index: 1 !important; background: linear-gradient(180deg, rgba(45,28,22,.06), rgba(38,25,21,.74)) !important; }
.hero-copy { position: relative !important; z-index: 2 !important; display: flex !important; flex-direction: column !important; min-height: 720rpx !important; padding: 34rpx 30rpx 28rpx !important; box-sizing: border-box !important; }
.hero-title { margin-top: auto !important; color: #fffaf6 !important; font-size: 66rpx !important; line-height: 1.08 !important; letter-spacing: -.055em !important; }
.hero-em { color: #ffad78 !important; }
.hero-lede { color: rgba(255,250,241,.78) !important; }
.hero-primary { background: #e95543 !important; color: #fff !important; box-shadow: 0 12rpx 28rpx rgba(233,85,67,.28) !important; }
.hero-secondary { border-color: rgba(255,255,255,.52) !important; color: #fffaf6 !important; background: rgba(255,255,255,.2) !important; }
.hero-stats { border-top-color: rgba(255,255,255,.18) !important; }
.stat-num, .section-title, .history-title, .ask-entry-title { color: #2b2524 !important; }
.stat-unit, .section-kicker, .history-kicker, .ask-entry-kicker { color: #d94d3e !important; }
.stat-label, .result-meta, .filtered-text, .ask-entry-desc { color: rgba(43,37,36,.56) !important; }
.hero-visual { position: absolute !important; inset: 0 !important; z-index: 2 !important; min-height: 0 !important; pointer-events: none !important; }
.hero-visual-label { top: 30rpx !important; left: 30rpx !important; right: 30rpx !important; color: rgba(255,255,255,.72) !important; }
.hero-visual-caption { right: 30rpx !important; bottom: 30rpx !important; left: 30rpx !important; color: rgba(255,255,255,.62) !important; }
.tool-chip { border-color: rgba(75,52,47,.14) !important; background: rgba(255,255,255,.58) !important; color: rgba(43,37,36,.68) !important; }
.tool-chip.active { border-color: #e95543 !important; background: #fff0eb !important; color: #d94d3e !important; }
.tool-clear { color: #d94d3e !important; }
.ask-entry { border-color: rgba(75,52,47,.12) !important; background: rgba(255,255,255,.58) !important; box-shadow: 0 14rpx 32rpx rgba(90,62,52,.08) !important; backdrop-filter: blur(22px) !important; }
.ask-entry-arrow { background: #fff0eb !important; color: #d94d3e !important; }
.footer { border-top-color: rgba(75,52,47,.1) !important; }
.footer text { color: rgba(43,37,36,.42) !important; }
.mobile-tabbar { position: fixed !important; right: auto !important; bottom: 0 !important; left: 0 !important; z-index: 400 !important; display: flex !important; align-items: stretch !important; justify-content: space-around !important; width: 100% !important; min-height: 108rpx !important; margin: 0 !important; padding: 10rpx 14rpx calc(10rpx + env(safe-area-inset-bottom)) !important; box-sizing: border-box !important; border: 0 !important; border-top: 1px solid rgba(95,108,94,.13) !important; border-radius: 0 !important; background: #fffefa !important; box-shadow: none !important; backdrop-filter: none !important; }
.tab-item { display: flex !important; flex: 1 !important; flex-direction: column !important; align-items: center !important; justify-content: center !important; min-height: 88rpx !important; margin: 0 !important; border-radius: 0 !important; color: #7b877e !important; font-size: 18rpx !important; letter-spacing: 0 !important; }
.tab-icon { display: flex !important; align-items: center !important; justify-content: center !important; width: 40rpx !important; height: 40rpx !important; margin-bottom: 7rpx !important; color: inherit !important; font-size: 30rpx !important; line-height: 1 !important; font-family: Georgia, serif !important; }
.tab-plan { border: 2rpx solid currentColor; border-radius: 50%; font-family: -apple-system, BlinkMacSystemFont, sans-serif !important; font-size: 26rpx !important; }
.tab-report { font-family: -apple-system, BlinkMacSystemFont, sans-serif !important; font-size: 31rpx !important; transform: scaleX(.82); }
.tab-me { font-size: 26rpx !important; }
.tab-active { color: #f05d4b !important; background: transparent !important; font-weight: 600 !important; }
@media (max-width: 620px) { .hero, .hero-copy { min-height: 660rpx !important; } .hero-title { font-size: 58rpx !important; } .page-wrap { padding: 16rpx !important; } }
</style>

<style scoped>
.app-shell { background: var(--archive-paper) !important; color: var(--archive-ink) !important; }
.topbar { background: rgba(241,234,217,.98) !important; border-bottom-color: var(--archive-line-soft) !important; backdrop-filter: none !important; }
.brand-mark { background: var(--archive-olive) !important; box-shadow: none !important; }
.brand-name, .section-title, .ask-entry-title { color: var(--archive-ink) !important; }
.brand-sub, .topbar-note, .hero-lede, .stat-label, .result-meta, .filtered-text, .ask-entry-desc { color: var(--archive-soft) !important; }
.nav-item { color: var(--archive-soft) !important; }
.nav-active { color: var(--archive-tomato) !important; background: transparent !important; }
.hero { display: flex !important; flex-direction: column !important; min-height: 0 !important; padding: 0 !important; border: 1px solid var(--archive-line-soft) !important; border-radius: 4rpx !important; background: var(--archive-card) !important; box-shadow: var(--archive-shadow) !important; }
.hero-backdrop { position: relative !important; order: 2 !important; inset: auto !important; width: 100% !important; height: 300rpx !important; opacity: 1 !important; transform: none !important; filter: saturate(.9) !important; }
.hero-copy { order: 1 !important; min-height: 0 !important; padding: 32rpx 28rpx 28rpx !important; color: var(--archive-ink) !important; }
.hero::before, .hero::after, .hero-visual { display: none !important; }
.eyebrow, .section-kicker, .ask-entry-kicker { color: var(--archive-tomato) !important; }
.hero-title { margin-top: 34rpx !important; color: var(--archive-ink) !important; font: 600 52rpx/1.2 'Songti SC', 'Noto Serif CJK SC', serif !important; letter-spacing: 0 !important; text-shadow: none !important; }
.hero-em { color: var(--archive-tomato) !important; }
.hero-primary { border-radius: 2rpx !important; background: var(--archive-tomato) !important; box-shadow: none !important; }
.hero-secondary { border-color: var(--archive-line) !important; border-radius: 2rpx !important; color: var(--archive-ink) !important; background: transparent !important; }
.hero-stats { border-top-color: var(--archive-line-soft) !important; }
.stat-num { color: var(--archive-ink) !important; }
.stat-unit { color: var(--archive-olive) !important; }
.ai-notice { border-left-color: var(--archive-olive) !important; background: var(--archive-olive-soft) !important; }
.tool-chip { border-color: var(--archive-line) !important; border-radius: 2rpx !important; background: transparent !important; color: var(--archive-soft) !important; }
.tool-chip.active { border-color: var(--archive-olive) !important; background: var(--archive-olive) !important; color: #fffaf0 !important; }
.tool-clear { color: var(--archive-tomato) !important; }
.recipe-list { display: flex !important; flex-direction: column !important; gap: 14rpx !important; }
.filtered-empty, .ask-entry { border-radius: 2rpx !important; background: var(--archive-card) !important; box-shadow: var(--archive-shadow) !important; }
.ask-entry-arrow { border-radius: 2rpx !important; background: var(--archive-olive-soft) !important; color: var(--archive-olive) !important; }
.footer { border-top-color: var(--archive-line-soft) !important; }
.footer text { color: var(--archive-muted) !important; }
.mobile-tabbar { right: 0 !important; bottom: 0 !important; left: 0 !important; width: 100% !important; min-height: 108rpx !important; padding: 10rpx 14rpx calc(10rpx + env(safe-area-inset-bottom)) !important; border: 0 !important; border-top: 1px solid var(--archive-line-soft) !important; border-radius: 0 !important; background: rgba(255,250,240,.98) !important; box-shadow: none !important; backdrop-filter: none !important; }
.tab-item { min-height: 88rpx !important; color: var(--archive-soft) !important; background: transparent !important; }
.tab-active { color: var(--archive-tomato) !important; }
@media (max-width: 620px) { .hero-backdrop { height: 280rpx !important; } }
</style>
