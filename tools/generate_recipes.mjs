/**
 * 校验数据集并生成数据文件
 *
 * 运行：node tools/generate_recipes.mjs
 *
 * 输出：
 *   1. frontend/public/data/recipes.json（Web 前端离线兜底）
 *   2. data/recipes.json（后端 / 脚本数据源）
 *   3. <uni-app 工程>/static/data/recipes.json（uni-app 离线兜底）
 *   4. <uni-app 工程>/uniCloud-aliyun/database/recipes.json（uniCloud 控制台「导入」用，_id 为 R-001）
 *
 * uni-app 工程位置由 `tools/uni_app_paths.mjs` 统一解析（已迁出仓库，见该文件说明）。
 *
 * 校验项：
 *   - recipe_id 唯一且连续
 *   - 每条至少命中一个核心口味（清淡/高蛋白/素食/快捷）
 *   - minutes 为正整数
 *   - ingredients / steps 非空
 *   - 打印口味 × 用时矩阵，确认组合不会出现「选了口味必定空态」
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import buildRecipes, { CORE_PREFERENCES, isMeatIngredient } from './recipes_dataset.mjs'
import { estimateCollectionBytes, evaluateUsage, humanBytes } from './cloud_storage_quota.mjs'
import { UNI_APP_DIR, UNI_APP_SEED, UNI_APP_DB_IMPORT } from './uni_app_paths.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

/** 展示用路径：仓库内的显示相对路径，仓库外（uni-app 独立工程）显示绝对路径 */
const show = (p) => (p.startsWith(ROOT) ? p.replace(ROOT, '.') : p)

const recipes = buildRecipes()

// ---------- 1. 校验 ----------
const errors = []
const seenIds = new Set()

recipes.forEach((r, i) => {
  const where = `[${i}] ${r.recipeId} ${r.name}`
  if (seenIds.has(r.recipeId)) errors.push(`${where}: recipe_id 重复`)
  seenIds.add(r.recipeId)

  const expectedId = 'R-' + String(i + 1).padStart(3, '0')
  if (r.recipeId !== expectedId) errors.push(`${where}: recipe_id 不连续，应为 ${expectedId}`)

  if (!Number.isInteger(r.minutes) || r.minutes <= 0) errors.push(`${where}: minutes 非法 = ${r.minutes}`)
  if (!r.ingredients.length) errors.push(`${where}: ingredients 为空`)
  if (!r.steps.length) errors.push(`${where}: steps 为空`)
  if (!r.tags.length) errors.push(`${where}: tags 为空`)

  const hitsCore = CORE_PREFERENCES.some((p) => r.tags.includes(p))
  if (!hitsCore) errors.push(`${where}: 未命中任何核心口味 tags=${r.tags.join('/')}`)

  // 素食标签与食材必须自洽（防止荤菜被误标素食）
  if (r.tags.includes('素食')) {
    const meat = r.ingredients.filter((i) => i !== '鸡蛋' && isMeatIngredient(i))
    if (meat.length) errors.push(`${where}: 标为素食但含荤食材 = ${meat.join(',')}`)
  }
  // 高蛋白标签与食材必须自洽
  if (r.tags.includes('高蛋白')) {
    const protein = r.ingredients.some((i) => i === '鸡蛋' || isMeatIngredient(i))
    if (!protein) errors.push(`${where}: 标为高蛋白但无肉蛋食材`)
  }

  // 制作过程必须足够详细：至少 4 步，且平均每步不少于 12 字
  if (r.steps.length < 4) errors.push(`${where}: 步骤过少（${r.steps.length} 步），详细制作过程要求 ≥4 步`)
  const avgLen = r.steps.join('').length / r.steps.length
  if (avgLen < 12) errors.push(`${where}: 步骤过于简略（平均 ${avgLen.toFixed(1)} 字/步），要求 ≥12 字/步`)
})

if (errors.length) {
  console.error('❌ 数据校验未通过：')
  errors.forEach((e) => console.error('   - ' + e))
  process.exit(1)
}

