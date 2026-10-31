/**
 * 运行日志
 *
 * 一次运行 = 一个 JSONL 文件（output/agent/runs/<taskId>.jsonl），每行一个事件。
 * 选择 JSONL 而不是一份大 JSON：任务被中途终止时，已经落盘的行仍然可读；
 * 追加写也不会因为进程崩溃丢掉前面的事件。
 *
 * 脱敏是硬性要求：密钥、Authorization 头、完整模型输入中的密钥一律不落盘。
 * redact() 在写入前统一过一遍，避免某个调用点漏掉。
 */
import fs from 'node:fs'
import path from 'node:path'
import { LOG_DIR } from './config.mjs'

/** 需要遮蔽的字段名（大小写不敏感） */
const SECRET_KEYS = /^(api[_-]?key|authorization|token|secret|password|dashscope_api_key)$/i

/** 形如 sk-xxxx 的密钥串 */
const SECRET_VALUE = /\bsk-[A-Za-z0-9_-]{8,}/g

export function redact(value, depth = 0) {
	if (depth > 6) return '[DEPTH_LIMIT]'
	if (value === null || value === undefined) return value
	if (typeof value === 'string') {
		return value.replace(SECRET_VALUE, (m) => `${m.slice(0, 3)}***${m.slice(-2)}`)
	}
	if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
	if (typeof value === 'object') {
		const out = {}
		for (const [k, v] of Object.entries(value)) {
			out[k] = SECRET_KEYS.test(k) ? '***' : redact(v, depth + 1)
		}
		return out
	}
	return value
}

/** 摘要：长内容只留前 N 字符，日志里不存全文（全文在上下文档里另有记录） */
export function digest(value, max = 240) {
	const text = typeof value === 'string' ? value : JSON.stringify(value)
	if (!text) return ''
	const clean = redact(text).replace(/\s+/g, ' ')
	return clean.length > max ? `${clean.slice(0, max)}…（共 ${clean.length} 字符）` : clean
}

export function createLogger({ taskId, echo = true } = {}) {
	fs.mkdirSync(LOG_DIR, { recursive: true })
	const file = path.join(LOG_DIR, `${taskId}.jsonl`)
	fs.writeFileSync(file, '', 'utf8')
	const events = []

	function log(event) {
		const row = { ts: new Date().toISOString(), taskId, ...redact(event) }
		events.push(row)
		fs.appendFileSync(file, JSON.stringify(row) + '\n', 'utf8')
		if (echo) printEvent(row)
		return row
	}

	return { log, file, events }
}

/**
 * 终端回显。
 * 只打印「人需要看」的字段：时间、步号、事件、工具、耗时、结果摘要。
 * 完整字段留在 JSONL 里，避免终端被淹没。
 */
function printEvent(row) {
	const time = row.ts.slice(11, 23)
	const step = row.step === undefined ? '-' : String(row.step)
	const parts = [`[${time}]`, `step=${step}`, row.event]
	if (row.tool) parts.push(`tool=${row.tool}`)
	if (row.ms !== undefined) parts.push(`${row.ms}ms`)
	if (row.status) parts.push(`status=${row.status}`)
	if (row.ok !== undefined && row.event === 'tool.result') {
		if (row.ok) parts.push(row.errorType ? `ok(${row.errorType})` : 'ok')
		else parts.push(`err=${row.errorType || 'ERROR'}`)
	} else if (row.errorType) {
		parts.push(`err=${row.errorType}`)
	}
	console.log(parts.join(' '))
	if (row.note) console.log(`           └─ ${row.note}`)
	if (row.argsDigest) console.log(`           ├─ 参数 ${row.argsDigest}`)
	if (row.resultDigest) console.log(`           └─ 结果 ${row.resultDigest}`)
}
