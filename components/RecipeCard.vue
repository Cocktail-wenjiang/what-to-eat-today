<template>
	<view class="recipe-card" :class="'accent-' + ((index % 3) + 1)">
		<!-- 菜品图：旧历史记录可能缺 image，此时不渲染，保持原有排版不变 -->
		<image v-if="recipe.image" class="recipe-cover" :src="recipe.image" mode="aspectFill" />

		<view class="recipe-topline">
			<text class="recipe-index">{{ padIndex(index) }}</text>
			<text class="recipe-time">◷ {{ recipe.minutes }} MIN</text>
		</view>

		<view class="recipe-main">
			<view class="recipe-info">
				<text class="recipe-name">{{ recipe.name }}</text>
				<text class="ingredients">
					{{ visibleIngredients.join(' · ') }}
					<text v-if="hiddenCount">等 {{ recipe.ingredients.length }} 种</text>
				</text>
				<view class="tag-list">
					<text v-for="tag in recipe.tags" :key="tag" class="tag">{{ tag }}</text>
				</view>
			</view>
			<view class="recipe-score">
				<text class="score-num">{{ recipe.minutes }}</text>
				<text class="score-unit">分钟上桌</text>
			</view>
		</view>

		<!-- ===== 为什么推荐这道菜 ===== -->
		<view v-if="reasonText" class="recipe-reason">
			<text class="reason-icon">✳</text>
			<text class="reason-text">{{ reasonText }}</text>
		</view>
		<view v-if="fitTags.length" class="fit-list">
			<text v-for="tag in fitTags" :key="tag" class="fit-tag">{{ tag }}</text>
		</view>

		<view class="steps">
			<text v-for="(step, i) in previewSteps" :key="i" class="step-item">
				{{ i + 1 }}. {{ step }}
			</text>
		</view>

		<button class="recipe-detail-btn" @tap="$emit('detail', recipe)">
			<text>
				查看完整做法<text v-if="(recipe.steps || []).length"> · {{ recipe.steps.length }} 步</text>
			</text>
			<text class="detail-arrow">↗</text>
		</button>
	</view>
</template>

<script setup>
/**
 * 菜谱卡片 —— 展示单条推荐结果
 * 卡片内展示概要，点击「查看完整做法」由父组件打开详情弹窗。
 */
import { computed } from 'vue'
import { padIndex } from '../utils/format.js'

const props = defineProps({
	recipe: { type: Object, required: true },
	index: { type: Number, default: 0 }
})

defineEmits(['detail'])

/** 食材过多时折叠显示，避免卡片高度失控 */
const visibleIngredients = computed(() => (props.recipe.ingredients || []).slice(0, 6))
const hiddenCount = computed(() => Math.max((props.recipe.ingredients || []).length - 6, 0))
/** 卡片上只预览前两步，完整步骤进详情 */
const previewSteps = computed(() => (props.recipe.steps || []).slice(0, 2))

/**
 * 本次命中的短标签。
 * 云函数与本地规则都会生成；旧的历史记录可能没有，此时不展示即可。
 */
const fitTags = computed(() => (Array.isArray(props.recipe.fitTags) ? props.recipe.fitTags : []))

/**
 * 推荐理由。
 * 优先用数据源给出的 reason；旧历史记录缺失时，退化为一句中性的客观描述，
 * 而不是伪造「符合你的口味」这类无法验证的说法。
 */
const reasonText = computed(() => {
	const recipe = props.recipe
	if (recipe.reason) return recipe.reason
	const parts = []
	const minutes = Number(recipe.minutes)
	if (Number.isFinite(minutes)) parts.push(`${minutes} 分钟可上桌`)
	const steps = (recipe.steps || []).length
	if (steps) parts.push(`共 ${steps} 步`)
	return parts.length ? `这道菜${parts.join('，')}。` : ''
})
</script>

