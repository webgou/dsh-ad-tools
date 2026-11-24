// 注册留存.mjs
// 广告平台「注册」口径面板：逐日 注册 / 注册成本 / 创角 / 次留 / 次留成本 + 窗口合计
// 用法: node tools/ad-tools/注册留存.mjs <起> <止>
//   （脚本自愈路径，任意 cwd 均可运行；凭证与留痕在 仓库根/tmp/）
//
// 🔴 口径（与 创角次留.mjs 完全同源，两边数字必须一致）
//   注册   = mini_game_register_users       （平台口径的「注册」）
//   创角   = mini_game_create_role_users
//   次留人数 = mini_game_retention_d1        （【次日留存的创角人数】，整数，不是百分比）
//
//   🔴🔴 次留率有【两个分母】，差 ~3.3 倍，都出、都标清楚，别混用（09-23 实测钉死）：
//     · 广告平台自带 `mini_game_retention_d1_rate` 的隐含分母 = 【注册】（同日、逐行偏差 0.0%）
//       → 这就是**广告后台那个「次留%」**，个位数。本脚本 = retRateReg = rt[D] ÷ 注册[D]
//     · 权威口径 = ÷【创角】（retention_d1 报的是「创角人数」的次日留存，分母本该是创角）
//       → retRate = rt[D] ÷ 创角[D-1]（错位；见下）
//     ⚠️ 分母不同 ≠ 谁错：广告后台（÷注册）与游戏后台（÷游戏侧注册＝平台创角）
//        根本不是一个指标，混着比就会得出「差 3 倍」的假矛盾。
//        注册/创角 ≈ 3.3（2448/732）→ 两个率正好差这个倍数。
//   ⚠️ 平台自带的 `retention_d1_rate` 还有一个毛病：它是 rt[D] ÷ 注册[D]（同一天），
//      而 rt[D] 属于【前一日】队列 → 分子分母不是同一批人，放量期会偏。
//
//   ⚠️ retention_d1 按【留存发生日】回报，不是【注册日】：
//        retention_d1[D] 对应的是 D-1 那批创角队列
//      →【逐日】次留率分母必须用【前一日创角】：ret[D] ÷ cr[D-1]
//      →【窗口合计】的「错位」版 = 分母取 [S-1, E-1] 的创角（下称【对齐】，27 行处的 retRate）
//        ⚠️ 放量期这一层差很大（09-12~09-20：对齐 26.02% vs 同窗口 19.95%，差 31%）→ 不是「可忽略」
//        「÷注册」那一路保持同窗口 sum/sum（＝广告后台的构造方式，5.96% 已对平）
//
//   🔴 平台报表【没有 3留 / 7留】：实测 26 个候选字段名只有 d1 有值；
//      单独传 mini_game_retention_d3 直接报 1801145「未选择指标」（该字段不被识别）。
//      3留/7留 唯一来源是游戏后台（byDayNum=3 / =7），见 tools/griffin-data-tool。
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

const CRED = JSON.parse(fs.readFileSync(_j(TMP, "tencentads_credentials.json"), "utf8"));
const ACC = /^\d{5,12}$/.test(String(process.env.MKT_ACCOUNT_ID || "").trim())
  ? String(process.env.MKT_ACCOUNT_ID).trim() : "";
if (!ACC) { console.error("未指定广告账户：请设置 MKT_ACCOUNT_ID"); process.exit(1); }

// ── --json：给网页端用的结构化输出（stdout 出 JSON，文本全部静音）──
const JSON_OUT = process.argv.includes("--json");
let OUT = console.log.bind(console);
if (JSON_OUT) {
  OUT = (s) => { try { fs.writeSync(1, s + "\n"); } catch { } };
  console.log = () => { };
}
const [S, E] = process.argv.slice(2).filter(a => a !== "--json");

if (!S || !E) { console.log("用法: node tools/ad-tools/注册留存.mjs 2026-09-01 2026-09-18"); process.exit(1); }
if (S > E) { console.error("起始日不能晚于结束日"); process.exit(1); }

