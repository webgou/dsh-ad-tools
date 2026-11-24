#!/usr/bin/env node
/**
 * 保本出价.mjs —— 游戏数据 → 优化目标 / 出价 的换算表
 * 曾用名：bid_ceiling.mjs
 *
 * 回答一个问题：账户里那几个「优化目标」，各自值多少钱？
 *   保本出价上限 = 该目标人群的累计人均充值（LTV）
 *   日均样本速度 = 日均注册 × 该目标转化率   ← 决定学习期能不能跑出来
 *
 * ⚠️ 关键口径（2026-09-18 倚天确认 + 实测）：
 *   游戏后台 t_analysis_user 的「注册」行 = **创角**，在创建角色时写入。
 *   - registerDay 与 t_player.registerTime 日期完全一致（实测 6,065 人全部相差 0 天）
 *   - t_user 带广告标记的 66,633 个账号 100% 有角色 → 连 adId 也是创角时回填
 *   → 游戏侧**看不到「进游戏但没创角」的人**；平台的「注册」事件在游戏后台无对应数据。
 *   → 因此出价上限分两种口径：
 *       · 按「创角」出价 → 上限 = 创角人群 LTV
 *       · 按「注册」出价 → 上限 = 创角人群 LTV × 平台创角率（注册→创角）
 *
 * 用法：
 *   node server.mjs（格里芬，tools/griffin-data-tool，默认端口 8787）
 *   node tools/ad-tools/保本出价.mjs [起始日 YYYY-MM-DD] [结束日 YYYY-MM-DD] [端口]
 *   例：node tools/ad-tools/保本出价.mjs 2026-07-01 2026-07-31 8787
 *   （端口默认 8787，与格里芬自带启动器一致；只有改了端口才需要传第 3 个参数）
 *   （脚本已自愈路径，任意 cwd、任意子目录均可运行；凭证自动读 仓库根/tmp/tencentads_credentials.json）
 *
 * 窗口默认 = 最近一周（截至昨天），方便一上手就有个数看看；
 * ⚠️ 但「保本上限」本身**必须用成熟队列**（注册距今 ≥30 天），否则 LTV 未成熟会低估出价上限。
 *    做决策请显式传一个成熟窗口，例如 2026-07-01 2026-07-31。
 */
import fs from "node:fs";
import { join as _j, dirname as _dn } from "node:path";
import { fileURLToPath } from "node:url";

// ── 仓库根自动定位 ───────────────────────────────────────────────
// 脚本住在 tools/ad-tools/，但凭证与留痕统一落在【仓库根/tmp/】。
// 从脚本所在目录向上找标志（AGENTS.md，或同时存在 tmp/ 与 doc/）；找不到则退回脚本同目录
// —— 后者用于把脚本单独拷到别的机器时（如 ~/tencent-ads-monitor）读同目录 token.txt。
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
// 窗口默认 = 最近一周（截至昨天，昨天的数据才完整）——与看板前端首次打开一致。
// ⚠️ 但本脚本要的是「保本上限」，那个值必须用成熟队列（队列距今 ≥30 天）才算得准；
//    默认窗口只是方便一上手就能出个数，做决策请显式传一个成熟窗口（如 2026-07-01 2026-07-31）。
const _d = (n) => new Date(Date.now() + 8 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);
const START = ARGS[0] || _d(-7);
const END = ARGS[1] || _d(-1);

// ── 崩溃兜底：任何未捕获异常都变成一句人话（JSON 模式出 {error}，便于网页显示）──
//    否则格里芬没启动时只会丢一段 undici 栈，网页和命令行都看不出真正原因。
//    ⚠️ 顶层 await 的抛错走 uncaughtException（不是 unhandledRejection），两个都要挂。
const die = (e) => {
  const msg = String((e && e.message) || e);
  console.error((e && e.stack) || msg);            // 完整栈留给命令行 / 网页 stderr 折叠区
  if (JSON_OUT) OUT(JSON.stringify({ kind: "ceiling", start: START, end: END, error: msg }));
  else console.error("❌ " + msg);
  process.exit(1);
};
process.on("uncaughtException", die);
process.on("unhandledRejection", die);

