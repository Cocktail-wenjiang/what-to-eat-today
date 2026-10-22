'use strict'

/**
 * 需求解析云函数：把「一句话需求」或「一张图」转换成推荐参数
 *
 * 三条路径（内部自动选择，客户端无感）：
 *   1. 文本 + 大模型      → source = 'model'
 *   2. 图片 + 多模态模型  → source = 'vision'
 *   3. 关键词解析         → source = 'keyword-fallback'（无密钥 / 请求失败 / 返回非法 JSON）
 *
 * 多轮对话（客户端把 history 与 current 一并送来）：
 *   - `current` 是客户端表单的**当前条件**，也是合并的基准；
 *   - `history` 是最近的对话消息，只用于让模型理解「再快一点」这类指代；
 *   - 模型只需在 current 上做**增量修改**，但必须回吐**完整字段**——
 *     回吐差量会把合并逻辑推给客户端，出错面更大；
 *   - 关键词回退看不懂多轮语义，因此做**字段级合并**：只采纳它真的解析到的字段，
 *     其余沿用 current，避免把用户前几轮填好的条件冲成默认值。
 *
 * 设计要点：
 *  - 密钥只读云函数环境变量，**绝不下发到客户端**；
 *  - 默认指向千问网关（OpenAI 兼容协议），可用环境变量覆盖；
 *  - 结构化解析显式关闭深度思考：思考模式下部分模型不接受 response_format 约束；
 *  - 云端 Node 16 无全局 fetch，HTTP 走 fetch / uniCloud.httpclient 双路径；
 *  - 图片请求失败**不静默降级**：关键词解析无法替代识图，否则用户会误以为识别成功。
 */

const LIMITS = {
  servings: { min: 1, max: 20 },
  maxMinutes: { min: 5, max: 240 },
  maxText: 120,
  /**
   * 图片 data URL 的字符数上限（约 675 KB 原始字节）。
   * 云函数单次调用的请求体有上限，取保守值留出余量；
   * 客户端 utils/image.js 会先压缩到 600 KB 以内，正常情况下不会触顶。
   */
  maxImageChars: 900 * 1024,
  /** 多轮对话：最多带上最近 8 条历史（4 轮），避免请求体无限膨胀 */
  maxHistory: 8,
  /** 单条历史最多 200 字（比 maxText 宽，因为 AI 回话可能略长） */
  maxHistoryChars: 200,
  /** 对话回话长度上限（模型给的 reply 会被截断到这个长度） */
  maxReply: 40
}

const PREFERENCES = ['清淡', '高蛋白', '素食', '快捷', '不限']

/** 表单默认值：既用于关键词解析的缺省，也用于收敛客户端传来的「当前条件」 */
const DEFAULT_FIELDS = { servings: 2, max_minutes: 30, preference: '不限', allergy: '' }

/** 默认模型服务：千问网关（OpenAI 兼容协议 + 原生多模态协议） */
const DEFAULT_BASE_URL = 'https://maas.qianwenaiapi.com/compatible-mode/v1'
const DEFAULT_NATIVE_BASE_URL = 'https://maas.qianwenaiapi.com/api/v1'
/**
 * 默认模型。
 *
 * 2026-10-13 调整：原 `qwen3.8-flash` 在本账号下调用返回
 * 403 `AccessDenied.Unpurchased`（未开通），实测同一密钥下 15 个候选对话模型中
 * 仅 `qwen3.8-omni-flash` 可用，故默认值切到它。
 * 它是全模态 flash 版，文本解析与识图两条路径都实测通过（文本约 0.9 s）。
 * 若后续在网关后台开通了其它模型，用环境变量 `AI_MODEL` 覆盖即可，无需改代码。
 */
const DEFAULT_MODEL = 'qwen3.8-omni-flash'

