/**
 * 把八个工具 `--json` 的输出归一成同一份「报告模型」，交给浏览器端渲染。
 *
 * 模型（浏览器只认这一份，不再懂任何工具口径）：
 *   {
 *     tool, title, subtitle,
 *     kpis: [{ k, v, b, tone, hl }],
 *     alerts: [string], alertsEmpty,
 *     warnings: [string],
 *     sections: [
 *       { kind: 'kpis',   title, items: [kpi] },
 *       { kind: 'table',  title, tip, columns: [{label, align}], rows: [[cell]],
 *                         groups: [{ label, note, rows }], footer: [cell], empty, note },
 *       { kind: 'notes',  title, items: [string] },
 *       { kind: 'list',   title, tip, items: [{ no, label, tag, value, sub, ratio }], foot },
 *       { kind: 'configs',title, tip, items: [{ name, id, tag, lines: [string] }] },
 *     ],
 *     actions: { weeklyMd?: { start, end } },
 *   }
 *
 * cell：字符串，或 { t, tone?, bar?, sub?, tag?, link? }
 *   bar 是 0..1 的宽度（按 sqrt 缩放已在 Host 侧算好）
 */

/* ── 格式化（与原网页同一套规则）── */
const isNil = (v) => v == null || Number.isNaN(Number(v))
const money = (v, d = 2) => (isNil(v) ? '—' : Number(v).toFixed(d))
const num = (v, d = 2) => (isNil(v) ? '—' : Number(v).toFixed(d))
const int = (v) => (v == null ? '—' : String(v))
const pct = (v, d = 1) => (isNil(v) ? '—' : (Number(v) * 100).toFixed(d) + '%')

const cell = (t, opts = {}) => ({ t: String(t ?? ''), ...opts })
const barCell = (value, max, text, tone) => {
  const v = isNil(value) ? null : Number(value)
  const ratio = v == null || !(max > 0) ? null : Math.min(1, Math.sqrt(Math.max(0, v) / max))
  return { t: text, bar: ratio == null ? null : Number(ratio.toFixed(4)), tone: tone || '' }
}
const pctBar = (value, tone) => {
  const v = isNil(value) ? null : Number(value)
  return { t: v == null ? '—' : (v * 100).toFixed(0) + '%', bar: v == null ? null : Math.min(1, Math.max(0, v)), tone: tone || '' }
}
const statusTone = (label) => {
  const s = String(label || '')
  if (/✅/.test(s)) return 'ok'
  if (/⛔/.test(s)) return 'bad'
  if (/⚠️/.test(s)) return 'warn'
  return 'info'
}
const tagCell = (label, tone) => ({ t: String(label ?? '—').replace(/^[✅⛔⚠️]\s*/, '') || '—', tag: true, tone: tone || statusTone(label) })

const alertsSection = (alerts, empty) => ({
  alerts: Array.isArray(alerts) && alerts.length ? alerts.map(String) : [],
  alertsEmpty: empty,
})

/* ══════════════════ 1) 盯盘 ══════════════════ */
function normalizeMonitor(d) {
  const t = d.total || {}
  const breakeven = d.breakeven ?? 0.35
  const maxCost = Math.max(...(d.units || []).map((u) => u.crCost || 0), breakeven * 2)
  const statusOf = (id) => (d.status || []).find((s) => s.id === id)?.tag

  const rows = (d.units || []).map((u) => {
    const overTone = u.over == null ? '' : u.over >= 20 ? 'bad' : u.over >= 5 ? 'warn' : 'ok'
    const retTone = u.retRateYReg == null ? '' : u.retRateYReg < 0.05 ? 'bad' : u.retRateYReg < 0.10 ? 'warn' : 'ok'
    return [
      { t: u.name || '', sub: u.id },
      tagCell(statusOf(u.id)),
      money(u.cost),
      pctBar(u.budgetPct, u.budgetPct >= 0.2 ? 'ok' : 'bad'),
      int(u.reg),
      int(u.cr),
      pct(u.crRate),
      barCell(u.crCost, maxCost, money(u.crCost), overTone),
      u.over == null ? '—' : { t: `${u.over.toFixed(1)}×`, tag: true, tone: overTone },
      u.retRateYReg == null ? '—' : { t: pct(u.retRateYReg, 2), tag: Boolean(retTone), tone: retTone },
      cell(pct(u.retRateY), { tone: 'dim' }),
      cell(u.retToday > 0 ? int(u.retToday) : '—', { tone: 'dim' }),
    ]
  })

  const footer = [
    { t: '账户合计' }, '',
    money(t.cost), '',
    int(t.reg), int(t.cr), pct(t.crRate), money(t.crCost),
    t.over == null ? '—' : { t: `${t.over.toFixed(1)}×`, tag: true, tone: t.over >= 20 ? 'bad' : t.over >= 5 ? 'warn' : 'ok' },
    { t: pct(t.retRateYReg, 2), strong: true },
    pct(t.retRateY), '',
  ]

  const retRows = (d.yesterdayRetention || []).map((x) => {
    const tone = x.retRateReg == null ? 'info' : x.retRateReg < 0.05 ? 'bad' : x.retRateReg < 0.10 ? 'warn' : 'ok'
    return [
      x.name || '',
      int(x.reg), int(x.prevCr), int(x.yRet),
      { t: pct(x.retRateReg, 2), tag: true, tone },
      cell(pct(x.retRate), { tone: 'dim' }),
      x.rtCost == null ? cell('—', { tone: 'dim' }) : money(x.rtCost),
      cell(x.prevCr < 20 ? '样本不足' : 'OK', { tone: 'dim' }),
    ]
  })

  return {
    tool: 'monitor',
    title: '盯盘',
    subtitle: `${d.today || ''} · 账户 ${d.account || ''} · 保本线 ${breakeven} 元/创角`,
    kpis: [
      { k: '今日消耗', v: `${money(t.cost)} 元`, b: `保本线 ${breakeven} 元/创角` },
      { k: '今日创角', v: int(t.cr), b: `注册 ${int(t.reg)}｜创角率 ${pct(t.crRate)}` },
      { k: '创角成本', v: `${money(t.crCost)} 元`, b: t.over == null ? '' : `保本线的 ${t.over.toFixed(1)} 倍`, tone: t.over >= 20 ? 'bad' : t.over >= 5 ? 'warn' : 'good', hl: true },
      { k: '昨日次留率（后台）', v: pct(t.retRateYReg, 2), b: '÷ 昨日注册 · 与广告后台一致', hl: true },
      { k: '昨日次留率（÷创角）', v: pct(t.retRateY), b: `${d.y1} 队列 ÷ ${d.y2} 创角 · 权威`, tone: (t.retRateY ?? 0) < 0.10 ? 'bad' : 'good' },
      { k: '昨日次留成本', v: `${money(t.yRtCost)} 元`, b: '昨日消耗 ÷ 昨日次留人数' },
      { k: '在投单元', v: int((d.units || []).length), b: `异常 ${(d.alerts || []).length} 条`, tone: (d.alerts || []).length ? 'warn' : 'flat' },
    ],
    ...alertsSection(d.alerts, '本时点无异常'),
    warnings: [
      `「超标」= 创角成本 ÷ 保本线（每创角充值 ${breakeven} 元）。预算已花完是正常状态，真正要盯的是创角成本与次留率。`,
      `次留率两个分母都对：÷注册＝${pct(t.retRateYReg, 2)}（与广告后台一致）｜÷前日创角＝${pct(t.retRateY)}（权威）。差 ${t.denomRatio ? t.denomRatio.toFixed(2) : '≈3.3'} 倍，别混着比。`,
    ],
    sections: [
      {
        kind: 'table',
        title: '核心指标',
        tip: `次留率 ÷注册（同日，后台口径）｜÷创角（错位，权威）`,
        columns: [
          { label: '单元' }, { label: '状态' }, { label: '消耗' }, { label: '预算' },
          { label: '注册' }, { label: '创角' }, { label: '创角率' }, { label: '创角成本' },
          { label: '超标' }, { label: '次留率 ÷注册' }, { label: '次留率 ÷创角' }, { label: '今日次留' },
        ],
        rows,
        footer,
        empty: '窗口内无在投单元',
      },
      ...(retRows.length ? [{
        kind: 'table',
        title: '昨日完整次留',
        tip: `${d.y1} 队列 → ${d.today} 留存｜两个分母都列`,
        columns: [
          { label: '单元' }, { label: '昨日注册' }, { label: '前日创角' }, { label: '昨日次留' },
          { label: '次留率 ÷注册' }, { label: '次留率 ÷创角' }, { label: '次留成本' }, { label: '样本' },
        ],
        rows: retRows,
        note: '次留成本＝昨日消耗 ÷ 昨日次留人数；分子属于前日队列，与分母不是同一批人。',
      }] : []),
    ],
  }
}

