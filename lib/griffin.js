/**
 * 格里芬（Grafana）取数：登录 + 报表 SQL + 自定义 SQL。
 *
 * 这是原 griffin-data-tool/server.mjs 的核心，搬进插件 Host 半：
 *   · 不再起 8787 端口，也就不存在「无鉴权的 /api/sql 暴露在局域网」这件事；
 *   · 凭证来自设置面板（持久化在 ~/.dsh/storages/ad-tools/config.json），
 *     没填则回退环境变量与旧工具的 .env.local。
 *
 * 口径没有改动：六套报表 SQL 与原工具逐字一致。
 */
import { grafanaConfig } from './config.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function normalizeGrafanaUrl(input) {
  const raw = String(input || '').trim()
  const u = new URL(raw)
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`格里芬地址只支持 http/https，当前是：${u.protocol}`)
  }
  return u.origin
}

/* ------------------------------------------------------------------ *
 * 会话
 * ------------------------------------------------------------------ */

let session = null   // { key, cookie }

async function login(cfg) {
  let res
  try {
    res = await fetch(`${cfg.url}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: cfg.user, password: cfg.pass }),
    })
  } catch (err) {
    throw new Error(`连不上格里芬 ${cfg.url}：${err.message}（检查地址/端口/网络）`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const hint = res.status === 401 || res.status === 403
      ? '（账号或密码不对）'
      : (text.trimStart().startsWith('<') ? '（该地址返回的是网页，可能不是格里芬根地址）' : '')
    throw new Error(`格里芬登录失败：HTTP ${res.status}${hint} ${text.slice(0, 200)}`)
  }
  const cookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean)
  const jar = cookies.map((c) => String(c).split(';')[0]).filter(Boolean)
  if (!jar.length) throw new Error('格里芬登录成功但没有拿到 session cookie')
  const key = `${cfg.url}\u0000${cfg.user}\u0000${cfg.pass}`
  session = { key, cookie: jar.join('; ') }
  return session.cookie
}

async function cookieFor(cfg) {
  const key = `${cfg.url}\u0000${cfg.user}\u0000${cfg.pass}`
  if (session?.key === key) return session.cookie
  return login(cfg)
}

function framesToTable(payload, refId = 'A') {
  const result = payload?.results?.[refId]
  if (!result) throw new Error('返回结构里没有查询结果')
  if (result.error) throw new Error(`SQL 执行失败：${result.error}`)
  const frames = result.frames || []
  if (!frames.length) return { columns: [], rows: [] }
  const first = frames[0]
  const columns = (first.schema?.fields || []).map((f) => f.name)
  const rows = []
  const values = first.data?.values || []
  const n = values[0]?.length || 0
  for (let i = 0; i < n; i += 1) rows.push(columns.map((_, c) => values[c]?.[i] ?? null))
  return { columns, rows, executedSql: first.schema?.meta?.executedQueryString || '' }
}

async function runSqlOnce(sql, dsUid, cfg, retry) {
  const cookie = await cookieFor(cfg)
  const body = {
    queries: [{
      refId: 'A',
      datasource: { type: 'mysql', uid: dsUid },
      rawSql: sql,
      format: 'table',
      intervalMs: 60_000,
      maxDataPoints: 5000,
    }],
    from: 'now-1h',
    to: 'now',
  }
  const res = await fetch(`${cfg.url}/api/ds/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  })
  if ((res.status === 401 || res.status === 403) && retry) {
    session = null
    return runSqlOnce(sql, dsUid, cfg, false)
  }
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`格里芬返回了非 JSON 内容（HTTP ${res.status}）：${text.slice(0, 300)}`)
  }
  if (!res.ok) {
    throw new Error(`查询失败 HTTP ${res.status}：${json?.message || json?.error || text.slice(0, 300)}`)
  }
  return framesToTable(json)
}

