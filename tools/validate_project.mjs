import { readdir, readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ignoredDirectories = new Set(['.git', '.hbuilderx', '.superpowers', 'node_modules', 'unpackage'])
const files = []

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) await collect(fullPath)
    else files.push(fullPath)
  }
}

await collect(root)

let structuredFiles = 0
for (const file of files) {
  if (!file.endsWith('.json')) continue
  const source = await readFile(file, 'utf8')
  try {
    JSON.parse(source)
  } catch (error) {
    if (!file.endsWith('recipes.json')) throw error
    for (const [index, line] of source.trim().split(/\r?\n/).entries()) {
      try {
        JSON.parse(line)
      } catch {
        throw new Error(`${path.relative(root, file)}:${index + 1} is not valid JSONL`)
      }
    }
  }
  structuredFiles++
}

let javascriptFiles = 0
for (const file of files) {
  if (!file.endsWith('.js') && !file.endsWith('.mjs')) continue
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr || `${path.relative(root, file)} failed syntax check`)
  }
  javascriptFiles++
}

console.log(`Validated ${structuredFiles} JSON/JSONL files and ${javascriptFiles} JavaScript files.`)