const shift = (d, n) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);
const S1 = shift(S, -1);   // 逐日错位口径需要的前一日

const qs = (e = {}) => new URLSearchParams({
  access_token: CRED.access_token, timestamp: String(Math.floor(Date.now() / 1000)),
  nonce: Math.random().toString(36).slice(2, 12), ...e,
}).toString();

const F = ["date", "cost", "mini_game_register_users", "mini_game_create_role_users", "mini_game_retention_d1"];

const r = await fetch(`https://api.e.qq.com/v3.0/daily_reports/get?${qs({
  account_id: ACC, level: "REPORT_LEVEL_ADGROUP",
  date_range: JSON.stringify({ start_date: S1, end_date: E }),
  group_by: JSON.stringify(["date"]),
  fields: JSON.stringify(F),
  page: "1", page_size: "500",
})}`).then(x => x.json());

const out = [];
const L = s => { out.push(s); console.log(s); };
const N = x => Number(x || 0);

if (r.code !== 0) {
  const msg = "ERR " + r.code + " " + (r.message_cn || r.message || "");
  L(msg);
  console.error(msg);
  process.exit(1);
}

/* 🔴 字段名拼错会被静默丢弃（不报错），会得出「全 0」的假结论 → 显式自检一次 */
const rowsRaw = r.data?.list || [];
if (rowsRaw.length && !("mini_game_register_users" in rowsRaw[0])) {
  const msg = "ERR 返回行里没有 mini_game_register_users 字段 —— 字段名可能失效，请先核对口径";
  L(msg); console.error(msg); process.exit(1);
}

const m = {};
for (const x of rowsRaw) m[x.date] = x;
const dates = Object.keys(m).sort();

L(`窗口 ${S} ~ ${E}｜维度 逐日｜账户 ${ACC}`);
L("日期 | 消耗 | 注册 | 注册成本 | 创角 | 创角率 | 次留人数 | 次留率(÷注册,后台口径) | 次留率(÷创角,错位,权威) | 次留成本");

let C = 0, RG = 0, CR = 0, RT = 0, CRp = 0;
const jsonRows = [];
for (const d of dates) {
  if (d < S) continue;
  const x = m[d], p = m[shift(d, -1)];
  const c = N(x.cost) / 100, reg = N(x.mini_game_register_users), cr = N(x.mini_game_create_role_users);
  const rt = N(x.mini_game_retention_d1), crPrev = N(p?.mini_game_create_role_users);

  C += c; RG += reg; CR += cr; RT += rt; CRp += crPrev;

  const retRateReg = reg > 0 ? rt / reg : null;         // 后台口径：÷ 同日注册（个位数，与广告后台一致）
  const retRate = crPrev > 0 ? rt / crPrev : null;      // 权威：错位 ÷ 前一日创角
  const retRateSameDay = cr > 0 ? rt / cr : null;       // 对照：同日创角（勿用）
  jsonRows.push({
    date: d, cost: c, reg, cr,
    regCost: reg > 0 ? c / reg : null,                  // 注册成本
    crRate: reg > 0 ? cr / reg : null,                  // 创角 ÷ 注册
    rt, crPrev,
    rtCost: rt > 0 ? c / rt : null,                     // 次留成本
    retRateReg, retRate, retRateSameDay,
  });

  const f = (v, n = 2) => (v == null ? "-" : v.toFixed(n));
  const pc = (v, n = 1) => (v == null ? "-" : (v * 100).toFixed(n) + "%");
  L(`${d} | ${c.toFixed(2).padStart(9)} | ${String(reg).padStart(5)} | ${f(reg > 0 ? c / reg : null).padStart(8)} | ${String(cr).padStart(5)} | ${(reg ? (cr / reg * 100).toFixed(1) + "%" : "-").padStart(7)} | ${String(rt).padStart(5)} | ${pc(retRateReg, 2).padStart(8)} | ${pc(retRate).padStart(8)} | ${f(rt > 0 ? c / rt : null).padStart(8)}`);
}

