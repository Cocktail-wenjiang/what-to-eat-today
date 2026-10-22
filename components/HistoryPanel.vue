<template>
	<view class="history-panel">
		<view class="history-head">
			<view>
				<text class="history-kicker">03 / 我的记录</text>
				<text class="history-title">留下过的菜单</text>
			</view>
			<text class="history-count">{{ items.length }}</text>
		</view>

		<text v-if="loading" class="history-state">正在读取历史记录…</text>

		<text v-else-if="!items.length" class="history-state">
			还没有留下记录，完成一次推荐后会自动保存在这里。
		</text>

		<view v-else>
			<view class="history-list">
				<view v-for="item in visibleItems" :key="item.id || item.createdAt" class="history-item">
					<view class="history-meta">
						<text class="history-time">{{ formatTime(item.createdAt) }}</text>
						<text v-if="modeLabel(item.mode)" class="history-mode">{{ modeLabel(item.mode) }}</text>
					</view>
					<text class="history-cond">{{ preferenceSummary(item) }}</text>
					<text class="history-result">{{ resultNames(item) }}</text>
					<view class="history-replay" @tap="$emit('replay', item)">
						<text>用这组条件</text>
					</view>
				</view>
			</view>

			<view v-if="canExpand" class="history-toggle" @tap="expanded = !expanded">
				<text>{{ expanded ? '收起 ↑' : `展开全部 ${items.length} 条 ↓` }}</text>
			</view>
		</view>
	</view>
</template>

<script setup>
/**
 * 历史记录面板
 * 默认只展示最近 3 条，可展开查看全部；点击「用这组条件」回填表单并重新推荐。
 */
import { computed, ref } from 'vue'
import { formatTime, modeLabel } from '../utils/format.js'

const props = defineProps({
	/** 历史条目数组 */
	items: { type: Array, default: () => [] },
	loading: { type: Boolean, default: false }
})

defineEmits(['replay'])

/** 折叠状态下展示的条数 */
const COLLAPSED_COUNT = 3
const expanded = ref(false)

const visibleItems = computed(() =>
	expanded.value ? props.items : props.items.slice(0, COLLAPSED_COUNT)
)

/** 是否值得显示展开按钮 */
const canExpand = computed(() => props.items.length > COLLAPSED_COUNT)

/** 「2 人 · 30 分钟 · 清淡 · 忌 花生」 */
function preferenceSummary(item) {
	const parts = [`${item.servings} 人`, `${item.maxMinutes} 分钟`, item.preference]
	if (item.allergy) parts.push(`忌 ${item.allergy}`)
	return parts.join(' · ')
}

/** 「番茄鸡胸肉意面、香菇青菜豆腐汤」 */
function resultNames(item) {
	const names = (item.recommendations || []).map((r) => r.name)
	return names.length ? names.join('、') : '（当次无匹配结果）'
}
</script>

