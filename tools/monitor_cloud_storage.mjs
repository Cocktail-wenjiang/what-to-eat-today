/**
 * uniCloud 云端存储用量监控
 *
 * 用法：
 *   node tools/monitor_cloud_storage.mjs                 # 单次检测
 *   node tools/monitor_cloud_storage.mjs --watch 5       # 每 5 秒刷新（实时监控）
 *   node tools/monitor_cloud_storage.mjs --json          # 输出 JSON（便于脚本/自动化消费）
 *   node tools/monitor_cloud_storage.mjs --history 2000  # 附带估算历史集合（2000 条）
 *   node tools/monitor_cloud_storage.mjs --fail-on-warn  # 超阈值时以非 0 退出码结束
 *
 * 说明：
 *   本脚本统计的是**项目侧数据文件的真实字节数**，再按 BSON 开销折算成
 *   云数据库占用估算值，并与 uniCloud 免费版配额（云数据库 2 GB）比对。
 *   真实占用以 uniCloud 控制台「资源用量监控」为准；本脚本偏保守（高估），
 *   用于在真正触顶前提前预警，阈值固定为 3/4（75%）。
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  DATABASE_QUOTA_GB,
  STORAGE_QUOTA_GB,
  MAX_COLLECTIONS,
  THRESHOLD,
  HISTORY_DOC_BYTES,
  estimateCollectionBytes,
  estimateByCount,
  evaluateUsage,
  humanBytes,
  renderBar,
} from './cloud_storage_quota.mjs'
import { UNI_APP_DB_DIR, UNI_APP_DB_IMPORT } from './uni_app_paths.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

// ---------- 参数解析 ----------
const argv = process.argv.slice(2)
function argValue(flag, fallback = null) {
  const i = argv.indexOf(flag)
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback
}
const WATCH_SECONDS = Number(argValue('--watch', 0)) || 0
const JSON_OUT = argv.includes('--json')
const FAIL_ON_WARN = argv.includes('--fail-on-warn')
const HISTORY_COUNT = Number(argValue('--history', 0)) || 0

/** 读取 uniCloud 控制台导入用的 JSON Lines 文件 */
function readCloudDocs() {
  const p = UNI_APP_DB_IMPORT
  if (!existsSync(p)) return { docs: [], path: p, exists: false }
  const text = readFileSync(p, 'utf8')
  const docs = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l))
  return { docs, path: p, exists: true }
}

/** 统计 uniCloud 数据库目录下的集合数量（= *.schema.json 个数） */
function countCollections() {
  const dir = UNI_APP_DB_DIR
  if (!existsSync(dir)) return 0
  return readdirSync(dir).filter((f) => f.endsWith('.schema.json')).length
}

/** 采集一次快照 */
function snapshot() {
  const { docs, path, exists } = readCloudDocs()
  const recipes = estimateCollectionBytes(docs)

  const history = HISTORY_COUNT > 0 ? estimateByCount(HISTORY_COUNT) : null
  const usedBytes = recipes.total + (history?.total || 0)

  const usage = evaluateUsage(usedBytes, DATABASE_QUOTA_GB)
  const fileBytes = exists ? statSync(path).size : 0

  return {
    timestamp: new Date().toISOString(),
    source: path.replace(ROOT, '.'),
    recipes: { ...recipes, fileBytes },
    history,
    usage,
    collections: { used: countCollections(), max: MAX_COLLECTIONS },
    quotas: {
      databaseGb: DATABASE_QUOTA_GB,
      storageGb: STORAGE_QUOTA_GB,
      threshold: THRESHOLD,
    },
  }
}

/** 渲染文本报告 */
function renderText(s) {
  const { usage, recipes, history } = s
  const levelText = { ok: '✅ 正常', warn: '⚠️  偏高', danger: '🛑 超阈值' }[usage.level]
  const lines = []
  lines.push('════════ uniCloud 云端存储用量监控 ════════')
  lines.push(`采样时间：${new Date(s.timestamp).toLocaleString('zh-CN')}`)
  lines.push(`数据来源：${s.source}`)
  lines.push('')
  lines.push('【云数据库】')
  lines.push(
    `  菜谱集合  ${String(recipes.count).padStart(4)} 条` +
      `  JSON ${humanBytes(recipes.raw)}` +
      `  → 估算占用 ${humanBytes(recipes.total)}` +
      `（含索引 ${humanBytes(recipes.indexBytes)}）`
  )
  if (history) {
    lines.push(
      `  历史集合  ${String(history.count).padStart(4)} 条` +
        `  → 估算占用 ${humanBytes(history.total)}（按每条 ${humanBytes(HISTORY_DOC_BYTES)} 估算）`
    )
  } else {
    lines.push('  历史集合  （未计入，可用 --history <条数> 估算）')
  }
  lines.push('')
  lines.push(
    `  已用 ${humanBytes(usage.usedBytes)} / 配额 ${usage.quotaGb} GB` +
      `  使用率 ${usage.percent.toFixed(4)}%`
  )
  lines.push(
    `  ${renderBar(usage.ratio)}  ${(usage.ratio * 100).toFixed(2)}%` +
      `  （| 为 75% 阈值线）`
  )
  lines.push(`  状态：${levelText}`)
  lines.push(
    `  距阈值还剩可写空间：${humanBytes(usage.remainingBytes)}` +
      `（阈值 ${humanBytes(usage.thresholdBytes)}）`
  )
  lines.push('')
  lines.push(
    `【集合数量】${s.collections.used} / ${s.collections.max}` +
      `　【云存储】未使用（配额 ${s.quotas.storageGb} GB）`
  )
  if (usage.exceeded) {
    lines.push('')
    lines.push(`🛑 已超过 3/4 阈值（${(THRESHOLD * 100).toFixed(0)}%），请勿继续导入数据。`)
  }
  return lines.join('\n')
}

// ---------- 主流程 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (WATCH_SECONDS > 0) {
  process.stdout.write('\x1b[2J\x1b[H')
  let lastLevel = null
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const s = snapshot()
    if (!JSON_OUT) {
      process.stdout.write('\x1b[2J\x1b[H')
      process.stdout.write(renderText(s) + '\n')
      process.stdout.write(`\n（每 ${WATCH_SECONDS}s 刷新一次，Ctrl+C 退出）\n`)
    } else {
      process.stdout.write(JSON.stringify(s) + '\n')
    }
    if (s.usage.level === 'danger' && lastLevel !== 'danger') {
      process.stdout.write('\x07') // 蜂鸣提示
    }
    lastLevel = s.usage.level
    await sleep(WATCH_SECONDS * 1000)
  }
} else {
  const s = snapshot()
  if (JSON_OUT) {
    process.stdout.write(JSON.stringify(s, null, 2) + '\n')
  } else {
    process.stdout.write(renderText(s) + '\n')
  }
  if (FAIL_ON_WARN && s.usage.exceeded) process.exit(1)
}