/* ══════════════════ 2) 创角次留 ══════════════════ */
function normalizeRetention(d) {
  const t = d.total || {}
  const byDate = d.dim === 'date'
  const rows = d.rows || []
  const maxCrCost = Math.max(...rows.map((r) => r.crCost || 0), 1)
  const maxRt = Math.max(...rows.map((r) => r.retRate || 0), 0.25)

  const table = byDate
    ? {
        columns: [
          { label: '日期' }, { label: '消耗' }, { label: '注册' }, { label: '创角' }, { label: '创角率' },
          { label: '次留人数' }, { label: '次留率（对齐）' }, { label: '创角成本' }, { label: '同日（对照）' },
        ],
        rows: rows.map((r) => {
          const tone = r.retRate == null ? '' : r.retRate < 0.10 ? 'bad' : r.retRate < 0.15 ? 'warn' : 'ok'
          return [
            cell(r.date, { mono: true }), money(r.cost), int(r.reg), int(r.cr), pct(r.crRate), int(r.rt),
            { t: pct(r.retRate), bar: Math.min(1, (r.retRate || 0) / maxRt), tone },
            barCell(r.crCost, maxCrCost, money(r.crCost)),
            cell(pct(r.retRateSameDay), { tone: 'dim' }),
          ]
        }),
      }
    : {
        columns: [
          { label: d.dim === 'site_set' ? '版位' : '素材 ID' }, { label: '消耗' }, { label: '注册' }, { label: '创角' },
          { label: '创角率' }, { label: '次留人数' }, { label: '次留率' }, { label: '创角成本' },
        ],
        rows: rows.map((r) => {
          const tone = r.retRate == null ? '' : r.retRate < 0.10 ? 'bad' : r.retRate < 0.15 ? 'warn' : 'ok'
          return [
            cell(r.key, { mono: true }), money(r.cost), int(r.reg), int(r.cr), pct(r.crRate), int(r.rt),
            { t: pct(r.retRate), bar: Math.min(1, (r.retRate || 0) / maxRt), tone },
            barCell(r.crCost, maxCrCost, money(r.crCost)),
          ]
        }),
      }

  const ranked = byDate ? []
    : rows.filter((r) => r.retRate != null && r.cr > 0)
      .slice().sort((a, b) => b.retRate - a.retRate).slice(0, 15)
  const rankTop = ranked[0]?.retRate || 1

  const warnings = []
  if (d.tailIsToday) warnings.push(`窗口末尾 ${d.end} 是今天 → 末行次留率是半成品（D1 次留在次日全天累积）。`)
  if (d.selfCheck?.badDays > 0) warnings.push(`口径自检：有 ${d.selfCheck.badDays} 天「次留人数 > 同日创角」（最大 ${pct(d.selfCheck.worst)}）→ 必须用错位口径。`)

  return {
    tool: 'retention',
    title: '创角次留',
    subtitle: `${d.start} ~ ${d.end}${byDate ? '' : ` · ${d.dim === 'site_set' ? '按版位' : '按素材'}`}`,
    kpis: [
      { k: '消耗', v: `${money(t.cost)} 元`, b: `${d.start} ~ ${d.end}` },
      { k: '注册', v: int(t.reg), b: `创角 ${int(t.cr)}` },
      { k: '创角率', v: pct(t.crRate), b: '创角 ÷ 注册' },
      { k: '次留率', v: pct(t.retRate), b: byDate ? '对齐口径（权威）' : '÷ 创角（同窗口）', tone: (t.retRate ?? 0) < 0.12 ? 'warn' : 'good', hl: true },
      ...(byDate && t.retRateWin != null ? [{ k: '次留率（同窗口）', v: pct(t.retRateWin), b: '对照，放量期会偏低' }] : []),
      { k: '创角成本', v: `${money(t.crCost)} 元`, b: '消耗 ÷ 创角' },
      { k: '次留成本', v: `${money(t.rtCost)} 元`, b: '消耗 ÷ 次留人数' },
    ],
    alerts: [],
    alertsEmpty: '本窗口无异常',
    warnings,
    sections: [
      {
        kind: 'table',
        title: byDate ? '逐日明细' : (d.dim === 'site_set' ? '按版位' : '按素材'),
        tip: byDate ? '次留率 = retention_d1[D] ÷ 创角[D-1]（错位）' : '次留率 = retention_d1 ÷ 创角',
        ...table,
      },
      ...(ranked.length ? [{
        kind: 'list',
        title: '按次留率排序',
        tip: '样本 ≥20 创角才可比；不足 20 只作参考',
        items: ranked.map((r, i) => ({
          no: i + 1,
          label: r.key,
          tag: r.cr < 20 ? '样本不足' : '',
          value: pct(r.retRate),
          sub: `创角 ${int(r.cr)}`,
          ratio: Math.min(1, (r.retRate || 0) / rankTop),
        })),
        foot: `最好的是 ${ranked[0].key}（${pct(ranked[0].retRate)}，创角 ${int(ranked[0].cr)}）。素材择优不必等回传。`,
      }] : []),
    ],
  }
}