/**
 * 文本解析的系统提示：要求纯 JSON，字段与前端表单一一对应。
 *
 * `reply` 与 `summary` 分工不同，别混：
 *   - reply 是给对话界面用的**口语回话**（「好嘞，改成 3 个人了～」），由模型生成；
 *   - summary 是本地按最终字段生成的**条件清单**，用于关闭面板后的提示条。
 * 之所以不让模型复述全部条件：条件清单由本地 buildSummary 统一生成，
 * 才能保证「界面显示的条件」与「真正提交给推荐的条件」永远一致。
 *
 * 范围限制（与 ragQuery 的「只聊吃」口径一致）：
 * 本助手只处理吃饭相关的表达。用户说别的（写代码、问天气、聊八卦、做题……）时，
 * **一个字段都不许改**——原样回吐当前条件，reply 用一句轻松的话敷衍过去并把话题拉回吃饭。
 * 这样越界输入既不会污染用户已填好的条件，也不会在界面上抛错，符合「随意应付一下」的产品要求。
 */
const TEXT_SYSTEM_PROMPT =
  '你是「今天吃什么」应用里的点菜搭子，说话轻松随意、有生活感，像朋友聊天（可以用「哈」「呀」「呗」「～」这类语气词），别端着、别用书面腔。' +
  '你的活是听用户说话，把吃饭需求整理成条件。只输出 JSON，字段为：' +
  'reply(一句口语回话，40字以内，说明你这次做了什么改动)、' +
  'servings(1-20整数)、max_minutes(5-240整数)、' +
  'preference(只能是 清淡/高蛋白/素食/快捷/不限)、allergy(字符串)。' +
  '用户可能分多轮补充或修改条件：请在「当前条件」的基础上做增量修改，' +
  '并输出修改后的完整条件；用户没有提到的字段保持当前条件不变。' +
  '没有当前条件时，按用户这句话合理推断，缺失时使用 2、30、不限、空字符串。' +
  '范围限制（重要）：你只管吃饭这件事——吃什么、几个人、多久做完、口味、忌口。' +
  '用户要是说别的（写代码、问天气、做题、聊八卦之类），一个字段都不要改，保持当前条件原样输出，' +
  'reply 用一句轻松的话应付过去（例如「哈哈这个我可不在行，我就负责琢磨吃啥～」），并把话题拉回吃饭。' +
  '还有一类常见输入：用户报的是手头有的食材（例如「我有土豆和鸡腿，能做点什么」）。' +
  '这类问题你答不了——你只会填条件、不推荐菜，所以**不要改任何条件，也不要自己编菜名**，' +
  'reply 里把话引到「问一问」页（例如「食材搭配去问一问页找我哈，那边能按你手上的菜帮你找～」）。'

/**
 * 识图的系统提示：除表单字段外，额外产出菜品名与食材，供界面做产品化文案。
 *
 * 末尾的范围约束与文本分支同源：本助手只认「吃」。画面与吃无关（人像、风景、截图、代码……）时，
 * 菜品与食材一律留空，不要硬猜成食物——这样界面会走「没看出跟吃的关系」那条兜底文案，
 * 而不是给用户一个凭空编出来的菜名。
 */
const VISION_SYSTEM_PROMPT =
  '你是饮食助手。看图识别画面中的食材或菜品，只输出 JSON，字段为 dish(菜品名字符串，不确定时为空串)、ingredients(食材名数组，最多8项)、servings(1-20整数)、max_minutes(5-240整数)、preference(清淡/高蛋白/素食/快捷/不限)、allergy(字符串)。结合用户补充说明合理推断，缺失时使用 ""、[]、2、30、不限、""。若画面与吃的无关（人像、风景、截图、代码等），dish 与 ingredients 一律留空、其余字段用默认值，不要硬说成食物。'

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function cleanText(value) {
  return String(value == null ? '' : value).trim().slice(0, LIMITS.maxText)
}

/** 取第一个非空环境变量值，便于「新变量名优先、旧变量名兼容」 */
function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

/**
 * 读取模型服务配置。
 *
 * 密钥优先级：DASHSCOPE_API_KEY → AI_API_KEY → OPENAI_API_KEY
 * 地址优先级：AI_API_URL → OPENAI_BASE_URL → 默认千问网关
 * 模型优先级：AI_MODEL → 默认 qwen3.8-omni-flash
 */
