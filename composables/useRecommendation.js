/**
 * 推荐业务状态管理（组合式函数）
 *
 * 集中管理：
 *  - 表单状态与校验错误
 *  - 请求状态机 idle / loading / success / empty / error
 *  - 推荐历史
 *  - 表单草稿本地持久化（刷新不丢输入，用 uni.setStorageSync 兼容各端）
 *
 * 说明：数据链路（云函数 / 云库直连 / 本地兜底）属于实现细节，
 * 只在本函数内部由 api/client.js 处理，不向上层组件暴露、也不渲染给用户。
 */
import { reactive, ref, computed, watch } from 'vue'
import {
	requestRecommendation,
	requestHistory,
	parseNaturalLanguage
} from '../api/client.js'
import { validateForm, toRequestPayload } from '../utils/validators.js'
import { toImageDataUrl } from '../utils/image.js'

const DRAFT_KEY = 'what-to-eat:form-draft'

/** 表单默认值 */
const DEFAULT_FORM = {
	servings: 2,
	max_minutes: 30,
	preference: '清淡',
	allergy: ''
}

/** 从本地存储读取草稿，异常时回退默认值 */
function loadDraft() {
	try {
		const raw = uni.getStorageSync(DRAFT_KEY)
		if (!raw) return { ...DEFAULT_FORM }
		const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
		return { ...DEFAULT_FORM, ...parsed }
	} catch {
		return { ...DEFAULT_FORM }
	}
}

