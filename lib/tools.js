/**
 * 投放分析：跑插件内置的八个 .mjs（--json），不依赖外部工具目录。
 *
 * 脚本放在 `<插件>/scripts/`，随插件一起安装；运行产物（凭证缓存、快照、留痕）
 * 写到 `~/.dsh/storages/ad-tools/run/`（可用 AD_TOOLS_TMP 覆盖）。
 * 脚本内只加了 TMP 的读取：`process.env.AD_TOOLS_TMP || 原来的仓库 tmp`。
 * `AD_TOOLS_SCRIPTS_DIR` 可临时指向别处的脚本目录；旧设置里的「工具目录」只作兜底。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { withBridge } from './bridge.js'
import { settings, tencentConfig, STORE_DIR } from './config.js'

export const TOOLS = {
  monitor: { file: '盯盘.mjs', label: '盯盘', desc: '在投单元 · 成本/次留' },
  retention: { file: '创角次留.mjs', label: '创角次留', desc: '逐日/版位/素材' },
  register: { file: '注册留存.mjs', label: '注册留存', desc: '注册成本 · 次留' },
  creatives: { file: '创意数据.mjs', label: '创意数据', desc: '计划 × 创意' },
  weekly: { file: '周报生成器.mjs', label: '周报', desc: '四段固定模板' },
  ceiling: { file: '保本出价.mjs', label: '保本出价', desc: '目标 LTV 上限' },
  units: { file: '单元LTV判定.mjs', label: '单元LTV判定', desc: 'LTV ÷ CAC' },
  targeting: { file: '定向监控.mjs', label: '定向监控', desc: '配置 vs 实际人群' },
}

export const RUN_TIMEOUT_MS = Number(process.env.AD_TIMEOUT_MS || 180_000)

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '')
const isAccount = (s) => /^\d{5,12}$/.test(String(s || '').trim())
const DIMS = new Set(['date', 'site_set', 'dynamic_creative_id'])

/** 凭证重定向钩子（见 credfile-shim.mjs）。 */
const SHIM = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'credfile-shim.mjs')).href

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 插件内置脚本目录。 */
export const BUNDLED_DIR = path.resolve(HERE, '..', 'scripts')
/** 脚本运行产物目录（不写插件目录、不写外部仓库）。 */
export const RUN_DIR = path.join(STORE_DIR, 'run')

/**
 * 实际使用的脚本目录：环境变量显式指定 → 插件内置 → 旧设置里的工具目录（兜底）。
 * 只有目标脚本在候选目录里存在时才采用该目录。
 */
export function scriptsDir(key) {
  const file = key ? (TOOLS[key]?.file || '') : ''
  const candidates = [process.env.AD_TOOLS_SCRIPTS_DIR, BUNDLED_DIR, settings().adToolsDir].filter(Boolean)
  for (const d of candidates) {
    if (!file || fs.existsSync(path.join(d, file))) return d
  }
  return candidates[0] || BUNDLED_DIR
}

export const todayCST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
export const shiftDay = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 86_400_000).toISOString().slice(0, 10)

/**
 * 子进程用的 node 可执行文件。
 * 插件跑在 Electron 里时 process.execPath 是 app 本体，必须带 ELECTRON_RUN_AS_NODE
 * 才会按 node 跑；纯 node 宿主则直接用它。
 */
function spawnEnv(extra) {
  const electron = Boolean(process.versions?.electron)
  const env = { ...process.env, AD_TOOLS_TMP: RUN_DIR, ...extra }
  if (electron) env.ELECTRON_RUN_AS_NODE = '1'
  return env
}

/* ------------------------------------------------------------------ *
 * 跑一个工具
 * ------------------------------------------------------------------ */

// DSH 退出时把还在跑的脚本一起收掉，免得留下孤儿进程
const live = new Set()
export function killAll() {
  for (const child of live) {
    try { child.kill('SIGKILL') } catch { /* 已退出 */ }
  }
  live.clear()
}