/** 校验配置是否齐全，缺了直接给可读原因。 */
export function requireGrafana() {
  const cfg = grafanaConfig()
  if (cfg.missing.length) {
    const labels = { GRAFANA_URL: '服务地址', GRAFANA_USER: '登录账号', GRAFANA_PASS: '登录密码' }
    return {
      ok: false,
      error: `格里芬还没配置：缺 ${cfg.missing.map((k) => labels[k] || k).join('、')}。在面板「设置」里填好即可。`,
      missing: cfg.missing,
    }
  }
  let url
  try {
    url = normalizeGrafanaUrl(cfg.url)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  return { ok: true, cfg: { ...cfg, url } }
}

export async function testConnection() {
  const ready = requireGrafana()
  if (!ready.ok) return { ok: false, error: ready.error, missing: ready.missing }
  try {
    session = null
    const cookie = await login(ready.cfg)
    return { ok: true, url: ready.cfg.url, user: ready.cfg.user, cookieBytes: cookie.length, dsMain: ready.cfg.dsMain, dsX7: ready.cfg.dsX7 }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
}

/* ------------------------------------------------------------------ *
 * 六套报表 SQL（与原工具逐字一致）
 *   {S} 起始日  {E} 结束日    {FILTER} / {PFILTER} 渠道过滤
 * ------------------------------------------------------------------ */

const COHORT_TEMPLATE = `
WITH c AS (
  SELECT DISTINCT playerId, registerDay FROM t_analysis_user
  WHERE registerDay BETWEEN '{S}' AND '{E}' AND byDayNum = 1 AND {FILTER} playerId <> 11001),
p AS (
  SELECT playerId, money, createTime FROM t_wei_xin_pay
  WHERE refund = 0 AND playerId <> 11001 AND createTime BETWEEN '{S}' AND '{E}'),
p3 AS (
  SELECT c.playerId, SUM(p.money) AS amt3 FROM c
  JOIN p ON p.playerId = c.playerId
   AND p.createTime BETWEEN c.registerDay AND c.registerDay + INTERVAL 2 DAY
  GROUP BY 1),
flag AS (SELECT playerId FROM p3 WHERE amt3 >= 64800),
ret AS (
  SELECT registerDay AS day, SUM(byDayNum = 2) d2, SUM(byDayNum = 3) d3, SUM(byDayNum = 7) d7
  FROM t_analysis_user
  WHERE registerDay BETWEEN '{S}' AND '{E}' AND {FILTER} playerId <> 11001 AND byDayNum IN (2,3,7)
  GROUP BY 1),
mat AS (
  SELECT registerDay AS day, COUNT(*) AS cnt
  FROM t_analysis_user
  WHERE registerDay BETWEEN '{S}' AND '{E}' AND {FILTER} adId <> '' AND playerId <> 11001 AND byDayNum = 1
  GROUP BY 1),
act AS (
  SELECT loginDay AS day, COUNT(DISTINCT playerId) dau FROM t_analysis_user
  WHERE loginDay BETWEEN '{S}' AND '{E}' AND {FILTER} playerId <> 11001
  GROUP BY 1),
payd AS (
  SELECT w.createTime AS day, COUNT(DISTINCT w.playerId) pu, ROUND(SUM(w.money)/100, 2) rev
  FROM t_wei_xin_pay w JOIN t_player pl ON pl.playerId = w.playerId
  WHERE w.createTime BETWEEN '{S}' AND '{E}' AND w.refund = 0 AND w.playerId <> 11001 AND {PFILTER}
  GROUP BY 1),
x AS (
  SELECT c.registerDay AS day,
    COUNT(DISTINCT c.playerId) reg,
    COUNT(DISTINCT f.playerId) big,
    ROUND(SUM(CASE WHEN p.createTime = c.registerDay THEN p.money ELSE 0 END)/100
          / NULLIF(COUNT(DISTINCT c.playerId),0), 4) a1,
    ROUND(SUM(CASE WHEN p.createTime <= c.registerDay + INTERVAL 1 DAY THEN p.money ELSE 0 END)/100
          / NULLIF(COUNT(DISTINCT c.playerId),0), 4) a2,
    ROUND(SUM(CASE WHEN p.createTime <= c.registerDay + INTERVAL 2 DAY THEN p.money ELSE 0 END)/100
          / NULLIF(COUNT(DISTINCT c.playerId),0), 4) a3,
    ROUND(SUM(CASE WHEN p.createTime <= c.registerDay + INTERVAL 6 DAY THEN p.money ELSE 0 END)/100
          / NULLIF(COUNT(DISTINCT c.playerId),0), 4) a7,
    ROUND(SUM(CASE WHEN f.playerId IS NULL AND p.createTime = c.registerDay THEN p.money ELSE 0 END)/100
          / NULLIF(COUNT(DISTINCT CASE WHEN f.playerId IS NULL THEN c.playerId END),0), 4) net1,
    ROUND(SUM(CASE WHEN f.playerId IS NULL AND p.createTime <= c.registerDay + INTERVAL 2 DAY THEN p.money ELSE 0 END)/100
          / NULLIF(COUNT(DISTINCT CASE WHEN f.playerId IS NULL THEN c.playerId END),0), 4) net3,
    COUNT(DISTINCT CASE WHEN p.createTime = c.registerDay THEN c.playerId END) pay1,
    ROUND(100.0 * COUNT(DISTINCT CASE WHEN p.createTime = c.registerDay THEN c.playerId END)
          / NULLIF(COUNT(DISTINCT c.playerId),0), 2) payrate,
    ROUND(SUM(CASE WHEN p.createTime = c.registerDay THEN p.money ELSE 0 END)/100, 2) d0,
    ROUND(SUM(CASE WHEN p.createTime <= c.registerDay + INTERVAL 1 DAY THEN p.money ELSE 0 END)/100, 2) d1,
    ROUND(SUM(CASE WHEN p.createTime <= c.registerDay + INTERVAL 2 DAY THEN p.money ELSE 0 END)/100, 2) d2,
    ROUND(SUM(CASE WHEN p.createTime <= c.registerDay + INTERVAL 6 DAY THEN p.money ELSE 0 END)/100, 2) d6,
    ROUND(SUM(CASE WHEN f.playerId IS NULL AND p.createTime = c.registerDay THEN p.money ELSE 0 END)/100, 2) net0,
    ROUND(SUM(CASE WHEN f.playerId IS NULL AND p.createTime <= c.registerDay + INTERVAL 2 DAY THEN p.money ELSE 0 END)/100, 2) net2
  FROM c
  LEFT JOIN p ON p.playerId = c.playerId
  LEFT JOIN flag f ON f.playerId = c.playerId
  GROUP BY c.registerDay)
SELECT DATE_FORMAT(x.day,'%Y-%m-%d') AS 日期,
  x.reg AS 注册数, x.big AS 大额账号数,
  IFNULL(m.cnt, 0) AS 有素材ID,
  IFNULL(a.dau, 0) AS 日活, IFNULL(pd.pu, 0) AS 付费人数, IFNULL(pd.rev, 0) AS 充值,
  x.a1 AS 首日ARPU, x.a2 AS 2日ARPU, x.a3 AS 3日ARPU, x.a7 AS 7日ARPU,
  x.net1 AS 净首日ARPU, x.net3 AS 净3日ARPU,
  x.pay1 AS 首日付费人数, x.payrate AS 首日付费率,
  x.d0 AS D0金额, x.d1 AS D1金额, x.d2 AS D2金额, x.d6 AS D6金额,
  x.net0 AS 净D0金额, x.net2 AS 净D2金额,
  IFNULL(rt.d2,0) AS d2人数, IFNULL(rt.d3,0) AS d3人数, IFNULL(rt.d7,0) AS d7人数
FROM x
LEFT JOIN ret rt ON rt.day = x.day
LEFT JOIN mat m ON m.day = x.day
LEFT JOIN act a ON a.day = x.day
LEFT JOIN payd pd ON pd.day = x.day
ORDER BY x.day`

const CHANNEL_DAILY_SQL = `
WITH RECURSIVE dates(day) AS (
  SELECT DATE('{S}') UNION ALL SELECT day + INTERVAL 1 DAY FROM dates WHERE day < '{E}'),
ch AS (SELECT 0 AS c UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4)
SELECT DATE_FORMAT(d.day,'%Y-%m-%d') AS 日期, c.c AS 渠道值,
  CASE c.c WHEN 0 THEN '自然量' WHEN 1 THEN '腾讯(微信)' WHEN 2 THEN '抖音'
           WHEN 3 THEN '巨量' ELSE '官网' END AS 渠道,
  (SELECT COUNT(*) FROM t_analysis_user
    WHERE registerDay = d.day AND byDayNum = 1 AND channel = c.c AND playerId <> 11001) AS 注册数,
  (SELECT COUNT(DISTINCT playerId) FROM t_analysis_user
    WHERE loginDay = d.day AND channel = c.c AND playerId <> 11001) AS 日活,
  (SELECT COUNT(DISTINCT w.playerId) FROM t_wei_xin_pay w JOIN t_player pl ON pl.playerId = w.playerId
    WHERE w.createTime = d.day AND w.refund = 0 AND w.playerId <> 11001 AND pl.channel = c.c) AS 付费人数,
  (SELECT ROUND(IFNULL(SUM(w.money),0)/100, 2) FROM t_wei_xin_pay w JOIN t_player pl ON pl.playerId = w.playerId
    WHERE w.createTime = d.day AND w.refund = 0 AND w.playerId <> 11001 AND pl.channel = c.c) AS 充值
FROM dates d CROSS JOIN ch c
ORDER BY d.day, c.c`

const CHANNEL_SUMMARY_SQL = `
SELECT CASE channel WHEN 0 THEN '自然量' WHEN 1 THEN '腾讯(微信)' WHEN 2 THEN '抖音'
                    WHEN 3 THEN '巨量' ELSE '官网' END AS 渠道,
  SUM(byDayNum = 1) AS 注册数,
  SUM(byDayNum = 2) AS d2人数, SUM(byDayNum = 3) AS d3人数, SUM(byDayNum = 7) AS d7人数,
  SUM(CASE WHEN registerDay <= DATE_SUB('{E}', INTERVAL 1 DAY) THEN byDayNum = 1 ELSE 0 END) AS 注册_2日窗口,
  SUM(CASE WHEN registerDay <= DATE_SUB('{E}', INTERVAL 1 DAY) THEN byDayNum = 2 ELSE 0 END) AS d2完整,
  SUM(CASE WHEN registerDay <= DATE_SUB('{E}', INTERVAL 2 DAY) THEN byDayNum = 1 ELSE 0 END) AS 注册_3日窗口,
  SUM(CASE WHEN registerDay <= DATE_SUB('{E}', INTERVAL 2 DAY) THEN byDayNum = 3 ELSE 0 END) AS d3完整,
  SUM(CASE WHEN registerDay <= DATE_SUB('{E}', INTERVAL 6 DAY) THEN byDayNum = 1 ELSE 0 END) AS 注册_7日窗口,
  SUM(CASE WHEN registerDay <= DATE_SUB('{E}', INTERVAL 6 DAY) THEN byDayNum = 7 ELSE 0 END) AS d7完整
FROM t_analysis_user
WHERE registerDay BETWEEN '{S}' AND '{E}' AND byDayNum IN (1,2,3,7) AND playerId <> 11001
GROUP BY channel
ORDER BY 注册数 DESC`

const AD_MONTHLY_SQL = `
SELECT DATE_FORMAT(registerDay,'%Y-%m') AS 月份,
  SUM(byDayNum = 1) AS 广告注册数,
  SUM(byDayNum = 1 AND adId <> '') AS 有素材ID,
  SUM(CASE WHEN registerDay <= DATE_SUB('{E}', INTERVAL 1 DAY) THEN byDayNum = 1 ELSE 0 END) AS 注册_2日窗口,
  SUM(CASE WHEN registerDay <= DATE_SUB('{E}', INTERVAL 1 DAY) THEN byDayNum = 2 ELSE 0 END) AS d2完整
FROM t_analysis_user
WHERE byDayNum IN (1,2) AND channel <> 0 AND playerId <> 11001
  AND registerDay BETWEEN '{S}' AND '{E}'
GROUP BY 1
ORDER BY 1`

export const MODULES = {
  natural: {
    title: '主包 · 自然量逐日',
    ds: 'main',
    sql: (s, e) => COHORT_TEMPLATE.replaceAll('{S}', s).replaceAll('{E}', e)
      .replaceAll('{FILTER}', 'channel = 0 AND')
      .replaceAll('{PFILTER}', 'pl.channel = 0'),
  },
  ad: {
    title: '主包 · 广告渠道逐日（channel ≠ 0）',
    ds: 'main',
    sql: (s, e) => COHORT_TEMPLATE.replaceAll('{S}', s).replaceAll('{E}', e)
      .replaceAll('{FILTER}', 'channel <> 0 AND')
      .replaceAll('{PFILTER}', 'pl.channel <> 0'),
  },
  x7: {
    title: '小七渠道逐日（独立库 db_service_x7）',
    ds: 'x7',
    sql: (s, e) => COHORT_TEMPLATE.replaceAll('{S}', s).replaceAll('{E}', e)
      .replaceAll('{FILTER}', '')
      .replaceAll('{PFILTER}', '1 = 1'),
  },
  channelDaily: {
    title: '主包 · 分渠道逐日（自然/腾讯/抖音/巨量/官网）',
    ds: 'main',
    sql: (s, e) => CHANNEL_DAILY_SQL.replaceAll('{S}', s).replaceAll('{E}', e),
  },
  channelSummary: {
    title: '主包 · 分渠道汇总',
    ds: 'main',
    sql: (s, e) => CHANNEL_SUMMARY_SQL.replaceAll('{S}', s).replaceAll('{E}', e),
  },
  adMonthly: {
    title: '广告渠道 · 月度趋势',
    ds: 'main',
    sql: (s, e) => AD_MONTHLY_SQL.replaceAll('{S}', s).replaceAll('{E}', e),
  },
}

export const MODULE_LIST = Object.entries(MODULES).map(([key, m]) => ({ key, title: m.title, ds: m.ds }))

/* ------------------------------------------------------------------ *
 * 对外
 * ------------------------------------------------------------------ */

export async function report(input) {
  const ready = requireGrafana()
  if (!ready.ok) return ready
  const cfg = ready.cfg
  const { start, end } = input || {}
  const modules = Array.isArray(input?.modules) ? input.modules : []
  if (!modules.length) return { ok: false, error: '请至少选择一个数据模块' }
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) return { ok: false, error: '日期格式应为 YYYY-MM-DD' }
  if (start > end) return { ok: false, error: '开始日期不能晚于结束日期' }

  const results = []
  for (const key of modules) {
    const mod = MODULES[key]
    if (!mod) { results.push({ key, title: key, ok: false, error: '未知模块' }); continue }
    const sql = mod.sql(start, end)
    const dsUid = mod.ds === 'x7' ? cfg.dsX7 : cfg.dsMain
    const t0 = Date.now()
    try {
      const table = await runSqlOnce(sql, dsUid, cfg, true)
      results.push({
        key,
        title: mod.title,
        ds: mod.ds,
        sql,
        ok: true,
        columns: table.columns,
        rows: table.rows,
        ms: Date.now() - t0,
      })
    } catch (err) {
      results.push({ key, title: mod.title, ds: mod.ds, sql, ok: false, error: String(err?.message || err), ms: Date.now() - t0 })
    }
  }
  return { ok: true, start, end, generatedAt: new Date().toISOString(), results }
}

export async function customSql(input) {
  const ready = requireGrafana()
  if (!ready.ok) return ready
  const sql = typeof input?.sql === 'string' ? input.sql : ''
  if (!sql.trim()) return { ok: false, error: 'SQL 不能为空' }
  if (/;\s*\S/.test(sql.trim().replace(/;$/, ''))) return { ok: false, error: '一次只允许执行一条语句' }
  const cfg = ready.cfg
  const dsUid = input?.ds === 'x7' ? cfg.dsX7 : cfg.dsMain
  const t0 = Date.now()
  try {
    const table = await runSqlOnce(sql, dsUid, cfg, true)
    return { ok: true, columns: table.columns, rows: table.rows, ms: Date.now() - t0 }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
}
