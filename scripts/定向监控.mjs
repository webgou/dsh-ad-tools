#!/usr/bin/env node
/**
 * 定向监控.mjs — 腾讯广告定向配置监控（只读；账户由 MKT_ACCOUNT_ID 指定）
 *
 * 为什么要有它：账户硬规则是「男 25-45 不放宽」，但定向是靠人手工设的，
 * 出错/遗漏不会自己报错 —— 实测 `135174569215`（0912_小程序_激励_注册次留）
 * 的 `targeting` 里**没有 gender 字段**（= 男女不限），09-16 查出、09-20 仍未补。
 * 这个脚本把「定向长什么样」变成每次都能一条命令看全的东西。
 *
 * 做什么：
 *   1) 【配置层】拉在投单元的 targeting / site_set / scene_spec / smart_targeting_mode
 *      → 逐维度显示**实际值**，并标出与期望值的差异
 *   2) 【实际层】拉 `targeting_tag_reports/get` 的**性别 / 年龄 / 省份**分布
 *      → 系统**实际把钱投给了谁**（T+1，窗口默认最近 7 天且截至昨天）
 *   3) 与上一次配置快照对比 → 任何维度被改动都报出来（配置变更侦测）
 *
 * ⚠️ 它**只报值、不做合规判决**：年龄维度尤其如此 ——
 *   硬规则写的是 25-45，而账户六个单元实测全是 `23-45`（差 23-24 两岁），
 *   这个口径本身还没定论，所以脚本只把「实际 23-45 / 期望 25-45」并排摆出来，
 *   判定留给人。**不要把这个脚本的输出直接当成「违规清单」用。**
 *
 * 用法：
 *   node tools/ad-tools/定向监控.mjs                      # 配置 + 画像（近 7 天）
 *   node tools/ad-tools/定向监控.mjs 2026-09-13 2026-09-19  # 指定画像窗口
 *   node tools/ad-tools/定向监控.mjs --json                # 给网页看板用
 *   TARGETING_ALL=1 node tools/ad-tools/定向监控.mjs       # 连暂停单元一起看配置
 *
 * 环境变量：
 *   TARGETING_ALL=1         配置层含暂停/非在投单元（默认只看在投）
 *   TARGETING_NO_SNAPSHOT=1 不读写快照（只看当下，不做变更侦测）
 *   TARGETING_NO_AUDIENCE=1 不拉实际人群画像（只做配置审计）
 *
 * 留痕（仓库根 tmp/）：
 *   tmp/targeting_snapshots/<日期>.json   每日一份配置快照，用于跨天变更侦测
 *   tmp/targeting_monitor.txt              最近一次的可读输出
 *
 * 凭证读取优先级（与 盯盘.mjs 同）：
 *   1) 环境变量 MKT_ACCESS_TOKEN
 *   2) 仓库根 tmp/tencentads_credentials.json 的 access_token
 *   3) ~/.workbuddy/mcp.json 里任一 mcpServers 的 headers.access_token
 *   4) 本脚本同目录的 token.txt
 *
 * ══ 🔴 口径纠错（2026-09-20）══
 * 曾记「平台侧没有用户画像报表」—— **那是误用接口**：`daily_reports/get` 按
 * age/gender/city 聚合确实全报 `1801177 unsupport field`，但专用通道是
 * **`targeting_tag_reports/get`**（type=GENDER/AGE/REGION/CITY/OS，时效 T+1）。
 * 它才是「投来的人是谁、值多少钱」的唯一来源。详见 doc/速查/…速查_20260912.md §10。
 * ⚠️ 三条口径约束：① `group_by` 里的维度 id 必须同时出现在 `fields` 里；
 *    ② 区域**不能**放进 `filtering`，只能作 `group_by`；③ 算分人群成本必须**同目标 + 同窗口**，
 *    混入不同优化目标的单元（尤其已暂停的老组）能把省级成本抬高 4~16 倍。
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/* ── --json：给网页端用的结构化输出（stdout 出 JSON，文本全部静音）── */
const JSON_OUT = process.argv.includes("--json");
let OUT = console.log.bind(console);
if (JSON_OUT) {
  OUT = (s) => { try { writeSync(1, s + "\n"); } catch { } };
  console.log = () => { };
}