function readConfig() {
  const env = (typeof process !== 'undefined' && process.env) || {}
  return {
    apiKey: firstNonEmpty(env.DASHSCOPE_API_KEY, env.AI_API_KEY, env.OPENAI_API_KEY),
    baseUrl: firstNonEmpty(env.AI_API_URL, env.OPENAI_BASE_URL, DEFAULT_BASE_URL),
    nativeBaseUrl: firstNonEmpty(env.AI_NATIVE_BASE_URL, DEFAULT_NATIVE_BASE_URL),
    model: firstNonEmpty(env.AI_MODEL, DEFAULT_MODEL)
  }
}

function joinUrl(base, path) {
  return String(base || '').replace(/\/+$/, '') + path
}

function findNumber(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) return Number(match[1])
  }
  return null
}

/**
 * 关键词解析（离线兜底）。
 *
 * 返回 `{ parsed, found }`：`found` 标记哪些字段是**真的从这段文本里解析出来的**，
 * 供多轮场景做字段级合并——关键词解析看不懂「再快一点」这类话，
 * 不能拿它的默认值去覆盖用户前几轮填好的条件。
 *
 * 语义与 recommend 云函数、前后端规则引擎保持一致：
 * 用时上限与忌口是硬条件，口味是软条件。
 */
function parseByKeywords(text) {
  const servings = findNumber(text, [
    /(?:^|[^0-9])([1-9]|1[0-9]|20)\s*(?:个人|人吃|人份)/,
    /([1-9]|1[0-9]|20)\s*人/
  ])
  const minutes = findNumber(text, [
    /(?:不超过|最多|控制在|用时|耗时|半小时内|小时内)\s*([0-9]{1,3})\s*分钟/,
    /([0-9]{1,3})\s*分钟(?:内|左右|完成)?/
  ])

  let preference = '不限'
  if (/清淡|少油|清爽|不辣/.test(text)) preference = '清淡'
  else if (/高蛋白|健身|增肌|蛋白质/.test(text)) preference = '高蛋白'
  else if (/素食|全素|不吃肉/.test(text)) preference = '素食'
  else if (/快捷|快手|省事|下班|懒人|简单/.test(text)) preference = '快捷'

  let allergy = ''
  const allergyMatch = text.match(/(?:不要|不吃|避开|忌口|过敏|别放)\s*([^，。！？,!.；;\s]{1,12})/)
  if (allergyMatch) allergy = allergyMatch[1].replace(/^(的|食材)/, '')

  const halfHour = /半小时/.test(text)
  const oneHour = /一小时|1小时/.test(text)

  const normalizedServings = servings == null
    ? DEFAULT_FIELDS.servings
    : clamp(Math.round(servings), LIMITS.servings.min, LIMITS.servings.max)
  let normalizedMinutes = minutes
  if (halfHour) normalizedMinutes = 30
  if (oneHour) normalizedMinutes = 60
  normalizedMinutes = normalizedMinutes == null
    ? DEFAULT_FIELDS.max_minutes
    : clamp(Math.round(normalizedMinutes), LIMITS.maxMinutes.min, LIMITS.maxMinutes.max)

  const fields = {
    servings: normalizedServings,
    max_minutes: normalizedMinutes,
    preference,
    allergy: allergy.slice(0, 30)
  }
  return {
    parsed: {
      fields,
      confidence: servings || minutes || preference !== '不限' || allergy ? 0.78 : 0.42,
      summary: buildSummary(fields),
      source: 'keyword-fallback'
    },
    found: {
      servings: servings != null,
      minutes: minutes != null || halfHour || oneHour,
      preference: preference !== '不限',
      allergy: allergy !== ''
    }
  }
}

/** 把模型返回的字段收敛到合法区间 */
function normalizeModelFields(value, fallbackFields) {
  const fields = value && typeof value === 'object' ? value : {}
  const base = fallbackFields && typeof fallbackFields === 'object' ? fallbackFields : {}
  return {
    servings: clamp(Number.isFinite(Number(fields.servings)) ? Math.round(Number(fields.servings)) : base.servings, LIMITS.servings.min, LIMITS.servings.max),
    max_minutes: clamp(Number.isFinite(Number(fields.max_minutes)) ? Math.round(Number(fields.max_minutes)) : base.max_minutes, LIMITS.maxMinutes.min, LIMITS.maxMinutes.max),
    preference: PREFERENCES.includes(String(fields.preference)) ? String(fields.preference) : base.preference,
    allergy: String(fields.allergy || base.allergy || '').trim().slice(0, 30)
  }
}

