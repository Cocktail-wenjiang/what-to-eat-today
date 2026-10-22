<template>
	<view class="planner">
		<view class="section-heading">
			<view>
				<text class="section-kicker">01 / 今日条件</text>
				<text class="section-title">记下这顿饭</text>
			</view>
			<text class="section-number">01</text>
		</view>

		<view class="field-grid">
			<view class="field">
					<text class="field-label"><text class="field-label-number">01</text>几个人吃</text>
				<view class="input-wrap" :class="{ invalid: errors.servings }">
					<input
						class="field-input"
						type="number"
						v-model="form.servings"
						:placeholder="`${LIMITS.servings.min}-${LIMITS.servings.max}`"
						@blur="$emit('validate', 'servings')"
					/>
					<text class="input-unit">人</text>
				</view>
				<text v-if="errors.servings" class="field-error">{{ errors.servings }}</text>
				<text v-else class="field-tip">范围 {{ LIMITS.servings.min }}-{{ LIMITS.servings.max }}</text>
			</view>

			<view class="field">
					<text class="field-label"><text class="field-label-number">02</text>最多用时</text>
				<view class="input-wrap" :class="{ invalid: errors.max_minutes }">
					<input
						class="field-input"
						type="number"
						v-model="form.max_minutes"
						:placeholder="`${LIMITS.max_minutes.min}-${LIMITS.max_minutes.max}`"
						@blur="$emit('validate', 'max_minutes')"
					/>
					<text class="input-unit">分钟</text>
				</view>
				<text v-if="errors.max_minutes" class="field-error">{{ errors.max_minutes }}</text>
				<text v-else class="field-tip">
					范围 {{ LIMITS.max_minutes.min }}-{{ LIMITS.max_minutes.max }} 分钟
				</text>
			</view>

			<view class="field field-allergy">
					<text class="field-label"><text class="field-label-number">03</text>需要避开的食材</text>
				<view class="input-wrap" :class="{ invalid: errors.allergy }">
					<input
						class="field-input"
						type="text"
						v-model="form.allergy"
						placeholder="例如：花生（可留空）"
						:maxlength="LIMITS.allergy.maxLen"
						@blur="$emit('validate', 'allergy')"
					/>
				</view>
				<text v-if="errors.allergy" class="field-error">{{ errors.allergy }}</text>
				<text v-else class="field-tip">
					可留空；{{ (form.allergy || '').length }}/{{ LIMITS.allergy.maxLen }}
				</text>
			</view>
		</view>

		<view class="preference-row">
			<text class="field-label">今天想吃</text>
			<view class="preference-list">
				<view
					v-for="item in PREFERENCE_OPTIONS"
					:key="item"
					class="preference-chip"
					:class="{ active: form.preference === item }"
					@tap="$emit('choose-preference', item)"
				>
					<text>{{ item }}</text>
				</view>
			</view>
		</view>
		<text v-if="errors.preference" class="field-error preference-error">
			{{ errors.preference }}
		</text>

		<view class="planner-footer">
			<view class="status" :class="statusClass">
				<text class="status-icon">
					{{ status === 'error' ? '!' : status === 'success' ? '✓' : '↳' }}
				</text>
				<text class="status-text">{{ statusText }}</text>
			</view>
			<view class="planner-actions">
				<button class="ghost-button" :disabled="loading" @tap="$emit('reset')">重置</button>
				<button class="primary-button" :disabled="loading || hasErrors" @tap="$emit('submit')">
					<text>{{ loading ? '正在翻菜谱···' : '看看今天吃什么 ↗' }}</text>
				</button>
			</view>
		</view>
	</view>
</template>

<script setup>
/**
 * 需求输入表单
 * - 三个数值/文本字段 + 口味快捷标签
 * - 字段失焦即时校验，提交前整体校验
 *
 * 注：一句话 / 拍照识图的输入入口已迁到首页的 AI 助手悬浮窗（components/AiAssistant.vue），
 * 本表单不再承载 AI 交互，只接收解析结果回填后的值。
 */
import { computed } from 'vue'
import { PREFERENCE_OPTIONS, LIMITS } from '../utils/validators.js'

const props = defineProps({
	form: { type: Object, required: true },
	errors: { type: Object, default: () => ({}) },
	loading: { type: Boolean, default: false },
	statusText: { type: String, default: '' },
	status: { type: String, default: 'idle' }
})

const emit = defineEmits(['submit', 'reset', 'validate', 'choose-preference'])

const hasErrors = computed(() => Object.keys(props.errors).length > 0)

