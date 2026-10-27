/**
 * 人工确认
 *
 * 会修改数据的工具（当前只有 save_menu）在执行前必须走这里：
 * 先展示「操作内容 + 影响面」，再由用户明确同意；拒绝或等待超时一律不执行。
 *
 * 三种应答来源，按优先级：
 *  - 交互输入（readline 读 stdin）—— 真实使用场景，也是 2.6 里「人工确认」用例的测法
 *  - 预设应答（--confirm=yes|no）—— 自动化测试用，日志里会标注 source=preset
 *  - 非交互环境（stdin 不是 TTY 且没有预设）—— 一律拒绝，绝不默认放行
 */
import readline from 'node:readline'

/**
 * @param {object} opts
 * @param {'interactive'|'yes'|'no'} [opts.mode]
 * @param {number} [opts.timeoutMs]
 * @param {NodeJS.ReadableStream} [opts.input]
 * @param {NodeJS.WritableStream} [opts.output]
 */
export function createConfirmer({ mode = 'interactive', timeoutMs = 20_000, input = process.stdin, output = process.stdout } = {}) {
	return async function confirm(req) {
		const started = Date.now()
		const header = [
			'',
			'┌─ 需要确认的操作 ─────────────────────────────',
			`│ 工具：${req.tool}`,
			`│ 参数：${JSON.stringify(req.args)}`,
			`│ 影响：${req.preview}`,
			'└─────────────────────────────────────────────'
		].join('\n')
		output.write(header + '\n')

		if (mode === 'yes' || mode === 'no') {
			const approved = mode === 'yes'
			output.write(`  → 预设应答（source=preset）：${approved ? '同意' : '拒绝'}\n`)
			return { approved, reason: approved ? '预设同意' : '预设拒绝', source: 'preset', ms: Date.now() - started }
		}

		// 没有 TTY 又没有预设应答：拒绝。不能因为"读不到输入"就默认执行
		if (!input.isTTY) {
			output.write('  → 非交互环境，无法取得确认，按拒绝处理\n')
			return { approved: false, reason: '非交互环境，无法确认', source: 'no-tty', ms: Date.now() - started }
		}

		const answer = await askYesNo({ input, output, timeoutMs })
		if (answer === null) {
			output.write(`  → 等待超过 ${timeoutMs}ms，按拒绝处理，操作未执行\n`)
			return { approved: false, reason: `等待确认超时（${timeoutMs}ms）`, source: 'timeout', ms: Date.now() - started }
		}
		return {
			approved: answer,
			reason: answer ? '用户同意' : '用户拒绝',
			source: 'interactive',
			ms: Date.now() - started
		}
	}
}

/** 读一行 y/n；超时返回 null */
function askYesNo({ input, output, timeoutMs }) {
	return new Promise((resolve) => {
		const rl = readline.createInterface({ input, output, terminal: false })
		let settled = false
		const done = (v) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			rl.close()
			resolve(v)
		}
		const timer = setTimeout(() => done(null), timeoutMs)
		output.write('  是否执行？输入 y 同意 / n 拒绝：')
		rl.once('line', (line) => {
			const s = String(line).trim().toLowerCase()
			if (s === 'y' || s === 'yes' || s === '是') done(true)
			else done(false)
		})
		rl.once('close', () => done(false))
	})
}
