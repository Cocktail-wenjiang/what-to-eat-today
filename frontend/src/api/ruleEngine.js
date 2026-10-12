/**
 * 本地规则推荐（最终降级方案）
 *
 * 与后端 services.py 的规则保持一致的业务语义：
 *   1. 用时上限过滤（硬性条件）
 *   2. 忌口过滤（硬性条件）
 *   3. 口味偏好过滤（软性条件）
 *   4. 软条件命中为空时放开口味限制做兜底，避免用户拿到空白页
 */
const MAX_RESULTS = 3

/**
 * @param {Array} recipes 原始菜谱（驼峰字段）
 * @param {Object} request { servings, max_minutes, preference, allergy }
 * @returns {Array} 推荐结果
 */
export function recommendByRules(recipes, request) {
  const allergy = (request.allergy || '').trim()
  const preference = (request.preference || '').trim()
  const maxMinutes = Number(request.max_minutes)

  const timeOk = (r) => Number(r.minutes) <= maxMinutes
  const allergyOk = (r) => {
    if (!allergy) return true
    const searchable = [...(r.ingredients || []), ...(r.tags || [])].join(' ')
    return !searchable.includes(allergy)
  }
  const preferenceOk = (r) =>
    preference === '不限' || (r.tags || []).includes(preference)

  // 严格匹配
  const strict = recipes.filter((r) => timeOk(r) && allergyOk(r) && preferenceOk(r))
  if (strict.length) {
    return { recommendations: strict.slice(0, MAX_RESULTS), mode: 'rule-match' }
  }

  // 降级：放开口味限制，仅保留用时与忌口两个硬性条件
  const fallback = recipes.filter((r) => timeOk(r) && allergyOk(r))
  return { recommendations: fallback.slice(0, MAX_RESULTS), mode: 'rule-fallback' }
}

/** 结果去重（同一 recipeId 只保留第一次出现） */
export function dedupeRecipes(list) {
  const seen = new Set()
  return (list || []).filter((item) => {
    const key = item?.recipeId || item?.name
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * 统计严格匹配（不含降级兜底）的命中数量。
 * 用于空状态建议：需要知道「放宽某个条件后到底能严格命中几条」，
 * 而不是拿 recommendByRules 的降级结果去算——那个会放开口味限制，
 * 导致「口味改为不限」看上去没有任何增量。
 */
export function countStrictMatches(recipes, request) {
  const allergy = (request.allergy || '').trim()
  const preference = (request.preference || '').trim()
  const maxMinutes = Number(request.max_minutes)

  return (recipes || []).filter((r) => {
    if (Number(r.minutes) > maxMinutes) return false
    if (allergy) {
      const searchable = [...(r.ingredients || []), ...(r.tags || [])].join(' ')
      if (searchable.includes(allergy)) return false
    }
    if (preference !== '不限' && !(r.tags || []).includes(preference)) return false
    return true
  }).length
}
