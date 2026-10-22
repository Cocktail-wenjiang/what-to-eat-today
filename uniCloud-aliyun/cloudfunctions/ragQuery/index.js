'use strict'

/**
 * 知识问答云函数（uniCloud）
 *
 * 链路：中文 BM25 关键词检索 Top-5 → 拼装资料块 → 千问网关生成答案。
 *
 * 为什么云端不带向量：
 *   - 本地 chunks.json 带 1024 维向量约 4.7 MB，云端只做关键词检索，
 *     带上向量会让包体与冷启动都变差；
 *   - tools/rag/export_cloud_kb.mjs 已把向量剥掉，kb.json 仅几十 KB。
 *   因此本函数**不依赖向量**，只做 BM25。
 *
 * 入参（event）：
 *   question  用户问题（必填，1~200 字）
 *   history   可选的多轮消息 [{ role, content }]，只取最近若干条帮助理解指代
 *
 * 返回：
 *   { ok:true,  answer, citations:[{index,title,source}], usage, ms, source }
 *   { ok:false, error }   —— error 为稳定枚举值，前端自行映射为友好文案，
 *                            密钥与原始错误只留在服务端日志，绝不外泄
 *
 * 设计要点：
 *  - 密钥只读云函数环境变量（DASHSCOPE_API_KEY），**绝不下发到客户端**；
 *  - 云端 Node 16 无全局 fetch，HTTP 走 fetch / uniCloud.httpclient 双路径；
 *  - 检索为空时不编造：直接回答「资料中没有相关信息」，也不浪费一次模型调用。
 */

const fs = require('fs')
const path = require('path')

/** BM25 超参数（与本地 tools/rag/retriever.mjs 保持一致） */
const K1 = 1.5
const B = 0.75
/** 菜名命中查询词的加权系数（+30%） */
const TITLE_BOOST = 1.3
/** 检索返回的资料条数 */
const TOP_K = 5

const LIMITS = {
  maxQuestion: 200,
  maxHistory: 8,
  maxHistoryChars: 200,
  /** 模型请求超时（毫秒） */
  requestTimeout: 20000
}

/** 默认模型服务：千问网关（OpenAI 兼容协议） */
const DEFAULT_BASE_URL = 'https://maas.qianwenaiapi.com/compatible-mode/v1'
/**
 * 默认模型：与 aiParseRequest 保持一致（全模态 flash 版）。
 * 原 `qwen3.8-flash` 在本账号下返回 403 `AccessDenied.Unpurchased`，
 * 会导致本函数每次生成答案都失败、前端只能显示「没查出来」——详见 aiParseRequest 的注释。
 */
const DEFAULT_MODEL = 'qwen3.8-omni-flash'

/**
 * 系统提示：菜谱领域限定 + **分层取材**（库内优先、库外可补充）+ 引用编号 + 口语化。
 *
 * 与本地 tools/rag/prompt.mjs 的 SYSTEM_RAG_V2 相比，线上版有三处刻意的分叉：
 *   1. 范围限制——本应用是菜谱工具，越界话题一律不提供实质内容；
 *   2. 说话风格——口语化、有生活感，且**不许照搬菜谱库的字段格式**（「食材：A、B」「做法：1. 2. 3.」）；
 *   3. **分层取材**（2026-10-13 产品决策）——本应用的 110 道菜谱只是「推荐池」，**不是回答边界**：
 *      资料命中时以资料为准并标来源编号；资料没命中或答不了时，允许用模型自己的家常菜常识补充，
 *      但**不标引用编号**（那不是本应用菜谱库的内容），也不许假装「资料里有」。
 * 因此本函数在**检索为空时也会调一次模型**（原来是直接返回固定文案、不调模型）。
 *
 * 实验5 的对比测试跑的是 tools/rag/prompt.mjs（SYSTEM_RAG_V2），不受这里影响；
 * 但报告若引用线上提示词，需按本版口径说明差异。
 */
