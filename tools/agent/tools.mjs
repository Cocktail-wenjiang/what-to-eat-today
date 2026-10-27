/**
 * 工具实现层
 *
 * 四个工具全部**只接受已校验的参数**（校验在 registry 里做），这里只负责业务逻辑。
 * 返回结构统一为 `{ ok, data }` / `{ ok, error:{ code, message } }`，
 * 让 harness 不必区分「正常返回」与「抛异常」两种形态——两者都会转成同一种
 * 工具结果回传给模型，模型才有机会修正。
 *
 * 数据边界：
 *  - 读：只读 RECIPE_FILE 一个文件，不接受任意路径；
 *  - 写：只写 WRITE_DIR 下的文件，文件名由校验过的 menuId 决定。
 */
import fs from 'node:fs'
import path from 'node:path'
import { RECIPE_FILE, WRITE_DIR } from './config.mjs'

/** 工具错误码：与 harness 的日志字段对应，便于统计各类失败占比 */
export const ERROR_CODE = {
	VALIDATION: 'VALIDATION_ERROR',
	NOT_FOUND: 'NOT_FOUND',
	IO: 'IO_ERROR',
	INTERNAL: 'INTERNAL_ERROR',
	DENIED: 'USER_DENIED',
	TIMEOUT: 'TOOL_TIMEOUT'
}

let recipeCache = null

/** 读取菜谱数据（只读一次，进程内缓存） */
export function loadRecipes() {
	if (recipeCache) return recipeCache
	const raw = fs.readFileSync(RECIPE_FILE, 'utf8')
	const list = JSON.parse(raw)
	if (!Array.isArray(list) || !list.length) {
		throw new Error('菜谱数据为空或格式不正确')
	}
	recipeCache = list
	return list
}

/** 按 recipeId 建索引，detail 与 stats 都要用 */
let indexCache = null
function recipeIndex() {
	if (indexCache) return indexCache
	const map = new Map()
	for (const r of loadRecipes()) map.set(r.recipeId, r)
	indexCache = map
	return indexCache
}

/**
 * 创建工具箱。
 * 依赖以参数注入（recipeFile / writeDir），测试可以指向临时目录，不污染真实产物。
 */
export function createToolbox({ writeDir = WRITE_DIR } = {}) {
	return {
		search_recipes: (args) => searchRecipes(args),
		recipe_detail: (args) => recipeDetail(args),
		calc_stats: (args) => calcStats(args),
		save_menu: (args) => saveMenu(args, writeDir)
	}
}

/** 工具 1：按条件筛选候选菜 */
function searchRecipes({ max_minutes: maxMinutes, tags = [], exclude_allergy: allergy = '', limit = 3 }) {
	const pool = loadRecipes()
	const keyword = allergy.trim()
	const hits = []
	for (const r of pool) {
		if (Number(r.minutes) > maxMinutes) continue
		const rTags = r.tags || []
		if (tags.length && !tags.every((t) => rTags.includes(t))) continue
		// 忌口匹配菜名与食材：用户说「虾」，虾仁炒蛋的食材里有「虾仁」，也应排除
		if (keyword && (r.name.includes(keyword) || (r.ingredients || []).some((i) => i.includes(keyword)))) {
			continue
		}
		hits.push(r)
	}
	// 排序：用时短的优先，同用时按菜名，保证同样的输入得到同样的输出（可复现）
	hits.sort((a, b) => a.minutes - b.minutes || a.name.localeCompare(b.name, 'zh'))
	const items = hits.slice(0, limit).map((r) => ({
		recipeId: r.recipeId,
		name: r.name,
		minutes: r.minutes,
		tags: r.tags || []
	}))
	return {
		ok: true,
		data: {
			matched: hits.length,
			returned: items.length,
			has_more: hits.length > items.length,
			criteria: { max_minutes: maxMinutes, tags, exclude_allergy: keyword || null, limit },
			items
		}
	}
}

