#!/usr/bin/env node
/**
 * Agent 命令行入口
 *
 * 三个子命令：
 *   tools  打印工具 Schema 与权限策略（对应 2.2 的工具接口说明）
 *   check  不接模型，直接用正确/错误参数打工具（对应 2.2「接入 Agent 前直接测试」）
 *   run    跑一次完整 Agent 任务（对应 2.3—2.5）
 *
 * 用法：
 *   node tools/agent/cli.mjs tools
 *   node tools/agent/cli.mjs check
 *   node tools/agent/cli.mjs run --goal "两个人晚饭，30 分钟内，清淡，不吃虾"
 *   node tools/agent/cli.mjs run --goal "..." --max-steps 3 --deadline 30000
 *   node tools/agent/cli.mjs run --goal "..." --script tools/agent/fixtures/bad-args.json
 *   node tools/agent/cli.mjs run --goal "..." --fault calc_stats:throw --tool-timeout 800
 */
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, LIMITS, readModelConfig } from './config.mjs'
import { TOOL_DEFS, validateArgs, describeToolsForPrompt } from './schema.mjs'
import { POLICY, createExecutor, FORBIDDEN_TOOLS } from './registry.mjs'
import { createConfirmer } from './confirm.mjs'
import { runAgent } from './harness.mjs'
import { createToolbox } from './tools.mjs'

const argv = process.argv.slice(2)
const cmd = argv[0] || 'help'
const flags = parseFlags(argv.slice(1))

switch (cmd) {
	case 'tools':
		printTools()
		break
	case 'check':
		await runToolChecks()
		break
	case 'run':
		await runOnce()
		break
	case 'log':
		replayLog(argv[1])
		break
	case 'help':
	default:
		printHelp()
}

function parseFlags(args) {
	const out = {}
	for (let i = 0; i < args.length; i += 1) {
		const a = args[i]
		if (!a.startsWith('--')) continue
		// 同时支持 --key value 与 --key=value 两种写法
		const eq = a.indexOf('=')
		if (eq > 2) {
			out[a.slice(2, eq)] = a.slice(eq + 1)
			continue
		}
		const key = a.slice(2)
		const next = args[i + 1]
		if (next && !next.startsWith('--')) {
			out[key] = next
			i += 1
		} else {
			out[key] = 'true'
		}
	}
	return out
}

function printHelp() {
	console.log(`用法：
  node tools/agent/cli.mjs tools                 打印工具 Schema 与权限策略
  node tools/agent/cli.mjs check                 不接模型，直接测工具的合法/非法参数
  node tools/agent/cli.mjs run --goal "目标"      跑一次完整任务
  node tools/agent/cli.mjs log <任务编号|文件>     回看某次运行的日志（脱敏后的 JSONL）

run 的可选参数：
  --max-steps <n>        最大步数（默认 ${LIMITS.maxSteps}）
  --deadline <ms>        总时限（默认 ${LIMITS.totalDeadlineMs}）
  --tool-timeout <ms>    单工具超时（默认 ${LIMITS.toolTimeoutMs}）
  --confirm <yes|no|interactive>  人工确认应答方式（默认 interactive）
  --script <file>        用预置响应序列代替模型（确定性测试用）
  --fault <tool:throw|timeout>    故障注入（测试异常路径）
  --no-echo              不打印逐事件日志`)
}

function printTools() {
	console.log('=== 允许调用的工具 ===')
	for (const def of TOOL_DEFS) {
		const policy = POLICY[def.name]
		const label = policy === 'confirm' ? '需人工确认（会修改磁盘数据）' : '自动执行（只读/纯计算）'
		console.log(`\n• ${def.name}  [${label}]`)
		console.log(`  用途：${def.description}`)
		const required = new Set(def.parameters.required || [])
		for (const [key, spec] of Object.entries(def.parameters.properties)) {
			const bits = [spec.type, required.has(key) ? '必填' : '可选']
			if (spec.enum) bits.push(`取值∈{${spec.enum.join('|')}}`)
			if (spec.minimum !== undefined) bits.push(`≥${spec.minimum}`)
			if (spec.maximum !== undefined) bits.push(`≤${spec.maximum}`)
			if (spec.pattern) bits.push(`格式 ${spec.pattern}`)
			console.log(`    - ${key}：${bits.join('，')}  ${spec.description || ''}`)
		}
	}
	console.log('\n=== 明确禁止的能力 ===')
	for (const [name, why] of Object.entries(FORBIDDEN_TOOLS)) {
		console.log(`  ✗ ${name}：${why}`)
	}
	console.log('\n=== 提示词中呈现的工具清单（JSON 协议回退路径使用） ===')
	console.log(describeToolsForPrompt())
}

