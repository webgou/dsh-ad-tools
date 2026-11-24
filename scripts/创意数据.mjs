// 创意数据.mjs
// 计划 × 创意 维度的投放数据（含曝光/点击/CTR/注册/创角/创角成本/次留）
// 用法: node tools/ad-tools/创意数据.mjs [起始日 YYYY-MM-DD] [结束日 YYYY-MM-DD]
//   例：node tools/ad-tools/创意数据.mjs 2026-09-12 2026-09-18
//   （脚本自愈路径，任意 cwd 均可运行；凭证在 仓库根/tmp/）
//
// 🔴 口径（详见 skill tencent-adreport-mcp / griffin-game-backend-verify）
//   - 一次 requests 同时按 ["adgroup_id","dynamic_creative_id"] 分组 → 报表**自带**
//     `adgroup_name` 与 `dynamic_creative_name`，不必另调 dynamic_creatives/get。
//   - 创角率 = 创角 ÷ 注册；CTR = 有效点击 ÷ 曝光
//   - ⚠️ 报表里同一素材可能挂在多个计划下 → 本表按「计划」分行，不跨计划合并
//
// 🔴🔴 次留率有【两个分母】，差约 3.3 倍，**两个都出、都标清楚**（09-23 实测钉死）：
//     · retRateReg = 次留人数 ÷ 注册   ← **广告后台显示的那个数**（个位数）
//       平台自带 `mini_game_retention_d1_rate` 就是这个口径（逐日偏差 ≤0.2%）
//     · retRate    = 次留人数 ÷ 创角   ← **权威口径**（retention_d1 本来报的就是「创角人数」的次日留存）
//     ⚠️ 分母不同 ≠ 谁错：广告后台（÷注册）与游戏后台（÷游戏侧注册＝平台创角）
//        根本不是一个指标，混着比就会得出「差 3 倍」的假矛盾。
//     📌 区间汇总口径 = SUM(次留) ÷ SUM(分母)。
//     🔴 但【放量期】首尾差**不可忽略**：次留人数对应的是【前一日】队列，
//        所以「对齐口径」的分母要取 [S-1, E-1] 的创角，而不是同窗口的 [S, E]。
//        09-12~09-20 实测：同窗口 146÷732 = 19.95%，对齐 146÷561 = 26.02% —— 差 6 个点。
//        → 本脚本**两个都给**：retRate（对齐，权威、与「注册留存」面板总口径一致）
//                               retRateWin（同窗口，与 ÷注册 同构）
//        主排序与建议判定用【对齐】；同窗口值只在分组行 / 合计行旁注里出现。
//     📌 再给一个合成指标 **rtCost = 消耗 ÷ 次留人数**（「买到一个次留用户要花多少钱」）——
//        它同时含了创角率与留存率，是这里最直接的「值不值」数。
//     ⚠️ 为算对齐口径，报表要多取一天（从 S-1 起）；消耗/曝光/点击/注册仍只统计 [S, E]。
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
const CRED = JSON.parse(fs.readFileSync(_j(TMP, "tencentads_credentials.json"), "utf8").replace(/^\uFEFF/, ""));
/* 广告账户：只认环境变量 MKT_ACCOUNT_ID（插件/命令行都会传）；不再内置默认账户 */
const ACC = /^\d{5,12}$/.test(String(process.env.MKT_ACCOUNT_ID || "").trim())
  ? String(process.env.MKT_ACCOUNT_ID).trim() : "";
if (!ACC) { console.error("未指定广告账户：请设置 MKT_ACCOUNT_ID"); process.exit(1); }

// ── --json：给网页端用的结构化输出（stdout 出 JSON，文本全部静音）──
//    ⚠️ 必须先把 --json 剔掉再取位置参数，否则它会顶掉「起始日」。
const JSON_OUT = process.argv.includes("--json");
let OUT = console.log.bind(console);
if (JSON_OUT) {
  OUT = (s) => { try { fs.writeSync(1, s + "\n"); } catch { } };
  console.log = () => { };
}

