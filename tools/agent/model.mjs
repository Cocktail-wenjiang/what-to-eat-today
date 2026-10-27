/**
 * 模型调用层
 *
 * 两种协议：
 *  ① 原生 function calling（tools 字段）—— 首选，模型直接返回结构化的 tool_calls；
 *  ② JSON 协议 —— 网关不支持 tools 时回退，要求模型只输出
 *     `{"action":"call_tool","tool":...,"arguments":{}}` 或 `{"action":"final","answer":"..."}`。
 *     两条路径对 harness 暴露同样的结构，所以上层循环不需要知道用的是哪一种。
 *
 * 另有一种 **scripted** 模式：用预置的响应序列代替真实模型。
 * 它只用于「模型不会稳定产出错误参数」这类确定性测试（见 2.6 的说明），
 * 日志里会明确标记 `protocol=scripted`，正常流程一律走真实模型。
 */
import { LIMITS } from './config.mjs'
import { describeToolsForPrompt, toOpenAITools } from './schema.mjs'

/** 模型调用失败的类型，写进日志用于统计 */
export const MODEL_ERROR = {
	TIMEOUT: 'MODEL_TIMEOUT',
	HTTP_5XX: 'MODEL_HTTP_5XX',
	HTTP_4XX: 'MODEL_HTTP_4XX',
	NETWORK: 'MODEL_NETWORK',
	BAD_OUTPUT: 'MODEL_BAD_OUTPUT'
}

/**
 * 创建模型客户端。
 * @param {{apiKey:string, baseUrl:string, model:string}} cfg
 * @param {object} [opts] { script, timeoutMs, maxRetries, onEvent }
 */
