/**
 * 运行时 Harness
 *
 * 职责：组织模型与工具之间的循环。模型只负责「下一步做什么」，本文件负责
 * 「能不能做、做完怎么记、什么时候必须停」。
 *
 * 循环（与报告 2.3 的循环图一一对应）：
 *
 *   接收目标
 *     ↓
 *   ┌─→ ① 停止检查（步数 / 总时限 / 外部中止）      ← 程序
 *   │     ↓
 *   │   ② 模型提出调用请求或给出最终回答             ← 模型
 *   │     ↓
 *   │   ③ 参数校验 + 权限判定（含人工确认）          ← 程序
 *   │     ↓
 *   │   ④ 执行工具，结果回填进上下文                 ← 程序
 *   │     ↓
 *   └── ⑤ 结果检查（成功标准），未满足则继续
 *         ↓
 *       ⑥ 落盘日志、返回状态
 *
 * 关键：限制由代码执行，不靠提示词自觉。提示词里也写一遍，是为了让模型少走弯路，
 * 不是因为提示词能拦住越界行为。
 */
import { LIMITS } from './config.mjs'
import { createExecutor } from './registry.mjs'
import { createLogger, digest } from './logger.mjs'
import { createModelClient, MODEL_ERROR } from './model.mjs'
import { ALLOWED_TOOLS } from './registry.mjs'
import { loadRecipes } from './tools.mjs'

/** 终止状态：报告里的「最终状态」列直接引用这些值 */
export const STATUS = {
	SUCCESS: 'SUCCESS',
	FAILED_VERIFY: 'FAILED_VERIFY',
	STEP_LIMIT: 'STEP_LIMIT',
	TIMEOUT: 'TIMEOUT',
	MODEL_ERROR: 'MODEL_ERROR',
	REPEAT_FAILURE: 'REPEAT_FAILURE',
	ABORTED: 'ABORTED',
	CONFIG_ERROR: 'CONFIG_ERROR'
}

/** 这些错误码不计入「工具连续失败」：它们是程序主动拦截，不是工具故障 */
const NOT_COUNTED_AS_FAILURE = new Set(['TOOLCALL_LIMIT'])

const SYSTEM_PROMPT = [	'你是「今天吃什么」App 里的配餐助手，任务是用工具查真实菜谱数据，再给用户一份可执行的菜单。',
	'',
	'工作规则：',
	'1. 所有菜品信息必须来自工具返回结果，禁止凭记忆写出菜名、编号、用时或统计数字。',
	'2. 必须先调用 search_recipes 拿到候选，再按需调用 recipe_detail 看食材与步骤；',
	'   要给整餐用时统计时调用 calc_stats，不要自己心算。',
	'3. 若要把菜单存成文件，调用 save_menu；该操作会请用户确认，用户拒绝时不要重试，改用文字给出菜单。',
	'4. 工具返回错误时，读错误信息修正参数后最多再试一次；同一个错误不要反复重试。',
	'5. 信息不足以完成目标时（例如筛不到菜），直接说明缺口，不要编造。',
	'',
	'最终回答要求：中文；先给菜单（每道菜写菜名与用时），再给整餐统计（总用时、道数）；',
	'只能提到工具结果里出现过的菜。不要在回答里输出 JSON。'
].join('\n')

/**
 * 运行一次 Agent 任务。
 *
 * @param {object} params
 * @param {string} params.goal 用户目标（自然语言）
 * @param {{apiKey:string,baseUrl:string,model:string}} [params.modelConfig]
 * @param {object} [params.options]
 *        maxSteps / deadlineMs / toolTimeoutMs / confirm / faults / script /
 *        writeDir / echo / signal / onEvent
 * @returns {Promise<object>} 运行结果（含状态、步数、耗时、校验明细、日志路径）
 */
