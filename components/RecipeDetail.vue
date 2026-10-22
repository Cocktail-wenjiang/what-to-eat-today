<template>
	<view v-if="recipe" class="detail-overlay" @tap="$emit('close')">
		<view class="detail-panel" @tap.stop>
			<view class="detail-handle"></view>
			<view class="detail-close" @tap="$emit('close')">
				<text>✕</text>
			</view>

			<text class="detail-kicker">菜谱详情 / 档案页</text>
			<text class="detail-title">{{ recipe.name }}</text>

			<!-- 菜品图：旧历史记录可能缺 image，此时不渲染 -->
			<image v-if="recipe.image" class="detail-cover" :src="recipe.image" mode="aspectFill" />

			<view class="detail-metrics">
				<view class="metric">
					<text class="metric-num">{{ recipe.minutes }}</text>
					<text class="metric-label">分钟</text>
				</view>
				<view class="metric">
					<text class="metric-num">{{ (recipe.ingredients || []).length }}</text>
					<text class="metric-label">种食材</text>
				</view>
				<view class="metric">
					<text class="metric-num">{{ (recipe.steps || []).length }}</text>
					<text class="metric-label">个步骤</text>
				</view>
			</view>

			<view class="detail-tags">
				<text v-for="tag in recipe.tags" :key="tag" class="tag">{{ tag }}</text>
			</view>

			<view class="detail-block">
				<text class="block-title">需要的食材</text>
				<view class="detail-ingredients">
					<text v-for="item in recipe.ingredients" :key="item" class="ingredient">{{ item }}</text>
				</view>
			</view>

			<view class="detail-block">
				<text class="block-title">做法步骤</text>
				<view class="detail-steps">
					<view v-for="(step, i) in recipe.steps" :key="i" class="detail-step">
						<text class="step-no">{{ String(i + 1).padStart(2, '0') }}</text>
						<text class="step-text">{{ step }}</text>
					</view>
				</view>
			</view>

		</view>
	</view>
</template>

<script setup>
/**
 * 菜谱详情弹窗
 * - 展示完整食材与全部烹饪步骤
 * - uni-app 无 DOM，改用遮罩点击 / 关闭按钮关闭（原生导航返回亦可）
 */
defineProps({
	recipe: { type: Object, default: null }
})

defineEmits(['close'])
</script>