/* 广告账户：只认环境变量 MKT_ACCOUNT_ID（插件/命令行都会传）；不再内置默认账户 */
const ACCOUNT = /^\d{5,12}$/.test(String(process.env.MKT_ACCOUNT_ID || "").trim())
  ? String(process.env.MKT_ACCOUNT_ID).trim() : "";
if (!ACCOUNT) { console.error("未指定广告账户：请设置 MKT_ACCOUNT_ID"); process.exit(1); }
const __dirname = dirname(fileURLToPath(import.meta.url));

/* ── 仓库根自动定位（与四个脚本同一套规则）── */
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
const SNAP_DIR = join(TMP, "targeting_snapshots");
const ONLY_ACTIVE = process.env.TARGETING_ALL !== "1";
const NO_SNAPSHOT = process.env.TARGETING_NO_SNAPSHOT === "1";
const NO_AUDIENCE = process.env.TARGETING_NO_AUDIENCE === "1";

/* ── 终端列宽：CJK/全角算 2 列（中文全称会把表头挤歪）── */
const dw = (s) => [...String(s)].reduce((a, c) =>
  a + (/[\u1100-\u115F\u2E80-\uA4CF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(c) ? 2 : 1), 0);
const padE = (s, w) => String(s) + " ".repeat(Math.max(0, w - dw(s)));

/* ── 期望值（硬规则的机器可读版；只用于「标出差异」，不做合规判定）── */
const EXPECT = {
  gender: ["MALE"],
  age: [{ min: 25, max: 45 }],
};
const RULE_NOTE = {
  gender: "硬规则：男（MALE）",
  age: "硬规则：25-45（实测全账户为 23-45，口径待定）",
};

/* ════════ 实际人群画像（targeting_tag_reports/get）════════
   ⚠️ 口径纠错：曾记「平台侧无画像报表」——那是**误用 daily_reports/get**
   （按 age/gender/city 聚合报 `1801177 unsupport field`）。专用接口是这个：
   `targeting_tag_reports/get`，type=GENDER/AGE/REGION/CITY/OS，时效 **T+1**。
   它才是「投来的人是谁」的唯一通道。详见 doc/速查/…速查_20260912.md §10。 */

/* 省级 ID → 名称。省级 ID 与国标行政区划码一致（速查已核）；
   市级是腾讯自有编码，必须用 targeting_tags/get 取，不能猜（本工具只到省级）。 */
const PROV = {
  110000: "北京", 120000: "天津", 130000: "河北", 140000: "山西", 150000: "内蒙古",
  210000: "辽宁", 220000: "吉林", 230000: "黑龙江",
  310000: "上海", 320000: "江苏", 330000: "浙江", 340000: "安徽", 350000: "福建",
  360000: "江西", 370000: "山东",
  410000: "河南", 420000: "湖北", 430000: "湖南", 440000: "广东", 450000: "广西", 460000: "海南",
  500000: "重庆", 510000: "四川", 520000: "贵州", 530000: "云南", 540000: "西藏",
  610000: "陕西", 620000: "甘肃", 630000: "青海", 640000: "宁夏", 650000: "新疆",
  710000: "台湾省", 810000: "香港特别行政区", 820000: "澳门特别行政区",
  156: "中国未知", 1156: "中国", 9000: "国外", 0: "未知",
};
const GENDER_NAME = { 0: "未知", 1: "男", 2: "女" };
/* age_id 官方没有 id→名称 的对照表，这里的区间是**实测反推**的（判据见速查 §10）：
   age_id 恰好是各桶的上界 —— 18=≤18｜24=19-24｜29=25-29｜39=30-39｜49=40-49｜50=50+。
   这六个桶是平台固定分段，不按定向区间切（定向上限 45，报表照样整桶给 40-49）。 */
const AGE_BUCKET = { 18: "≤18", 24: "19-24", 29: "25-29", 39: "30-39", 49: "40-49", 50: "50+" };

/* 画像窗口：T+1 → 默认最近 7 天且截至昨天（日期用一个纯函数，实际默认值在 TODAY 定义之后再算） */
const SHIFT = (d, n) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);

