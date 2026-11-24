#!/usr/bin/env node
/**
 * 盯盘.mjs — 腾讯广告盯盘（创角口径版；账户由 MKT_ACCOUNT_ID 指定）
 * 曾用名：monitor_two_ag.mjs
 *
 * 特点：只依赖 Node.js（>=18）+ 一个 access_token，无需 npm 依赖。
 * 用途：在任意常开机器（如 Mac）上用 cron 定时跑，只读监测在投单元的成本/创角/次留。
 *
 * 用法：node tools/ad-tools/盯盘.mjs        （或双击目录里的 启动工具.command）
 *   （脚本自愈路径：从任意 cwd 运行、整个目录可搬移）
 *
 * 凭证读取优先级：
 *   1) 环境变量 MKT_ACCESS_TOKEN
 *   2) 仓库根 tmp/tencentads_credentials.json 的 access_token（自动向上定位仓库根）
 *   3) ~/.workbuddy/mcp.json 里任一 mcpServers 的 headers.access_token
 *   4) 本脚本同目录的 token.txt（内容即 token）—— 单独拷到别的机器时用这条
 *
 * 时间窗口：仅北京时间 08:00–23:00 执行，凌晨直接跳过（MONITOR_FORCE=1 可强制）。
 *
 * 环境变量：
 *   MONITOR_FORCE=1        忽略时间窗口
 *   MONITOR_IDS=a,b        指定监测单元（默认自动发现窗口内有消耗的单元）
 *   MONITOR_BREAKEVEN=0.35 每创角充值保本线（元/创角），用于算超标倍数
 *
 * ══════ 🔴 口径铁律（错一条结论就反，详见 skill: griffin-game-backend-verify） ══════
 *
 * 1) 游戏后台的「注册」= 平台的「创角」。平台的 `mini_game_register_users` 是更浅的
 *    「进游戏」事件，游戏侧看不到 → 账户真实获客成本要用「创角成本」，不是「注册成本」。
 *    实测：注册成本 4.02 元 vs 创角成本 7.75 元（全期，差 2 倍）。
 *
 * 2) `mini_game_retention_d1` 是【次日留存的创角人数（整数）】，不是百分比，分母是【创角】。
 *    正确次留率 = retention_d1 ÷ mini_game_create_role_users。
 *    🔴 次留率有两个分母（差 ~3.3 倍＝注册÷创角），两个都对，别混：
 *       · ÷注册（同日）= 广告后台显示的那列率（个位数）= 平台自带 retention_d1_rate
 *       · ÷前一日创角（错位）= 权威口径 ← 本脚本用这个
 *       ⛔ 别混着比，会得出「差了 3 倍」的假矛盾（是两个不同指标）。
 *
 * 3) ⚠️ 次留按【留存发生日】回报，不是【注册日】：
 *       retention_d1[D] 对应的是 D-1 那批创角队列。
 *    → 【逐日】算次留率，分母必须用【前一日】创角：ret[D] ÷ cr[D-1]
 *    → 【区间汇总】**也要错位**（09-23 修正旧说法）：对齐的分母是 [S-1, E-1] 的创角。
 *      放量期差 31%（09-12~09-20：26.02% vs 19.95%），只有平稳期才可忽略。
 *      本脚本用的是【单日对齐】：昨日次留 ÷ 前日创角，不受此影响。
 *    实测依据：7 月账户级按天，同日口径会产生 187.5%/166.7%/115.8% 三个>100% 的不可能值；
 *    错位口径最大值 23.3%，且加权 14.63% 精确对上游戏侧 15.21% / 区间汇总 14.69%。
 *
 * 4) 新单元 D1 未成熟时该字段返回 0（创角日 +1 天未过）→ 是未成熟，不是真的 0。
 *
 * 5) 金额单位全部是「分」，需 /100。
 */
