/**
 * 表单校验规则 —— 与云函数 recommend 的 validate() 保持一致，
 * 前端先校验可以少发无效请求，云函数再校验保证数据不被绕过。
 *   servings    1 ~ 20
 *   max_minutes 5 ~ 240
 *   preference  1 ~ 30 字符
 *   allergy     可空，最长 30 字符
 */
export const LIMITS = {
	servings: { min: 1, max: 20 },
	max_minutes: { min: 5, max: 240 },
	preference: { minLen: 1, maxLen: 30 },
	allergy: { maxLen: 30 }
}

export const PREFERENCE_OPTIONS = ['清淡', '高蛋白', '素食', '快捷', '不限']

/**
 * 校验整个表单，返回 { valid, errors }
 * errors 形如 { servings: '用餐人数需在 1-20 之间' }
 */
export function validateForm(form) {
	const errors = {}

	const servings = Number(form.servings)
	if (form.servings === '' || form.servings === null || Number.isNaN(servings)) {
		errors.servings = '请填写用餐人数'
	} else if (!Number.isInteger(servings)) {
		errors.servings = '用餐人数必须是整数'
	} else if (servings < LIMITS.servings.min || servings > LIMITS.servings.max) {
		errors.servings = `用餐人数需在 ${LIMITS.servings.min}-${LIMITS.servings.max} 之间`
	}

	const minutes = Number(form.max_minutes)
	if (form.max_minutes === '' || form.max_minutes === null || Number.isNaN(minutes)) {
		errors.max_minutes = '请填写最多用时'
	} else if (!Number.isInteger(minutes)) {
		errors.max_minutes = '最多用时必须是整数'
	} else if (minutes < LIMITS.max_minutes.min || minutes > LIMITS.max_minutes.max) {
		errors.max_minutes = `最多用时需在 ${LIMITS.max_minutes.min}-${LIMITS.max_minutes.max} 分钟之间`
	}

	const preference = (form.preference || '').trim()
	if (preference.length < LIMITS.preference.minLen) {
		errors.preference = '请选择口味偏好'
	} else if (preference.length > LIMITS.preference.maxLen) {
		errors.preference = `口味偏好不能超过 ${LIMITS.preference.maxLen} 个字符`
	}

	const allergy = (form.allergy || '').trim()
	if (allergy.length > LIMITS.allergy.maxLen) {
		errors.allergy = `忌口食材不能超过 ${LIMITS.allergy.maxLen} 个字符`
	}

	return { valid: Object.keys(errors).length === 0, errors }
}

/** 转换为云函数接受的请求体（字段名与 uniCloud recommend 云函数对齐） */
export function toRequestPayload(form) {
	return {
		servings: Number(form.servings),
		max_minutes: Number(form.max_minutes),
		preference: (form.preference || '').trim(),
		allergy: (form.allergy || '').trim()
	}
}