/* ── 快照按北京时间日期命名 ── */
const bjDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(d);
const TODAY = bjDate();
/* 画像默认窗口：最近 7 天、截至昨天（定向标签报表是 T+1，今天的数据不完整） */
const DEF_END = SHIFT(TODAY, -1), DEF_START = SHIFT(DEF_END, -6);

/* ── 凭证（四级，与 盯盘.mjs 一致）── */
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

/* ════════ 维度格式化：把接口的原始枚举翻译成人能读的，并标出与期望的差异 ════════ */

const AGE_LABEL = (a) => {
  if (!Array.isArray(a) || !a.length) return null;
  return a.map(x => `${x.min}-${x.max}`).join(" / ");
};
// 地域：regions 里 156=中国，其余是省级国标码
const GEO_LABEL = (g) => {
  if (!g || (!g.regions?.length && !g.location_types?.length)) return null;
  const n = (g.regions || []).filter(r => r !== 156).length;
  const scope = n >= 30 ? `全国(${n}省级)` : `${n}个省级`;
  const lt = (g.location_types || []).map(x => ({ LIVE_IN: "常住", LIVE_AND_RECENTLY: "常住+最近", TRAVEL_IN: "去过", TRAVEL_AND_RECENTLY: "去过+最近" }[x] || x)).join("/");
  return lt ? `${scope}·${lt}` : scope;
};
const NET_LABEL = (n) => {
  if (!Array.isArray(n) || !n.length) return null;
  return n.map(x => ({ WIFI: "WiFi", NET_5G: "5G", NET_4G: "4G", NET_3G: "3G", NET_2G: "2G" }[x] || x)).join("/");
};
const OS_LABEL = (o) => {
  if (!Array.isArray(o) || !o.length) return null;
  const ios = o.filter(x => String(x).startsWith("IOS_VERSION_")).length;
  const and = o.filter(x => String(x).startsWith("ANDROID_VERSION_")).length;
  const other = o.length - ios - and;
  return [ios ? `iOS${ios}` : "", and ? `安卓${and}` : "", other ? `其他${other}` : ""].filter(Boolean).join("+");
};
const EXCL_LABEL = (e) => {
  if (!e) return null;
  const dim = { EXCLUDED_DIMENSION_APP: "本App", EXCLUDED_DIMENSION_ACCOUNT: "账户" }[e.excluded_dimension] || e.excluded_dimension;
  const day = { EXCLUDED_DAY_SEVEN_DAY: "7天", EXCLUDED_DAY_FIFTEEN_DAY: "15天", EXCLUDED_DAY_THIRTY_DAY: "30天", EXCLUDED_DAY_ONE_DAY: "1天" }[e.excluded_day] || e.excluded_day;
  return `${dim}·${day}`;
};
const CNT_LABEL = (v, unit = "个") => (Array.isArray(v) && v.length ? `${v.length}${unit}` : null);

/* 表格主列：顺序即阅读顺序。
   ⚠️ key 必须用 targeting 里的**原始字段名** —— 变更侦测靠它把字段映射回中文标签，
   写成别名（如 network）会匹配不上，变化日志里就只剩英文键名。 */
const COLS = [
  { key: "gender",   label: "性别",   get: (t) => t.gender,                     fmt: (v) => (Array.isArray(v) ? v.map(x => x === "MALE" ? "男" : x === "FEMALE" ? "女" : x).join("/") : null), expect: EXPECT.gender },
  { key: "age",      label: "年龄",   get: (t) => t.age,                        fmt: AGE_LABEL,     expect: EXPECT.age },
  { key: "geo_location", label: "地域", get: (t) => t.geo_location,             fmt: GEO_LABEL,     expect: null },
  { key: "network_type", label: "网络", get: (t) => t.network_type,             fmt: NET_LABEL,     expect: null },
  { key: "user_os",  label: "系统",   get: (t) => t.user_os,                    fmt: OS_LABEL,      expect: null },
  { key: "excluded_converted_audience", label: "排除已转化", get: (t) => t.excluded_converted_audience, fmt: EXCL_LABEL, expect: null },
];

