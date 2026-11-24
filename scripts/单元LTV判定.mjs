#!/usr/bin/env node
/**
 * 单元LTV判定.mjs — 单元级「真实 LTV vs CAC」判定表
 * 曾用名：unit_ltv_verdict.mjs
 *
 * 口径（2026-09-18 新增，取代旧的「注册成本」判定线）：
 *   单创角成本 CAC = 单元平台消耗 ÷ 游戏侧该单元创角数（t_analysis_user 注册行 = 创角）
 *   每创角充值 LTV = 游戏侧该单元创角队列的累计充值 ÷ 游戏侧创角数
 *   判定：
 *     LTV ≥ CAC              → 加量
 *     0.5×CAC ≤ LTV < CAC    → 维持观察
 *     LTV < 0.5×CAC          → 停 / 降预算
 *     游戏侧创角 < 100 人     → 样本不足，不判定
 *     平台侧窗口消耗 = 0      → 无投放（不是「花了钱没效果」，不判停/降）
 *     起投日晚于窗口末日      → 窗口外（当时这单元还没建，更不是「没投」）
 *
 * 🔴 「0 消耗」必须拆开看：窗口早于起投日（= 当时不存在）与「建了但没投」是两码事。
 *    只按 0 消耗判「无投放」，会把 9 月新建的单元在 7 月窗口里显示成「无投放」，
 *    而它其实正在投放（例：0916_公众号小程序_男_注册次留 消耗 0 / 实际 ACTIVE）。
 *    表里另有「投放状态」列，反映配置 + 系统状态的**当下**真实状态，与窗口无关。
 *
 * 付费情况列（与 CAC / LTV 同分母，避免口径混淆）：
 *   付费人数 = 至少付过一次的人（≈ 首充过的人）
 *   付费率   = 付费人数 ÷ 游戏侧创角
 *   ARPPU    = 真实充值 ÷ 付费人数（账户锚 ≈30 元）
 *   真实充值 = 该单元创角队列的累计充值（截至今日，不限窗口内发生）
 *
 * ⚠️ 判定优先级：窗口外(未起投) > 无投放 > 样本不足 > 加量 / 观察 / 停降。
 *    「窗口内投没投」只认「平台消耗」；游戏侧有创角但平台 0 消耗的单元
 *    （历史投放 / 报表口径差）算无投放，不做 ROI 判定。
 *    「投放状态」列与窗口无关，只看单元当下的真实状态（投放中 / 已暂停 / 已删…）。
 *
 * 数据源：
 *   平台侧 → 腾讯广告 API daily_reports/get（REPORT_LEVEL_ADGROUP）
 *   游戏侧 → 格里芬本地服务 /api/sql（t_analysis_user.adId = 营销单元 ID）
 *
 * ⚠️ 判定必须用「成熟队列」：创角窗口距今 ≥30 天（推荐 30~60 天），否则 LTV 严重未成熟会系统性判死。
 * ⚠️ 口径：游戏后台的「注册」＝平台「创角」（创建角色时才落库）；平台「注册」事件游戏侧看不到，
 *    两者差一个创角率（实测 39.8%~56.5%）。故 CAC 对比建议用「按创角出价」口径。
 *    近期窗口（如近 7 天）只能用于「早期预警」，不能直接下判定。
 *
 * 用法：
 *   node server.mjs 启动格里芬（tools/griffin-data-tool，默认端口 8787）
 *   node tools/ad-tools/单元LTV判定.mjs [起始日 YYYY-MM-DD] [结束日 YYYY-MM-DD] [格里芬端口]
 *   端口默认 8787，与格里芬自带启动器一致；只有改了端口才需要传第 3 个参数
 *   默认窗口 = 昨日往前 7 个完整日（仅预警用）
 *   （脚本已自愈路径，任意 cwd/子目录均可运行；凭证读 仓库根/tmp/tencentads_credentials.json）
 */
import fs from "node:fs";
import { join as _j, dirname as _dn } from "node:path";
import { fileURLToPath } from "node:url";

// ── 仓库根自动定位（脚本住 tools/ad-tools/，凭证与留痕统一在 仓库根/tmp/）──
const __dir = _dn(fileURLToPath(import.meta.url));
const REPO = (() => {
  let d = __dir;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(_j(d, "AGENTS.md")) || (fs.existsSync(_j(d, "tmp")) && fs.existsSync(_j(d, "doc")))) return d;
    const u = _dn(d); if (u === d) break; d = u;
  }
  return __dir;
})();
const TMP = process.env.AD_TOOLS_TMP || _j(REPO, "tmp");
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