import { readFileSync, existsSync, mkdirSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── --json：给网页端用的结构化输出（stdout 出 JSON，文本全部静音）──
//    默认不带 --json 时行为与以前完全一致（纯文本、给人看）。
const JSON_OUT = process.argv.includes("--json");
let OUT = console.log.bind(console);
if (JSON_OUT) {
  // 用同步写：process.exit() 会截断还没 flush 的 stdout（走管道时是常见的丢 JSON 原因）
  OUT = (s) => { try { writeSync(1, s + "\n"); } catch { } };
  console.log = () => { };
}

/* 广告账户：只认环境变量 MKT_ACCOUNT_ID（插件/命令行都会传）；不再内置默认账户 */
const ACCOUNT = /^\d{5,12}$/.test(String(process.env.MKT_ACCOUNT_ID || "").trim())
  ? String(process.env.MKT_ACCOUNT_ID).trim() : "";
if (!ACCOUNT) { console.error("未指定广告账户：请设置 MKT_ACCOUNT_ID"); process.exit(1); }
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 仓库根自动定位（脚本住 tools/ad-tools/，凭证与留痕统一在 仓库根/tmp/）──
// 向上找标志（AGENTS.md，或同时存在 tmp/ 与 doc/）；找不到则退回脚本同目录
// —— 后者用于把本脚本单独拷到别的机器（如 ~/tencent-ads-monitor）读同目录 token.txt。
function findRepoRoot(start) {
  let d = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(d, "AGENTS.md")) || (existsSync(join(d, "tmp")) && existsSync(join(d, "doc")))) return d;
    const up = dirname(d); if (up === d) break; d = up;
  }
  return start;
}
const REPO = findRepoRoot(__dirname);
const TMP = process.env.AD_TOOLS_TMP || join(REPO, "tmp");
if (!existsSync(TMP)) { try { mkdirSync(TMP, { recursive: true }); } catch { } }

// ── 单元名称 ──
// 显示名一律用接口返回的 adgroup_name（全称，与腾讯广告后台一致，如「0912_小程序_激励_注册次留」）。
// 下面这张表只是【兜底短名】：接口查不到该单元（如已删、或不在本账户）时才会用到，正常不应命中。
const NAMES = {
  "137178836867": "0917创角",
  "137172112653": "0917视频号",
  "135174569215": "A组小程序",
  "136624984309": "0916公众号",
  "136659352021": "0916搜索",
  "135174574240": "B朋友圈",
  "118616523704": "0720首充",
  "137556182537": "0918视频号首充",
};
// 已知已删单元：不进监测窗口（原来靠短名里含「已删」二字判断，改全称后会失效，故显式列出）
const DELETED = new Set(["137556182537"]);

// 终端列宽：CJK/全角算 2 列，其余算 1 列。中文全称比原来的短名长得多，
// 不按显示宽度补空格的话表头和数据会各歪各的。
const dw = (s) => [...String(s)].reduce((a, c) =>
  a + (/[\u1100-\u115F\u2E80-\uA4CF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(c) ? 2 : 1), 0);
const padE = (s, w) => String(s) + " ".repeat(Math.max(0, w - dw(s)));
const padS = (s, w) => " ".repeat(Math.max(0, w - dw(s))) + String(s);
const BREAKEVEN = Number(process.env.MONITOR_BREAKEVEN || 0.35); // 元/创角

// ── 时间窗口：北京时间 08:00–23:00 ──
const bj = (part) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", [part]: "2-digit", hour12: false }).format(new Date());
const hour = Number(bj("hour"));
const now = new Date();
const dayStr = (offsetDays) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(now.getTime() + offsetDays * 86400000));
const today = dayStr(0), y1 = dayStr(-1), y2 = dayStr(-2);
if (!process.env.MONITOR_FORCE && (hour < 8 || hour >= 24)) {
  console.log(`[盯盘] 北京时间 ${String(hour).padStart(2, "0")} 点，非监测窗口(08:00-23:00)，跳过。`);
  process.exit(0);
}