/* 其余「未设/已设」诊断维度：只报状态，不占主表宽度 */
const EXTRA = [
  { key: "excluded_os",            label: "排除系统" },
  { key: "device_price",           label: "设备价格" },
  { key: "education",              label: "学历" },
  { key: "interest_category_id_list", label: "兴趣分类" },
  { key: "interest_keyword_id_list",  label: "兴趣关键词" },
  { key: "behavior_category_id_list", label: "行为分类" },
  { key: "behavior_keyword_id_list",  label: "行为关键词" },
  { key: "custom_audience",        label: "自定义人群" },
  { key: "excluded_custom_audience", label: "排除人群" },
  { key: "app_install_status",     label: "应用安装状态" },
  { key: "game_consumption_level", label: "游戏消费能力" },
  { key: "wechat_ad_behavior",     label: "微信广告行为" },
  { key: "marital_status",         label: "婚恋状态" },
];

const sameJSON = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/* ════════ 0) 实际人群画像（性别 / 年龄 / 省份）════════ */
const AUD_FIELDS = ["cost", "view_count", "valid_click_count",
  "mini_game_register_users", "mini_game_create_role_users", "mini_game_retention_d1"];

async function fetchTag(type, dim, start, end) {
  const r = await api("/v3.0/targeting_tag_reports/get", {
    account_id: ACCOUNT, type, level: "ADVERTISER",
    date_range: JSON.stringify({ start_date: start, end_date: end }),
    group_by: JSON.stringify([dim]),
    fields: JSON.stringify([dim, ...AUD_FIELDS]),   // group_by 的维度 id 必须同时在 fields 里
    page: "1", page_size: "200",
  });
  if (r.code !== 0) return { err: `${r.code} ${r.message_cn || r.message}` };
  return { list: r.data?.list || [] };
}