/**
 * 收敛客户端传来的「当前条件」。
 * 客户端送来的东西一律不可信（字段可能被改坏），所以复用同一套收敛逻辑。
 * 不是对象时返回 null，表示「没有基准」，此时按单轮处理。
 */
function normalizeCurrent(value) {
  if (!value || typeof value !== 'object') return null
  return normalizeModelFields(value, DEFAULT_FIELDS)
}

/**
 * 收敛对话历史。
 * 只保留 user / assistant 两种角色，逐条截断，并且只取最近 LIMITS.maxHistory 条——
 * 历史会整段进请求体，不设上限的话多聊几轮就会把请求撑大。
 */
function normalizeHistory(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && (item.role === 'user' || item.role === 'assistant'))
    .map((item) => ({
      role: item.role,
      content: String(item.content == null ? '' : item.content).trim().slice(0, LIMITS.maxHistoryChars)
    }))
    .filter((item) => item.content)
    .slice(-LIMITS.maxHistory)
}

/**
 * 字段级合并：`found` 标记哪些字段是**真的从本轮文本里解析出来的**，其余沿用 current。
 *
 * 关键词解析完全看不懂多轮语义——「再快一点」它一个字段都提不出来。
 * 若直接采用它的默认值（2 人 / 30 分钟 / 不限），用户前几轮填好的条件会被冲掉，
 * 表现为「聊着聊着条件全变回默认了」。
 */
function mergeFields(fields, found, current) {
  if (!current) return fields
  return {
    servings: found.servings ? fields.servings : current.servings,
    max_minutes: found.minutes ? fields.max_minutes : current.max_minutes,
    preference: found.preference ? fields.preference : current.preference,
    allergy: found.allergy ? fields.allergy : current.allergy
  }
}

/** 把「当前条件」写成一句自然语言，作为模型做增量修改的基准 */
function describeFields(fields) {
  if (!fields) return ''
  return `当前条件：${fields.servings}人、${fields.max_minutes}分钟内、口味${fields.preference}、忌口${fields.allergy || '无'}。`
}

/**
 * 本轮的用户消息：把「当前条件」与「用户新说的话」拼在一起。
 *
 * 只靠 history 让模型记住当前条件并不可靠（AI 回话是自然语言，会漂移），
 * 显式带上结构化条件才是稳定做法。
 */
function buildTurnPrompt(text, current) {
  const state = describeFields(current)
  return state ? `${state}\n用户新说：${text}` : text
}

/** 表单回填提示：只描述产品层面的理解结果，不暴露实现细节 */
function buildSummary(fields) {
  const parts = [
    `${fields.servings}个人`,
    `${fields.max_minutes}分钟内`,
    fields.preference === '不限' ? '口味不限' : fields.preference
  ]
  if (fields.allergy) parts.push(`避开${fields.allergy}`)
  return `我听着是：${parts.join('、')}。不对的话，下面还能接着改～`
}

/**
 * 模型没给 reply 时的对话回话。
 * 与 buildSummary 的区别：summary 是给提示条看的条件清单（第三人称陈述），
 * 这句是给对话气泡看的口语回应（第一人称、有「我做了什么」）。
 */
function buildReplyFallback(fields) {
  const parts = [
    `${fields.servings}人`,
    `${fields.max_minutes}分钟内`,
    fields.preference === '不限' ? '口味不限' : fields.preference
  ]
  if (fields.allergy) parts.push(`避开${fields.allergy}`)
  return `好嘞，按「${parts.join(' · ')}」记下了～`
}

/** 对话回话：优先用模型给的，缺失或为空时本地兜一句，保证气泡里永远有话说 */
function buildReply(raw, fields) {
  return cleanLabel(raw, LIMITS.maxReply) || buildReplyFallback(fields)
}

