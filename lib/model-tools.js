/**
 * 主对话取数桥：把面板的查询能力登记成 DSH 的主机工具。
 *
 *   · ad_tools_report       —— 直接跑某一个投放分析工具，返回精简文本报告
 *   · ad_tools_last_report  —— 读面板最近一次查询的结果（右侧栏刚跑过的数据）
 *
 * 这两条路都复用 lib/tools.js + lib/report.js，与面板的取数、口径、渲染完全同一份，
 * 不额外请求任何外部服务，也不把凭证交给模型。
 */
import { normalize } from './report.js'
import { TOOLS, runByKey } from './tools.js'
import { renderReport } from './tool-view.js'

const TOOL_KEYS = Object.keys(TOOLS)

/** 面板或主对话最近一次成功查询的报告模型。 */
let lastReport = null

export function rememberReport(tool, model, info = {}) {
  if (!model || typeof model !== 'object') return
  lastReport = {
    tool,
    model,
    account: info.account || '',
    params: info.params || {},
    fetchedAt: info.fetchedAt || new Date().toISOString(),
  }
}

function metaOf(snap) {
  const bits = [TOOLS[snap.tool]?.label || snap.tool]
  if (snap.account) bits.push(`账户 ${snap.account}`)
  const params = Object.entries(snap.params || {}).map(([k, v]) => `${k}=${v}`)
  if (params.length) bits.push(`参数 ${params.join(' ')}`)
  if (snap.fetchedAt) bits.push(`查询于 ${snap.fetchedAt}`)
  return `数据源：${bits.join('｜')}`
}

const MAX_ROWS_PARAM = {
  type: 'integer',
  description: '每个表格/榜单最多返回多少行，默认 120。先看默认量，需要更多明细再调大。',
}

const OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      tool: { type: 'string', description: '实际执行的工具 key。' },
      text: { type: 'string', description: '报告正文（Markdown 风格纯文本）。' },
      rows: { type: 'integer', description: '正文里输出的数据行数。' },
      truncated: { type: 'boolean', description: '是否有行/文本被截断。' },
    },
    required: ['tool', 'text', 'rows', 'truncated'],
  },
  render: (_args, value) => [{ type: 'text', text: value.text }],
}

const reportTool = {
  name: 'ad_tools_report',
  description:
    '查询腾讯广告投放数据，返回一份已归一化的文本报告（KPI、异常、表格、成本榜）。'
    + '适用场景：盯盘、创角次留、注册留存、创意数据、周报、保本出价、单元 LTV 判定、定向监控。'
    + '日期省略时查最近 7 天（截止昨天）；盯盘不看日期。账户取插件设置里配置的那个。'
    + '用户问投放数据、成本、留存、素材表现时直接调用，不需要用户先打开面板。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      tool: {
        type: 'string',
        enum: TOOL_KEYS,
        description: '查询类型：monitor=盯盘｜retention=创角次留｜register=注册留存｜creatives=创意数据｜weekly=周报｜ceiling=保本出价｜units=单元LTV判定｜targeting=定向监控',
      },
      start: { type: 'string', description: '起始日期 YYYY-MM-DD（含）。省略则取结束日往前 6 天。' },
      end: { type: 'string', description: '结束日期 YYYY-MM-DD（含）。省略则取昨天（北京时间）。' },
      dim: {
        type: 'string',
        enum: ['date', 'site_set', 'dynamic_creative_id'],
        description: '仅创角次留可用：按日期 / 版位 / 素材聚合，默认 date。',
      },
      all: { type: 'boolean', description: '仅定向监控可用：true 时连未投放的单元一起看。' },
      account_id: { type: 'string', description: '广告账户 ID（5-12 位数字），省略则用插件设置里的默认账户。' },
      max_rows: MAX_ROWS_PARAM,
    },
    required: ['tool'],
  },
  output: OUTPUT,
  async execute(args, exec) {
    const a = args && typeof args === 'object' ? args : {}
    const tool = typeof a.tool === 'string' ? a.tool : ''
    if (!Object.hasOwn(TOOLS, tool)) {
      throw new Error(`tool 必须是以下之一：${TOOL_KEYS.join('、')}`)
    }
    const r = await runByKey(tool, a, { signal: exec?.signal })
    if (!r.ok) throw new Error(`广告查询失败（${TOOLS[tool].label}）：${r.error || '未知错误'}`)
    let model
    try {
      model = normalize(tool, r.data)
    } catch (err) {
      throw new Error(`广告查询结果无法渲染（${TOOLS[tool].label}）：${String(err?.message || err)}`)
    }
    const snap = { tool, account: r.account, params: r.params, fetchedAt: new Date().toISOString() }
    rememberReport(tool, model, snap)
    const view = renderReport(model, { maxRows: a.max_rows, meta: metaOf(snap) })
    return { tool, text: view.text, rows: view.rows, truncated: view.truncated }
  },
}

const lastReportTool = {
  name: 'ad_tools_last_report',
  description:
    '读取腾讯广告面板最近一次查询的报告全文。'
    + '用户刚在右侧栏跑过数据、然后问「这个报告怎么看 / 帮我分析一下」时用它，'
    + '不必重新查询；还没有报告时先调用 ad_tools_report。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: { max_rows: MAX_ROWS_PARAM },
  },
  output: OUTPUT,
  async execute(args) {
    if (!lastReport) {
      throw new Error('还没有可用的广告报告：先在右侧栏运行一次查询，或调用 ad_tools_report。')
    }
    const a = args && typeof args === 'object' ? args : {}
    const view = renderReport(lastReport.model, { maxRows: a.max_rows, meta: metaOf(lastReport) })
    return { tool: lastReport.tool, text: view.text, rows: view.rows, truncated: view.truncated }
  },
}

/**
 * 在 `tools` 服务就绪的 scope 里登记两个工具。
 * 服务不存在时静默跳过 —— 插件在纯 HTTP / 老版本 DSH 上仍要能跑。
 */
export function registerModelTools(scope) {
  if (!scope) return
  let tools = null
  try {
    tools = typeof scope.get === 'function' ? scope.get('tools') : null
  } catch { /* 服务未就绪 */ }
  if (!tools) {
    try { tools = scope.tools } catch { /* 服务未注册 */ }
  }
  if (!tools || typeof tools.register !== 'function') return
  return [reportTool, lastReportTool].map((def) => (
    typeof scope.effect === 'function'
      ? scope.effect(() => tools.register(def), `ad-tools: ${def.name} tool`)
      : tools.register(def)
  ))
}

export { reportTool, lastReportTool }
