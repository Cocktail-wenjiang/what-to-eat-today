/**
 * uniCloud 存储配额与用量估算（单一事实来源）
 *
 * 配额来源：DCloud 官方价格页 https://doc.dcloud.net.cn/uniCloud/price.html
 *   阿里云「免费服务空间（开发者版）」额度：
 *     · 云数据库 容量  2 GB      ← 本项目菜谱/历史所在，是唯一需要盯的指标
 *     · 云存储   容量  5 GB      ← 本项目未使用（无文件上传）
 *     · 出网流量       1 GB/月
 *     · 集合数量上限   100 个
 *
 * ⚠️ 口径说明：
 *   1. 官方按「GB·天」结算，日容量取当日峰值。本项目数据只增不减，
 *      所以「当前容量」就是峰值容量，按静态值估算即可。
 *   2. 本模块算的是**估算值**：真实占用以 uniCloud 控制台
 *      「服务空间 → 资源用量监控」显示为准。估算偏保守（略微高估），
 *      以便在真正触顶前就报警。
 *   3. 阈值固定为 3/4（75%），超过即告警并由生成器阻断写入。
 */

/** 单位换算 */
export const BYTES_PER_GB = 1024 ** 3

/** 云数据库容量（GB）—— 阿里云免费版 */
export const DATABASE_QUOTA_GB = 2

/** 云存储容量（GB）—— 阿里云免费版，本项目未使用 */
export const STORAGE_QUOTA_GB = 5

/** 单服务空间集合数量上限 */
export const MAX_COLLECTIONS = 100

/** 告警 / 阻断阈值：不超过 3/4 */
export const THRESHOLD = 0.75

/**
 * BSON 相对纯 JSON 的体积系数。
 * uniCloud 底层为文档型存储，除字段内容外还有类型标记、长度前缀等开销，
 * 实测通常在 5%~10% 之间，这里取 8% 作为保守估计。
 */
export const BSON_OVERHEAD = 1.08

/** 每个文档的索引开销（字节）。_id 索引 + 少量字段索引的保守摊销值。 */
export const INDEX_BYTES_PER_DOC = 40

/** 推荐历史单条记录的典型字节数（含 3 条推荐结果快照） */
export const HISTORY_DOC_BYTES = 900

/**
 * 估算一个集合的占用字节数
 * @param {Array<object>} docs 文档数组（原始对象，非 JSON 字符串）
 * @returns {{raw:number, docsBytes:number, indexBytes:number, total:number, count:number}}
 */
export function estimateCollectionBytes(docs) {
  const raw = docs.reduce(
    (sum, d) => sum + Buffer.byteLength(JSON.stringify(d), 'utf8'),
    0
  )
  const docsBytes = Math.round(raw * BSON_OVERHEAD)
  const indexBytes = docs.length * INDEX_BYTES_PER_DOC
  return {
    count: docs.length,
    raw,
    docsBytes,
    indexBytes,
    total: docsBytes + indexBytes,
  }
}

/**
 * 按「条数 × 单条典型大小」估算集合占用（用于运行时不断增长的历史集合）
 */
export function estimateByCount(count, bytesPerDoc = HISTORY_DOC_BYTES) {
  const raw = count * bytesPerDoc
  const docsBytes = Math.round(raw * BSON_OVERHEAD)
  const indexBytes = count * INDEX_BYTES_PER_DOC
  return { count, raw, docsBytes, indexBytes, total: docsBytes + indexBytes }
}

/** 人类可读的字节格式化 */
export function humanBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < BYTES_PER_GB) return `${(bytes / 1024 ** 2).toFixed(2)} MB`
  return `${(bytes / BYTES_PER_GB).toFixed(4)} GB`
}

/**
 * 对照配额评估用量
 * @param {number} usedBytes 已用字节
 * @param {number} quotaGb   配额（GB），默认云数据库 2 GB
 */
export function evaluateUsage(usedBytes, quotaGb = DATABASE_QUOTA_GB) {
  const quotaBytes = quotaGb * BYTES_PER_GB
  const ratio = usedBytes / quotaBytes
  const percent = ratio * 100
  let level = 'ok'
  if (ratio >= THRESHOLD) level = 'danger'
  else if (ratio >= 0.5) level = 'warn'
  return {
    usedBytes,
    quotaBytes,
    quotaGb,
    ratio,
    percent,
    threshold: THRESHOLD,
    thresholdBytes: quotaBytes * THRESHOLD,
    exceeded: ratio >= THRESHOLD,
    level,
    // 还剩多少可写（按当前阈值口径）
    remainingBytes: Math.max(0, quotaBytes * THRESHOLD - usedBytes),
  }
}

/** 生成文本进度条 */
export function renderBar(ratio, width = 28) {
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)))
  const thresholdPos = Math.round(THRESHOLD * width)
  let bar = ''
  for (let i = 0; i < width; i++) {
    if (i === thresholdPos) bar += '|'
    else bar += i < filled ? '█' : '░'
  }
  return bar
}
