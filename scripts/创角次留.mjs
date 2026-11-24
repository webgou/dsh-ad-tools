// 创角次留.mjs（曾用名 creative_retention.mjs）
// 创角次留报表：平台口径，可到素材/版位/日期维度
// 用法: node tools/ad-tools/创角次留.mjs <起> <止> [dim]
//   dim: date(默认) | site_set | dynamic_creative_id
//   （脚本自愈路径，任意 cwd 均可运行；凭证与留痕在 仓库根/tmp/）
//
// 🔴 口径（详见 skill griffin-game-backend-verify）
//   次留率 = mini_game_retention_d1 ÷ mini_game_create_role_users
//   `retention_d1` 是【次日留存的创角人数（整数）】，不是百分比。
//   ⚠️ 且它按【留存发生日】回报，不是【注册日】：
//        retention_d1[D] 对应的是 D-1 那批创角队列
//      →【逐日】分母必须用【前一日】创角：ret[D] ÷ cr[D-1]
//      →【区间汇总 / 按单元 / 按素材】**也要错位**（09-23 修正旧说法「不涉及错位」）：
//         对齐的分母是 [S-1, E-1] 的创角，不是同窗口的 [S, E]。放量期差 31%（09-12~09-20：26.02% vs 19.95%），
//         只有平稳期才可忽略。本脚本按维度的汇总沿用旧口径（同窗口 sum/sum），
//         逐日口径见 注册留存.mjs / 创意数据.mjs（它们两个都出）。
//   实测依据：7 月按天，同日口径会出现 187.5%/166.7%/115.8% 三个 >100% 的不可能值；
//             错位口径最大值 23.3%，加权 14.63% 精确对上游戏侧 15.21%。
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
/* 广告账户：只认环境变量 MKT_ACCOUNT_ID（插件/命令行都会传）；不再内置默认账户 */
const ACC = /^\d{5,12}$/.test(String(process.env.MKT_ACCOUNT_ID || "").trim())
  ? String(process.env.MKT_ACCOUNT_ID).trim() : "";
if (!ACC) { console.error("未指定广告账户：请设置 MKT_ACCOUNT_ID"); process.exit(1); }

// ── --json：给网页端用的结构化输出（stdout 出 JSON，文本全部静音）──
//    ⚠️ 必须先把 --json 从 argv 里剔掉，否则它会占据位置参数的位置，
//       把「起始日」顶到第 3 个参数上 → 日期全错。
const JSON_OUT = process.argv.includes("--json");
let OUT = console.log.bind(console);
if (JSON_OUT) {
  // 同步写：避免 process.exit() 截断管道里的 stdout
  OUT = (s) => { try { fs.writeSync(1, s + "\n"); } catch { } };
  console.log = () => { };
}
const [S, E, DIM = "date"] = process.argv.slice(2).filter(a => a !== "--json");

if (!S || !E) { console.log("用法: node tools/ad-tools/创角次留.mjs 2026-09-01 2026-09-18 [date|site_set|dynamic_creative_id]"); process.exit(1); }

const shift = (d, n) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);
const S1 = shift(S, -1);   // 逐日口径需要的前一日

const qs = (e = {}) => new URLSearchParams({
  access_token: CRED.access_token, timestamp: String(Math.floor(Date.now() / 1000)),
  nonce: Math.random().toString(36).slice(2, 12), ...e,
}).toString();

const LEVEL = DIM === "dynamic_creative_id" ? "REPORT_LEVEL_DYNAMIC_CREATIVE" : "REPORT_LEVEL_ADGROUP";
const start = DIM === "date" ? S1 : S;   // 逐日多取一天做分母
const F = [DIM, "cost", "mini_game_register_users", "mini_game_create_role_users", "mini_game_retention_d1"];
if (DIM !== "date") F.push("date");

const r = await fetch(`https://api.e.qq.com/v3.0/daily_reports/get?${qs({
  account_id: ACC, level: LEVEL,
  date_range: JSON.stringify({ start_date: start, end_date: E }),
  group_by: JSON.stringify(DIM === "date" ? ["date"] : [DIM]),
  fields: JSON.stringify(F),
  page: "1", page_size: "500",
})}`).then(x => x.json());

const out = [];
const L = s => { out.push(s); console.log(s); };
const N = x => x || 0;
let PAYLOAD = null;   // --json 时输出它