/* ══════════════════ 3) 注册留存 ══════════════════ */
function normalizeRegister(d) {
  const t = d.total || {}
  const rows = d.rows || []
  const maxRt = Math.max(...rows.map((r) => r.retRateReg || 0), 0.10)
  const maxRegCost = Math.max(...rows.map((r) => r.regCost || 0), 0.01)

  const warnings = []
  if (d.tailIsToday) warnings.push(`窗口末尾 ${d.end} 是今天 → 末行次留率是半成品。`)
  if (d.selfCheck?.badDays > 0) warnings.push(`口径自检：${d.selfCheck.badDays} 天「次留人数 > 同日创角」（最大 ${pct(d.selfCheck.worst)}）。`)
  const zr = d.selfCheck?.zeroRegDays || []
  if (zr.length) warnings.push(`有 ${zr.length} 天「有消耗但注册为 0」：${zr.join('、')} —— 先怀疑回传未到。`)

  const body = rows.map((r) => {
    const tone = r.retRateReg == null ? '' : r.retRateReg < 0.05 ? 'bad' : r.retRateReg < 0.10 ? 'warn' : 'ok'
    return [
      cell(r.date, { mono: true }), money(r.cost),
      { t: int(r.reg), strong: true },
      barCell(r.regCost, maxRegCost, money(r.regCost)),
      int(r.cr), cell(pct(r.crRate, 1), { tone: 'dim' }), int(r.rt),
      { t: pct(r.retRateReg, 2), bar: Math.min(1, (r.retRateReg || 0) / maxRt), tone },
      cell(pct(r.retRate, 1), { tone: 'dim' }),
      r.rtCost == null ? cell('—', { tone: 'dim' }) : money(r.rtCost),
    ]
  })

  return {
    tool: 'register',
    title: '注册留存',
    subtitle: `${d.start} ~ ${d.end} · 平台口径（注册 / 注册成本 / 次留）`,
    kpis: [
      { k: '消耗', v: `${money(t.cost)} 元`, b: `${d.start} ~ ${d.end}` },
      { k: '注册', v: int(t.reg), b: `注册成本 ${money(t.regCost)} 元`, hl: true },
      { k: '创角', v: int(t.cr), b: `创角率 ${pct(t.crRate, 1)}` },
      { k: '次留人数', v: int(t.rt), b: `次留成本 ${money(t.rtCost)} 元` },
      { k: '次留率（后台口径）', v: pct(t.retRateReg, 2), b: '次留 ÷ 注册 · 与广告后台一致', hl: true },
      { k: '次留率（÷创角）', v: pct(t.retRate, 2), b: '错位口径 · 权威', tone: (t.retRate ?? 0) < 0.12 ? 'warn' : 'good' },
      { k: '次留成本', v: `${money(t.rtCost)} 元`, b: '消耗 ÷ 次留人数' },
    ],
    alerts: [],
    alertsEmpty: '本窗口无异常',
    warnings,
    sections: [{
      kind: 'table',
      title: '逐日明细',
      tip: '左率＝后台口径（÷注册）｜右率＝权威口径（÷前一日创角）',
      columns: [
        { label: '日期' }, { label: '消耗' }, { label: '注册' }, { label: '注册成本' }, { label: '创角' },
        { label: '创角率' }, { label: '次留人数' }, { label: '次留率 ÷注册' }, { label: '次留率 ÷创角' }, { label: '次留成本' },
      ],
      rows: body,
      footer: [
        { t: '窗口合计' }, money(t.cost), int(t.reg), money(t.regCost), int(t.cr), pct(t.crRate, 1),
        int(t.rt), { t: pct(t.retRateReg, 2), strong: true }, pct(t.retRate, 2), money(t.rtCost),
      ],
      note: `两个次留率差 ${d.denomRatio ? d.denomRatio.toFixed(2) : '≈3.3'} 倍＝注册 ÷ 创角。平台报表没有 3留 / 7留 字段，3留/7留 只在格里芬里看。`,
    }],
  }
}