export function runTool(key, args, extraEnv = {}, opts = {}) {
  // 主对话工具会带 DSH 的取消信号：一开始就取消了就别再 spawn
  if (opts.signal?.aborted) return Promise.resolve({ ok: false, error: '已取消' })
  const tool = TOOLS[key]
  if (!tool) return Promise.resolve({ ok: false, error: `未知工具：${key}` })
  const dir = scriptsDir(key)
  const script = path.join(dir, tool.file)
  if (!fs.existsSync(script)) {
    return Promise.resolve({ ok: false, error: `找不到脚本 ${tool.file}（应在 ${dir}）` })
  }
  try { fs.mkdirSync(RUN_DIR, { recursive: true }) } catch { /* 权限问题交给脚本自己报 */ }
  // 面板里配了 token 就以 --import 注入重定向钩子，让脚本读到的是同一份凭证
  const shim = extraEnv.MKT_ACCESS_TOKEN ? ['--import', SHIM] : []
  const argv = [...shim, script, ...args, ...(opts.raw ? [] : ['--json'])]

  return new Promise((resolve) => {
    let child
    try {
      child = spawn(process.execPath, argv, { cwd: dir, env: spawnEnv(extraEnv) })
    } catch (err) {
      resolve({ ok: false, error: `启动脚本失败：${err.message}` })
      return
    }

    live.add(child)
    let out = ''
    let err = ''
    let done = false
    const signal = opts.signal
    let onAbort = () => {}
    const finish = (r) => {
      live.delete(child)
      if (done) return
      done = true
      clearTimeout(timer)
      if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort)
      resolve(r)
    }
    onAbort = () => {
      try { child.kill('SIGKILL') } catch { /* 已退出 */ }
      finish({ ok: false, error: '已取消' })
    }
    if (signal && typeof signal.addEventListener === 'function') signal.addEventListener('abort', onAbort, { once: true })

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* 已退出 */ }
      finish({ ok: false, error: `超时（${Math.round(RUN_TIMEOUT_MS / 1000)} 秒）`, stderr: err.trim() })
    }, RUN_TIMEOUT_MS)

    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', (e) => finish({ ok: false, error: `执行出错：${e.message}` }))
    child.on('close', (code) => {
      if (opts.raw) {
        if (code !== 0) {
          const lines = (err.trim() || out.trim()).split('\n').map((s) => s.trim()).filter(Boolean)
          return finish({ ok: false, error: lines.length ? lines[lines.length - 1] : `脚本退出码 ${code}`, stderr: err.trim() })
        }
        return finish({ ok: true, text: out })
      }
      const text = out.trim()
      let data = null
      if (text) {
        const lastLine = text.split('\n').filter((l) => l.trim().startsWith('{')).pop()
        try { data = JSON.parse(lastLine || text) } catch { /* 走错误分支 */ }
      }
      if (!data) {
        const lines = (err.trim() ? err : text).split('\n').map((s) => s.trim()).filter(Boolean)
        return finish({
          ok: false,
          error: lines.length ? lines[lines.length - 1] : `脚本没有输出可解析的数据（退出码 ${code}）`,
          stderr: err.trim() || text.slice(0, 1500),
          code,
        })
      }
      if (data.error) return finish({ ok: false, error: data.error, data, stderr: err.trim() })
      if (code !== 0) return finish({ ok: false, error: `脚本退出码 ${code}`, data, stderr: err.trim() })
      finish({ ok: true, data })
    })
  })
}

/* ------------------------------------------------------------------ *
 * 参数：与网页版同一套默认值和校验
 * ------------------------------------------------------------------ */

