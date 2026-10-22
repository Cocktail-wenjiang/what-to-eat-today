/**
 * 通用格式化工具（uni-app 版，纯 JS，可直接在 H5 / 小程序 / App 端运行）
 */

/** 把时间戳或 ISO 字符串格式化为「今天 16:12 / 10-08 09:30」 */
export function formatTime(input) {
	if (!input) return '--'

	let date
	if (typeof input === 'number') {
		// uniCloud 的 created_at 是毫秒时间戳
		date = new Date(input)
	} else if (typeof input === 'string') {
		// SQLite CURRENT_TIMESTAMP 是 UTC 且无时区标记，补上 Z 才能正确解析
		const normalized = input.includes('T') ? input : input.replace(' ', 'T') + 'Z'
		date = new Date(normalized)
	} else {
		date = new Date(input)
	}

	if (Number.isNaN(date.getTime())) return String(input)

	const now = new Date()
	const isToday = date.toDateString() === now.toDateString()
	const hh = String(date.getHours()).padStart(2, '0')
	const mm = String(date.getMinutes()).padStart(2, '0')
	if (isToday) return `今天 ${hh}:${mm}`

	const mo = String(date.getMonth() + 1).padStart(2, '0')
	const dd = String(date.getDate()).padStart(2, '0')
	return `${mo}-${dd} ${hh}:${mm}`
}

/** 0 -> 01, 9 -> 09，用于卡片序号 */
export function padIndex(n) {
	return String(n + 1).padStart(2, '0')
}

/**
 * 推荐结果的匹配口径 -> 面向用户的说明。
 *
 * 只有「放宽了口味条件才拿到结果」这一种情况值得告诉用户，其余情况一律返回空串：
 * 用户不需要知道结果来自哪条数据链路（云函数 / 云库直连 / 本地兜底），
 * 那些属于实现细节，不应出现在产品界面上。
 */
export function modeLabel(mode) {
	if (mode === 'rule-fallback' || mode === 'local-fallback') return '已放宽口味'
	return ''
}