// ── 凭证 ──
function resolveToken() {
  if (process.env.MKT_ACCESS_TOKEN?.trim()) return process.env.MKT_ACCESS_TOKEN.trim();
  const credFile = join(TMP, "tencentads_credentials.json");
  if (existsSync(credFile)) {
    try {
      const j = JSON.parse(readFileSync(credFile, "utf8").replace(/^\uFEFF/, ""));
      if (j.access_token) return String(j.access_token).trim();
    } catch { }
  }
  const mcp = join(homedir(), ".workbuddy", "mcp.json");
  if (existsSync(mcp)) {
    try {
      const j = JSON.parse(readFileSync(mcp, "utf8").replace(/^\uFEFF/, ""));
      for (const cfg of Object.values(j.mcpServers || j.servers || {})) {
        if (cfg?.headers?.access_token) return String(cfg.headers.access_token).trim();
      }
    } catch { }
  }
  const local = join(__dirname, "token.txt");
  if (existsSync(local)) return readFileSync(local, "utf8").trim();
  throw new Error("找不到 access_token：设置 MKT_ACCESS_TOKEN / 放 tmp/tencentads_credentials.json / 本目录放 token.txt");
}
const TOKEN = resolveToken();

async function api(path, query = {}) {
  const qs = new URLSearchParams({
    access_token: TOKEN, timestamp: String(Math.floor(Date.now() / 1000)),
    nonce: Math.random().toString(36).slice(2, 12),
    ...Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined)),
  });
  const res = await fetch(`https://api.e.qq.com${path}?${qs}`);
  return await res.json();
}
const F2 = (n) => (n == null ? "—" : n.toFixed(2));
const PCT = (n) => (n == null ? "—" : (n * 100).toFixed(1) + "%");
const PCT2 = (n) => (n == null ? "—" : (n * 100).toFixed(2) + "%");   // 个位数的率（÷注册）给两位

// ── 1) 报表：取 3 天（D-2 / D-1 / D），按【日期 × 单元】双维分组 ──
//    需要 3 天是因为：今日次留的分母 = 昨日创角；昨日完整次留的分母 = 前日创角
const rp = await api("/v3.0/daily_reports/get", {
  account_id: ACCOUNT,
  level: "REPORT_LEVEL_ADGROUP",
  date_range: JSON.stringify({ start_date: y2, end_date: today }),
  group_by: JSON.stringify(["date", "adgroup_id"]),
  fields: JSON.stringify([
    "date", "adgroup_id", "cost", "view_count", "valid_click_count",
    "mini_game_register_users", "mini_game_create_role_users",
    "mini_game_retention_d1", "purchase_amount",
  ]),
  page: "1", page_size: "200",
});

const alerts = [];
if (rp.code !== 0) {
  const msg = "报表查询失败: " + (rp.message_cn || rp.message);
  if (JSON_OUT) {
    OUT(JSON.stringify({
      kind: "monitor", generatedAt: new Date().toISOString(), today, y1, y2, hour,
      breakeven: BREAKEVEN, account: ACCOUNT,
      error: msg, alerts: [msg], status: [], units: [], yesterdayRetention: [], total: null,
    }));
    process.exit(1);
  }
  alerts.push(msg);
  console.log(`\n📊 盯盘报告 · ${today} ${String(hour).padStart(2, "0")} 点\n` + "─".repeat(70));
  console.log("⚠️ 异常提醒：");
  for (const a of alerts) console.log("  · " + a);
  process.exit(0);
}

// date → adgroup_id → 指标
const byDay = {};
for (const x of rp.data?.list || []) (byDay[x.date] ||= {})[x.adgroup_id] = x;

// ── 2) 确定监测单元 ──
const autoIds = new Set();
for (const d of [today, y1, y2]) for (const [id, x] of Object.entries(byDay[d] || {})) if ((x.cost || 0) > 0) autoIds.add(id);
const IDS = (process.env.MONITOR_IDS ? process.env.MONITOR_IDS.split(",").map(s => s.trim()).filter(Boolean) : [...autoIds])
  .filter(id => !DELETED.has(id));