/**
 * 不接模型，直接打工具。
 * 这一步的意义：把「工具本身是否正确」与「模型决策是否正确」分开验证，
 * 否则一旦 Agent 出错，无法判断是模型选错工具还是工具自身有 bug。
 */
async function runToolChecks() {
	const box = createToolbox()
	const cases = [
		{ tool: 'search_recipes', args: { max_minutes: 15, tags: ['素食'], limit: 2 }, expect: 'ok' },
		{ tool: 'search_recipes', args: { max_minutes: 9999, limit: 2 }, expect: 'err', why: '超出取值范围' },
		{ tool: 'search_recipes', args: { max_minutes: '十五', limit: 2 }, expect: 'err', why: '类型错误' },
		{ tool: 'search_recipes', args: { max_minutes: 15, tags: ['不存在的标签'] }, expect: 'err', why: '枚举外取值' },
		{ tool: 'recipe_detail', args: { recipeId: 'R-001' }, expect: 'ok' },
		{ tool: 'recipe_detail', args: { recipeId: 'R-999' }, expect: 'err', why: '库内不存在' },
		{ tool: 'calc_stats', args: { recipeIds: ['R-001', 'R-002'] }, expect: 'ok' },
		{ tool: 'save_menu', args: { menuId: '../../etc/passwd', title: '越界', recipeIds: ['R-001'] }, expect: 'err', why: '路径越界' }
	]

	console.log('=== 工具直接测试（不经过模型） ===\n')
	let pass = 0
	for (const c of cases) {
		const def = TOOL_DEFS.find((d) => d.name === c.tool)
		const checked = validateArgs(def, c.args)
		let outcome
		if (!checked.ok) {
			outcome = { ok: false, error: { code: 'VALIDATION_ERROR', message: checked.errors.join('；') } }
		} else {
			outcome = await box[c.tool](checked.value)
		}
		const expectOk = c.expect === 'ok'
		const judged = outcome.ok === expectOk
		if (judged) pass += 1
		const tag = judged ? '✓ 符合预期' : '✗ 与预期不符'
		console.log(`${tag}  ${c.tool}(${JSON.stringify(c.args)})${c.why ? `  ← ${c.why}` : ''}`)
		if (outcome.ok) {
			const preview = JSON.stringify(outcome.data).slice(0, 260)
			console.log(`    返回：${preview}`)
		} else {
			console.log(`    错误：${outcome.error.code} — ${outcome.error.message}`)
		}
	}
	console.log(`\n合计 ${pass}/${cases.length} 条符合预期`)
}

async function runOnce() {
	const goal = flags.goal
	if (!goal) {
		console.error('缺少 --goal 参数。示例：--goal "两个人晚饭，30 分钟内，清淡，不吃虾"')
		process.exit(1)
	}

	const config = readModelConfig()
	const script = flags.script ? JSON.parse(fs.readFileSync(path.resolve(ROOT, flags.script), 'utf8')) : null
	if (!config.ok && !script) {
		console.error(config.reason)
		process.exit(1)
	}

	const faults = {}
	if (flags.fault) {
		const [tool, kind] = String(flags.fault).split(':')
		faults[tool] = kind || 'throw'
	}

	const confirmMode = flags.confirm === 'yes' || flags.confirm === 'no' ? flags.confirm : 'interactive'
	const confirm = createConfirmer({ mode: confirmMode, timeoutMs: LIMITS.confirmTimeoutMs })

	const controller = new AbortController()
	// Ctrl+C 走中止流程：已落盘的日志保留，状态记为 ABORTED
	process.on('SIGINT', () => {
		console.log('\n收到中止信号，正在停止…')
		controller.abort()
	})

	console.log('=== Agent 运行 ===')
	console.log(`目标：${goal}`)
	console.log(`模型：${script ? '（脚本化响应）' : config.model}   协议：原生 function calling（不可用时回退 JSON）`)
	console.log(`限制：最大步数 ${flags['max-steps'] || LIMITS.maxSteps}，总时限 ${flags.deadline || LIMITS.totalDeadlineMs}ms，单工具超时 ${flags['tool-timeout'] || LIMITS.toolTimeoutMs}ms`)
	console.log('')

	const result = await runAgent({
		goal,
		modelConfig: script ? null : { apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model },
		options: {
			maxSteps: Number(flags['max-steps']) || LIMITS.maxSteps,
			deadlineMs: Number(flags.deadline) || LIMITS.totalDeadlineMs,
			toolTimeoutMs: Number(flags['tool-timeout']) || LIMITS.toolTimeoutMs,
			confirm,
			faults,
			script,
			echo: flags['no-echo'] !== 'true',
			signal: controller.signal
		}
	})

	printSummary(result)
}

