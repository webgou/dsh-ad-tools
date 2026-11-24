/**
 * 配置与凭证。
 *
 * 存放位置：`~/.dsh/storages/ad-tools/config.json`（与 DSH 自己的数据同目录，
 * 插件目录只放代码，凭证永远不落进插件包）。文件权限 0600。
 * 存储目录可用环境变量 `AD_TOOLS_STORE_DIR` 覆盖（测试 / 迁移时隔离配置到别处）。
 *
 * 解析顺序（逐项独立，先命中先用）：
 *   1) 这个配置文件（面板里「设置」写入）
 *   2) 环境变量（GRAFANA_URL / GRAFANA_USER / GRAFANA_PASS / MKT_ACCESS_TOKEN / MKT_ACCOUNT_ID）
 *   3) 旧工具的既有位置（格里芬 .env.local、仓库 tmp/tencentads_credentials.json）
 *
 * 第 3 条是迁移兼容：老用户不填也能跑，填了就覆盖。插件不复制、不改写这些文件。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const HOME = os.homedir()
/** 插件内置脚本目录（八个 .mjs 随插件安装）。 */
export const BUNDLED_SCRIPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts')
// 默认落在 DSH 自己的数据目录；环境变量可把配置隔离到别处（测试 / 迁移用）。
export const STORE_DIR = process.env.AD_TOOLS_STORE_DIR
  ? path.resolve(process.env.AD_TOOLS_STORE_DIR)
  : path.join(HOME, '.dsh', 'storages', 'ad-tools')
export const CONFIG_FILE = path.join(STORE_DIR, 'config.json')

export const DEFAULTS = {
  adToolsDir: process.env.AD_TOOLS_DIR || BUNDLED_SCRIPTS_DIR,
  accountList: [], // 手动维护的账户列表：[{ id, name? }]；平台已授权的账户由 advertiser/get 自动补
  // 旧 .env.local 的位置、Grafana 数据源 UID 都属于个人环境，不内置；在「设置」里填
  griffinEnvFile: process.env.GRIFFIN_ENV_FILE || '',
  dsMain: process.env.GRIFFIN_DS_MAIN || '',
  dsX7: process.env.GRIFFIN_DS_X7 || '',
  grafanaUrl: '',
  grafanaUser: '',
  grafanaPass: '',
  tencentToken: '',
  accountId: '',
  deepseekKey: '',
  deepseekApiBase: 'https://api.deepseek.com', // AI 直连的 OpenAI 兼容根地址，设置里可改
  deepseekModel: 'deepseek-chat', // AI 直连使用的模型名，设置里可改
}

/* ------------------------------------------------------------------ *
 * 读写
 * ------------------------------------------------------------------ */

let cached = null
let cachedMtime = 0

export function readConfigFile() {
  try {
    const st = fs.statSync(CONFIG_FILE)
    if (cached && st.mtimeMs === cachedMtime) return cached
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
    cached = raw !== null && typeof raw === 'object' ? raw : {}
    cachedMtime = st.mtimeMs
    return cached
  } catch {
    cached = cached ?? {}
    return cached
  }
}

export function writeConfigFile(patch) {
  const next = { ...readConfigFile(), ...patch }
  for (const key of Object.keys(next)) {
    if (next[key] === undefined) delete next[key]
  }
  fs.mkdirSync(STORE_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), { mode: 0o600 })
  try { fs.chmodSync(CONFIG_FILE, 0o600) } catch { /* Windows 上尽力而为 */ }
  cached = next
  try { cachedMtime = fs.statSync(CONFIG_FILE).mtimeMs } catch { cachedMtime = 0 }
  invalidate()
  return next
}

/* ------------------------------------------------------------------ *
 * 旧位置兜底
 * ------------------------------------------------------------------ */

/** 解析 KEY=VALUE 的 env 文件（与格里芬工具同一个格式）。不修改 process.env。 */
export function readEnvFile(file) {
  const out = {}
  try {
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq < 1) continue
      const key = line.slice(0, eq).trim()
      let value = line.slice(eq + 1).trim()
      if (value.length >= 2) {
        const q = value[0]
        if ((q === '"' || q === "'") && value.endsWith(q)) value = value.slice(1, -1)
      }
      if (key && value !== '') out[key] = value
    }
  } catch { /* 文件不存在即可 */ }
  return out
}

/** 从工具目录向上找仓库根（七个脚本用同一套规则）。 */
export function findRepoRoot(startDir) {
  let d = startDir
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(d, 'AGENTS.md'))
      || (fs.existsSync(path.join(d, 'tmp')) && fs.existsSync(path.join(d, 'doc')))) return d
    const up = path.dirname(d)
    if (up === d) break
    d = up
  }
  return startDir
}

function readTencentCredFile() {
  const root = findRepoRoot(settings().adToolsDir)
  for (const file of [
    path.join(root, 'tmp', 'tencentads_credentials.json'),
  ]) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    } catch { /* 继续 */ }
  }
  return {}
}