/* 广告账户：只认环境变量 MKT_ACCOUNT_ID（插件/命令行都会传）；不再内置默认账户 */
const ACCT = /^\d{5,12}$/.test(String(process.env.MKT_ACCOUNT_ID || "").trim())
  ? String(process.env.MKT_ACCOUNT_ID).trim() : "";
if (!ACCT) { console.error("未指定广告账户：请设置 MKT_ACCOUNT_ID"); process.exit(1); }
const AD = { account_id: ACCT };
const TK = JSON.parse(fs.readFileSync(_j(TMP, "tencentads_credentials.json"), "utf8")).access_token;

// ── --json：给网页端用的结构化输出（stdout 出 JSON，文本全部静音）──
//    ⚠️ 必须先把 --json 剔掉再取位置参数，否则它会顶掉「起始日」导致窗口错位。
const JSON_OUT = process.argv.includes("--json");
let OUT = console.log.bind(console);
if (JSON_OUT) {
  // 同步写：避免 process.exit() 截断管道里的 stdout
  OUT = (s) => { try { fs.writeSync(1, s + "\n"); } catch { } };
  console.log = () => { };
}
const ARGS = process.argv.slice(2).filter(a => a !== "--json");

const GRIFFIN = Number(ARGS[2] || 8787);

const day = (offset = 0) => {
  const d = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(d);
};
const END = ARGS[1] || day(-1);
const START = ARGS[0] || day(-7);

// ── 崩溃兜底：任何未捕获异常都变成一句人话（JSON 模式出 {error}，便于网页显示）──
//    否则格里芬没启动时只会丢一段 undici 栈，网页和命令行都看不出真正原因。
//    ⚠️ 顶层 await 的抛错走 uncaughtException（不是 unhandledRejection），两个都要挂。
const die = (e) => {
  const msg = String((e && e.message) || e);
  console.error((e && e.stack) || msg);            // 完整栈留给命令行 / 网页 stderr 折叠区
  if (JSON_OUT) OUT(JSON.stringify({ kind: "units", start: START, end: END, error: msg }));
  else console.error("❌ " + msg);
  process.exit(1);
};
process.on("uncaughtException", die);
process.on("unhandledRejection", die);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const qs = (e = {}) => new URLSearchParams({ access_token: TK, timestamp: String(Math.floor(Date.now() / 1000)), nonce: Math.random().toString(36).slice(2, 12), ...e }).toString();

async function adApi(path, params) {
  const r = await fetch(`https://api.e.qq.com/v3.0/${path}?${qs(params)}`).then(r => r.json());
  if (r.code !== 0) throw new Error(`广告 API ${path} 失败 ${r.code} ${r.message_cn || r.message}`);
  return r.data;
}
async function griffin(sql) {
  let r;
  try {
    r = await fetch(`http://127.0.0.1:${GRIFFIN}/api/sql`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql, ds: "main" }),
    }).then(x => x.json());
  } catch (e) {
    throw new Error(
      `连不上格里芬（127.0.0.1:${GRIFFIN}）：${e.message}\n` +
      `→ 先启动格里芬：双击 tools/griffin-data-tool/启动工具.command（默认 8787）`);
  }
  if (r.error) throw new Error("格里芬 SQL 失败：" + r.error);
  if (!r.rows) throw new Error("格里芬 SQL 失败：" + JSON.stringify(r).slice(0, 300));
  // 🔴 按列名取值，不依赖列顺序（格里芬/Grafana 返回的列顺序不可靠）
  const cols = r.columns || [];
  return r.rows.map(row => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}

// 1) 平台侧：单元消耗 / 注册 / 创角
const units = await adApi("adgroups/get", {
  account_id: AD.account_id,
  fields: JSON.stringify(["adgroup_id", "adgroup_name", "configured_status", "system_status", "optimization_goal", "bid_amount", "daily_budget", "begin_date", "end_date"]),
  page: "1", page_size: "100",
});
const live = (units.list || []);