// ── 3) 状态回查 ──
const st = IDS.length ? await api("/v3.0/adgroups/get", {
  account_id: ACCOUNT,
  fields: JSON.stringify(["adgroup_id", "adgroup_name", "configured_status", "system_status", "daily_budget"]),
  filtering: JSON.stringify([{ field: "adgroup_id", operator: "IN", values: IDS }]),
  page: "1", page_size: "50",
}) : { code: 0, data: { list: [] } };

console.log(`\n📊 盯盘报告 · ${today} ${String(hour).padStart(2, "0")} 点`);
console.log(`口径：成本/创角｜🔴 次留率【两个分母都列，别混】：÷创角（错位，权威）与 ÷注册（同日，＝广告后台那个数）｜保本线 ${BREAKEVEN} 元/创角`);
console.log("─".repeat(70));

if (st.code !== 0) alerts.push("状态回查失败: " + (st.message_cn || st.message));
const statusMap = {};
// 状态判读：只有这两种是「健康」
//   ACTIVE              = 正在投放
//   DAILY_BUDGET_REACHED= 预算已花完 → 正常（说明跑得动），不算异常
const HEALTHY = new Set(["ADGROUP_STATUS_ACTIVE", "ADGROUP_STATUS_DAILY_BUDGET_REACHED"]);

// 状态一律给中文，别把原始枚举丢给用户看（ADGROUP_STATUS_NOT_IN_DELIVERY_TIME 这种读不出来）。
// 定义在状态回查之前，报警（alerts）与表格共用同一套词，避免同页出现两种说法。
const SYS_CN = {
  ADGROUP_STATUS_ACTIVE: "✅ 投放中",
  ADGROUP_STATUS_DAILY_BUDGET_REACHED: "✅ 投放中（预算已花完）",
  ADGROUP_STATUS_NOT_IN_DELIVERY_TIME: "⚠️ 不在投放时段",
  ADGROUP_STATUS_SUSPEND: "⛔ 已暂停",
  SMART_ADGROUP_STATUS_SUSPEND: "⛔ 已暂停",
  ADGROUP_STATUS_END: "⛔ 已结束",
  ADGROUP_STATUS_PENDING: "⚠️ 待投放",
  ADGROUP_STATUS_APPROVING: "⚠️ 审核中",
  ADGROUP_STATUS_PREPARE: "⚠️ 待投放",
};
const statusTag = (g) =>
  g.configured_status === "AD_STATUS_SUSPEND" ? "⛔ 已暂停（手动）"
  : g.configured_status !== "AD_STATUS_NORMAL" ? "⛔ " + g.configured_status
  : SYS_CN[g.system_status] || ("⚠️ " + g.system_status);

for (const g of st.data?.list || []) {
  statusMap[g.adgroup_id] = g;
  const ok = g.configured_status === "AD_STATUS_NORMAL" && HEALTHY.has(g.system_status);
  // ⚠️ 这里不能用下面的 nameOf（它在 statusMap 建完之后才定义，此处调用会触发 TDZ 报错）
  if (!ok) alerts.push(`${g.adgroup_name || NAMES[g.adgroup_id] || g.adgroup_id} 状态异常：${statusTag(g)}`);
}

// 显示名：优先接口全称（adgroups/get 的 adgroup_name），兜底硬编码短名，再兜底 ID
const nameOf = (id) => statusMap[id]?.adgroup_name || NAMES[id] || id;
// 名字列宽：按终端显示宽度取最长（中文算 2 列），至少 14 列
const W = Math.max(14, ...IDS.map(id => dw(nameOf(id))));

for (const id of IDS) if (!statusMap[id]) alerts.push(`${nameOf(id)} 不在返回列表中（可能已删除或不在本账户）`);