export function useRecommendation() {
	const form = reactive(loadDraft())
	const errors = reactive({})
	const results = ref([])
	const history = ref([])
	const loading = ref(false)
	const historyLoading = ref(false)
	/** idle | loading | success | empty | error */
	const status = ref('idle')
	const errorMessage = ref('')
	const usedMode = ref('')
	const hasSubmitted = ref(false)
	const aiParsing = ref(false)
	const aiMessage = ref('')
	const aiError = ref(false)
	/**
	 * AI 对话消息流。
	 * 每项：{ id, role: 'user'|'assistant', text, image, error, pending }
	 *  - image   仅用户消息可能有（本地路径，供气泡内预览，**不进历史**）
	 *  - error   AI 回话失败，界面用弱化样式呈现，且**不进历史**
	 *  - pending 等待回话中的占位气泡（界面渲染「正在想…」）
	 */
	const aiMessages = ref([])
	/** 消息自增 id，用于列表 key（比 index 稳定，插入/清空都不会错位） */
	let aiMessageSeed = 0

	/** 表单草稿持久化：输入即存，避免误返回/刷新丢失 */
	watch(
		() => ({ ...form }),
		(value) => {
			try {
				uni.setStorageSync(DRAFT_KEY, JSON.stringify(value))
			} catch {
				/* 存储不可用时忽略即可 */
			}
		},
		{ deep: true }
	)

	/** 顶部状态条文案 */
	const statusText = computed(() => {
		if (status.value === 'loading') return '正在匹配菜谱…'
		if (status.value === 'error') return errorMessage.value
		if (status.value === 'empty') return '没有同时满足条件的菜谱，试试放宽用时或换个口味'
		if (status.value === 'success') return `已为你匹配到 ${results.value.length} 道菜谱`
		return '填写你的需求，开始一次匹配'
	})

	/** 校验单个字段（失焦即时反馈） */
	function validateField(field) {
		const { errors: all } = validateForm(form)
		if (all[field]) errors[field] = all[field]
		else delete errors[field]
		return !errors[field]
	}

	function resetErrors() {
		Object.keys(errors).forEach((key) => delete errors[key])
	}

	/** 提交推荐请求 */
	async function submit() {
		resetErrors()
		const { valid, errors: found } = validateForm(form)
		if (!valid) {
			Object.assign(errors, found)
			status.value = 'error'
			errorMessage.value = '请先修正表单中标红的内容'
			return
		}

		loading.value = true
		status.value = 'loading'
		errorMessage.value = ''
		hasSubmitted.value = true
		results.value = []

		try {
			const payload = toRequestPayload(form)
			const response = await requestRecommendation(payload)

			results.value = response.recommendations || []
			usedMode.value = response.mode || ''
			status.value = results.value.length ? 'success' : 'empty'

			// 推荐成功后刷新历史
			loadHistory()
		} catch (err) {
			status.value = 'error'
			errorMessage.value =
				err?.type === 'network'
					? '服务暂时不可用，请稍后重试'
					: err?.message || '推荐失败，请稍后重试'
		} finally {
			loading.value = false
		}
	}

	/** 追加一条消息并返回它的**响应式代理**（直接改原始对象不会触发视图更新） */
	function pushAiMessage(message) {
		aiMessages.value.push({ id: ++aiMessageSeed, error: false, pending: false, image: '', text: '', ...message })
		return aiMessages.value[aiMessages.value.length - 1]
	}

	/** 清空对话（界面上的「新对话」）：表单与推荐结果不受影响 */
	function resetAiChat() {
		aiMessages.value = []
		aiMessage.value = ''
		aiError.value = false
		aiParsing.value = false
	}

	/**
	 * 发一条消息给 AI（文字 / 照片 / 两者），把回话追加到对话流，并回填表单。
	 *
	 * 多轮语义：
	 *  - `history` 只带**文字**。图片是 data URL，动辄几百 KB，一旦进历史请求体会瞬间爆掉；
	 *  - 出错的那轮**不进历史**，否则会把「网络错误」当成对话内容喂回模型；
	 *  - 首轮**不传 current**：此时用户这句话本身才是条件的来源，不是「在当前条件上改」。
	 *    从第二轮起才把当前表单作为增量修改的基准，这样单轮行为与改造前完全一致。
	 *
	 * @param {{text?: string, image?: string, path?: string}} payload
	 *        text 文字需求；image 已是 data URL；path 本地图片路径（内部编码成 data URL）
	 * @returns {Promise<object|null>} 解析成功返回云端结果，失败返回 null（错误写进对话流）
	 */
	async function sendAiMessage(payload = {}) {
		if (aiParsing.value) return null

		const text = String(payload.text || '').trim()
		let image = typeof payload.image === 'string' ? payload.image : ''
		const path = String(payload.path || '')

		if (!text && !image && !path) return null

		// 先把历史取出来——必须在本轮用户消息入列**之前**，
		// 否则会把用户刚说的话既当历史又当本轮输入，模型会看到两遍。
		const history = aiMessages.value
			.filter((m) => !m.error && !m.pending && m.text)
			.map((m) => ({ role: m.role, content: m.text }))
		const hasPriorAnswer = aiMessages.value.some((m) => m.role === 'assistant' && !m.error)

		pushAiMessage({ role: 'user', text: text || '看看这张图片', image: path })
		const pendingBubble = pushAiMessage({ role: 'assistant', pending: true })

		aiParsing.value = true
		aiError.value = false
		try {
			// 本地路径先编码成 data URL；编码失败按请求失败处理（图片不可用）
			if (!image && path) {
				const encoded = await toImageDataUrl(path)
				image = encoded?.dataUrl || ''
				if (!image) throw new Error('这张图片暂时用不了，换一张试试')
			}

			const parsed = await parseNaturalLanguage(text, {
				image,
				history,
				current: hasPriorAnswer ? { ...form } : undefined
			})
			Object.assign(form, parsed.fields || {})
			resetErrors()

			pendingBubble.pending = false
			pendingBubble.text = parsed.reply || parsed.summary || '条件更新好啦～'
			// 提示条用 summary（条件清单），与「真正提交给推荐的条件」同源
			aiMessage.value = parsed.summary || pendingBubble.text
			return parsed
		} catch (err) {
			const message = err?.message || '哎，我这会儿有点没听清，再说一遍？'
			pendingBubble.pending = false
			pendingBubble.error = true
			pendingBubble.text = message
			aiError.value = true
			aiMessage.value = message
			return null
		} finally {
			aiParsing.value = false
		}
	}

	/** 加载历史记录 */
	async function loadHistory() {		historyLoading.value = true
		try {
			const { list } = await requestHistory(10)
			history.value = list
		} finally {
			historyLoading.value = false
		}
	}

	/** 用一条历史记录的参数回填表单并重新推荐 */
	async function replay(item) {
		form.servings = item.servings
		form.max_minutes = item.maxMinutes
		form.preference = item.preference || '不限'
		form.allergy = item.allergy || ''
		await submit()
	}

	/** 清空表单与结果 */
	function reset() {
		Object.assign(form, DEFAULT_FORM)
		resetErrors()
		results.value = []
		status.value = 'idle'
		errorMessage.value = ''
		hasSubmitted.value = false
		// 表单都回到默认了，对话上下文继续留着只会让模型基于过时条件改，一并清掉
		resetAiChat()
	}

	function choosePreference(value) {
		form.preference = value
		delete errors.preference
	}

	return {
		// 状态
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
		// 动作
		submit,
		sendAiMessage,
		resetAiChat,
		loadHistory,
		replay,
		reset,
		validateField,
		choosePreference
	}
}