// ── 崩溃兜底：顶层 await 的抛错走 uncaughtException（不是 unhandledRejection）──
const die = (e) => {
  const msg = String((e && e.message) || e);
  console.error((e && e.stack) || msg);
  if (JSON_OUT) OUT(JSON.stringify({ kind: "creatives", start: S0, end: E0, error: msg }));
  else console.log("❌ " + msg);
  process.exit(1);
};
process.on("uncaughtException", die);
process.on("unhandledRejection", die);

const ARGS = process.argv.slice(2).filter(a => a !== "--json");
const dft = (n) => new Date(Date.now() + 8 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);
const S0 = ARGS[0] || dft(-7);
const E0 = ARGS[1] || dft(-1);

const shift = (d, n) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);
const todayCST = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());

const qs = (e = {}) => new URLSearchParams({
  access_token: CRED.access_token, timestamp: String(Math.floor(Date.now() / 1000)),
  nonce: Math.random().toString(36).slice(2, 12), ...e,
}).toString();

const METRICS = ["cost", "view_count", "valid_click_count",
  "mini_game_register_users", "mini_game_create_role_users", "mini_game_retention_d1"];

// ── 一次拿「计划 × 创意」全量（带两者的名字）──
//    ⚠️ 从 S-1 起取：对齐口径（次留÷前一日创角）需要窗口前一天做分母
const S1 = shift(S0, -1);
const E1 = shift(E0, -1);          // 对齐窗口的末日
const r = await fetch(`https://api.e.qq.com/v3.0/daily_reports/get?${qs({
  account_id: ACC, level: "REPORT_LEVEL_DYNAMIC_CREATIVE",
  date_range: JSON.stringify({ start_date: S1, end_date: E0 }),
  group_by: JSON.stringify(["adgroup_id", "dynamic_creative_id", "date"]),
  fields: JSON.stringify(["adgroup_id", "adgroup_name", "dynamic_creative_id", "dynamic_creative_name", "date", ...METRICS]),
  page: "1", page_size: "500",
})}`).then(x => x.json());

if (r.code !== 0) die(new Error(`报表查询失败: ${r.code} ${r.message_cn || r.message}`));

const N = (x) => Number(x) || 0;
const allRows = r.data?.list || [];

// ── 聚合：先按创意，再归到计划 ──
//    ⚠️ 两个关键细节，都踩过：
//      ① 对齐分母 crAli 取 [S-1, E-1] 的**全部**行（含消耗 0 的行）—— 报表里「消耗 0 但有创角」
//         是常态（历史归因/已删单元），它们的创角确实进了队列；漏掉分母会偏小、次留率偏高。
//      ② 🔴 **消耗过滤必须放在「按创意聚合之后」，不能逐行过滤**。因为本次按天分组（group_by 带 date），
//         一个整窗有消耗的创意，某些天消耗恰好为 0 却有创角/次留 —— 逐行卡 `cost>0` 会把这些行整片吃掉。
//         实测：逐行过滤 → 创角 726 / 次留 141（少了 6 / 5）；聚合后过滤 → 728 / 146，与 2 维分组一致。
const crAliMap = new Map();   // `${uid}\u0000${cid}` → 对齐分母
const winIdx = new Map();     // 同上 → 窗口量累加器
for (const x of allRows) {
  const d = String(x.date).slice(0, 10);
  const k = `${x.adgroup_id}\u0000${x.dynamic_creative_id}`;
  if (d >= S1 && d <= E1) crAliMap.set(k, (crAliMap.get(k) || 0) + N(x.mini_game_create_role_users));
  if (d < S0 || d > E0) continue;
  if (!winIdx.has(k)) winIdx.set(k, {
    id: String(x.dynamic_creative_id), name: x.dynamic_creative_name || `（无名 · ${x.dynamic_creative_id}）`,
    uid: String(x.adgroup_id), uname: x.adgroup_name || `（已删 · ${x.adgroup_id}）`,
    cost: 0, imp: 0, clk: 0, reg: 0, cr: 0, rt: 0,
  });
  const c = winIdx.get(k);
  c.cost += N(x.cost) / 100; c.imp += N(x.view_count); c.clk += N(x.valid_click_count);
  c.reg += N(x.mini_game_register_users); c.cr += N(x.mini_game_create_role_users);
  c.rt += N(x.mini_game_retention_d1);
}