// 2) 游戏侧：按单元（adId）的创角数与真实充值
//    🔴 adId 有脏值：`default`（无归因占位）与 16 位数字（疑似素材 ID，非单元 ID）。
//    真正的营销单元 ID 是 11~12 位纯数字 —— 脏值不能进单元级判定与合计，但人数必须报出来。
//    实测 2026-08：带 adId 创角 818 人里 697 人是 `default`（87.5%），不挡掉会让「按单元」的
//    付费合计和分母全歪；6/7 月脏值仅 0.1%（各 6 人）。
const ADID_OK = `adId REGEXP '^[0-9]{11,12}$'`;
const [rows, junkRows] = await Promise.all([
  griffin(`
SELECT r.adId AS uid, COUNT(*) AS reg, COUNT(DISTINCT p.playerId) AS payers,
       ROUND(IFNULL(SUM(p.amt),0)/100,2) AS amt
FROM (SELECT playerId, registerDay, adId FROM t_analysis_user
      WHERE registerDay BETWEEN '${START}' AND '${END}' AND byDayNum=1 AND adId<>'' AND playerId<>11001
        AND ${ADID_OK}) r
LEFT JOIN (SELECT playerId, SUM(money) amt FROM t_wei_xin_pay
           WHERE refund=0 AND playerId<>11001 GROUP BY playerId) p ON p.playerId=r.playerId
GROUP BY r.adId`),
  griffin(`
SELECT adId, COUNT(*) AS n FROM t_analysis_user
WHERE registerDay BETWEEN '${START}' AND '${END}' AND byDayNum=1 AND adId<>'' AND playerId<>11001
  AND NOT (${ADID_OK})
GROUP BY adId ORDER BY n DESC`),
]);
const game = {};
for (const r of rows) game[String(r.uid)] = { reg: Number(r.reg), payers: Number(r.payers), amt: Number(r.amt) };
const junk = junkRows.map(r => ({ id: String(r.adId), n: Number(r.n) }));
const junkN = junk.reduce((a, x) => a + x.n, 0);

// 2b) 目标单元集合 = 现存单元 ∪ 游戏侧出现过的单元（含已删除的历史单元，否则成熟队列判不了）
//     同时记下 begin_date：判定「窗口内 0 消耗」时必须区分
//     ① 当时还没建（窗口早于起投日）② 建了但没投 ③ 投过、本窗口没投 —— 三者含义完全不同。
const known = new Map();
for (const u of live) known.set(String(u.adgroup_id), {
  id: String(u.adgroup_id),
  name: u.adgroup_name || `（${u.adgroup_id}）`,
  sys: String(u.system_status).replace("ADGROUP_STATUS_", ""),
  conf: String(u.configured_status || "").replace("AD_STATUS_", ""),
  begin: u.begin_date && u.begin_date !== "0" ? String(u.begin_date) : null,
  end: u.end_date && u.end_date !== "0" ? String(u.end_date) : null,
});
for (const uid of Object.keys(game)) if (!known.has(uid)) known.set(uid, { id: uid, name: `（已删 · ${uid}）`, sys: "DELETED?", conf: null, begin: null, end: null });
const targetIds = [...known.keys()];

// 2c) 平台侧：窗口内按单元消耗（🔴 不要加 adgroup_id 过滤——带 IN 过滤会漏掉已删除单元；
//     不带过滤可完整返回窗口内所有投过量的单元，含已删单元，实测 7 月合计与账户总额一致）
const plat = {};
const rep = await adApi("daily_reports/get", {
  account_id: AD.account_id, level: "REPORT_LEVEL_ADGROUP",
  date_range: JSON.stringify({ start_date: START, end_date: END }),
  group_by: JSON.stringify(["adgroup_id"]),
  // adgroup_name 一起取：adgroups/get 只认现存单元，已删单元的名字只能从这里补
  fields: JSON.stringify(["adgroup_id", "adgroup_name", "cost", "mini_game_register_users", "view_count", "valid_click_count"]),
  page: "1", page_size: "200",
});
for (const r of rep.list || []) plat[r.adgroup_id] = { cost: (r.cost || 0) / 100, platReg: r.mini_game_register_users || 0, name: r.adgroup_name || "" };
const platTotal = Object.values(plat).reduce((a, b) => a + b.cost, 0);

// 名称字典 id → 全称。adgroups/get 只认现存单元，已删单元的名字只能从报表拿。
const nameDict = {};
for (const [id, p] of Object.entries(plat)) if (p.name) nameDict[id] = p.name;

// 窗口内报表只覆盖「该窗口有消耗」的单元；已删 / 历史单元可能只在别的月份投过。
// 名字是元数据、与查询窗口无关，所以缺名时再用全期窗口补一次（只为补名，不带指标）。
const missing = [...known.values()].filter(u => u.sys === "DELETED?" && !nameDict[u.id]).map(u => u.id);
if (missing.length) {
  try {
    const nr = await adApi("daily_reports/get", {
      account_id: AD.account_id, level: "REPORT_LEVEL_ADGROUP",
      date_range: JSON.stringify({ start_date: "2026-01-01", end_date: day(0) }),
      group_by: JSON.stringify(["adgroup_id"]),
      fields: JSON.stringify(["adgroup_id", "adgroup_name", "cost"]),
      page: "1", page_size: "200",
    });
    for (const r of nr.list || []) if (r.adgroup_name) nameDict[String(r.adgroup_id)] = r.adgroup_name;
  } catch { /* 补名是尽力而为，失败不拦判定 */ }
}