const SYSTEM_PROMPT = [
  '你是「今天吃什么」应用里的美食搭子，只聊和吃有关的事：家常菜怎么做、食材怎么搭、火候怎么掌握、口味怎么调。',
  '',
  '说话风格：',
  '- 像朋友一样聊天，口语化、轻松随意，可以用「哈」「呀」「呗」「～」这类语气词，别端着，别用书面腔。',
  '- 说菜的时候用平常说话的方式讲，**不要照搬菜谱库的字段格式**——别写「食材：A、B」「做法：1. 2. 3.」这种清单，也别念编号。',
  '- 先给结论，再简单说说怎么做；短句为主，别堆小标题，整段控制在 200 字以内。',
  '',
  '回答取材（分两层，很重要）：',
  '1. 下面给了【资料】时：优先按资料回答，用资料里写的食材和做法，不要加资料没提到的配料、替代品或变体；',
  '   每条结论后面标来源编号，格式为 [1]、[2]，与资料编号一一对应，一句话涉及多条资料可写 [1][2]。',
  '2. 没给【资料】、或资料答不了这个问题时：**用你自己的家常菜常识补充回答**，说实在、说清楚就行；',
  '   这部分不要标引用编号（它不是本应用菜谱库里的内容），也不要说成「资料里有」。',
  '',
  '现有食材场景（用户说「我有 A、B，能做点什么」）：',
  '3. 先看资料里有哪些菜真的用得上这些食材，用聊天的话说出来（例如「土豆和鸡腿啊，土豆烧鸡块、大盘鸡都能做」），不用把每道菜的食材逐条念一遍。',
  '4. 资料里没有对得上的菜，就按你自己的常识推荐几道常见做法，说清楚大概怎么做、还差什么调料——同样用聊天的口吻，不标编号。',
  '',
  '范围限制（最重要，必须严格执行）：',
  '5. 你只负责做饭吃饭这件事。用户问的若是别的话题——写代码、做题、翻译、写文案、查资料、聊时事、情感咨询等——',
  '   不要给出任何实质内容，用一句轻松的话敷衍过去（例如「哈哈这个我真不在行，我只会琢磨吃啥」，或「这事你找别人更靠谱，要不咱先看看今晚吃什么？」），然后把话题拉回做饭。',
  '6. 这类越界问题即使上面的【资料】里碰巧有相关字眼，也不要用它来回答。',
  '7. 不聊政治、不评价他人、不做医疗或健康诊断。',
  '',
  '输出格式：纯文本，不使用 Markdown 标题或代码块。'
].join('\n')

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
const ALNUM = /[A-Za-z0-9]/