// 真正要展示的：整窗有消耗的创意（过滤放在聚合之后）
const units = new Map();
for (const c of winIdx.values()) {
  if (c.cost <= 0) continue;
  if (!units.has(c.uid)) units.set(c.uid, { id: c.uid, name: c.uname, creatives: new Map() });
  c.crAli = crAliMap.get(`${c.uid}\u0000${c.id}`) || 0;
  units.get(c.uid).creatives.set(c.id, c);
}

const fin = (c) => ({
  ...c,
  ctr: c.imp > 0 ? c.clk / c.imp : null,
  crRate: c.reg > 0 ? c.cr / c.reg : null,
  crCost: c.cr > 0 ? c.cost / c.cr : null,
  retRateReg: c.reg > 0 ? c.rt / c.reg : null,        // 广告后台口径（÷注册，同窗口）
  retRate: c.crAli > 0 ? c.rt / c.crAli : null,       // ★ 权威：÷前一日创角（对齐）
  retRateWin: c.cr > 0 ? c.rt / c.cr : null,          // 对照：÷同窗口创角
  rtCost: c.rt > 0 ? c.cost / c.rt : null,            // 次留成本
});

const roll = (list) => {
  const t = list.reduce((a, c) => ({
    cost: a.cost + c.cost, imp: a.imp + c.imp, clk: a.clk + c.clk,
    reg: a.reg + c.reg, cr: a.cr + c.cr, rt: a.rt + c.rt, crAli: a.crAli + c.crAli,
  }), { cost: 0, imp: 0, clk: 0, reg: 0, cr: 0, rt: 0, crAli: 0 });
  return fin(t);
};

const unitList = [...units.values()].map(u => {
  const cs = [...u.creatives.values()].map(fin).sort((a, b) => b.cost - a.cost);
  return { ...u, creatives: cs, ...roll(cs), n: cs.length };
}).sort((a, b) => b.cost - a.cost);

// 同一批对象引用（不复制）—— 判定结果要能被计划分组一起带出去
const allCreatives = [];
for (const u of unitList) for (const c of u.creatives) { c.unit = u.name; c.unitId = u.id; allCreatives.push(c); }
const total = roll(allCreatives);