/**
 * 统一的 HTTP JSON POST。
 *
 * 为什么需要两条路径：uniCloud 阿里云的云函数运行时是 **Node 16**，
 * 而全局 `fetch` 要 Node 18+ 才有。若只写 `fetch`，模型分支在云端永远走不到，
 * 用户配了环境变量也不会生效（会静默退回关键词解析）。
 * 因此优先用 `fetch`（本地测试 / 高版本运行时），
 * 否则退回 uniCloud 内置的 `httpclient`（Node 16 可用）。
 *
 * 抛出的错误带 `status` 字段，供上层判断是否需要「换参数重试」。
 *
 * @returns {Promise<object|null>} 解析后的响应体；两条路径都不可用时返回 null
 */
async function postJson(url, headers, bodyText) {
  if (typeof fetch === 'function') {
    const response = await fetch(url, { method: 'POST', headers, body: bodyText })
    if (!response.ok) {
      const error = new Error(`AI 服务返回 ${response.status}`)
      error.status = response.status
      throw error
    }
    return await response.json()
  }
  if (typeof uniCloud !== 'undefined' && uniCloud && uniCloud.httpclient) {
    const res = await uniCloud.httpclient.request(url, {
      method: 'POST',
      headers,
      content: bodyText,
      dataType: 'json',
      timeout: 20000
    })
    if (!res || res.status < 200 || res.status >= 300) {
      const error = new Error(`AI 服务返回 ${res && res.status}`)
      error.status = res && res.status
      throw error
    }
    return res.data
  }
  return null
}

/**
 * 从响应中取出正文。
 * 兼容三种形态：字符串正文、多模态数组正文、以及只返回 reasoning_content 的情况。
 */
function pickContent(payload) {
  const message = payload && payload.choices && payload.choices[0] && payload.choices[0].message
  if (!message) return null
  const content = message.content
  if (typeof content === 'string' && content.trim()) return content
  if (Array.isArray(content)) {
    const joined = content
      .map((part) => (typeof part === 'string' ? part : (part && part.text) || ''))
      .join('')
    if (joined.trim()) return joined
  }
  const reasoning = message.reasoning_content
  if (typeof reasoning === 'string' && reasoning.trim()) return reasoning
  return null
}

/** 千问原生多模态接口的响应取正文 */
function pickNativeContent(payload) {
  const content = payload && payload.output && payload.output.choices && payload.output.choices[0] &&
    payload.output.choices[0].message && payload.output.choices[0].message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const joined = content
      .map((part) => (typeof part === 'string' ? part : (part && part.text) || ''))
      .join('')
    if (joined.trim()) return joined
  }
  return null
}

/**
 * 从模型输出里稳健地取出 JSON 对象。
 * 模型常会包一层 ```json 围栏或在前后加解释文字，这里统一剥离；
 * 取不到合法对象时返回 null，由上层回退关键词解析。
 */
