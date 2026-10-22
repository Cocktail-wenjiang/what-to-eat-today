<template>
	<!-- ===== 悬浮球（面板打开时隐藏，避免从遮罩下透出） ===== -->
	<view
		v-if="!visible"
		class="ai-fab"
		:class="{ 'ai-fab-dragging': fabDragging, 'ai-fab-snapping': fabSnapping }"
		:style="fabStyle"
		@pointerdown.stop.prevent="startFabDrag"
		@pointermove.stop="moveFabDrag"
		@pointerup.stop="endFabDrag"
		@pointercancel.stop="endFabDrag"
		@touchstart.stop="startFabDrag"
		@touchmove.stop="moveFabDrag"
		@touchend.stop="endFabDrag"
		@touchcancel.stop="endFabDrag"
		@tap="handleFabTap"
	>
		<text class="ai-fab-mark">AI</text>
	</view>

	<!-- ===== 对话面板 =====
	     从底部升起的整屏宽面板：输入条贴近拇指，长列表有足够空间。
	     遮罩不参与点击关闭——对话里点空白处收起会误伤正在读的长回复。 -->
	<view v-else class="ai-overlay">
		<view class="ai-panel">
			<!-- 头部：只留标题与两个动作，不堆说明文字 -->
			<view class="ai-head">
				<view class="ai-head-main">
					<text class="ai-kicker">边注 / 问一问</text>
					<text class="ai-head-title">说说这顿饭</text>
				</view>
				<view class="ai-head-actions">
					<view v-if="messages.length" class="ai-head-button" @tap="$emit('reset-chat')">
						<text>新对话</text>
					</view>
					<view class="ai-head-button ai-head-close" @tap="$emit('close')">
						<text>✕</text>
					</view>
				</view>
			</view>

			<!-- 消息流 -->
			<scroll-view
				class="ai-stream"
				scroll-y
				:scroll-top="scrollTop"
				:scroll-with-animation="true"
				:show-scrollbar="false"
			>
				<!-- 空状态：只给引导语与几个可点的例子 -->
				<view v-if="!messages.length" class="ai-empty">
					<text class="ai-empty-title">把手边的情况告诉我</text>
					<text class="ai-empty-hint">可以说人数、时间、口味和现有食材；想换个方向，接着说就好。</text>
					<view class="ai-phrase-row">
						<view
							v-for="phrase in QUICK_PHRASES"
							:key="phrase"
							class="ai-phrase"
							@tap="usePhrase(phrase)"
						>
							<text>{{ phrase }}</text>
						</view>
					</view>
				</view>

				<!-- 对话气泡：用户靠右（番茄红），AI 靠左（纸白） -->
				<view
					v-for="item in messages"
					:key="item.id"
					class="ai-row"
					:class="item.role === 'user' ? 'ai-row-user' : 'ai-row-ai'"
				>
					<view
						class="ai-bubble"
						:class="[
							item.role === 'user' ? 'ai-bubble-user' : 'ai-bubble-ai',
							item.error ? 'ai-bubble-error' : ''
						]"
					>
						<image
							v-if="item.image"
							class="ai-bubble-image"
							:src="item.image"
							mode="aspectFill"
						/>
						<view v-if="item.pending" class="ai-typing">
							<view class="ai-dot" />
							<view class="ai-dot" />
							<view class="ai-dot" />
						</view>
						<text v-else-if="item.text" class="ai-bubble-text">{{ item.text }}</text>
					</view>
				</view>

				<!-- 滚动锚点：仅用于给消息流留出一点底部留白 -->
				<view class="ai-stream-end" />
			</scroll-view>

			<!-- 待发送的图片：可以先挂上、再补一句说明 -->
			<view v-if="photoPath" class="ai-attach">
				<image class="ai-attach-thumb" :src="photoPath" mode="aspectFill" />
				<text class="ai-attach-name">已选图片</text>
				<view class="ai-attach-clear" @tap="clearPhoto"><text>移除</text></view>
			</view>

			<!-- 输入条 -->
			<view class="ai-composer">
				<view class="ai-composer-photo" :class="{ disabled: parsing }" @tap="pickPhoto">
					<text>图</text>
				</view>
				<view class="ai-composer-field">
					<input
						class="ai-composer-input"
						type="text"
						v-model="draft"
						:disabled="parsing"
						placeholder="例如：两个人，清淡，30 分钟"
						placeholder-style="color: rgba(183,192,227,.45)"
						:maxlength="AI_MAX_LEN"
						confirm-type="send"
						@confirm="sendText"
					/>
				</view>
				<view
					class="ai-send"
					:class="{ disabled: !canSend }"
					@tap="sendText"
				>
					<text class="ai-send-arrow">↑</text>
				</view>
			</view>
		</view>
	</view>
