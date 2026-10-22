/**
 * 统一接口客户端（uniCloud 双通道降级）
 *
 * ┌── 主通道 ── uniCloud 云函数 recommend     （云端计算 + 落库历史）
 * ├── 降级一层 ─ uniCloud 数据库直连 + 本地规则 （云函数不可用，但仍能读云库）
 * └── 降级二层 ─ 本地内置菜谱 JSON + 本地规则   （完全断网也能演示）
 *
 * 这样设计的原因：
 *  - 云函数是「控制层-业务层-数据层」的标准链路，且能记录历史，优先使用；
 *  - 直连数据库保证云函数未部署/额度用尽时页面依然可用；
 *  - 本地 JSON 保证断网时不出现白屏。
 *
 * 另有独立支线：parseNaturalLanguage() 调用 aiParseRequest 云函数，
 * 把「一句话需求」或「一张照片」解析成表单字段。它只负责回填，不参与推荐降级链路，
 * 解析失败时原表单推荐仍然可用（详见 useRecommendation.parseWithAI / parseWithImage）。
 */
import { recommendByRules, dedupeRecipes } from './ruleEngine.js'

/** 云函数名 */
const CLOUD_FUNCTION = 'recommend'
const AI_PARSE_FUNCTION = 'aiParseRequest'
/** 云数据库集合名 */
const COLLECTION_RECIPES = 'recipes'
const COLLECTION_HISTORY = 'recommendation_history'
/** 云函数调用超时（毫秒）—— 避免云空间不可达时页面无限等待 */
const TIMEOUT_MS = 8000
/**
 * AI 解析超时（毫秒）。
 *
 * 不能用 TIMEOUT_MS：模型推理比普通云函数慢一个量级。2026-10-12 真机联调实测
 * 文本 3.5 ~ 7.1 s、识图 3.7 ~ 4.7 s——原来复用 8000 ms，首次调用（含冷启动）
 * 已逼近上限，会被误判为超时。这里放宽到 25 s，留足冷启动与网络抖动余量。
 */
const AI_PARSE_TIMEOUT_MS = 25000
/** 是否启用「数据库直连」这层降级（云空间不可用时会被自动跳过） */
const ENABLE_DB_DIRECT = true

/** 自定义错误类型，便于上层区分「网络不可用」与「业务校验失败」 */
export class ApiError extends Error {
	constructor(message, { type = 'unknown', channel = '', detail = '' } = {}) {
		super(message)
		this.name = 'ApiError'
		this.type = type // network | timeout | business | unknown
		this.channel = channel
		/** 仅供控制台排查的技术细节，不展示给用户 */
		this.detail = detail
	}
}

/**
 * 把用户的一句话（可选附带一张图）交给云端解析成表单字段。
 * 解析失败一律抛「用户能读懂」的说明，不暴露后端实现细节。
 *
 * 多轮对话：把最近的对话历史与**当前条件**一并送上，
 * 云端才能理解「再快一点」「换成素的」这类指代，并在此基础上做增量修改。
 * 两者都是可选且**非空才附加**——单轮场景请求体保持原样，不多传字段。
 *
 * @param {string} text 一句话需求，带图时可为空串
 * @param {{image?: string, history?: Array<{role:string,content:string}>, current?: object}} [options]
 *        image    data URL 或 http(s) 直链
 *        history  最近若干轮对话（role 只有 user / assistant）
 *        current  当前表单条件（servings / max_minutes / preference / allergy）
 */