/** 状态条样式类：错误 / 成功 / 加载 / 空闲 */
const statusClass = computed(() => ({
	'status-error': props.status === 'error',
	'status-success': props.status === 'success',
	'status-loading': props.status === 'loading'
}))
</script>

<style scoped>
.planner { position: relative; z-index: 2; margin-top: 30rpx; padding: 38rpx 32rpx; border: 1px solid #ded6c8; background: #fffcf5; box-shadow: 0 10rpx 32rpx rgba(73,51,22,.035); }
.section-heading { display: flex; align-items: center; justify-content: space-between; }
.section-kicker { display: block; color: #b8422e; font-family: Georgia, serif; font-size: 19rpx; letter-spacing: .12em; }
.section-title { display: block; margin-top: 10rpx; color: #292d25; font-family: 'Songti SC', 'Noto Serif CJK SC', serif; font-size: 38rpx; font-weight: 700; }
.section-number { font-family: Georgia, serif; font-size: 66rpx; color: #ded6c8; line-height: 1; }
.input-wrap.invalid { border-color: #b8422e; background: #fff1e9; }
.field-grid { display: flex; flex-direction: column; margin-top: 34rpx; }
.field { width: 100%; margin-bottom: 26rpx; }
.field-label { display: block; margin-bottom: 14rpx; color: #55564c; font-size: 25rpx; font-weight: 600; }
.field-label-number { margin-right: 12rpx; color: #b8422e; font-family: Georgia, serif; font-size: 22rpx; font-style: italic; }
.input-wrap { display: flex; align-items: center; height: 94rpx; border: 1px solid #d9d3c7; border-radius: 6rpx; background: #fffdf8; }
.field-input { flex: 1; min-width: 0; height: 92rpx; padding: 0 24rpx; color: #292d25; font-size: 30rpx; }
.input-unit { flex-shrink: 0; padding-right: 24rpx; color: #767466; font-size: 23rpx; }
.field-tip, .field-error { display: block; margin-top: 9rpx; font-size: 21rpx; line-height: 1.5; }
.field-tip { color: #878273; }
.field-error { color: #b8422e; }
.preference-row { margin-top: 6rpx; }
.preference-list { display: flex; flex-wrap: wrap; gap: 12rpx; }
.preference-chip { min-height: 84rpx; padding: 0 24rpx; display: flex; align-items: center; justify-content: center; border: 1px solid #d9d3c7; border-radius: 6rpx; color: #55564c; font-size: 24rpx; transition: background .18s, color .18s; }
.preference-chip.active { background: #626e3e; color: #fffbed; border-color: #626e3e; font-weight: 600; }
.preference-error { margin-top: 16rpx; }
.planner-footer { margin-top: 28rpx; padding-top: 24rpx; border-top: 1px solid #e5dfd3; }
.status { display: flex; align-items: center; color: #767466; font-size: 22rpx; line-height: 1.6; }
.status-icon { display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 36rpx; height: 36rpx; margin-right: 12rpx; border-radius: 50%; background: #eeeadd; font-size: 22rpx; }
.status-text { flex: 1; }
.status-error { color: #b8422e; }
.status-error .status-icon { color: #fff9ee; background: #b8422e; }
.status-success .status-icon { color: #fff9ee; background: #626e3e; }
.planner-actions { display: flex; gap: 14rpx; margin-top: 24rpx; }
.ghost-button { margin: 0; padding: 0 25rpx; display: flex; align-items: center; justify-content: center; min-height: 98rpx; border: 1px solid #d9d3c7; border-radius: 6rpx; color: #767466; background: transparent; font-size: 25rpx; }
.primary-button { flex: 1; margin: 0; min-width: 0; min-height: 98rpx; padding: 0 18rpx; display: flex; align-items: center; justify-content: center; border-radius: 6rpx; background: #d94b36; color: #fff9ee; font-size: 29rpx; font-weight: 600; }
button[disabled] { opacity: .5; }
button:active { transform: scale(.975); }
@media (prefers-reduced-motion: reduce) { .preference-chip { transition: none; } button:active { transform: none; } }
</style>

<style scoped>
.planner { border-color: rgba(75,52,47,.12) !important; border-radius: 28rpx !important; background: rgba(255,255,255,.64) !important; box-shadow: 0 16rpx 36rpx rgba(90,62,52,.08) !important; backdrop-filter: blur(24px) !important; }
.section-heading { border-bottom-color: rgba(75,52,47,.1) !important; }
.section-kicker, .field-label-number { color: #d94d3e !important; }
.section-title, .field-label { color: #2b2524 !important; }
.section-number { color: rgba(43,37,36,.16) !important; }
.input-wrap { border-color: rgba(75,52,47,.14) !important; border-radius: 18rpx !important; background: rgba(255,252,249,.72) !important; }
.input-wrap:focus-within { border-color: #e95543 !important; box-shadow: 0 0 0 4rpx rgba(233,85,67,.12) !important; }
.field-input { color: #2b2524 !important; }
.input-unit, .field-tip, .status { color: rgba(43,37,36,.52) !important; }
.preference-chip { min-height: 72rpx !important; border-color: rgba(75,52,47,.14) !important; border-radius: 36rpx !important; color: rgba(43,37,36,.68) !important; background: rgba(255,255,255,.64) !important; }
.preference-chip.active { border-color: #e95543 !important; background: #e95543 !important; color: #fff !important; }
.planner-footer { border-top-color: rgba(75,52,47,.1) !important; }
.status-icon { background: #fff0eb !important; color: #d94d3e !important; }
.ghost-button { border-color: rgba(75,52,47,.14) !important; border-radius: 38rpx !important; color: rgba(43,37,36,.64) !important; background: rgba(255,255,255,.7) !important; }
.primary-button { border-radius: 38rpx !important; background: #e95543 !important; box-shadow: 0 10rpx 22rpx rgba(233,85,67,.22) !important; }
</style>

<style scoped>
.planner { margin-top: 24rpx; padding: 38rpx 40rpx 32rpx; border: 1px solid var(--apple-line-soft); border-radius: 26rpx; background: var(--apple-surface); box-shadow: 0 14px 40px rgba(0,0,0,.055); }
.section-heading { padding-bottom: 24rpx; border-bottom: 1px solid var(--apple-line-soft); }
.section-kicker { color: var(--apple-blue); font-size: 18rpx; letter-spacing: .14em; }
.section-title { color: var(--apple-ink); font-size: 34rpx; letter-spacing: -.03em; }
.section-number { color: #d2d2d7; font-size: 58rpx; }
.field-grid { display: grid; grid-template-columns: .75fr .95fr 1.5fr; gap: 18rpx; margin-top: 28rpx; }
.field { width: auto; margin-bottom: 0; }
.field-label { color: var(--apple-ink-soft); font-size: 22rpx; font-weight: 600; }
.field-label-number { color: var(--apple-blue); }
.input-wrap { height: 88rpx; border-color: var(--apple-line); border-radius: 14rpx; background: #fbfbfd; }
.input-wrap:focus-within { border-color: var(--apple-blue); box-shadow: 0 0 0 4rpx rgba(0,113,227,.1); }
.input-wrap.invalid { border-color: var(--apple-red); background: #fff2f4; }
.field-input { height: 86rpx; color: var(--apple-ink); font-size: 27rpx; }
.input-unit, .field-tip { color: var(--apple-muted); }
.field-error { color: var(--apple-red); }
.preference-row { display: flex; align-items: center; gap: 24rpx; margin-top: 28rpx; }
.preference-list { gap: 10rpx; }
.preference-chip { min-height: 68rpx; padding: 0 21rpx; border-color: var(--apple-line); border-radius: 34rpx; color: var(--apple-ink-soft); background: #fbfbfd; }
.preference-chip.active { border-color: var(--apple-blue); background: var(--apple-blue); color: #fff; }
.planner-footer { display: flex; align-items: center; justify-content: space-between; gap: 24rpx; margin-top: 30rpx; padding-top: 24rpx; border-top-color: var(--apple-line-soft); }
.status { color: var(--apple-muted); }
.status-icon { background: #f0f0f2; }
.status-error { color: var(--apple-red); }
.status-error .status-icon { background: var(--apple-red); }
.status-success .status-icon { color: #fff; background: var(--apple-green); }
.planner-actions { margin-top: 0; }
.ghost-button { min-height: 76rpx; padding: 0 24rpx; border-color: var(--apple-line); border-radius: 38rpx; color: var(--apple-ink-soft); background: #fff; }
.primary-button { min-height: 76rpx; border-radius: 38rpx; background: var(--apple-blue); color: #fff; box-shadow: 0 8rpx 20rpx rgba(0,113,227,.18); }
@media (max-width: 820px) { .field-grid { grid-template-columns: 1fr 1fr; } .field-allergy { grid-column: 1 / -1; } }
@media (max-width: 620px) { .planner { padding: 28rpx 22rpx 24rpx; border-radius: 22rpx; } .field-grid { gap: 12rpx; } .preference-row { display: block; } .preference-list { margin-top: 12rpx; } .preference-chip { min-height: 64rpx; } .planner-footer { display: block; } .planner-actions { margin-top: 20rpx; } .ghost-button, .primary-button { min-height: 84rpx; } }
</style>

<style scoped>
.planner { border-color: var(--space-line-strong); border-radius: 22rpx; background: linear-gradient(145deg, rgba(23,29,56,.9), rgba(13,18,39,.86)); box-shadow: 0 22rpx 55rpx rgba(3,5,19,.3), 0 0 0 1px rgba(255,255,255,.03) inset; backdrop-filter: blur(18rpx); }
.section-kicker { color: var(--space-cyan); }
.section-title { color: var(--space-text); }
.section-number { color: rgba(157,174,255,.22); }
.field-label { color: var(--space-text-soft); }
.field-label-number { color: var(--space-cyan); }
.input-wrap { border-color: var(--space-line); border-radius: 14rpx; background: rgba(255,255,255,.045); }
.input-wrap:focus-within { border-color: var(--space-cyan); box-shadow: 0 0 0 4rpx rgba(156,247,223,.08); }
.input-wrap.invalid { border-color: var(--space-danger); background: rgba(255,113,143,.1); }
.field-input { color: var(--space-text); }
.input-unit, .field-tip { color: var(--space-muted); }
.field-error { color: var(--space-danger); }
.preference-chip { border-color: var(--space-line); border-radius: 14rpx; color: var(--space-text-soft); background: rgba(255,255,255,.04); }
.preference-chip.active { border-color: var(--space-cyan); background: rgba(156,247,223,.16); color: var(--space-cyan); }
.planner-footer { border-top-color: var(--space-line); }
.status { color: var(--space-muted); }
.status-icon { background: rgba(255,255,255,.08); }
.status-error { color: var(--space-danger); }
.status-error .status-icon { background: var(--space-danger); }
.status-success .status-icon { color: #10142a; background: var(--space-cyan); }
.ghost-button { border-color: var(--space-line); border-radius: 14rpx; color: var(--space-text-soft); background: rgba(255,255,255,.04); }
.primary-button { border-radius: 14rpx; background: linear-gradient(135deg, var(--space-cyan), var(--space-blue)); color: #10142a; box-shadow: 0 10rpx 28rpx rgba(82,172,199,.22); }
</style>
<style scoped>
.planner { margin-top: 28rpx !important; padding: 30rpx 24rpx 26rpx !important; border: 1px solid var(--archive-line-soft) !important; border-radius: 4rpx !important; background: var(--archive-card) !important; box-shadow: var(--archive-shadow) !important; }
.section-heading { padding-bottom: 22rpx !important; border-bottom: 1px double var(--archive-line) !important; }
.section-kicker, .field-label-number { color: var(--archive-tomato) !important; }
.section-title, .field-label { color: var(--archive-ink) !important; }
.section-title { font-family: 'Songti SC', 'Noto Serif CJK SC', serif !important; }
.section-number { color: var(--archive-line) !important; }
.input-wrap { border-color: var(--archive-line) !important; border-radius: 2rpx !important; background: var(--archive-paper) !important; }
.input-wrap:focus-within { border-color: var(--archive-olive) !important; box-shadow: 0 0 0 4rpx rgba(129,144,94,.12) !important; }
.field-input { color: var(--archive-ink) !important; }
.input-unit, .field-tip, .status { color: var(--archive-soft) !important; }
.field-error { color: var(--archive-tomato) !important; }
.preference-chip { min-height: 68rpx !important; border-color: var(--archive-line) !important; border-radius: 2rpx !important; color: var(--archive-soft) !important; background: transparent !important; }
.preference-chip.active { border-color: var(--archive-olive) !important; background: var(--archive-olive) !important; color: #fffaf0 !important; }
.planner-footer { border-top-color: var(--archive-line-soft) !important; }
.status-icon { border-radius: 2rpx !important; background: var(--archive-olive-soft) !important; color: var(--archive-olive) !important; }
.ghost-button, .primary-button { min-height: 78rpx !important; border-radius: 2rpx !important; }
.ghost-button { border-color: var(--archive-line) !important; color: var(--archive-ink) !important; background: transparent !important; }
.primary-button { background: var(--archive-tomato) !important; color: #fffaf0 !important; box-shadow: none !important; }
</style>