if (r.code !== 0) {
  const msg = "ERR " + r.code + " " + r.message_cn;
  L(msg);
  console.error(msg);            // 让 --json 模式（stdout 被静音）也能在 stderr 看到原因
  process.exit(1);
}

const rows = r.data?.list || [];

if (DIM === "date") {
  const m = {};
  for (const x of rows) m[x.date] = x;
  const dates = Object.keys(m).sort();
  L(`窗口 ${S} ~ ${E}｜维度 逐日｜口径 次留率 = retention_d1[D] ÷ 创角[D-1]（错位）`);
  L("日期 | 消耗 | 注册 | 创角 | 创角率 | 次留人数 | 次留率(错位) | 同日口径(对照,勿用)");
  let C = 0, RG = 0, CR = 0, RT = 0, CRp = 0;
  const jsonRows = [];
  for (const d of dates) {
    if (d < S) continue;
    const x = m[d], p = m[shift(d, -1)];
    const c = N(x.cost) / 100, reg = N(x.mini_game_register_users), cr = N(x.mini_game_create_role_users);
    const rt = N(x.mini_game_retention_d1), crPrev = N(p?.mini_game_create_role_users);
    C += c; RG += reg; CR += cr; RT += rt; CRp += crPrev;
    jsonRows.push({
      date: d, cost: c, reg, cr,
      crRate: reg > 0 ? cr / reg : null,
      rt, crPrev,
      retRate: crPrev > 0 ? rt / crPrev : null,          // 权威：错位口径
      retRateSameDay: cr > 0 ? rt / cr : null,           // 对照：同日口径（勿用）
    });
    const ok = crPrev ? (rt / crPrev * 100).toFixed(1) + "%" : "-";
    const bad = cr ? (rt / cr * 100).toFixed(1) + "%" : "-";
    L(`${d} | ${c.toFixed(2).padStart(9)} | ${String(reg).padStart(5)} | ${String(cr).padStart(5)} | ${(reg ? (cr / reg * 100).toFixed(1) : "-").padStart(7)}% | ${String(rt).padStart(5)} | ${ok.padStart(8)} | ${bad.padStart(8)}`);
  }
  L(`\n合计 | 消耗 ${C.toFixed(2)} | 注册 ${RG} | 创角 ${CR} | 创角率 ${(CR / (RG || 1) * 100).toFixed(1)}% | 次留 ${RT}`);
  L(`次留率（错位对齐，分母 ${CRp}）= ${(RT / (CRp || 1) * 100).toFixed(2)}%   ← 权威（分母取窗口前一天起的创角）`);
  L(`次留率（同窗口，分母 ${CR}）= ${(RT / (CR || 1) * 100).toFixed(2)}%   ← 对照`);
  L(`  ⚠️ 两者【放量期差很大】不是「量级一致」：次留人数属于前一日队列，创角在涨时同窗口分母偏大、率偏低；`);
  L(`     09-12~09-20 实测 26.02%（对齐）vs 19.95%（同窗口），差 31%。做结论用【对齐】那个。`);
  L(`创角成本 ${(C / (CR || 1)).toFixed(2)} 元/个｜次留成本 ${(C / (RT || 1)).toFixed(2)} 元/个`);

  // 自检：同日口径出现 >100% 的天数（次留人数不可能多于前一日创角 → 逻辑矛盾）
  let bad = 0, worst = 0;
  for (const d of dates) {
    if (d < S) continue;
    const x = m[d];
    const cr = N(x.mini_game_create_role_users), rt = N(x.mini_game_retention_d1);
    if (cr > 0 && rt > cr) { bad++; worst = Math.max(worst, rt / cr); }
  }
  L(`\n【口径自检】同日口径下有 ${bad} 天「次留人数 > 同日创角」（最大 ${(worst * 100).toFixed(1)}%）→ 数学上不可能，`);
  L(`  证明确需错位（次留人数 ≤ 前一日创角人数）。错位口径下无此问题。`);

  // 末行半成品警示：窗口末尾若是「今天」，该行次留尚未结算完
  const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  const tailIsToday = E >= TODAY;
  if (tailIsToday) {
    L(`\n⚠️ 窗口末尾 ${E} 是今天 → 末行次留率是【半成品】，不可当结论：`);
    L(`   D1 次留在次日全天累积，当天读数既可能还没跑完、也可能混入前一批队列的延迟留存`);
    L(`   （实测 09-18 21:55 读末行得 50.0%，明显偏离历史 15~20%）。`);
    L(`   → 合计已含该行，做结论请改用【不含今天】的窗口重跑一次。`);
  }
  PAYLOAD = {
    kind: "retention", dim: "date", start: S, end: E,
    rows: jsonRows,
    total: {
      cost: C, reg: RG, cr: CR, rt: RT,
      crRate: RG > 0 ? CR / RG : null,
      crCost: CR > 0 ? C / CR : null,
      rtCost: RT > 0 ? C / RT : null,
      retRate: CRp > 0 ? RT / CRp : null,        // ★ 权威：分母取 [S-1, E-1] 创角（对齐）
      retRateWin: CR > 0 ? RT / CR : null,       // 对照：同窗口 sum/sum
      retRateSameDay: CR > 0 ? RT / CR : null,   // 旧字段名（＝同窗口），保留兼容
    },
    selfCheck: { badDays: bad, worst: worst },
    tailIsToday,
  };
} else {
  L(`窗口 ${S} ~ ${E}｜维度 ${DIM}｜口径 次留率 = retention_d1 ÷ 创角（同窗口；逐日的对齐口径见「注册留存」）`);
  L("维度 | 消耗 | 注册 | 创角 | 创角率 | 次留人数 | 次留率");
  let C = 0, RG = 0, CR = 0, RT = 0;
  const sorted = rows.sort((a, b) => String(a[DIM]).localeCompare(String(b[DIM])));
  const jsonRows = [];
  for (const x of sorted) {
    const c = N(x.cost) / 100, reg = N(x.mini_game_register_users), cr = N(x.mini_game_create_role_users), rt = N(x.mini_game_retention_d1);
    C += c; RG += reg; CR += cr; RT += rt;
    jsonRows.push({
      key: String(x[DIM]), cost: c, reg, cr,
      crRate: reg > 0 ? cr / reg : null,
      rt, retRate: cr > 0 ? rt / cr : null,
      crCost: cr > 0 ? c / cr : null,
    });
    L(`${x[DIM]} | ${c.toFixed(2).padStart(9)} | ${String(reg).padStart(5)} | ${String(cr).padStart(5)} | ${(reg ? (cr / reg * 100).toFixed(1) : "-").padStart(7)}% | ${String(rt).padStart(5)} | ${(cr ? (rt / cr * 100).toFixed(1) : "-").padStart(7)}%`);
  }
  L(`\n合计 | 消耗 ${C.toFixed(2)} | 注册 ${RG} | 创角 ${CR} | 创角率 ${(CR / (RG || 1) * 100).toFixed(1)}% | 次留 ${RT} | 次留率 ${(RT / (CR || 1) * 100).toFixed(2)}%`);
  L(`创角成本 ${(C / (CR || 1)).toFixed(2)} 元/个｜次留成本 ${(C / (RT || 1)).toFixed(2)} 元/个`);

  // 素材维度：按次留率排序（样本 ≥20 创角）
  const ranked = DIM === "dynamic_creative_id"
    ? jsonRows.filter(x => x.cr >= 20).slice().sort((a, b) => (b.retRate ?? 0) - (a.retRate ?? 0))
    : [];
  if (DIM === "dynamic_creative_id") {
    L("\n【按次留率排序（样本 ≥20 创角才纳入）】");
    ranked.forEach((x, i) => L(`${String(i + 1).padStart(2)}. ${x.key} | 创角 ${x.cr} | 次留 ${x.rt} | **${(x.retRate * 100).toFixed(1)}%** | 创角成本 ${x.crCost.toFixed(2)} 元`));
  }
  PAYLOAD = {
    kind: "retention", dim: DIM, start: S, end: E,
    rows: jsonRows, ranked,
    total: {
      cost: C, reg: RG, cr: CR, rt: RT,
      crRate: RG > 0 ? CR / RG : null,
      crCost: CR > 0 ? C / CR : null,
      rtCost: RT > 0 ? C / RT : null,
      retRate: CR > 0 ? RT / CR : null,
    },
    tailIsToday: false,
  };
}
fs.writeFileSync(_j(TMP, `creative_retention_${DIM}_${S}_${E}.txt`), out.join("\n"));

if (JSON_OUT) OUT(JSON.stringify({ generatedAt: new Date().toISOString(), ...PAYLOAD }));