console.log("【单元状态】");
const jsonStatus = [];
for (const id of IDS) {
  const g = statusMap[id];
  const nm = nameOf(id);
  if (!g) { console.log(`  ${padE(nm, W)} ⚠️ 查无此单元`); jsonStatus.push({ id, name: nm, ok: false, tag: "查无此单元", budget: null }); continue; }
  const tag = statusTag(g);
  jsonStatus.push({
    id, name: nm, budget: (g.daily_budget || 0) / 100,
    ok: g.configured_status === "AD_STATUS_NORMAL" && HEALTHY.has(g.system_status),
    tag, configured_status: g.configured_status, system_status: g.system_status,
  });
  console.log(`  ${padE(nm, W)} ${tag}  预算 ${(g.daily_budget / 100).toFixed(0)} 元`);
}

// ── 4) 逐单元核算 ──
// 🔴 次留率有【两个分母】（差约 3.3 倍），两个都列，别混：
//     · ÷注册（同日）＝ 广告后台显示的那个数（个位数）
//     · ÷创角（错位）＝ 权威口径，retention_d1 报的本就是「创角人数」的次日留存
console.log("─".repeat(70));
console.log(`【核心指标】次留率取【昨日完整】口径：retention_d1[${y1}] ÷ 创角[${y2}]（权威）；同列再给 ÷ 注册[${y1}]（＝广告后台口径）`);
console.log("  " + padE("单元", W) + padS("消耗", 9) + padS("预算%", 8) +
  padS("注册", 7) + padS("创角", 7) + padS("创角率", 8) + padS("创角成本", 10) +
  padS("超标", 7) + padS("次留率÷注册", 13) + padS("次留率÷创角", 13) + padS("今日次留", 10));

let tCost = 0, tReg = 0, tCr = 0, tyRet = 0, ty2Cr = 0, tyReg = 0, tyCost = 0;
const jsonUnits = [];
for (const id of IDS) {
  const nm = nameOf(id);
  const T = byDay[today]?.[id] || {};
  const Y = byDay[y1]?.[id] || {};
  const Y2 = byDay[y2]?.[id] || {};

  const cost = (T.cost || 0) / 100;
  const reg = T.mini_game_register_users || 0;
  const cr = T.mini_game_create_role_users || 0;
  const retToday = T.mini_game_retention_d1 || 0;    // 今日留存事件（进行中）
  const budget = (statusMap[id]?.daily_budget || 0) / 100;
  const yCost = (Y.cost || 0) / 100;                  // 昨日消耗（算次留成本用）
  const yReg = Y.mini_game_register_users || 0;       // 昨日注册 → 「÷注册」口径的分母
  const yRet = Y.mini_game_retention_d1 || 0;         // 昨日留存事件 = 前日队列的完整次留
  const y2Cr = Y2.mini_game_create_role_users || 0;   // 前日创角 = 昨日的正确分母

  const crCost = cr > 0 ? cost / cr : null;
  const crRate = reg > 0 ? cr / reg : null;
  const over = crCost != null ? crCost / BREAKEVEN : null;
  // 🔴 两个分母都算（差约 3.3 倍，不是谁错，是另一个指标）：
  const retRateY = y2Cr > 0 ? yRet / y2Cr : null;     // ★ 权威口径：÷ 前日创角（错位）
  const retRateYReg = yReg > 0 ? yRet / yReg : null;  // ★ 广告后台口径：÷ 昨日注册（同日）
  const yRtCost = yRet > 0 ? yCost / yRet : null;     // 昨日次留成本：昨日消耗 ÷ 昨日次留人数

  tCost += cost; tReg += reg; tCr += cr; tyRet += yRet; ty2Cr += y2Cr; tyReg += yReg; tyCost += yCost;

  jsonUnits.push({
    id, name: nm, cost, budget,
    budgetPct: budget > 0 ? cost / budget : null,
    reg, cr, crRate, crCost, over,
    yCost, yReg, yRet, y2Cr,
    retRateYReg, retRateY, yRtCost,
    retToday, breakeven: BREAKEVEN,
  });

  console.log("  " + padE(nm, W) +
    padS(F2(cost), 9) +
    padS(budget > 0 ? ((cost / budget * 100).toFixed(0) + "%") : "—", 8) +
    padS(String(reg), 7) + padS(String(cr), 7) +
    padS(PCT(crRate), 8) +
    padS(crCost == null ? "—" : crCost.toFixed(2), 10) +
    padS(over == null ? "—" : over.toFixed(1) + "×", 7) +
    padS(PCT2(retRateYReg), 13) +
    padS(PCT(retRateY), 13) +
    padS(retToday > 0 ? String(retToday) : "—", 10)
  );

  // ── 告警规则 ──
  if (reg >= 20 && cr === 0) alerts.push(`${nm} 今日注册 ${reg} 但创角 0 → 流量质量断裂，检查素材/版位`);
  if (reg >= 50 && cr > 0 && cr / reg < 0.10) alerts.push(`${nm} 创角率仅 ${PCT(cr / reg)}（注册 ${reg}、创角 ${cr}）→ 流量质量差，钱丢在创角前`);
  if (budget > 0 && hour >= 18 && cost < budget * 0.2) alerts.push(`${nm} 消耗仅 ${F2(cost)} 元 / 预算 ${budget} 元（<20%，已过 18 点）→ 消耗不掉`);
  if (budget > 0 && hour >= 12 && cost === 0) alerts.push(`${nm} 今日零消耗（预算 ${budget} 元）`);
  if (y2Cr >= 20 && yRet / y2Cr < 0.10) alerts.push(`${nm} 昨日完整次留率 ${PCT(yRet / y2Cr)} 偏低（<10%，分母 ${y2Cr}）→ 质量下滑`);
  if (over != null && over >= 20) alerts.push(`${nm} 创角成本 ${F2(crCost)} 元 = 保本线的 ${over.toFixed(1)} 倍 → 结构性亏损`);
}