// 已删 / 历史单元定名：拿到全称就用全称（如「0703安卓11男25-45岁」）；
// 平台侧从未有过消耗的（报表也没有）才退回带 ID 的占位，保证可追溯。
for (const u of known.values()) {
  if (u.sys === "DELETED?") u.name = nameDict[u.id] || `（已删 · ${u.id}）`;
}

// 3) 合成判定
// 投放状态中文映射（configured_status + system_status 一起看，别只看系统状态）
function deliveryLabel(u) {
  if (u.sys === "DELETED?") return "已删/历史";
  if (u.conf === "SUSPEND") return "已暂停";
  switch (u.sys) {
    case "ACTIVE": return "投放中";
    case "DAILY_BUDGET_REACHED": return "投放中(预算已花完)";
    case "NOT_IN_DELIVERY_TIME": return "不在投放时段";
    case "SUSPEND": return "已暂停";
    case "END": return "已结束";
    case "PENDING": return "待投放";
    default: return u.sys || "—";
  }
}

const th = ["单元 ID", "名称", "投放状态", "平台消耗", "平台注册", "游戏创角", "CAC", "付费人数", "付费率", "真实充值", "ARPPU", "LTV/创角", "LTV÷CAC", "判定"];
const out = [];
out.push("窗口：" + START + " ~ " + END + "（游戏侧为创角队列口径，充值截至今日）｜平台消耗合计 " + platTotal.toFixed(2) + " 元");
if (junk.length) {
  out.push("⚠️ 已排除非单元 ID 的 adId（不计入下表与合计）：" +
    junk.map(x => `${x.id} ${x.n} 人`).join(" ｜ ") + "（共 " + junkN + " 人；真实单元 ID 应为 11~12 位数字）");
}
out.push(th.join(" | "));
const verdicts = [];
for (const u of known.values()) {
  const id = u.id;
  const g = game[id] || { reg: 0, payers: 0, amt: 0 };
  const p = plat[id] || { cost: 0, platReg: 0 };
  const cac = g.reg > 0 ? p.cost / g.reg : null;
  const ltv = g.reg > 0 ? g.amt / g.reg : null;
  const ratio = cac && ltv != null ? ltv / cac : null;
  // 付费情况：付费人数 = 至少付过一次的人（＝首充过的人），付费率分母用创角（与 CAC / LTV 同分母）
  const payRate = g.reg > 0 ? g.payers / g.reg : null;
  const arppu = g.payers > 0 ? g.amt / g.payers : null;
  const delivery = deliveryLabel(u);
  let v;
  // 🔴 「窗口内 0 消耗」有三种完全不同的成因，绝不能都叫「无投放」：
  //   ① 窗口早于起投日（当时这单元还不存在）→ 窗口外，与它现在的投放状态无关
  //   ② 单元建了但本窗口没花钱          → 无投放
  //   ③ 投过、只是本窗口没投            → 无投放
  // ⚠️ 只认平台消耗判「本窗口投没投」；游戏侧有创角只说明历史投过（例：104454591356 消耗 0 / 创角 1300）。
  const notYet = u.begin && u.begin > END;      // 起投日晚于窗口末日
  if (!p.cost) {
    if (notYet) v = "窗口外(" + u.begin + " 起投)";
    else v = "无投放";
  }
  else if (g.reg < 100) v = "样本不足(<100创角)";
  else if (ratio >= 1) v = "✅ 加量";
  else if (ratio >= 0.5) v = "⚠️ 维持观察";
  else v = "⛔ 停/降";
  verdicts.push({
    id, name: u.name, v,
    sys: u.sys, conf: u.conf, begin: u.begin, end: u.end, delivery,
    notYet,
    platCost: p.cost, platReg: p.platReg,
    gameReg: g.reg, payers: g.payers, amt: g.amt,
    payRate, arppu,
    cac, ltv, ratio,
  });
  out.push([
    id, u.name, delivery,
    p.cost.toFixed(2), p.platReg, g.reg,
    cac == null ? "—" : cac.toFixed(3),
    g.payers,
    payRate == null ? "—" : (payRate * 100).toFixed(2) + "%",
    g.amt.toFixed(2),
    arppu == null ? "—" : arppu.toFixed(2),
    ltv == null ? "—" : ltv.toFixed(4),
    ratio == null ? "—" : (ratio * 100).toFixed(1) + "%",
    v,
  ].join(" | "));
}

