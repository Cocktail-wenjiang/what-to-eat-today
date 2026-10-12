/**
 * 推荐业务状态管理（组合式函数）
 *
 * 集中管理：
 *  - 表单状态与校验错误
 *  - 请求状态机 idle / loading / success / empty / error
 *  - 数据通道切换提示（实时推送 / 后端 / 本地兜底）
 *  - 流式推送进度（SSE 逐帧渲染）
 *  - 推荐历史
 *  - 表单草稿本地持久化（刷新不丢输入）
 */
import { reactive, ref, computed, watch, onMounted } from 'vue'
import {
  requestRecommendation,
  requestRecommendationStream,
  requestHistory,
  CHANNEL_LABEL,
} from '@/api/client'
import { validateForm, toRequestPayload } from '@/utils/validators'

const DRAFT_KEY = 'what-to-eat:form-draft'

/** 表单默认值 */
const DEFAULT_FORM = {
  servings: 2,
  max_minutes: 30,
  preference: '清淡',
  allergy: '',
}

/** 从 localStorage 读取草稿，异常时回退默认值 */
function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return { ...DEFAULT_FORM }
    return { ...DEFAULT_FORM, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_FORM }
  }
}

export function useRecommendation() {
  const form = reactive(loadDraft())
  const errors = reactive({})
  const results = ref([])
  const history = ref([])
  const historyChannel = ref('')
  const loading = ref(false)
  const historyLoading = ref(false)
  /** idle | loading | success | empty | error */
  const status = ref('idle')
  const channel = ref('')
  const degraded = ref(false)
  const errorMessage = ref('')
  const usedMode = ref('')
  const hasSubmitted = ref(false)
  /** 流式推送进度：{ current, total }，仅在 loading 期间有意义 */
  const streamProgress = ref({ current: 0, total: 0 })

  /** 表单草稿持久化：输入即存，避免误刷新丢失 */
  watch(
    () => ({ ...form }),
    (value) => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(value))
      } catch {
        /* 隐私模式下 localStorage 不可用，忽略即可 */
      }
    },
    { deep: true }
  )

  /** 顶部状态条文案 */
  const statusText = computed(() => {
    if (status.value === 'loading') {
      const { current, total } = streamProgress.value
      if (total > 0) return `实时推送中：已匹配 ${current}/${total} 道菜谱`
      if (current > 0) return `实时推送中：已收到 ${current} 道菜谱`
      return '正在建立实时通道…'
    }
    if (status.value === 'error') return errorMessage.value
    if (status.value === 'empty') {
      return '没有同时满足条件的菜谱，试试放宽用时或换个口味'
    }
    if (status.value === 'success') {
      return `已为你匹配到 ${results.value.length} 道菜谱`
    }
    return '填写你的需求，开始一次匹配'
  })

  /** 当前链路展示名 */
  const channelLabel = computed(() => CHANNEL_LABEL[channel.value] || '未连接')

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
    streamProgress.value = { current: 0, total: 0 }

    const payload = toRequestPayload(form)

    try {
      let response
      try {
        // 优先走 SSE 流式通道：边匹配边渲染，进度实时可见
        response = await requestRecommendationStream(payload, {
          onEvent: (event) => {
            if (event.type === 'start') {
              streamProgress.value = { current: 0, total: 0 }
            } else if (event.type === 'recipe') {
              results.value = [...results.value, event.recipe]
              streamProgress.value = { current: event.index, total: event.total }
            }
          },
        })
      } catch (streamError) {
        console.warn('[channel] 实时推送不可用，降级到常规请求：', streamError.message)
        response = await requestRecommendation(payload)
      }

      results.value = response.recommendations || []
      channel.value = response.channel
      degraded.value = Boolean(response.degraded)
      usedMode.value = response.mode || ''
      status.value = results.value.length ? 'success' : 'empty'

      // 推荐成功后刷新历史（后端通道会落库）
      loadHistory()
    } catch (err) {
      status.value = 'error'
      errorMessage.value =
        err?.type === 'network'
          ? '推荐服务暂时不可用，请确认后端已启动或检查网络后重试'
          : err?.message || '推荐失败，请稍后重试'
    } finally {
      loading.value = false
      streamProgress.value = { current: 0, total: 0 }
    }
  }

  /** 加载历史记录 */
  async function loadHistory() {
    historyLoading.value = true
    try {
      const { list, channel: ch } = await requestHistory(10)
      history.value = list
      historyChannel.value = ch
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
  }

  function choosePreference(value) {
    form.preference = value
    delete errors.preference
  }

  onMounted(() => {
    loadHistory()
  })

  return {
    // 状态
    form,
    errors,
    results,
    history,
    historyChannel,
    loading,
    historyLoading,
    status,
    channel,
    channelLabel,
    degraded,
    errorMessage,
    usedMode,
    hasSubmitted,
    statusText,
    streamProgress,
    // 动作
    submit,
    loadHistory,
    replay,
    reset,
    validateField,
    choosePreference,
  }
}