// ---------- 2. 口味 × 用时矩阵 ----------
const MINUTE_BUCKETS = [...new Set(recipes.map((r) => r.minutes))].sort((a, b) => a - b)
console.log(`✅ 校验通过：共 ${recipes.length} 道菜谱\n`)
console.log('口味 × 最大用时 命中数矩阵（行=口味，列=用时上限）：')
const header = ['口味'.padEnd(6), ...MINUTE_BUCKETS.map((m) => String(m).padStart(4))].join(' ')
console.log(header)
console.log('-'.repeat(header.length))
for (const pref of [...CORE_PREFERENCES, '不限']) {
  const cells = MINUTE_BUCKETS.map((maxM) => {
    const n = recipes.filter(
      (r) => r.minutes <= maxM && (pref === '不限' || r.tags.includes(pref))
    ).length
    return String(n).padStart(4)
  })
  console.log([pref.padEnd(6), ...cells].join(' '))
}

// 合规性：每个口味在「最大用时」这一维度上至少要有一个可选项
const deadCells = []
for (const pref of CORE_PREFERENCES) {
  const reachable = MINUTE_BUCKETS.some((maxM) => recipes.some((r) => r.minutes <= maxM && r.tags.includes(pref)))
  if (!reachable) deadCells.push(pref)
}
if (deadCells.length) {
  console.error(`\n❌ 以下口味在任何用时下都无命中：${deadCells.join('、')}`)
  process.exit(1)
}

// ---------- 2b. 存储用量闸门：写入前先估算，不超过配额 3/4 ----------
// uniCloud 控制台导入用的文档形态（_id 显式指定）
const cloudDocs = recipes.map((r) => ({
  _id: r.recipeId,
  name: r.name,
  ingredients: r.ingredients,
  steps: r.steps,
  minutes: r.minutes,
  tags: r.tags,
  source: 'db',
}))
const storage = evaluateUsage(estimateCollectionBytes(cloudDocs).total)
console.log(
  `\n💾 云端存储估算：${humanBytes(storage.usedBytes)} / ${storage.quotaGb} GB` +
    `（${storage.percent.toFixed(4)}%，阈值 ${(storage.threshold * 100).toFixed(0)}%）`
)
if (storage.exceeded) {
  console.error(
    `\n🛑 预计占用 ${humanBytes(storage.usedBytes)} 已超过配额的 3/4` +
      `（${humanBytes(storage.thresholdBytes)}），已中止写入。`
  )
  console.error('   请精简菜谱数据，或升级 uniCloud 套餐后重试。')
  process.exit(1)
}

// ---------- 3. 生成 JSON（驼峰） ----------
const json = JSON.stringify(recipes, null, 2) + '\n'
const jsonPaths = [
  resolve(ROOT, 'frontend/public/data/recipes.json'),
  resolve(ROOT, 'data/recipes.json'),
  // uniCloud：静态目录供离线兜底读取，数据库目录供控制台「导入」使用
  UNI_APP_SEED,
]
for (const p of jsonPaths) {
  writeFileSync(p, json, 'utf8')
  console.log(`\n📝 已写入 ${show(p)}（${recipes.length} 条）`)
}

// ---------- 3b. uniCloud 数据库导入文件（JSON Lines，_id 显式指定） ----------
// uniCloud 控制台「导入」接受 JSON Lines（每行一个 JSON 对象）或 CSV。
// 这里显式写入 _id = R-001，便于与 Web 端 recipeId 对齐、重复导入幂等。
const lines = cloudDocs.map((doc) => JSON.stringify(doc))
writeFileSync(UNI_APP_DB_IMPORT, lines.join('\n') + '\n', 'utf8')
console.log(
  `📝 已写入 ${show(UNI_APP_DB_IMPORT)}（${recipes.length} 行 JSON Lines，_id = R-001 形式）`
)

// ---------- 4. 汇总 ----------
console.log('\n🎉 数据源已同步完成：')
console.log('   · frontend/public/data/recipes.json（Web 前端离线兜底）')
console.log('   · data/recipes.json（后端 / 脚本数据源）')
console.log(`   · ${show(UNI_APP_SEED)}（uni-app 离线兜底）`)
console.log(`   · ${show(UNI_APP_DB_IMPORT)}（uniCloud 控制台导入）`)
console.log(`   （uni-app 工程目录：${UNI_APP_DIR}）`)
