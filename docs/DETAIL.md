# Tencent Ads tools

A right-sidebar panel that puts eight delivery-analysis tools and the Griffin data puller in one
place; the main conversation can query the same data through `ad_tools_report` /
`ad_tools_last_report`. The left-sidebar `Tencent Ads` entry opens it in the right sidebar; the right sidebar's
start page also shows a `Tencent Ads` card (tab kind `ad-tools`), and the tab strip's add control
opens it too. The conversation stays in the middle, the panel docks on the right.

**No local servers any more.** The panel is not an iframe: the host half runs the scripts and logs
into Grafana itself; the browser half only collects parameters and renders. Credentials are entered
in the panel's Settings — no more editing `.env.local`.

## The panel

- Header: title and `Settings`.
- Tab strip: the eight tools plus `Griffin data` and `AI 分析`.
- Parameter row: date range, breakdown (creatives/retention), `include paused / historical units`
  (targeting), account selector, `Run`.
- Body: KPI cards → alerts and notes → tables (grouped, totals, bars, tags, creative thumbs) →
  ranked lists and configuration snapshots.
- `Copy table` yields TSV for Excel; the weekly report can export Markdown.
- Switching to another plugin and back keeps the tab, dates, account and every result — nothing is
  re-queried, and a run still in flight lands on the panel you return to. Only the very first open
  after starting DSH pulls the monitor report by itself.

| Tab | Script (in the tools directory) |
| --- | --- |
| Monitor | `盯盘.mjs` |
| Retention | `创角次留.mjs` |
| Registrations | `注册留存.mjs` |
| Creatives | `创意数据.mjs` |
| Weekly | `周报生成器.mjs` |
| Break-even bid | `保本出价.mjs` |
| Unit LTV | `单元LTV判定.mjs` |
| Targeting | `定向监控.mjs` |
| Griffin data | six report SQL modules + read-only custom SQL |
| AI 分析 | ask via DSH's built-in DeepSeek model — no key needed |

## AI 分析

A fourth tab that answers follow-up questions about data the panel already has — no export/import.
Select a source (auto-picks the current tool report, the Griffin report, or the custom SQL result),
type free-form questions, and keep asking; context from earlier rounds in the same panel session is
carried along (last 20 messages).

- By default it uses DSH's own DeepSeek model (`deepseek-flash`, streaming, reasoning off, 2-minute
  timeout) through the DeepSeek routes DSH already has — **no separate API key required**. The tab
  shows a note when this built-in path is active.
- When a `DeepSeek API Key` is set in Settings **and** the direct `AI direct base URL` or
  `Direct model name` differs from its default, the user clearly wants their own endpoint: AI chat
  calls that OpenAI-compatible `/chat/completions` directly (temperature 0.3, no streaming) and
  skips DSH's built-in model — this is how you wire up a local proxy / relay / self-hosted service.
- A key by itself (default URL and model unchanged) is a fallback: with no usable DSH DeepSeek
  route (missing credential / no adapter), the request goes to the official
  `https://api.deepseek.com` (`deepseek-chat`). `AI direct base URL` and `Direct model name` tune
  that direct path (defaults are the two values above); a non-default value takes priority over
  the built-in model.
- The question is answered against the data snapshot serialized into the system message. Griffin
  includes the SQL used; each source notes what it contains in a "data snapshot" chip.
- Follow-ups reuse the data already sent — re-querying is not needed for a follow-up question.
- Neither a built-in model nor a key? A box in the tab links straight to Settings.
- The key lives in `~/.dsh/storages/ad-tools/config.json` (0600, never echoed back, browser only
  sees `hasDeepseekKey`).

## Querying from the main conversation

The plugin registers two host tools with DSH, so the conversation itself can pull data and analyze
it without opening the panel:

| Tool | What it does |
| --- | --- |
| `ad_tools_report` | Runs one analysis tool (`monitor` / `retention` / `register` / `creatives` / `weekly` / `ceiling` / `units` / `targeting`) with panel-equivalent arguments: `start` / `end` / `dim` / `all` / `account_id` / `max_rows` |
| `ad_tools_last_report` | Reads the full report from the panel's most recent query — no re-query when the user asks about data they just ran |