export async function runAgent({ goal, modelConfig, options = {} }) {
	const startedAt = Date.now()
	const taskId = makeTaskId()
	const maxSteps = options.maxSteps ?? LIMITS.maxSteps
	const deadlineMs = options.deadlineMs ?? LIMITS.totalDeadlineMs
	const logger = createLogger({ taskId, echo: options.echo !== false })
	const deadline = startedAt + deadlineMs

	const run = {
		taskId,
		goal,
		startedAt: new Date(startedAt).toISOString(),
		status: null,
		answer: '',
		steps: 0,
		toolCalls: 0,
		ms: 0,
		protocol: '',
		model: modelConfig?.model || '',
		verification: null,
		logFile: logger.file,
		/** 本次运行的全部日志事件（与 JSONL 内容一致），供测试套件断言使用 */
		events: logger.events,
		stopReason: '',
		errorType: ''
	}

	logger.log({ event: 'run.start', goal, maxSteps, deadlineMs, model: modelConfig?.model || '(scripted)' })

	if (!modelConfig && !options.script) {
		run.status = STATUS.CONFIG_ERROR
		run.stopReason = '缺少模型配置，且未提供脚本化响应'
		logger.log({ event: 'run.end', status: run.status, note: run.stopReason })
		return finish(run, startedAt)
	}

	/** 人工确认回调：默认实现由 CLI 注入；测试可注入自动应答 */
	const confirm = options.confirm || defaultConfirm
	const executor = createExecutor({
		confirm,
		faults: options.faults || {},
		toolTimeoutMs: options.toolTimeoutMs ?? LIMITS.toolTimeoutMs,
		writeDir: options.writeDir
	})

	const model = createModelClient(modelConfig || {}, {
		script: options.script,
		timeoutMs: options.modelTimeoutMs ?? LIMITS.modelTimeoutMs,
		maxRetries: options.maxRetries ?? LIMITS.maxRetries,
		onEvent: (e) => logger.log({ event: e.type, ...e })
	})

	const messages = [
		{ role: 'system', content: SYSTEM_PROMPT },
		{ role: 'user', content: goal }
	]

	/** 已核实过的事实：只有进过这里的内容才允许出现在最终回答里 */
	const observed = { recipes: new Map(), stats: null, savedMenu: null }
	/** 连续失败计数：同一工具连续失败 3 次即终止，防止无限循环 */
	const failureStreak = new Map()

	for (let step = 1; step <= maxSteps; step += 1) {
		// ① 停止检查（每步开头，程序强制执行）
		const stop = checkStop({ deadline, deadlineMs, signal: options.signal })
		if (stop) {
			run.status = stop.status
			run.stopReason = stop.reason
			logger.log({ event: 'stop.check', step, status: stop.status, note: stop.reason })
			break
		}

		run.steps = step
		let turn
		try {
			// ② 模型提出下一步
			// 外面套一层兜底：即使底层 fetch 因网关长尾不响应、AbortSignal 未能及时生效，
			// 也不能让一步无限期挂着（实测出现过 11 分钟无任何事件的情况）
			turn = await withDeadline(model.chat({ messages }), deadline)
			run.protocol = turn.protocol
			logger.log({
				step,
				event: 'model.turn',
				ms: turn.ms,
				finishReason: turn.finishReason,
				toolCalls: turn.toolCalls.length,
				promptTokens: turn.usage?.prompt_tokens ?? null,
				completionTokens: turn.usage?.completion_tokens ?? null,
				protocol: turn.protocol,
				note: turn.toolCalls.length
					? `请求调用：${turn.toolCalls.map((c) => c.name).join('、')}`
					: '给出最终回答'
			})
		} catch (error) {
			run.status = error?.code === MODEL_ERROR.TIMEOUT ? STATUS.TIMEOUT : STATUS.MODEL_ERROR
			run.errorType = error?.code || MODEL_ERROR.NETWORK
			run.stopReason = `模型调用失败：${error?.message || String(error)}`
			logger.log({ step, event: 'model.error', errorType: run.errorType, note: run.stopReason })
			break
		}

		// 没有工具调用 → 视为最终回答，交给结果检查
		if (!turn.toolCalls.length) {
			run.answer = (turn.content || '').trim()
			logger.log({ step, event: 'agent.final', note: digest(run.answer, 200) })
			break
		}

		// 一次响应里工具调用过多：只执行前 N 个，其余回一条错误结果，避免绕过步数上限
		if (turn.toolCalls.length > LIMITS.maxToolCallsPerStep) {
			logger.log({
				step,
				event: 'guard.toolcall_limit',
				note: `单步请求 ${turn.toolCalls.length} 个工具调用，超过上限 ${LIMITS.maxToolCallsPerStep}，多余的将被拒绝`
			})
		}

		// 把模型的调用意图原样回填进上下文（OpenAI 协议要求 assistant.tool_calls 与 tool 消息配对）
		messages.push({
			role: 'assistant',
			content: turn.content || null,
			tool_calls: turn.toolCalls.map((c) => ({
				id: c.id,
				type: 'function',
				function: { name: c.name, arguments: c.rawArguments || JSON.stringify(c.args) }
			}))
		})

		for (let i = 0; i < turn.toolCalls.length; i += 1) {
			const call = turn.toolCalls[i]
			const overLimit = i >= LIMITS.maxToolCallsPerStep

			// ③④ 校验 + 权限 + 执行
			const result = overLimit
				? {
						ok: false,
						error: {
							code: 'TOOLCALL_LIMIT',
							message: `单步最多 ${LIMITS.maxToolCallsPerStep} 个工具调用，本次未执行`
						},
						meta: { tool: call.name, ms: 0, errorType: 'TOOLCALL_LIMIT' }
					}
				: call.parseError
					? {
							ok: false,
							error: { code: 'VALIDATION_ERROR', message: call.parseError },
							meta: { tool: call.name, ms: 0, errorType: 'VALIDATION_ERROR' }
						}
					: await executor.execute(call.name, call.args, { step })

			run.toolCalls += overLimit ? 0 : 1
			const toolResult = buildToolMessage(result, call)
			messages.push(toolResult.message)

			// 人工确认单独记一条：确认是控制流程的一部分，不能只体现在工具结果里
			if (result.meta?.confirm) {
				const c = result.meta.confirm
				logger.log({
					step,
					event: 'tool.confirm',
					tool: call.name,
					ms: c.waitMs,
					ok: c.approved,
					note: `${c.approved ? '同意' : '拒绝'}（来源 ${c.source}）｜${c.preview}`
				})
			}

			logger.log({
				step,
				event: 'tool.result',
				tool: call.name,
				ms: result.meta?.ms ?? 0,
				ok: result.ok,
				// 用 meta.errorType 而不是 result.error.code：成功路径也可能带错误标签，
				// 例如写操作超时后经核对确认已落盘（TOOL_TIMEOUT_RECONCILED），
				// 这时 ok=true 但必须能从日志里看出「它是靠核对才判成功的」。
				errorType: result.meta?.errorType,
				argsDigest: digest(call.args ?? {}),
				resultDigest: digest(result.ok ? result.data : result.error, 200)
			})

			// 记录已核实事实
			if (result.ok) {
				rememberFact(observed, call.name, result.data)
				failureStreak.set(call.name, 0)
			} else if (!NOT_COUNTED_AS_FAILURE.has(result.error?.code)) {
				// 只有「工具本身没做成」才计入连续失败。
				// TOOLCALL_LIMIT 是模型单步超额被程序拦下，不是工具故障；
				// 把它算进去会让「连续失败 3 次」保护被误触发（实验6 的 C4 就踩到过）。
				const n = (failureStreak.get(call.name) || 0) + 1
				failureStreak.set(call.name, n)
				if (n >= 3) {
					run.status = STATUS.REPEAT_FAILURE
					run.stopReason = `工具 ${call.name} 连续失败 ${n} 次，停止任务以避免空转`
					logger.log({ step, event: 'stop.check', status: run.status, note: run.stopReason })
				}
			}
		}

		if (run.status === STATUS.REPEAT_FAILURE) break

		// 上下文裁剪：system 与首条 user 常驻，其余按"轮"保留最近若干条
		trimHistory(messages, LIMITS.maxHistoryMessages)
	}

	// 步数用尽仍未给出回答 → STEP_LIMIT（不是成功，也不是模型错误）
	if (!run.status && run.steps >= maxSteps && !run.answer) {
		run.status = STATUS.STEP_LIMIT
		run.stopReason = `达到最大步数 ${maxSteps} 仍未完成，已终止`
		logger.log({ event: 'stop.check', step: run.steps, status: run.status, note: run.stopReason })
	}

	// ⑥ 结果检查：模型说完成不算完成，按 2.1 的成功标准逐条核对
	if (!run.status) {
		run.verification = verifyAnswer({ answer: run.answer, observed, goal })
		if (!run.verification.passed) {
			run.status = STATUS.FAILED_VERIFY
			run.stopReason = run.verification.reason
		} else {
			run.status = STATUS.SUCCESS
			run.stopReason = '成功标准全部满足'
		}
		logger.log({
			event: 'verify',
			status: run.status,
			note: run.verification.checks.map((c) => `${c.passed ? '✓' : '✗'} ${c.name}`).join(' ')
		})
	}

	logger.log({
		event: 'run.end',
		status: run.status,
		ms: Date.now() - startedAt,
		steps: run.steps,
		toolCalls: run.toolCalls,
		note: run.stopReason
	})
	return finish(run, startedAt)
}

