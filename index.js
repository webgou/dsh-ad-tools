/**
 * Host 侧入口（插件后端）。
 *
 * 这里不再起任何本地服务、不再开端口：
 *   · 投放分析：直接 spawn 插件内置的八个 .mjs（scripts/，--json），拿到 JSON 后归一成
 *     统一的「报告模型」交给浏览器端渲染；
 *   · 格里芬：Host 里直接登录 Grafana、跑 SQL，结果照样转成表格回前端。
 *
 * 凭证与目录都在面板「设置」里配，落在 ~/.dsh/storages/ad-tools/config.json；
 * 没配则回退环境变量 / 旧工具的 .env.local / tmp 凭证文件（迁移兼容）。
 *
 * 所有路由都是 POST，且只挂在 DSH 自己的 connection 上 —— 不监听局域网，
 * 也就没有原工具「无鉴权 /api/sql 暴露在外」的问题。
 */
import { disposeBridge } from './lib/bridge.js'
import { buildMessages, chatCompletions, chatWithLlm, llmHasDeepSeek } from './lib/ai.js'
import { DEFAULTS, publicConfig, saveConfig, settings } from './lib/config.js'
import { MODULE_LIST, customSql, report as griffinReport, testConnection } from './lib/griffin.js'
import { registerModelTools, rememberReport } from './lib/model-tools.js'
import { normalize } from './lib/report.js'
import { TOOLS, assetPreview, killAll, listAccounts, runByKey, status, weeklyMarkdown, todayCST, shiftDay } from './lib/tools.js'

export const name = 'ad-tools'

/* 2024-11：复用 DSH 自带的 LLM（deepseek-official / deepseek-account），
 * AI 分析不再强制要求单独配 DeepSeek API Key。 */
let hostCtx = null

function getLlm() {
  try {
    return hostCtx && typeof hostCtx.get === 'function' ? hostCtx.get('llm') : null
  } catch {
    return null
  }
}

/** DSH 侧就绪：llm 服务可用且登记了 DeepSeek 路由 */
function dshAiReady() {
  return !!getLlm() && llmHasDeepSeek(getLlm())
}

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

function json(value) {
  return Response.json(value, { headers: { 'cache-control': 'no-store' } })
}