// ── 「继续 / 观察 / 暂停」建议 ──
// 🔴 创意级**没有独立的充值归因**（钱只归到单元），所以不能算 LTV÷CAC。
//    退而用两把可比的尺子，都跟【账户均值】比（绝对保本线 0.23 元/创角在创意级必然达不到，比了全是暂停）：
//      主尺 = 创角成本比：≤1× 继续｜1~2× 观察｜>2× 暂停
//      修正尺 = 次留率比：<0.6× 降一档（便宜但留不住＝买了不来的人）；≥1.5× 升一档（贵但质量好，别误杀）
//    🔑 修正尺用【÷创角】的 retRate，**不用** ÷注册 的 retRateReg —— 这是刻意的：
//       主尺（创角成本）已经把「创角率低」的成本后果算进去了，修正尺只该回答「留下来的人占创角多少」。
//       若修正尺改用 ÷注册，等于把创角率再算一遍（重复计），会把「注册多但创角少」的创意误判成高质量。
//       两个率都显示在表里，让人自己看得见；判定只锚一个，避免双重标准。
//    ⚠️ 次留修正必须设样本门槛，否则 5 个创角里 1 个留存就能把比率掀翻。
//    ⚠️ 「样本够不够」不能只看创角数：花 125 元只换 3 个创角，这本身就是最强的暂停信号 ——
//       所以**消耗花够了也算样本够**（MIN_COST），并存单独一档「花了钱、0 创角」。
const MIN_CR = 5;        // 创角数门槛
const MIN_COST = 20;     // 消耗门槛（元）：钱花到这个数还没结论，就不再算「样本不足」
const RET_MIN_CR = 20;   // 次留修正的样本门槛
const LVL = ['✅ 继续', '⚠️ 观察', '⛔ 暂停'];
const TONE = ['ok', 'warn', 'bad'];
for (const c of allCreatives) {
  const byCr = c.cr >= MIN_CR, byCost = c.cost >= MIN_COST;
  if (!byCr && !byCost) {
    c.verdict = '— 样本不足'; c.verdictTone = 'info'; c.crCostRatio = null;
    c.why = `创角 ${c.cr}、消耗 ¥${c.cost.toFixed(2)}，两者都太少（门槛 创角≥${MIN_CR} 或 消耗≥¥${MIN_COST}），先别据此动它`;
    continue;
  }
  if (c.cr === 0) {   // 花了钱一个都没转化 —— 没有比这更明确的信号
    c.verdict = '⛔ 暂停'; c.verdictTone = 'bad'; c.crCostRatio = null;
    c.why = `花 ¥${c.cost.toFixed(2)}、注册 ${c.reg}、创角 0 —— 零转化`;
    continue;
  }
  const ratio = total.crCost > 0 ? c.crCost / total.crCost : 1;
  let lvl = ratio <= 1 ? 0 : ratio <= 2 ? 1 : 2;
  const why = [`创角成本 ¥${c.crCost.toFixed(2)} = 账户均值 ${ratio.toFixed(1)}×`];
  if (!byCr) why.push(`（创角仅 ${c.cr}，但已花 ¥${c.cost.toFixed(2)}）`);
  const rr = (c.cr >= RET_MIN_CR && c.retRate != null && total.retRate > 0) ? c.retRate / total.retRate : null;
  if (rr != null && rr < 0.6 && lvl < 2) { lvl++; why.push(`次留率 ${(c.retRate * 100).toFixed(1)}% 仅账户 ${rr.toFixed(1)}× → 降一档`); }
  else if (rr != null && rr >= 1.5 && lvl > 0) { lvl--; why.push(`次留率 ${(c.retRate * 100).toFixed(1)}% = 账户 ${rr.toFixed(1)}× → 升一档`); }
  c.verdict = LVL[lvl]; c.verdictTone = TONE[lvl]; c.crCostRatio = ratio; c.why = why.join('；');
}
const suggest = {
  pause: allCreatives.filter(c => c.verdictTone === 'bad'),
  watch: allCreatives.filter(c => c.verdictTone === 'warn'),
  keep: allCreatives.filter(c => c.verdictTone === 'ok'),
  thin: allCreatives.filter(c => c.verdictTone === 'info'),
};

// ── 文本输出 ──
const out = [];
const L = (s = "") => { out.push(s); console.log(s); };
const dw = (s) => [...String(s)].reduce((a, c) => a + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(c) ? 2 : 1), 0);
const padE = (s, w) => s + " ".repeat(Math.max(0, w - dw(s)));
const padS = (s, w) => " ".repeat(Math.max(0, w - dw(s))) + s;
const m2 = (v) => v == null ? "—" : v.toFixed(2);
const pc = (v, d = 1) => v == null ? "—" : (v * 100).toFixed(d) + "%";

L(`\n📊 创意数据 · ${S0} ~ ${E0}`);
L(`口径：创角率 = 创角÷注册｜创角成本 = 消耗÷创角｜CTR = 有效点击÷曝光｜次留成本 = 消耗÷次留人数`);
L(`🔴 次留率【两个分母都出，别混】（差 ${(total.reg / (total.crAli || 1)).toFixed(2)} 倍 ＝ 注册÷对齐创角）：`);
L(`     · 次留率÷注册 = 次留人数÷注册（同窗口）  ← **广告后台显示的那列**（个位数）`);
L(`     · 次留率÷创角 = 次留人数÷创角（**对齐**：分母取 [${S1}, ${E1}]）  ← **权威口径**`);
L(`        ⚠️ 为什么不是同窗口：次留人数属于【前一日】的创角队列，放量期首尾差很大 ——`);
L(`           同窗口 = ${total.rt}÷${total.cr} = ${pc(total.retRateWin, 2)}，对齐 = ${total.rt}÷${total.crAli} = ${pc(total.retRate, 2)}`
  + `（本次差 ${total.retRateWin > 0 ? (((total.retRate / total.retRateWin) - 1) * 100).toFixed(0) : "—"}%）`);