/**
 * 给模型调用套一层总时限兜底。
 *
 * model.mjs 内部已用 AbortSignal 限制单次请求，但实测遇到网关「连接建立后不回包」时，
 * 中止信号没有把调用唤醒，整轮任务就卡死了。这里再加一道 Promise.race：
 * 到点就放弃等待并判 TIMEOUT。语义与工具超时一致——只停止等待，不代表服务端已取消。
 */
function withDeadline(promise, deadline) {
	promise.catch(() => {}) // 兜底先触发时，原请求后续的失败不再冒泡成未处理异常
	// 这是「防挂死」的兜底，不是精确限时：精确限时由 model.mjs 的 AbortSignal 负责。
	// 下限 30 s 保证短预算用例（C5 的 4 s）仍能观察模型真实耗时；
	// 上限取三次重试的总时长，避免放宽 deadline 的用例单步等上十分钟。
	const budget = deadline - Date.now() + 2_000
	const ms = Math.max(30_000, Math.min(budget, LIMITS.modelTimeoutMs * 3 + 5_000))
	let timer
	const guard = new Promise((_, reject) => {
		timer = setTimeout(() => {
			const err = new Error(`模型调用超过总时限（兜底等待 ${Math.round(ms / 1000)}s 后放弃），已停止等待`)
			err.code = MODEL_ERROR.TIMEOUT
			reject(err)
		}, ms)
	})
	return Promise.race([promise, guard]).finally(() => clearTimeout(timer))
}