/** 工具 2：读取单道菜详情 */
function recipeDetail({ recipeId }) {
	const r = recipeIndex().get(recipeId)
	if (!r) {
		return {
			ok: false,
			error: {
				code: ERROR_CODE.NOT_FOUND,
				message: `菜谱库中不存在 ${recipeId}。recipeId 只能取自 search_recipes 的返回结果。`
			}
		}
	}
	return {
		ok: true,
		data: {
			recipeId: r.recipeId,
			name: r.name,
			minutes: r.minutes,
			tags: r.tags || [],
			ingredients: r.ingredients || [],
			steps: r.steps || []
		}
	}
}

/** 工具 3：统计计算（纯算术，不返回菜品正文） */
function calcStats({ recipeIds }) {
	const idx = recipeIndex()
	const missing = recipeIds.filter((id) => !idx.has(id))
	if (missing.length) {
		return {
			ok: false,
			error: {
				code: ERROR_CODE.NOT_FOUND,
				message: `以下菜谱不存在：${missing.join('、')}。请先用 search_recipes 确认编号。`
			}
		}
	}
	const rows = recipeIds.map((id) => idx.get(id))
	const minutes = rows.map((r) => Number(r.minutes) || 0)
	const total = minutes.reduce((s, v) => s + v, 0)
	const ingredients = new Set()
	for (const r of rows) for (const i of r.ingredients || []) ingredients.add(i)
	const tagCount = {}
	for (const r of rows) for (const t of r.tags || []) tagCount[t] = (tagCount[t] || 0) + 1
	// 标签分布按次数降序，次数相同按名称，避免每次运行顺序不同
	const tagDistribution = Object.entries(tagCount)
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
		.map(([tag, count]) => ({ tag, count }))
	return {
		ok: true,
		data: {
			count: rows.length,
			total_minutes: total,
			avg_minutes: Math.round((total / rows.length) * 10) / 10,
			max_minutes: Math.max(...minutes),
			min_minutes: Math.min(...minutes),
			unique_ingredients: ingredients.size,
			tag_distribution: tagDistribution,
			items: rows.map((r) => ({ recipeId: r.recipeId, name: r.name, minutes: r.minutes }))
		}
	}
}

/**
 * 工具 4：写菜单文件（唯一会修改数据、且需要人工确认的工具）
 *
 * 幂等性：同一 menuId 重复写入覆盖同一文件，不产生副本，所以「超时后重试」
 * 不会造成重复修改——但按 2.5 的要求，状态不明时仍应先读文件核对再决定是否重试。
 */
function saveMenu({ menuId, title, recipeIds }, writeDir) {
	const idx = recipeIndex()
	const missing = recipeIds.filter((id) => !idx.has(id))
	if (missing.length) {
		return {
			ok: false,
			error: { code: ERROR_CODE.NOT_FOUND, message: `以下菜谱不存在：${missing.join('、')}` }
		}
	}

	const file = path.join(writeDir, `${menuId}.json`)
	// 路径围栏：menuId 已由 schema 限定为 [a-z0-9-]，这里再做一次解析后前缀校验，
	// 防止将来有人放宽 schema 时把 `../` 带进来。
	const resolvedDir = path.resolve(writeDir)
	const resolved = path.resolve(file)
	if (!resolved.startsWith(resolvedDir + path.sep)) {
		return {
			ok: false,
			error: { code: ERROR_CODE.VALIDATION, message: '写入路径超出允许目录，已拒绝' }
		}
	}

	const existed = fs.existsSync(resolved)
	fs.mkdirSync(resolvedDir, { recursive: true })
	const payload = {
		menuId,
		title,
		createdAt: new Date().toISOString(),
		source: 'agent-tool/save_menu',
		items: recipeIds.map((id) => {
			const r = idx.get(id)
			return { recipeId: r.recipeId, name: r.name, minutes: r.minutes }
		})
	}
	fs.writeFileSync(resolved, JSON.stringify(payload, null, 2) + '\n', 'utf8')

	return {
		ok: true,
		data: {
			menuId,
			// 相对仓库根目录的路径，便于报告与日志引用
			file: path.relative(path.resolve(writeDir, '../../..'), resolved).replace(/\\/g, '/'),
			overwritten: existed,
			count: recipeIds.length,
			items: payload.items
		}
	}
}
