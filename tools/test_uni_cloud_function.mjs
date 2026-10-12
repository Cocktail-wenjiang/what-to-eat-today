/**
 * 云函数 recommend 契约测试（用 mock uniCloud 驱动，不依赖真实云空间）
 *
 * 运行：node tools/test_uni_cloud_function.mjs
 *
 * 覆盖：
 *   - 参数校验：servings / max_minutes / preference / allergy 边界
 *   - 正常链路：筛选正确、mode=recommend-cloud、历史落库、字段契约
 *   - 降级链路：口味无命中 → rule-fallback，且仍守住用时/忌口
 *   - 排序稳定性：结果按用时升序
 *   - 分批取全量：菜谱数 > 100 时仍能取到尾部数据
 *   - 容错：历史写入失败不影响推荐结果
 *
 * ⚠️ 关键：uniCloud「云函数端（服务端）」与「客户端」API 返回结构不同——
 *   - 服务端：await coll.count()  → { total }        （直接取 .total）
 *            await coll.get()    → { data: [...] }  （直接取 .data）
 *            await coll.add(doc) → { id }            （直接取 .id）
 *   - 客户端（uniCloud.database() 在页面里）：结果统一包一层 .result
 *   云函数按「服务端」结构编写，因此本 mock 也必须按服务端结构返回。
 */
import { readFileSync } from 'node:fs'
import { UNI_APP_SEED, cloudFunctionPath } from './uni_app_paths.mjs'

const seed = JSON.parse(readFileSync(UNI_APP_SEED, 'utf8'))

/** 内存数据库：每行带一个不可枚举的 _coll 标记所属集合 */
function createStore() {
  const rows = []
  const coll = { recipes: [], recommendation_history: [] }
  return { rows, coll }
}

function makeQuery(store, name) {
  const state = { skip: 0, limit: 1000, orderField: null, orderDir: 'asc' }
  const rows = () => store.coll[name] || []
  const q = {
    skip(n) {
      state.skip = n
      return q
    },
    limit(n) {
      state.limit = n
      return q
    },
    orderBy(f, d) {
      state.orderField = f
      state.orderDir = d
      return q
    },
    // 服务端：resolve 为 { data: [...] }
    async get() {
      let list = [...rows()]
      if (state.orderField) {
        const f = state.orderField
        const sign = state.orderDir === 'desc' ? -1 : 1
        list.sort((a, b) => (a[f] > b[f] ? sign : a[f] < b[f] ? -sign : 0))
      }
      return { data: list.slice(state.skip, state.skip + state.limit) }
    },
    // 服务端：resolve 为 { total }
    async count() {
      return { total: rows().length }
    },
    // 服务端：resolve 为 { id }
    async add(doc) {
      const _id = `hist-${store.coll[name].length + 1}`
      store.coll[name].push({ _id, ...doc })
      return { id: _id }
    }
  }
  return q
}

/** 造一个只暴露 database() 的 uniCloud mock */
function createUniCloud(store, { failHistory = false } = {}) {
  return {
    database() {
      return {
        collection(name) {
          if (name === 'recommendation_history' && failHistory) {
            return {
              add() {
                throw new Error('模拟写库失败')
              }
            }
          }
          return makeQuery(store, name)
        }
      }
    }
  }
}

/** 每次调用重建一份数据库，避免用例互相污染 */
function freshStore() {
  const store = createStore()
  store.coll.recipes = seed.map((r) => ({
    _id: r.recipeId,
    name: r.name,
    ingredients: r.ingredients,
    steps: r.steps,
    minutes: r.minutes,
    tags: r.tags,
    source: 'db'
  }))
  store.coll.recommendation_history = []
  return store
}

/** 载入云函数源码并注入 mock uniCloud */
function loadCloudFunction(uniCloudMock) {
  const src = readFileSync(cloudFunctionPath('recommend'), 'utf8')
  const mod = { exports: {} }
  // eslint-disable-next-line no-new-func
  const fn = new Function('module', 'exports', 'require', 'uniCloud', src)
  fn(mod, mod.exports, () => ({}), uniCloudMock)
  return mod.exports.main
}

let fail = 0
const ok = (cond, label, extra = '') => {
  if (!cond) {
    fail++
    console.log(`  ✗ ${label} ${extra}`)
  } else {
    console.log(`  ✓ ${label}${extra ? '  ' + extra : ''}`)
  }
}