/** 停止检查：返回 null 表示可以继续 */
function checkStop({ deadline, deadlineMs, signal }) {	if (signal?.aborted) return { status: STATUS.ABORTED, reason: '收到外部中止信号' }
	const now = Date.now()
	if (now > deadline) {
		return {
			status: STATUS.TIMEOUT,
			reason: `已超过总时限 ${deadlineMs}ms（超出 ${now - deadline}ms），停止继续执行`
		}
	}
	return null
}

/**
 * 工具结果 → 上下文消息。
 * 成功时只放业务数据（不放 meta），失败时放结构化错误，两者都截断到上限，
 * 防止一次大结果把后续每一步的输入都撑大（按 token 计费）。
 */
function buildToolMessage(result, call) {
	const payload = result.ok
		? { ok: true, data: result.data }
		: { ok: false, error: result.error, hint: '请根据错误信息修正参数或改用其它工具' }
	let content = JSON.stringify(payload)
	if (content.length > LIMITS.maxToolResultChars) {
		content = content.slice(0, LIMITS.maxToolResultChars) + '…（结果过长已截断）'
	}
	return {
		message: { role: 'tool', tool_call_id: call.id, name: call.name, content }
	}
}

/** 只把工具真实返回过的内容记为事实 */
function rememberFact(observed, tool, data) {
	if (tool === 'search_recipes' || tool === 'recipe_detail' || tool === 'calc_stats') {
		const items = data?.items || []
		for (const item of items) {
			if (item?.recipeId) observed.recipes.set(item.recipeId, item.name)
		}
		if (tool === 'recipe_detail' && data?.recipeId) {
			observed.recipes.set(data.recipeId, data.name)
		}
		if (tool === 'calc_stats') observed.stats = data
	}
	if (tool === 'save_menu') observed.savedMenu = data
}

