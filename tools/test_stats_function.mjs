/**
 * 云函数 stats（云端数据核对）契约测试
 *
 * 运行：node tools/test_stats_function.mjs
 *
 * 用 mock 驱动，不依赖真实云空间。mock 按 **服务端** 返回结构实现：
 *   count() -> { total }      get() -> { data }
 * （客户端结构是 { result: { total/data } }，两者不同，见项目记忆）
 *
 * 覆盖：
 *   - 110 条齐全：complete=true、首尾 _id、平均步骤数、存储状态
 *   - 分批取全量：>100 条时必须触发多次 get
 *   - 数据不足：complete=false、missing 正确
 *   - 空集合：不报错，count=0
 *   - 历史集合不存在：history.error 有值但不影响菜谱结果
 */
import { readFileSync } from 'node:fs'
import { UNI_APP_DB_IMPORT, cloudFunctionPath } from './uni_app_paths.mjs'

/** 云端导入文件即真实文档形态（含 _id） */
const CLOUD_DOCS = readFileSync(UNI_APP_DB_IMPORT, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => JSON.parse(l))

const SRC = readFileSync(cloudFunctionPath('stats'), 'utf8')

/** 用 mock uniCloud 载入云函数，返回 exports.main */
function loadMain() {
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', 'uniCloud', SRC)(
    mod,
    mod.exports,
    () => ({}),
    globalThis.uniCloud
  )
  return mod.exports.main
}

/** 构造 mock 存储 + uniCloud 全局 */
function installMock(recipes, { historyThrows = false, history = [] } = {}) {
  const store = { recipes, history, historyThrows, getCalls: 0, countCalls: 0 }
  globalThis.uniCloud = {
    database() {
      return {
        collection(name) {
          const state = { skip: 0, limit: 1000 }
          const rows = () => (name === 'recipes' ? store.recipes : store.history)
          const q = {
            skip(n) {
              state.skip = n
              return q
            },
            limit(n) {
              state.limit = n
              return q
            },
            async get() {
              store.getCalls++
              return { data: rows().slice(state.skip, state.skip + state.limit) }
            },
            async count() {
              store.countCalls++
              if (name === 'recommendation_history' && store.historyThrows) {
                throw new Error('集合不存在')
              }
              return { total: rows().length }
            }
          }
          return q
        }
      }
    }
  }
  return store
}

let fail = 0
const ok = (cond, label, extra = '') => {
  if (!cond) {
    fail++
    console.log('  ✗ ' + label + (extra ? '  ' + extra : ''))
  } else {
    console.log('  ✓ ' + label)
  }
}

// ---------- 用例 1：110 条齐全 ----------
console.log('== 用例 1：云端已导入 110 条 ==')
{
  // 附带 5 条历史记录，用于验证「存储用量 = 菜谱 + 历史」
  const history = Array.from({ length: 5 }, (_, i) => ({
    _id: 'h-' + i,
    servings: 2,
    max_minutes: 30,
    preference: '清淡',
    recommendations: [{ recipeId: 'R-002', name: '凉拌黄瓜' }],
    created_at: Date.now()
  }))
  const store = installMock(CLOUD_DOCS, { history })
  const main = loadMain()
  const r = await main({ expected: 110 })

  ok(r.ok === true, '返回 ok=true')
  ok(r.recipes.count === 110, 'count = 110', 'got=' + r.recipes.count)
  ok(r.recipes.complete === true, 'complete = true')
  ok(r.recipes.missing === 0, 'missing = 0')
  ok(r.recipes.firstId === 'R-001', 'firstId = R-001', 'got=' + r.recipes.firstId)
  ok(r.recipes.lastId === 'R-110', 'lastId = R-110', 'got=' + r.recipes.lastId)
  ok(r.recipes.avgSteps >= 4, '平均步骤数 ≥ 4', 'got=' + r.recipes.avgSteps)
  ok(r.recipes.avgIngredients >= 2, '平均食材数 ≥ 2', 'got=' + r.recipes.avgIngredients)
  ok(r.recipes.jsonBytes > 0, '实测 JSON 字节 > 0', 'got=' + r.recipes.jsonBytes)
  ok(store.getCalls > 1, '>100 条触发分批取全量', 'getCalls=' + store.getCalls)
  ok(r.storage.usedBytes > r.recipes.estimatedBytes, '存储用量含菜谱+历史')
  ok(r.history.count === 5, 'history.count = 5', 'got=' + r.history.count)
  ok(r.history.estimatedBytes > 0, 'history 估算字节 > 0')
  ok(r.storage.level === 'ok', '存储状态 ok', 'got=' + r.storage.level)
  ok(r.storage.exceeded === false, '未超 3/4 阈值')
  ok(r.storage.percent < 75, '使用率 < 75%', 'got=' + r.storage.percent + '%')
  ok(r.storage.quotaGb === 2, '配额 2 GB')
  ok(r.storage.thresholdPercent === 75, '阈值 75%')
  ok(!!r.checkedAt, '带核对时间戳')
}

// ---------- 用例 2：只导入了 73 条（旧数据） ----------
console.log('\n== 用例 2：云端仍是旧的 73 条 ==')
{
  installMock(CLOUD_DOCS.slice(0, 73))
  const main = loadMain()
  const r = await main({ expected: 110 })
  ok(r.recipes.count === 73, 'count = 73', 'got=' + r.recipes.count)
  ok(r.recipes.complete === false, 'complete = false')
  ok(r.recipes.missing === 37, 'missing = 37', 'got=' + r.recipes.missing)
  ok(r.recipes.lastId === 'R-073', 'lastId = R-073', 'got=' + r.recipes.lastId)
}

// ---------- 用例 3：空集合 ----------
console.log('\n== 用例 3：集合为空（未导入） ==')
{
  installMock([])
  const main = loadMain()
  const r = await main({ expected: 110 })
  ok(r.ok === true, '不抛错，仍返回 ok=true')
  ok(r.recipes.count === 0, 'count = 0')
  ok(r.recipes.complete === false, 'complete = false')
  ok(r.recipes.missing === 110, 'missing = 110', 'got=' + r.recipes.missing)
  ok(r.recipes.avgSteps === 0, 'avgSteps = 0（不除零）')
  ok(r.recipes.firstId === null && r.recipes.lastId === null, '首尾 _id 为 null')
}

// ---------- 用例 4：历史集合不存在 ----------
console.log('\n== 用例 4：历史集合不存在（容错） ==')
{
  installMock(CLOUD_DOCS, { historyThrows: true })
  const main = loadMain()
  const r = await main({ expected: 110 })
  ok(r.recipes.count === 110, '菜谱结果不受影响')
  ok(!!r.history.error, 'history.error 记录了原因', 'got=' + r.history.error)
  ok(r.history.count === 0, 'history.count = 0')
}

// ---------- 用例 5：默认参数 ----------
console.log('\n== 用例 5：不传参时默认 expected=110 ==')
{
  installMock(CLOUD_DOCS)
  const main = loadMain()
  const r = await main()
  ok(r.recipes.expected === 110, 'expected 默认 110', 'got=' + r.recipes.expected)
  ok(r.recipes.complete === true, 'complete = true')
}

console.log('\n' + (fail ? '❌ ' + fail + ' 项失败' : '🎉 stats 云函数契约全部通过'))
process.exit(fail ? 1 : 0)
