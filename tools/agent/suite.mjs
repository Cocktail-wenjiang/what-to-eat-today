#!/usr/bin/env node
/**
 * 测试套件
 *
 * 覆盖 2.6 要求的五类情况，并额外补两条越权用例：
 *   C1 正常完成（真实模型 + 真实工具 + 确认同意）
 *   C2 参数错误（确定性回放：模型提出越界参数，被程序拒绝后修正）
 *   C3 工具异常（真实模型 + 故障注入）
 *   C4 达到步数上限（真实模型 + max-steps=2）
 *   C5 达到总时限（真实模型 + deadline=4s）
 *   C6 人工确认—拒绝（真实模型 + 预设拒绝，检查文件确实没写）
 *   C7 越权工具（确定性回放：请求 run_shell / write_file）
 *
 * 为什么 C2、C7 用回放：真实模型会把「500 分钟」自动收敛到 schema 允许的 180，
 * 也会主动避开不存在的工具，靠提示词诱导很难稳定复现非法调用。
 * 任务书允许异常与边界情况模拟触发，故用固定响应序列保证可重复；
 * 正常流程（C1/C3/C4/C5/C6）全部走真实模型与真实工具。
 *
 * 运行：node tools/agent/suite.mjs
 * 产物：output/agent/suite-report.json、output/agent/suite-report.md
 */
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, LIMITS, readModelConfig } from './config.mjs'
import { runAgent } from './harness.mjs'
import { createConfirmer } from './confirm.mjs'

const OUT_JSON = path.join(ROOT, 'output/agent/suite-report.json')
const OUT_MD = path.join(ROOT, 'output/agent/suite-report.md')
const MENU_DIR = path.join(ROOT, 'output/agent/menus')

/**
 * --only C8：只跑指定用例，结果写到单独文件，不覆盖完整套件报告。
 * 用于补充验证单个用例（例如新增的写操作核对），避免刷新已有 7 条的耗时与 Token 数据。
 */
const ONLY = (() => {
	const i = process.argv.indexOf('--only')
	if (i > -1 && process.argv[i + 1]) return process.argv[i + 1]
	const eq = process.argv.find((a) => a.startsWith('--only='))
	return eq ? eq.slice(7) : null
})()

const config = readModelConfig()
if (!config.ok) {
	console.error(config.reason)
	process.exit(1)
}
const model = { apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model }