export function resolveParams(key, input = {}) {
  const q = input !== null && typeof input === 'object' ? input : {}
  const get = (name) => (typeof q[name] === 'string' ? q[name] : '')
  const acct = isAccount(get('account_id')) ? get('account_id').trim() : tencentConfig().accountId
  const env = { MKT_ACCOUNT_ID: acct, ...(tencentConfig().token ? { MKT_ACCESS_TOKEN: tencentConfig().token } : {}) }
  const end = isDate(get('end')) ? get('end') : shiftDay(todayCST(), -1)
  const start = isDate(get('start')) ? get('start') : shiftDay(end, -6)

  if (start > end) return { ok: false, error: '起始日不能晚于结束日' }
  // 账户不内置默认值：没配就明确报错，避免悄悄查错账户
  if (!isAccount(acct)) return { ok: false, error: '未配置广告账户：请在面板「设置」里填写广告账户 ID' }

  switch (key) {
    case 'monitor':
      return { ok: true, args: [], env: { MONITOR_FORCE: '1', ...env }, account: acct, params: {} }
    case 'retention': {
      const dim = DIMS.has(get('dim')) ? get('dim') : 'date'
      return { ok: true, args: [start, end, dim], env, account: acct, params: { start, end, dim } }
    }
    case 'register':
    case 'creatives':
    case 'weekly':
      return { ok: true, args: [start, end], env, account: acct, params: { start, end } }
    case 'ceiling':
    case 'units':
      // 游戏侧走格里芬 SQL → 跑之前临时开回环桥，端口由系统分配
      return { ok: true, env, account: acct, params: { start, end }, bridge: { start, end } }
    case 'targeting': {
      const all = get('all') === '1' || q.all === 1 || q.all === true
      const win = isDate(get('start')) && isDate(get('end')) ? [get('start'), get('end')] : []
      return {
        ok: true,
        args: win,
        env: all ? { TARGETING_ALL: '1', ...env } : env,
        account: acct,
        params: { all: all ? 1 : 0, ...(win.length ? { start: win[0], end: win[1] } : {}) },
      }
    }
    default:
      return { ok: false, error: `未知工具：${key}` }
  }
}

export async function runByKey(key, input, opts = {}) {
  const p = resolveParams(key, input)
  if (!p.ok) return { ok: false, error: p.error }
  const r = p.bridge
    ? await withBridge((port) => runTool(key, [p.bridge.start, p.bridge.end, String(port)], p.env, opts))
    : await runTool(key, p.args, p.env, opts)
  return { ...r, account: p.account, params: p.params }
}

/** 周报 Markdown 原文（同一口径 --md 再跑一遍）。 */
export async function weeklyMarkdown(input) {
  const p = resolveParams('weekly', input)
  if (!p.ok) return { ok: false, error: p.error }
  return runTool('weekly', [...p.args, '--no-save', '--md'], p.env, { raw: true })
}

/* ------------------------------------------------------------------ *
 * 账户列表
 * ------------------------------------------------------------------ */

/**
 * 查一个账户的基本信息。
 * 直客 token 的 advertiser/get 只能按 account_id 查、返回的就是这个账户本身，
 * 并不会“列出名下所有账户”——想拿到别的账户，只能知道 ID 再单独查。
 */
async function advertiserLookup(id, token) {
  const qs = new URLSearchParams({
    access_token: token,
    timestamp: String(Math.floor(Date.now() / 1000)),
    nonce: Math.random().toString(36).slice(2, 12),
    account_id: id,
    pagination_mode: 'PAGINATION_MODE_NORMAL',
    fields: JSON.stringify(['account_id', 'corporation_name', 'system_status']),
    page: '1',
    page_size: '100',
  })
  try {
    const r = await fetch(`https://api.e.qq.com/v3.0/advertiser/get?${qs}`).then((x) => x.json())
    if (r.code !== 0) return { error: `${r.code} ${r.message_cn || r.message || ''}`.trim() }
    return {
      rows: (r.data?.list || []).map((a) => ({
        id: String(a.account_id),
        name: a.corporation_name || '',
        status: String(a.system_status || '').replace('CUSTOMER_STATUS_', ''),
      })),
    }
  } catch (err) {
    return { error: String(err?.message || err) }
  }
}