async function griffin(sql) {
  let r;
  try {
    r = await fetch(`http://127.0.0.1:${GRIFFIN}/api/sql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql, ds: "main" }),
    }).then(x => x.json());
  } catch (e) {
    throw new Error(
      `连不上格里芬（127.0.0.1:${GRIFFIN}）：${e.message}\n` +
      `→ 先启动格里芬：双击 tools/griffin-data-tool/启动工具.command（默认 8787）`);
  }
  if (!r.rows) throw new Error("格里芬 SQL 失败：" + JSON.stringify(r).slice(0, 300));
  // 按列名取值，不依赖列顺序（Grafana 返回顺序不可靠）
  const cols = r.columns || [];
  return r.rows.map(row => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}

// ---------- 平台侧：注册 / 创角 / 消耗 ----------
const tkFile = _j(TMP, "tencentads_credentials.json");
/* 广告账户：只认环境变量 MKT_ACCOUNT_ID（插件/命令行都会传）；不再内置默认账户 */
const ACCT = /^\d{5,12}$/.test(String(process.env.MKT_ACCOUNT_ID || "").trim())
  ? String(process.env.MKT_ACCOUNT_ID).trim() : "";
if (!ACCT) { console.error("未指定广告账户：请设置 MKT_ACCOUNT_ID"); process.exit(1); }
let plat = null;
try {
  const TK = JSON.parse(fs.readFileSync(tkFile, "utf8")).access_token;
  const qs = (e = {}) => new URLSearchParams({
    access_token: TK, timestamp: String(Math.floor(Date.now() / 1000)),
    nonce: Math.random().toString(36).slice(2, 12), ...e,
  }).toString();
  const url = "https://api.e.qq.com/v3.0/daily_reports/get?" + qs({
    account_id: ACCT, level: "REPORT_LEVEL_ADVERTISER",
    date_range: JSON.stringify({ start_date: START, end_date: END }),
    group_by: JSON.stringify(["date"]),
    fields: JSON.stringify(["date", "cost", "view_count", "valid_click_count",
      "mini_game_register_users", "mini_game_create_role_users"]),
    page: "1", page_size: "200",
  });
  const r = await fetch(url).then(r => r.json());
  if (r.code === 0) {
    let cost = 0, reg = 0, role = 0, clk = 0, imp = 0;
    for (const x of (r.data.list || [])) {
      cost += x.cost || 0; reg += x.mini_game_register_users || 0;
      role += x.mini_game_create_role_users || 0;
      clk += x.valid_click_count || 0; imp += x.view_count || 0;
    }
    plat = { cost: cost / 100, reg, role, clk, imp };
  }
} catch { /* 无凭证则跳过平台口径 */ }

// ---------- 游戏侧：队列基数 ----------
// 🔴 adId 有脏值（`default` 无归因占位、16 位数字疑似素材 ID），真实营销单元 ID 是 11~12 位数字。
//    不挡掉会让队列基数虚高：实测 2026-08 带 adId 创角 818 人里 697 人是 `default`（87.5%）。
//    与 单元LTV判定.mjs 用同一条过滤，保证两脚本「广告创角」定义一致。
const ADID_OK = `adId REGEXP '^[0-9]{11,12}$'`;
const base = await griffin(`
SELECT COUNT(*) AS reg, DATEDIFF('${END}','${START}')+1 AS days
FROM (SELECT DISTINCT playerId FROM t_analysis_user
      WHERE byDayNum=1 AND channel<>0 AND adId<>'' AND playerId<>11001 AND ${ADID_OK}
        AND registerDay BETWEEN '${START}' AND '${END}') t`);
const REG = Number(base[0].reg);
const DAYS = Number(base[0].days);
const PER_DAY = REG / DAYS;

// 被挡掉的脏 adId（人数 + 明细），报出来保持透明
const junkRows = await griffin(`
SELECT adId, COUNT(*) AS n FROM t_analysis_user
WHERE registerDay BETWEEN '${START}' AND '${END}' AND byDayNum=1 AND channel<>0 AND adId<>'' AND playerId<>11001
  AND NOT (${ADID_OK})
GROUP BY adId ORDER BY n DESC`);
const junk = junkRows.map(r => ({ id: String(r.adId), n: Number(r.n) }));
const junkN = junk.reduce((a, x) => a + x.n, 0);

/** 一个事件：人群 = 队列 ∩ cond，取人数 / 充值 / 付费人数 */
async function ev(cond) {
  const r = await griffin(`
SELECT COUNT(*) AS cnt,
       ROUND(IFNULL(SUM(p.rechargeAmount),0)/100, 2) AS amt,
       SUM(CASE WHEN p.rechargeAmount>0 THEN 1 ELSE 0 END) AS payers
FROM (SELECT DISTINCT playerId, registerDay FROM t_analysis_user
      WHERE byDayNum=1 AND channel<>0 AND adId<>'' AND playerId<>11001 AND ${ADID_OK}
        AND registerDay BETWEEN '${START}' AND '${END}') a
JOIN t_player p ON p.playerId=a.playerId
WHERE ${cond}`);
  return { cnt: Number(r[0].cnt), amt: Number(r[0].amt), payers: Number(r[0].payers) };
}

const D1 = `EXISTS (SELECT 1 FROM t_analysis_user x WHERE x.playerId=a.playerId AND x.loginDay=a.registerDay+1)`;

const defs = [
  ["创角（=游戏侧注册行）", "1=1", "游戏侧能观测到的基数"],
  ["进入第 2 关", "p.missionLevel>=2", "转化率极高，但几乎无 LTV 增益"],
  ["进入第 10 关", "p.missionLevel>=10", "深度目标候选"],
  ["进入第 30 关", "p.missionLevel>=30", ""],
  ["主将 10 级", "p.masterLevel>=10", ""],
  ["D1 次留", D1, "★ 最强付费预测因子"],
  ["付费（首充）", "p.rechargeAmount>0", "样本极稀，看学习期一列"],
];

const rows = [];
for (const [name, cond, note] of defs) rows.push({ name, note, ...(await ev(cond)) });
const total = await ev("1=1");

// 注册→创角率（平台口径，用于把「按创角」换算成「按注册」）
const roleRate = plat && plat.reg > 0 ? plat.role / plat.reg : null;

const out = [];
const jsonTargets = [];
out.push(`窗口 ${START} ~ ${END}`);
out.push(`游戏侧创角队列 ${REG}（日均 ${PER_DAY.toFixed(1)}）｜队列累计充值 ${total.amt.toFixed(2)} 元｜每创角充值 ${(total.amt / REG).toFixed(4)} 元`);
if (junk.length) {
  out.push(`⚠️ 已排除 ${junkN} 人 / ${junk.length} 个非单元 ID 的 adId（不计入队列）：` +
    junk.map(x => `${x.id} ${x.n} 人`).join(" ｜ ") + `（真实营销单元 ID 为 11~12 位数字）`);
}
if (plat) {
  // 分母为 0 时给「—」：停投窗口（消耗 0 / 注册 0）会让 0/0 变成 NaN 冒到输出里
  const regCost = plat.reg > 0 ? (plat.cost / plat.reg).toFixed(2) + " 元" : "—";
  const roleCost = plat.role > 0 ? (plat.cost / plat.role).toFixed(2) + " 元" : "—";
  const rr = roleRate == null ? "—" : (roleRate * 100).toFixed(1) + "%";
  out.push(`平台侧：消耗 ${plat.cost.toFixed(2)} 元｜注册 ${plat.reg}｜创角 ${plat.role}｜创角率 ${rr}｜注册成本 ${regCost}｜创角成本 ${roleCost}`);
} else {
  out.push("⚠️ 未读到平台凭证，无法给「按注册出价」口径（只有按创角上限）");
}
out.push("");
out.push(`优化目标 | 转化率 | 该人群付费率 | 保本上限·按创角 | 保本上限·按注册${roleRate ? "" : "(缺创角率)"} | 日均样本 | 学习期`);
out.push("---|---|---|---|---|---|---|");
for (const r of rows) {
  const rate = r.cnt / REG;
  const payRate = r.cnt ? r.payers / r.cnt : 0;
  const ltv = r.cnt ? r.amt / r.cnt : 0;
  const ltvReg = roleRate ? ltv * roleRate : null;
  const daily = PER_DAY * rate;
  const feasible = daily >= 20 / 7 ? "✅ 够" : daily >= 1.45 ? "⚠️ 勉强" : "⛔ 学不出来";
  jsonTargets.push({
    name: r.name, note: r.note,
    cnt: r.cnt, amt: r.amt, payers: r.payers,
    rate, payRate, ltv, ltvReg, daily, feasible,
  });
  out.push([
    r.name,
    (rate * 100).toFixed(2) + "%",
    (payRate * 100).toFixed(2) + "%",
    ltv.toFixed(4) + " 元",
    ltvReg == null ? "—" : ltvReg.toFixed(4) + " 元",
    daily.toFixed(2),
    feasible,
  ].join(" | ") + (r.note ? `　${r.note}` : ""));
}
out.push("");
out.push("读法：");
out.push("  · 出价 ≤ 保本上限才不亏（ROI=100%）；按注册出价要再乘创角率，因为买到的人里只有一部分会创角。");
out.push("  · 「日均样本」< 2.9（=20 转化/7 天）的目标不要单独开单元，学习期跑不出来。");
out.push("  · 转化率高 + 人均充值高 才是好目标；只有转化率高、人均不涨的是「假深度」。");

console.log(out.join("\n"));

if (JSON_OUT) OUT(JSON.stringify({
  kind: "ceiling",
  generatedAt: new Date().toISOString(),
  start: START, end: END,
  griffinPort: GRIFFIN,
  game: {
    cohort: REG, days: DAYS, perDay: PER_DAY,
    totalRecharge: total.amt,
    perRoleRecharge: total.amt / REG,
  },
  platform: plat ? { ...plat, roleRate, regCost: plat.reg > 0 ? plat.cost / plat.reg : null, roleCost: plat.role > 0 ? plat.cost / plat.role : null } : null,
  targets: jsonTargets,
  breakevenCostPerRole: total.amt / REG,
  // 被挡掉的脏 adId（adId 字段被写成 default / 16 位非单元 ID），不计入队列
  excludedAdIds: { total: junkN, items: junk },
}));
