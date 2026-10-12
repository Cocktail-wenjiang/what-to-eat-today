/**
 * 通用格式化工具
 */

/** 把 2026-10-09T08:12:33Z 这类时间格式化为「今天 16:12 / 10-08 09:30」 */
export function formatTime(input) {
  if (!input) return '--'
  // SQLite CURRENT_TIMESTAMP 是 UTC 且无时区标记，补上 Z 才能正确解析
  const normalized =
    typeof input === 'string' && !input.includes('T')
      ? input.replace(' ', 'T') + 'Z'
      : input
  const date = new Date(normalized)
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

/** 推荐模式 -> 中文标签 */
export const MODE_LABEL = {
  'rule-match': '规则精确匹配',
  'rule-fallback': '规则放宽匹配',
  ai: 'AI 模型推荐',
  cloud: '云端推荐',
  'local-fallback': '本地降级推荐',
}

export function modeLabel(mode) {
  return MODE_LABEL[mode] || mode || '未知模式'
}