<style scoped>
.recipe-card { display: flex; flex-direction: column; margin-bottom: 28rpx; padding: 32rpx 30rpx 26rpx; border: 1px solid #ddd5c7; border-top: 5rpx solid #d94b36; background: #fffcf5; }
/* 菜品图满幅贴卡片顶部：负边距抵消卡片内边距，保留杂志式通栏观感 */
.recipe-cover { display: block; height: 340rpx; margin: -32rpx -30rpx 26rpx; background: #eeeadf; }
.accent-2 { border-top-color: #87934b; }
.accent-3 { border-top-color: #c79846; }
.recipe-topline { display: flex; align-items: center; justify-content: space-between; }
.recipe-index { color: #b8422e; font-family: Georgia, serif; font-size: 24rpx; font-style: italic; }
.accent-2 .recipe-index { color: #626e3e; }
.accent-3 .recipe-index { color: #976718; }
.recipe-time { color: #878273; font-size: 20rpx; letter-spacing: .08em; }
.recipe-main { display: flex; align-items: flex-start; justify-content: space-between; margin-top: 28rpx; }
.recipe-info { flex: 1; min-width: 0; }
.recipe-name { display: block; color: #292d25; font-family: 'Songti SC', 'Noto Serif CJK SC', serif; font-size: 39rpx; line-height: 1.4; font-weight: 700; }
.ingredients { display: block; margin-top: 14rpx; color: #767466; font-size: 24rpx; line-height: 1.65; }
.tag-list { display: flex; flex-wrap: wrap; margin-top: 18rpx; }
.tag { margin: 0 10rpx 10rpx 0; padding: 5rpx 14rpx; background: #eeeadf; color: #676455; font-size: 21rpx; border-radius: 3rpx; }
.recipe-score { flex-shrink: 0; width: 100rpx; margin-left: 20rpx; text-align: right; }
.score-num { display: block; font-family: Georgia, serif; font-size: 60rpx; line-height: 1; color: #b8422e; }
.accent-2 .score-num { color: #626e3e; }
.accent-3 .score-num { color: #976718; }
.score-unit { display: block; margin-top: 10rpx; color: #878273; font-size: 19rpx; }
.recipe-reason { display: flex; align-items: flex-start; margin-top: 18rpx; padding: 22rpx; background: #eeefdf; border-radius: 4rpx; }
.reason-icon { flex-shrink: 0; margin-right: 12rpx; color: #626e3e; font-size: 28rpx; line-height: 1.45; }
.reason-text { flex: 1; color: #59603f; font-size: 24rpx; line-height: 1.65; }
.fit-list { display: flex; flex-wrap: wrap; margin-top: 15rpx; }
.fit-tag { padding: 5rpx 12rpx; margin: 0 10rpx 8rpx 0; color: #626e3e; font-size: 21rpx; border: 1px solid #d6d9bc; border-radius: 20rpx; }
.steps { margin-top: 16rpx; padding-top: 18rpx; border-top: 1px dashed #d9d3c7; }
.step-item { display: block; margin: 12rpx 0; color: #767466; font-size: 23rpx; line-height: 1.7; }
.recipe-detail-btn { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 88rpx; margin: 20rpx 0 0; padding: 0 20rpx; border: 1px solid #d9d3c7; border-radius: 4rpx; background: transparent; color: #292d25; font-size: 24rpx; text-align: left; }
.detail-arrow { display: flex; align-items: center; justify-content: center; margin-left: 12rpx; width: 48rpx; height: 48rpx; border-radius: 50%; background: #d94b36; color: #fff9ee; font-size: 27rpx; }
.recipe-detail-btn:active { transform: scale(.98); }
@media (prefers-reduced-motion: reduce) { .recipe-detail-btn:active { transform: none; } }
</style>

<style scoped>
.recipe-card { border-color: rgba(75,52,47,.12) !important; border-radius: 26rpx !important; background: rgba(255,255,255,.7) !important; box-shadow: 0 14rpx 30rpx rgba(90,62,52,.08) !important; backdrop-filter: blur(22px) !important; }
.recipe-cover { border-radius: 26rpx 26rpx 0 0 !important; filter: saturate(.94) contrast(.98) !important; }
.recipe-index, .score-num { color: #d94d3e !important; }
.recipe-time, .ingredients, .score-unit, .step-item { color: rgba(43,37,36,.52) !important; }
.recipe-name { color: #2b2524 !important; }
.tag { border-radius: 12rpx !important; color: rgba(43,37,36,.62) !important; background: #f8e9e3 !important; }
.recipe-reason { background: #fff0eb !important; }
.reason-icon, .reason-text { color: #c75143 !important; }
.fit-tag { border-color: #f2c5bb !important; color: #d94d3e !important; background: #fffaf8 !important; }
.steps { border-top-color: rgba(75,52,47,.1) !important; }
.recipe-detail-btn { border-color: rgba(75,52,47,.14) !important; border-radius: 34rpx !important; color: #2b2524 !important; background: rgba(255,255,255,.72) !important; }
.detail-arrow { background: #e95543 !important; }
</style>

<style scoped>
.recipe-card { min-height: 0; margin-bottom: 0; padding: 24rpx 24rpx 20rpx; border: 1px solid var(--apple-line-soft); border-top: 0; border-radius: 22rpx; background: var(--apple-surface); box-shadow: 0 12rpx 30rpx rgba(0,0,0,.055); transition: transform .2s ease, box-shadow .2s ease; }
.recipe-card::before { content: ''; display: block; width: 56rpx; height: 5rpx; margin-bottom: 22rpx; border-radius: 5rpx; background: var(--accent, var(--apple-blue)); }
.accent-1 { --accent: #0071e3; }
.accent-2 { --accent: #1d8a4a; }
.accent-3 { --accent: #b54708; }
.recipe-card:active { transform: scale(.985); }
.recipe-cover { height: 240rpx; margin: -24rpx -24rpx 22rpx; border-radius: 22rpx 22rpx 0 0; background: #eef0f3; }
.recipe-topline { align-items: center; }
.recipe-index { color: var(--accent); font-family: Georgia, serif; font-size: 19rpx; }
.recipe-time { color: var(--apple-muted); font-size: 18rpx; }
.recipe-main { margin-top: 20rpx; }
.recipe-name { color: var(--apple-ink); font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif; font-size: 29rpx; line-height: 1.35; letter-spacing: -.02em; }
.ingredients { margin-top: 10rpx; color: var(--apple-ink-soft); font-size: 20rpx; line-height: 1.55; }
.tag-list { margin-top: 14rpx; }
.tag { padding: 5rpx 11rpx; border: 0; border-radius: 8rpx; color: var(--apple-ink-soft); background: #f2f2f7; font-size: 18rpx; }
.recipe-score { width: 74rpx; margin-left: 12rpx; padding-left: 12rpx; border-left-color: var(--apple-line-soft); }
.score-num { color: var(--accent); font-size: 42rpx; }
.score-unit { color: var(--apple-muted); font-size: 17rpx; }
.recipe-reason { margin-top: 15rpx; padding: 14rpx; border-radius: 12rpx; background: #f2f7ff; }
.reason-icon, .reason-text { color: #2d5b8f; }
.reason-text { font-size: 19rpx; }
.fit-tag { border-color: #c9ddf6; color: var(--apple-blue); background: #f8fbff; }
.steps { margin-top: 16rpx; padding-top: 14rpx; border-top-color: var(--apple-line-soft); }
.step-item { margin: 8rpx 0; color: var(--apple-ink-soft); font-size: 20rpx; }
.recipe-detail-btn { min-height: 66rpx; margin-top: 16rpx; padding: 0 14rpx; border-color: var(--apple-line); border-radius: 33rpx; color: var(--apple-ink); background: #fff; font-size: 20rpx; }
.detail-arrow { width: 40rpx; height: 40rpx; background: var(--apple-blue); color: #fff; font-size: 22rpx; }
</style>

<style scoped>
.recipe-card { border-color: var(--space-line); border-radius: 22rpx; border-top-color: var(--accent, var(--space-cyan)); background: linear-gradient(155deg, rgba(25,30,60,.88), rgba(15,19,41,.82)); box-shadow: 0 16rpx 38rpx rgba(2,4,16,.2), 0 0 0 1px rgba(255,255,255,.02) inset; }
.accent-1 { --accent: #ff805b; }
.accent-2 { --accent: #9cf7df; }
.accent-3 { --accent: #b8c4ff; }
.recipe-cover { background: #1a2341; }
.recipe-index, .score-num { color: var(--accent, var(--space-cyan)); }
.accent-2 .recipe-index, .accent-2 .score-num { color: #9cf7df; }
.accent-3 .recipe-index, .accent-3 .score-num { color: #b8c4ff; }
.recipe-time, .ingredients, .score-unit, .step-item { color: var(--space-muted); }
.recipe-name { color: var(--space-text); }
.tag { border: 1px solid var(--space-line); border-radius: 10rpx; color: var(--space-text-soft); background: rgba(255,255,255,.05); }
.recipe-reason { background: rgba(156,247,223,.08); }
.reason-icon, .reason-text { color: var(--space-cyan); }
.fit-tag { border-color: rgba(156,247,223,.25); color: var(--space-cyan); }
.steps { border-top-color: var(--space-line); }
.recipe-detail-btn { border-color: var(--space-line); border-radius: 14rpx; color: var(--space-text-soft); background: rgba(255,255,255,.04); }
.detail-arrow { background: var(--space-cyan); color: #10142a; }
</style>
<style scoped>
.recipe-card { padding: 20rpx !important; border: 1px solid var(--archive-line-soft) !important; border-radius: 2rpx !important; background: var(--archive-card) !important; box-shadow: var(--archive-shadow) !important; }
.recipe-cover { height: 260rpx !important; margin: -20rpx -20rpx 20rpx !important; border-radius: 2rpx 2rpx 0 0 !important; filter: saturate(.9) !important; }
.recipe-index, .recipe-time { color: var(--archive-muted) !important; }
.recipe-name { color: var(--archive-ink) !important; font-family: 'Songti SC', 'Noto Serif CJK SC', serif !important; }
.ingredients, .step-item, .score-unit { color: var(--archive-soft) !important; }
.tag, .fit-tag { border: 1px solid var(--archive-line) !important; border-radius: 2rpx !important; color: var(--archive-olive) !important; background: var(--archive-olive-soft) !important; }
.score-num { color: var(--archive-tomato) !important; }
.steps { border-top-color: var(--archive-line-soft) !important; }
.recipe-detail-btn { min-height: 68rpx !important; border-color: var(--archive-line) !important; border-radius: 2rpx !important; color: var(--archive-ink) !important; background: transparent !important; }
.detail-arrow { border-radius: 2rpx !important; background: var(--archive-olive) !important; color: #fffaf0 !important; }
</style>