L(`\n合计 | 消耗 ${C.toFixed(2)} | 注册 ${RG} | 注册成本 ${(C / (RG || 1)).toFixed(2)} | 创角 ${CR} | 创角率 ${(CR / (RG || 1) * 100).toFixed(1)}% | 次留 ${RT} | 次留成本 ${(C / (RT || 1)).toFixed(2)}`);
L(`次留率（÷注册，分母 ${RG}）= ${(RT / (RG || 1) * 100).toFixed(2)}%   ← 广告后台显示的那个个位数`);
L(`次留率（÷创角，错位，分母 ${CRp}）= ${(RT / (CRp || 1) * 100).toFixed(2)}%   ← 权威`);
L(`次留率（÷创角，同日，分母 ${CR}）= ${(RT / (CR || 1) * 100).toFixed(2)}%   ← 对照，勿用`);
L(`ℹ️ 两个分母差 ${(RG / (CR || 1)).toFixed(2)} 倍（注册/创角）→ 率也差这个倍数；分母不同 ≠ 谁错。`);

/* 口径自检：同日口径出现 >100% 的天数 */
let bad = 0, worst = 0;
for (const d of dates) {
  if (d < S) continue;
  const x = m[d];
  const cr = N(x.mini_game_create_role_users), rt = N(x.mini_game_retention_d1);
  if (cr > 0 && rt > cr) { bad++; worst = Math.max(worst, rt / cr); }
}
if (bad) L(`\n【口径自检】同日口径下有 ${bad} 天「次留人数 > 同日创角」（最大 ${(worst * 100).toFixed(1)}%）→ 必须用错位口径。`);

/* 末行半成品警示 */
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
const tailIsToday = E >= TODAY;
if (tailIsToday) {
  L(`\n⚠️ 窗口末尾 ${E} 是今天 → 末行次留率是【半成品】：D1 次留在次日全天累积，当天读数既可能没跑完、`);
  L(`   也可能混入前一批队列的延迟留存。做结论请把结束日改到昨天。`);
}

/* 缺口警示：窗口内有没有「有消耗但零注册」的天（多为数据未回传，不是真没量） */
const zeroDays = jsonRows.filter(x => x.cost > 0 && x.reg === 0).map(x => x.date);
if (zeroDays.length) L(`\n⚠️ 有 ${zeroDays.length} 天「有消耗但注册为 0」：${zeroDays.join(", ")} —— 先怀疑回传未到，再当真实 0。`);

fs.writeFileSync(_j(TMP, `register_retention_${S}_${E}.txt`), out.join("\n"));

const PAYLOAD = {
  kind: "register", start: S, end: E,
  rows: jsonRows,
  total: {
    cost: C, reg: RG, cr: CR, rt: RT,
    regCost: RG > 0 ? C / RG : null,
    crRate: RG > 0 ? CR / RG : null,
    crCost: CR > 0 ? C / CR : null,
    rtCost: RT > 0 ? C / RT : null,
    retRateReg: RG > 0 ? RT / RG : null,       // 广告后台口径：÷ 注册
    retRate: CRp > 0 ? RT / CRp : null,        // 权威：错位 ÷ 前一日创角
    retRateSameDay: CR > 0 ? RT / CR : null,   // 对照
  },
  denomRatio: CR > 0 ? RG / CR : null,         // 注册/创角 倍数（解释两个率为何差这么多）
  selfCheck: { badDays: bad, worst, zeroRegDays: zeroDays },
  tailIsToday,
  note: "平台报表无 3留/7留 字段（已实测）；3留/7留 需走游戏后台 byDayNum=3/=7",
};

if (JSON_OUT) OUT(JSON.stringify({ generatedAt: new Date().toISOString(), ...PAYLOAD }));
