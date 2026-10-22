<template>
	<view class="qa-shell">
		<!-- ===== 顶部品牌栏（与全站一致） =====
		     pages.json 设了 navigationStyle: custom，页面会顶到屏幕最上方，
		     竖向由 var(--status-bar-height) 兜住；左侧给一个返回键，右侧沿用品牌注脚。 -->
		<view class="qa-topbar">
			<view class="qa-back" @tap="goBack">
				<text class="qa-back-arrow">‹</text>
			</view>
			<view class="brand">
				<view class="brand-mark"><text>食</text></view>
				<view class="brand-text">
					<text class="brand-name">今天吃什么</text>
					<text class="brand-sub">家常菜谱 · 边注</text>
				</view>
			</view>
			<view class="topbar-note"><text>FRESH IDEAS, DAILY</text><text class="note-dot">●</text></view>
		</view>

		<!-- ===== 标题行 ===== -->
		<view class="qa-head">
			<view class="qa-head-text">
				<text class="qa-kicker">ASK</text>
				<text class="qa-title">问一问</text>
			</view>
			<view v-if="messages.length" class="qa-clear" @tap="clearChat">
				<text>清空</text>
			</view>
		</view>

		<!-- ===== 对话流 ===== -->
		<scroll-view
			class="qa-stream"
			scroll-y
			:scroll-top="scrollTop"
			:scroll-with-animation="true"
			:show-scrollbar="false"
		>
			<!-- 空态：引导语 + 3 个可点的示例问题 -->
			<view v-if="!messages.length" class="qa-empty">
				<text class="qa-empty-title">关于这顿饭，随便问点什么</text>
				<text class="qa-empty-hint">可以问做法、火候和食材搭配；手头有什么，也可以直接告诉我。</text>
				<view class="qa-samples">
					<view
						v-for="sample in SAMPLES"
						:key="sample"
						class="qa-sample"
						@tap="useSample(sample)"
					>
						<text class="qa-sample-mark">✳</text>
						<text class="qa-sample-text">{{ sample }}</text>
					</view>
				</view>
			</view>

			<!-- 气泡：用户靠右（番茄红），助手靠左（纸白） -->
			<view
				v-for="item in messages"
				:key="item.id"
				class="qa-row"
				:class="item.role === 'user' ? 'qa-row-user' : 'qa-row-ai'"
			>
				<view
					class="qa-bubble"
					:class="[
						item.role === 'user' ? 'qa-bubble-user' : 'qa-bubble-ai',
						item.error ? 'qa-bubble-error' : ''
					]"
				>
					<view v-if="item.pending" class="qa-typing">
						<text class="qa-typing-text">正在查找…</text>
						<view class="qa-dot" />
						<view class="qa-dot" />
						<view class="qa-dot" />
					</view>
					<text v-else class="qa-bubble-text">{{ item.text }}</text>
					<view v-if="!item.pending && item.titles && item.titles.length" class="qa-refs">
						<text class="qa-refs-text">依据：{{ formatRefs(item.titles) }}</text>
					</view>
				</view>
			</view>

			<view class="qa-stream-end" />
		</scroll-view>

		<!-- ===== 输入条 ===== -->
		<view class="qa-composer">
			<view class="qa-composer-field">
				<input
					class="qa-composer-input"
					type="text"
					v-model="draft"
					:disabled="asking"
					placeholder="例如：番茄炒蛋怎么做才不出水？"
					placeholder-style="color: rgba(183,192,227,.45)"
					:maxlength="MAX_LEN"
					confirm-type="send"
					@confirm="sendText"
				/>
			</view>
			<view class="qa-send" :class="{ disabled: !canSend }" @tap="sendText">
				<text class="qa-send-arrow">↑</text>
			</view>
		</view>
	</view>
</template>

<script setup>
/**
 * 知识问答页
 *
 * 形态：整屏对话页 —— 顶部品牌栏 + 中部对话流 + 底部输入条。
 *
 * 与首页 AI 助手（改条件）的分工：
 *   - AI 助手负责把一句话翻译成推荐条件，落到表单上；
 *   - 本页负责「问知识」——某道菜怎么做、食材怎么搭，回答带来源标题。
 *
 * 边界：
 *   - 只呈现产品信息：气泡里只有答案与「依据：《菜名》」，不暴露任何技术字段；
 *   - 任何失败都收敛成一句「暂时查不到，稍后再试」，原始错误不上屏；
 *   - 请求加本地超时：云端迟迟不回时用户不会一直卡在「正在查找…」。
 */