/* ══════════════════ 4) 创意数据 ══════════════════ */
function normalizeCreatives(d) {
  const t = d.total || {}
  const units = d.units || []
  const all = units.flatMap((u) => u.creatives || [])
  const maxCrCost = Math.max(...all.map((c) => c.crCost || 0), 1)
  const maxCost = Math.max(...all.map((c) => c.cost || 0), 1)
  const sug = d.suggest || {}
  const nPause = (sug.pause || []).length
  const nKeep = (sug.keep || []).length
  const nWatch = (sug.watch || []).length
  const sumCost = (list) => (list || []).reduce((a, c) => a + (c.cost || 0), 0)

  const creativeCell = (c) => ({
    t: c.name || '—',
    link: c.id ? { kind: 'asset', creativeId: c.id, name: c.name || '' } : null,
    sub: c.id,
  })

  const groups = units.map((u) => ({
    label: u.name,
    note: `消耗 ${money(u.cost)} 元 ｜ 注册 ${int(u.reg)} ｜ 创角 ${int(u.cr)}（率 ${pct(u.crRate)}） ｜ 创角成本 ${u.crCost == null ? '—' : money(u.crCost) + ' 元'} ｜ 次留 ${int(u.rt)} 人 ｜ 次留率 ÷注册 ${pct(u.retRateReg, 2)} / ÷创角 ${pct(u.retRate, 2)} ｜ 次留成本 ${u.rtCost == null ? '—' : money(u.rtCost) + ' 元'} ｜ ${(u.creatives || []).length} 条创意`,
    rows: (u.creatives || []).map((c) => {
      const crTone = c.crCost == null ? '' : c.crCost > 8 ? 'bad' : c.crCost > 3 ? 'warn' : 'ok'
      const rtTone = c.retRateReg == null ? 'info' : c.retRateReg < 0.05 ? 'bad' : c.retRateReg < 0.10 ? 'warn' : 'ok'
      return [
        creativeCell(c),
        barCell(c.cost, maxCost, money(c.cost)),
        int(c.imp), int(c.clk), cell(pct(c.ctr), { tone: 'dim' }),
        int(c.reg), int(c.cr), pct(c.crRate),
        c.crCost == null ? '—' : cell(money(c.crCost), { tone: crTone }),
        int(c.rt),
        { t: pct(c.retRateReg, 2), tag: true, tone: rtTone },
        cell(pct(c.retRate), { tone: 'dim' }),
        c.rtCost == null ? cell('—', { tone: 'dim' }) : money(c.rtCost),
        { t: c.verdict || '—', tag: true, tone: c.verdictTone || 'info', title: c.why || '' },
      ]
    }),
  }))

  const listOf = (arr, max, ratioOf, valueOf, subOf) => (arr || []).slice(0, 10).map((c, i) => ({
    no: i + 1,
    label: c.name || '—',
    tag: c.unit || '',
    value: valueOf(c),
    sub: subOf(c),
    ratio: Math.min(1, ratioOf(c)),
  }))

  const sections = []
  if (nPause) {
    sections.push({
      kind: 'list',
      title: '⛔ 建议暂停',
      tip: '创角成本 > 账户均值 2×，或花了钱零创角（判据相对账户均值）',
      items: (sug.pause || []).slice().sort((a, b) => b.cost - a.cost).map((c, i) => ({
        no: i + 1,
        label: c.name,
        tag: c.unit || '',
        value: `${money(c.crCost)} 元`,
        sub: `消耗 ${money(c.cost)}｜创角 ${int(c.cr)}｜次留 ${int(c.rt)}｜率 ${pct(c.retRateReg, 2)}/${pct(c.retRate)}`,
        ratio: Math.min(1, (c.cost || 0) / (maxCost || 1)),
        tone: 'bad',
      })),
      foot: `这 ${nPause} 条合计消耗 ${money(sumCost(sug.pause))} 元（占窗口 ${pct(sumCost(sug.pause) / (t.cost || 1))}）。创意级没有独立充值归因，比的是账户均值。`,
    })
  }

  sections.push({
    kind: 'table',
    title: '计划 × 创意明细',
    tip: '按计划分组、组内按消耗降序｜只列窗口内有消耗的创意',
    columns: [
      { label: '创意名' }, { label: '消耗' }, { label: '曝光' }, { label: '点击' }, { label: 'CTR' },
      { label: '注册' }, { label: '创角' }, { label: '创角率' }, { label: '创角成本' }, { label: '次留' },
      { label: '次留率 ÷注册' }, { label: '次留率 ÷创角' }, { label: '次留成本' }, { label: '建议' },
    ],
    rows: [],
    groups,
    empty: '窗口内没有创意消耗 —— 换个日期区间试试。',
    note: `次留率 ÷注册＝广告后台口径（账户 ${pct(t.retRateReg, 2)}）｜÷创角＝对齐口径（分母 ${d.alignedStart || ''} ~ ${d.alignedEnd || ''} 的创角，权威 ${pct(t.retRate, 2)}）。次留成本＝消耗 ÷ 次留人数。`,
  })

  const rk = d.ranked || {}
  if ((rk.byCrCost || []).length) {
    sections.push({
      kind: 'list',
      title: '创角成本最优',
      tip: `样本 ≥${rk.minSample ?? 5} 创角才纳入`,
      items: listOf(rk.byCrCost, 0,
        (c) => (rk.byCrCost[0].crCost / (c.crCost || 1)),
        (c) => `${money(c.crCost)} 元`,
        (c) => `创角 ${int(c.cr)}｜次留 ${int(c.rt)}｜率 ${pct(c.retRateReg, 2)}/${pct(c.retRate)}`),
      foot: `最便宜的一条是 ${rk.byCrCost[0].name}（${money(rk.byCrCost[0].crCost)} 元/创角，创角 ${int(rk.byCrCost[0].cr)}）。`,
    })
  }
  if ((rk.byRetRate || []).length) {
    sections.push({
      kind: 'list',
      title: '次留率最优',
      tip: `样本 ≥${rk.minSample ?? 5} 创角｜按 ÷创角 排序`,
      items: listOf(rk.byRetRate, 0,
        (c) => ((c.retRate || 0) / (rk.byRetRate[0].retRate || 1)),
        (c) => pct(c.retRate, 2),
        (c) => `÷注册 ${pct(c.retRateReg, 2)}｜创角 ${int(c.cr)}｜${money(c.crCost)} 元/创角`),
      foot: `最好的是 ${rk.byRetRate[0].name}（÷创角 ${pct(rk.byRetRate[0].retRate, 2)}）。排序只用对齐的 ÷创角，÷注册 混着创角率。`,
    })
  }
  if ((rk.byRtCost || []).length) {
    sections.push({
      kind: 'list',
      title: '次留成本最低',
      tip: `样本 ≥${rk.rtMinSample ?? 3} 个次留人数`,
      items: listOf(rk.byRtCost, 0,
        (c) => (rk.byRtCost[0].rtCost / (c.rtCost || 1)),
        (c) => `${money(c.rtCost)} 元`,
        (c) => `次留 ${int(c.rt)} 人｜消耗 ${money(c.cost)}｜创角 ${int(c.cr)}`),
      foot: `最值的是 ${rk.byRtCost[0].name}：${money(rk.byRtCost[0].rtCost)} 元/次留。合成指标，与创角成本榜对着看。`,
    })
  }

  const warnings = []
  if (d.tailIsToday) warnings.push(`窗口末尾 ${d.end} 是今天 → 末段数据未跑完。`)

  return {
    tool: 'creatives',
    title: '创意数据',
    subtitle: `${d.start} ~ ${d.end} · 计划 × 创意`,
    kpis: [
      { k: '消耗', v: `${money(t.cost)} 元`, b: `${d.start} ~ ${d.end}` },
      { k: '计划 / 创意', v: `${units.length} / ${all.length}`, b: '窗口内有消耗' },
      { k: '注册', v: int(t.reg), b: `创角 ${int(t.cr)}（率 ${pct(t.crRate)}）` },
      { k: '创角成本', v: `${money(t.crCost)} 元`, b: '消耗 ÷ 创角', hl: true },
      { k: '次留人数', v: int(t.rt), b: `次留成本 ${money(t.rtCost)} 元` },
      { k: '次留率（后台）', v: pct(t.retRateReg, 2), b: '次留 ÷ 注册', hl: true },
      { k: '次留率（÷创角）', v: pct(t.retRate, 2), b: '权威口径' },
      { k: '⛔ 建议暂停', v: `${nPause} 条`, b: nPause ? `${money(sumCost(sug.pause))} 元待停` : '没有该停的', tone: nPause ? 'bad' : 'flat' },
      { k: '✅ 建议继续', v: `${nKeep} 条`, b: `⚠️ 观察 ${nWatch} 条` },
    ],
    alerts: [],
    alertsEmpty: '本窗口无异常',
    warnings,
    sections,
  }
}