export async function listAccounts(input = {}) {
  const t = tencentConfig()
  const accounts = []
  const RANK = { credential: 0, manual: 1, known: 2, authorized: 3 }
  const push = (id, name, status, source) => {
    const k = String(id)
    if (!isAccount(k)) return
    const i = accounts.findIndex((a) => a.id === k)
    if (i < 0) {
      accounts.push({ id: k, name: name || '', status: status || '', source })
      return
    }
    const a = accounts[i]
    // 备注名先到先得：手动列表里写的名字比平台的工商名更符合自己的叫法
    if (name && !a.name) a.name = name
    if (status) a.status = status
    if ((RANK[source] ?? 0) > (RANK[a.source] ?? 0)) a.source = source
  }

  push(t.accountId, '', '', 'credential')
  for (const a of t.manual) push(a.id, a.name || '', '', 'manual')
  for (const ka of t.known) {
    const id = ka && (ka.account_id ?? ka.id)
    if (id === undefined || id === null) continue
    push(id, ka.name || ka.corporation_name || '', '', 'known')
  }

  // advertiser/get 必须带一个 account_id（空值平台直接回 132115），而且直客 token 只会
  // 返回这个账户本身。种子优先级：本次指定的账户（设置页「查这个账户」）→ 默认账户 →
  // 手动列表第一个。想看到别的账户就把 ID 传进来单独查，或加进手动列表。
  const asked = isAccount(input?.account_id) ? String(input.account_id).trim() : ''
  const enrich = input?.enrich === true || input?.enrich === 1
  const seed = asked || (isAccount(t.accountId) ? t.accountId : (t.manual[0]?.id || ''))
  let apiError = ''
  if (!seed) {
    apiError = '未配置广告账户：请先在设置里填写广告账户 ID，或添加账户列表'
  } else if (t.token) {
    const r = await advertiserLookup(seed, t.token)
    if (r.error) {
      apiError = r.error
    } else {
      for (const a of r.rows) push(a.id, a.name, a.status, 'authorized')
      // 单独查某个账户时，顺手把默认账户也查一下，别让它在列表里只剩一个占位名
      if (asked && isAccount(t.accountId) && t.accountId !== asked) {
        const d = await advertiserLookup(t.accountId, t.token)
        if (d.rows) for (const row of d.rows) push(row.id, row.name, row.status, 'authorized')
      }
      // 显式拉取时把手动列表里的账户也逐个查一遍，补上工商名和账户状态
      if (enrich) {
        for (const a of t.manual.slice(0, 10)) {
          if (a.id === seed) continue
          const x = await advertiserLookup(a.id, t.token)
          if (x.rows) for (const row of x.rows) push(row.id, row.name, row.status, 'authorized')
          else if (x.error && !apiError) apiError = `${a.id}：${x.error}`
        }
      }
    }
  } else {
    apiError = '未配置 access_token'
  }

  // 手动列表里没写备注就只显示 ID，不套「本地凭证」这类容易误会的占位
  for (const a of accounts) if (!a.name && a.source !== 'manual') a.name = '(本地凭证所记账户)'
  return { ok: true, default: t.accountId, accounts, apiError }
}

/* ------------------------------------------------------------------ *
 * 环境状态（首页自检 + 设置页用）
 * ------------------------------------------------------------------ */

export async function status() {
  const s = settings()
  const t = tencentConfig()
  const dir = scriptsDir()
  const scripts = {}
  for (const [key, tool] of Object.entries(TOOLS)) {
    scripts[key] = fs.existsSync(path.join(scriptsDir(key), tool.file))
  }
  return {
    ok: true,
    toolsDir: dir,
    toolsDirExists: fs.existsSync(dir),
    bundledDir: BUNDLED_DIR,
    runDir: RUN_DIR,
    scripts,
    hasToken: Boolean(t.token),
    tokenSource: t.source,
    account: t.accountId,
    today: todayCST(),
    node: process.versions.node,
  }
}

/* ------------------------------------------------------------------ *
 * 创意素材预览直链（按需现取，10 分钟缓存）
 * ------------------------------------------------------------------ */

const assetCache = new Map()
const ASSET_TTL = 10 * 60 * 1000

async function marketingApi(apiPath, params, token) {
  const qs = new URLSearchParams({
    access_token: token,
    timestamp: String(Math.floor(Date.now() / 1000)),
    nonce: Date.now().toString(36) + Math.random().toString(36).slice(2, 10),
    ...Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)),
  })
  const j = await (await fetch(`https://api.e.qq.com/v3.0/${apiPath}?${qs}`)).json()
  if (j.code !== 0) throw new Error(`${apiPath} → ${j.code} ${j.message_cn || j.message || ''}`)
  return j.data
}

function firstCompValue(arr, key) {
  if (!Array.isArray(arr)) return null
  for (const c of arr) { const v = c && c.value; if (v && v[key]) return String(v[key]) }
  return null
}