/* ------------------------------------------------------------------ *
 * 解析
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * 手动账户列表
 * ------------------------------------------------------------------ */

const ACCOUNT_RE = /^\d{5,12}$/

/**
 * 宽松归一（读配置文件用）：坏条目直接丢掉，不让一个手写错的 ID 拖垮整个设置。
 * 接受 `"12345678"`、`{ id, name }`、`{ account_id, corporation_name }`。
 */
export function normalizeAccountList(input) {
  const out = []
  const seen = new Set()
  for (const item of Array.isArray(input) ? input : []) {
    const raw = typeof item === 'string' ? item : item && (item.id ?? item.account_id)
    const id = String(raw ?? '').trim()
    if (!ACCOUNT_RE.test(id) || seen.has(id)) continue
    seen.add(id)
    const name = typeof item === 'object' && item
      ? String(item.name ?? item.corporation_name ?? '').trim().slice(0, 40)
      : ''
    out.push(name ? { id, name } : { id })
    if (out.length >= 100) break
  }
  return out
}

/** 严格校验（保存时用）：坏条目要点名报错，而不是悄悄丢掉。 */
export function validateAccountList(input) {
  if (input === undefined) return { ok: true, list: undefined }
  if (!Array.isArray(input)) return { ok: false, error: '账户列表应为数组' }
  const out = []
  const seen = new Set()
  for (let i = 0; i < input.length; i += 1) {
    const item = input[i]
    const raw = typeof item === 'string' ? item : item && (item.id ?? item.account_id)
    const id = String(raw ?? '').trim()
    if (!id) continue
    if (!ACCOUNT_RE.test(id)) return { ok: false, error: `账户列表第 ${i + 1} 项「${id}」不是 5~12 位数字账户 ID` }
    if (seen.has(id)) continue
    seen.add(id)
    const name = typeof item === 'object' && item
      ? String(item.name ?? item.corporation_name ?? '').trim().slice(0, 40)
      : ''
    out.push(name ? { id, name } : { id })
    if (out.length >= 100) return { ok: false, error: '账户列表最多 100 个' }
  }
  return { ok: true, list: out }
}

/** 原始设置（文件 + 默认值），不外泄给浏览器。 */
export function settings() {
  const file = readConfigFile()
  const pick = (key) => {
    const v = file[key]
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : DEFAULTS[key]
  }
  return {
    adToolsDir: pick('adToolsDir'),
    accountList: normalizeAccountList(file.accountList),
    griffinEnvFile: pick('griffinEnvFile'),
    dsMain: pick('dsMain'),
    dsX7: pick('dsX7'),
    grafanaUrl: pick('grafanaUrl'),
    grafanaUser: pick('grafanaUser'),
    grafanaPass: pick('grafanaPass'),
    tencentToken: pick('tencentToken'),
    accountId: pick('accountId'),
    deepseekKey: pick('deepseekKey'),
    deepseekApiBase: pick('deepseekApiBase'),
    deepseekModel: pick('deepseekModel'),
  }
}

let cacheKey = ''
let grafanaCache = null
let tencentCache = null

function invalidate() {
  cacheKey = ''
  grafanaCache = null
  tencentCache = null
}

function stamp(s) {
  return [s.grafanaUrl, s.grafanaUser, s.grafanaPass, s.dsMain, s.dsX7, s.griffinEnvFile].join('\u0000')
}

/** 格里芬连接配置；缺项时返回 missing 列表而不是抛错。 */
export function grafanaConfig() {
  const s = settings()
  const key = stamp(s)
  if (grafanaCache && cacheKey === key) return grafanaCache
  const env = readEnvFile(s.griffinEnvFile)
  const url = s.grafanaUrl || process.env.GRAFANA_URL || env.GRAFANA_URL || ''
  const user = s.grafanaUser || process.env.GRAFANA_USER || env.GRAFANA_USER || ''
  const pass = s.grafanaPass || process.env.GRAFANA_PASS || env.GRAFANA_PASS || ''
  const missing = []
  if (!url) missing.push('GRAFANA_URL')
  if (!user) missing.push('GRAFANA_USER')
  if (!pass) missing.push('GRAFANA_PASS')
  grafanaCache = {
    url, user, pass, missing,
    dsMain: s.dsMain,
    dsX7: s.dsX7,
    source: s.grafanaUrl || s.grafanaUser || s.grafanaPass ? 'config'
      : (process.env.GRAFANA_URL || process.env.GRAFANA_USER || process.env.GRAFANA_PASS) ? 'env'
        : (env.GRAFANA_URL || env.GRAFANA_USER || env.GRAFANA_PASS) ? 'env-file' : 'none',
  }
  cacheKey = key
  return grafanaCache
}