/* ══════════════════ 5) 保本出价 ══════════════════ */
function normalizeCeiling(d) {
  const g = d.game || {}
  const p = d.platform || {}
  const maxLtv = Math.max(...(d.targets || []).map((t) => Math.max(t.ltv || 0, t.ltvReg || 0)), 1)
  const ex = d.excludedAdIds?.total ? d.excludedAdIds : null

  return {
    tool: 'ceiling',
    title: '保本出价',
    subtitle: `${d.start} ~ ${d.end} · 目标人群 LTV 上限`,
    kpis: [
      { k: '创角队列', v: int(g.cohort), b: `${d.start} ~ ${d.end}｜日均 ${num(g.perDay, 1)}` },
      { k: '每创角充值', v: `${money(g.perRoleRecharge, 4)} 元`, b: `队列累计 ${money(g.totalRecharge)} 元`, hl: true },
      { k: '平台创角率', v: p.roleRate == null ? '—' : pct(p.roleRate), b: p.reg ? `注册 ${int(p.reg)} → 创角 ${int(p.role)}` : '未读到平台凭证', tone: p.roleRate == null ? 'warn' : 'good' },
      { k: '平台创角成本', v: p.roleCost == null ? '—' : `${money(p.roleCost)} 元`, b: p.cost ? `消耗 ${money(p.cost)} 元` : '' },
    ],
    alerts: [],
    alertsEmpty: '本窗口无异常',
    warnings: ['必须用成熟队列（距今 ≥30 天），否则 LTV 未成熟会系统性低估上限。'],
    sections: [{
      kind: 'table',
      title: '目标价值表',
      tip: '保本上限 = 该目标人群的累计人均充值（LTV）；出价 ≤ 它才不亏',
      columns: [
        { label: '优化目标' }, { label: '转化率' }, { label: '人群付费率' }, { label: '保本上限·按创角' },
        { label: '保本上限·按注册' }, { label: '日均样本' }, { label: '学习期' },
      ],
      rows: (d.targets || []).map((t) => {
        const tone = String(t.feasible || '').includes('✅') ? 'ok' : String(t.feasible || '').includes('⚠️') ? 'warn' : 'bad'
        return [
          { t: t.name || '', sub: t.note || '' },
          pct(t.rate, 2),
          pct(t.payRate, 2),
          barCell(t.ltv, maxLtv, num(t.ltv, 4), String(t.name || '').includes('D1 次留') ? 'ok' : ''),
          t.ltvReg == null ? '—' : num(t.ltvReg, 4),
          num(t.daily, 2),
          { t: String(t.feasible || '').replace(/^[✅⚠️⛔]\s*/, ''), tag: true, tone },
        ]
      }),
      note: '游戏后台的「注册」＝平台的「创角」。日均样本 < 2.9 的目标不要单独开单元，学习期跑不出来。',
    }, ...(ex ? [{
      kind: 'notes',
      title: '已排除的非单元 adId',
      items: [
        `队列已排除 ${int(ex.total)} 人 / ${(ex.items || []).length} 个非单元 ID：${(ex.items || []).map((x) => `${x.id} ${int(x.n)} 人`).join(' ｜ ')}`,
        '真实营销单元 ID 为 11~12 位数字；default 是游戏侧的无归因占位值，混进来会把队列基数与人均充值算歪。',
      ],
    }] : [])],
  }
}