L(`建议：以【账户均值】为基准 —— 创角成本 ≤1× 继续｜1~2× 观察｜>2× 暂停；次留率 修正用【对齐的 ÷创角】<0.6× 降一档、≥1.5× 升一档（需 ≥${RET_MIN_CR} 创角）`);
L(`      （修正尺只锚 ÷创角：主尺已含创角率的成本后果，修正在再算一遍 ÷注册 会重复计）`);
L(`      样本门槛：创角 ≥${MIN_CR} **或** 消耗 ≥¥${MIN_COST}（钱花够了也算样本够）；创角 0 直接判暂停`);

const RULE = "─".repeat(133);
L(RULE);

if (!unitList.length) L("窗口内没有创意消耗。");

for (const u of unitList) {
  L(`\n【${u.name}】 消耗 ${m2(u.cost)}｜注册 ${u.reg}｜创角 ${u.cr}（率 ${pc(u.crRate)}）｜创角成本 ${m2(u.crCost)}｜`
    + `次留 ${u.rt} 人｜次留率 ÷注册 ${pc(u.retRateReg, 2)}（分母 ${u.reg}）/ ÷创角 ${pc(u.retRate)}（对齐，分母 ${u.crAli}）`
    + `｜次留成本 ${m2(u.rtCost)}`);
  const W = Math.max(18, ...u.creatives.map(c => dw(c.name)));
  L("  " + padE("创意名", W) + "  " + padS("消耗", 9) + padS("曝光", 7) + padS("点击", 6)
    + padS("CTR", 7) + padS("注册", 6) + padS("创角", 6) + padS("创角率", 8) + padS("创角成本", 10)
    + padS("次留", 6) + padS("次留率÷注册", 12) + padS("次留率÷创角", 12) + padS("次留成本", 10) + "  " + padE("建议", 12));
  for (const c of u.creatives) {
    L("  " + padE(c.name, W) + "  " + padS(c.cost.toFixed(2), 9) + padS(String(c.imp), 7) + padS(String(c.clk), 6)
      + padS(pc(c.ctr), 7) + padS(String(c.reg), 6) + padS(String(c.cr), 6) + padS(pc(c.crRate), 8)
      + padS(m2(c.crCost), 10) + padS(String(c.rt), 6) + padS(pc(c.retRateReg, 2), 12) + padS(pc(c.retRate), 12)
      + padS(m2(c.rtCost), 10) + "  " + padE(c.verdict, 12));
  }
}

L("\n" + RULE);
L(`账户合计  消耗 ${m2(total.cost)}｜曝光 ${total.imp}｜点击 ${total.clk}｜CTR ${pc(total.ctr)}`
  + `｜注册 ${total.reg}｜创角 ${total.cr}｜创角率 ${pc(total.crRate)}｜创角成本 ${m2(total.crCost)}`);
L(`          次留 ${total.rt} 人｜次留率 ÷注册 ${pc(total.retRateReg, 2)}（分母 ${total.reg}）`
  + ` / ÷创角 ${pc(total.retRate, 2)}（对齐，分母 ${total.crAli}） / ${pc(total.retRateWin, 2)}（同窗口，分母 ${total.cr}）`
  + `｜次留成本 ${m2(total.rtCost)}`);
