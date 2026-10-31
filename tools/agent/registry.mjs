/**
 * 工具注册表与执行闸门
 *
 * 这是模型与真实能力之间**唯一**的通道：
 * 模型只能给出「工具名 + 参数」，永远拿不到函数引用，也不能拼命令。
 * 一次调用要过四道关：
 *   ① 名称白名单（不在白名单 → 直接拒绝，不查找任何对象属性）
 *   ② 参数校验（按 schema.mjs 的定义）
 *   ③ 权限判定（auto / confirm / forbidden）
 *   ④ 超时与异常包装
 * 任何一道没过，都返回一条**结构化的工具结果**给模型，而不是抛出去中断整轮任务。
 */
import fs from 'node:fs'
import path from 'node:path'
import { ERROR_CODE, createToolbox } from './tools.mjs'
import { TOOL_DEFS, getToolDef, validateArgs } from './schema.mjs'
import { LIMITS, WRITE_DIR } from './config.mjs'

/** 白名单：只有这里列出的名字可以被调用 */
export const ALLOWED_TOOLS = TOOL_DEFS.map((d) => d.name)

/**
 * 权限策略
 *  - auto     只读或纯计算，可直接执行
 *  - confirm  会修改磁盘数据，必须用户明确同意
 *  - forbidden 明确禁止（即使模型请求也拒绝，用于把"不做什么"写进代码）
 */
export const POLICY = {
	search_recipes: 'auto',
	recipe_detail: 'auto',
	calc_stats: 'auto',
	save_menu: 'confirm'
}

/** 明确禁止的能力。模型若请求这些名字，返回可读的拒绝原因，而不是"工具不存在" */
export const FORBIDDEN_TOOLS = {
	run_shell: '禁止执行任意命令',
	exec: '禁止执行任意命令',
	write_file: '禁止任意路径写入，只能通过 save_menu 写入 output/agent/menus/',
	delete_file: '禁止删除文件',
	fetch_url: '禁止访问外部网络地址',
	http_request: '禁止访问外部网络地址'
}

/**
 * 创建执行器。
 *
 * @param {object} opts
 * @param {(req)=>Promise<{approved:boolean,reason?:string}>} opts.confirm 人工确认回调
 * @param {object} [opts.faults] 故障注入（仅测试用）：{ 工具名: 'throw' | 'timeout' }
 * @param {number} [opts.toolTimeoutMs]
 */
export function createExecutor({ confirm, faults = {}, toolTimeoutMs = LIMITS.toolTimeoutMs, writeDir = WRITE_DIR } = {}) {
	const toolbox = createToolbox({ writeDir })

	/**
	 * 执行一次工具调用，永远返回 `{ ok, data|error, meta }`。
	 * meta 供 harness 写日志与计数，不进入模型上下文。
	 */
	async function execute(name, rawArgs, ctx = {}) {
		const started = Date.now()
		const base = { tool: name, step: ctx.step ?? null, startedAt: new Date().toISOString() }

		// ① 名称白名单
		if (FORBIDDEN_TOOLS[name]) {
			return fail(ERROR_CODE.DENIED, `工具 ${name} 被禁止：${FORBIDDEN_TOOLS[name]}`, base, started)
		}
		const def = getToolDef(name)
		if (!def || !ALLOWED_TOOLS.includes(name)) {
			return fail(
				ERROR_CODE.DENIED,
				`工具 ${name} 不在允许列表内。可用工具：${ALLOWED_TOOLS.join('、')}`,
				base,
				started
			)
		}

		// ② 参数校验（模型给的参数一律不可信）
		const checked = validateArgs(def, rawArgs)
		if (!checked.ok) {
			return fail(ERROR_CODE.VALIDATION, checked.errors.join('；'), base, started, {
				errors: checked.errors
			})
		}
		const args = checked.value

		// ③ 权限判定
		let confirmMeta = null
		if (POLICY[name] === 'confirm') {
			const preview = describeEffect(name, args)
			const answer = await confirm({
				tool: name,
				args,
				preview,
				timeoutMs: LIMITS.confirmTimeoutMs
			})
			// 确认过程本身要进日志：谁在什么时间、看到什么影响面、给了什么答复
			confirmMeta = {
				approved: Boolean(answer.approved),
				reason: answer.reason || '',
				source: answer.source || 'unknown',
				waitMs: answer.ms ?? null,
				preview
			}
			if (!answer.approved) {
				return fail(
					ERROR_CODE.DENIED,
					`用户未同意执行 ${name}（${answer.reason || '已拒绝'}），操作未执行`,
					base,
					started,
					{ deniedBy: 'user' },
					confirmMeta
				)
			}
		}

		// ④ 执行（含故障注入与超时）
		try {
			const result = await withTimeout(runTool(name, args), toolTimeoutMs, name)
			const ms = Date.now() - started
			if (!result.ok) {
				return { ...result, meta: { ...base, ms, errorType: result.error.code, confirm: confirmMeta } }
			}
			return { ...result, meta: { ...base, ms, confirm: confirmMeta } }
		} catch (error) {
			const isTimeout = error?.name === 'ToolTimeoutError'
			if (isTimeout) return handleTimeout({ name, args, writeDir, base, started, toolTimeoutMs, confirmMeta })
			return fail(
				ERROR_CODE.INTERNAL,
				`工具 ${name} 执行异常：${error?.message || String(error)}`,
				base,
				started
			)
		}
	}

	/** 真正调用工具函数；故障注入在这里生效，方便测试异常路径 */
	function runTool(name, args) {
		const fault = faults[name]
		if (fault === 'throw') {
			return Promise.reject(new Error('注入故障：工具内部抛出异常（E_FAULT_INJECTED）'))
		}
		if (fault === 'timeout') {
			// 返回一个永不完成的 Promise，用于验证超时分支
			return new Promise(() => {})
		}
		if (fault === 'write-then-timeout') {
			// 先真正执行（写盘已完成），再挂起不返回：
			// 用于验证「调用状态不明时先读回核对」这一条，超时点文件其实已经写入
			try {
				toolbox[name](args)
			} catch {
				/* 写入本身失败的情况由超时分支的核对结果体现 */
			}
			return new Promise(() => {})
		}
		try {
			return Promise.resolve(toolbox[name](args))
		} catch (error) {
			return Promise.reject(error)
		}
	}

	return { execute, ALLOWED_TOOLS, POLICY }
}

