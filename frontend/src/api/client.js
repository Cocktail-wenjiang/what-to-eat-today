/**
 * 统一接口客户端（两级降级策略）
 *
 * ┌── 主通道 ── FastAPI 后端              POST /api/recommend
 * └── 降级一层 ─ 本地种子菜谱 + 本地规则推荐
 *
 * 说明：
 *  - 后端是实验要求的「控制层-业务层-数据层」标准链路，优先使用；
 *  - 云端数据链路已整体迁移到 uniCloud（见 uni-app/），本 Web 端不再直连云端，
 *    改为「后端优先 + 本地种子兜底」；
 *  - 本地兜底保证后端未启动/断网时页面依然可用，不出现白屏。
 */
import { recommendByRules, dedupeRecipes } from './ruleEngine'

/** 后端地址：留空则用同源相对路径（开发时由 vite 代理到 127.0.0.1:8000） */
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

/** 本地种子菜谱地址（随前端一起发布，作为离线兜底数据源） */
const LOCAL_SEED_URL = `${import.meta.env.BASE_URL || '/'}data/recipes.json`

/** 请求超时（毫秒） */
const TIMEOUT_MS = 8000

/** 通道标识 -> 中文展示名 */
export const CHANNEL_LABEL = {
  backend: '后端服务',
  local: '本地兜底',
  offline: '离线演示',
}

/** 自定义错误类型，便于上层区分「网络不可用」与「业务校验失败」 */
export class ApiError extends Error {
  constructor(message, { type = 'unknown', status = 0, channel = '' } = {}) {
    super(message)
    this.name = 'ApiError'
    this.type = type // network | timeout | http | business | unknown
    this.status = status
    this.channel = channel
  }
}

/** 带超时的 fetch —— 避免后端假死时页面无限等待 */
async function fetchWithTimeout(url, options = {}, timeout = TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ApiError(`请求超时（${timeout}ms）`, { type: 'timeout' })
    }
    throw new ApiError('网络不可用', { type: 'network' })
  } finally {
    clearTimeout(timer)
  }
}

async function postJson(path, body) {
  const response = await fetchWithTimeout(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    // FastAPI 校验失败返回 { detail: [...] }，这里提取可读信息
    let message = `后端返回 ${response.status}`
    if (Array.isArray(payload?.detail) && payload.detail.length) {
      message = payload.detail
        .map((d) => `${(d.loc || []).slice(1).join('.') || '参数'}：${d.msg}`)
        .join('；')
    } else if (typeof payload?.detail === 'string') {
      message = payload.detail
    } else if (typeof payload?.error === 'string') {
      message = payload.error
    }
    throw new ApiError(message, {
      type: response.status === 422 ? 'business' : 'http',
      status: response.status,
      channel: 'backend',
    })
  }

  return payload
}

async function getJson(path) {
  const response = await fetchWithTimeout(`${API_BASE}${path}`)
  if (!response.ok) {
    throw new ApiError(`后端返回 ${response.status}`, {
      type: 'http',
      status: response.status,
      channel: 'backend',
    })
  }
  return response.json()
}

/** 历史记录字段归一化：数据库下划线风格 -> 前端驼峰风格 */
function normalizeHistoryRow(row) {
  return {
    id: row.id,
    servings: row.servings,
    maxMinutes: row.max_minutes,
    preference: row.preference,
    allergy: row.allergy,
    recommendations: Array.isArray(row.recommendations) ? row.recommendations : [],
    mode: row.mode || 'rule-fallback',
    createdAt: row.created_at,
  }
}

// ============ 通道 1：FastAPI 后端 ============

/** 后端健康检查，返回 { status, database, version } */
export async function checkBackendHealth() {
  return getJson('/health')
}

async function recommendViaBackend(request) {
  const payload = await postJson('/api/recommend', request)
  return {
    id: payload?.id ?? null,
    recommendations: dedupeRecipes(payload?.recommendations || []),
    mode: payload?.mode || 'rule-fallback',
    channel: 'backend',
  }
}

async function historyViaBackend() {
  const list = await getJson('/api/recommendations/history')
  return (list || []).map((row) =>
    normalizeHistoryRow({
      id: row.id,
      servings: row.servings,
      max_minutes: row.max_minutes,
      preference: row.preference,
      allergy: row.allergy,
      recommendations: row.recommendations,
      mode: row.mode,
      created_at: row.created_at,
    })
  )
}

// ============ 通道 2：本地种子菜谱 + 本地规则 ============

/** 菜谱缓存，避免每次兜底都重新读取全量种子数据 */
let recipeCache = null

/** 读取随前端一起发布的本地种子菜谱 */
async function loadLocalRecipes() {
  if (recipeCache?.length) return recipeCache
  const response = await fetchWithTimeout(LOCAL_SEED_URL)
  if (!response.ok) {
    throw new ApiError('本地菜谱数据加载失败', { type: 'network', channel: 'local' })
  }
  recipeCache = await response.json()
  return recipeCache
}

async function recommendViaLocal(request) {
  const recipes = await loadLocalRecipes()
  if (!recipes.length) {
    throw new ApiError('菜谱库为空，无法生成推荐', {
      type: 'business',
      channel: 'local',
    })
  }
  const { recommendations, mode } = recommendByRules(recipes, request)
  // 本地通道无持久化能力，id 返回 null（历史面板会提示「暂不可用」）
  return {
    id: null,
    recommendations: dedupeRecipes(recommendations),
    mode,
    channel: 'local',
  }
}

// ============ 对外统一接口 ============

/**
 * 获取推荐结果 —— 逐级降级，任一通道成功即返回。
 * 返回值额外携带 `degraded` 与 `channel`，供界面提示当前链路。
 */
export async function requestRecommendation(request) {
  const attempts = []

  // 1) FastAPI 后端
  try {
    const result = await recommendViaBackend(request)
    return { ...result, degraded: false, attempts }
  } catch (err) {
    attempts.push({ channel: 'backend', reason: err.message })
    console.warn('[channel] 后端不可用，尝试本地兜底：', err.message)
  }

  // 2) 本地种子菜谱 + 本地规则
  try {
    const result = await recommendViaLocal(request)
    return { ...result, degraded: true, attempts }
  } catch (err) {
    attempts.push({ channel: 'local', reason: err.message })
    console.warn('[channel] 本地兜底不可用：', err.message)
  }

  // 3) 全部失败
  throw new ApiError('所有推荐通道均不可用，请检查后端服务或网络连接', {
    type: 'network',
    channel: 'offline',
  })
}

/** 获取历史记录 —— 后端不可用时返回空数组而非抛错 */
export async function requestHistory(limit = 10) {
  try {
    const list = await historyViaBackend()
    return { list: list.slice(0, limit), channel: 'backend' }
  } catch (err) {
    console.warn('[history] 后端历史不可用：', err.message)
  }

  return { list: [], channel: 'offline' }
}

/** 清除菜谱缓存（用于「重新加载数据」按钮） */
export function clearRecipeCache() {
  recipeCache = null
}
