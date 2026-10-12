/**
 * 云函数 aiParseRequest（自然语言需求解析）契约测试
 *
 * 运行：node tools/test_ai_parse_function.mjs
 *
 * 与 recommend / stats 不同，本云函数**不依赖 uniCloud**（纯计算 + 可选外部模型调用），
 * 因此无需 mock 数据库，直接载入模块调用 main() 即可。
 *
 * 覆盖：
 *   - 关键词解析：人数 / 用时 / 口味 / 忌口
 *   - 边界收敛：人数 1~20、用时 5~240（下界尤其重要，低于 5 会被 recommend 的
 *     validate() 拒绝）、忌口 ≤30 字、输入文本 ≤120 字
 *   - 空输入：返回 error 而非抛异常
 *   - 模型不可用：无 fetch / 无密钥 / 请求失败 → 一律回退 keyword-fallback
 *   - 模型可用：采用模型字段，source=model
 */
import { readFileSync } from 'node:fs'
import { cloudFunctionPath } from './uni_app_paths.mjs'

const SRC_PATH = cloudFunctionPath('aiParseRequest')
const SRC = readFileSync(SRC_PATH, 'utf8')

/** 直接以 CommonJS 方式载入云函数（它用 exports.main） */
function loadMain() {
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', SRC)(mod, mod.exports, () => ({}))
  return mod.exports.main
}

const main = loadMain()

let fail = 0
const ok = (cond, label, extra = '') => {
  if (!cond) {
    fail++
    console.log('  ✗ ' + label + (extra ? '  ' + extra : ''))
  } else {
    console.log('  ✓ ' + label)
  }
}

/** 判定一组字段是否落在合法区间（与 validators.js / recommend.validate 一致） */
function fieldsValid(f) {
  return (
    Number.isInteger(f.servings) &&
    f.servings >= 1 &&
    f.servings <= 20 &&
    Number.isInteger(f.max_minutes) &&
    f.max_minutes >= 5 &&
    f.max_minutes <= 240 &&
    typeof f.preference === 'string' &&
    f.preference.length >= 1 &&
    f.preference.length <= 30 &&
    typeof f.allergy === 'string' &&
    f.allergy.length <= 30
  )
}

// ---------- 环境隔离：确保默认走关键词分支 ----------
// parseByModel 读 process.env 的 AI_API_KEY / OPENAI_API_KEY 等；
// 若开发机恰好配置了这些变量，测试会真的发网络请求。这里统一摘掉。
const ENV_KEYS = ['AI_API_KEY', 'OPENAI_API_KEY', 'AI_API_URL', 'OPENAI_BASE_URL', 'AI_MODEL']
const savedEnv = {}
for (const k of ENV_KEYS) {
  savedEnv[k] = process.env[k]
  delete process.env[k]
}
const savedFetch = globalThis.fetch
delete globalThis.fetch

// ---------- 用例 1：关键词解析 ----------
console.log('== 用例 1：关键词解析（无模型环境） ==')
{
  const r = await main({ text: '3个人吃，清淡点，30分钟内搞定，不要花生' })
  ok(r.error === undefined, '不返回 error')
  ok(r.source === 'keyword-fallback', 'source = keyword-fallback', 'got=' + r.source)
  ok(r.fields.servings === 3, 'servings = 3', 'got=' + r.fields.servings)
  ok(r.fields.max_minutes === 30, 'max_minutes = 30', 'got=' + r.fields.max_minutes)
  ok(r.fields.preference === '清淡', 'preference = 清淡', 'got=' + r.fields.preference)
  ok(r.fields.allergy === '花生', 'allergy = 花生', 'got=' + r.fields.allergy)
  ok(typeof r.summary === 'string' && r.summary.length > 0, 'summary 非空')
  ok(r.summary.includes('3个人'), 'summary 含人数', 'got=' + r.summary)
  ok(r.confidence > 0 && r.confidence <= 1, 'confidence ∈ (0,1]', 'got=' + r.confidence)
  ok(fieldsValid(r.fields), '字段全部落在合法区间')
}

// ---------- 用例 2：口味与忌口的关键词分支 ----------
console.log('\n== 用例 2：各口味关键词 ==')
{
  const cases = [
    ['健身增肌，要高蛋白', '高蛋白'],
    ['我是素食，不吃肉', '素食'],
    ['下班太累，来个快手菜', '快捷'],
    ['随便吧，你看着办', '不限']
  ]
  for (const [text, expected] of cases) {
    const r = await main({ text })
    ok(r.fields.preference === expected, `${JSON.stringify(text)} → ${expected}`, 'got=' + r.fields.preference)
  }
}