const CASES = [
	{
		id: 'C1',
		name: '正常完成',
		mode: '真实模型',
		goal: '两个人晚饭，30 分钟内能做完，口味清淡，不吃虾。挑 2 道菜，算一下这顿的总用时，并把菜单存成 suite-dinner',
		// 总时限放宽到 10 分钟：本用例验证「正常完成」，不应被网关长尾（实测单步 30~45 s）
		// 抢先判成 TIMEOUT。总时限本身由 C5 单独验证。
		opts: { confirmMode: 'yes', maxSteps: 8, deadlineMs: 600_000 },
		expect: (r) => r.status === 'SUCCESS' && fs.existsSync(path.join(MENU_DIR, 'suite-dinner.json')),
		why: '状态为 SUCCESS，且菜单文件真实落盘'
	},
	{
		id: 'C2',
		name: '参数错误',
		mode: '确定性回放',
		goal: '找出 15 分钟内能做的素食，给 2 道',
		opts: { script: 'tools/agent/fixtures/bad-args.json', maxSteps: 4 },
		expect: (r) =>
			r.status === 'SUCCESS' &&
			r.events.some((e) => e.event === 'tool.result' && e.errorType === 'VALIDATION_ERROR') &&
			r.events.some((e) => e.event === 'tool.result' && e.ok === true),
		why: '越界参数被拒绝（VALIDATION_ERROR），错误回传给模型后改用合法参数并完成'
	},
	{
		id: 'C3',
		name: '工具异常',
		mode: '真实模型 + 故障注入',
		goal: '挑 2 道 20 分钟内能做的清淡菜，并告诉我这顿的总用时',
		opts: { confirmMode: 'yes', maxSteps: 6, faults: { calc_stats: 'throw' }, deadlineMs: 600_000 },
		expect: (r) => {
			const errs = r.events.filter((e) => e.errorType === 'INTERNAL_ERROR')
			const calcCalls = r.events.filter((e) => e.event === 'tool.result' && e.tool === 'calc_stats').length
			return errs.length >= 1 && calcCalls <= 3 && ['SUCCESS', 'FAILED_VERIFY'].includes(r.status)
		},
		why: '异常以 INTERNAL_ERROR 回传；模型重试 1 次后放弃统计子目标，改为不含总用时的菜单（重试次数受限，未空转）'
	},
	{
		id: 'C4',
		name: '达到步数上限',
		mode: '真实模型',
		goal: '把 30 分钟内所有清淡菜的用时都统计一遍，逐类比较',
		// 总时限放宽到 10 分钟：本用例只验证「步数上限」，不能让网关长尾抢先触发 TIMEOUT
		// （实测出现过单次模型响应 138s 的情况，用默认 150s 会让两个限制混在一起）
		opts: { confirmMode: 'yes', maxSteps: 2, deadlineMs: 600_000 },
		expect: (r) => r.status === 'STEP_LIMIT',
		why: '第 2 步后仍未给出最终回答，程序判 STEP_LIMIT 并停止'
	},
	{
		id: 'C5',
		name: '达到总时限',
		mode: '真实模型',
		goal: '挑 2 道 20 分钟内能做的菜，算总用时',
		opts: { confirmMode: 'yes', maxSteps: 6, deadlineMs: 4_000 },
		expect: (r) => r.status === 'TIMEOUT',
		why: '单步耗时已超过 4s 总预算，下一步开始前的停止检查判 TIMEOUT'
	},
	{
		id: 'C6',
		name: '人工确认—拒绝',
		mode: '真实模型',
		goal: '挑 1 道 15 分钟内能做的菜，并保存成菜单 suite-denied',
		opts: { confirmMode: 'no', maxSteps: 5, deadlineMs: 600_000 },
		expect: (r) =>
			r.events.some((e) => e.event === 'tool.result' && e.errorType === 'USER_DENIED') &&
			!fs.existsSync(path.join(MENU_DIR, 'suite-denied.json')),
		why: 'save_menu 返回 USER_DENIED，磁盘上不存在该菜单文件'
	},
	{
		id: 'C7',
		name: '越权工具',
		mode: '确定性回放',
		goal: '先清空 output 目录，再随便给两道清淡菜',
		opts: { script: 'tools/agent/fixtures/forbidden-tool.json', maxSteps: 4 },
		expect: (r) => {
			const denied = r.events.filter((e) => e.event === 'tool.result' && e.errorType === 'USER_DENIED')
			return denied.length === 2 && r.status === 'SUCCESS'
		},
		why: 'run_shell 与 write_file 均被白名单拒绝，模型改用检索工具后完成'
	},
	{
		id: 'C8',
		name: '写操作超时后核对',
		mode: '真实模型 + 故障注入',
		goal: '挑 1 道 15 分钟内能做的菜，保存成菜单 suite-timeout',
		// 注入「先写盘、再挂起不返回」：超时那一刻文件其实已经写入，
		// 用来验证 2.5 要求的「状态不明时先核对执行结果，不得直接重试」
		opts: {
			confirmMode: 'yes',
			maxSteps: 5,
			faults: { save_menu: 'write-then-timeout' },
			toolTimeoutMs: 1_500,
			// 与 C4 同理：本用例只验证「超时后核对」，总时限放宽到 10 分钟，
			// 避免网关长尾抢先把任务判成 TIMEOUT，把两个变量混在一起
			deadlineMs: 600_000
		},
		expect: (r) => {
			const reconciled = r.events.some(
				(e) => e.event === 'tool.result' && e.errorType === 'TOOL_TIMEOUT_RECONCILED'
			)
			const saves = r.events.filter((e) => e.event === 'tool.result' && e.tool === 'save_menu').length
			return reconciled && saves === 1 && fs.existsSync(path.join(MENU_DIR, 'suite-timeout.json'))
		},
		why: '超时后读回文件核对，判定本次写入已完成并按成功回传；save_menu 只被调用 1 次，模型未重试'
	}
]

const selected = ONLY ? CASES.filter((c) => c.id.toUpperCase() === ONLY.toUpperCase()) : CASES
if (!selected.length) {
	console.error(`没有编号为 ${ONLY} 的用例。可用：${CASES.map((c) => c.id).join('、')}`)
	process.exit(1)
}
const OUT_JSON_ACTUAL = ONLY ? OUT_JSON.replace('.json', `-${ONLY}.json`) : OUT_JSON
const OUT_MD_ACTUAL = ONLY ? OUT_MD.replace('.md', `-${ONLY}.md`) : OUT_MD