function extractJson(content) {
  if (content == null) return null
  if (typeof content === 'object') return content
  const text = String(content).trim()
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/**
 * 文本解析：大模型分支。返回 null 表示「本轮不可用」，由上层回退。
 *
 * @param {string} text 用户本轮说的话
 * @param {{fields: object}} fallback 关键词解析结果，用于模型漏字段时回落
 * @param {{history: Array, current: object|null}} context 多轮上下文
 */
async function parseTextByModel(text, fallback, context) {
  const config = readConfig()
  if (!config.apiKey) return null

  const url = joinUrl(config.baseUrl, '/chat/completions')
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` }
  const body = {
    model: config.model,
    temperature: 0.1,
    // 结构化解析关闭深度思考：思考模式下部分模型不接受 response_format 约束，
    // 且解析任务不需要推理链，关闭后延迟更低。
    enable_thinking: false,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: TEXT_SYSTEM_PROMPT },
      // 历史插在当前用户消息之前；无历史时用户消息仍落在 messages[1]（契约测试锁定）
      ...context.history,
      { role: 'user', content: buildTurnPrompt(text, context.current) }
    ]
  }

  let payload = null
  try {
    payload = await postJson(url, headers, JSON.stringify(body))
  } catch (error) {
    // 网关不支持 response_format 时会返回 400，去掉该约束重试一次
    if (error && error.status === 400) {
      delete body.response_format
      payload = await postJson(url, headers, JSON.stringify(body))
    } else {
      throw error
    }
  }
  // 两条 HTTP 路径都不可用（既无 fetch 也无 httpclient）→ 交给上层回退
  if (!payload) return null

  const parsed = extractJson(pickContent(payload))
  if (!parsed) throw new Error('AI 服务未返回可解析的结果')

  const fields = normalizeModelFields(parsed, fallback.fields)
  return {
    fields,
    confidence: 0.92,
    reply: buildReply(parsed.reply, fields),
    summary: buildSummary(fields),
    source: 'model'
  }
}

function cleanLabel(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength)
}

/** 识图结果的文案：只说「看到了什么」，不暴露识别来源 */
function buildVisionSummary(dish, ingredients, fields) {
  const base = buildSummary(fields)
  if (dish && ingredients.length) {
    return `图片里是「${dish}」，用到的食材有 ${ingredients.join('、')}。${base}`
  }
  if (dish) return `图片里是「${dish}」。${base}`
  if (ingredients.length) return `图片里能看到 ${ingredients.join('、')}。${base}`
  return `这张图我没太看出跟吃的关系哈，先按常见的给你填上。${base}`
}

/**
 * 识图的对话回话：先说「看到了什么」，再说「填了什么」。
 * 识图提示词不产出 reply（宽松输出更适合识图），所以这里本地拼一句，
 * 保证对话界面里图片那条消息也永远有 AI 回应。
 *
 * 什么都没识别出来时（画面与吃无关，或图太糊）**不能**再说「按…记下了」——
 * 那会与「没看出跟吃的关系」自相矛盾，用户会以为图被认出来了。这一支单独给一句话。
 */
function buildVisionReply(dish, ingredients, fields) {
  if (!dish && !ingredients.length) {
    return '这张图我没太看出跟吃的关系哈，先按常见的给你填上了～'
  }
  const seen = dish ? `我看到「${dish}」` : `我看到 ${ingredients.slice(0, 3).join('、')}`
  return `${seen}，${buildReplyFallback(fields)}`
}

/** 把识图模型的输出整理成统一结构（baseFields 为缺省字段的回落基准） */
function buildVisionResult(parsed, baseFields) {
  const fields = normalizeModelFields(parsed, baseFields)
  const dish = cleanLabel(parsed.dish, 20)
  const ingredients = Array.isArray(parsed.ingredients)
    ? parsed.ingredients.map((item) => cleanLabel(item, 12)).filter(Boolean).slice(0, 8)
    : []
  return {
    fields,
    confidence: 0.9,
    reply: buildVisionReply(dish, ingredients, fields),
    summary: buildVisionSummary(dish, ingredients, fields),
    source: 'vision',
    recognized: { dish, ingredients }
  }
}

/**
 * 识图解析：多模态分支。
 *
 * 先走 OpenAI 兼容协议（image_url + data URL），失败再走千问原生多模态接口。
 * 之所以要两条：兼容模式对图片入参的支持在不同网关/模型上不一致，
 * 而原生接口是千问官方的标准形态，作为兜底能显著提高成功率。
 *
 * 注意这里**不传 response_format**：识图走的是宽松输出 + 本地稳健提取，
 * 少一个可能被网关拒绝的参数，就少一类失败。
 *
 * 返回 null 表示「未配置密钥」；抛出异常表示「配了但识别失败」。
 *
 * @param {string} image 图片 data URL 或 http(s) 地址
 * @param {string} text 用户本轮的补充说明（可为空）
 * @param {object} baseFields 缺省字段的回落基准（多轮场景下即「当前条件」）
 * @param {{history: Array, current: object|null}} context 多轮上下文
 */
async function parseImageByModel(image, text, baseFields, context) {
  const config = readConfig()
  if (!config.apiKey) return null

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` }
  // 有当前条件时把它一起说明白，模型才知道这次是在改哪几个字段
  const state = describeFields(context.current)
  const ask = text ? `用户补充说明：${text}` : '请看看这张图片。'
  const askWithState = state ? `${state}\n${ask}` : ask

  // 路径 1：OpenAI 兼容协议
  try {
    const body = {
      model: config.model,
      temperature: 0.1,
      enable_thinking: false,
      messages: [
        { role: 'system', content: VISION_SYSTEM_PROMPT },
        // 历史插在当前图片消息之前；无历史时图片消息仍落在 messages[1]（契约测试锁定）
        ...context.history,
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: image } },
            { type: 'text', text: askWithState }
          ]
        }
      ]
    }
    const payload = await postJson(joinUrl(config.baseUrl, '/chat/completions'), headers, JSON.stringify(body))
    if (payload) {
      const parsed = extractJson(pickContent(payload))
      if (parsed) return buildVisionResult(parsed, baseFields)
    }
  } catch (error) {
    console.warn('兼容模式识图失败，改用原生多模态接口：', error && error.message)
  }

  // 路径 2：千问原生多模态接口
  const nativeBody = {
    model: config.model,
    input: {
      messages: [
        ...context.history,
        {
          role: 'user',
          content: [{ image: image }, { text: `${VISION_SYSTEM_PROMPT}\n${askWithState}` }]
        }
      ]
    },
    parameters: { result_format: 'message' }
  }
  const payload = await postJson(
    joinUrl(config.nativeBaseUrl, '/services/aigc/multimodal-generation/generation'),
    headers,
    JSON.stringify(nativeBody)
  )
  if (!payload) return null

  const parsed = extractJson(pickNativeContent(payload))
  if (!parsed) throw new Error('AI 服务未返回可解析的结果')
  return buildVisionResult(parsed, baseFields)
}