// ---------- 用例 3：边界收敛（人数 1~20 / 用时 5~240） ----------
console.log('\n== 用例 3：边界收敛 ==')
{
  const cases = [
    ['20个人吃，30分钟', 20, 30],
    ['1个人吃，10分钟', 1, 10],
    ['3分钟搞定', 2, 5], // 用时低于下界 5，必须抬到 5
    ['1分钟', 2, 5],
    ['500分钟也行', 2, 240], // 超过上界 240，必须压到 240
    ['4分钟快手菜', 2, 5]
  ]
  for (const [text, expServings, expMinutes] of cases) {
    const r = await main({ text })
    ok(
      r.fields.servings === expServings && r.fields.max_minutes === expMinutes,
      `${JSON.stringify(text)} → ${expServings}人 / ${expMinutes}分钟`,
      `got=${r.fields.servings}人 / ${r.fields.max_minutes}分钟`
    )
    ok(r.fields.max_minutes >= 5, '  用时不低于 5（否则会被 recommend 拒绝）')
  }
}

// ---------- 用例 4：文本与忌口截断 ----------
console.log('\n== 用例 4：超长输入截断 ==')
{
  const longAllergy = '不吃' + '虾'.repeat(60)
  const r = await main({ text: longAllergy })
  ok(r.fields.allergy.length <= 30, '忌口截断到 ≤30 字', 'len=' + r.fields.allergy.length)

  const longText = '两个人吃，清淡点，30分钟内，不要花生。' + '随便再说点什么'.repeat(30)
  const r2 = await main({ text: longText })
  ok(r2.error === undefined, '超长文本不报错')
  ok(fieldsValid(r2.fields), '超长文本仍产出合法字段')
}

// ---------- 用例 5：空输入 ----------
console.log('\n== 用例 5：空输入 ==')
{
  for (const input of [undefined, {}, { text: '' }, { text: '   ' }]) {
    const r = await main(input)
    ok(r.error === '需求文本不能为空', `输入 ${JSON.stringify(input)} → 返回 error`, 'got=' + JSON.stringify(r))
    ok(r.fields === undefined, '  不返回 fields')
  }
}

// ---------- 用例 6：有密钥但请求失败 → 回退 ----------
console.log('\n== 用例 6：模型请求失败 → 关键词回退 ==')
{
  process.env.AI_API_KEY = 'test-key'
  process.env.AI_API_URL = 'https://example.invalid/v1'
  globalThis.fetch = async () => {
    throw new Error('模拟网络不可达')
  }
  const r = await main({ text: '两个人吃，清淡点，20分钟' })
  ok(r.source === 'keyword-fallback', 'source = keyword-fallback', 'got=' + r.source)
  ok(r.fallbackReason === 'model-unavailable', '标注 fallbackReason', 'got=' + r.fallbackReason)
  ok(fieldsValid(r.fields), '回退后字段仍合法')
  ok(r.fields.max_minutes === 20, '回退结果仍解析出用时', 'got=' + r.fields.max_minutes)

  // 服务端返回非 2xx 同样应回退
  globalThis.fetch = async () => ({ ok: false, status: 500 })
  const r2 = await main({ text: '两个人吃，清淡点，20分钟' })
  ok(r2.source === 'keyword-fallback', 'HTTP 500 也回退', 'got=' + r2.source)

  delete process.env.AI_API_KEY
  delete process.env.AI_API_URL
}