export async function parseNaturalLanguage(text, options = {}) {
	const value = String(text || '').trim()
	const image = typeof options.image === 'string' ? options.image : ''
	if (!value && !image) throw new ApiError('请先说说你今天想吃什么', { type: 'business' })
	if (!cloudReady()) {
		throw new ApiError('这会儿没解析出来，你可以直接在下面填条件', { type: 'network' })
	}
	const data = { text: value }
	// 仅在带图时才附加字段，避免纯文本请求白白撑大请求体
	if (image) data.image = image
	// 历史与当前条件同样按需附加：历史为空数组时不传，
	// 保证「首轮对话」与改造前的单轮请求完全一致
	if (Array.isArray(options.history) && options.history.length) {
		data.history = options.history
	}
	if (options.current && typeof options.current === 'object') {
		data.current = options.current
	}
	const res = await withTimeout(
		uniCloud.callFunction({ name: AI_PARSE_FUNCTION, data }),
		AI_PARSE_TIMEOUT_MS,
		image ? '图片识别' : 'AI 解析'
	)
	const payload = res?.result
	if (!payload) {
		throw new ApiError('这会儿没解析出来，你可以直接在下面填条件', { type: 'business' })
	}
	if (payload.error) throw new ApiError(payload.error, { type: 'business' })
	return payload
}

/**
 * 给 Promise 加超时保护，避免服务不可达时长时间挂起。
 * 超时对用户只呈现一句通用说明；`label` 与耗时写入 detail，供控制台排查。
 */
function withTimeout(promise, ms, label) {
	let timer
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(
			() =>
				reject(
					new ApiError('网络似乎不太顺畅，请稍后重试', {
						type: 'timeout',
						detail: `${label}超时（${ms}ms）`
					})
				),
			ms
		)
	})
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** 云空间是否可用（H5 端 uniCloud 会自动注入，小程序/App 端需在 App.vue init） */
function cloudReady() {
	return typeof uniCloud !== 'undefined' && uniCloud && typeof uniCloud.callFunction === 'function'
}

// ============ 本地内置菜谱（离线兜底） ============

let localSeedCache = null

/**
 * 读取随项目一起打包的本地菜谱种子。
 * 各端路径差异：H5 用相对路径，小程序/App 用 static 目录。
 * 这里按平台分支，失败一律返回空数组（由上层给出友好提示）。
 */
export function loadLocalSeed() {
	if (localSeedCache?.length) return Promise.resolve(localSeedCache)

	const url = '/static/data/recipes.json'
	return new Promise((resolve) => {
		// eslint-disable-next-line no-undef
		uni.request({
			url,
			method: 'GET',
			success: (res) => {
				const list = Array.isArray(res.data) ? res.data : res.data?.recipes || []
				localSeedCache = list
				resolve(list)
			},
			fail: () => resolve([])
		})
	})
}

// ============ 通道 1：uniCloud 云函数 ============

async function recommendViaCloud(request) {
	if (!cloudReady()) {
		throw new ApiError('推荐服务暂时不可用', { type: 'network', channel: 'uniCloud' })
	}
	const res = await withTimeout(
		uniCloud.callFunction({ name: CLOUD_FUNCTION, data: request }),
		TIMEOUT_MS,
		'云函数调用'
	)
	const payload = res?.result
	if (!payload) {
		throw new ApiError('推荐服务暂时不可用', { type: 'business', channel: 'uniCloud' })
	}
	if (payload.error) {
		// 参数校验失败属于业务错误，不应降级重试
		const msg =
			Array.isArray(payload.details) && payload.details.length
				? payload.details.map((d) => `${d.field}：${d.msg}`).join('；')
				: payload.error
		throw new ApiError(msg, { type: 'business', channel: 'uniCloud' })
	}
	return {
		id: payload.id ?? null,
		recommendations: enrichRecommendations(payload.recommendations || [], request),
		mode: payload.mode || 'recommend-cloud',
		channel: 'uniCloud'
	}
}

// ============ 通道 2：uniCloud 数据库直连 + 本地规则 ============
//
// ⚠️ 返回结构差异（官方文档 clientdb.html「database接口返回的数据结构多了一层result」）：
//   · 客户端 uniCloud.database()      → res.result.data / res.result.total / res.result.id
//   · 云函数端（服务端）uniCloud.database() → res.data        / res.total        / res.id
//   本文件跑在客户端，所以下面统一取 res.result.*；
//   云函数 recommend/index.js 跑在服务端，那边取的是 res.*，两者不能混用。

let cloudRecipeCache = null

