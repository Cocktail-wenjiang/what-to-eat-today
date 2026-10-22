<template>
	<view class="skeleton-list">
		<view v-for="n in 3" :key="n" class="skeleton-card">
			<view class="skeleton-topline">
				<view class="sk-line sk-index"></view>
				<view class="sk-line sk-time"></view>
			</view>
			<view class="sk-line sk-title"></view>
			<view class="sk-line sk-sub"></view>
			<view class="skeleton-tags">
				<view class="sk-line sk-tag"></view>
				<view class="sk-line sk-tag"></view>
			</view>
			<view class="sk-line sk-line-full"></view>
			<view class="sk-line sk-line-full"></view>
			<view class="sk-line sk-line-short"></view>
		</view>
	</view>
</template>

<script setup>
/**
 * 结果区骨架屏 —— 请求进行中显示，避免布局跳动与白屏
 */
</script>

<style scoped>
.skeleton-list {
	display: flex;
	flex-wrap: wrap;
}
.skeleton-card {
	flex: 0 0 100%;
	min-height: 600rpx;
	padding: 44rpx 42rpx;
	margin-bottom: 24rpx;
	display: flex;
	flex-direction: column;
	box-sizing: border-box;
	border: 1px solid #ddd5c7;
	border-top: 5rpx solid #d9d3c7;
	background: #fffcf5;
}
.skeleton-topline {
	display: flex;
	justify-content: space-between;
}
.sk-line {
	display: block;
	height: 24rpx;
	border-radius: 4rpx;
	background: #eeeadf;
}
.sk-index {
	width: 52rpx;
}
.sk-time {
	width: 104rpx;
}
.sk-title {
	height: 40rpx;
	width: 68%;
	margin-top: 20rpx;
}
.sk-sub {
	width: 88%;
	margin-top: 24rpx;
}
.skeleton-tags {
	display: flex;
	margin-top: 24rpx;
}
.sk-tag {
	width: 92rpx;
	height: 40rpx;
	margin-right: 12rpx;
}
.sk-line-full {
	width: 100%;
	margin-top: 32rpx;
}
.sk-line-short {
	width: 62%;
	margin-top: 12rpx;
}
</style>

<style scoped>
.skeleton-card { min-height: 470rpx; padding: 30rpx 26rpx; border: 1px solid var(--apple-line-soft); border-top: 0; border-radius: 22rpx; background: var(--apple-surface); }
.sk-line { background: #e5e5ea; }
</style>

<style scoped>
.skeleton-card { border-color: var(--space-line); border-top-color: var(--space-line-strong); border-radius: 22rpx; background: rgba(17,22,43,.78); }
.sk-line { background: rgba(157,174,255,.16); }
</style>
<style scoped>
.skeleton-card { border-color: var(--archive-line-soft) !important; border-radius: 2rpx !important; background: var(--archive-card) !important; }
.sk-line { background: var(--archive-paper-deep) !important; }
</style>