// ---------- 1. 参数校验 ----------
console.log('== 参数校验（与前端校验器边界一致）==')
{
  const main = loadCloudFunction(createUniCloud(freshStore()))
  const cases = [
    [{ servings: 0, max_minutes: 30, preference: '清淡', allergy: '' }, 'servings', 'servings=0'],
    [{ servings: 21, max_minutes: 30, preference: '清淡', allergy: '' }, 'servings', 'servings=21'],
    [{ servings: 2.5, max_minutes: 30, preference: '清淡', allergy: '' }, 'servings', 'servings=2.5'],
    [{ servings: 2, max_minutes: 4, preference: '清淡', allergy: '' }, 'max_minutes', 'max_minutes=4'],
    [{ servings: 2, max_minutes: 241, preference: '清淡', allergy: '' }, 'max_minutes', 'max_minutes=241'],
    [{ servings: 2, max_minutes: 30, preference: '', allergy: '' }, 'preference', '空口味'],
    [{ servings: 2, max_minutes: 30, preference: 'x'.repeat(31), allergy: '' }, 'preference', '口味 31 字'],
    [
      { servings: 2, max_minutes: 30, preference: '清淡', allergy: 'x'.repeat(31) },
      'allergy',
      '忌口 31 字'
    ]
  ]
  for (const [event, field, label] of cases) {
    const r = await main(event)
    ok(
      r.error && (r.details || []).some((d) => d.field === field),
      `拒绝 ${label}`,
      r.error ? '' : '（未返回 error）'
    )
  }
  // 边界内应通过
  for (const [event, label] of [
    [{ servings: 1, max_minutes: 5, preference: '清淡', allergy: '' }, 'servings=1, min=5'],
    [{ servings: 20, max_minutes: 240, preference: '不限', allergy: '' }, 'servings=20, min=240'],
    [{ servings: 2, max_minutes: 30, preference: '清淡', allergy: 'x'.repeat(30) }, '忌口 30 字']
  ]) {
    const r = await main(event)
    ok(!r.error, `接受 ${label}`)
  }
}

// ---------- 2. 正常链路 ----------
console.log('\n== 正常链路（严格匹配）==')
{
  const store = freshStore()
  const main = loadCloudFunction(createUniCloud(store))
  const r = await main({ servings: 2, max_minutes: 30, preference: '清淡', allergy: '' })

  ok(Array.isArray(r.recommendations), 'recommendations 是数组')
  ok(
    r.recommendations.length > 0 && r.recommendations.length <= 3,
    '返回 1~3 条',
    `n=${r.recommendations.length}`
  )
  ok(
    r.recommendations.every((x) => x.minutes <= 30),
    '用时上限为硬性条件',
    JSON.stringify(r.recommendations.map((x) => x.minutes))
  )
  ok(
    r.recommendations.every((x) => x.tags.includes('清淡')),
    '结果均含「清淡」标签'
  )
  ok(r.mode === 'recommend-cloud', 'mode=recommend-cloud', r.mode)
  ok(r.database === 'uniCloud-aliyun', 'database 标识正确', r.database)
  ok(
    r.recommendations.every(
      (x) => typeof x.recipeId === 'string' && /^R-\d{3}$/.test(x.recipeId)
    ),
    'recipeId 为 R-xxx 字符串',
    JSON.stringify(r.recommendations.map((x) => x.recipeId))
  )
  ok(
    r.recommendations.every((x) => Array.isArray(x.steps) && x.steps.length >= 4),
    '每条都带详细步骤（≥4 步）'
  )
  ok(
    r.recommendations.every((x) => !('_id' in x)),
    '不外泄数据库 _id 原始字段'
  )
  ok(
    r.recommendations.every((x) => x.source === 'db'),
    'source=db'
  )

  // 历史落库
  ok(store.coll.recommendation_history.length === 1, '历史写入 1 条')
  const h = store.coll.recommendation_history[0]
  ok(typeof h.created_at === 'number' && h.created_at > 0, 'created_at 为毫秒时间戳')
  ok(h.servings === 2 && h.max_minutes === 30, '历史记录人数/用时正确')
  ok(h.preference === '清淡' && h.allergy === '', '历史记录口味/忌口正确')
  ok(
    Array.isArray(h.recommendations) && h.recommendations.length === r.recommendations.length,
    '历史快照含当次推荐结果'
  )
  ok(h.mode === 'recommend-cloud', '历史记录 mode 正确')
  ok(r.id === h._id, '返回的 id 与历史记录 _id 一致', `${r.id}`)
}