const argDates = process.argv.slice(2).filter(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
const AUD_START = argDates[0] || DEF_START;
const AUD_END = argDates[1] || DEF_END;

const audience = { start: AUD_START, end: AUD_END, gender: [], age: [], region: [], total: 0, errs: [], skipped: NO_AUDIENCE };
if (!NO_AUDIENCE) {
  const [g, a, rg] = [
    await fetchTag("GENDER", "gender_id", AUD_START, AUD_END),
    await new Promise(r => setTimeout(r, 900)).then(() => fetchTag("AGE", "age_id", AUD_START, AUD_END)),
    await new Promise(r => setTimeout(r, 900)).then(() => fetchTag("REGION", "region_id", AUD_START, AUD_END)),
  ];
  for (const [name, res] of [["GENDER", g], ["AGE", a], ["REGION", rg]]) if (res.err) audience.errs.push(`${name}: ${res.err}`);
  const norm = (res, idKey, nameOf) => (res.list || []).map(x => ({
    id: x[idKey],
    name: nameOf(x[idKey]),
    cost: (x.cost || 0) / 100,
    reg: x.mini_game_register_users || 0,
    cr: x.mini_game_create_role_users || 0,
    ret: x.mini_game_retention_d1 || 0,
    click: x.valid_click_count || 0,
    view: x.view_count || 0,
  })).sort((p, q) => q.cost - p.cost);
  audience.gender = norm(g, "gender_id", id => GENDER_NAME[id] ?? `未知(${id})`);
  audience.age = norm(a, "age_id", id => AGE_BUCKET[id] ?? `未知(${id})`);
  audience.region = norm(rg, "region_id", id => PROV[id] ?? `ID ${id}`);
  audience.total = audience.gender.reduce((s, x) => s + x.cost, 0);
}

/* ════════ 1) 拉单元 + 整理 ════════ */
const FIELDS = ["adgroup_id", "adgroup_name", "configured_status", "system_status",
  "targeting", "site_set", "scene_spec", "smart_targeting_mode", "daily_budget", "optimization_goal"];

let raw = [];
for (let page = 1; page <= 5; page++) {
  const r = await api("/v3.0/adgroups/get", {
    account_id: ACCOUNT,
    fields: JSON.stringify(FIELDS),
    page: String(page), page_size: "100",
  });
  if (r.code !== 0) {
    console.error(`[定向监控] adgroups/get 失败：${r.code} ${r.message_cn || r.message}`);
    process.exit(1);
  }
  const list = r.data?.list || [];
  raw.push(...list);
  if (list.length < 100) break;
}

const short = (s) => String(s || "").replace(/^(AD_STATUS_|ADGROUP_STATUS_|OPTIMIZATIONGOAL_)/, "");
const units = raw
  .filter(g => (ONLY_ACTIVE ? short(g.configured_status) === "NORMAL" : true))
  .map(g => {
    const t = g.targeting || {};
    const cols = {};
    const diffs = [];
    for (const c of COLS) {
      const val = c.get(t);
      const shown = c.fmt(val);
      const unset = val === undefined || val === null || (Array.isArray(val) && val.length === 0);
      let mark = "";
      if (unset) mark = "⚪";
      else if (c.expect) mark = sameJSON(val, c.expect) ? "✅" : "⚠️";
      else mark = "·";
      cols[c.key] = { raw: val ?? null, shown: shown || "未设", unset, mark };
      if (c.expect && !unset && !sameJSON(val, c.expect)) {
        diffs.push(`${c.label} 实际 ${shown} ≠ 期望 ${c.fmt(c.expect) || JSON.stringify(c.expect)}`);
      } else if (c.expect && unset) {
        diffs.push(`${c.label} 未设（期望 ${c.fmt(c.expect) || JSON.stringify(c.expect)}）`);
      }
    }
    const unsetExtra = EXTRA.filter(e => {
      const v = t[e.key];
      return v === undefined || v === null || (Array.isArray(v) && v.length === 0);
    }).map(e => e.label);

    return {
      id: String(g.adgroup_id),
      name: g.adgroup_name || `（无名称 · ${g.adgroup_id}）`,
      conf: short(g.configured_status),
      sys: short(g.system_status),
      goal: short(g.optimization_goal),
      siteSet: g.site_set || [],
      scene: g.scene_spec || {},
      smartTargeting: g.smart_targeting_mode || null,
      subFields: Object.keys(t),
      cols,
      diffs,
      unsetExtra,
      /* 快照用：只存会影响判断的原值 */
      snap: {
        name: g.adgroup_name || null,
        configured_status: g.configured_status || null,
        targeting: t,
        site_set: g.site_set || null,
        scene_spec: g.scene_spec || null,
        smart_targeting_mode: g.smart_targeting_mode || null,
      },
    };
  })
  .sort((a, b) => Number(b.id) - Number(a.id));

/* ════════ 2) 快照：读取上一份 → 对比 → 写今天这份 ════════ */
let snapInfo = { dir: SNAP_DIR.replace(REPO, "."), prevDate: null, prevPath: null, written: null, changes: [], skipped: NO_SNAPSHOT };
if (!NO_SNAPSHOT) {
  try { if (!existsSync(SNAP_DIR)) mkdirSync(SNAP_DIR, { recursive: true }); } catch { }
  let prev = null;
  try {
    const files = readdirSync(SNAP_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    for (const f of files.reverse()) {
      const d = f.replace(".json", "");
      if (d < TODAY) { prev = { date: d, path: join(SNAP_DIR, f), data: JSON.parse(readFileSync(join(SNAP_DIR, f), "utf8")) }; break; }
    }
  } catch { }

  if (prev) {
    snapInfo.prevDate = prev.date;
    snapInfo.prevPath = prev.path.replace(REPO, ".");
    const prevUnits = prev.data?.units || {};
    const nowUnits = Object.fromEntries(units.map(u => [u.id, u.snap]));
    for (const u of units) {
      const old = prevUnits[u.id];
      if (!old) { snapInfo.changes.push(`➕ 新增在投单元：${u.name}（${u.id}）`); continue; }
      if (!sameJSON(old.configured_status, u.snap.configured_status)) {
        snapInfo.changes.push(`🔁 ${u.name} 投放状态：${short(old.configured_status)} → ${short(u.snap.configured_status)}`);
      }
      if (!sameJSON(old.targeting, u.snap.targeting)) {
        const ot = old.targeting || {}, nt = u.snap.targeting || {};
        const keys = new Set([...Object.keys(ot), ...Object.keys(nt)]);
        for (const k of keys) {
          if (sameJSON(ot[k], nt[k])) continue;
          const c = COLS.find(x => x.key === k) || EXTRA.find(x => x.key === k);
          const lbl = c?.label || k;
          const fmtV = (v) => {
            const col = COLS.find(x => x.key === k);
            if (col) return col.fmt(v) || "未设";
            return v == null || (Array.isArray(v) && !v.length) ? "未设" : JSON.stringify(v).slice(0, 40);
          };
          snapInfo.changes.push(`🔧 ${u.name} · ${lbl}：${fmtV(ot[k])} → ${fmtV(nt[k])}`);
        }
      }
      if (!sameJSON(old.site_set, u.snap.site_set)) snapInfo.changes.push(`🔧 ${u.name} · 版位：${(old.site_set || []).join(",") || "空"} → ${(u.snap.site_set || []).join(",") || "空"}`);
      if (!sameJSON(old.smart_targeting_mode, u.snap.smart_targeting_mode)) snapInfo.changes.push(`🔧 ${u.name} · 智能定向：${old.smart_targeting_mode || "未设"} → ${u.snap.smart_targeting_mode || "未设"}`);
    }
    for (const [id, old] of Object.entries(prevUnits)) {
      if (units.some(u => u.id === id)) continue;
      if (short(old.configured_status) !== "NORMAL") continue;   // 本来就是停的不算变化
      snapInfo.changes.push(`➖ 退出在投：${old.name || id}（${id}）`);
    }
  }

  const snapPath = join(SNAP_DIR, `${TODAY}.json`);
  try {
    writeFileSync(snapPath, JSON.stringify({
      date: TODAY, generatedAt: new Date().toISOString(), account: ACCOUNT,
      onlyActive: ONLY_ACTIVE,
      units: Object.fromEntries(units.map(u => [u.id, u.snap])),
    }, null, 1), "utf8");
    snapInfo.written = snapPath.replace(REPO, ".");
  } catch (e) { snapInfo.written = `写入失败：${e.message}`; }
}

/* ════════ 3) 文本输出 ════════ */
const W = (s, n) => padE(String(s).slice(0, n), n);
console.log(`定向监控 · 账户 ${ACCOUNT} · ${ONLY_ACTIVE ? "仅在投单元" : "全部单元"} · ${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`);
console.log("");

const NAME_W = Math.max(30, ...units.map(u => dw(u.name.slice(0, 34)))) + 2;
console.log(`${W("单元（后台全称）", NAME_W)} ${padE("性别", 6)} ${padE("年龄", 10)} ${padE("地域", 16)} ${padE("网络", 14)} ${padE("排除已转化", 12)}`);
console.log("─".repeat(NAME_W + 62));
for (const u of units) {
  const g = u.cols.gender, a = u.cols.age, geo = u.cols.geo_location, net = u.cols.network_type, ex = u.cols.excluded_converted_audience;
  console.log(
    `${W(u.name, NAME_W)} ${padE(g.mark + g.shown, 6)} ${padE(a.mark + a.shown, 10)} ${padE(geo.mark + geo.shown, 16)} ${padE(net.mark + net.shown, 14)} ${padE(ex.mark + ex.shown, 12)}`
  );
}
console.log("─".repeat(NAME_W + 62));
console.log(`图例：✅ 与期望一致　⚠️ 与期望不同　⚪ 未设　· 无期望值（只报值）`);
console.log("");

/* 差异清单 */
if (units.some(u => u.diffs.length)) {
  console.log("⚠️ 与期望值的差异（只列出，不判定）：");
  for (const u of units) {
    if (!u.diffs.length) continue;
    console.log(`  · ${u.name}`);
    for (const d of u.diffs) console.log(`      ${d}`);
  }
  console.log("");
}

/* ── 实际人群画像 ── */
const bps = (v, t) => (t > 0 ? (v / t * 100).toFixed(1) + "%" : "—");
if (!audience.skipped) {   // 关掉画像（TARGETING_NO_AUDIENCE=1）时不占版面
console.log(`🎯 实际人群画像 · 窗口 ${audience.start} ~ ${audience.end} · 消耗合计 ${audience.total.toFixed(2)} 元`);
if (audience.errs.length) console.log(`  ⚠️ 有维度拉取失败：${audience.errs.join("；")}`);

const audRow = (name, x, indent = 4) => {
  const crCost = x.cr ? `${(x.cost / x.cr).toFixed(2)}/个` : "—";
  const retRate = x.cr ? bps(x.ret, x.cr) : "—";
  return `${" ".repeat(indent)}${padE(name, 8)} 消耗 ${x.cost.toFixed(2).padStart(8)} (${bps(x.cost, audience.total).padStart(6)})  注册 ${String(x.reg).padStart(4)}  创角 ${String(x.cr).padStart(3)}  创角成本 ${padE(crCost, 9)} 次留 ${String(x.ret).padStart(3)} (${retRate})`;
};
console.log("  【性别】");
for (const x of audience.gender) console.log(audRow(x.name, x));
console.log(`     ↳ 「未设性别定向」的单元会把钱投给女性：本次女性占 ${bps(audience.gender.find(x => x.id === 2)?.cost || 0, audience.total)}`);

console.log("  【年龄】平台固定分段 ≤18 / 19-24 / 25-29 / 30-39 / 40-49 / 50+（不随定向区间切分）");
for (const x of audience.age) console.log(audRow(x.name, x));

console.log("  【区域 · 省份】");
const rgTop = audience.region.slice(0, 15);
const rgRest = audience.region.slice(15);
for (const x of rgTop) console.log(audRow(x.name, x));
if (rgRest.length) {
  const rest = rgRest.reduce((a, x) => ({ cost: a.cost + x.cost, reg: a.reg + x.reg, cr: a.cr + x.cr, ret: a.ret + x.ret }), { cost: 0, reg: 0, cr: 0, ret: 0 });
  console.log(audRow(`其余${rgRest.length}省`, rest));
}
console.log(`     ↳ 覆盖 ${audience.region.length} 个省级单位；省级 ID 与国标码一致，市级需 targeting_tags/get 另取`);
console.log("");
}

/* 未设维度 */
console.log("⚪ 未设维度（全账户统一未设项不逐条重复，只列各单元特有的）：");
const unsetCount = {};
for (const u of units) for (const k of u.unsetExtra) unsetCount[k] = (unsetCount[k] || 0) + 1;
const allUnset = Object.entries(unsetCount).filter(([, n]) => n === units.length).map(([k]) => k);
for (const u of units) {
  const own = u.unsetExtra.filter(k => !allUnset.includes(k));
  if (own.length) console.log(`  · ${u.name}：${own.join("、")}`);
}
if (allUnset.length) console.log(`  · 【${units.length} 个单元全部未设】${allUnset.join("、")}`);
console.log("");

/* 变更侦测 */
console.log("🔍 配置变更侦测：");
if (NO_SNAPSHOT) console.log("  （本次跳过快照，未做对比）");
else if (!snapInfo.prevDate) console.log(`  （无历史快照可比；已写入 ${snapInfo.written}，明天起可对比）`);
else if (!snapInfo.changes.length) console.log(`  ✅ 与 ${snapInfo.prevDate} 快照相比无变化`);
else {
  console.log(`  与 ${snapInfo.prevDate} 快照相比，${snapInfo.changes.length} 处变化：`);
  for (const c of snapInfo.changes) console.log(`  ${c}`);
}
console.log("");

console.log("注：① 本脚本看的是【定向配置】（我们要求系统找什么人），**不是实际投来的人是谁** ——");
console.log("      平台侧按 age/gender/city 聚合全部报 `1801177 unsupport field`，游戏后台亦无这些字段；");
console.log("    ② 「未设」≠「投给了所有人」：oCPC 下系统会按转化目标自行收敛，未设只是没有硬约束；");
console.log(`    ③ 年龄期望值 ${RULE_NOTE.age} —— 只报差异、不判合规，口径需人工拍板；`);
console.log(`    ④ 快照留痕：${snapInfo.dir}/<日期>.json（默认 ${ONLY_ACTIVE ? "仅在投" : "全部"}；TARGETING_ALL=1 切换范围）`);

/* ── 留痕（最近一次可读输出）── */
const txtPath = join(TMP, "targeting_monitor.txt");
try {
  const lines = units.map(u => [
    u.id, u.name, u.conf, u.sys,
    `性别=${u.cols.gender.shown}${u.cols.gender.unset ? "(未设)" : ""}`,
    `年龄=${u.cols.age.shown}`,
    `地域=${u.cols.geo_location.shown}`, `网络=${u.cols.network_type.shown}`,
    `系统=${u.cols.user_os.shown}`, `排除已转化=${u.cols.excluded_converted_audience.shown}`,
    `subFields=[${u.subFields.join(",")}]`,
    `未设=[${u.unsetExtra.join(",")}]`,
  ].join(" | ")).join("\n");
  writeFileSync(txtPath, `# 定向监控 ${new Date().toISOString()} 账户 ${ACCOUNT}\n${lines}\n\n# 差异\n${units.flatMap(u => u.diffs.map(d => `${u.name}: ${d}`)).join("\n")}\n\n# 变更\n${snapInfo.changes.join("\n")}\n`, "utf8");
} catch { }

/* ════════ 4) JSON 输出（网页端）════════ */
if (JSON_OUT) {
  OUT(JSON.stringify({
    kind: "targeting",
    generatedAt: new Date().toISOString(),
    account: ACCOUNT,
    onlyActive: ONLY_ACTIVE,
    expect: EXPECT,
    ruleNote: RULE_NOTE,
    columns: COLS.map(c => ({ key: c.key, label: c.label, hasExpect: !!c.expect })),
    units: units.map(u => ({
      id: u.id, name: u.name, conf: u.conf, sys: u.sys, goal: u.goal,
      siteSet: u.siteSet, smartTargeting: u.smartTargeting, subFields: u.subFields,
      cells: Object.fromEntries(COLS.map(c => [c.key, { shown: u.cols[c.key].shown, mark: u.cols[c.key].mark, unset: u.cols[c.key].unset, raw: u.cols[c.key].raw }])),
      diffs: u.diffs,
      unsetExtra: u.unsetExtra,
    })),
    snapshot: snapInfo,
    audience: {
      start: audience.start, end: audience.end,
      total: audience.total,
      errs: audience.errs,
      gender: audience.gender.map(x => ({ ...x, share: audience.total ? x.cost / audience.total : null })),
      age: audience.age.map(x => ({ ...x, share: audience.total ? x.cost / audience.total : null })),
      region: audience.region.map(x => ({ ...x, share: audience.total ? x.cost / audience.total : null })),
    },
    notes: [
      "上半部分＝定向配置（要求系统找谁）；下半部分＝实际人群画像（系统找来了谁，targeting_tag_reports/get，T+1）",
      "「未设」≠「投给所有人」，oCPC 下系统自行收敛",
      `年龄期望 ${RULE_NOTE.age}`,
      "年龄桶是平台固定分段（≤18/19-24/25-29/30-39/40-49/50+），不按定向区间切分",
    ],
  }));
}