/* ══════════════════ 6) 单元 LTV 判定 ══════════════════ */
function normalizeUnits(d) {
  const c = d.counts || {}
  const active = (d.units || []).filter((u) => u.gameReg >= 100 && u.ratio != null)
  const maxRatio = Math.max(...active.map((u) => u.ratio), 1.2)
  const pay = d.pay || {}
  const L = pay.live || null
  const A = pay.all || null
  const ex = d.excludedAdIds?.total ? d.excludedAdIds : null

  const rows = (d.units || []).slice(0, 40).map((u) => {
    const rtone = u.ratio == null ? '' : u.ratio >= 1 ? 'ok' : u.ratio >= 0.5 ? 'warn' : 'bad'
    const dlabel = u.delivery || u.sys || '—'
    const dtone = /投放中/.test(dlabel) ? 'ok' : /暂停|已删/.test(dlabel) ? 'bad' : 'info'
    return [
      cell(u.id, { mono: true }),
      u.name || '',
      { t: dlabel, tag: true, tone: dtone },
      money(u.platCost), int(u.gameReg),
      u.cac == null ? '—' : num(u.cac, 3),
      int(u.payers),
      u.payRate == null ? cell('—', { tone: 'dim' }) : pct(u.payRate, 2),
      money(u.amt),
      u.arppu == null ? '—' : num(u.arppu, 2),
      u.ltv == null ? '—' : num(u.ltv, 4),
      { t: u.ratio == null ? '—' : pct(u.ratio), bar: u.ratio == null ? null : Math.min(1, u.ratio / maxRatio), tone: rtone },
      tagCell(u.v),
    ]
  })

  return {
    tool: 'units',
    title: '单元 LTV 判定',
    subtitle: `${d.start} ~ ${d.end} · LTV ÷ CAC`,
    kpis: [
      { k: '平台消耗合计', v: `${money(d.platTotal)} 元`, b: `${d.start} ~ ${d.end}` },
      { k: '可判定单元', v: int(active.length), b: '游戏侧创角 ≥100', hl: true },
      { k: '✅ 加量', v: int(c.scaleUp || 0), b: 'LTV÷CAC ≥ 100%', tone: c.scaleUp ? 'good' : 'flat' },
      { k: '⚠️ 维持观察', v: int(c.watch || 0), b: '50% ~ 100%', tone: c.watch ? 'warn' : 'flat' },
      { k: '⛔ 停/降', v: int(c.stop || 0), b: '< 50%', tone: c.stop ? 'bad' : 'flat' },
      { k: '样本不足', v: int(c.thin || 0), b: '创角 <100，不判定' },
      { k: '无投放', v: int(c.noSpend || 0), b: '窗口内 0 消耗' },
      { k: '窗口外', v: int(c.outOfWindow || 0), b: '起投日晚于窗口末日' },
    ],
    alerts: [],
    alertsEmpty: '本窗口无异常',
    warnings: ['必须用成熟队列（创角距今 ≥30 天）。近期窗口只能做早期预警。', '「投放状态」列看的是单元当下状态，与窗口无关；「窗口外」不等于单元停了。'],
    sections: [
      ...(L ? [{
        kind: 'kpis',
        title: '付费情况',
        items: [
          { k: '付费人数', v: `${int(L.payers)} 人`, b: `创角 ${int(L.gameReg)}｜付费率 ${pct(L.payRate, 2)}`, hl: true },
          { k: '真实充值', v: `${money(L.amt)} 元`, b: '创角队列累计，截至今日' },
          { k: 'ARPPU', v: `${money(L.arppu)} 元`, b: '充值 ÷ 付费人数' },
          { k: 'LTV/创角', v: L.ltv == null ? '—' : `${num(L.ltv, 4)} 元`, b: '判定用它' },
          { k: '真实 ROI', v: pct(L.roi, 2), b: '充值 ÷ 平台消耗', tone: L.roi == null ? 'flat' : L.roi >= 1 ? 'good' : 'bad' },
          { k: '有付费单元', v: A ? `${int(A.paying)} / ${int(A.units)}` : '—', b: '全部单元（含历史队列）' },
        ],
      }] : []),
      {
        kind: 'table',
        title: '单元判定表',
        tip: 'CAC = 平台消耗 ÷ 游戏侧创角；LTV = 该单元创角队列的累计充值 ÷ 创角',
        columns: [
          { label: '单元 ID' }, { label: '名称' }, { label: '投放状态' }, { label: '平台消耗' }, { label: '游戏创角' },
          { label: 'CAC' }, { label: '付费人数' }, { label: '付费率' }, { label: '真实充值' }, { label: 'ARPPU' },
          { label: 'LTV/创角' }, { label: 'LTV÷CAC' }, { label: '判定' },
        ],
        rows,
        empty: '窗口内无可判定单元',
        note: `${(d.units || []).length > 40 ? `共 ${d.units.length} 个单元，只显示消耗前 40 个。` : ''}判定线：≥100% 加量｜50%~100% 观察｜<50% 停/降。样本 <100 创角一律「样本不足」。`,
      },
      ...(ex ? [{
        kind: 'notes',
        title: '已排除的非单元 adId',
        items: [`共排除 ${int(ex.total)} 人 / ${(ex.items || []).length} 个非单元 ID：${(ex.items || []).map((x) => `${x.id} ${int(x.n)} 人`).join(' ｜ ')}`],
      }] : []),
    ],
  }
}

