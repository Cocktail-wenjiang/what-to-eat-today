/**
 * Agent 运行时配置
 *
 * 设计原则：**限制值全部是代码里的常量，不交给模型决定**。
 * 提示词只能"请求"，真正的边界由本文件 + harness 里的检查函数执行。
 *
 * 密钥读取优先级：环境变量 > tools/agent/config.local.js > 云函数的 config.local.js
 * 后两者都在 .gitignore 里（通配 config.local.js），不会入库；本文件不含任何密钥。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

/** 项目根目录（tools/agent/ 往上两级） */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** 只读数据源：允许 Agent 访问的全部菜谱数据 */
export const RECIPE_FILE = path.join(ROOT, 'static/data/recipes.json')

/**
 * 唯一允许写盘的位置。
 * 路径校验以「解析后的绝对路径是否以该目录为前缀」为准，
 * 单靠字符串黑名单（过滤 `..`）挡不住符号链接与大小写差异。
 */
export const WRITE_DIR = path.join(ROOT, 'output/agent/menus')

/** 运行日志目录（JSONL，一次运行一个文件） */
export const LOG_DIR = path.join(ROOT, 'output/agent/runs')

/**
 * 硬限制。每一项都会被 harness 在循环里检查，而不是只写在提示词里。
 */
export const LIMITS = {
	/** 最大步数：一次模型调用记一步（同一响应里的多个工具调用仍算一步） */
	maxSteps: 8,
	/** 单次模型调用超时 */
	modelTimeoutMs: 45_000,
	/** 单次工具执行超时 */
	toolTimeoutMs: 3_000,
	/** 整轮任务总时限（从接收目标开始计） */
	totalDeadlineMs: 150_000,
	/** 模型调用重试上限（仅对超时/5xx 这类可重试错误） */
	maxRetries: 2,
	/** 单条工具结果进入上下文的字符上限，超出截断 */
	maxToolResultChars: 1_800,
	/** 上下文中保留的历史消息条数上限（system 与首条 user 始终保留） */
	maxHistoryMessages: 12,
	/** 人工确认等待上限，超时视为拒绝 */
	confirmTimeoutMs: 20_000,
	/** 允许模型一次响应内提出的工具调用个数上限 */
	maxToolCallsPerStep: 3
}

/**
 * 读取模型网关配置。
 * 找不到任何一份配置时返回 `{ok:false, reason}`，由调用方给出可执行的提示，
 * 而不是抛一个 "Cannot read property of undefined"。
 */
export function readModelConfig() {
	const fromEnv = {
		apiKey: process.env.AI_API_KEY || process.env.DASHSCOPE_API_KEY || '',
		baseUrl: process.env.AI_API_URL || process.env.AI_BASE_URL || '',
		model: process.env.AI_MODEL || ''
	}
	const fromLocal = readLocalConfig(path.join(ROOT, 'tools/agent/config.local.js'))
	const fromCloud = readCloudFunctionConfig()

	const apiKey = fromEnv.apiKey || fromLocal.apiKey || fromCloud.apiKey || ''
	const baseUrl = fromEnv.baseUrl || fromLocal.baseUrl || fromCloud.baseUrl || ''
	const model = fromEnv.model || fromLocal.model || fromCloud.model || ''

	if (!apiKey || !baseUrl || !model) {
		return {
			ok: false,
			reason:
				'未找到模型网关配置。请设置环境变量 AI_API_KEY / AI_API_URL / AI_MODEL，' +
				'或在 tools/agent/config.local.js 中写入 { apiKey, baseUrl, model }。'
		}
	}
	return { ok: true, apiKey, baseUrl: baseUrl.replace(/\/+$/, ''), model }
}

/** 读取一份 CommonJS 格式的本地配置；不存在或格式错误一律返回空对象 */
function readLocalConfig(file) {
	try {
		if (!fs.existsSync(file)) return {}
		// config.local.js 由本仓库自己维护，内容是 module.exports = {...}，
		// 用 createRequire 读比 eval 更安全，也能命中模块缓存
		return pickConfig(require(file))
	} catch {
		return {}
	}
}

/** 复用云函数的本地配置，避免同一份密钥在仓库里存两处 */
function readCloudFunctionConfig() {
	try {
		const dirs = fs
			.readdirSync(ROOT, { withFileTypes: true })
			.filter((e) => e.isDirectory() && e.name.startsWith('uniCloud-'))
			.map((e) => e.name)
		for (const dir of dirs) {
			const file = path.join(ROOT, dir, 'cloudfunctions/ragQuery/config.local.js')
			if (fs.existsSync(file)) {
				const cfg = readLocalConfig(file)
				if (cfg.apiKey) return cfg
			}
		}
	} catch {
		/* 目录结构变化时静默跳过，由调用方统一报"未配置" */
	}
	return {}
}

function pickConfig(raw) {
	if (!raw || typeof raw !== 'object') return {}
	return {
		apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
		baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : '',
		model: typeof raw.model === 'string' ? raw.model : ''
	}
}