L(`          ℹ️ 两个分母差 ${(total.reg / (total.crAli || 1)).toFixed(2)} 倍（注册÷对齐创角）→ 两个率也差这个倍数；分母不同 ≠ 谁错。`);
L(`          ℹ️ 「对齐 ÷同窗口」差 ${total.retRateWin > 0 ? (((total.retRate / total.retRateWin) - 1) * 100).toFixed(0) : "—"}%`
  + ` —— 放量期必须看对齐（次留属于前一日队列）；平稳期两者接近。`);
L(`${unitList.length} 个计划 / ${allCreatives.length} 条创意在窗口内有消耗。`);

// ── 操作建议汇总（要动手的那几条单独列出来，别让人自己在表里找）──
const sumCost = (l) => m2(l.reduce((a, c) => a + c.cost, 0));
L(`\n【操作建议】  ⛔ 暂停 ${suggest.pause.length} 条（${sumCost(suggest.pause)} 元）`
  + `｜⚠️ 观察 ${suggest.watch.length} 条（${sumCost(suggest.watch)} 元）`
  + `｜✅ 继续 ${suggest.keep.length} 条（${sumCost(suggest.keep)} 元）`
  + `｜— 样本不足 ${suggest.thin.length} 条`);
if (suggest.pause.length) {
  L(`\n  ⛔ 建议暂停（创角成本 > 账户均值 2×）：`);
  for (const c of suggest.pause.sort((a, b) => b.cost - a.cost))
    L(`     · ${padE(c.name, 26)} 消耗 ${padS(m2(c.cost), 8)}｜注册 ${padS(String(c.reg), 5)}｜创角 ${padS(String(c.cr), 4)}｜`
      + `${padS(m2(c.crCost), 7)} 元/创角（${padS(c.crCostRatio == null ? "—" : c.crCostRatio.toFixed(1), 4)}×）｜次留率 ${padS(pc(c.retRateReg, 2), 7)}/${padS(pc(c.retRate), 7)}  ─ ${c.unit}`);
  L(`       （次留率写作「÷注册 / ÷创角」；前者＝广告后台显示的数）`);
} else L(`\n  ⛔ 没有需要暂停的创意。`);
if (suggest.keep.length) {
  L(`\n  ✅ 建议继续（创角成本 ≤ 账户均值）：`);
  for (const c of suggest.keep.sort((a, b) => a.crCost - b.crCost))
    L(`     · ${padE(c.name, 26)} 消耗 ${padS(m2(c.cost), 8)}｜注册 ${padS(String(c.reg), 5)}｜创角 ${padS(String(c.cr), 4)}｜`
      + `${padS(m2(c.crCost), 7)} 元/创角（${padS(c.crCostRatio == null ? "—" : c.crCostRatio.toFixed(1), 4)}×）｜次留率 ${padS(pc(c.retRateReg, 2), 7)}/${padS(pc(c.retRate), 7)}  ─ ${c.unit}`);
}
L(`\n  ⚠️ 提醒：创意级没有独立充值归因（钱只归到单元），所以这里比的是【账户均值】而非绝对保本线；`);
L(`     要判断整个计划值不值得投，仍应看「单元LTV判定」的 LTV÷CAC。`);