export function createModelClient(cfg, opts = {}) {
	const script = Array.isArray(opts.script) ? [...opts.script] : null
	const timeoutMs = opts.timeoutMs ?? LIMITS.modelTimeoutMs
	const maxRetries = opts.maxRetries ?? LIMITS.maxRetries
	const onEvent = opts.onEvent || (() => {})
	/** 记录本次运行实际使用的协议，供报告与日志引用 */
	let protocol = script ? 'scripted' : 'tools'

	async function chat({ messages, useTools = true }) {
		if (script) {
			// 脚本化响应：按顺序取，取完即视为模型不再产出（由 harness 判定为异常结束）
			const next = script.shift()
			if (!next) {
				const err = new Error('脚本化响应已用尽')
				err.code = MODEL_ERROR.BAD_OUTPUT
				throw err
			}
			onEvent({ type: 'model.scripted', index: script.length })
			return normalize({ ...next, protocol: 'scripted' })
		}

		if (protocol === 'tools' && useTools) {
			const raw = await requestWithRetry({ messages, withTools: true })
			if (raw.__toolsUnsupported) {
				// 网关明确拒绝 tools 字段 → 永久切到 JSON 协议，本次运行不再尝试
				protocol = 'json'
				onEvent({ type: 'model.protocol_fallback', from: 'tools', to: 'json' })
			} else {
				return normalize(raw)
			}
		}

		const raw = await requestWithRetry({ messages: withJsonProtocol(messages), withTools: false })
		return normalize(raw)
	}

	async function requestWithRetry({ messages, withTools }) {
		let lastError
		for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
			const started = Date.now()
			try {
				const payload = {
					model: cfg.model,
					messages,
					temperature: 0.1,
					// 该模型默认输出推理内容，推理 token 会计费也拖慢响应；
					// 实验5 的实测结论：文本场景 enable_thinking:false 有效
					enable_thinking: false
				}
				if (withTools) {
					payload.tools = toOpenAITools()
					payload.tool_choice = 'auto'
				}
				const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${cfg.apiKey}`
					},
					body: JSON.stringify(payload),
					signal: AbortSignal.timeout(timeoutMs)
				})
				const text = await res.text()
				const ms = Date.now() - started

				if (!res.ok) {
					const err = new Error(`HTTP ${res.status}：${text.slice(0, 200)}`)
					err.code = res.status >= 500 ? MODEL_ERROR.HTTP_5XX : MODEL_ERROR.HTTP_4XX
					// 4xx 且报文提到 tools/function → 判定网关不支持原生工具调用
					if (res.status === 400 && withTools && /tool|function/i.test(text)) {
						return { __toolsUnsupported: true }
					}
					// 4xx 属于参数/权限问题，重试没有意义
					if (err.code === MODEL_ERROR.HTTP_4XX) throw err
					lastError = err
					onEvent({ type: 'model.retry', attempt, code: err.code, ms })
					continue
				}

				const json = JSON.parse(text)
				return { ...json, __ms: ms, __attempt: attempt }
			} catch (error) {
				const ms = Date.now() - started
				const code =
					error?.name === 'TimeoutError' || error?.name === 'AbortError'
						? MODEL_ERROR.TIMEOUT
						: error?.code || MODEL_ERROR.NETWORK
				// 4xx 不重试，直接抛出
				if (code === MODEL_ERROR.HTTP_4XX) throw wrapError(error, code)
				lastError = wrapError(error, code)
				onEvent({ type: 'model.retry', attempt, code, ms, message: error?.message })
				if (attempt === maxRetries) break
				// 退避：400ms、800ms，避免网关抖动时连打
				await sleep(400 * 2 ** attempt)
			}
		}
		throw lastError
	}

	/** 把一次 HTTP 响应归一化成 harness 需要的结构 */
	function normalize(raw) {
		const choice = raw?.choices?.[0]
		const message = choice?.message || {}
		const toolCalls = []
		if (Array.isArray(message.tool_calls)) {
			for (const call of message.tool_calls) {
				let args = {}
				let parseError = ''
				try {
					args = call?.function?.arguments ? JSON.parse(call.function.arguments) : {}
				} catch (e) {
					// 参数不是合法 JSON 也属于"模型给的参数不可信"，交给执行层拒绝
					parseError = `arguments 不是合法 JSON：${String(call?.function?.arguments).slice(0, 120)}`
				}
				toolCalls.push({
					id: call.id || `call_${toolCalls.length}`,
					name: call?.function?.name || '',
					rawArguments: call?.function?.arguments || '',
					args,
					parseError
				})
			}
		}

		let content = typeof message.content === 'string' ? message.content : ''
		// JSON 协议：content 里是一段 JSON，解析成与 tool_calls 等价的结构
		if (raw.protocol === 'json' || (protocol === 'json' && !toolCalls.length && content)) {
			const parsed = parseJsonAction(content)
			if (parsed?.action === 'call_tool' && parsed.tool) {
				toolCalls.push({
					id: `json_${Date.now().toString(36)}`,
					name: String(parsed.tool),
					rawArguments: JSON.stringify(parsed.arguments ?? {}),
					args: parsed.arguments ?? {},
					parseError: ''
				})
				content = ''
			} else if (parsed?.action === 'final') {
				content = String(parsed.answer ?? '')
			}
		}

		return {
			protocol: raw.protocol || protocol,
			content,
			toolCalls,
			finishReason: choice?.finish_reason || '',
			usage: raw?.usage || null,
			ms: raw.__ms ?? null,
			attempt: raw.__attempt ?? 0
		}
	}

	return {
		chat,
		get protocol() {
			return protocol
		}
	}
}

/**
 * JSON 协议下追加的格式约束。
 * 工具清单必须写进提示词——回退路径没有 tools 字段，模型否则不知道有什么工具可用。
 */
function withJsonProtocol(messages) {
	const rule = [
		'【输出协议】你只能输出一个 JSON 对象，不要输出任何其它文字、不要用 Markdown 代码块包裹。',
		'需要调用工具时输出：{"action":"call_tool","tool":"工具名","arguments":{参数对象}}',
		'任务完成时输出：{"action":"final","answer":"给用户的最终回答"}',
		'可用工具如下：',
		describeToolsForPrompt()
	].join('\n')
	const [first, ...rest] = messages
	if (first?.role === 'system') {
		return [{ role: 'system', content: `${first.content}\n\n${rule}` }, ...rest]
	}
	return [{ role: 'system', content: rule }, ...messages]
}

/** 从模型输出里抽出 JSON；容忍 ```json 包裹与前后多余文字 */
function parseJsonAction(text) {
	const raw = String(text || '').trim()
	const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
	const candidates = [fenced?.[1], raw]
	const braced = raw.match(/\{[\s\S]*\}/)
	if (braced) candidates.push(braced[0])
	for (const c of candidates) {
		if (!c) continue
		try {
			const obj = JSON.parse(c)
			if (obj && typeof obj === 'object' && obj.action) return obj
		} catch {
			/* 继续尝试下一种切法 */
		}
	}
	return null
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 把任意异常包装成本模块自己的错误对象。
 *
 * 不能直接 `Object.assign(error, { code })`：fetch 抛出的 TimeoutError 是 DOMException，
 * `code` 是只读 getter，赋值会抛 "Cannot set property code which has only a getter"，
 * 把真正的超时原因盖成一个莫名其妙的二次异常（实验6 的 C4 用例就是这样暴露的）。
 */
function wrapError(error, code) {
	const wrapped = new Error(error?.message || String(error))
	wrapped.name = 'ModelCallError'
	wrapped.code = code
	wrapped.cause = error
	return wrapped
}