/**
 * 回看一次运行的日志。
 *
 * 日志是排障与写报告的唯一事实来源，所以要能脱离当次终端单独读出来。
 * 传入任务编号（AG-…）或 jsonl 文件路径均可。
 */
function replayLog(arg) {
	const DISPLAY_WIDTH = 92
	// 回看是给人看的：摘要按终端列宽截断（中文占 2 列），完整内容仍在 JSONL 里
	const clip = (text, max = DISPLAY_WIDTH) => {
		if (!text) return ''
		let width = 0
		let out = ''
		for (const ch of text) {
			width += /[\u2E80-\uFFEF]/.test(ch) ? 2 : 1
			if (width > max) return `${out}…`
			out += ch
		}
		return out
	}

	if (!arg) {
		console.error('用法：node tools/agent/cli.mjs log <任务编号|jsonl 文件>')
		process.exit(1)
	}
	const file = arg.endsWith('.jsonl') ? path.resolve(arg) : path.join(ROOT, 'output/agent/runs', `${arg}.jsonl`)
	if (!fs.existsSync(file)) {
		console.error(`找不到日志：${file}`)
		process.exit(1)
	}
	const rows = fs
		.readFileSync(file, 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((l) => JSON.parse(l))

	const head = rows[0] || {}
	console.log(`=== 运行回看 ${head.taskId || path.basename(file, '.jsonl')} ===`)
	console.log(`目标：${head.goal || '-'}`)
	console.log(`限制：最大步数 ${head.maxSteps ?? '-'}，总时限 ${head.deadlineMs ?? '-'}ms，模型 ${head.model || '-'}`)
	console.log('')
	for (const r of rows.slice(1)) {
		const time = String(r.ts || '').slice(11, 23)
		const step = r.step === undefined ? '-' : String(r.step)
		const parts = [`[${time}]`, `step=${step}`, r.event]
		if (r.tool) parts.push(`tool=${r.tool}`)
		if (r.ms !== undefined && r.event !== 'run.end') parts.push(`${r.ms}ms`)
		if (r.ok !== undefined) {
			// 成功但带错误标签的情况必须显示出来，例如写操作超时后经核对确认已落盘
			// （TOOL_TIMEOUT_RECONCILED）——只看 ok 会以为一切正常，看不出它靠核对才判成功
			if (r.ok) parts.push(r.errorType ? `ok(${r.errorType})` : 'ok')
			else parts.push(`err=${r.errorType || 'ERROR'}`)
		}
		if (r.status) parts.push(`status=${r.status}`)
		console.log(parts.join(' '))
		// 回看是给人看的：摘要按终端宽度截断，完整内容仍在 JSONL 里
		if (r.argsDigest) console.log(`           ├─ 参数 ${clip(r.argsDigest)}`)
		if (r.resultDigest) console.log(`           └─ 结果 ${clip(r.resultDigest)}`)
		if (r.note) console.log(`           └─ ${clip(r.note, 96)}`)
	}
	console.log('')
	console.log(`（以上摘要按 ${DISPLAY_WIDTH} 字符截断，完整内容见 ${path.relative(ROOT, file).replace(/\\/g, '/')}）`)
}


function printSummary(result) {	console.log('\n=== 运行结果 ===')
	console.log(`任务编号：${result.taskId}`)
	console.log(`最终状态：${result.status}`)
	console.log(`原因：${result.stopReason}`)
	console.log(`步数：${result.steps}   工具调用：${result.toolCalls}   总耗时：${result.ms}ms   协议：${result.protocol || '-'}`)
	if (result.answer) {
		console.log('\n--- 最终回答 ---')
		console.log(result.answer)
	}
	if (result.verification) {
		console.log('\n--- 成功标准检查 ---')
		for (const c of result.verification.checks) {
			console.log(`  ${c.passed ? '✓' : '✗'} ${c.name}：${c.detail}`)
		}
	}
	console.log(`\n日志：${path.relative(ROOT, result.logFile).replace(/\\/g, '/')}`)
}
