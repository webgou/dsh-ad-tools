/**
 * AI 分析：把面板里的报告数据交给 DeepSeek 做解读。
 *
 * 职责分两半：
 *  · 序列化 —— 把报告模型 / 格里芬报表 / 自定义 SQL 结果压成表格文本（模型只认文本）；
 *  · 调用 —— POST DeepSeek 的 OpenAI 兼容接口 /chat/completions。
 *
 * API Key 只存在 `~/.dsh/storages/ad-tools/config.json`，Host 侧用，
 * 浏览器侧只能看到「有没有配」。数据也只从这里发出去，不落盘。
 */
const API_URL = 'https://api.deepseek.com' // AI 直连的根地址，默认 DeepSeek 官方；设置里可改
const MODEL = 'deepseek-chat' // V3：便宜、够快；不开 reasoning 免得慢（设置里可改）
const MAX_DATA = 120_000 // 数据文本上限，超了就截断，别把上下文撑爆
const MAX_HISTORY = 20 // 往返对话最多带多少条历史消息

const SYSTEM_PROMPT = [
  '你是一名资深的腾讯广告投放数据分析师。',
  '用户会给你一份投放数据（盯盘 / 创角次留 / 注册留存 / 创意数据 / 周报 / 保本出价 / 单元LTV / 定向监控',
  '的报告，或格里芬拉取的游戏侧数据），你要基于这份数据本身回答用户的提问。',
  '规则：',
  '1. 只依据给出的数据，不编造数字、不假设数据里没有的指标；',
  '2. 结论尽量具体、可执行（例如建议调整的出价、该关注的单元、下一步动作）；',
  '3. 用中文，直接答到点子上，不要客套；',
  '4. 数据不足时老实说缺什么，不要硬凑。',
].join('\n')

/* ------------------------------------------------------------------ *
 * 单元格 / 表格 -> 文本
 * ------------------------------------------------------------------ */

function cellText(c) {
  if (c == null) return ''
  if (typeof c === 'object') {
    if (c.t != null && c.t !== '') return String(c.t)
    if (c.sub != null) return String(c.sub)
    return ''
  }
  return String(c)
}

function fmtHead(columns) {
  return (columns || []).map((c) => (typeof c === 'string' ? c : String(c.label ?? ''))).join('\t')
}

/** 列 + 行 -> TSV 文本（和「复制表格」同一套分隔） */
export function tableToText(columns, rows) {
  const head = fmtHead(columns)
  const lines = (rows || []).map((r) => (r || []).map(cellText).join('\t'))
  return [head, ...lines].join('\n')
}

/* ------------------------------------------------------------------ *
 * 报告模型 -> 文本（dsp 报告；含 kpis / 告警 / section 明细）
 * ------------------------------------------------------------------ */

export function reportToText(model) {
  const out = []
  if (!model || typeof model !== 'object') return ''
  if (model.title) out.push(`# ${model.title}`)
  if (model.subtitle) out.push(model.subtitle)
  if (Array.isArray(model.kpis) && model.kpis.length) {
    out.push('', '## 关键指标')
    out.push(model.kpis.filter((k) => k).map((k) => `${k.k || ''}\t${k.v ?? ''}`).join('\n'))
  }
  if (Array.isArray(model.alerts) && model.alerts.length) {
    out.push('', '## 告警')
    out.push(model.alerts.map((a) => `- ${a}`).join('\n'))
  } else if (model.alertsEmpty) {
    out.push('', '## 告警\n（无异常）')
  }
  if (Array.isArray(model.warnings) && model.warnings.length) {
    out.push('', '## 口径提示')
    out.push(model.warnings.map((w) => `- ${w}`).join('\n'))
  }
  const kpiLine = (k) => `${k.k || ''}\t${k.v ?? ''}`
  for (const sec of model.sections || []) {
    if (!sec || !sec.title) continue
    out.push('', `## ${sec.title}`)
    if (sec.kind === 'kpis' && Array.isArray(sec.items)) {
      out.push(sec.items.filter(Boolean).map(kpiLine).join('\n'))
    } else if (sec.kind === 'table' && (sec.columns?.length || sec.groups?.length)) {
      if (sec.columns?.length) {
        out.push(fmtHead(sec.columns))
        for (const row of sec.rows || []) out.push((row || []).map(cellText).join('\t'))
        for (const g of sec.groups || []) {
          if (g.label || g.note) out.push(`【${g.label || '分组'}】${g.note || ''}`)
          for (const row of g.rows || []) out.push((row || []).map(cellText).join('\t'))
        }
      }
      if (sec.footer) out.push(`合计\t${(sec.footer || []).map(cellText).join('\t')}`)
    } else if (sec.kind === 'list' && Array.isArray(sec.items)) {
      out.push(sec.items.filter(Boolean).map((it) =>
        `${it.label || ''}\t${it.value ?? ''}${it.tag ? ` (${it.tag})` : ''}${it.sub ? ` — ${it.sub}` : ''}`).join('\n'))
    } else if (sec.kind === 'notes' && Array.isArray(sec.items)) {
      out.push(sec.items.map((x) => `- ${x}`).join('\n'))
    } else if (sec.kind === 'configs' && Array.isArray(sec.items)) {
      for (const it of sec.items) {
        out.push(`- ${it.name || ''}（${it.id || ''}）${it.tag ? ` ${it.tag}` : ''}`)
        for (const line of it.lines || []) out.push(`    ${line}`)
      }
    }
  }
  return out.join('\n')
}