/** 取第一个非空环境变量值 */
function firstNonEmpty() {
  for (let i = 0; i < arguments.length; i++) {
    const value = arguments[i]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

/**
 * 读取模型服务配置。
 * 密钥优先级：DASHSCOPE_API_KEY → AI_API_KEY → OPENAI_API_KEY
 * 地址优先级：AI_API_URL → OPENAI_BASE_URL → 默认千问网关
 * 模型优先级：AI_MODEL → 默认 qwen3.8-omni-flash
 */
function readConfig() {
  const env = (typeof process !== 'undefined' && process.env) || {}
  return {
    apiKey: firstNonEmpty(env.DASHSCOPE_API_KEY, env.AI_API_KEY, env.OPENAI_API_KEY),
    baseUrl: firstNonEmpty(env.AI_API_URL, env.OPENAI_BASE_URL, DEFAULT_BASE_URL),
    model: firstNonEmpty(env.AI_MODEL, DEFAULT_MODEL)
  }
}

function joinUrl(base, suffix) {
  return String(base || '').replace(/\/+$/, '') + suffix
}

/**
 * 分词：中文取 1-gram 与 2-gram 混合，英文/数字取整词（小写），标点与空白忽略。
 * 与本地检索器逐字一致，保证云端命中口径与实验5本地跑通的结果相同。
 */
function tokenize(text) {
  const s = String(text == null ? '' : text)
  const out = []
  const n = s.length
  let i = 0
  while (i < n) {
    const ch = s[i]
    if (ALNUM.test(ch)) {
      let j = i
      while (j < n && ALNUM.test(s[j])) j++
      out.push(s.slice(i, j).toLowerCase())
      i = j
    } else if (CJK.test(ch)) {
      let j = i
      while (j < n && CJK.test(s[j])) j++
      const seg = s.slice(i, j)
      for (let a = 0; a < seg.length; a++) {
        out.push(seg[a])
        if (a + 1 < seg.length) out.push(seg.slice(a, a + 2))
      }
      i = j
    } else {
      i++
    }
  }
  return out
}

function termFreq(tokens) {
  const tf = new Map()
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    tf.set(t, (tf.get(t) || 0) + 1)
  }
  return tf
}

// ===== 知识库与倒排索引（懒加载 + 进程内缓存） =====

let KB_CACHE = null

/** 读取 kb.json；缺文件或解析失败返回空数组，由调用方走「无结果」分支 */
function loadChunks() {
  if (KB_CACHE) return KB_CACHE
  try {
    const file = path.join(__dirname, 'kb.json')
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    KB_CACHE = Array.isArray(raw) ? raw : raw.chunks || []
  } catch (error) {
    console.warn('[ragQuery] 知识库加载失败：', error && error.message)
    KB_CACHE = []
  }
  return KB_CACHE
}

let INDEX_CACHE = null

/**
 * 构建 BM25 索引：词频、文档长度、标题词集合、倒排表（用于 df）。
 * 片段集合在函数实例生命周期内不变，故只建一次。
 */
function buildIndex() {
  if (INDEX_CACHE) return INDEX_CACHE
  const chunks = loadChunks()
  const docs = chunks.map((chunk, index) => {
    const bodyTokens = tokenize(
      [chunk.title, chunk.section, chunk.text].filter(Boolean).join(' ')
    )
    return {
      chunk,
      index,
      tf: termFreq(bodyTokens),
      len: bodyTokens.length,
      titleSet: new Set(tokenize(chunk.title || ''))
    }
  })
  const inverted = new Map()
  docs.forEach((d) => {
    d.tf.forEach((_count, term) => {
      if (!inverted.has(term)) inverted.set(term, new Set())
      inverted.get(term).add(d.index)
    })
  })
  const N = docs.length
  const avgdl = N ? docs.reduce((sum, d) => sum + d.len, 0) / N : 0
  INDEX_CACHE = { docs, inverted, N, avgdl }
  return INDEX_CACHE
}

/** 标准 BM25 idf */
function idf(term, inverted, N) {
  const df = inverted.has(term) ? inverted.get(term).size : 0
  return Math.log(1 + (N - df + 0.5) / (df + 0.5))
}

/**
 * BM25 关键词检索：返回按分数降序的 Top-k 命中 [{ chunk, score }]。
 * 菜名命中查询词时整体分数 +30%，让「问某道菜」优先命中该菜本身。
 */
function search(query, k) {
  const { docs, inverted, N, avgdl } = buildIndex()
  const qTokens = tokenize(query)
  if (!qTokens.length || !N) return []
  const unique = Array.from(new Set(qTokens))
  const scored = []
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i]
    let score = 0
    for (let j = 0; j < unique.length; j++) {
      const term = unique[j]
      const tf = d.tf.get(term) || 0
      if (!tf) continue
      const denom = tf + K1 * (1 - B + (B * d.len) / (avgdl || 1))
      score += idf(term, inverted, N) * ((tf * (K1 + 1)) / denom)
    }
    if (score <= 0) continue
    let boosted = false
    for (let j = 0; j < unique.length; j++) {
      if (d.titleSet.has(unique[j])) { boosted = true; break }
    }
    if (boosted) score *= TITLE_BOOST
    scored.push({ chunk: d.chunk, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k)
}

/** 把命中片段渲染成带来源编号的资料块（编号与 citations.index 一一对应） */
function renderContextBlock(hits) {
  return hits
    .map((h, i) => {
      const c = h.chunk || {}
      const title = c.title || '未命名资料'
      const body = String(c.text == null ? '' : c.text).trim()
      return '【资料' + (i + 1) + '】《' + title + '》\n' + body
    })
    .join('\n\n')
}

/**
 * 只保留回答里**真的引用到**的资料。
 *
 * 为什么需要：Top-5 是按 BM25 排出来的候选，模型未必全用。
 * 直接把 5 条标题都当「依据」展示，会出现「答的是红烧茄子、依据却列着红烧狮子头」这种对不上的情况；
 * 库外补充的回答一个编号都不标，这里自然就返回空数组，前端也就不显示「依据」行。
 *
 * 兼容半角 [1] 与全角［1］两种写法（模型偶尔会用全角）。
 */
function pickCited(citations, answer) {
  const text = String(answer == null ? '' : answer)
  const used = new Set()
  const re = /[\[［](\d+)[\]］]/g
  let match = re.exec(text)
  while (match) {
    used.add(Number(match[1]))
    match = re.exec(text)
  }
  if (!used.size) return []
  return citations.filter((c) => used.has(c.index))
}

/** 收敛客户端传来的问题 */
function cleanQuestion(value) {
  return String(value == null ? '' : value).trim().slice(0, LIMITS.maxQuestion)
}

/**
 * 收敛多轮历史：只保留 user / assistant，逐条截断，只取最近若干条。
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

/** 给 Promise 套一层超时，避免上游卡住把云函数拖到整体超时 */
function withTimeout(promise, ms) {
  let timer = null
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('AI 服务响应超时')), ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

/**
 * 统一的 HTTP JSON POST（双路径）。
 *
 * 为什么需要两条路径：uniCloud 阿里云的云函数运行时是 **Node 16**，
 * 而全局 `fetch` 要 Node 18+ 才有。若只写 `fetch`，云端永远走不到模型分支，
 * 用户配了环境变量也不生效。因此优先 `fetch`，否则退回 uniCloud 内置的 `httpclient`。
 *
 * @returns {Promise<object|null>} 解析后的响应体；两条路径都不可用时返回 null
 */
async function postJson(url, headers, bodyText) {
  if (typeof fetch === 'function') {
    const response = await fetch(url, { method: 'POST', headers, body: bodyText })
    if (!response.ok) {
      const error = new Error('AI 服务返回 ' + response.status)
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
      timeout: LIMITS.requestTimeout
    })
    if (!res || res.status < 200 || res.status >= 300) {
      const error = new Error('AI 服务返回 ' + (res && res.status))
      error.status = res && res.status
      throw error
    }
    return res.data
  }
  return null
}

