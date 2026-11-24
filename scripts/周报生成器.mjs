#!/usr/bin/env node
/**
 * 周报生成器.mjs — 最近一周固定模板日报（时段/定向/计划 × 留存/付费/CTR）
 *
 * 用法:
 *   node tools/ad-tools/周报生成器.mjs                # 默认：截止=昨天，窗口=最近7个整天
 *   node tools/ad-tools/周报生成器.mjs 2026-10-13     # 指定窗口起日（7天）
 *   node tools/ad-tools/周报生成器.mjs 2026-10-13 2026-10-19   # 指定起止
 *   账户由环境变量 MKT_ACCOUNT_ID 指定（与其它七个工具同一套）
 *
 * 输出:
 *   默认   stdout = 完整 Markdown；同时写 doc/广告数据分析_<今天>/账户<acc>_最近一周日报_<今天>.md
 *   --md   stdout 只出 Markdown（网页端「下载日报.md」用）
 *   --json stdout 末行出单行 JSON（网页端渲染用，server runTool 约定）
 *   --no-save 不写 doc 文件
 *
 * 凭证: MKT_ACCESS_TOKEN 环境变量 → 仓库 tmp/tencentads_credentials.json → 看板 tokens.json（兜底）
 *
 * 口径（沿用 REFERENCE / 速查）:
 *   - 次留率 = retention_d1[D] ÷ 创角[D-1]（错位队列口径）
 *   - 付费 = 点击归因 purchase_dedup_clk_pv / purchase_clk_amount（分）/ purchase_clk_roi
 *   - T+1 未收盘的次日留存/付费会偏低，逐日表按 API 原样列出；「待补」列不做推断
 *   - 深度指标缺失（字段返回 undefined）显示 "—"，不当 0 处理
 *   - 时段：hourly_reports 按组分桶；22–24 时旧组消耗单列（深夜放量观察位）
 *   - 单元列表不可信（会漏刚建/过期单元）→ 按 ID 逐查 + 报表出现过的 ID 合并
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── 配置 ──
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TMP = process.env.AD_TOOLS_TMP || path.join(REPO, "tmp");
const CRED_FILE = path.join(TMP, "tencentads_credentials.json");            // 仓库统一凭证（与其它七个工具同源）
const DASH_TOKENS = path.join(REPO, "tools", "adq-dashboard", "data", "tokens.json"); // 看板 Token（兜底）
const ACCOUNT = /^\d{5,12}$/.test(String(process.env.MKT_ACCOUNT_ID || "").trim())
  ? String(process.env.MKT_ACCOUNT_ID).trim() : "";
if (!ACCOUNT) { console.error("未指定广告账户：请设置 MKT_ACCOUNT_ID"); process.exit(1); }
const TODAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); // 北京日
const shift = (d, n) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);

// 窗口：默认 [昨天-6, 昨天]
let [S, E] = process.argv.slice(2).filter(a => !a.startsWith("--"));
if (!S && !E) { E = shift(TODAY, -1); S = shift(E, -6); }
else if (S && !E) { E = shift(S, 6); }
const SAVE = !process.argv.includes("--no-save");
const JSON_OUT = process.argv.includes("--json");   // 网页端模式：stdout 末行出单行 JSON
const MD_OUT = process.argv.includes("--md");       // 下载模式：stdout 只出 Markdown

// ── 凭证：MKT_ACCESS_TOKEN 环境变量 → 仓库 tmp 凭证 → 看板 tokens.json（兜底）──
function resolveToken() {
  if (process.env.MKT_ACCESS_TOKEN) return { access_token: process.env.MKT_ACCESS_TOKEN, src: "env" };
  try {
    const c = JSON.parse(fs.readFileSync(CRED_FILE, "utf8").replace(/^﻿/, ""));
    if (c.access_token) return { access_token: c.access_token, src: "tmp凭证", expire: c.expire_time };
  } catch { }
  try {
    const list = JSON.parse(fs.readFileSync(DASH_TOKENS, "utf8"));
    const toks = Array.isArray(list) ? list : (list.tokens || []);
    const t = toks.find(x => x.isDefault) || toks[0];
    if (t && t.accessToken) return { access_token: t.accessToken, src: "看板tokens.json", expire: t.expire };
  } catch { }
  return null;
}
const CRED = resolveToken();
if (!CRED) { console.error("无可用 access_token（tmp/tencentads_credentials.json 与看板 tokens.json 均未找到）"); process.exit(1); }
if (CRED.expire && new Date(CRED.expire) < new Date()) console.error(`⚠️ token 已于 ${CRED.expire} 过期，先刷新凭证`);

async function api(p, q = {}) {
  let last;
  for (let i = 0; i < 3; i++) {
    // nonce 须全局唯一（重复报 31xxx "nonce has been used before"），每次重试重新生成
    const qs = new URLSearchParams({
      access_token: CRED.access_token, timestamp: String(Math.floor(Date.now() / 1000)),
      nonce: Date.now().toString(36) + Math.random().toString(36).slice(2, 10),
      ...Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined)),
    });
    const j = await (await fetch(`https://api.e.qq.com${p}?${qs}`)).json();
    if (j.code === 0) return j.data;
    last = j;
    await new Promise(x => setTimeout(x, 1500));
  }
  throw new Error(`${p} → ${last.code} ${last.message_cn || last.message}`);
}
async function getAll(p, q, key = "list") {
  const out = [];
  for (let page = 1; ; page++) {
    const d = await api(p, { ...q, page: String(page), page_size: "100" });
    out.push(...(d?.[key] || []));
    if (!d?.page_info || out.length >= d.page_info.total_number) break;
  }
  return out;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const DAILY_F = ["date", "cost", "view_count", "valid_click_count", "conversions_count",
  "mini_game_register_users", "mini_game_create_role_users", "mini_game_retention_d1",
  "purchase_dedup_clk_pv", "purchase_clk_amount", "purchase_clk_roi"];
const AG_F = ["adgroup_id", ...DAILY_F.filter(f => f !== "date")];

(async () => {
  const S1 = shift(S, -1);

  // 1) 账户逐日（多取前一日做次留分母）
  const acctDaily = await getAll("/v3.0/daily_reports/get", {
    account_id: ACCOUNT, level: "REPORT_LEVEL_ADVERTISER",
    date_range: JSON.stringify({ start_date: S1, end_date: E }),
    group_by: JSON.stringify(["date"]), fields: JSON.stringify(DAILY_F),
  });

  // 2) 组 × 逐日
  const agDaily = await getAll("/v3.0/daily_reports/get", {
    account_id: ACCOUNT, level: "REPORT_LEVEL_ADGROUP",
    date_range: JSON.stringify({ start_date: S1, end_date: E }),
    group_by: JSON.stringify(["date", "adgroup_id"]), fields: JSON.stringify(["adgroup_id", ...DAILY_F]),
  });

  // 3) 组 × 时段（hourly，逐日查询并记日期）
  const hourly = [];
  for (let d = S; d <= E; d = shift(d, 1)) {
    const rows = await getAll("/v3.0/hourly_reports/get", {
      account_id: ACCOUNT, level: "REPORT_LEVEL_ADGROUP",
      date_range: JSON.stringify({ start_date: d, end_date: d }),
      group_by: JSON.stringify(["hour", "adgroup_id"]),
      fields: JSON.stringify(["hour", "adgroup_id", "cost", "view_count", "valid_click_count", "conversions_count"]),
    });
    for (const r of rows) r.date = d;
    hourly.push(...rows);
    await sleep(700);
  }

  // 4) 组配置（列表会漏 → 报表 ID 并集逐查）
  const ids = [...new Set(agDaily.map(x => String(x.adgroup_id)))];
  const agConf = [];
  for (const id of ids) {
    try {
      const d = await getAll("/v3.0/adgroups/get", {
        account_id: ACCOUNT,
        filtering: JSON.stringify([{ field: "adgroup_id", operator: "EQUALS", values: [id] }]),
        fields: JSON.stringify(["adgroup_id", "adgroup_name", "configured_status", "bid_amount", "daily_budget",
          "optimization_goal", "deep_conversion_spec", "time_series",
          "site_set", "automatic_site_enabled", "targeting", "begin_date", "end_date"]),
      });
      if (d[0]) agConf.push(d[0]);
    } catch (e) { console.error(`  单元 ${id} 配置读取失败: ${e.message}`); }
    await sleep(400);
  }

  // ── 工具函数 ──
  const N = (v) => (v === undefined || v === null ? null : Number(v));
  const yuan = (fen) => (fen === null || fen === undefined ? null : fen / 100);  const f2 = (v) => (v === null || v === undefined ? "—" : Number(v).toFixed(2));
  const f0 = (v) => (v === null || v === undefined ? "—" : Math.round(v).toLocaleString("en-US"));
  const pct = (a, b) => (b > 0 && a !== null && a !== undefined ? (100 * a / b).toFixed(2) + "%" : "—");
  const per = (a, b) => (b > 0 && a ? (a / b).toFixed(2) : "—");
  const NAMES = {}; for (const g of agConf) NAMES[String(g.adgroup_id)] = g.adgroup_name;
  const tag = (id) => NAMES[String(id)] || `组${id}`;
  const isROI = (g) => g && /付费|ROI/i.test(g.adgroup_name || "") ;

  // 逐日行（账户级）
  const daily = acctDaily.filter(x => x.date >= S && x.date <= E).sort((a, b) => a.date < b.date ? -1 : 1);
  const prevOf = (date) => acctDaily.find(x => x.date === shift(date, -1));

  // 组级窗口汇总
  const win = agDaily.filter(x => x.date >= S && x.date <= E);
  const byAg = {};
  for (const x of win) {
    const k = String(x.adgroup_id);
    byAg[k] = byAg[k] || { cost: 0, view: 0, click: 0, conv: 0, reg: 0, cr: 0, rt: 0, pay: 0, amt: 0, hasRT: false, hasPay: false };
    const o = byAg[k];
    o.cost += N(x.cost) || 0; o.view += N(x.view_count) || 0; o.click += N(x.valid_click_count) || 0; o.conv += N(x.conversions_count) || 0;
    o.reg += N(x.mini_game_register_users) || 0; o.cr += N(x.mini_game_create_role_users) || 0;
    if (N(x.mini_game_retention_d1) !== null) { o.hasRT = true; o.rt += N(x.mini_game_retention_d1); }
    if (N(x.purchase_dedup_clk_pv) !== null) { o.hasPay = true; o.pay += N(x.purchase_dedup_clk_pv); }
    if (N(x.purchase_clk_amount) !== null) o.amt += N(x.purchase_clk_amount);
  }
  // 窗口次留分母：[S-1, E-1] 创角（错位）
  const crPrevWin = {};
  for (const x of agDaily.filter(x => x.date >= S1 && x.date <= shift(E, -1))) {
    const k = String(x.adgroup_id); crPrevWin[k] = (crPrevWin[k] || 0) + (N(x.mini_game_create_role_users) || 0);
  }

  // 时段分桶
  const BUCKETS = [["00–06", 0, 5], ["06–12", 6, 11], ["12–18", 12, 17], ["18–21", 18, 20], ["21–22", 21, 21], ["22–24", 22, 23]];
  const bucketize = (rows) => {
    const agg = {};
    for (const r of rows) {
      const k = String(r.adgroup_id);
      agg[k] = agg[k] || Object.fromEntries(BUCKETS.map(([n]) => [n, { cost: 0, view: 0 }]));
      const b = BUCKETS.find(([, lo, hi]) => r.hour >= lo && r.hour <= hi);
      if (b) { agg[k][b[0]].cost += (N(r.cost) || 0) / 100; agg[k][b[0]].view += N(r.view_count) || 0; }
    }
    return agg;
  };
  const hourAgg = bucketize(hourly);

  // 排序：ROI 深度目标组优先，其余按窗口花费降序
  const confOf = (id) => agConf.find(g => String(g.adgroup_id) === id);
  const agOrder = Object.keys(byAg).sort((a, b) => {
    const ra = isROI(confOf(a)) ? 0 : 1, rb = isROI(confOf(b)) ? 0 : 1;
    return ra - rb || byAg[b].cost - byAg[a].cost;
  });
  const activeAg = agOrder.filter(id => byAg[id].cost > 0);

  // 逐日 22–24 点花费（深夜放量观察位）
  const dates = [];
  for (let d = S; d <= E; d = shift(d, 1)) dates.push(d);
  const lateDay = {};
  for (const r of hourly.filter(r => r.hour >= 22)) {
    const k = String(r.adgroup_id);
    lateDay[k] = lateDay[k] || {};
    lateDay[k][r.date] = (lateDay[k][r.date] || 0) + (N(r.cost) || 0) / 100;
  }

  // 每组每日消耗尖峰小时 + 每日总花费
  const dayAgCost = {}, dayAgHour = {};
  for (const r of hourly) {
    const k = String(r.adgroup_id);
    dayAgCost[k] = dayAgCost[k] || {};
    dayAgCost[k][r.date] = (dayAgCost[k][r.date] || 0) + (N(r.cost) || 0) / 100;
    dayAgHour[k] = dayAgHour[k] || {};
    dayAgHour[k][r.date] = dayAgHour[k][r.date] || {};
    dayAgHour[k][r.date][r.hour] = (dayAgHour[k][r.date][r.hour] || 0) + (N(r.cost) || 0) / 100;
  }
  const peakOf = (id, d) => {
    const h = dayAgHour[String(id)]?.[d];
    if (!h) return "—";
    let bh = -1, bv = -1;
    for (const [k, v] of Object.entries(h)) if (v > bv) { bv = v; bh = Number(k); }
    return bv > 0 ? `${String(bh).padStart(2, "0")}时(${bv.toFixed(0)}元)` : "—";
  };

  // 定向摘要
  const fmtTargeting = (t) => {
    if (!t) return "（无返回）";
    const parts = [];
    const g = (k) => t[k];
    if (g("age")) parts.push("年龄 " + JSON.stringify(g("age")));
    if (g("gender")) parts.push("性别 " + JSON.stringify(g("gender")));
    if (g("geo_location") || g("region") || g("locations")) parts.push("地域 " + JSON.stringify(g("geo_location") || g("region") || g("locations")));
    if (g("device_brand_ids") || g("os")) parts.push("设备 " + JSON.stringify(g("device_brand_ids") || g("os")));
    if (g("custom_audience") || g("audience_package_id")) parts.push("人群包 " + JSON.stringify(g("custom_audience") || g("audience_package_id")));
    return parts.length ? parts.join("；") : JSON.stringify(t).slice(0, 160);
  };
  const fmtTimeSeries = (ts) => {
    if (!ts || ts.length !== 336) return ts || "—";
    const days = ["一", "二", "三", "四", "五", "六", "日"];
    const perDay = [];
    for (let d = 0; d < 7; d++) {
      const seg = ts.slice(d * 48, (d + 1) * 48);
      const spans = [];
      for (let i = 0; i < 48; i++) {
        if (seg[i] === "1") {
          const end = (() => { let j = i; while (j < 48 && seg[j] === "1") j++; return j; })();
          const sh = `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`;
          const eh = `${String(Math.floor(end / 2)).padStart(2, "0")}:${end % 2 ? "30" : "00"}`;
          spans.push(`${sh}–${eh}`); i = end - 1;
        }
      }
      perDay.push(spans.join("/") || "全天不投");
    }
    return perDay.every(x => x === perDay[0]) ? perDay[0] + "（全周相同）" : perDay.map((x, i) => `周${days[i]} ${x}`).join("，");
  };

  // ── Markdown 输出 ──
  const L = [];
  L.push(`# 账户 ${ACCOUNT} 最近一周日报（${S} ~ ${E}）`);
  L.push(``);
  L.push(`> 生成：${TODAY} · 脚本 \`tools/ad-tools/周报生成器.mjs\`（固定模板，重复执行）`);
  L.push(`> 数据时点：日终口径；窗口末日深度指标（次留/付费）按回传进度可能偏低，"—"=字段未返回`);
  L.push(`> 次留口径：retention_d1[D] ÷ 创角[D-1]（错位队列）；付费=点击归因 purchase_dedup_clk_pv / purchase_clk_amount`);
  L.push(``);
  L.push(`## 一、账户逐日`);
  L.push(``);
  L.push(`| 日期 | 花费(元) | 曝光 | 点击 | CTR | 转化 | 转化成本 | 注册 | 创角 | 次留 | 次留率(错位) | 付费人数 | 付费金额(元) |`);
  L.push(`|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|`);
  for (const x of daily) {
    const p = prevOf(x.date);
    const c = yuan(N(x.cost)), cl = N(x.valid_click_count), vw = N(x.view_count), cv = N(x.conversions_count);
    const rt = N(x.mini_game_retention_d1), crPrev = p ? N(p.mini_game_create_role_users) : null;
    L.push(`| ${x.date} | ${f2(c)} | ${f0(vw)} | ${f0(cl)} | ${pct(cl, vw)} | ${f0(cv)} | ${per(c, cv)} | ${f0(N(x.mini_game_register_users))} | ${f0(N(x.mini_game_create_role_users))} | ${f0(rt)} | ${pct(rt, crPrev)} | ${f0(N(x.purchase_dedup_clk_pv))} | ${f2(yuan(N(x.purchase_clk_amount)))} |`);
  }
  const tot = daily.reduce((a, x) => ({ c: a.c + (N(x.cost) || 0), v: a.v + (N(x.view_count) || 0), k: a.k + (N(x.valid_click_count) || 0), cv: a.cv + (N(x.conversions_count) || 0) }), { c: 0, v: 0, k: 0, cv: 0 });
  L.push(`| **合计** | **${f2(yuan(tot.c))}** | ${f0(tot.v)} | ${f0(tot.k)} | ${pct(tot.k, tot.v)} | ${f0(tot.cv)} | ${per(yuan(tot.c), tot.cv)} | | | | | | |`);
  L.push(``);
  L.push(`## 二、广告组窗口汇总（${S} ~ ${E}）`);
  L.push(``);
  L.push(`| 组 | 名称 | 花费 | 占比 | 曝光 | CTR | 转化 | 转化成本 | 注册 | 创角 | 次留 | 次留率(错位) | 付费人数 | 付费金额 |`);
  L.push(`|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|`);
  for (const id of agOrder) {
    const o = byAg[id];
    const denom = crPrevWin[id];
    const share = tot.c > 0 ? (100 * o.cost / tot.c).toFixed(1) + "%" : "—";
    L.push(`| ${id} | ${tag(id)} | ${f2(yuan(o.cost))} | ${share} | ${f0(o.view)} | ${pct(o.click, o.view)} | ${f0(o.conv)} | ${per(yuan(o.cost), o.conv)} | ${f0(o.reg)} | ${f0(o.cr)} | ${o.hasRT ? f0(o.rt) : "—"} | ${o.hasRT ? pct(o.rt, denom) : "—"} | ${o.hasPay ? f0(o.pay) : "—"} | ${o.hasPay ? f2(yuan(o.amt)) : "—"} |`);
  }
  L.push(`| **合计** | — | **${f2(yuan(tot.c))}** | 100% | ${f0(tot.v)} | ${pct(tot.k, tot.v)} | ${f0(tot.cv)} | ${per(yuan(tot.c), tot.cv)} | | | | | | |`);
  L.push(``);
  L.push(`## 三、时段分析`);
  L.push(``);
  L.push(`### 3.1 各组每日消耗尖峰小时`);
  L.push(``);
  L.push(`| 组 | 名称 | ${dates.map(d => d.slice(5)).join(" | ")} |`);
  L.push(`|---:|---|${dates.map(() => "---").join("|")}|`);
  for (const id of activeAg) {
    L.push(`| ${id} | ${tag(id)} | ${dates.map(d => peakOf(id, d)).join(" | ")} |`);
  }
  L.push(``);
  L.push(`### 3.2 时段分桶（窗口花费·元）`);
  L.push(``);
  L.push(`| 组 | 名称 | ${BUCKETS.map(([n]) => n).join(" | ")} | 22–24点占比 |`);
  L.push(`|---:|---|${BUCKETS.map(() => "---:").join("|")}|---:|`);
  for (const id of agOrder) {
    const b = hourAgg[id] || {};
    const all = BUCKETS.map(([n]) => b[n]?.cost || 0);
    const late = b["22–24"]?.cost || 0;
    const sum = all.reduce((x, y) => x + y, 0);
    L.push(`| ${id} | ${tag(id)} | ${all.map(v => v.toFixed(1)).join(" | ")} | ${sum > 0 ? (100 * late / sum).toFixed(0) + "%" : "—"} |`);
  }
  L.push(``);
  L.push(`### 3.3 深夜观察位：22–24 点逐日花费（元）`);
  L.push(``);
  L.push(`| 组 | 名称 | ${dates.map(d => d.slice(5)).join(" | ")} | 周计 |`);
  L.push(`|---:|---|${dates.map(() => "---:").join("|")}|---:|`);
  for (const id of activeAg) {
    const day = lateDay[id] || {};
    const wk = dates.reduce((s, d) => s + (day[d] || 0), 0);
    L.push(`| ${id} | ${tag(id)} | ${dates.map(d => (day[d] || 0).toFixed(1)).join(" | ")} | **${wk.toFixed(1)}** |`);
  }
  const acctLate = dates.map(d => activeAg.reduce((s, id) => s + ((lateDay[id] || {})[d] || 0), 0));
  L.push(`| **账户** | 22–24 合计 | ${acctLate.map(v => "**" + v.toFixed(1) + "**").join(" | ")} | **${acctLate.reduce((a, b) => a + b, 0).toFixed(1)}** |`);
  L.push(``);
  L.push(`> 深夜位是旧组（浅目标）的自然起量时段；若持续 ≈0，说明预算被 21 点档计划吃光。`);
  L.push(``);
  L.push(`## 四、计划配置快照（定向 × 时段 × 出价）`);
  L.push(``);
  for (const g of [...agConf].sort((a, b) => {
    const ra = isROI(a) ? 0 : 1, rb = isROI(b) ? 0 : 1;
    return ra - rb || (byAg[String(b.adgroup_id)]?.cost || 0) - (byAg[String(a.adgroup_id)]?.cost || 0);
  })) {
    L.push(`### ${g.adgroup_id} ${g.adgroup_name}`);
    L.push(``);
    L.push(`- 状态 ${g.configured_status} ｜ 出价 ${f2(yuan(N(g.bid_amount)))} 元 ｜ 日预算 ${g.daily_budget ? f2(yuan(g.daily_budget)) + " 元" : "不限"}`);
    L.push(`- 目标 ${g.optimization_goal}${g.deep_conversion_spec ? " ｜ 深度 " + JSON.stringify(g.deep_conversion_spec) : ""}`);
    L.push(`- 版位 ${g.automatic_site_enabled ? "自动" : JSON.stringify(g.site_set || [])}`);
    L.push(`- 时段 ${fmtTimeSeries(g.time_series)}`);
    L.push(`- 定向 ${fmtTargeting(g.targeting)}`);
    L.push(`- 投放日期 ${g.begin_date} ~ ${g.end_date}`);
    L.push(``);
  }
  L.push(`## 五、口径与限制`);
  L.push(``);
  L.push(`- 深度指标未回传的日/组显示 "—"，不做 0 推断；次日留存天然 T+1 回传，窗口末日会偏低。`);
  L.push(`- 单元配置按报表出现 ID 逐查（列表接口会漏新建/过期单元）；已删除/过期单元配置可能取不到。`);
  L.push(`- 付费=点击归因（平台侧），与游戏后台对账时注意激励场景次留口径差异（平台按注册/游戏按创角）。`);
  const md = L.join("\n");

  // ── 结构化数据（网页端用，与 Markdown 同一份计算结果）──
  const roiIds = new Set(agConf.filter(isROI).map(g => String(g.adgroup_id)));
  const cfgOf = (id) => agConf.find(g => String(g.adgroup_id) === id);
  const mkGroup = (id) => {
    const o = byAg[id], cfg = cfgOf(id), denom = crPrevWin[id];
    return {
      id, name: tag(id), isROI: roiIds.has(id),
      cost: yuan(o.cost), share: tot.c > 0 ? o.cost / tot.c : null,
      view: o.view, ctr: o.view > 0 ? o.click / o.view : null,
      conv: o.conv, convCost: o.conv > 0 ? yuan(o.cost) / o.conv : null,
      reg: o.reg, cr: o.cr,
      rt: o.hasRT ? o.rt : null, rtRate: o.hasRT ? (denom > 0 ? o.rt / denom : null) : null,
      pay: o.hasPay ? o.pay : null, payAmt: o.hasPay ? yuan(o.amt) : null,
      bid: cfg ? yuan(N(cfg.bid_amount)) : null,
      budget: cfg && cfg.daily_budget ? yuan(cfg.daily_budget) : null,
      status: cfg ? cfg.configured_status : null,
      timeText: cfg ? fmtTimeSeries(cfg.time_series) : null,
      targetingText: cfg ? fmtTargeting(cfg.targeting) : null,
      deep: cfg && cfg.deep_conversion_spec ? JSON.stringify(cfg.deep_conversion_spec) : null,
      goal: cfg ? cfg.optimization_goal : null,
      siteSet: cfg && !cfg.automatic_site_enabled ? (cfg.site_set || []) : [],
      siteAuto: !!(cfg && cfg.automatic_site_enabled),
      begin: cfg ? cfg.begin_date : null, end: cfg ? cfg.end_date : null,
    };
  };
  const DATA = {
    kind: "weekly", account: ACCOUNT, start: S, end: E, generated: TODAY, tokenSrc: CRED.src,
    total: { cost: yuan(tot.c), view: tot.v, click: tot.k, ctr: tot.v > 0 ? tot.k / tot.v : null, conv: tot.cv, convCost: tot.cv > 0 ? yuan(tot.c) / tot.cv : null },
    daily: daily.map(x => {
      const p = prevOf(x.date);
      const c = yuan(N(x.cost)), cl = N(x.valid_click_count), vw = N(x.view_count), cv = N(x.conversions_count);
      const rt = N(x.mini_game_retention_d1), crPrev = p ? N(p.mini_game_create_role_users) : null;
      return {
        date: x.date, cost: c, view: vw, click: cl, ctr: vw > 0 ? cl / vw : null,
        conv: cv, convCost: cv > 0 ? c / cv : null,
        reg: N(x.mini_game_register_users), cr: N(x.mini_game_create_role_users),
        rt, rtRate: (rt !== null && crPrev > 0) ? rt / crPrev : null,
        pay: N(x.purchase_dedup_clk_pv), payAmt: yuan(N(x.purchase_clk_amount)),
      };
    }),
    groups: agOrder.map(mkGroup),
    peaks: activeAg.map(id => ({ id, name: tag(id), days: dates.map(d => ({ date: d, peak: peakOf(id, d) })) })),
    buckets: BUCKETS.map(([n]) => n),
    hourRows: agOrder.map(id => {
      const b = hourAgg[id] || {};
      const arr = BUCKETS.map(([n]) => (b[n]?.cost) ?? 0);
      const sum = arr.reduce((x, y) => x + y, 0);
      const late = b["22–24"]?.cost || 0;
      return { id, name: tag(id), vals: arr, lateShare: sum > 0 ? late / sum : null };
    }),
    late: {
      dates,
      rows: activeAg.map(id => {
        const day = lateDay[id] || {};
        const vals = dates.map(d => day[d] || 0);
        return { id, name: tag(id), vals, week: vals.reduce((a, b) => a + b, 0) };
      }),
      acct: (() => { const v = dates.map(d => activeAg.reduce((s, id) => s + ((lateDay[id] || {})[d] || 0), 0)); return { vals: v, week: v.reduce((a, b) => a + b, 0) }; })(),
    },
    md,
  };
  // 自动观察（基于同一份数据）
  {
    const a = DATA.alerts = [];
    const roi = DATA.groups.find(g => g.isROI && g.cost > 0);
    const old = DATA.groups.filter(g => !g.isROI && g.cost > 0);
    if (roi && (roi.pay === 0 || roi.pay === null)) a.push(`🔴 ROI组「${roi.name}」窗口花费 ${num2(roi.cost)} 元、付费样本 0 —— 深度目标连续无付费需评估止损`);
    if (roi && old.length && roi.convCost !== null) {
      const best = Math.min(...old.map(g => g.convCost).filter(v => v !== null));
      if (best > 0 && roi.convCost / best >= 3) a.push(`⚠️ ROI组转化成本 ${num2(roi.convCost)} 元，是旧组最低（${num2(best)} 元）的 ${Math.round(roi.convCost / best)} 倍`);
    }
    const lateVals = DATA.late.acct.vals;
    const zeroRun = (() => { let n = 0; for (let i = lateVals.length - 1; i >= 0 && lateVals[i] < 1; i--) n++; return n; })();
    if (zeroRun >= 2) a.push(`⛔ 22–24 点深夜位连续 ${zeroRun} 天 ≈0 消耗（预算被 21 点档吃光），旧组自然高峰被挤压`);
    const days = DATA.daily.length;
    if (days) {
      const first = DATA.daily[0], last = DATA.daily[days - 1];
      if (first.cost && last.cost && last.convCost && first.convCost && last.convCost / first.convCost >= 2)
        a.push(`⚠️ 账户转化成本从 ${num2(first.convCost)} 升至 ${num2(last.convCost)} 元（窗口首末日对比）`);
    }
  }
  function num2(v) { return v == null ? "—" : Number(v).toFixed(2); }

  // ── 输出 ──
  if (JSON_OUT) {
    // 网页端：stdout 末行出单行 JSON（server 取最后一行 { 开头的行解析）
    const { md: _omit, ...rest } = DATA;
    process.stdout.write(JSON.stringify({ ...rest, markdown: md }) + "\n");
    return;
  }
  if (MD_OUT) { process.stdout.write(md + "\n"); return; }
  console.log(md);

  if (SAVE) {
    const dir = path.join(REPO, "doc", `广告数据分析_${TODAY.replace(/-/g, "")}`);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `账户${ACCOUNT}_最近一周日报_${TODAY.replace(/-/g, "")}.md`);
    fs.writeFileSync(file, md + "\n", "utf8");
    console.error(`\n📄 已保存: ${file}`);
  }
})().catch(e => { console.error("失败:", e.message); process.exit(1); });