// 择优榜：样本门槛复用上面判定的门槛，避免同一份文件里出现两个「5」
const rankCost = allCreatives.filter(c => c.cr >= MIN_CR).sort((a, b) => a.crCost - b.crCost);
const rankRet = allCreatives.filter(c => c.cr >= MIN_CR).sort((a, b) => (b.retRate ?? 0) - (a.retRate ?? 0));
// 次留成本榜：样本门槛看【次留人数】而不是创角数 —— 只有 1 个次留时，成本会被这一个人撬动
const rankRtCost = allCreatives.filter(c => c.rt >= 3).sort((a, b) => (a.rtCost ?? Infinity) - (b.rtCost ?? Infinity));
if (rankCost.length) {
  L(`\n【创角成本最优（样本 ≥${MIN_CR} 创角）】`);
  rankCost.slice(0, 8).forEach((c, i) => L(`  ${String(i + 1).padStart(2)}. ${m2(c.crCost).padStart(7)} 元/创角 | 创角 ${String(c.cr).padStart(4)} | 次留 ${pc(c.retRateReg, 2)}/${pc(c.retRate)} | ${c.verdict} | ${c.name}`));
  L(`【创角成本最差（样本 ≥${MIN_CR} 创角）】`);
  rankCost.slice(-5).reverse().forEach((c, i) => L(`  ${String(i + 1).padStart(2)}. ${m2(c.crCost).padStart(7)} 元/创角 | 创角 ${String(c.cr).padStart(4)} | 次留 ${pc(c.retRateReg, 2)}/${pc(c.retRate)} | ${c.verdict} | ${c.name}`));
}
if (rankRet.length) {
  L(`\n【次留率最优（样本 ≥${MIN_CR} 创角）｜依次留率÷创角排序（权威口径）】`);
  rankRet.slice(0, 8).forEach((c, i) => L(`  ${String(i + 1).padStart(2)}. ÷创角 ${pc(c.retRate).padStart(6)} | ÷注册 ${pc(c.retRateReg, 2).padStart(6)} | 创角 ${String(c.cr).padStart(4)} | ${m2(c.crCost)} 元/创角 | 次留成本 ${m2(c.rtCost)} | ${c.name}`));
}
if (rankRtCost.length) {
  L(`\n【次留成本最低（样本 ≥3 次留人数）｜「买到一个次留用户多少钱」，越低越值】`);
  rankRtCost.slice(0, 8).forEach((c, i) => L(`  ${String(i + 1).padStart(2)}. ${m2(c.rtCost).padStart(7)} 元/次留 | 次留 ${String(c.rt).padStart(3)} 人 | 消耗 ${m2(c.cost).padStart(8)} | 创角 ${String(c.cr).padStart(4)} | 次留率 ÷注册 ${pc(c.retRateReg, 2)}/÷创角 ${pc(c.retRate)} | ${c.name}`));
}

const tailIsToday = E0 >= todayCST();
if (tailIsToday) L(`\n⚠️ 窗口末尾 ${E0} 是今天 → 末段数据未跑完（次留按次日累积），做结论请用【不含今天】的窗口。`);

fs.writeFileSync(_j(TMP, `adgroup_creatives_${S0}_${E0}.txt`), out.join("\n"));

const brief = (c) => ({
  id: c.id, name: c.name, unit: c.unit, unitId: c.unitId, cost: c.cost,
  reg: c.reg, cr: c.cr, crAli: c.crAli, rt: c.rt,
  crCost: c.crCost, crCostRatio: c.crCostRatio ?? null,
  retRateReg: c.retRateReg,   // 广告后台口径（÷注册，同窗口）
  retRate: c.retRate,         // ★ 权威口径（÷前一日创角，对齐）
  retRateWin: c.retRateWin,   // 对照（÷同窗口创角）
  rtCost: c.rtCost,           // 次留成本
  verdict: c.verdict, verdictTone: c.verdictTone, why: c.why,
});

if (JSON_OUT) OUT(JSON.stringify({
  kind: "creatives", start: S0, end: E0, alignedStart: S1, alignedEnd: E1,
  units: unitList,
  total,
  denomRatio: total.reg / (total.crAli || 1),   // 注册÷对齐创角：解释两个次留率为何差这么多
  caliber: "retRate=÷前一日创角（对齐，权威）；retRateWin=÷同窗口创角（对照）；retRateReg=÷注册（广告后台口径）",
  tailIsToday,
  thresholds: { minCr: MIN_CR, minCost: MIN_COST, retMinCr: RET_MIN_CR, rtRankMin: 3 },
  suggest: {
    pause: suggest.pause.map(brief), watch: suggest.watch.map(brief),
    keep: suggest.keep.map(brief), thin: suggest.thin.map(brief),
  },
  ranked: {
    byCrCost: rankCost.map(brief), byRetRate: rankRet.map(brief), byRtCost: rankRtCost.map(brief),
    minSample: MIN_CR, rtMinSample: 3,
  },
}));