// ---------- 用例 7：模型可用 → 采用模型字段 ----------
console.log('\n== 用例 7：模型可用 → source=model ==')
{
  process.env.AI_API_KEY = 'test-key'
  process.env.AI_API_URL = 'https://example.invalid/v1'
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              servings: 4,
              max_minutes: 45,
              preference: '高蛋白',
              allergy: '虾'
            })
          }
        }
      ]
    })
  })
  const r = await main({ text: '随便来点吧' })
  ok(r.source === 'model', 'source = model', 'got=' + r.source)
  ok(r.fields.servings === 4, 'servings 采用模型值 4', 'got=' + r.fields.servings)
  ok(r.fields.max_minutes === 45, 'max_minutes 采用模型值 45', 'got=' + r.fields.max_minutes)
  ok(r.fields.preference === '高蛋白', 'preference 采用模型值', 'got=' + r.fields.preference)
  ok(r.fields.allergy === '虾', 'allergy 采用模型值', 'got=' + r.fields.allergy)
  ok(r.confidence === 0.92, 'confidence = 0.92', 'got=' + r.confidence)

  // 模型返回非法值时必须被收敛，而不是原样透传
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              servings: 99,
              max_minutes: 1,
              preference: '不存在的口味',
              allergy: '虾'.repeat(50)
            })
          }
        }
      ]
    })
  })
  const r2 = await main({ text: '随便来点吧' })
  ok(r2.source === 'model', '仍标记为 model', 'got=' + r2.source)
  ok(r2.fields.servings === 20, '非法人数收敛到 20', 'got=' + r2.fields.servings)
  ok(r2.fields.max_minutes === 5, '非法用时收敛到 5', 'got=' + r2.fields.max_minutes)
  ok(r2.fields.preference === '不限', '未知口味回退不限', 'got=' + r2.fields.preference)
  ok(r2.fields.allergy.length <= 30, '超长忌口截断', 'len=' + r2.fields.allergy.length)
  ok(fieldsValid(r2.fields), '收敛后字段全部合法')

  // 模型返回非法 JSON → 回退
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '这不是 JSON' } }] })
  })
  const r3 = await main({ text: '两个人吃，清淡点，20分钟' })
  ok(r3.source === 'keyword-fallback', '模型返回非 JSON → 回退', 'got=' + r3.source)
  ok(r3.fields.max_minutes === 20, '回退结果仍解析出用时', 'got=' + r3.fields.max_minutes)

  // 模型返回空对象 → 每个字段都应回落到关键词解析结果，而不是 undefined / NaN
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '{}' } }] })
  })
  const r4 = await main({ text: '3个人吃，清淡点，25分钟内，不要花生' })
  ok(r4.source === 'model', '空对象仍标记 model', 'got=' + r4.source)
  ok(r4.fields.servings === 3, '缺省人数回落关键词值 3', 'got=' + r4.fields.servings)
  ok(r4.fields.max_minutes === 25, '缺省用时回落关键词值 25', 'got=' + r4.fields.max_minutes)
  ok(r4.fields.preference === '清淡', '缺省口味回落关键词值', 'got=' + r4.fields.preference)
  ok(r4.fields.allergy === '花生', '缺省忌口回落关键词值', 'got=' + r4.fields.allergy)
  ok(fieldsValid(r4.fields), '缺省字段全部合法（不得为 undefined/NaN）')

  delete process.env.AI_API_KEY
  delete process.env.AI_API_URL
}

// ---------- 用例 8：Node 16 无全局 fetch → 走 uniCloud.httpclient ----------
console.log('\n== 用例 8：Node 16（无全局 fetch）走 httpclient ==')
{
  // uniCloud 阿里云云函数运行时是 Node 16，没有全局 fetch。
  // 若代码只写 fetch，模型分支在云端永远走不到 —— 这里锁住该回归。
  process.env.AI_API_KEY = 'test-key'
  process.env.AI_API_URL = 'https://example.invalid/v1'
  delete globalThis.fetch

  let calledUrl = ''
  globalThis.uniCloud = {
    httpclient: {
      async request(url, options) {
        calledUrl = url
        return {
          status: 200,
          data: {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    servings: 3,
                    max_minutes: 40,
                    preference: '素食',
                    allergy: '葱'
                  })
                }
              }
            ]
          }
        }
      }
    }
  }

  const r = await main({ text: '随便来点' })
  ok(r.source === 'model', '无 fetch 时仍走模型分支', 'got=' + r.source)
  ok(r.fields.servings === 3, 'servings 取自模型', 'got=' + r.fields.servings)
  ok(r.fields.max_minutes === 40, 'max_minutes 取自模型', 'got=' + r.fields.max_minutes)
  ok(r.fields.preference === '素食', 'preference 取自模型', 'got=' + r.fields.preference)
  ok(r.fields.allergy === '葱', 'allergy 取自模型', 'got=' + r.fields.allergy)
  ok(/\/chat\/completions$/.test(calledUrl), '请求打到 chat/completions', 'got=' + calledUrl)

  // httpclient 返回非 2xx → 回退
  globalThis.uniCloud.httpclient.request = async () => ({ status: 502, data: {} })
  const r2 = await main({ text: '两个人吃，20分钟' })
  ok(r2.source === 'keyword-fallback', 'httpclient 502 也回退', 'got=' + r2.source)
  ok(r2.fields.max_minutes === 20, '回退结果仍解析出用时', 'got=' + r2.fields.max_minutes)

  // 既无 fetch 也无 httpclient → 回退
  delete globalThis.uniCloud
  const r3 = await main({ text: '两个人吃，20分钟' })
  ok(r3.source === 'keyword-fallback', '两条 HTTP 路径都不可用 → 回退', 'got=' + r3.source)

  delete process.env.AI_API_KEY
  delete process.env.AI_API_URL
}

// ---------- 还原环境 ----------
for (const k of ENV_KEYS) {
  if (savedEnv[k] === undefined) delete process.env[k]
  else process.env[k] = savedEnv[k]
}
globalThis.fetch = savedFetch

// ---------- 汇总 ----------
console.log('')
if (fail) {
  console.log(`❌ aiParseRequest 契约测试失败：${fail} 条断言未通过`)
  process.exit(1)
} else {
  console.log('🎉 aiParseRequest 契约全部通过')
}