/**
 * 超时处理：只读工具与会写盘的工具要区别对待。
 *
 * 只读工具超时只是「停止等待」，没有后果；会修改数据的工具超时后状态不明——
 * 可能已经写完了，也可能根本没开始。这时**不能直接重试**（重试可能把已完成的
 * 写入再写一次，或把用户刚改过的内容覆盖掉），必须先读回目标文件核对。
 */
function handleTimeout({ name, args, writeDir, base, started, toolTimeoutMs, confirmMeta }) {
	const recon = POLICY[name] === 'confirm' ? reconcileWrite(name, args, writeDir) : null

	// 核对命中：本次写入其实已经完成，按成功返回，让模型继续而不是重试
	if (recon?.written) {
		return {
			ok: true,
			data: { ...recon.saved, file: recon.file, reconciled: true },
			meta: { ...base, ms: Date.now() - started, errorType: 'TOOL_TIMEOUT_RECONCILED', confirm: confirmMeta }
		}
	}

	const detail = recon ? `已读回 ${recon.file} 核对：${recon.reason}` : '该工具不修改数据，无需核对'
	return fail(
		ERROR_CODE.TIMEOUT,
		`工具 ${name} 超过 ${toolTimeoutMs}ms 未返回，已停止等待（无法强制中断后台执行）；${detail}。` +
			(recon ? '按未执行处理，不得直接重试：需重新发起调用并再次确认。' : ''),
		base,
		started,
		{ reconciled: false },
		confirmMeta
	)
}

/**
 * 读回目标文件，判断本次写入是否已经生效。
 * 比对的是「标题 + 菜品清单」，而不只是文件是否存在——同名文件可能是上一次运行留下的，
 * 只看存在性会把历史产物误判成本次成功。
 */
function reconcileWrite(name, args, writeDir) {
	if (name !== 'save_menu') return null
	const file = path.join(writeDir, `${args.menuId}.json`)
	const rel = path.relative(path.resolve(writeDir, '../../..'), file).replace(/\\/g, '/')
	try {
		if (!fs.existsSync(file)) {
			return { written: false, file: rel, reason: '文件不存在，本次写入未生效' }
		}
		const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
		const savedIds = (saved.items || []).map((i) => i.recipeId)
		if (saved.title !== args.title) {
			return {
				written: false,
				file: rel,
				reason: `文件存在但标题为「${saved.title}」，与本次「${args.title}」不同（应为历史文件）`
			}
		}
		if (JSON.stringify(savedIds) !== JSON.stringify(args.recipeIds)) {
			return {
				written: false,
				file: rel,
				reason: `文件存在但菜品清单为 ${savedIds.join('、')}，与本次 ${args.recipeIds.join('、')} 不同`
			}
		}
		return { written: true, file: rel, saved }
	} catch (error) {
		return { written: false, file: rel, reason: `读回文件失败：${error?.message || String(error)}` }
	}
}

/**
 * 把「这次操作会改什么」写成一句人能读懂的话。
 * 确认弹窗要展示影响面，用户才能判断该不该同意——只显示工具名是不够的。
 */
export function describeEffect(name, args) {
	if (name === 'save_menu') {
		const existed = fileExists(`${args.menuId}.json`)
		return [
			`写入文件 output/agent/menus/${args.menuId}.json`,
			existed ? '同名文件已存在，本次将覆盖' : '文件不存在，本次为新建',
			`内容：菜单「${args.title}」，共 ${args.recipeIds.length} 道菜（${args.recipeIds.join('、')}）`
		].join('；')
	}
	return '只读操作，不修改任何数据'
}

function fileExists(name) {
	try {
		return fs.existsSync(path.join(WRITE_DIR, name))
	} catch {
		return false
	}
}

function fail(code, message, base, started, extra = {}, confirmMeta = null) {
	return {
		ok: false,
		error: { code, message },
		...extra,
		meta: { ...base, ms: Date.now() - started, errorType: code, confirm: confirmMeta }
	}
}

/**
 * 超时包装。
 *
 * ⚠️ 诚实说明：工具是进程内的同步函数，Promise.race 只能**停止等待**，
 * 不能终止已经在执行的函数。对只读工具这没有问题（最多浪费一点 CPU）；
 * 对会写盘的 save_menu，超时后必须去读文件核对是否已写入，不能直接重试。
 */
function withTimeout(promise, ms, label) {
	let timer
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => {
			const err = new Error(`工具 ${label} 超时`)
			err.name = 'ToolTimeoutError'
			reject(err)
		}, ms)
	})
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