async function resolveAssetId(accountId, creativeId, token) {
  try {
    const det = await marketingApi('dynamic_creatives/get', {
      account_id: accountId,
      fields: JSON.stringify(['dynamic_creative_id', 'creative_components']),
      filtering: JSON.stringify([{ field: 'dynamic_creative_id', operator: 'IN', values: [String(creativeId)] }]),
      page: 1,
      page_size: 1,
    }, token)
    const row = (det?.list || det?.data || [])[0]
    if (!row) return null
    const cc = row.creative_components || {}
    const vid = firstCompValue(cc.video, 'video_id')
    if (vid) return { type: '视频', id: String(vid) }
    const iid = firstCompValue(cc.image, 'image_id') || firstCompValue(cc.image_list, 'image_id')
    if (iid) return { type: '图片', id: String(iid) }
  } catch { /* 交给调用方报错 */ }
  return null
}

async function videoPreview(assetId, token, accountId) {
  try {
    const j = await marketingApi('videos/get', {
      account_id: accountId,
      fields: JSON.stringify(['media_id', 'video_id', 'description', 'preview_url', 'key_frame_image_url', 'width', 'height', 'file_size', 'type']),
      filtering: JSON.stringify([{ field: 'media_id', operator: 'EQUALS', values: [String(assetId)] }]),
      page: 1,
      page_size: 1,
    }, token)
    const row = (j?.list || j?.data || [])[0]
    if (!row?.preview_url) return null
    return {
      url: row.preview_url,
      type: '视频',
      mime: /MP4/i.test(String(row.type || '')) ? 'video/mp4' : String(row.type || ''),
      name: row.description || '',
      cover: row.key_frame_image_url || '',
      width: row.width || null,
      height: row.height || null,
      size: row.file_size || null,
      assetId: String(row.video_id || assetId),
    }
  } catch { return null }
}

async function imagePreview(assetId, token, accountId) {
  try {
    const j = await marketingApi('images/get', {
      account_id: accountId,
      fields: JSON.stringify(['image_id', 'description', 'preview_url', 'thumb_preview_url', 'width', 'height', 'file_size', 'type']),
      filtering: JSON.stringify([{ field: 'image_id', operator: 'EQUALS', values: [String(assetId)] }]),
      page: 1,
      page_size: 1,
    }, token)
    const row = (j?.list || j?.data || [])[0]
    if (!row?.preview_url) return null
    return {
      url: row.preview_url,
      type: '图片',
      mime: /JPG|JPEG/i.test(String(row.type || '')) ? 'image/jpeg' : (/PNG/i.test(String(row.type || '')) ? 'image/png' : String(row.type || '')),
      name: row.description || '',
      cover: row.thumb_preview_url || row.preview_url,
      width: row.width || null,
      height: row.height || null,
      size: row.file_size || null,
      assetId: String(row.image_id || assetId),
    }
  } catch { return null }
}

export async function assetPreview(input) {
  const t = tencentConfig()
  if (!t.token) throw new Error('未配置腾讯广告 access_token')
  const accountId = isAccount(input?.account_id) ? String(input.account_id).trim() : t.accountId
  if (!isAccount(accountId)) throw new Error('未配置广告账户：请先在设置里填写广告账户 ID')
  const creativeId = String(input?.creative_id || '').trim()
  let type = String(input?.asset_type || '')
  let assetId = String(input?.asset_id || '')

  if (!assetId && creativeId) {
    const r = await resolveAssetId(accountId, creativeId, t.token)
    if (r) { type = r.type; assetId = r.id }
  }
  if (!assetId) throw new Error('该创意未解析到素材 id（可能是程序化创意，或素材已被删除）')

  const ck = `${accountId}|${assetId}`
  const hit = assetCache.get(ck)
  if (hit && Date.now() - hit.at < ASSET_TTL) return { ...hit.data, cached: true, creativeId }

  let data = null
  if (type === '图片') data = await imagePreview(assetId, t.token, accountId)
  if (!data) data = await videoPreview(assetId, t.token, accountId)
  if (!data) data = await imagePreview(assetId, t.token, accountId)
  if (!data?.url) throw new Error('接口未返回可打开的预览链接（素材可能仍在转码，或已被删除）')

  assetCache.set(ck, { at: Date.now(), data })
  return { ...data, cached: false, creativeId }
}