/* ══════════════════ 7) 定向监控 ══════════════════ */
function normalizeTargeting(d) {
  const units = d.units || []
  const COL = d.columns || []
  const snap = d.snapshot || {}
  const aud = d.audience
  const withDiff = units.filter((u) => (u.diffs || []).length)
  const noGender = units.filter((u) => u.cells?.gender?.unset)
  const changes = snap.changes || []

  const audTable = (title, list, tip) => {
    const maxShare = Math.max(...(list || []).map((x) => x.share || 0), 0.01)
    return {
      kind: 'table',
      title,
      tip,
      columns: [
        { label: '维度' }, { label: '消耗' }, { label: '消耗占比' }, { label: '注册' },
        { label: '创角' }, { label: '创角成本' }, { label: '次留' }, { label: '次留率' },
      ],
      rows: (list || []).map((x) => {
        const crCost = x.cr ? x.cost / x.cr : null
        const retRate = x.cr ? x.ret / x.cr : null
        const tone = retRate == null ? '' : retRate < 0.10 ? 'bad' : retRate < 0.15 ? 'warn' : 'ok'
        return [
          x.name,
          money(x.cost),
          { t: pct(x.share), bar: Math.min(1, (x.share || 0) / maxShare) },
          int(x.reg), int(x.cr),
          crCost == null ? '—' : money(crCost),
          int(x.ret),
          retRate == null ? '—' : { t: pct(retRate), tag: true, tone },
        ]
      }),
      empty: '窗口内无数据',
    }
  }

  const unsetCount = {}
  units.forEach((u) => (u.unsetExtra || []).forEach((k) => { unsetCount[k] = (unsetCount[k] || 0) + 1 }))
  const allUnset = Object.entries(unsetCount).filter(([, n]) => n === units.length).map(([k]) => k)
  const ownUnset = units.map((u) => {
    const own = (u.unsetExtra || []).filter((k) => !allUnset.includes(k))
    return own.length ? `${u.name}：${own.join('、')}` : ''
  }).filter(Boolean)

  const noteItems = []
  if (allUnset.length) noteItems.push(`【${units.length} 个单元全部未设】${allUnset.join('、')}`)
  noteItems.push(...ownUnset)
  if (!noteItems.length) noteItems.push('无各单元特有的未设项。')
  noteItems.push('「未设」≠「投给了所有人」：oCPC 下系统会按转化目标自行收敛人群，未设只是没有硬约束。')

  const sections = [{
    kind: 'table',
    title: '定向配置一览',
    tip: '我们要求系统去找什么人',
    columns: [
      { label: '单元（后台全称）' },
      ...COL.map((c) => ({ label: c.label + (c.hasExpect ? '（有期望）' : '') })),
      { label: '版位' }, { label: '差异' },
    ],
    rows: units.map((u) => [
      { t: u.name || '', sub: `${u.id} · ${u.conf || ''}${u.sys ? ' / ' + u.sys : ''}` },
      ...COL.map((c) => {
        const x = (u.cells || {})[c.key] || {}
        const tone = x.unset ? 'info' : (c.hasExpect ? (x.mark === '✅' ? 'ok' : 'warn') : '')
        return x.unset ? { t: '未设', tag: true, tone } : (tone ? { t: x.shown, tag: true, tone } : { t: x.shown, mono: true })
      }),
      cell((u.siteSet || []).map((s) => String(s).replace('SITE_SET_', '')).join('+') || '—', { tone: 'dim' }),
      (u.diffs || []).length ? { t: `${u.diffs.length} 项`, tag: true, tone: 'warn' } : { t: '一致', tag: true, tone: 'ok' },
    ]),
    empty: '没有符合条件的单元',
  }]

  if (aud && aud.total > 0) {
    sections.push(audTable('实际人群画像 · 性别', aud.gender, `${aud.start} ~ ${aud.end}（T+1）· 合计 ${money(aud.total)} 元`))
    sections.push(audTable('实际人群画像 · 年龄', aud.age, '平台固定分段（≤18/19-24/25-29/30-39/40-49/50+），不随定向区间切分'))
    sections.push(audTable('实际人群画像 · 省份', (aud.region || []).slice(0, 15), '按消耗 Top 15'))
  }

  if (withDiff.length) {
    sections.push({
      kind: 'notes',
      title: '与期望值的差异',
      items: [
        ...withDiff.flatMap((u) => (u.diffs || []).map((x) => `${u.name}：${x}`)),
        `期望值来自账户硬规则：${d.ruleNote?.gender || ''}；${d.ruleNote?.age || ''}。年龄期望值与实测配置不一致，这个口径需要人工拍板 —— 只并排摆出，不判合规。`,
      ],
    })
  }

  sections.push({
    kind: 'notes',
    title: '配置变更侦测',
    items: !snap.prevDate
      ? [`首次运行，暂无历史快照可比。本次快照已写入 ${snap.written || ''}，明天起就能抓到改动。`]
      : changes.length
        ? changes.map(String)
        : [`✅ 与 ${snap.prevDate} 快照相比无变化（定向一个字都没被改）。`],
  })

  sections.push({ kind: 'notes', title: '未设维度', items: noteItems })

  return {
    tool: 'targeting',
    title: '定向监控',
    subtitle: `${units.length} 个单元 · ${d.onlyActive ? '仅在投' : '含暂停/历史'}`,
    kpis: [
      { k: '单元数', v: int(units.length), b: d.onlyActive ? '仅在投（configured=NORMAL）' : '含暂停/历史单元' },
      { k: '与期望有差异', v: int(withDiff.length), b: withDiff.length ? '只列出，不判合规' : '全部一致', tone: withDiff.length ? 'warn' : 'good' },
      { k: '性别未设', v: int(noGender.length), b: noGender.length ? '未设 = 男女不限' : '均已限男', tone: noGender.length ? 'bad' : 'good', hl: true },
      { k: '配置变更', v: snap.prevDate ? int(changes.length) : '—', b: snap.prevDate ? `对比 ${snap.prevDate} 快照` : '首次快照，明天起可比', tone: changes.length ? 'warn' : 'flat' },
    ],
    alerts: [],
    alertsEmpty: '本窗口无异常',
    warnings: [],
    sections,
  }
}