console.log("  " + "─".repeat(W + 92));
console.log("  " + padE("账户合计", W) + padS(F2(tCost), 9) + padS("—", 8) +
  padS(String(tReg), 7) + padS(String(tCr), 7) +
  padS(PCT(tReg > 0 ? tCr / tReg : null), 8) +
  padS(tCr > 0 ? (tCost / tCr).toFixed(2) : "—", 10) +
  padS(tCr > 0 ? (tCost / tCr / BREAKEVEN).toFixed(1) + "×" : "—", 7) +
  padS(PCT2(tyReg > 0 ? tyRet / tyReg : null), 13) +
  padS(PCT(ty2Cr > 0 ? tyRet / ty2Cr : null), 13) +
  padS("—", 10)
);
if (tyReg > 0 && ty2Cr > 0) {
  console.log(`  ℹ️ 账户级：注册 ${tyReg} / 创角 ${ty2Cr} = ${(tyReg / ty2Cr).toFixed(2)} 倍 → 两个次留率也差这个倍数（分母不同 ≠ 谁错）`);
}

// ── 5) 昨日完整次留明细（两个分母都列）──
console.log("─".repeat(70));
console.log(`【昨日完整次留】（${y1} 队列 → ${today} 留存）`);
console.log("  " + padE("单元", W) + padS("昨日注册", 10) + padS("前日创角", 10) + padS("昨日次留", 10)
  + padS("次留率÷注册", 13) + padS("次留率÷创角", 13) + padS("次留成本", 10) + padS("样本", 10));