</template>

<script setup>
/**
 * AI 助手悬浮窗（对话流形态）
 *
 * 形态：右下角常驻悬浮球 → 点击从底部升起对话面板。
 *
 * 与上一版（表单式面板）的区别：
 *  - 解析成功**不再自动收起**。多轮对话的前提是面板留着，用户才能接着说
 *    「再快一点」「换成素的」；收起由用户主动点 ✕ 决定；
 *  - 提示条改由页面在「关闭面板时」展示——那才是用户回到表单、想看「填了什么」的时刻。
 *
 * 职责边界：
 *  - 本组件只负责「输入与呈现」：草稿文本、待发图片、气泡渲染、滚到底；
 *  - 对话状态与请求归 useRecommendation（`messages` / `parsing`），组件不碰云端；
 *  - 可见性由页面持有，因为「关闭时展示提示条」需要页面拿到最终条件。
 */
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { choosePhoto } from '../utils/image.js'

/** 输入长度上限，与云函数的 maxText 保持一致 */
const AI_MAX_LEN = 120

/** 快捷语句：覆盖最常见场景，点一下即作为一条用户消息发出 */
const QUICK_PHRASES = [
	'两个人吃，清淡点，30分钟内',
	'一个人，快手菜，20分钟搞定',
	'高蛋白，健身餐，别超过40分钟',
	'不吃辣，不要花生'
]

const props = defineProps({
	/** 面板是否可见（悬浮球在面板打开时隐藏） */
	visible: { type: Boolean, default: false },
	/** 正在等待 AI 回话 */
	parsing: { type: Boolean, default: false },
	/** 对话消息流：[{ id, role, text, image, error, pending }] */
	messages: { type: Array, default: () => [] }
})

const emit = defineEmits(['open', 'close', 'send', 'reset-chat'])

/** 输入框草稿（组件内部状态，不写入表单草稿） */
const draft = ref('')
/** 待发送图片的本地路径，仅用于预览 */
const photoPath = ref('')

/** 悬浮球位置：首次使用沿用 CSS 默认位，拖动后改用 viewport 坐标并持久化。 */
const FAB_STORAGE_KEY = 'ai-assistant-fab-position'
const FAB_SIZE = 48
const FAB_EDGE_GAP = 16
const FAB_BOTTOM_GAP = 122
const fabPosition = ref({ x: null, y: null })
const fabDragging = ref(false)
const fabSnapping = ref(false)
const fabMoved = ref(false)
const suppressFabTap = ref(false)
const fabDrag = {
	startX: 0,
	startY: 0,
	originX: 0,
	originY: 0,
	viewportWidth: 0,
	viewportHeight: 0
}
const fabStyle = computed(() => {
	if (fabPosition.value.x === null || fabPosition.value.y === null) return {}
	return {
		left: `${fabPosition.value.x}px`,
		top: `${fabPosition.value.y}px`,
		right: 'auto',
		bottom: 'auto'
	}
})

onMounted(() => {
	try {
		const saved = uni.getStorageSync(FAB_STORAGE_KEY)
		if (saved && Number.isFinite(Number(saved.x)) && Number.isFinite(Number(saved.y))) {
			const viewport = getViewport()
			fabPosition.value = clampFabPosition(Number(saved.x), Number(saved.y), viewport)
		}
	} catch (error) {
		// 本地存储不可用时回退到 CSS 默认位置，不影响悬浮入口使用。
	}
})

function getViewport() {
	if (typeof window !== 'undefined') {
		return { width: window.innerWidth, height: window.innerHeight }
	}
	const systemInfo = uni.getSystemInfoSync()
	return { width: systemInfo.windowWidth, height: systemInfo.windowHeight }
}