/** uniCloud 单次查询默认上限 100，菜谱量已超过，需分批取全量 */
async function fetchCloudRecipes() {
	if (cloudRecipeCache?.length) return cloudRecipeCache
	if (!cloudReady()) throw new ApiError('菜谱库暂时不可用', { type: 'network' })

	const db = uniCloud.database()
	const coll = db.collection(COLLECTION_RECIPES)
	const countRes = await withTimeout(coll.count(), TIMEOUT_MS, '云库计数')
	const total = countRes?.result?.total || 0
	if (!total) throw new ApiError('菜谱库暂时不可用', { type: 'business' })

	const LIMIT = 100
	const list = []
	for (let skip = 0; skip < total; skip += LIMIT) {
		const res = await withTimeout(coll.skip(skip).limit(LIMIT).get(), TIMEOUT_MS, '云库读取')
		list.push(...(res?.result?.data || []))
	}
	cloudRecipeCache = list.map(mapRecipeRow)
	return cloudRecipeCache
}

/** 数据库下划线/`_id` 风格 -> 前端驼峰风格，统一在数据边界完成 */
export function mapRecipeRow(row) {
	return {
		recipeId: row.recipeId || row.recipe_id || row._id,
		name: row.name,
		ingredients: row.ingredients || [],
		steps: row.steps || [],
		minutes: row.minutes,
		tags: row.tags || [],
		// 菜品图路径（/static/images/recipes/R-0XX.jpg）；缺图时为空串，组件按无图渲染
		image: row.image || '',
		reason: row.reason || '',
		fitTags: row.fitTags || [],
		source: row.source || 'db'
	}
}

/**
 * 本次匹配命中的短标签（卡片上的小徽标）。
 * 与 buildRecipeReason 同源：标签是理由的拆解，保证「徽标」与「文案」不会互相矛盾。
 */
export function buildFitTags(recipe, request) {
	const fit = []
	const minutes = Number(recipe.minutes)
	const maxMinutes = Number(request.max_minutes)
	if (Number.isFinite(minutes) && Number.isFinite(maxMinutes) && minutes <= maxMinutes) {
		fit.push(`${minutes}分钟内`)
	}
	if (
		request.preference &&
		request.preference !== '不限' &&
		(recipe.tags || []).includes(request.preference)
	) {
		fit.push(request.preference)
	}
	if (request.allergy) fit.push(`无${request.allergy}`)
	return fit
}

export function buildRecipeReason(recipe, request) {
	const fit = buildFitTags(recipe, request)
	return fit.length
		? `适合这次安排：${fit.join('，')}。`
		: '这道菜步骤简单，适合按现在的时间安排。'
}

/**
 * 为结果补齐 reason / fitTags。
 * 云函数已生成时直接沿用（避免两端文案漂移），降级通道则由本地生成同样字段。
 */
function enrichRecommendations(list, request) {
	return dedupeRecipes(
		(list || []).map((recipe) => ({
			...recipe,
			fitTags:
				Array.isArray(recipe.fitTags) && recipe.fitTags.length
					? recipe.fitTags
					: buildFitTags(recipe, request),
			reason: recipe.reason || buildRecipeReason(recipe, request)
		}))
	)
}

async function recommendViaCloudDirect(request) {
	const recipes = await fetchCloudRecipes()
	if (!recipes.length) {
		throw new ApiError('菜谱库暂时不可用，请稍后重试', { type: 'business', channel: 'uniCloud-direct' })
	}
	const { recommendations, mode } = recommendByRules(recipes, request)
	const enriched = enrichRecommendations(recommendations, request)

	// 尝试写回历史：失败不影响推荐结果展示
	// 注意：这里是客户端 API，id 在 res.result.id（服务端才是 res.id）
	let id = null
	try {
		const addRes = await uniCloud
			.database()
			.collection(COLLECTION_HISTORY)
			.add({
				servings: request.servings,
				max_minutes: request.max_minutes,
				preference: request.preference,
				allergy: request.allergy || '',
				recommendations: enriched,
				mode,
				created_at: Date.now()
			})
		id = addRes?.result?.id ?? null
	} catch (err) {
		console.warn('[history] 直连写入失败，已忽略：', err?.detail || err?.message)
	}

	return { id, recommendations: enriched, mode, channel: 'uniCloud-direct' }
}

