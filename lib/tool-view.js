/**
 * 报告模型 → 主对话可读的紧凑文本。
 *
 * 右侧栏渲染的是同一份模型（lib/report.js），这里只做「模型能直接读」的降级：
 * 保留标题 / 指标 / 异常 / 表格 / 排序榜，丢掉纯视觉信息（色条、素材链接），
 * 并按行数截断 —— 主对话的上下文比面板更贵。
 */

const MAX_TEXT = 60_000

const isNil = (v) => v == null || v === ''

/** cell 可能是字符串，也可能是 { t, tone, bar, sub, tag, link }。 */
function cellText(c) {
  if (isNil(c)) return ''
  if (typeof c !== 'object') return String(c)
  let s = isNil(c.t) ? '' : String(c.t)
  if (!isNil(c.sub)) s += `（${c.sub}）`
  if (c.tone === 'bad') s += ' [差]'
  else if (c.tone === 'warn') s += ' [注意]'
  return s.replace(/\n/g, ' ')
}

function kpiLine(k) {
  const head = `${k.k ?? ''}：${k.v ?? ''}`
  const tail = isNil(k.b) ? '' : `（${k.b}）`
  return `- ${head}${tail}`
}

function clampInt(v, min, max, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

/**
 * 把 normalize() 的输出转成文本。
 * @param {object} model normalize(tool, data) 的结果
 * @param {{ maxRows?: number, meta?: string }} opts
 *   maxRows：每个表格 / 榜单最多输出的行数；meta：数据来源那一行
 * @returns {{ text: string, rows: number, truncated: boolean }}
 */
export function renderReport(model, opts = {}) {
  const maxRows = clampInt(opts.maxRows, 1, 2000, 120)
  const out = []
  let rows = 0
  let truncated = false

  if (model.title) out.push(`# ${model.title}`)
  if (model.subtitle) out.push(model.subtitle)
  if (opts.meta) out.push(opts.meta)

  if (Array.isArray(model.kpis) && model.kpis.length) {
    out.push('', '## 关键指标', ...model.kpis.map(kpiLine))
  }
  if (Array.isArray(model.alerts) && model.alerts.length) {
    out.push('', '## 异常', ...model.alerts.map((a) => `- ${a}`))
  } else if (model.alertsEmpty) {
    out.push('', '## 异常', `- ${model.alertsEmpty}`)
  }
  if (Array.isArray(model.warnings) && model.warnings.length) {
    out.push('', '## 提示', ...model.warnings.map((w) => `- ${w}`))
  }

  for (const section of model.sections || []) {
    out.push('', `## ${section.title || '明细'}`)
    if (section.tip) out.push(`> ${section.tip}`)

    if (section.kind === 'kpis') {
      out.push(...(section.items || []).map(kpiLine))
      continue
    }

    if (section.kind === 'notes') {
      out.push(...(section.items || []).map((s) => `- ${s}`))
      continue
    }

    if (section.kind === 'configs') {
      for (const it of section.items || []) {
        const head = [it.name, it.id && `（${it.id}）`, it.tag && ` ${it.tag}`].filter(Boolean).join('')
        out.push(`- ${head}`)
        for (const line of it.lines || []) out.push(`  · ${line}`)
      }
      continue
    }

    if (section.kind === 'list') {
      const items = section.items || []
      const take = items.slice(0, maxRows)
      rows += take.length
      const skipped = items.length - take.length
      if (skipped > 0) truncated = true
      take.forEach((it, i) => {
        const no = it.no ?? i + 1
        const tag = it.tag ? `【${it.tag}】` : ''
        const tone = it.tone === 'bad' ? ' [差]' : it.tone === 'warn' ? ' [注意]' : ''
        const value = isNil(it.value) ? '' : ` → ${it.value}`
        const sub = isNil(it.sub) ? '' : `（${it.sub}）`
        out.push(`- ${no}. ${it.label ?? ''}${tag}${tone}${value}${sub}`)
      })
      if (skipped > 0) out.push(`- … 另有 ${skipped} 条未列出（max_rows=${maxRows}）`)
      if (section.foot) out.push(`- 合计：${section.foot}`)
      continue
    }

    // kind === 'table'（也兜底未知 kind）
    const columns = section.columns || []
    const header = columns.map((c) => c.label || '').join(' ｜ ')
    out.push(`列：${header}`)

    const pushRows = (list, prefix = '') => {
      const take = (list || []).slice(0, maxRows)
      rows += take.length
      const skipped = (list || []).length - take.length
      if (skipped > 0) truncated = true
      for (const row of take) {
        out.push(`${prefix}- ${(row || []).map(cellText).join(' ｜ ')}`)
      }
      if (skipped > 0) out.push(`${prefix}- … 另有 ${skipped} 行未列出（max_rows=${maxRows}）`)
    }

    const groups = section.groups || []
    if (groups.length) {
      for (const g of groups) {
        out.push('', `**${g.label || '分组'}**${g.note ? ` ${g.note}` : ''}`)
        pushRows(g.rows)
      }
    } else {
      pushRows(section.rows)
    }
    if (section.footer) out.push(`合计：${section.footer.map(cellText).join(' ｜ ')}`)
    if (!section.rows?.length && !groups.length && section.empty) out.push(`- ${section.empty}`)
    if (section.note) out.push(`注：${section.note}`)
  }

  let text = out.join('\n').trim() + '\n'
  if (text.length > MAX_TEXT) {
    text = text.slice(0, MAX_TEXT)
    const cut = text.lastIndexOf('\n')
    text = (cut > 0 ? text.slice(0, cut) : text) + `\n… 文本超过 ${MAX_TEXT} 字，已截断。请缩小日期范围或调小 max_rows。\n`
    truncated = true
  }
  return { text, rows, truncated }
}