// ── 付费情况汇总：分「全部单元」与「窗口内投过的单元」两个口径 ──
//    全部单元含已删/历史队列（他们本窗口没花钱），在投口径才是「这些钱换来的付费」。
const roll = (list) => {
  const r = {
    units: list.length,
    gameReg: list.reduce((a, x) => a + x.gameReg, 0),
    payers: list.reduce((a, x) => a + x.payers, 0),
    amt: list.reduce((a, x) => a + x.amt, 0),
    payCost: list.reduce((a, x) => a + x.platCost, 0),
    paying: list.filter(x => x.payers > 0).length,
  };
  r.payRate = r.gameReg > 0 ? r.payers / r.gameReg : null;       // 付费人数 ÷ 创角
  r.arppu = r.payers > 0 ? r.amt / r.payers : null;              // 充值 ÷ 付费人数
  r.ltv = r.gameReg > 0 ? r.amt / r.gameReg : null;              // 每创角充值
  r.roi = r.payCost > 0 ? r.amt / r.payCost : null;              // 真实充值 ÷ 平台消耗
  return r;
};
const allTotals = roll(verdicts);
const liveTotals = roll(verdicts.filter(x => x.platCost > 0));
const money2 = (n) => n == null ? "—" : n.toFixed(2);
const pct2 = (n) => n == null ? "—" : (n * 100).toFixed(2) + "%";
const payLines = [
  "付费情况（窗口内投过的单元，n=" + liveTotals.units + "）：创角 " + liveTotals.gameReg +
    " ｜ 付费 " + liveTotals.payers + " 人（付费率 " + pct2(liveTotals.payRate) + "）｜ 充值 " + money2(liveTotals.amt) +
    " 元 ｜ ARPPU " + money2(liveTotals.arppu) + " 元 ｜ 每创角充值 " + (liveTotals.ltv == null ? "—" : liveTotals.ltv.toFixed(4)) +
    " 元 ｜ 真实 ROI " + pct2(liveTotals.roi),
  "付费情况（全部单元，n=" + allTotals.units + "）：创角 " + allTotals.gameReg +
    " ｜ 付费 " + allTotals.payers + " 人（付费率 " + pct2(allTotals.payRate) + "）｜ 充值 " + money2(allTotals.amt) +
    " 元 ｜ ARPPU " + money2(allTotals.arppu) + " 元 ｜ 有付费单元 " + allTotals.paying + "/" + allTotals.units,
];
const report = out.join("\n");
const T = {
  scaleUp: verdicts.filter(x => x.v.includes("加量")).length,
  watch: verdicts.filter(x => x.v.includes("观察")).length,
  stop: verdicts.filter(x => x.v.includes("停")).length,
  thin: verdicts.filter(x => x.v.includes("样本不足")).length,
  outOfWindow: verdicts.filter(x => x.v.startsWith("窗口外")).length,
  noSpend: verdicts.filter(x => x.v === "无投放").length,
};
const tallyLine = "判定分布：✅ 加量 " + T.scaleUp + " ｜ ⚠️ 观察 " + T.watch +
  " ｜ ⛔ 停/降 " + T.stop + " ｜ 样本不足 " + T.thin +
  " ｜ 无投放 " + T.noSpend + " ｜ 窗口外(未起投) " + T.outOfWindow +
  "（共 " + verdicts.length + " 个单元）";
console.log(report);
console.log("\n" + payLines.join("\n"));
console.log("\n" + tallyLine);
const dest = _j(TMP, "unit_ltv_verdict.txt");
fs.writeFileSync(dest, report + "\n\n" + payLines.join("\n") + "\n\n" + tallyLine + "\n");
console.log("\n（已写入 " + dest + "）");

if (JSON_OUT) OUT(JSON.stringify({
  kind: "units",
  generatedAt: new Date().toISOString(),
  start: START, end: END,
  griffinPort: GRIFFIN,
  platTotal,
  // 付费情况：live = 窗口内投过的单元（考核口径）；all = 含已删/历史队列
  pay: { live: liveTotals, all: allTotals },
  // 被挡掉的脏 adId（adId 字段被写成 default / 素材 ID 之类，不是营销单元）
  excludedAdIds: { total: junkN, items: junk },
  counts: {
    total: verdicts.length,
    scaleUp: T.scaleUp,
    watch: T.watch,
    stop: T.stop,
    noSpend: T.noSpend,
    thin: T.thin,
    outOfWindow: T.outOfWindow,
  },
  units: verdicts.sort((a, b) => (b.platCost || 0) - (a.platCost || 0)),
}));