/* ══════════════════ 8) 周报 ══════════════════ */
function normalizeWeekly(d) {
  const t = d.total || {}
  const groups = d.groups || []
  const daily = d.daily || []
  const dates = (d.late && d.late.dates) || []
  const shortDate = (s) => String(s || '').slice(5)
  const maxCost = Math.max(...groups.map((g) => g.cost || 0), 0.01)
  const lateWeek = d.late?.acct?.week || 0

  const sections = [{
    kind: 'table',
    title: '① 账户逐日',
    tip: '次留率 = 次留 ÷ 前一日创角（错位队列）；付费 = 点击归因',
    columns: [
      { label: '日期' }, { label: '花费' }, { label: '曝光' }, { label: '点击' }, { label: 'CTR' },
      { label: '转化' }, { label: '转化成本' }, { label: '注册' }, { label: '创角' }, { label: '次留' },
      { label: '次留率' }, { label: '付费人数' }, { label: '付费金额' },
    ],
    rows: daily.map((r) => [
      cell(r.date, { mono: true }), money(r.cost), int(r.view), int(r.click), pct(r.ctr, 2),
      int(r.conv), money(r.convCost),
      { t: int(r.reg), strong: true },
      int(r.cr), int(r.rt), cell(pct(r.rtRate, 1), { tone: 'dim' }),
      r.pay == null ? cell('—', { tone: 'dim' }) : int(r.pay),
      r.payAmt == null ? cell('—', { tone: 'dim' }) : money(r.payAmt),
    ]),
  }, {
    kind: 'table',
    title: '② 广告组窗口汇总',
    tip: '高亮行 = ROI 深度目标组；「—」= 未回传',
    columns: [
      { label: '组' }, { label: '花费' }, { label: '曝光' }, { label: 'CTR' }, { label: '转化' }, { label: '转化成本' },
      { label: '注册' }, { label: '创角' }, { label: '次留' }, { label: '次留率' }, { label: '付费人数' }, { label: '付费金额' },
    ],
    rows: groups.map((g) => [
      { t: g.name || '', sub: `${g.id}${g.isROI ? ' · 深度目标' : ''}` },
      { ...barCell(g.cost, maxCost, money(g.cost)), sub: `占比 ${pct(g.share, 1)}` },
      int(g.view), pct(g.ctr, 2), int(g.conv), money(g.convCost),
      int(g.reg), int(g.cr), int(g.rt), cell(pct(g.rtRate, 1), { tone: 'dim' }),
      g.pay == null ? cell('—', { tone: 'dim' }) : int(g.pay),
      g.payAmt == null ? cell('—', { tone: 'dim' }) : money(g.payAmt),
    ]),
  }, {
    kind: 'table',
    title: '③ 时段 · 每日消耗尖峰小时',
    columns: [{ label: '组' }, ...dates.map((dt) => ({ label: shortDate(dt) }))],
    rows: (d.peaks || []).map((p) => [
      { t: p.name || '', sub: p.id },
      ...p.days.map((x) => cell(x.peak, { tone: 'dim' })),
    ]),
  }, {
    kind: 'table',
    title: '③ 时段分桶（窗口花费·元）',
    columns: [{ label: '组' }, ...(d.buckets || []).map((b) => ({ label: b })), { label: '22–24占比' }],
    rows: (d.hourRows || []).map((r) => [
      r.name,
      ...(r.vals || []).map((v) => money(v, v < 10 ? 1 : 0)),
      cell(pct(r.lateShare, 0), { tone: 'dim' }),
    ]),
  }, {
    kind: 'table',
    title: '③ 深夜观察位：22–24 点逐日花费（元）',
    columns: [{ label: '组' }, ...dates.map((dt) => ({ label: shortDate(dt) })), { label: '周计' }],
    rows: ((d.late && d.late.rows) || []).map((r) => [
      r.name,
      ...(r.vals || []).map((v) => (v >= 0.05 ? money(v, 1) : cell('0', { tone: 'dim' }))),
      barCell(r.week, Math.max(...((d.late.rows || []).map((x) => x.week || 0)), 1), money(r.week, 1)),
    ]),
    footer: [
      { t: '账户 22–24 合计' },
      ...((d.late?.acct?.vals) || []).map((v) => money(v, 1)),
      { t: money(d.late?.acct?.week, 1), strong: true },
    ],
  }, {
    kind: 'configs',
    title: '④ 计划配置快照',
    tip: '定向 × 时段 × 出价（取自 adgroups/get，本窗口有花费的组在前）',
    items: groups.map((g) => ({
      name: g.name,
      id: g.id,
      tag: g.isROI ? '深度目标' : '',
      expired: Boolean(g.begin && g.end && g.end <= (dates[dates.length - 1] || '')),
      lines: [
        `状态 ${String(g.status || '—').replace('AD_STATUS_', '')} ｜ 出价 ${money(g.bid)} 元 ｜ 日预算 ${g.budget == null ? '不限' : money(g.budget) + ' 元'}`,
        `目标 ${g.goal || '—'}${g.deep ? `｜深度 ${g.deep}` : ''}`,
        `版位 ${g.siteAuto ? '自动' : ((g.siteSet || []).map((s) => String(s).replace('SITE_SET_', '')).join('+') || '—')}`,
        `时段 ${g.timeText || '—'}`,
        `定向 ${g.targetingText || '—'}`,
        `投放日期 ${g.begin || '—'} ~ ${g.end || '—'}`,
      ],
    })),
  }]

  return {
    tool: 'weekly',
    title: '周报',
    subtitle: `${d.start} ~ ${d.end} · 账户 ${d.account || ''}`,
    kpis: [
      { k: '窗口花费', v: `${money(t.cost)} 元`, b: `${d.start} ~ ${d.end}` },
      { k: '转化成本', v: t.convCost == null ? '—' : `${money(t.convCost)} 元`, b: `转化 ${int(t.conv)}`, hl: true },
      { k: 'CTR', v: pct(t.ctr, 2), b: `点击 ${int(t.click)} / 曝光 ${int(t.view)}` },
      { k: '22–24点深夜位', v: `${money(lateWeek)} 元`, b: lateWeek < 1 ? '连续为 0 → 预算被 21 点档吃光' : '旧组深夜放量', tone: lateWeek < 1 ? 'warn' : 'good' },
    ],
    ...alertsSection(d.alerts, '本窗口无异常'),
    warnings: ['窗口末日的次留 / 付费还没结算完会偏低；"—" = 未回传，不当 0 看。'],
    sections,
    actions: { weeklyMd: { start: d.start, end: d.end, account: d.account } },
  }
}

/* ══════════════════ 分派 ══════════════════ */

const NORMALIZERS = {
  monitor: normalizeMonitor,
  retention: normalizeRetention,
  register: normalizeRegister,
  creatives: normalizeCreatives,
  weekly: normalizeWeekly,
  ceiling: normalizeCeiling,
  units: normalizeUnits,
  targeting: normalizeTargeting,
}

export function normalize(tool, data) {
  const fn = NORMALIZERS[tool]
  if (!fn) throw new Error(`没有为 ${tool} 配置渲染器`)
  return fn(data || {})
}