// ---------- 3. 忌口为硬性排除 ----------
console.log('\n== 忌口过滤 ==')
{
  const store = freshStore()
  const main = loadCloudFunction(createUniCloud(store))
  const r = await main({ servings: 2, max_minutes: 60, preference: '不限', allergy: '鸡蛋' })
  ok(
    r.recommendations.every(
      (x) => ![...x.ingredients, ...x.tags].join(' ').includes('鸡蛋')
    ),
    '忌口「鸡蛋」被排除',
    JSON.stringify(r.recommendations.map((x) => x.name))
  )
}

// ---------- 4. 降级链路 ----------
console.log('\n== 降级链路（口味无命中）==')
{
  const store = freshStore()
  const main = loadCloudFunction(createUniCloud(store))
  const r = await main({ servings: 2, max_minutes: 5, preference: '高蛋白', allergy: '鸡蛋' })
  ok(r.mode === 'rule-fallback', '口味无命中 → rule-fallback', r.mode)
  ok(r.recommendations.length > 0, '降级后仍有结果', `n=${r.recommendations.length}`)
  ok(
    r.recommendations.every((x) => x.minutes <= 5),
    '降级后仍守住用时上限'
  )
  ok(
    r.recommendations.every((x) => ![...x.ingredients, ...x.tags].join(' ').includes('鸡蛋')),
    '降级后仍守住忌口'
  )
  ok(
    store.coll.recommendation_history[0].mode === 'rule-fallback',
    '降级模式也写入历史'
  )
}

// ---------- 5. 排序稳定性 ----------
console.log('\n== 排序稳定性 ==')
{
  const main = loadCloudFunction(createUniCloud(freshStore()))
  for (const pref of ['清淡', '高蛋白', '素食', '快捷', '不限']) {
    const r = await main({ servings: 2, max_minutes: 60, preference: pref, allergy: '' })
    const mins = r.recommendations.map((x) => x.minutes)
    ok(
      mins.every((m, i) => i === 0 || mins[i - 1] <= m),
      `${pref} 结果按用时升序`,
      JSON.stringify(mins)
    )
  }
}

// ---------- 6. 菜谱数量 > 100 时分批取全量 ----------
console.log('\n== 分批取全量（模拟 250 条，验证 skip/limit 循环）==')
{
  const store = createStore()
  // 造 250 条，只有最后 3 条符合「用时 60 且标签 unique-tail」
  store.coll.recipes = []
  for (let i = 0; i < 247; i++) {
    store.coll.recipes.push({
      _id: `X-${String(i + 1).padStart(3, '0')}`,
      name: `填充菜 ${i + 1}`,
      ingredients: ['盐'],
      steps: ['步骤一', '步骤二', '步骤三', '步骤四'],
      minutes: 60,
      tags: ['清淡'],
      source: 'db'
    })
  }
  for (let i = 0; i < 3; i++) {
    store.coll.recipes.push({
      _id: `T-${String(i + 1).padStart(3, '0')}`,
      name: `尾部菜 ${i + 1}`,
      ingredients: ['盐'],
      steps: ['步骤一', '步骤二', '步骤三', '步骤四'],
      minutes: 60,
      tags: ['高蛋白'],
      source: 'db'
    })
  }
  store.coll.recommendation_history = []

  const main = loadCloudFunction(createUniCloud(store))
  const r = await main({ servings: 2, max_minutes: 60, preference: '高蛋白', allergy: '' })
  const ids = r.recommendations.map((x) => x.recipeId)
  ok(
    ids.every((id) => id.startsWith('T-')),
    '第 100 条之后的菜谱也被取到（分批生效）',
    JSON.stringify(ids)
  )
  ok(r.recommendations.length === 3, '尾部 3 条全部命中', `n=${r.recommendations.length}`)
}

// ---------- 7. 容错 ----------
console.log('\n== 容错：历史写入失败不影响推荐 ==')
{
  const store = freshStore()
  const main = loadCloudFunction(createUniCloud(store, { failHistory: true }))
  const r = await main({ servings: 2, max_minutes: 30, preference: '清淡', allergy: '' })
  ok(!r.error, '推荐未因写历史失败而报错')
  ok(Array.isArray(r.recommendations) && r.recommendations.length > 0, '推荐结果正常返回')
  ok(r.id === null, '写历史失败时 id 为 null')
  ok(r.mode === 'recommend-cloud', 'mode 不受影响')
}

console.log('\n' + (fail ? `❌ ${fail} 项失败` : '🎉 云函数契约全部通过'))
process.exit(fail ? 1 : 0)