import { ref, computed, watch, nextTick } from 'vue'

/** 输入长度上限，与云函数的 maxQuestion 保持一致 */
const MAX_LEN = 200
/** 本地超时：超过这个时间就当作失败，让界面给出可重试的提示 */
const TIMEOUT = 20000

/** 示例问题：覆盖做法、火候、现有食材三类常见问法，点一下即发出 */
const SAMPLES = [
	'微波蒸蛋要蒸几分钟？',
	'番茄炒蛋怎么做才不出水？',
	'我有土豆和鸡腿，能做点什么？'
]

/** 对话消息流：[{ id, role, text, titles, error, pending }] */
const messages = ref([])
/** 输入框草稿 */
const draft = ref('')
/** 正在等待回答 */
const asking = ref(false)

let seq = 0
function nextId() {
	seq += 1
	return 'm' + seq
}

/**
 * 触发「滚到底」的哨兵值。
 * scroll-view 的 scroll-top 只在值变化时才应用，故每次自增一个远大于任何真实高度的值，
 * 浏览器会把超出的部分夹到最大值，效果就是稳定滚到底。
 */
const scrollTop = ref(0)
const SCROLL_SENTINEL = 100000

watch(
	() => [messages.value.length, asking.value],
	() => {
		nextTick(() => {
			scrollTop.value += SCROLL_SENTINEL
		})
	}
)

const canSend = computed(() => !asking.value && !!draft.value.trim())

/** 把来源标题拼成一行；去重后最多展示 3 个，避免引用行过长 */
function formatRefs(titles) {
	const unique = []
	titles.forEach((t) => {
		if (t && unique.indexOf(t) === -1) unique.push(t)
	})
	return unique
		.slice(0, 3)
		.map((t) => '《' + t + '》')
		.join('')
}

/** 给 Promise 套一层超时，避免界面无限等待 */
function withTimeout(promise, ms) {
	let timer = null
	const timeout = new Promise((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error('timeout')), ms)
	})
	return Promise.race([promise, timeout]).finally(() => {
		if (timer) clearTimeout(timer)
	})
}

/** 已完成的问答对，作为多轮上下文发给云端（帮助理解「它呢」「再详细点」这类指代） */
function buildHistory() {
	return messages.value
		.filter((m) => !m.pending && !m.error && m.text)
		.map((m) => ({ role: m.role, content: m.text }))
		.slice(-6)
}

async function ask(question) {
	const text = String(question || '').trim()
	if (!text || asking.value) return

	messages.value.push({ id: nextId(), role: 'user', text, titles: [], error: false, pending: false })
	const pending = { id: nextId(), role: 'assistant', text: '', titles: [], error: false, pending: true }
	messages.value.push(pending)
	asking.value = true

	// 多轮上下文：取本轮之前的问答对。
	// buildHistory 会带上刚插入的本轮问题，故去掉最后一条。
	const context = buildHistory().slice(0, -1)

	try {
		if (typeof uniCloud === 'undefined' || !uniCloud || typeof uniCloud.callFunction !== 'function') {
			throw new Error('unavailable')
		}
		const res = await withTimeout(
			uniCloud.callFunction({ name: 'ragQuery', data: { question: text, history: context } }),
			TIMEOUT
		)
		// 服务端结果取 res.result；错误时只有稳定的 error 枚举，没有原始报错
		const result = res && res.result
		const index = messages.value.indexOf(pending)
		if (result && result.ok && result.answer) {
			messages.value[index] = {
				id: pending.id,
				role: 'assistant',
				text: String(result.answer),
				titles: (result.citations || []).map((c) => c && c.title).filter(Boolean),
				error: false,
				pending: false
			}
		} else {
			// 诊断走控制台，界面只给人话：ok:false 时服务端只回稳定枚举（not-configured / model-unavailable）
			console.warn('[qa] 云端未返回可用答案', (result && result.error) || 'unknown', result || '')
			messages.value[index] = {
				id: pending.id,
				role: 'assistant',
				text: '哎，这会儿没查出来，稍等一下再问我？',
				titles: [],
				error: true,
				pending: false
			}
		}
	} catch (error) {
		console.warn('[qa] 调用失败', (error && (error.errMsg || error.message)) || error)
		const index = messages.value.indexOf(pending)
		if (index !== -1) {
			messages.value[index] = {
				id: pending.id,
				role: 'assistant',
				text: '哎，这会儿没查出来，稍等一下再问我？',
				titles: [],
				error: true,
				pending: false
			}
		}
	} finally {
		asking.value = false
	}
}