function clampFabPosition(x, y, viewport = getViewport()) {
	return {
		x: Math.min(Math.max(x, FAB_EDGE_GAP), Math.max(FAB_EDGE_GAP, viewport.width - FAB_SIZE - FAB_EDGE_GAP)),
		y: Math.min(Math.max(y, FAB_EDGE_GAP), Math.max(FAB_EDGE_GAP, viewport.height - FAB_SIZE - FAB_BOTTOM_GAP))
	}
}

function getTouchPoint(event) {
	if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
		return { x: event.clientX, y: event.clientY }
	}
	const touch = event.touches?.[0] || event.changedTouches?.[0]
	return touch ? { x: touch.clientX ?? touch.pageX, y: touch.clientY ?? touch.pageY } : null
}

function getFabOrigin(viewport) {
	if (fabPosition.value.x !== null && fabPosition.value.y !== null) return fabPosition.value
	return {
		x: viewport.width - FAB_SIZE - FAB_EDGE_GAP,
		y: viewport.height - FAB_SIZE - FAB_BOTTOM_GAP
	}
}

function startFabDrag(event) {
	const point = getTouchPoint(event)
	if (!point) return
	if (Number.isFinite(event.pointerId) && event.currentTarget?.setPointerCapture) {
		event.currentTarget.setPointerCapture(event.pointerId)
	}
	fabSnapping.value = false
	const viewport = getViewport()
	const origin = getFabOrigin(viewport)
	fabDrag.startX = point.x
	fabDrag.startY = point.y
	fabDrag.originX = origin.x
	fabDrag.originY = origin.y
	fabDrag.viewportWidth = viewport.width
	fabDrag.viewportHeight = viewport.height
	fabMoved.value = false
	fabDragging.value = true
}

function moveFabDrag(event) {
	if (!fabDragging.value) return
	const point = getTouchPoint(event)
	if (!point) return
	const deltaX = point.x - fabDrag.startX
	const deltaY = point.y - fabDrag.startY
	if (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8) fabMoved.value = true
	const next = clampFabPosition(
		fabDrag.originX + deltaX,
		fabDrag.originY + deltaY,
		{ width: fabDrag.viewportWidth, height: fabDrag.viewportHeight }
	)
	fabPosition.value = next
}

function endFabDrag(event) {
	if (!fabDragging.value) return
	// pointer capture 让拖动离开圆球后仍能收到移动事件，松手时释放它。
	if (Number.isFinite(event?.pointerId) && event.currentTarget?.releasePointerCapture) {
		event.currentTarget.releasePointerCapture(event.pointerId)
	}
	fabDragging.value = false
	if (!fabMoved.value) return

	const viewport = getViewport()
	const current = clampFabPosition(fabPosition.value.x, fabPosition.value.y, viewport)
	const snappedX = current.x + FAB_SIZE / 2 < viewport.width / 2
	fabPosition.value = {
		x: snappedX ? FAB_EDGE_GAP : viewport.width - FAB_SIZE - FAB_EDGE_GAP,
		y: current.y
	}
	fabSnapping.value = true
	setTimeout(() => { fabSnapping.value = false }, 280)
	try {
		uni.setStorageSync(FAB_STORAGE_KEY, fabPosition.value)
	} catch (error) {
		// 位置记忆失败时仍保留本次会话中的位置。
	}
	suppressFabTap.value = true
	setTimeout(() => { suppressFabTap.value = false }, 160)
}

function handleFabTap() {
	if (suppressFabTap.value || fabMoved.value) return
	emit('open')
}

/**
 * 触发「滚到底」的哨兵值。
 *
 * 不用 `scroll-into-view` + 底部锚点：实测 uni-app H5 下锚点 id 变化后滚动位置纹丝不动
 * （scrollTop 恒为 0，而 scrollMax 已涨到 429，消息被压在输入条后面）。
 * `scroll-top` 是 scroll-view 的核心属性、三端一致，但**只在值变化时才应用**，
 * 所以这里每次自增一个远大于任何真实高度的值——浏览器会把超出的部分夹到最大值，
 * 效果就是稳定滚到底。面板关闭时归零，避免无意义地一直累加。
 */
const scrollTop = ref(0)
const SCROLL_SENTINEL = 100000