async function readJson(request) {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

function fail(err) {
  return json({ ok: false, error: String(err?.message || err) })
}

/* ------------------------------------------------------------------ *
 * 配置
 * ------------------------------------------------------------------ */

function defaultRange() {
  const end = shiftDay(todayCST(), -1)
  return { start: shiftDay(end, -6), end }
}

async function handleConfig() {
  return json({
    ok: true,
    config: publicConfig(),
    dshAiReady: dshAiReady(),
    tools: Object.entries(TOOLS).map(([key, t]) => ({ key, label: t.label, desc: t.desc })),
    griffinModules: MODULE_LIST,
    range: defaultRange(),
    today: todayCST(),
  })
}

async function handleConfigSave(request) {
  const body = await readJson(request)
  const r = saveConfig(body)
  return json(r)
}

/* ------------------------------------------------------------------ *
 * 投放分析
 * ------------------------------------------------------------------ */

async function handleStatus() {
  try {
    return json(await status())
  } catch (err) {
    return fail(err)
  }
}

async function handleAccounts(request) {
  try {
    // body 可选：{ account_id } 单独查一个账户；{ enrich: true } 顺带把手动列表补上工商名
    const body = await readJson(request)
    return json(await listAccounts(body))
  } catch (err) {
    return fail(err)
  }
}

async function handleRun(request) {
  const body = await readJson(request)
  const tool = typeof body.tool === 'string' ? body.tool : ''
  if (!Object.hasOwn(TOOLS, tool)) return json({ ok: false, error: `未知工具：${tool || '(空)'}` })

  const started = Date.now()
  let r
  try {
    r = await runByKey(tool, body)
  } catch (err) {
    return fail(err)
  }
  if (!r.ok) {
    return json({
      ok: false,
      tool,
      error: r.error,
      detail: r.stderr ? String(r.stderr).slice(-2000) : undefined,
      account: r.account,
      params: r.params,
      ms: Date.now() - started,
    })
  }
  let model = null
  try {
    model = normalize(tool, r.data)
    // 主对话的 ad_tools_last_report 读的就是这一份，面板和模型看到同一批数字
    rememberReport(tool, model, { account: r.account, params: r.params })
  } catch (err) {
    // 口径数据拿到了、渲染模型挂了 —— 把原文还给前端，别让整次查询白跑
    return json({
      ok: false,
      tool,
      error: `结果渲染失败：${String(err?.message || err)}`,
      data: r.data,
      account: r.account,
      params: r.params,
    })
  }
  return json({
    ok: true,
    tool,
    model,
    account: r.account,
    params: r.params,
    ms: Date.now() - started,
    fetchedAt: new Date().toISOString(),
  })
}

async function handleWeeklyMd(request) {
  const body = await readJson(request)
  let r
  try {
    r = await weeklyMarkdown(body)
  } catch (err) {
    return fail(err)
  }
  return json(r.ok ? { ok: true, text: r.text } : { ok: false, error: r.error })
}

async function handleAsset(request) {
  const body = await readJson(request)
  try {
    return json({ ok: true, asset: await assetPreview(body) })
  } catch (err) {
    return json({ ok: false, error: String(err?.message || err) })
  }
}

/* ------------------------------------------------------------------ *
 * 格里芬
 * ------------------------------------------------------------------ */

async function handleGriffinTest() {
  try {
    return json(await testConnection())
  } catch (err) {
    return fail(err)
  }
}

async function handleGriffinReport(request) {
  const body = await readJson(request)
  try {
    return json(await griffinReport(body))
  } catch (err) {
    return fail(err)
  }
}

async function handleGriffinSql(request) {
  const body = await readJson(request)
  try {
    return json(await customSql(body))
  } catch (err) {
    return fail(err)
  }
}

/* ------------------------------------------------------------------ *
 * AI 分析
 * ------------------------------------------------------------------ */

async function handleAiChat(request) {
  const body = await readJson(request)
  const question = typeof body.question === 'string' ? body.question.trim() : ''
  if (!question) return json({ ok: false, error: '问题不能为空' })
  const kind = ['report', 'griffin', 'sql'].includes(body.kind) ? body.kind : 'report'
  const history = Array.isArray(body.history) ? body.history.slice(-20) : []
  const chat = { kind, data: body.data, question, history }
  try {
    const s = settings()
    // 用户在「设置」里显式改了直连地址或模型（非默认值）且配了 Key：
    // 视为明确想用自己的端点，优先直连，不走 DSH 内置。
    const explicitDirect = !!s.deepseekKey && (
      (s.deepseekApiBase && s.deepseekApiBase !== DEFAULTS.deepseekApiBase) ||
      (s.deepseekModel && s.deepseekModel !== DEFAULTS.deepseekModel)
    )
    if (explicitDirect) {
      const messages = buildMessages(chat)
      const r = await chatCompletions(s.deepseekKey, messages, { baseUrl: s.deepseekApiBase, model: s.deepseekModel })
      return json({ ok: r.ok, ...(r.ok ? { reply: r.reply } : { error: r.error }) })
    }
    // 默认优先走 DSH 自带的 LLM（deepseek-official / deepseek-account），不要求单独配 Key。
    if (dshAiReady()) {
      const r = await chatWithLlm(getLlm(), chat)
      // 只是缺凭证 / 没路由而手头恰好有 Key 时，回退到直连；其它错误照实返回。
      if (r.ok || !((r.code === 'MISSING_CREDENTIAL' || r.code === 'NO_ADAPTER') && s.deepseekKey)) {
        return json({ ok: r.ok, ...(r.ok ? { reply: r.reply } : { error: r.error }) })
      }
    }
    // 直连回退（地址 / 模型走设置值，默认 DeepSeek 官方）。
    const messages = buildMessages(chat)
    const r = await chatCompletions(s.deepseekKey, messages, { baseUrl: s.deepseekApiBase, model: s.deepseekModel })
    return json({ ok: r.ok, ...(r.ok ? { reply: r.reply } : { error: r.error }) })
  } catch (err) {
    return fail(err)
  }
}

/* ------------------------------------------------------------------ *
 * 挂载
 * ------------------------------------------------------------------ */

const ROUTES = [
  ['/api/ad-tools/config', handleConfig, 'config'],
  ['/api/ad-tools/config/save', handleConfigSave, 'config save'],
  ['/api/ad-tools/status', handleStatus, 'status'],
  ['/api/ad-tools/accounts', handleAccounts, 'accounts'],
  ['/api/ad-tools/run', handleRun, 'run'],
  ['/api/ad-tools/weekly-md', handleWeeklyMd, 'weekly markdown'],
  ['/api/ad-tools/asset', handleAsset, 'asset preview'],
  ['/api/ad-tools/griffin/test', handleGriffinTest, 'griffin test'],
  ['/api/ad-tools/griffin/report', handleGriffinReport, 'griffin report'],
  ['/api/ad-tools/griffin/sql', handleGriffinSql, 'griffin sql'],
  ['/api/ad-tools/ai/chat', handleAiChat, 'ai chat'],
]

function mountRoute(ctx, routePath, handler, label) {
  return ctx.inject(['connection'], (c) => {
    const connection = c.get('connection')
    const register = connection?.fetch?.register
    if (typeof register !== 'function') return
    return c.effect(
      () => register.call(connection.fetch, {
        path: routePath,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: handler,
      }),
      `ad-tools: ${label} route`,
    )
  })
}

export function apply(ctx) {
  hostCtx = ctx
  for (const [routePath, handler, label] of ROUTES) mountRoute(ctx, routePath, handler, label)
  // 主对话也能直接取数：tools 服务可用时登记 ad_tools_report / ad_tools_last_report
  ctx.inject(['tools'], (c) => registerModelTools(c))
  ctx.effect(() => () => {
    killAll()
    disposeBridge()
  }, 'ad-tools: bridge cleanup')
}

export { settings }