- Output is the same report model rendered as plain text (KPIs, alerts, methodology notes, tables,
  cost rankings) — not a screenshot and not a second set of numbers. `max_rows` defaults to 120 rows
  per table; anything dropped is called out explicitly.
- A source line names the tool, account, parameters and query time. Credentials stay in the host;
  the model only sees numbers.
- Panel and conversation share the last report: a panel query can be read from the conversation, and
  a tool query replaces that cache.
- The tools are registered only when DSH provides a `tools` service; in a plain HTTP environment (or
  an older DSH) they are skipped silently and the panel works as before.

The right sidebar is for looking; the conversation is for asking — no copy-pasting data out.

## How data flows

```
client.js  --POST api/ad-tools/{run,griffin/report,ai/chat,...}-->
index.js -> lib/*.js
   ├─ delivery analysis: spawn <plugin>/scripts/<script>.mjs --json
   │                     last stdout line -> lib/report.js -> one uniform report model
   ├─ Griffin: POST <grafana>/login -> /api/ds/query (the six SQL modules verbatim)
   ├─ creative preview: dynamic_creatives/get -> videos|images/get (10 min cache)
   ├─ AI 分析: ai/chat serializes panel data → key set + non-default URL/model:
   │            direct POST <deepseekApiBase>/chat/completions; otherwise DSH built-in
   │            LLM (deepseek-flash), falling back to default official direct when no
   │            DSH route and a key are present
   └─ main conversation: ctx.tools registers ad_tools_report / ad_tools_last_report
                          → same runByKey + normalize → truncated text report
```

The eight `.mjs` scripts ship inside the plugin (`<plugin>/scripts/`), so the panel never depends on
an external tools directory. They are copied from the ad repo's `tools/ad-tools` when the platform
fields or calculations change (see `scripts/README.md`); runtime output goes to
`~/.dsh/storages/ad-tools/run/`. The plugin owns credentials, parameters, processes and rendering.

## Credentials

Stored in `~/.dsh/storages/ad-tools/config.json` (mode 0600), written by Settings and effective
immediately: `grafanaUrl` / `grafanaUser` / `grafanaPass`, `dsMain` / `dsX7`, `tencentToken`,
`deepseekKey`, `deepseekApiBase` / `deepseekModel`, `accountId`, `accountList`. The eight `.mjs` scripts ship inside
the plugin (`<plugin>/scripts/`), so no external tools directory is needed; `adToolsDir` survives only
as a legacy fallback when a bundled script is missing. `deepseekKey` is
optional — the AI tab runs on DSH's built-in DeepSeek model without it; with a key plus a
non-default `deepseekApiBase` / `deepseekModel`, the direct endpoint takes priority. `deepseekApiBase`
(default `https://api.deepseek.com`) and `deepseekModel` (default `deepseek-chat`) are plain config,
exposed to the browser like `grafanaUrl`.

Each value resolves independently, first hit wins:

1. that config file;
2. environment variables `GRAFANA_URL`, `GRAFANA_USER`, `GRAFANA_PASS`, `MKT_ACCESS_TOKEN`,
   `MKT_ACCOUNT_ID`;
3. the legacy locations `griffin-data-tool/.env.local` and the repo's
   `tmp/tencentads_credentials.json`.

(3) exists so existing setups keep working. The plugin only reads those files — it never copies or
rewrites them, and secrets never enter the plugin folder or a commit. Passwords and tokens are never
echoed back to the browser, only "saved". Empty field means "leave unchanged"; use
`Clear saved password / token` to delete.

### Where the account list comes from

The account dropdown is not a hard-coded list. It merges, deduplicated by ID:

1. Settings → **Account list** (`accountList`, one line per entry: ID plus an optional label);
2. Settings → **Advertiser account ID** (`accountId`, the default account);
3. accounts `advertiser/get` returns, with corporation name and status;
4. `known_accounts` from the legacy credential file (read-only migration fallback).