<style scoped>
.detail-overlay { position: fixed; inset: 0; z-index: 600; display: flex; align-items: flex-end; justify-content: center; background: rgba(32,34,27,.62); }
.detail-panel { position: relative; width: 100%; max-height: 88vh; box-sizing: border-box; overflow-y: auto; overscroll-behavior: contain; padding: 56rpx 38rpx calc(48rpx + env(safe-area-inset-bottom)); border-radius: 28rpx 28rpx 0 0; background: #fffcf5; animation: sheet-in .32s ease-out; }
.detail-handle { position: absolute; top: 18rpx; left: 50%; width: 64rpx; height: 6rpx; margin-left: -32rpx; background: #d4ccbd; border-radius: 8rpx; }
.detail-close { position: absolute; right: 26rpx; top: 40rpx; margin: 0; width: 86rpx; height: 86rpx; display: flex; align-items: center; justify-content: center; border: 1px solid #d9d3c7; border-radius: 50%; background: transparent; color: #55564c; font-size: 28rpx; padding: 0; }
.detail-kicker { display: block; color: #b8422e; font-family: Georgia, serif; font-size: 20rpx; letter-spacing: .12em; padding-right: 95rpx; }
.detail-title { display: block; margin-top: 20rpx; padding-right: 88rpx; font-family: 'Songti SC', 'Noto Serif CJK SC', serif; font-size: 44rpx; font-weight: 700; line-height: 1.4; color: #292d25; }
.detail-cover { display: block; width: 100%; height: 400rpx; margin-top: 24rpx; border-radius: 6rpx; background: #eeeadf; }
.detail-metrics { display: flex; margin-top: 30rpx; padding: 24rpx 0; border-top: 1px solid #ddd5c7; border-bottom: 1px solid #ddd5c7; }
.metric { flex: 1; }
.metric-num { display: block; font-family: Georgia, serif; font-size: 46rpx; line-height: 1; color: #b8422e; }
.metric-label { display: block; margin-top: 10rpx; color: #767466; font-size: 22rpx; }
.detail-tags { display: flex; flex-wrap: wrap; margin-top: 24rpx; }
.tag { padding: 6rpx 16rpx; margin: 0 10rpx 10rpx 0; background: #eeefdf; color: #626e3e; font-size: 22rpx; }
.detail-block { margin-top: 32rpx; }
.block-title { display: block; margin-bottom: 20rpx; font-size: 30rpx; font-weight: 600; color: #292d25; }
.detail-ingredients { display: flex; flex-wrap: wrap; }
.ingredient { padding: 10rpx 20rpx; margin: 0 12rpx 12rpx 0; border: 1px solid #d9d3c7; border-radius: 30rpx; color: #55564c; font-size: 25rpx; }
.detail-step { display: flex; padding: 24rpx 0; border-bottom: 1px dashed #d9d3c7; }
.step-no { flex-shrink: 0; display: flex; align-items: center; justify-content: center; width: 52rpx; height: 52rpx; margin-right: 20rpx; border-radius: 50%; background: #e5e7d3; color: #626e3e; font-family: Georgia, serif; font-size: 24rpx; }
.step-text { flex: 1; min-width: 0; color: #55564c; font-size: 26rpx; line-height: 1.8; }
@keyframes sheet-in { from { transform: translateY(50rpx); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@media (min-width: 700px) { .detail-overlay { align-items: center; padding: 30px; } .detail-panel { max-width: 620px; border-radius: 16px; } }
@media (prefers-reduced-motion: reduce) { .detail-panel { animation: none; } }
</style>

<style scoped>
.detail-overlay { background: rgba(29,29,31,.4); backdrop-filter: blur(12px); }
.detail-panel { max-width: 680px; border: 1px solid rgba(255,255,255,.55); border-bottom: 0; border-radius: 28rpx 28rpx 0 0; background: rgba(255,255,255,.96); box-shadow: 0 -20rpx 70rpx rgba(0,0,0,.18); }
.detail-handle { background: #d1d1d6; }
.detail-close { border-color: var(--apple-line); color: var(--apple-ink-soft); background: rgba(255,255,255,.8); }
.detail-kicker { color: var(--apple-blue); }
.detail-title, .block-title { color: var(--apple-ink); }
.detail-cover { background: #eef0f3; }
.detail-metrics { border-top-color: var(--apple-line); border-bottom-color: var(--apple-line); }
.metric-num { color: var(--apple-ink); }
.metric-label, .step-text { color: var(--apple-ink-soft); }
.tag { border-radius: 10rpx; color: var(--apple-blue); background: var(--apple-blue-soft); }
.ingredient { border-color: var(--apple-line); color: var(--apple-ink-soft); background: #fbfbfd; }
.detail-step { border-bottom-color: var(--apple-line); }
.step-no { background: var(--apple-blue-soft); color: var(--apple-blue); }
</style>

<style scoped>
.detail-overlay { background: rgba(3,5,18,.74); backdrop-filter: blur(8px); }
.detail-panel { border: 1px solid var(--space-line-strong); border-bottom: none; background: linear-gradient(160deg, rgba(24,27,58,.98), rgba(10,14,31,.98)); box-shadow: 0 -20rpx 70rpx rgba(3,5,20,.5); }
.detail-handle { background: rgba(156,247,223,.45); }
.detail-close { border-color: var(--space-line); color: var(--space-text-soft); background: rgba(255,255,255,.05); }
.detail-kicker { color: var(--space-cyan); }
.detail-title, .block-title { color: var(--space-text); }
.detail-cover { background: #1a2341; }
.detail-metrics { border-top-color: var(--space-line); border-bottom-color: var(--space-line); }
.metric-num { color: var(--space-cyan); }
.metric-label, .step-text { color: var(--space-muted); }
.tag { border-radius: 10rpx; color: var(--space-cyan); background: rgba(156,247,223,.1); }
.ingredient { border-color: var(--space-line); color: var(--space-text-soft); }
.detail-step { border-bottom-color: var(--space-line); }
.step-no { background: rgba(156,247,223,.14); color: var(--space-cyan); }
</style>
<style scoped>
.detail-overlay { background: rgba(52,45,36,.46) !important; backdrop-filter: none !important; }
.detail-panel { border: 1px solid var(--archive-line-soft) !important; border-bottom: 0 !important; border-radius: 4rpx 4rpx 0 0 !important; background: var(--archive-card) !important; box-shadow: var(--archive-shadow) !important; }
.detail-handle { background: var(--archive-line) !important; border-radius: 0 !important; }
.detail-close { border-color: var(--archive-line) !important; border-radius: 2rpx !important; color: var(--archive-ink) !important; background: transparent !important; }
.detail-kicker { color: var(--archive-tomato) !important; }
.detail-title, .block-title { color: var(--archive-ink) !important; font-family: 'Songti SC', 'Noto Serif CJK SC', serif !important; }
.detail-cover { background: var(--archive-paper-deep) !important; border-radius: 2rpx !important; }
.detail-metrics { border-top-color: var(--archive-line-soft) !important; border-bottom-color: var(--archive-line-soft) !important; }
.metric-num { color: var(--archive-tomato) !important; }
.metric-label, .step-text { color: var(--archive-soft) !important; }
.tag { border-radius: 2rpx !important; color: var(--archive-olive) !important; background: var(--archive-olive-soft) !important; }
.ingredient { border-color: var(--archive-line) !important; border-radius: 2rpx !important; color: var(--archive-ink) !important; background: transparent !important; }
.detail-step { border-bottom-color: var(--archive-line-soft) !important; }
.step-no { border-radius: 0 !important; background: var(--archive-olive-soft) !important; color: var(--archive-olive) !important; }
</style>