/** 消息数量或「等待中」状态一变就滚到底：气泡是随后才长高的，必须等一次 DOM 更新 */
watch(
	() => [props.messages.length, props.parsing],
	() => {
		nextTick(() => {
			scrollTop.value += SCROLL_SENTINEL
		})
	}
)

const canSend = computed(() => !props.parsing && (!!draft.value.trim() || !!photoPath.value))

/** 面板关闭时清掉输入残留（对话本身保留，重开还能接着聊） */
watch(
	() => props.visible,
	(value) => {
		if (!value) {
			draft.value = ''
			photoPath.value = ''
			// 归零哨兵：重开时从「贴顶」开始，再按需滚到底
			scrollTop.value = 0
		}
	}
)

/** 快捷语句：直接作为一条消息发出，不落进输入框再让用户按一次发送 */
function usePhrase(phrase) {
	if (props.parsing) return
	emit('send', { text: phrase })
}

function sendText() {
	if (!canSend.value) return
	const text = draft.value.trim()
	const path = photoPath.value
	draft.value = ''
	photoPath.value = ''
	emit('send', { text, path })
}

/** 选图：先挂到输入条上方预览，用户可补一句话再一起发出去 */
async function pickPhoto() {
	if (props.parsing) return
	const path = await choosePhoto()
	if (!path) return
	photoPath.value = path
}

function clearPhoto() {
	photoPath.value = ''
}
</script>

<style scoped>
/* ===== 悬浮球 =====
   用墨色而非品牌番茄红：品牌标记已经是番茄红圆形，两者同色会被误认为重复的品牌位。
   墨色同时呼应 Hero 深色面板，金色文字呼应 Hero 的数据数字。 */