// ============ 通道 3：本地 JSON + 本地规则 ============

async function recommendViaLocal(request) {
	const recipes = await loadLocalSeed()
	if (!recipes.length) {
		throw new ApiError('菜谱数据暂时不可用，请稍后重试', { type: 'network', channel: 'local' })
	}
	// mode 由规则引擎给出（rule-match / rule-fallback），
	// 不能写死成「本地」——否则界面无法区分结果是否经过放宽。
	const { recommendations, mode } = recommendByRules(recipes, request)
	return {
		id: null,
		recommendations: enrichRecommendations(recommendations, request),
		mode,
		channel: 'local'
	}
}

// ============ 对外统一接口 ============

/**
 * 获取推荐结果 —— 逐级降级，任一通道成功即返回。
 * 返回值携带 `degraded` / `channel` / `attempts`，仅供内部诊断，不向用户展示。
 */
export async function requestRecommendation(request) {
	const attempts = []

	// 1) uniCloud 云函数
	try {
		const result = await recommendViaCloud(request)
		return { ...result, degraded: false, attempts }
	} catch (err) {
		if (err?.type === 'business') throw err // 业务校验失败直接抛给用户
		attempts.push({ channel: 'uniCloud', reason: err?.detail || err?.message })
		console.warn('[channel] 云函数不可用，尝试降级：', err?.detail || err?.message)
	}

	// 2) uniCloud 数据库直连
	if (ENABLE_DB_DIRECT) {
		try {
			const result = await recommendViaCloudDirect(request)
			return { ...result, degraded: true, attempts }
		} catch (err) {
			attempts.push({ channel: 'uniCloud-direct', reason: err?.detail || err?.message })
			console.warn('[channel] 云库直连不可用，尝试降级：', err?.detail || err?.message)
		}
	}

	// 3) 本地内置菜谱
	try {
		const result = await recommendViaLocal(request)
		return { ...result, degraded: true, attempts }
	} catch (err) {
		attempts.push({ channel: 'local', reason: err?.detail || err?.message })
	}

	throw new ApiError('网络似乎不太顺畅，请稍后重试', {
		type: 'network',
		channel: 'local'
	})
}

/** 读取历史记录 —— 云函数已落库，这里直接读云库；失败返回空数组而非抛错 */
export async function requestHistory(limit = 10) {
	if (!cloudReady()) return { list: [], channel: 'local' }
	try {
		const res = await withTimeout(
			uniCloud
				.database()
				.collection(COLLECTION_HISTORY)
				.orderBy('created_at', 'desc')
				.limit(limit)
				.get(),
			TIMEOUT_MS,
			'历史读取'
		)
		const list = (res?.result?.data || []).map(normalizeHistoryRow)
		return { list, channel: 'uniCloud' }
	} catch (err) {
		console.warn('[history] 云库历史不可用：', err?.detail || err?.message)
		return { list: [], channel: 'local' }
	}
}

/** 历史记录字段归一化 */
export function normalizeHistoryRow(row) {
	return {
		id: row._id,
		servings: row.servings,
		maxMinutes: row.max_minutes,
		preference: row.preference,
		allergy: row.allergy,
		recommendations: Array.isArray(row.recommendations) ? row.recommendations : [],
		mode: row.mode || 'rule-fallback',
		createdAt: row.created_at
	}
}

/**
 * 菜谱池（供 Hero 数字与空状态建议使用）。
 * 加载顺序：uniCloud 云库 → 本地种子。
 */
export async function ensureRecipePool() {
	try {
		return await fetchCloudRecipes()
	} catch (err) {
		console.warn('[pool] 云库不可用，改用本地种子：', err?.detail || err?.message)
		return await loadLocalSeed()
	}
}

/** uniCloud 是否已就绪（模块内部使用） */
export { cloudReady }
