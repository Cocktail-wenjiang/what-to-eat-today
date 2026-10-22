<template>
	<view class="empty-state">
		<text class="empty-icon">{{ icon }}</text>
		<text class="empty-title">{{ title }}</text>
		<text class="empty-desc">{{ desc }}</text>

		<view v-if="variant === 'empty' && suggestions.length" class="suggest-list">
			<view
				v-for="item in suggestions"
				:key="item.label"
				class="suggest-item"
				@tap="$emit('apply', item.patch)"
			>
				<text class="suggest-label">{{ item.label }}</text>
				<text class="suggest-count">{{ item.count }} 条 →</text>
			</view>
		</view>

		<view v-if="variant === 'error'" class="empty-action" @tap="$emit('retry')">
			<text>重新试试</text>
		</view>

		<view
			v-else-if="variant === 'empty' && !suggestions.length"
			class="empty-action"
			@tap="$emit('retry')"
		>
			<text>放宽条件重新推荐</text>
		</view>
	</view>
</template>

<script setup>
/**
 * 空状态
 * - idle ：首次进入，引导填写需求
 * - empty：已搜索但无命中，给出可操作的放宽建议，并显示放宽后能命中多少条
 * - error：请求失败，展示面向用户的失败说明与重试入口
 *
 * 只接收已经过产品化处理的文案，不接收接口原始报错。
 */
import { computed } from 'vue'

const props = defineProps({
	/** idle | empty | error */
	variant: { type: String, default: 'idle' },
	/** 面向用户的失败说明（仅 error 形态使用） */
	message: { type: String, default: '' },
	/** 放宽建议列表 [{ label, count, patch }]，patch 为要合并进表单的字段 */
	suggestions: { type: Array, default: () => [] }
})

defineEmits(['retry', 'apply'])

const icon = computed(() => {
	if (props.variant === 'error') return '!'
	return props.variant === 'empty' ? '✦' : '◐'
})

const title = computed(() => {
	if (props.variant === 'error') return '出了点小状况'
	return props.variant === 'empty' ? '换个条件，再试一次' : '下一顿，从这里开始'
})

const desc = computed(() => {
	if (props.variant === 'error') return props.message || '服务暂时不可用，请稍后重试。'
	if (props.variant === 'empty') {
		return '没有同时满足用时、口味和忌口要求的菜谱。下面是放宽某个条件后能命中的数量，点一下即可直接重试。'
	}
	return '填写上面的需求，我们会从菜谱库里挑选刚刚好的搭配。'
})
</script>

<style scoped>
.empty-state {
	padding: 92rpx 40rpx;
	display: flex;
	flex-direction: column;
	align-items: center;
	border: 1px dashed #c9c1b3;
	background: #fffcf5;
}
.empty-icon {
	font-size: 56rpx;
	color: #b8422e;
}
.empty-title {
	margin-top: 16rpx;
	font-size: 38rpx;
	font-family: 'Songti SC', 'Noto Serif CJK SC', serif;
	letter-spacing: -0.03em;
	color: #292d25;
	font-weight: 700;
}
.empty-desc {
	margin-top: 12rpx;
	max-width: 640rpx;
	color: #767466;
	font-size: 26rpx;
	line-height: 1.8;
	text-align: center;
}
.suggest-list {
	display: flex;
	flex-wrap: wrap;
	justify-content: center;
	margin-top: 44rpx;
}
.suggest-item {
	min-height: 88rpx;
	padding: 14rpx 24rpx;
	box-sizing: border-box;
	max-width: 100%;
	margin: 0 20rpx 20rpx 0;
	display: flex;
	align-items: center;
	border: 1px solid #d9d3c7;
	border-radius: 4rpx;
	background: #fffdf8;
}
.suggest-label {
	flex: 1;
	min-width: 0;
	color: #55564c;
	font-size: 26rpx;
}
.suggest-count {
	flex-shrink: 0;
	margin-left: 16rpx;
	padding-left: 16rpx;
	border-left: 1px solid #d9d3c7;
	color: #626e3e;
	font-size: 24rpx;
	font-weight: 700;
}
.empty-action {
	margin-top: 36rpx;
	min-height: 88rpx;
	padding: 0 44rpx;
	display: flex;
	align-items: center;
	border: 1px solid #d94b36;
	border-radius: 4rpx;
	background: #d94b36;
	color: #fff9ee;
	font-size: 26rpx;
	font-weight: 600;
}
</style>

<style scoped>
.empty-state { padding: 76rpx 32rpx; border: 1px solid var(--apple-line-soft); border-radius: 22rpx; background: var(--apple-surface); }
.empty-icon { color: var(--apple-blue); }
.empty-title { color: var(--apple-ink); font-size: 34rpx; }
.empty-desc { color: var(--apple-ink-soft); font-size: 23rpx; }
.suggest-item { border-color: var(--apple-line); border-radius: 16rpx; background: #fbfbfd; }
.suggest-label { color: var(--apple-ink); }
.suggest-count { border-left-color: var(--apple-line); color: var(--apple-blue); }
.empty-action { min-height: 76rpx; border: 0; border-radius: 38rpx; background: var(--apple-blue); color: #fff; }
</style>

<style scoped>
.empty-state { border-color: var(--space-line); border-radius: 22rpx; background: rgba(17,22,43,.68); }
.empty-icon { color: var(--space-cyan); }
.empty-title { color: var(--space-text); }
.empty-desc { color: var(--space-muted); }
.suggest-item { border-color: var(--space-line); border-radius: 14rpx; background: rgba(255,255,255,.04); }
.suggest-label { color: var(--space-text-soft); }
.suggest-count { border-left-color: var(--space-line); color: var(--space-cyan); }
.empty-action { border-color: var(--space-cyan); border-radius: 14rpx; background: var(--space-cyan); color: #10142a; }
</style>
<style scoped>
.empty-state { padding: 64rpx 24rpx !important; border: 1px dashed var(--archive-line) !important; border-radius: 2rpx !important; background: var(--archive-card) !important; }
.empty-icon { color: var(--archive-tomato) !important; }
.empty-title { color: var(--archive-ink) !important; font-family: 'Songti SC', 'Noto Serif CJK SC', serif !important; }
.empty-desc { color: var(--archive-soft) !important; }
.suggest-item { border-color: var(--archive-line) !important; border-radius: 2rpx !important; background: var(--archive-paper) !important; }
.suggest-label { color: var(--archive-ink) !important; }
.suggest-count { border-left-color: var(--archive-line) !important; color: var(--archive-olive) !important; }
.empty-action { border-radius: 2rpx !important; background: var(--archive-tomato) !important; color: #fffaf0 !important; }
</style>