.ai-fab { position: fixed; right: 34rpx; bottom: calc(122px + env(safe-area-inset-bottom)); z-index: 500; width: 116rpx; height: 116rpx; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: #292d25; border: 1px solid rgba(255,249,238,.16); box-shadow: 0 16rpx 38rpx rgba(41,45,37,.28); animation: fab-in .4s ease-out; touch-action: none; user-select: none; transition: box-shadow .2s ease, transform .2s ease; }
.ai-fab-mark { color: #e8bb70; font-family: Georgia, serif; font-size: 34rpx; font-weight: 700; letter-spacing: .04em; }
@keyframes fab-in { from { transform: translateY(18rpx) scale(.9); opacity: 0; } to { transform: none; opacity: 1; } }

/* ===== 遮罩 + 面板 =====
   z-index 必须高于 uni-app H5 内置导航栏。实测 `div.uni-page-head` 是
   `position: fixed; z-index: 998`（页面内容被它顶下 44px），
   若遮罩低于 998，顶栏会从遮罩上方透出来，弹出面板就「没盖住整屏」。 */
.ai-overlay { position: fixed; inset: 0; z-index: 1200; display: flex; align-items: flex-end; justify-content: center; background: rgba(32,34,27,.55); }

/* 面板是纵向 flex：头部固定、消息流吃满剩余高度、输入条固定贴底 */
.ai-panel { display: flex; flex-direction: column; width: 100%; height: 80vh; max-height: 80vh; box-sizing: border-box; overflow: hidden; border: 1px solid #ded6c8; border-bottom: none; border-radius: 6rpx 6rpx 0 0; background: #fffcf5; box-shadow: 0 -20rpx 60rpx rgba(41,45,37,.24); animation: sheet-in .3s cubic-bezier(.22,.8,.32,1); }
@keyframes sheet-in { from { transform: translateY(60rpx); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

/* ===== 头部 ===== */
.ai-head { display: flex; align-items: center; justify-content: space-between; padding: 26rpx 28rpx 20rpx; border-bottom: 1px solid #eae4d6; }
.ai-head-main { min-width: 0; }
.ai-kicker { display: block; color: #b8422e; font-family: Georgia, serif; font-size: 18rpx; letter-spacing: .14em; }
.ai-head-title { display: block; margin-top: 6rpx; color: #292d25; font-family: 'Songti SC', 'Noto Serif CJK SC', serif; font-size: 30rpx; font-weight: 700; }
.ai-head-actions { display: flex; align-items: center; gap: 8rpx; flex-shrink: 0; }
.ai-head-button { display: flex; align-items: center; justify-content: center; min-width: 88rpx; min-height: 88rpx; padding: 0 16rpx; box-sizing: border-box; color: #62614e; font-size: 23rpx; }
.ai-head-close { width: 88rpx; padding: 0; color: #55564c; font-size: 28rpx; }

/* ===== 消息流 ===== */
.ai-stream { flex: 1; min-height: 0; padding: 22rpx 28rpx 8rpx; box-sizing: border-box; }
/* 末尾留白：最后一条气泡不要贴死在输入条上沿 */
.ai-stream-end { height: 12rpx; }

/* 空状态 */
.ai-empty { padding: 30rpx 0 12rpx; }
.ai-empty-title { display: block; color: #292d25; font-family: 'Songti SC', 'Noto Serif CJK SC', serif; font-size: 32rpx; font-weight: 700; line-height: 1.4; }
.ai-empty-hint { display: block; margin-top: 14rpx; color: #767466; font-size: 23rpx; line-height: 1.75; }
.ai-phrase-row { display: flex; flex-wrap: wrap; margin-top: 26rpx; gap: 12rpx; }
.ai-phrase { display: flex; align-items: center; min-height: 76rpx; padding: 10rpx 20rpx; box-sizing: border-box; border: 1px solid #d9d3c0; border-radius: 6rpx; background: #fffdf8; color: #62614e; font-size: 22rpx; line-height: 1.45; }
.ai-phrase:active { background: #f4efe2; }

/* 气泡 */
.ai-row { display: flex; margin-top: 20rpx; }
.ai-row:first-child { margin-top: 0; }
.ai-row-user { justify-content: flex-end; }
.ai-row-ai { justify-content: flex-start; }
.ai-bubble { max-width: 80%; box-sizing: border-box; padding: 18rpx 22rpx; border-radius: 6rpx; }
.ai-bubble-ai { border: 1px solid #e4dfcf; background: #fffdf8; }
.ai-bubble-user { border: 1px solid #c9432f; background: #d94b36; }
/* 失败的回话弱化成纸红，不用整块高饱和红，避免对话里出现「报错墙」 */
.ai-bubble-error { border-color: #e2c3b4; background: #fff1e9; }
.ai-bubble-text { color: #292d25; font-size: 25rpx; line-height: 1.72; overflow-wrap: anywhere; }
.ai-bubble-user .ai-bubble-text { color: #fff9ee; }
.ai-bubble-error .ai-bubble-text { color: #b8422e; }
.ai-bubble-image { display: block; width: 260rpx; height: 200rpx; margin-bottom: 12rpx; border-radius: 4rpx; background: #e5e7d3; }

/* 「正在想…」三点 */
.ai-typing { display: flex; align-items: center; height: 34rpx; gap: 8rpx; }
.ai-dot { width: 10rpx; height: 10rpx; border-radius: 50%; background: #b9b5a4; animation: dot-pulse 1.1s ease-in-out infinite; }
.ai-dot:nth-child(2) { animation-delay: .16s; }
.ai-dot:nth-child(3) { animation-delay: .32s; }
@keyframes dot-pulse { 0%, 70%, 100% { opacity: .32; transform: translateY(0); } 35% { opacity: 1; transform: translateY(-4rpx); } }

/* ===== 待发送图片 ===== */
.ai-attach { display: flex; align-items: center; margin: 0 28rpx; padding: 12rpx 14rpx; border: 1px solid #e4dfcf; border-radius: 6rpx; background: #fffdf8; }
.ai-attach-thumb { width: 84rpx; height: 84rpx; margin-right: 16rpx; flex-shrink: 0; border-radius: 4rpx; background: #e5e7d3; }
.ai-attach-name { flex: 1; min-width: 0; color: #767466; font-size: 23rpx; }
.ai-attach-clear { display: flex; align-items: center; min-height: 80rpx; padding: 0 16rpx; color: #b8422e; font-size: 23rpx; }

/* ===== 输入条 ===== */
.ai-composer { display: flex; align-items: center; gap: 14rpx; padding: 18rpx 28rpx calc(20rpx + env(safe-area-inset-bottom)); border-top: 1px solid #eae4d6; background: #fffcf5; }
/* 下面两个键用 px 兜底触控尺寸：rpx 是按 750 宽换算的，在 320px 宽的机器上
   88rpx 只剩 37.5px，低于 44px 的可点最小尺寸。宽屏下 88rpx > 44px，兜底不生效。 */
.ai-composer-photo { display: flex; align-items: center; justify-content: center; width: 88rpx; height: 88rpx; min-width: 44px; min-height: 44px; flex-shrink: 0; border: 1px solid #cfd3b0; border-radius: 6rpx; background: #fffdf8; color: #626e3e; font-size: 24rpx; }
.ai-composer-field { flex: 1; min-width: 0; display: flex; align-items: center; border: 1px solid #d9d3c7; border-radius: 6rpx; background: #fffdf8; }
.ai-composer-input { flex: 1; min-width: 0; height: 88rpx; padding: 0 22rpx; color: #292d25; font-size: 25rpx; }
/* 圆形发送键：整块面板唯一的实心圆，视线自然落在「发出去」这个动作上 */
.ai-send { display: flex; align-items: center; justify-content: center; width: 88rpx; height: 88rpx; min-width: 44px; min-height: 44px; flex-shrink: 0; border-radius: 50%; background: #d94b36; }
.ai-send-arrow { color: #fff9ee; font-size: 36rpx; font-weight: 700; line-height: 1; }

.disabled { opacity: .45; }
.ai-phrase:active, .ai-head-button:active, .ai-composer-photo:active, .ai-attach-clear:active { opacity: .7; }

@media (min-width: 700px) {
	.ai-overlay { align-items: center; padding: 30px; }
	.ai-panel { max-width: 620px; height: 640px; max-height: 86vh; border: 1px solid #ded6c8; border-radius: 6rpx; }
}
@media (prefers-reduced-motion: reduce) {
	.ai-panel { animation: none; }
	.ai-fab { animation: none; }
	.ai-dot { animation: none; opacity: .6; }
}
</style>

<style scoped>
.ai-fab { width: 48px; height: 48px; right: 20px; bottom: calc(122px + env(safe-area-inset-bottom)); padding: 0; border-radius: 50%; background: rgba(255,255,255,.42); border: 1px solid rgba(255,255,255,.76); box-shadow: 0 8px 24px rgba(43,37,36,.14), inset 0 1px 0 rgba(255,255,255,.82); backdrop-filter: blur(22px) saturate(145%); -webkit-backdrop-filter: blur(22px) saturate(145%); }
.ai-fab-snapping { transition: left .26s cubic-bezier(.22,.8,.32,1), top .26s cubic-bezier(.22,.8,.32,1), right .26s cubic-bezier(.22,.8,.32,1), bottom .26s cubic-bezier(.22,.8,.32,1), box-shadow .2s ease, transform .2s ease; }
.ai-fab::before { content: ''; position: absolute; inset: 3px; border-radius: 50%; border: 1px solid rgba(255,255,255,.4); pointer-events: none; }
.ai-fab-mark { position: relative; z-index: 1; display: flex; align-items: center; justify-content: center; width: auto; height: auto; border-radius: 0; color: rgba(43,37,36,.72); background: transparent; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 11px; font-weight: 700; letter-spacing: -.04em; box-shadow: none; }
.ai-fab-dragging { transition: box-shadow .2s ease, transform .2s ease; transform: scale(1.08); box-shadow: 0 16rpx 36rpx rgba(43,37,36,.22), inset 0 1px 0 rgba(255,255,255,.92); }
.ai-fab-dragging .ai-fab-mark { text-shadow: 0 1px 4px rgba(255,255,255,.86); }
.ai-overlay { background: rgba(29,29,31,.34); backdrop-filter: blur(12px); }
.ai-panel { width: 100%; height: min(78vh, 760px); max-height: 88vh; border: 1px solid rgba(255,255,255,.72); border-bottom: none; border-radius: 30rpx 30rpx 0 0; background: rgba(255,255,255,.96); box-shadow: 0 -20rpx 80rpx rgba(0,0,0,.2); }
.ai-head { padding: 24rpx 30rpx 20rpx; border-bottom-color: var(--apple-line-soft); }
.ai-kicker { color: var(--apple-blue); font-size: 17rpx; font-weight: 700; }
.ai-head-title, .ai-empty-title { color: var(--apple-ink); font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif; }
.ai-head-title { font-size: 31rpx; letter-spacing: -.03em; }
.ai-head-button { color: var(--apple-blue); }
.ai-head-close { color: var(--apple-ink-soft); }
.ai-empty-hint { color: var(--apple-ink-soft); }
.ai-phrase { border-color: var(--apple-line); border-radius: 30rpx; background: #fbfbfd; color: var(--apple-ink-soft); }
.ai-phrase:active { background: var(--apple-blue-soft); }
.ai-bubble-ai { border-color: var(--apple-line-soft); border-radius: 8rpx 20rpx 20rpx 20rpx; background: #f2f2f7; }
.ai-bubble-user { border-color: var(--apple-blue); border-radius: 20rpx 8rpx 20rpx 20rpx; background: var(--apple-blue); }
.ai-bubble-error { border-color: #f3c0c9; background: #fff2f4; }
.ai-bubble-text { color: var(--apple-ink); }
.ai-bubble-user .ai-bubble-text { color: #fff; }
.ai-bubble-error .ai-bubble-text { color: var(--apple-red); }
.ai-bubble-image, .ai-attach-thumb { background: #eef0f3; }
.ai-dot { background: var(--apple-blue); }
.ai-attach { border-color: var(--apple-line); border-radius: 16rpx; background: #fbfbfd; }
.ai-attach-name { color: var(--apple-ink-soft); }
.ai-attach-clear { color: var(--apple-red); }
.ai-composer { padding: 18rpx 28rpx calc(20rpx + env(safe-area-inset-bottom)); border-top-color: var(--apple-line-soft); background: rgba(255,255,255,.92); }
.ai-composer-photo { border-color: var(--apple-line); border-radius: 18rpx; background: #fbfbfd; color: var(--apple-blue); }
.ai-composer-field { border-color: var(--apple-line); border-radius: 22rpx; background: #f2f2f7; }
.ai-composer-input { color: var(--apple-ink); }
.ai-send { background: var(--apple-blue); box-shadow: none; }
.ai-send-arrow { color: #fff; }
@media (min-width: 700px) { .ai-panel { max-width: 680px; height: 640px; border: 1px solid rgba(255,255,255,.72); border-radius: 30rpx; } .ai-overlay { align-items: center; } }
@media (max-width: 620px) { .ai-fab { right: 16px; bottom: calc(122px + env(safe-area-inset-bottom)); } }
</style>
<style scoped>
.ai-overlay { background: rgba(52,45,36,.28) !important; backdrop-filter: none !important; }
.ai-panel { border: 1px solid var(--archive-line-soft) !important; border-radius: 4rpx 4rpx 0 0 !important; background: var(--archive-card) !important; box-shadow: var(--archive-shadow) !important; }
.ai-kicker { color: var(--archive-tomato) !important; }
.ai-head-title, .ai-empty-title { color: var(--archive-ink) !important; font-family: 'Songti SC', 'Noto Serif CJK SC', serif !important; }
.ai-empty-hint, .ai-typing-text { color: var(--archive-soft) !important; }
.ai-phrase { border-color: var(--archive-line) !important; border-radius: 2rpx !important; background: var(--archive-paper) !important; color: var(--archive-ink) !important; }
.ai-bubble-ai { border-color: var(--archive-line) !important; border-radius: 2rpx !important; background: var(--archive-paper) !important; }
.ai-bubble-user { border-color: var(--archive-tomato) !important; border-radius: 2rpx !important; background: var(--archive-tomato) !important; }
.ai-bubble-text { color: var(--archive-ink) !important; }
.ai-bubble-user .ai-bubble-text { color: #fffaf0 !important; }
.ai-composer { border-top-color: var(--archive-line-soft) !important; background: var(--archive-card) !important; }
.ai-composer-photo, .ai-composer-field { border-color: var(--archive-line) !important; border-radius: 2rpx !important; background: var(--archive-paper) !important; color: var(--archive-olive) !important; }
.ai-composer-input { color: var(--archive-ink) !important; }
.ai-send { background: var(--archive-tomato) !important; box-shadow: none !important; }
</style>