/** 格里芬报表结果集 -> 文本 */
export function griffinToText(results) {
  const out = []
  if (!Array.isArray(results)) return ''
  for (const r of results) {
    if (!r) continue
    out.push('', `## ${r.title || r.key || '(报表)'}`)
    if (!r.ok) {
      out.push(`（查询失败：${r.error || ''}）`)
      continue
    }
    if (r.columns?.length) out.push(tableToText(r.columns, r.rows))
    else out.push('（无数据）')
    if (r.sql) out.push(`\n> SQL：${r.sql}`)
  }
  return out.join('\n')
}

/** 自定义 SQL 结果 -> 文本 */
export function sqlToText(res) {
  if (!res || !res.ok) return res?.ok === false ? `（查询失败：${res.error || ''}）` : ''
  const out = []
  if (res.columns?.length) out.push(tableToText(res.columns, res.rows))
  else out.push('（无数据）')
  if (res.sql) out.push(`\n> SQL：${res.sql}`)
  return out.join('\n')
}

/** 按 kind 选序列化器；兜底 JSON。 */
export function dataToText(kind, data) {
  let text = ''
  try {
    if (kind === 'report') text = reportToText(data)
    else if (kind === 'griffin') text = griffinToText(data)
    else if (kind === 'sql') text = sqlToText(data)
    else text = typeof data === 'string' ? data : JSON.stringify(data)
  } catch {
    text = ''
  }
  if (!text.trim()) return ''
  return text.length > MAX_DATA ? `${text.slice(0, MAX_DATA)}\n\n…（数据过长已截断）` : text
}

/* ------------------------------------------------------------------ *
 * 调用 DeepSeek
 * ------------------------------------------------------------------ */

/**
 * @param {string} key      DeepSeek API Key
 * @param {Array<{role,content}>} messages  system 已放在 messages[0]；只发 user/assistant
 * @param {{signal?: AbortSignal, baseUrl?: string, model?: string}} [opts]  baseUrl/model 走设置值，缺省用官方默认
 * @returns {{ ok: true, reply: string } | { ok: false, error: string }}
 */
export async function chatCompletions(key, messages, { signal, baseUrl, model } = {}) {
  if (!key) return { ok: false, error: '未配置 DeepSeek API Key，请到「设置」里填。' }
  const url = `${(baseUrl || API_URL).replace(/\/+$/, '')}/chat/completions`
  const modelName = model?.trim() || MODEL
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: modelName,
        temperature: 0.3,
        stream: false,
        messages,
      }),
    })
  } catch (e) {
    return { ok: false, error: `连不上 DeepSeek：${String(e?.message || e)}` }
  }
  if (!res.ok) {
    let detail = ''
    try { const j = await res.json(); detail = j?.error?.message || j?.message || '' } catch { /* 非 JSON */ }
    return { ok: false, error: `DeepSeek 返回 HTTP ${res.status}${detail ? `：${detail}` : ''}` }
  }
  let j = null
  try { j = await res.json() } catch { /* 兜底 */ }
  const reply = j?.choices?.[0]?.message?.content
  if (typeof reply !== 'string' || !reply.trim()) return { ok: false, error: '模型没有返回内容，再试一次？' }
  return { ok: true, reply: reply.trim() }
}

/* ------------------------------------------------------------------ *
 * 组一条带数据上下文的 messages（数据只发一次，后续轮次引用上文）
 * ------------------------------------------------------------------ */

export function buildMessages({ kind, data, question, history }) {
  const dataText = dataToText(kind, data)
  const msgs = []
  if (dataText) {
    msgs.push({ role: 'system', content: `${SYSTEM_PROMPT}\n\n以下是用户本轮要分析的数据：\n${dataText}` })
  } else {
    msgs.push({ role: 'system', content: SYSTEM_PROMPT })
  }
  // 历史只在有数据时才带上（避免没数据时上下文是空跑）
  const trimmed = (history || []).slice(-MAX_HISTORY)
  for (const m of trimmed) {
    if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim()) {
      msgs.push({ role: m.role, content: m.content })
    }
  }
  msgs.push({ role: 'user', content: question })
  return msgs
}