function sendText() {
	if (!canSend.value) return
	const text = draft.value.trim()
	draft.value = ''
	ask(text)
}

/** 示例问题：直接作为一条消息发出，不落进输入框再让用户按一次发送 */
function useSample(sample) {
	if (asking.value) return
	ask(sample)
}

function clearChat() {
	if (asking.value) return
	messages.value = []
	scrollTop.value = 0
}

/** 返回上一页；直接从外部打开本页时退回首页 */
function goBack() {
	uni.navigateBack({
		fail: () => uni.reLaunch({ url: '/pages/index/index' })
	})
}
</script>

<style scoped>
.qa-shell { display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; color: #262820; background: #f6f1e7; }

/* ===== 品牌栏 ===== */
.qa-topbar { display: flex; align-items: center; padding: 24rpx 30rpx 20rpx; }
/* pages.json 设了 navigationStyle: custom，小程序/App 端页面会顶到屏幕最上方，
   这里把品牌栏推到状态栏之下；H5 没有状态栏（该变量为 0），沿用上面的 padding 即可。 */
/* #ifndef H5 */
.qa-topbar { padding-top: calc(var(--status-bar-height) + 24rpx); }
/* #endif */
.qa-back { display: flex; align-items: center; justify-content: center; width: 88rpx; height: 88rpx; min-width: 44px; min-height: 44px; margin-right: 6rpx; flex-shrink: 0; }
.qa-back-arrow { color: #292d25; font-family: Georgia, serif; font-size: 46rpx; line-height: 1; }
.brand { display: flex; align-items: center; flex: 1; min-width: 0; }
.brand-mark { width: 68rpx; height: 68rpx; display: flex; align-items: center; justify-content: center; margin-right: 20rpx; flex-shrink: 0; border-radius: 50%; background: #d94b36; color: #fff8ed; font-family: Georgia, serif; font-size: 34rpx; font-weight: 700; }
.brand-text { min-width: 0; }
.brand-name { display: block; color: #262820; font-family: Georgia, serif; font-size: 29rpx; font-weight: 700; }
.brand-sub { display: block; margin-top: 5rpx; color: #767466; font-size: 21rpx; }
.topbar-note { display: flex; align-items: center; gap: 12rpx; flex-shrink: 0; color: #767466; font-family: Georgia, serif; font-size: 17rpx; letter-spacing: .08em; }
.note-dot { color: #87934b; font-size: 15rpx; }

/* ===== 标题行 ===== */
.qa-head { display: flex; align-items: flex-end; justify-content: space-between; padding: 6rpx 30rpx 18rpx; border-bottom: 1px solid #e7e0d1; }
.qa-kicker { display: block; color: #d94b36; font-family: Georgia, serif; font-size: 19rpx; font-weight: 700; letter-spacing: .14em; }
.qa-title { display: block; margin-top: 8rpx; color: #292d25; font-family: 'Songti SC', 'Noto Serif CJK SC', serif; font-size: 38rpx; font-weight: 700; }
.qa-clear { display: flex; align-items: center; justify-content: flex-end; min-height: 88rpx; min-width: 44px; padding: 0 4rpx 0 20rpx; color: #b8422e; font-size: 23rpx; }

/* ===== 对话流 ===== */
.qa-stream { flex: 1; min-height: 0; padding: 22rpx 30rpx 8rpx; box-sizing: border-box; }
.qa-stream-end { height: 12rpx; }

/* 空态 */
.qa-empty { padding: 34rpx 0 12rpx; }
.qa-empty-title { display: block; color: #292d25; font-family: 'Songti SC', 'Noto Serif CJK SC', serif; font-size: 34rpx; font-weight: 700; line-height: 1.4; }
.qa-empty-hint { display: block; margin-top: 16rpx; color: #767466; font-size: 24rpx; line-height: 1.75; }
.qa-samples { display: flex; flex-direction: column; margin-top: 30rpx; }
.qa-sample { display: flex; align-items: center; min-height: 88rpx; min-width: 44px; margin-bottom: 16rpx; padding: 16rpx 22rpx; box-sizing: border-box; border: 1px solid #d9d3c0; border-radius: 6rpx; background: #fffdf8; }
.qa-sample-mark { flex-shrink: 0; margin-right: 16rpx; color: #87934b; font-size: 24rpx; }
.qa-sample-text { flex: 1; min-width: 0; color: #55564c; font-size: 25rpx; line-height: 1.5; }
.qa-sample:active { background: #f4efe2; }

/* 气泡 */
.qa-row { display: flex; margin-top: 20rpx; }
.qa-row:first-child { margin-top: 0; }
.qa-row-user { justify-content: flex-end; }
.qa-row-ai { justify-content: flex-start; }
.qa-bubble { max-width: 82%; box-sizing: border-box; padding: 18rpx 22rpx; border-radius: 6rpx; }
.qa-bubble-ai { border: 1px solid #e4dfcf; background: #fffdf8; }
.qa-bubble-user { border: 1px solid #c9432f; background: #d94b36; }
/* 失败的回话弱化成纸红，避免对话里出现「报错墙」 */
.qa-bubble-error { border-color: #e2c3b4; background: #fff1e9; }
.qa-bubble-text { color: #292d25; font-size: 25rpx; line-height: 1.72; overflow-wrap: anywhere; }
.qa-bubble-user .qa-bubble-text { color: #fff9ee; }
.qa-bubble-error .qa-bubble-text { color: #b8422e; }

/* 来源引用：只给资料标题，字号更小、颜色更淡，像脚注 */
.qa-refs { margin-top: 14rpx; padding-top: 12rpx; border-top: 1px dashed #ddd6c6; }
.qa-refs-text { color: #8a8674; font-size: 21rpx; line-height: 1.6; overflow-wrap: anywhere; }

/* 「正在查找…」 */
.qa-typing { display: flex; align-items: center; gap: 8rpx; }
.qa-typing-text { margin-right: 4rpx; color: #767466; font-size: 24rpx; }
.qa-dot { width: 10rpx; height: 10rpx; border-radius: 50%; background: #b9b5a4; animation: qa-dot-pulse 1.1s ease-in-out infinite; }
.qa-dot:nth-child(3) { animation-delay: .16s; }
.qa-dot:nth-child(4) { animation-delay: .32s; }
@keyframes qa-dot-pulse { 0%, 70%, 100% { opacity: .32; transform: translateY(0); } 35% { opacity: 1; transform: translateY(-4rpx); } }

/* ===== 输入条 =====
   贴底 + 安全区内边距：全面屏底部横条不会压住输入框。 */
.qa-composer { display: flex; align-items: center; gap: 14rpx; padding: 18rpx 30rpx calc(20rpx + env(safe-area-inset-bottom)); border-top: 1px solid #eae4d6; background: #fffcf5; }
.qa-composer-field { flex: 1; min-width: 0; display: flex; align-items: center; border: 1px solid #d9d3c7; border-radius: 6rpx; background: #fffdf8; }
.qa-composer-input { flex: 1; min-width: 0; height: 88rpx; min-height: 44px; padding: 0 22rpx; color: #292d25; font-size: 25rpx; }
/* 圆形发送键：整屏唯一的实心圆，视线自然落在「发出去」这个动作上 */
.qa-send { display: flex; align-items: center; justify-content: center; width: 88rpx; height: 88rpx; min-width: 44px; min-height: 44px; flex-shrink: 0; border-radius: 50%; background: #d94b36; }
.qa-send-arrow { color: #fff9ee; font-size: 36rpx; font-weight: 700; line-height: 1; }
.qa-back, .qa-clear, .qa-sample, .qa-send { min-height: 44px; }
.disabled { opacity: .45; }
.qa-clear:active, .qa-back:active { opacity: .7; }

@media (min-width: 700px) {
	.qa-topbar, .qa-head, .qa-stream, .qa-composer { max-width: 1000px; width: 100%; margin-left: auto; margin-right: auto; }
}
@media (prefers-reduced-motion: reduce) {
	.qa-dot { animation: none; opacity: .6; }
}
</style>

<style scoped>
.qa-shell { color: var(--apple-ink); background: var(--apple-bg); }
.qa-topbar { position: sticky; top: 0; z-index: 100; border-bottom: 1px solid var(--apple-line-soft); background: rgba(245,245,247,.84); backdrop-filter: blur(24px); }
.qa-back-arrow, .brand-name, .qa-title { color: var(--apple-ink); }
.brand-mark { background: var(--apple-ink); color: #fff; box-shadow: none; }
.brand-sub, .topbar-note, .qa-empty-hint { color: var(--apple-muted); }
.note-dot, .qa-kicker { color: var(--apple-blue); }
.qa-head { border-bottom-color: var(--apple-line-soft); }
.qa-clear { color: var(--apple-blue); }
.qa-sample { border-color: var(--apple-line); border-radius: 18rpx; background: var(--apple-surface); box-shadow: 0 8rpx 22rpx rgba(0,0,0,.04); }
.qa-sample-mark { color: var(--apple-blue); }
.qa-sample-text { color: var(--apple-ink); }
.qa-sample:active { background: var(--apple-blue-soft); }
.qa-bubble-ai { border-color: var(--apple-line-soft); border-radius: 8rpx 20rpx 20rpx 20rpx; background: #f2f2f7; }
.qa-bubble-user { border-color: var(--apple-blue); border-radius: 20rpx 8rpx 20rpx 20rpx; background: var(--apple-blue); }
.qa-bubble-error { border-color: #f3c0c9; background: #fff2f4; }
.qa-bubble-text { color: var(--apple-ink); }
.qa-bubble-user .qa-bubble-text { color: #fff; }
.qa-bubble-error .qa-bubble-text { color: var(--apple-red); }
.qa-refs { border-top-color: var(--apple-line); }
.qa-refs-text, .qa-typing-text { color: var(--apple-muted); }
.qa-dot { background: var(--apple-blue); }
.qa-composer { border-top-color: var(--apple-line-soft); background: rgba(255,255,255,.92); }
.qa-composer-field { border-color: var(--apple-line); border-radius: 22rpx; background: #f2f2f7; }
.qa-composer-input { color: var(--apple-ink); }
.qa-send { background: var(--apple-blue); box-shadow: none; }
.qa-send-arrow { color: #fff; }
</style>
<style scoped>
.qa-shell { background: var(--archive-paper) !important; color: var(--archive-ink) !important; }
.qa-topbar { background: rgba(241,234,217,.98) !important; border-bottom-color: var(--archive-line-soft) !important; backdrop-filter: none !important; }
.qa-back-arrow, .brand-name, .qa-title { color: var(--archive-ink) !important; }
.brand-mark { background: var(--archive-olive) !important; }
.brand-sub, .topbar-note, .qa-empty-hint { color: var(--archive-soft) !important; }
.note-dot, .qa-kicker { color: var(--archive-tomato) !important; }
.qa-head { border-bottom-color: var(--archive-line-soft) !important; }
.qa-clear { color: var(--archive-tomato) !important; }
.qa-sample { border-color: var(--archive-line) !important; border-radius: 2rpx !important; background: var(--archive-card) !important; box-shadow: none !important; }
.qa-sample-mark { color: var(--archive-olive) !important; }
.qa-sample-text { color: var(--archive-ink) !important; }
.qa-bubble-ai { border-color: var(--archive-line) !important; border-radius: 2rpx !important; background: var(--archive-card) !important; }
.qa-bubble-user { border-color: var(--archive-tomato) !important; border-radius: 2rpx !important; background: var(--archive-tomato) !important; }
.qa-bubble-text { color: var(--archive-ink) !important; }
.qa-bubble-user .qa-bubble-text { color: #fffaf0 !important; }
.qa-refs { border-top-color: var(--archive-line-soft) !important; }
.qa-refs-text, .qa-typing-text { color: var(--archive-soft) !important; }
.qa-dot { background: var(--archive-olive) !important; }
.qa-composer { border-top-color: var(--archive-line-soft) !important; background: var(--archive-card) !important; }
.qa-composer-field { border-color: var(--archive-line) !important; border-radius: 2rpx !important; background: var(--archive-paper) !important; }
.qa-composer-input { color: var(--archive-ink) !important; }
.qa-send { background: var(--archive-tomato) !important; box-shadow: none !important; }
</style>