/** 腾讯广告凭证：配置 → 环境变量 → 仓库 tmp 凭证文件。 */
export function tencentConfig() {
  const s = settings()
  if (tencentCache) return tencentCache
  const file = readTencentCredFile()
  const token = s.tencentToken || process.env.MKT_ACCESS_TOKEN || (typeof file.access_token === 'string' ? file.access_token : '')
  const rawAccount = s.accountId || process.env.MKT_ACCOUNT_ID || String(file.account_id || '')
  const accountId = /^\d{5,12}$/.test(String(rawAccount).trim()) ? String(rawAccount).trim() : ''
  const known = Array.isArray(file.known_accounts) ? file.known_accounts : []
  tencentCache = {
    token,
    accountId,
    manual: s.accountList,
    known,
    source: s.tencentToken ? 'config' : process.env.MKT_ACCESS_TOKEN ? 'env' : token ? 'credential-file' : 'none',
  }
  return tencentCache
}

/* ------------------------------------------------------------------ *
 * 给浏览器看的形状：永远不带 token / 密码原文
 * ------------------------------------------------------------------ */

export function publicConfig() {
  const s = settings()
  const g = grafanaConfig()
  const t = tencentConfig()
  return {
    adToolsDir: process.env.AD_TOOLS_SCRIPTS_DIR || BUNDLED_SCRIPTS_DIR,
    dsMain: s.dsMain,
    dsX7: s.dsX7,
    grafanaUrl: s.grafanaUrl || (g.url && g.source === 'env' ? g.url : '') || (g.url || ''),
    grafanaUser: s.grafanaUser || (g.user || ''),
    hasGrafanaPass: Boolean(g.pass),
    grafanaSource: g.source,
    grafanaMissing: g.missing,
    hasTencentToken: Boolean(t.token),
    tencentSource: t.source,
    accountId: t.accountId,
    accountList: s.accountList,
    hasDeepseekKey: Boolean(s.deepseekKey),
    deepseekApiBase: s.deepseekApiBase,
    deepseekModel: s.deepseekModel,
    configFile: CONFIG_FILE,
  }
}

/** 保存：空字符串表示「不改」，显式的 __clear 才清空。 */
export function saveConfig(body) {
  const patch = {}
  const str = (v) => (typeof v === 'string' ? v.trim() : undefined)
  const put = (key, value) => {
    if (value === undefined) return
    if (value === '') { patch[key] = ''; return }
    patch[key] = value
  }
  put('adToolsDir', str(body.adToolsDir))
  put('dsMain', str(body.dsMain))
  put('dsX7', str(body.dsX7))
  put('grafanaUrl', str(body.grafanaUrl))
  put('grafanaUser', str(body.grafanaUser))
  put('grafanaPass', typeof body.grafanaPass === 'string' && body.grafanaPass !== '' ? body.grafanaPass : undefined)
  put('tencentToken', typeof body.tencentToken === 'string' && body.tencentToken !== '' ? body.tencentToken : undefined)
  put('accountId', str(body.accountId))
  put('deepseekKey', typeof body.deepseekKey === 'string' && body.deepseekKey !== '' ? body.deepseekKey : undefined)
  put('deepseekApiBase', str(body.deepseekApiBase))
  put('deepseekModel', str(body.deepseekModel))

  // 账户列表：显式传 [] 表示清空；坏 ID 直接拒绝，并指出第几项
  const list = validateAccountList(body.accountList)
  if (!list.ok) return { ok: false, error: list.error }
  if (list.list !== undefined) patch.accountList = list.list

  const clear = Array.isArray(body.clear) ? body.clear : []
  for (const key of clear) {
    if (['grafanaPass', 'tencentToken', 'deepseekKey'].includes(key)) patch[key] = ''
  }

  // 校验明显写错的 URL，别把坏值存进去
  if (patch.grafanaUrl) {
    try {
      const u = new URL(patch.grafanaUrl)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol')
      patch.grafanaUrl = u.origin
    } catch {
      return { ok: false, error: '格里芬地址必须是 http(s) 根地址，例如 http://1.2.3.4:3000' }
    }
  }
  if (patch.deepseekApiBase) {
    try {
      const u = new URL(patch.deepseekApiBase)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol')
      patch.deepseekApiBase = u.toString().replace(/\/+$/, '')
    } catch {
      return { ok: false, error: 'AI 直连地址必须是 http(s) 地址，例如 https://api.deepseek.com' }
    }
  }
  if (patch.adToolsDir && !fs.existsSync(patch.adToolsDir)) {
    return { ok: false, error: `找不到工具目录：${patch.adToolsDir}` }
  }
  if (patch.accountId && !/^\d{5,12}$/.test(patch.accountId)) {
    return { ok: false, error: '广告账户 ID 应为 5~12 位数字' }
  }

  writeConfigFile(patch)
  return { ok: true, config: publicConfig() }
}