/**
 * 结果检查（成功标准）。
 *
 * 这是本实验里最容易被忽略、也最关键的一段：模型完全可能给出一份看起来完整、
 * 但菜名是它自己编的回答。所以逐条核对，任一条不过就判 FAILED_VERIFY。
 */
export function verifyAnswer({ answer, observed, goal }) {
	const checks = []
	const text = String(answer || '').trim()

	checks.push({
		name: '回答非空',
		passed: text.length >= 10,
		detail: `长度 ${text.length} 字`
	})

	checks.push({
		name: '调用过检索工具',
		passed: observed.recipes.size > 0,
		detail: `已核实 ${observed.recipes.size} 道菜`
	})

	// 回答里出现的菜谱编号必须来自工具结果
	const ids = [...new Set(text.match(/R-\d{3}/g) || [])]
	const unknownIds = ids.filter((id) => !observed.recipes.has(id))
	checks.push({
		name: '菜谱编号可追溯',
		passed: unknownIds.length === 0,
		detail: ids.length ? `出现 ${ids.length} 个编号，无法追溯：${unknownIds.join('、') || '无'}` : '未出现编号'
	})

	// 回答里出现的菜名必须在已核实集合内（防编造）
	const allNames = new Set(loadRecipes().map((r) => r.name))
	const mentioned = [...allNames].filter((name) => text.includes(name))
	const verifiedNames = new Set(observed.recipes.values())
	const invented = mentioned.filter((n) => !verifiedNames.has(n))
	checks.push({
		name: '菜名均有工具依据',
		passed: invented.length === 0,
		detail: `提及库内菜名 ${mentioned.length} 个，无依据：${invented.join('、') || '无'}`
	})

	// 提到统计数字时，必须与 calc_stats 的结果一致
	if (observed.stats) {
		const m = text.match(/总用时[^0-9]{0,6}(\d+)\s*分钟/)
		const claimed = m ? Number(m[1]) : null
		checks.push({
			name: '统计数字与工具一致',
			passed: claimed === null ? true : claimed === observed.stats.total_minutes,
			detail:
				claimed === null
					? '回答未给出总用时，跳过数字比对'
					: `回答称 ${claimed} 分钟，工具计算 ${observed.stats.total_minutes} 分钟`
		})
	}

	// 写过菜单则核对文件是否真的落盘
	if (observed.savedMenu) {
		const ok = Boolean(observed.savedMenu.file)
		checks.push({
			name: '菜单文件已写入',
			passed: ok,
			detail: ok ? observed.savedMenu.file : '工具未返回文件路径'
		})
	}

	const failed = checks.filter((c) => !c.passed)
	return {
		passed: failed.length === 0,
		checks,
		reason: failed.length ? `成功标准未满足：${failed.map((c) => `${c.name}（${c.detail}）`).join('；')}` : ''
	}
}

/**
 * 上下文裁剪。
 * 按"轮"裁：一条 assistant（可能带 tool_calls）加上紧随其后的 tool 消息算一组，
 * 整组保留或整组丢弃。拆开会让接口报 "tool message without preceding tool_calls"。
 */
function trimHistory(messages, maxMessages) {
	if (messages.length <= maxMessages + 2) return
	const head = messages.slice(0, 2)
	const rest = messages.slice(2)
	const groups = []
	for (const msg of rest) {
		if (msg.role === 'tool' && groups.length) groups[groups.length - 1].push(msg)
		else groups.push([msg])
	}
	const kept = []
	let count = 0
	for (let i = groups.length - 1; i >= 0; i -= 1) {
		const size = groups[i].length
		if (count + size > maxMessages && kept.length) break
		kept.unshift(groups[i])
		count += size
	}
	messages.length = 0
	messages.push(...head, ...kept.flat())
}

/** 默认确认实现：没有交互环境时一律拒绝（宁可不动，不可误改） */
async function defaultConfirm(req) {
	return { approved: false, reason: '当前运行环境不支持交互确认，默认拒绝' }
}

function makeTaskId() {
	const d = new Date()
	const p = (n, w = 2) => String(n).padStart(w, '0')
	const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
	const rand = Math.random().toString(36).slice(2, 6)
	return `AG-${stamp}-${rand}`
}

function finish(run, startedAt) {
	run.ms = Date.now() - startedAt
	return run
}

export { ALLOWED_TOOLS }