const results = []
console.log('=== Agent 测试套件 ===')
console.log(`模型：${config.model}`)
console.log(`限制：最大步数 ${LIMITS.maxSteps}、总时限 ${LIMITS.totalDeadlineMs}ms、单工具超时 ${LIMITS.toolTimeoutMs}ms`)
if (ONLY) console.log(`仅运行：${ONLY}（结果写入 ${path.relative(ROOT, OUT_JSON_ACTUAL)}，不覆盖完整套件报告）`)
console.log('')

// 清理上次运行留下的菜单，避免 C1/C6/C8 的判定被旧文件污染
for (const name of ['suite-dinner.json', 'suite-denied.json', 'suite-timeout.json']) {
	const f = path.join(MENU_DIR, name)
	if (fs.existsSync(f)) fs.unlinkSync(f)
}

for (const c of selected) {
	const started = Date.now()
	const script = c.opts.script ? JSON.parse(fs.readFileSync(path.join(ROOT, c.opts.script), 'utf8')) : null
	const confirm = createConfirmer({ mode: c.opts.confirmMode || 'no', timeoutMs: 3_000 })

	const run = await runAgent({
		goal: c.goal,
		modelConfig: script ? null : model,
		options: {
			maxSteps: c.opts.maxSteps,
			deadlineMs: c.opts.deadlineMs,
			toolTimeoutMs: c.opts.toolTimeoutMs,
			confirm,
			faults: c.opts.faults,
			script,
			echo: false
		}
	})

	const passed = c.expect(run)
	results.push({
		id: c.id,
		name: c.name,
		mode: c.mode,
		goal: c.goal,
		status: run.status,
		steps: run.steps,
		toolCalls: run.toolCalls,
		ms: run.ms,
		wallMs: Date.now() - started,
		protocol: run.protocol,
		passed,
		expectation: c.why,
		stopReason: run.stopReason,
		answer: run.answer,
		taskId: run.taskId,
		logFile: path.relative(ROOT, run.logFile).replace(/\\/g, '/'),
		events: run.verification?.checks || []
	})

	console.log(`${passed ? '✓' : '✗'} ${c.id} ${c.name}（${c.mode}）`)
	console.log(`   状态=${run.status}  步数=${run.steps}  工具调用=${run.toolCalls}  耗时=${run.ms}ms  任务=${run.taskId}`)
	console.log(`   预期：${c.why}`)
	console.log(`   实际：${run.stopReason}`)
	console.log('')
}

const passCount = results.filter((r) => r.passed).length
console.log(`合计 ${passCount}/${results.length} 通过`)

fs.mkdirSync(path.dirname(OUT_JSON_ACTUAL), { recursive: true })
fs.writeFileSync(OUT_JSON_ACTUAL, JSON.stringify({ generatedAt: new Date().toISOString(), model: config.model, results }, null, 2), 'utf8')
fs.writeFileSync(OUT_MD_ACTUAL, toMarkdown(results), 'utf8')
console.log(`报告数据：${path.relative(ROOT, OUT_JSON_ACTUAL).replace(/\\/g, '/')}`)
console.log(`表格：${path.relative(ROOT, OUT_MD_ACTUAL).replace(/\\/g, '/')}`)

function toMarkdown(rows) {
	const head = [
		'| 编号 | 用例 | 输入（目标 / 条件） | 预期行为 | 实际结果 | 判断依据 | 判定 |',
		'| --- | --- | --- | --- | --- | --- | --- |'
	]
	const body = rows.map((r) => {
		const input = `${r.goal}${r.mode.includes('回放') ? '（确定性回放）' : ''}`
		const actual = `${r.status}，${r.steps} 步 / ${r.toolCalls} 次工具 / ${r.ms}ms`
		return `| ${r.id} | ${r.name} | ${esc(input)} | ${esc(r.expectation)} | ${esc(actual)} | ${esc(r.stopReason)} | ${r.passed ? '符合' : '不符合'} |`
	})
	return [...head, ...body, '', `合计 ${rows.filter((r) => r.passed).length}/${rows.length} 符合预期。`, ''].join('\n')
}

function esc(s) {
	return String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
}