<style scoped>
.history-panel { margin-top: 74rpx; padding-top: 30rpx; border-top: 1px solid #d9d3c7; }
.history-head { display: flex; align-items: center; justify-content: space-between; }
.history-kicker { display: block; color: #b8422e; font-family: Georgia, serif; font-size: 19rpx; letter-spacing: .12em; margin-bottom: 9rpx; }
.history-title { color: #292d25; font-family: 'Songti SC', 'Noto Serif CJK SC', serif; font-size: 37rpx; font-weight: 700; }
.history-count { color: #969283; font-family: Georgia, serif; font-size: 38rpx; font-style: italic; }
.history-state { display: block; margin-top: 26rpx; color: #767466; font-size: 25rpx; line-height: 1.8; }
.history-list { margin-top: 32rpx; padding-left: 20rpx; }
.history-item { position: relative; display: flex; flex-direction: column; padding: 0 0 30rpx 30rpx; border-left: 1px solid #d9d3c7; }
.history-item::before { content: ''; position: absolute; top: 8rpx; left: -7rpx; width: 12rpx; height: 12rpx; border-radius: 50%; background: #d94b36; box-shadow: 0 0 0 6rpx #f6f1e7; }
.history-meta { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8rpx; }
.history-time { color: #292d25; font-size: 24rpx; font-weight: 600; }
.history-mode { color: #767466; font-size: 21rpx; }
.history-cond { display: block; margin-top: 14rpx; color: #626e3e; font-size: 24rpx; line-height: 1.65; }
.history-result { display: block; margin-top: 9rpx; color: #767466; font-size: 23rpx; line-height: 1.7; }
.history-replay { align-self: flex-start; display: flex; align-items: center; min-height: 84rpx; padding: 0 22rpx; margin-top: 16rpx; border: 1px solid #d9d3c7; border-radius: 4rpx; color: #55564c; font-size: 23rpx; background: #fffcf5; }
.history-toggle { display: flex; align-items: center; justify-content: center; min-height: 88rpx; margin-top: 12rpx; border: 1px dashed #c9c1b3; color: #767466; font-size: 23rpx; }
</style>

<style scoped>
.history-panel { margin-top: 64rpx; padding: 30rpx; border: 1px solid var(--apple-line-soft); border-top: 1px solid var(--apple-line-soft); border-radius: 22rpx; background: var(--apple-surface); box-shadow: 0 12rpx 30rpx rgba(0,0,0,.04); }
.history-kicker { color: var(--apple-blue); }
.history-title { color: var(--apple-ink); font-size: 33rpx; }
.history-count { color: var(--apple-muted); }
.history-state, .history-mode, .history-result { color: var(--apple-muted); }
.history-time { color: var(--apple-ink); }
.history-cond { color: var(--apple-blue); }
.history-list { padding-left: 14rpx; }
.history-item { border-left-color: var(--apple-line); }
.history-item::before { background: var(--apple-blue); box-shadow: 0 0 0 6rpx #fff; }
.history-replay { min-height: 68rpx; padding: 0 20rpx; border-color: var(--apple-line); border-radius: 34rpx; color: var(--apple-blue); background: #fff; }
.history-toggle { min-height: 72rpx; border: 1px solid var(--apple-line); border-radius: 36rpx; color: var(--apple-ink-soft); background: #fff; }
@media (max-width: 620px) { .history-panel { padding: 24rpx 20rpx; } }
</style>

<style scoped>
.history-panel { border-top-color: var(--space-line); }
.history-kicker { color: var(--space-cyan); }
.history-title { color: var(--space-text); }
.history-count { color: var(--space-blue); }
.history-state, .history-mode, .history-result { color: var(--space-muted); }
.history-time { color: var(--space-text); }
.history-cond { color: var(--space-cyan); }
.history-item { border-left-color: var(--space-line); }
.history-item::before { background: var(--space-cyan); box-shadow: 0 0 0 6rpx var(--space-bg); }
.history-replay { border-color: var(--space-line); border-radius: 14rpx; color: var(--space-text-soft); background: rgba(255,255,255,.04); }
.history-toggle { border-color: var(--space-line); color: var(--space-muted); }
</style>
<style scoped>
.history-panel { margin-top: 52rpx !important; padding: 26rpx 22rpx !important; border: 1px solid var(--archive-line-soft) !important; border-radius: 2rpx !important; background: var(--archive-card) !important; box-shadow: var(--archive-shadow) !important; }
.history-kicker { color: var(--archive-tomato) !important; }
.history-title, .history-time { color: var(--archive-ink) !important; font-family: 'Songti SC', 'Noto Serif CJK SC', serif !important; }
.history-count, .history-state, .history-mode, .history-result { color: var(--archive-soft) !important; }
.history-cond { color: var(--archive-olive) !important; }
.history-item { border-left-color: var(--archive-line) !important; }
.history-item::before { border-radius: 0 !important; background: var(--archive-tomato) !important; box-shadow: 0 0 0 6rpx var(--archive-card) !important; }
.history-replay, .history-toggle { border-color: var(--archive-line) !important; border-radius: 2rpx !important; color: var(--archive-ink) !important; background: transparent !important; }
</style>