**`advertiser/get` does not enumerate your accounts.** It requires an `account_id` (`132115` when
empty) and, for a direct-advertiser token, returns only the account you asked about. Verified here:
querying two different account IDs each returned only the account asked for — yet `adgroups/get`
worked for both, so the token has permission without having enumeration. Tencent documents the same:
a direct advertiser must pass `account_id` and can only see itself; only an agency token may omit it
and list sub-accounts (`agency/get` answers `132307` for this token). `business_manager_relations/get`
returns an empty list and `business_mdm_account_relations/get` answers `31009` for `RELATION_TYPE_MDM`.

So `accountId` is the **seed**: it is queried first, or the first entry of the account list when no
default is set. Other accounts are reached by adding them to the account list, or by looking one up
by ID in Settings — the platform returns its corporation name, and **Add to list** pins it.

Picking an account in the parameter row applies to that query (asset previews included); the
`ad_tools_report` host tool also takes a per-call `account_id`.

Settings → **Authorized accounts** has the two entries:

- **Fetch from platform** queries the default account and re-checks each account in the manual list
  for its corporation name and status. Rows show ID, name, status and source (default / manual list /
  legacy file / authorized); **Add to list** pins one into the manual list above.
- **Look up** takes any account ID and queries it on its own — the way to reach an account that is
  not the default — and its row can be added to the list the same way.
- The `↻` next to the account dropdown in the parameter row hits the same route without leaving the
  panel.

Fetching uses the *saved* token and advertiser ID, so save a changed token first; platform errors
(for example `12201 account_id 参数无效`) are shown verbatim under the button.

### Two bridges worth knowing

- **Credential redirect.** All eight scripts read the token straight from
  `<repo>/tmp/tencentads_credentials.json` with no env fallback. When a token is configured, the host
  starts the child with `node --import lib/credfile-shim.mjs`, which swaps that read in memory for the
  configured value. The script is untouched and the repo file is not modified.
- **Griffin SQL bridge.** `保本出价.mjs` / `单元LTV判定.mjs` fetch game-side data from
  `POST 127.0.0.1:8787/api/sql`. The host now opens a short-lived loopback listener while those two
  run (loopback only, ephemeral port, `POST /api/sql` only, `SELECT`/`WITH` single statements only),
  wired to its own Grafana session, and closes after 60 idle seconds. Nothing is reachable from the
  LAN.

## Security

- No externally listening port; the only listener is the short-lived read-only loopback bridge.
- Every route is mounted on DSH's own `connection`, POST-only.
- `publicConfig` exposes only presence and provenance of secrets, never their values.
- Creative previews use temporary Tencent CDN URLs fetched on demand.
- The plugin lives entirely inside the DSH process: quitting DSH ends the panel, the bridge and any
  running script (`killAll()` on dispose), so no background service or orphan process is left
  behind. Credentials stay in the config file, so reopening DSH brings the panel back as it was.
- AI 分析 defaults to DSH's own DeepSeek model (via the DeepSeek routes DSH has registered); with a
  key set and non-default direct URL/model, data goes to that custom endpoint (the official
  `api.deepseek.com` is reached only as a fallback when no DSH route is available and a key is set).
  Either way, only the data snapshot, question and conversation history leave the machine — nothing
  is stored by the plugin, and no data is retained locally from that call.

## Install

In `~/.dsh/profiles/desktop/package.json`:

```json
{
  "dependencies": {
    "@local/ad-tools": "link:<absolute path to this repo>"
  },
  "dsh": {
    "profile": {
      "bundles": ["@local/ad-tools"]
    }
  }
}
```

Create the `node_modules/@local/ad-tools` junction once and restart DSH: a `Tencent Ads` entry
appears in the left sidebar and opens the panel on the right (the right sidebar's start page also
shows the same card). Fill in Settings on first open.

## Troubleshooting

| Symptom | Look at |
| --- | --- |
| Griffin tab only says something is missing | Fill URL / user / password in Settings, press `Test Griffin connection` |
| `script not found` | Incomplete install (`scripts/` missing a file), or `AD_TOOLS_SCRIPTS_DIR` points elsewhere |
| `start Griffin first` | The bridge failed — usually credentials or network; run the connection test |
| Platform columns empty in break-even / unit LTV | Invalid token or no spend in that window; game-side data is unaffected |