/* ------------------------------------------------------------------ *
 * 走 DSH 自带的 LLM（不依赖单独配 API Key；Key 直连只作回退）
 * ------------------------------------------------------------------ */

const LLM_TIMEOUT = 120_000 // DSH 流式回答最多等 2 分钟
const LLM_MAX_TOKENS = 8192 // 每轮回答的输出上限

/** DSH 的 llm 服务里有没有可用的 DeepSeek 路由（官方 API Key 或账号登录） */
export function llmHasDeepSeek(llm) {
  try {
    const providers = (llm && typeof llm.listProviders === 'function' ? llm.listProviders() : []) || []
    return providers.some((p) => p?.id === 'deepseek-official' || p?.id === 'deepseek-account')
  } catch {
    return false
  }
}

/**
 * 用 DSH 自带的 LLM 流式回答（deepseek-flash，不开推理）。
 *
 * 对话历史折叠进 system 文本（带角色标签），每次只送最新一条用户问题 ——
 * 不构造 assistant 角色的消息，避免走到 DSH 内部回放路径。
 *
 * @param {object} llm  DSH 的 llm 服务（ctx.get('llm')）
 * @returns {{ ok: true, reply: string } | { ok: false, error: string, code?: string }}
 */
export async function chatWithLlm(llm, { kind, data, question, history }, { signal } = {}) {
  try {
    if (!llm || typeof llm.stream !== 'function') {
      return { ok: false, error: 'DSH 自带模型不可用，请到「设置」配置 DeepSeek API Key 再用。', code: 'NO_ADAPTER' }
    }

    const providers = (typeof llm.listProviders === 'function' ? llm.listProviders() : []) || []
    const provider = providers.some((p) => p?.id === 'deepseek-official')
      ? 'deepseek-official'
      : 'deepseek-account'

    const parts = [SYSTEM_PROMPT]
    const dataText = dataToText(kind, data)
    if (dataText) parts.push(`以下是用户本轮要分析的数据：\n${dataText}`)
    const folded = (history || [])
      .slice(-MAX_HISTORY)
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`)
    if (folded.length) parts.push(`以下是对话历史（仅供上下文引用，其中「助手」的内容不一定是本轮的回答）：\n${folded.join('\n')}`)

    // 调用方信号 + 内置超时，谁先触发都中断流
    const timeoutSignal = AbortSignal.timeout(LLM_TIMEOUT)
    const streamSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal

    const iterable = llm.stream({
      provider,
      model: 'deepseek-flash',
      reasoningEffort: 'off',
      temperature: 0.3,
      maxTokens: LLM_MAX_TOKENS,
      system: parts.join('\n\n'),
      messages: [{ role: 'user', content: [{ type: 'text', text: question }] }],
      signal: streamSignal,
    })

    let reply = ''
    let terminal = null
    for await (const chunk of iterable) {
      if (!chunk) continue
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') reply += chunk.text
      else if (chunk.type === 'finish') terminal = chunk.reason
    }

    const finishKind = terminal && typeof terminal === 'object' ? terminal.kind : undefined
    if (finishKind === 'stop') {
      if (!reply.trim()) return { ok: false, error: '模型没有返回内容，再试一次？' }
      return { ok: true, reply: reply.trim() }
    }
    if (finishKind === 'max-tokens') {
      if (!reply.trim()) return { ok: false, error: '模型还没开口就到达长度上限，再试一次？' }
      return { ok: true, reply: `${reply.trim()}\n\n（篇幅所限，回答被截断了。）` }
    }
    if (finishKind === 'tool-calls') {
      return { ok: false, error: '模型这次没有给出文本回答，换个问法再试？' }
    }
    if (finishKind === 'aborted') {
      return { ok: false, error: '回答超时或已中断，再试一次？', code: 'ABORTED' }
    }
    if (finishKind === 'error') {
      const failure = terminal.failure || {}
      return {
        ok: false,
        error: failure.message ? String(failure.message) : '模型回答失败，再试一次？',
        code: failure.code,
      }
    }
    if (!reply.trim()) return { ok: false, error: '模型没有返回内容，再试一次？' }
    return { ok: true, reply: reply.trim() }
  } catch (e) {
    const err = e || {}
    const aborted = err?.name === 'AbortError' || err?.name === 'TimeoutError' || err?.code === 'ABORTED'
    if (aborted) return { ok: false, error: '回答超时或已中断，再试一次？', code: 'ABORTED' }
    return { ok: false, error: String(err?.message || err), code: typeof err.code === 'string' ? err.code : undefined }
  }
}