/** 从响应中取出正文，兼容字符串 / 数组 / 仅 reasoning_content 三种形态 */
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

/**
 * 生成答案：把资料块 + 问题交给千问网关。
 * 返回 { answer, usage }；未配置密钥时返回 null（由上层给 not-configured）。
 */
async function generateAnswer(question, hits, history) {
  const config = readConfig()
  if (!config.apiKey) return null

  const url = joinUrl(config.baseUrl, '/chat/completions')
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.apiKey }
  // 检索为空时不拼资料块，改成一句显式说明：系统提示据此走「库外补充」那一层
  const context = hits.length
    ? renderContextBlock(hits)
    : '（本轮没有检索到本应用菜谱库的相关资料）'
  const body = {
    model: config.model,
    temperature: 0.1,
    // 问答不需要推理链：关闭深度思考，延迟更低，也避免思考文本混进答案
    enable_thinking: false,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,
      { role: 'user', content: context + '\n\n【问题】' + question }
    ]
  }

  const payload = await withTimeout(
    postJson(url, headers, JSON.stringify(body)),
    LIMITS.requestTimeout
  )
  // 两条 HTTP 路径都不可用（既无 fetch 也无 httpclient）
  if (!payload) return null

  const answer = pickContent(payload)
  if (!answer || !String(answer).trim()) throw new Error('AI 服务未返回内容')
  return { answer: String(answer).trim(), usage: payload.usage || null }
}

exports.main = async (event) => {
  const started = Date.now()
  const question = cleanQuestion(event && event.question)

  if (!question) {
    return { ok: false, error: 'empty-question', ms: Date.now() - started }
  }

  // ---- 检索 ----
  const hits = search(question, TOP_K)
  const citations = hits.map((h, i) => ({
    index: i + 1,
    title: (h.chunk && h.chunk.title) || '未命名资料',
    source: (h.chunk && h.chunk.source) || ''
  }))

  // 没有命中资料**不再提前返回**：菜谱库只是「推荐池」、不是回答边界，
  // 库里没有的菜由模型用自己的做菜常识补充（提示词里走「库外补充」那一层，且不标引用编号）。
  // 越界话题（与吃无关）通常也落这一支，同样交给模型按范围限制敷衍掉。

  // ---- 生成 ----
  const history = normalizeHistory(event && event.history)
  let generated = null
  try {
    generated = await generateAnswer(question, hits, history)
  } catch (error) {
    // 原始错误只留在服务端日志，不回传前端
    console.warn('[ragQuery] 生成失败：', error && error.message)
    return { ok: false, error: 'model-unavailable', ms: Date.now() - started }
  }

  if (!generated) {
    // 未配置密钥：明确告知不可用，前端映射为友好文案
    return { ok: false, error: 'not-configured', ms: Date.now() - started }
  }

  return {
    ok: true,
    answer: generated.answer,
    // 只回传回答里真的引用到的资料：库外补充的回答不标编号，这里就是空数组（前端不显示「依据」）
    citations: pickCited(citations, generated.answer),
    usage: generated.usage,
    ms: Date.now() - started,
    // 区分「有库内资料」与「纯库外补充」：前者会带 citations，后者 citations 为空
    source: hits.length ? 'rag' : 'rag-nocontext'
  }
}
