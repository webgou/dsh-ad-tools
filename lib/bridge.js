/**
 * 仅本机可见的格里芬 SQL 桥。
 *
 * 为什么需要它：`保本出价.mjs` / `单元LTV判定.mjs` 的游戏侧数据是通过
 *   POST http://127.0.0.1:<port>/api/sql  { sql, ds }
 * 从格里芬服务端取的。插件里已经不再起格里芬服务，所以 Host 临时开一个
 * 回环小口，把请求接到自己的 Grafana 会话上 —— 脚本一行不改，口径不分叉。
 *
 * 边界：
 *   · 只监听 127.0.0.1，端口由系统分配（随机），跑完就关（空闲 60 秒也关）；
 *   · 只接受 POST /api/sql，且只放行 SELECT / WITH 开头的单条语句 ——
 *     这条路永远不能用来改库。
 */
import http from 'node:http'
import { customSql } from './griffin.js'

const IDLE_MS = 60_000
const SCRIPT_RE = /^\s*(select|with)\b/i

let server = null
let port = 0
let inflight = 0
let idleTimer = null

function readBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (d) => {
      raw += d
      if (raw.length > 200_000) req.destroy()
    })
    req.on('end', () => resolve(raw))
    req.on('error', () => resolve(''))
  })
}

function send(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

async function handle(req, res) {
  if (req.method !== 'POST' || !req.url?.startsWith('/api/sql')) {
    send(res, 404, { error: 'not found' })
    return
  }
  let body = {}
  try {
    body = JSON.parse(await readBody(req) || '{}')
  } catch {
    send(res, 400, { error: '请求体不是 JSON' })
    return
  }
  const sql = typeof body.sql === 'string' ? body.sql : ''
  if (!SCRIPT_RE.test(sql)) {
    send(res, 400, { error: '这条桥只允许执行 SELECT / WITH 查询' })
    return
  }
  const r = await customSql({ sql, ds: body.ds === 'x7' ? 'x7' : 'main' })
  if (!r.ok) {
    send(res, 502, { error: r.error || '查询失败' })
    return
  }
  send(res, 200, { columns: r.columns, rows: r.rows, ms: r.ms })
}

function close() {
  if (!server) return
  const s = server
  server = null
  port = 0
  try { s.close() } catch { /* 已在关 */ }
}

function scheduleClose() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (inflight === 0) close()
  }, IDLE_MS)
}

/** 拿到端口（没有就现开一个）。 */
export function bridgePort() {
  if (server) return Promise.resolve(port)
  server = http.createServer((req, res) => {
    inflight += 1
    handle(req, res)
      .catch((err) => { try { send(res, 500, { error: String(err?.message || err) }) } catch { /* 已断开 */ } })
      .finally(() => {
        inflight -= 1
        if (inflight === 0) scheduleClose()
      })
  })
  return new Promise((resolve, reject) => {
    const s = server
    s.once('error', (err) => { close(); reject(err) })
    s.listen(0, '127.0.0.1', () => {
      port = s.address().port
      resolve(port)
    })
  })
}

/** 跑一次需要格里芬的工具；结束后安排收口。 */
export async function withBridge(fn) {
  const p = await bridgePort()
  try {
    return await fn(p)
  } finally {
    if (inflight === 0) scheduleClose()
  }
}

/** 插件卸载时调用。 */
export function disposeBridge() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
  close()
}