let hasY = false;
for (const id of IDS) {
  const nm = nameOf(id);
  const yCost2 = (byDay[y1]?.[id]?.cost || 0) / 100;
  const yReg2 = byDay[y1]?.[id]?.mini_game_register_users || 0;
  const yCr2 = byDay[y2]?.[id]?.mini_game_create_role_users || 0;
  const yRet2 = byDay[y1]?.[id]?.mini_game_retention_d1 || 0;
  if (yCr2 === 0 && yRet2 === 0 && yReg2 === 0) continue;
  hasY = true;
  const rReg = yReg2 > 0 ? yRet2 / yReg2 : null;    // 广告后台口径（÷昨日注册）
  const rCr = yCr2 > 0 ? yRet2 / yCr2 : null;       // 权威口径（÷前日创角，错位）
  const rtCost = yRet2 > 0 ? yCost2 / yRet2 : null; // 次留成本 = 昨日消耗 ÷ 昨日次留人数
  console.log("  " + padE(nm, W) + padS(String(yReg2), 10) + padS(String(yCr2), 10) + padS(String(yRet2), 10)
    + padS(PCT2(rReg), 13) + padS(PCT(rCr), 13) + padS(F2(rtCost), 10)
    + padS(yCr2 < 20 ? "样本不足" : "OK", 10));
}
if (!hasY) console.log("  （窗口内无数据）");
console.log("  注：÷注册 = 昨日次留 ÷ 昨日注册（**广告后台显示的就是这个**，个位数）；");
console.log("      ÷创角 = 昨日次留 ÷ 前日创角（权威口径，错位）；次留成本 = 昨日消耗 ÷ 昨日次留人数。");

console.log("─".repeat(70));
if (alerts.length) {
  console.log("⚠️ 异常提醒：");
  for (const a of alerts) console.log("  · " + a);
} else {
  console.log("✅ 无异常");
}
console.log("注：① 次留率主列用【昨日完整】口径，两个分母并排：÷注册（同日，＝广告后台口径）｜÷创角（错位，权威）；");
console.log("    ② 新单元 D1 未成熟会显示 0 或 —（未成熟 ≠ 真 0）；");
console.log(`    ③ 保本线 ${BREAKEVEN} 元/创角 = 每创角充值（9 月实测 0.3523），可用 MONITOR_BREAKEVEN 覆盖；`);
console.log("    ④ 「预算已花完」是正常状态，不算异常。");
console.log("");

// ── --json 输出（供网页端；stderr 上的报错仍会正常冒出去）──
if (JSON_OUT) {
  OUT(JSON.stringify({
    kind: "monitor",
    generatedAt: new Date().toISOString(),
    today, y1, y2, hour, breakeven: BREAKEVEN, account: ACCOUNT,
    status: jsonStatus,
    units: jsonUnits,
    total: {
      cost: tCost, reg: tReg, cr: tCr,
      crRate: tReg > 0 ? tCr / tReg : null,
      crCost: tCr > 0 ? tCost / tCr : null,
      over: tCr > 0 ? tCost / tCr / BREAKEVEN : null,
      retRateYReg: tyReg > 0 ? tyRet / tyReg : null,   // 广告后台口径（÷注册）
      retRateY: ty2Cr > 0 ? tyRet / ty2Cr : null,      // 权威口径（÷前日创角，错位）
      yRtCost: tyRet > 0 ? tyCost / tyRet : null,      // 昨日次留成本
      yCost: tyCost, yReg: tyReg, yRet: tyRet, y2Cr: ty2Cr,
      denomRatio: ty2Cr > 0 ? tyReg / ty2Cr : null,    // 注册÷创角
    },
    yesterdayRetention: IDS.map(id => {
      const yCost = (byDay[y1]?.[id]?.cost || 0) / 100;
      const reg = byDay[y1]?.[id]?.mini_game_register_users || 0;
      const prevCr = byDay[y2]?.[id]?.mini_game_create_role_users || 0;
      const yRet = byDay[y1]?.[id]?.mini_game_retention_d1 || 0;
      return {
        id, name: nameOf(id), cost: yCost, reg, prevCr, yRet,
        retRateReg: reg > 0 ? yRet / reg : null,       // 广告后台口径
        retRate: prevCr > 0 ? yRet / prevCr : null,    // 权威口径（错位）
        rtCost: yRet > 0 ? yCost / yRet : null,
      };
    }).filter(x => x.prevCr || x.yRet || x.reg),
    alerts,
  }));
}
