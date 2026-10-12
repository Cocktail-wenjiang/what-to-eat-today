/**
 * uni-app 工程目录定位（单一事实来源）
 *
 * 2026-10-12 起，uni-app 工程已从仓库内 `uni-app/` **迁出到独立目录**，
 * 以便 HBuilderX 将其作为独立项目导入（与用户其它 HBuilderX 工程并列）。
 * 本模块统一解析工程根，避免每个脚本各写一份硬编码路径。
 *
 * 解析顺序（先命中者胜）：
 *   1. 环境变量 `UNIAPP_DIR`            —— 迁移工程或做实验时用
 *   2. 仓库内旧位置 `<repo>/uni-app`     —— 兼容尚未迁移的环境
 *   3. 独立目录 `STANDALONE_DIR`         —— 迁移后的默认位置
 *
 * 判定标准是目录内同时存在 `manifest.json` 与 `pages.json`，
 * 这样即使候选目录存在但不是 uni-app 工程，也不会被误选。
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** 本仓库根目录（tools/ 的上一级） */
export const REPO_ROOT = resolve(__dirname, '..')

/** 迁移后的独立工程目录 */
export const STANDALONE_DIR = 'E:/Project/HBuilderX_Project/今天吃什么'

/** 仓库内旧位置（迁移前） */
export const LEGACY_DIR = resolve(REPO_ROOT, 'uni-app')

/** 目录是否是合法的 uni-app 工程 */
function isUniAppProject(dir) {
  return (
    typeof dir === 'string' &&
    existsSync(resolve(dir, 'manifest.json')) &&
    existsSync(resolve(dir, 'pages.json'))
  )
}

function resolveUniAppDir() {
  const candidates = [process.env.UNIAPP_DIR, LEGACY_DIR, STANDALONE_DIR].filter(Boolean)
  for (const dir of candidates) {
    if (isUniAppProject(dir)) return resolve(dir)
  }
  // 都找不到时回退到仓库内位置：让后续报错指向一个确定的路径，而不是 undefined
  return LEGACY_DIR
}

/** uni-app 工程根目录（绝对路径） */
export const UNI_APP_DIR = resolveUniAppDir()

/** 工程是否被正确定位（供脚本在缺失时给出明确提示） */
export const UNI_APP_FOUND = isUniAppProject(UNI_APP_DIR)

/** 拼接工程内路径 */
export function uniAppPath(...segments) {
  return resolve(UNI_APP_DIR, ...segments)
}

/** 常用位置 */
export const UNI_APP_SEED = uniAppPath('static/data/recipes.json')
export const UNI_APP_DB_DIR = uniAppPath('uniCloud-aliyun/database')
export const UNI_APP_DB_IMPORT = uniAppPath('uniCloud-aliyun/database/recipes.json')
export const UNI_APP_CLOUDFUNCTIONS = uniAppPath('uniCloud-aliyun/cloudfunctions')

/** 云函数源码路径 */
export function cloudFunctionPath(name) {
  return uniAppPath('uniCloud-aliyun/cloudfunctions', name, 'index.js')
}