/**
 * 校验图片入参。
 * @returns {{image: string}|{error: string}} 合法时给出去空格后的值，否则给出面向用户的通用说明
 */
function normalizeImage(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return { image: '' }
  const isDataUrl = /^data:image\/[a-z0-9.+-]+;base64,/i.test(raw)
  const isHttpUrl = /^https?:\/\//i.test(raw)
  if (!isDataUrl && !isHttpUrl) return { error: '这张图我打不开，换一张试试？' }
  if (raw.length > LIMITS.maxImageChars) return { error: '图有点大，压小一点再发我呗' }
  return { image: raw }
}

exports.main = async (event) => {
  const text = cleanText(event && event.text)
  const imageResult = normalizeImage(event && event.image)
  if (imageResult.error) return { error: imageResult.error }
  const image = imageResult.image

  if (!text && !image) return { error: '需求文本不能为空' }

  // 多轮上下文：current 是合并基准，history 只帮模型理解指代
  const current = normalizeCurrent(event && event.current)
  const history = normalizeHistory(event && event.history)

  // 关键词结果按字段级合并到 current 上——它读不懂「再快一点」，
  // 只采纳它真的解析到的字段，其余沿用用户前几轮的条件。
  const { parsed: keyword, found } = parseByKeywords(text)
  const fallbackFields = mergeFields(keyword.fields, found, current)
  const fallback = {
    ...keyword,
    fields: fallbackFields,
    reply: buildReplyFallback(fallbackFields),
    summary: buildSummary(fallbackFields)
  }

  // 有图走识图：失败时**不静默降级**——关键词解析替代不了识图，
  // 若返回关键词结果，用户会误以为图片被识别了。
  if (image) {
    try {
      const viaImage = await parseImageByModel(image, text, fallbackFields, { history, current })
      if (viaImage) return viaImage
    } catch (error) {
      console.warn('图片解析失败：', error && error.message)
    }
    return { error: '这张图我有点看不明白哎，要不你直接说说想吃啥？' }
  }

  try {
    return (await parseTextByModel(text, fallback, { history, current })) || fallback
  } catch (error) {
    console.warn('AI 解析失败，使用关键词回退：', error && error.message)
    return { ...fallback, source: 'keyword-fallback', fallbackReason: 'model-unavailable' }
  }
}
