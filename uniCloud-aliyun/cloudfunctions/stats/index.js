'use strict'

/**
 * 云端数据核对云函数（stats）
 *
 * 用途：在 uniCloud 云端实地核对「数据是否已导入齐全」以及「存储用量是否在 3/4 以内」。
 * 它读到的是**云端真实数据**（服务端 count + 逐条实测 JSON 字节），
 * 比本地 tools/monitor_cloud_storage.mjs 的估算更权威。
 *
 * 用法（二选一）：
 *   1. HBuilderX：右键 stats 目录 → 上传部署 → 右键 → 运行/测试
 *      测试参数：{"expected": 510}
 *   2. uniCloud 控制台 → 云函数 → stats → 云端运行 → 参数 {"expected":510}
 *
 * ⚠️ DEFAULT_EXPECTED 必须与 tools/recipes_dataset.mjs 的菜谱总数保持一致
 *    （tools/test_stats_function.mjs 会断言两者相等，脱钩会直接测试失败）。
 *
 * 返回：count / 是否齐全 / 首尾 _id / 平均步骤数 / 实测字节 / 存储用量与阈值状态
 */

const COLLECTION_RECIPES = 'recipes'
const COLLECTION_HISTORY = 'recommendation_history'

/** uniCloud 单次查询默认上限 100，必须分批取全量 */
const BATCH = 100

/** 配额与阈值（与 tools/cloud_storage_quota.mjs 同值） */
const BYTES_PER_GB = 1024 ** 3
const DATABASE_QUOTA_GB = 2
const THRESHOLD = 0.75
const BSON_OVERHEAD = 1.08
const INDEX_BYTES_PER_DOC = 40

/** 默认期望条数：与 tools/recipes_dataset.mjs 的菜谱总数同步（当前 510 道） */
const DEFAULT_EXPECTED = 510

/** 历史记录单条典型字节数 */
const HISTORY_DOC_BYTES = 900

function humanBytes(bytes) {
	if (bytes < 1024) return bytes + ' B'
	if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
	if (bytes < BYTES_PER_GB) return (bytes / 1024 / 1024).toFixed(2) + ' MB'
	return (bytes / BYTES_PER_GB).toFixed(4) + ' GB'
}

exports.main = async (event = {}) => {
	const expected = Number(event.expected) || DEFAULT_EXPECTED
	const db = uniCloud.database()

	// ---------- 菜谱集合 ----------
	const recipesColl = db.collection(COLLECTION_RECIPES)
	const countRes = await recipesColl.count()
	// 服务端结构：count() 的数值在顶层 total（不是 result.total）
	const total = countRes.total || 0

	let jsonBytes = 0
	let stepsTotal = 0
	let ingredientsTotal = 0
	const ids = []

	for (let skip = 0; skip < total; skip += BATCH) {
		const res = await recipesColl.skip(skip).limit(BATCH).get()
		// 服务端结构：get() 的数据在顶层 data
		const list = res.data || []
		for (const doc of list) {
			jsonBytes += Buffer.byteLength(JSON.stringify(doc), 'utf8')
			if (Array.isArray(doc.steps)) stepsTotal += doc.steps.length
			if (Array.isArray(doc.ingredients)) ingredientsTotal += doc.ingredients.length
			ids.push(doc._id)
		}
	}
	ids.sort()

	const recipesBytes =
		Math.round(jsonBytes * BSON_OVERHEAD) + total * INDEX_BYTES_PER_DOC

	// ---------- 历史集合（可能尚未创建） ----------
	let historyCount = 0
	let historyBytes = 0
	let historyError = null
	try {
		const hRes = await db.collection(COLLECTION_HISTORY).count()
		historyCount = hRes.total || 0
		historyBytes =
			Math.round(historyCount * HISTORY_DOC_BYTES * BSON_OVERHEAD) +
			historyCount * INDEX_BYTES_PER_DOC
	} catch (e) {
		historyError = (e && e.message) || String(e)
	}

	// ---------- 存储用量 ----------
	const usedBytes = recipesBytes + historyBytes
	const quotaBytes = DATABASE_QUOTA_GB * BYTES_PER_GB
	const ratio = usedBytes / quotaBytes

	return {
		ok: true,
		checkedAt: new Date().toISOString(),
		recipes: {
			count: total,
			expected,
			complete: total >= expected,
			missing: Math.max(0, expected - total),
			extra: Math.max(0, total - expected),
			firstId: ids[0] || null,
			lastId: ids[ids.length - 1] || null,
			avgSteps: total ? Number((stepsTotal / total).toFixed(2)) : 0,
			avgIngredients: total ? Number((ingredientsTotal / total).toFixed(2)) : 0,
			jsonBytes,
			estimatedBytes: recipesBytes,
			estimatedText: humanBytes(recipesBytes)
		},
		history: {
			count: historyCount,
			estimatedBytes: historyBytes,
			estimatedText: humanBytes(historyBytes),
			error: historyError
		},
		storage: {
			usedBytes,
			usedText: humanBytes(usedBytes),
			quotaGb: DATABASE_QUOTA_GB,
			quotaText: DATABASE_QUOTA_GB + ' GB',
			percent: Number((ratio * 100).toFixed(6)),
			thresholdPercent: THRESHOLD * 100,
			thresholdBytes: quotaBytes * THRESHOLD,
			thresholdText: humanBytes(quotaBytes * THRESHOLD),
			exceeded: ratio >= THRESHOLD,
			level: ratio >= THRESHOLD ? 'danger' : ratio >= 0.5 ? 'warn' : 'ok',
			remainingText: humanBytes(Math.max(0, quotaBytes * THRESHOLD - usedBytes))
		}
	}
}
