/**
 * 浏览器端入口：左侧栏「腾讯广告」入口 + 全局面板（原生 React，不再嵌 iframe）。
 *
 * 挂载点：
 *   · sidebar.right.pane.tab —— 右侧栏 tab 的正文（面板本体），tab 类型注册在 ctx.tabs
 *   · sidebar.panellist      —— 左侧栏导航区的一行；选中后把面板开到右侧栏
 *   · main（keyed）           —— 右侧栏不可用时的兜底，直接在主内容区渲染面板
 *
 * 面板只做「参数 + 渲染」：数据由 Host 半（./index.js）跑工具 / 查格里芬拿到，
 * 并已归一成统一的报告模型（见 lib/report.js）。凭证在「设置」里填。
 *
 * 结构照搬官方 decoration 模板：
 *   window.__ModuleLoader__.load({ id: '<包名>', factory(require) { ... } })
 */
window.__ModuleLoader__.load({
  id: '@local/ad-tools',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'ad-tools'
    const PANEL_ID = 'ad-tools'
    // 右侧栏（dsh-client-ui-sidebar-right）的 tab 类型：id 是正文席位用的 key，kind 是 openTab 的名字。
    const TAB_ID = '@local/ad-tools'
    const TAB_KIND = 'ad-tools'
    const TAB_REGISTRY = 'sidebarRightTabs' // ctx.sidebarRightTabs：右侧栏的 tab 类型注册表

    /* ------------------------------------------------------------------ *
     * 文案
     * ------------------------------------------------------------------ */
    const DICT = {
      zh: {
        entry: '腾讯广告',
        title: '腾讯广告',
        subtitle: '投放分析 · 格里芬数据',
        movedRight: '腾讯广告面板在右侧栏打开。',
        openRight: '在右侧打开',
        tabGriffin: '格里芬数据',
        settings: '设置',
        back: '返回',
        refresh: '刷新',
        run: '查询',
        running: '查询中…',
        account: '账户',
        dateStart: '起始日',
        dateEnd: '结束日',
        dim: '维度',
        dimDate: '按日期',
        dimSite: '按版位',
        dimCreative: '按素材',
        onlyActive: '含暂停 / 历史单元',
        pendingClear: '待清除',
        emptyTitle: '选一个工具开始',
        emptyHint: '查询会跑插件内置的脚本，结果在这里渲染。凭证在「设置」里配。',
        emptyTool: '这个工具还没有结果，点「查询」。',
        noData: '这个窗口没有数据',
        queryFailed: '查询失败',
        alerts: '告警',
        alertsNone: '无异常',
        warnings: '口径提示',
        copy: '复制表格',
        copied: '已复制',
        copyFailed: '复制失败',
        toolsDir: '脚本目录（内置）',
        toolsDirHint: '八个 .mjs 随插件安装，不需要外部目录；这里只显示实际位置',
        tencentToken: '腾讯广告 access_token',
        tencentTokenHint: '留空 = 不改；已保存的不会回显。清空后若旧位置还有值会继续用（看来源）',
        accountId: '广告账户 ID',
        accountIdHint: '必填；默认查询这个账户，也是向平台拉账户列表的种子账户',
        accountList: '账户列表（可选）',
        accountListHint: '每行一个：账户 ID，后面可跟空格 + 备注名。填了就一直出现在账户下拉里。直客 token 列不出名下全部账户，别的账户靠这个列表或下面的「查这个账户」补。',
        platformAccounts: '平台已授权账户',
        platformAccountsHint: '腾讯广告的 advertiser/get 是「按账户 ID 查」：直客 token 只会返回这个账户本身，列不出名下全部账户。要看别的账户，填 ID 点「查这个账户」，或者直接加进上面的账户列表。改过 token 先保存再拉。',
        pullAccounts: '从平台拉取',
        pulling: '拉取中…',
        lookupAccount: '查这个账户',
        lookupPlaceholder: '输入账户 ID 单独查',
        addToList: '加入列表',
        added: '已加入',
        accountsUnit: '个账户',
        accountsEmpty: '平台没有返回账户：确认这个 ID 属于当前 token（直客 token 只能查到自己）。',
        platformError: '平台返回',
        refreshAccounts: '重新拉取账户列表',
        accountNone: '未配置账户',
        acctSrcCredential: '默认账户',
        acctSrcManual: '手动列表',
        acctSrcKnown: '旧凭证',
        acctSrcAuthorized: '平台授权',
        grafanaUrl: '格里芬地址',
        grafanaUser: '格里芬账号',
        grafanaPass: '格里芬密码',
        grafanaPassHint: '留空 = 不改；清空后若旧位置还有值会继续用（看来源）',
        dsMain: '主库数据源 UID',
        dsX7: '小七库数据源 UID',
        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        test: '测试格里芬连接',
        testing: '测试中…',
        testOk: '连接成功',
        testFail: '连接失败',
        clearPass: '清除已存密码',
        clearToken: '清除已存令牌',
        source: '来源',
        sourceConfig: '面板设置',
        sourceEnv: '环境变量',
        sourceEnvFile: '旧 .env.local',
        sourceCredFile: '仓库凭证文件',
        sourceNone: '未配置',
        configFile: '配置文件',
        missing: '缺少',
        weeklyMd: '导出周报 Markdown',
        mdFailed: '导出失败',
        queryGriffin: '生成报表',
        modules: '数据模块',
        customSql: '自定义 SQL',
        sqlPlaceholder: 'SELECT ... （只允许单条只读语句）',
        execute: '执行',
        sqlEmpty: '还没有结果',
        rows: '行',
        elapsed: '耗时',
        asset: '素材预览',
        assetError: '素材打不开',
        close: '关闭',
        settingsHint: '凭证只写在本机配置文件里，不进插件目录、不进提交记录。',
        noToken: '未配置令牌',
        sqlShow: 'SQL',
        allModules: '全选',
        settingsSavedHint: '改完记得保存；保存后凭证立即生效。',
        envFallback: '当前值来自旧位置，保存后会写进面板配置。',
        tabAi: 'AI 分析',
        aiSource: '分析对象',
        aiSourceReport: '当前页签报告',
        aiSourceGriffin: '格里芬报表',
        aiSourceSql: '自定义 SQL 结果',
        aiAskPlaceholder: '问点什么，例如：这周哪个创意消耗最快但成本最高？',
        aiSend: '发送',
        aiThinking: 'AI 分析中…',
        aiDataSnap: '数据快照',
        aiDataDefault: '选前面任意一个页签跑一次查询，这里就有数据可问。',
        aiDataNone: '还没有可分析的数据，先去「查询」或「格里芬数据」出结果。',
        aiNoKeyHint: '还没填 DeepSeek API Key，去『设置』补一个才能用。',
        aiDshReadyNote: '正在用 DSH 内置的 DeepSeek 模型，不用单独配 Key。',
        aiHistoryHint: 'AI 只用下面这份数据快照 + 本次会话的对话，可连续追问。',
        aiEmpty: '说点什么？',
        aiKey: 'DeepSeek API Key',
        aiKeyHint: '用于 AI 分析；同样只存在本机配置文件里，不回显。',
        aiApiBase: 'AI 直连地址',
        aiApiBaseHint: 'DeepSeek 官方为 https://api.deepseek.com；填了 Key 且这里的地址或模型名改过（非默认）时，AI 分析直接走这个端点，不再用 DSH 内置模型。',
        aiModel: '直连模型名',
        aiModelHint: '默认 deepseek-chat；改过即优先直连（配合上面的地址，优先于 DSH 内置模型）。',
        deepseekBase: 'DeepSeek',
        kpi: '个指标',
      },
      en: {
        entry: 'Tencent Ads',
        title: 'Tencent Ads',
        subtitle: 'Delivery analysis · Griffin data',
        movedRight: 'The Tencent Ads panel opens in the right sidebar.',
        openRight: 'Open on the right',
        tabGriffin: 'Griffin data',
        settings: 'Settings',
        back: 'Back',
        refresh: 'Refresh',
        run: 'Run',
        running: 'Running…',
        account: 'Account',
        dateStart: 'Start',
        dateEnd: 'End',
        dim: 'Breakdown',
        dimDate: 'By day',
        dimSite: 'By placement',
        dimCreative: 'By creative',
        onlyActive: 'Include paused / historical units',
        pendingClear: 'will clear',
        emptyTitle: 'Pick a tool to begin',
        emptyHint: 'A run spawns the scripts in the tools directory; results render here. Credentials live in Settings.',
        emptyTool: 'No result yet — press Run.',
        noData: 'No data in this window',
        queryFailed: 'Query failed',
        alerts: 'Alerts',
        alertsNone: 'Nothing abnormal',
        warnings: 'Notes',
        copy: 'Copy table',
        copied: 'Copied',
        copyFailed: 'Copy failed',
        toolsDir: 'Bundled scripts',
        toolsDirHint: 'The eight .mjs files ship with the plugin; no external folder needed',
        tencentToken: 'Tencent Ads access_token',
        tencentTokenHint: 'Empty = keep; saved values are never echoed. If a legacy location still has one, it keeps being used',
        accountId: 'Advertiser account ID',
        accountIdHint: 'Required; the default account to query, and the seed used to list accounts from the platform',
        accountList: 'Account list (optional)',
        accountListHint: 'One per line: account ID, optionally followed by a space and a label. Listed accounts always appear in the account dropdown. A direct-advertiser token cannot enumerate every account, so add the others here or with Look up below.',
        platformAccounts: 'Authorized accounts',
        platformAccountsHint: 'Tencent Ads advertiser/get looks up one account ID at a time: a direct-advertiser token only returns that account, not every account you own. To see another account, enter its ID and look it up, or add it to the list above. Save a changed token first.',
        pullAccounts: 'Fetch from platform',
        pulling: 'Fetching…',
        lookupAccount: 'Look up',
        lookupPlaceholder: 'Account ID to look up',
        addToList: 'Add to list',
        added: 'Added',
        accountsUnit: 'accounts',
        accountsEmpty: 'The platform returned no account: check that this ID belongs to the current token (a direct-advertiser token only sees itself).',
        platformError: 'Platform error',
        refreshAccounts: 'Reload account list',
        accountNone: 'No account',
        acctSrcCredential: 'default',
        acctSrcManual: 'manual list',
        acctSrcKnown: 'legacy file',
        acctSrcAuthorized: 'authorized',
        grafanaUrl: 'Griffin URL',
        grafanaUser: 'Griffin user',
        grafanaPass: 'Griffin password',
        grafanaPassHint: 'Empty = keep; if a legacy location still has one, it keeps being used',
        dsMain: 'Main datasource UID',
        dsX7: 'X7 datasource UID',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        test: 'Test Griffin connection',
        testing: 'Testing…',
        testOk: 'Connected',
        testFail: 'Connection failed',
        clearPass: 'Clear saved password',
        clearToken: 'Clear saved token',
        source: 'Source',
        sourceConfig: 'Panel settings',
        sourceEnv: 'Environment',
        sourceEnvFile: 'Legacy .env.local',
        sourceCredFile: 'Repo credential file',
        sourceNone: 'Not configured',
        configFile: 'Config file',
        missing: 'Missing',
        weeklyMd: 'Export weekly Markdown',
        mdFailed: 'Export failed',
        queryGriffin: 'Build report',
        modules: 'Modules',
        customSql: 'Custom SQL',
        sqlPlaceholder: 'SELECT ... (single read-only statement)',
        execute: 'Execute',
        sqlEmpty: 'No result yet',
        rows: 'rows',
        elapsed: 'elapsed',
        asset: 'Creative preview',
        assetError: 'Cannot open this creative',
        close: 'Close',
        settingsHint: 'Credentials are stored in your local config file only — never in the plugin folder or a commit.',
        noToken: 'No token',
        sqlShow: 'SQL',
        allModules: 'All',
        settingsSavedHint: 'Save to apply; credentials take effect immediately.',
        envFallback: 'Values come from a legacy location; saving writes them into panel settings.',
        tabAi: 'AI analysis',
        aiSource: 'Data source',
        aiSourceReport: 'Current tab report',
        aiSourceGriffin: 'Griffin report',
        aiSourceSql: 'Custom SQL result',
        aiAskPlaceholder: 'Ask anything, e.g. which creative spent the most this week?',
        aiSend: 'Send',
        aiThinking: 'AI is thinking…',
        aiDataSnap: 'Data snapshot',
        aiDataDefault: 'Run any tool tab above once; that data becomes analyzable here.',
        aiDataNone: 'No data to analyze yet — run a tool or Griffin query first.',
        aiNoKeyHint: 'Add a DeepSeek API Key in Settings first.',
        aiDshReadyNote: 'Using DSH’s built-in DeepSeek model — no separate key needed.',
        aiHistoryHint: 'The AI uses the attached data snapshot plus this session chat, so you can follow up.',
        aiEmpty: 'Say something?',
        aiKey: 'DeepSeek API Key',
        aiKeyHint: 'Used by AI analysis; stored in your local config file, never echoed.',
        aiApiBase: 'AI direct base URL',
        aiApiBaseHint: 'Official is https://api.deepseek.com. With a key set and this URL or the model below changed from default, AI chat calls this endpoint directly — DSH’s built-in model is not used.',
        aiModel: 'Direct model name',
        aiModelHint: 'Default deepseek-chat; a changed value takes priority (direct call, over DSH’s built-in model).',
        kpi: 'KPIs',
        deepseekBase: 'DeepSeek',
      },
    }

    const SOURCE_LABEL = {
      config: 'sourceConfig',
      env: 'sourceEnv',
      'env-file': 'sourceEnvFile',
      'credential-file': 'sourceCredFile',
      none: 'sourceNone',
    }
    const ACCOUNT_SOURCE_LABEL = {
      credential: 'acctSrcCredential',
      manual: 'acctSrcManual',
      known: 'acctSrcKnown',
      authorized: 'acctSrcAuthorized',
    }

    /* ------------------------------------------------------------------ *
     * 样式（令牌优先，缺失时回退到中性色，浅色/深色都能看）
     * ------------------------------------------------------------------ */
    const CSS = `
.adp-page{display:flex;flex-direction:column;height:100%;min-height:0;box-sizing:border-box;
  background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,currentColor);}
.adp-bar{flex:none;display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  padding:10px 16px;border-bottom:0.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.2));}
.adp-title{font-size:14px;font-weight:600;line-height:20px;}
.adp-subtitle{font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption,#888);}
.adp-spacer{flex:1;}
.adp-tabs{display:flex;align-items:center;gap:2px;padding:2px;flex-wrap:wrap;
  border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-l2,rgba(127,127,127,.08));}
.adp-tab{border:none;border-radius:var(--dsw-radius-sm,6px);background:transparent;cursor:pointer;
  color:var(--dsw-alias-label-caption,#888);font:inherit;font-size:12px;line-height:18px;padding:4px 9px;white-space:nowrap;}
.adp-tab[data-active="true"]{background:var(--dsw-alias-bg-base,#fff);font-weight:600;
  color:var(--dsw-alias-label-primary,currentColor);box-shadow:0 1px 2px rgba(0,0,0,.08);}
.adp-tab:focus-visible,.adp-btn:focus-visible,.adp-primary:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{
  outline:2px solid var(--dsw-alias-state-business-primary,#247bbf);outline-offset:1px;}
.adp-btn{border:0.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.35));border-radius:var(--dsw-radius-md,8px);
  background:transparent;color:inherit;font:inherit;font-size:12px;line-height:18px;padding:4px 10px;cursor:pointer;}
.adp-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));}
.adp-btn[disabled]{opacity:.5;cursor:default;}
.adp-primary{border:none;border-radius:var(--dsw-radius-md,8px);cursor:pointer;font:inherit;
  font-size:13px;line-height:20px;padding:6px 16px;color:#fff;background:var(--dsw-alias-state-business-primary,#247bbf);}
.adp-primary[disabled]{opacity:.6;cursor:default;}
.adp-params{flex:none;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 16px;
  border-bottom:0.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.2));font-size:12px;}
.adp-field{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-caption,#888);}
.adp-input,.adp-select{border:0.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.35));
  border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:12px;line-height:18px;
  padding:3px 7px;min-width:0;}
.adp-input[type="date"]{width:132px;}
.adp-select{max-width:220px;}
.adp-body{flex:1;min-height:0;overflow:auto;padding:16px;}
.adp-center{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;}
.adp-center-title{font-size:14px;font-weight:600;}
.adp-center-hint{max-width:460px;font-size:12px;line-height:19px;color:var(--dsw-alias-label-caption,#888);}
.adp-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:8px;margin-bottom:12px;}
.adp-kpi{border:0.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.25));border-radius:10px;padding:9px 11px;
  border-left-width:3px;border-left-color:var(--dsw-alias-border-l3,rgba(127,127,127,.25));min-width:0;}
.adp-kpi-k{font-size:11px;line-height:15px;color:var(--dsw-alias-label-caption,#888);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.adp-kpi-v{font-size:17px;line-height:24px;font-weight:600;font-variant-numeric:tabular-nums;word-break:break-word;}
.adp-kpi-b{font-size:11px;line-height:15px;color:var(--dsw-alias-label-caption,#888);word-break:break-word;}
.tone-good,.tone-ok{color:#1a7f37;}
.tone-bad{color:#c93c37;}
.tone-warn{color:#9a6700;}
.tone-info{color:#0969da;}
.tone-dim,.tone-flat{color:var(--dsw-alias-label-caption,#888);}
.adp-kpi.tone-good,.adp-kpi.tone-ok{border-left-color:#1a7f37;}
.adp-kpi.tone-bad{border-left-color:#c93c37;}
.adp-kpi.tone-warn{border-left-color:#9a6700;}
.adp-kpi.tone-info{border-left-color:#0969da;}
.adp-box{border-radius:8px;padding:8px 11px;font-size:12px;line-height:19px;margin-bottom:10px;}
.adp-box-alert{background:rgba(201,60,55,.08);border:0.5px solid rgba(201,60,55,.35);color:#c93c37;}
.adp-box-warn{background:rgba(154,103,0,.07);border:0.5px solid rgba(154,103,0,.3);color:#9a6700;}
.adp-box-ok{background:rgba(26,127,55,.07);border:0.5px solid rgba(26,127,55,.28);color:#1a7f37;}
.adp-box-err{background:rgba(201,60,55,.08);border:0.5px solid rgba(201,60,55,.35);color:#c93c37;word-break:break-word;}
.adp-box b{font-weight:600;}
.adp-section{margin-bottom:18px;min-width:0;}
.adp-sec-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:6px;}
.adp-sec-head h3{margin:0;font-size:13px;font-weight:600;line-height:20px;}
.adp-sec-tip{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption,#888);}
.adp-sec-actions{margin-left:auto;display:flex;gap:6px;}
.adp-tablewrap{overflow:auto;border:0.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.25));border-radius:8px;}
.adp-table{border-collapse:collapse;width:100%;font-size:12px;line-height:18px;}
.adp-table th{position:sticky;top:0;background:var(--dsw-alias-bg-l2,#f6f7f8);font-weight:600;text-align:left;
  padding:6px 9px;white-space:nowrap;border-bottom:0.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.3));z-index:1;}
.adp-table td{padding:5px 9px;border-bottom:0.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.14));
  vertical-align:top;position:relative;white-space:nowrap;font-variant-numeric:tabular-nums;}
.adp-table tr:last-child td{border-bottom:none;}
.adp-table tfoot td{padding:6px 9px;font-weight:600;border-top:0.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.3));
  background:var(--dsw-alias-bg-l2,rgba(127,127,127,.05));}
.adp-group td{background:var(--dsw-alias-bg-l2,rgba(127,127,127,.06));font-weight:600;white-space:normal;}
.adp-group-note{font-weight:400;font-size:11px;color:var(--dsw-alias-label-caption,#888);margin-left:8px;}
.adp-emptyrow{color:var(--dsw-alias-label-caption,#888);text-align:center;padding:14px 0;}
.adp-cellsub{display:block;font-size:10px;line-height:13px;color:var(--dsw-alias-label-caption,#888);
  font-family:ui-monospace,Menlo,Consolas,monospace;word-break:break-all;}
.adp-mono-cell{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;}
.adp-strong{font-weight:600;}
.adp-cellbar{position:absolute;left:2px;top:3px;bottom:3px;border-radius:3px;background:currentColor;opacity:.13;
  pointer-events:none;}
.adp-cellin{position:relative;}
.adp-tag{display:inline-block;padding:0 6px;border-radius:999px;font-size:11px;line-height:17px;
  border:0.5px solid currentColor;opacity:.95;white-space:nowrap;}
.adp-link{border:none;background:transparent;color:var(--dsw-alias-state-business-primary,#247bbf);
  font:inherit;font-size:12px;padding:0;cursor:pointer;text-align:left;text-decoration:underline;
  text-decoration-style:dotted;text-underline-offset:2px;}
.adp-note{font-size:11px;line-height:17px;color:var(--dsw-alias-label-caption,#888);margin-top:6px;white-space:pre-wrap;}
.adp-notes{margin:0;padding-left:18px;font-size:12px;line-height:19px;}
.adp-notes li{margin-bottom:3px;}
.adp-list{list-style:none;margin:0;padding:0;}
.adp-list li{display:flex;align-items:flex-start;gap:9px;padding:7px 2px;
  border-bottom:0.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.14));position:relative;}
.adp-list li:last-child{border-bottom:none;}
.adp-list-no{flex:none;width:18px;height:18px;border-radius:50%;font-size:10px;line-height:18px;text-align:center;
  background:var(--dsw-alias-bg-l2,rgba(127,127,127,.12));color:var(--dsw-alias-label-caption,#888);}
.adp-list-main{flex:1;min-width:0;}
.adp-list-label{font-size:12px;font-weight:600;line-height:18px;word-break:break-word;}
.adp-list-sub{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption,#888);white-space:normal;}
.adp-list-value{flex:none;font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;}
.adp-rail{height:3px;border-radius:2px;background:currentColor;opacity:.35;margin-top:5px;max-width:100%;}
.adp-cfg{border:0.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.25));border-radius:8px;
  padding:9px 11px;margin-bottom:8px;font-size:12px;line-height:18px;}
.adp-cfg-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:3px;}
.adp-cfg-name{font-weight:600;}
.adp-cfg-id{font-size:11px;color:var(--dsw-alias-label-caption,#888);font-family:ui-monospace,Menlo,Consolas,monospace;}
.adp-cfg-line{color:var(--dsw-alias-label-caption,#888);white-space:pre-wrap;}
.adp-meta{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;line-height:16px;
  color:var(--dsw-alias-label-caption,#888);margin-top:6px;}
.adp-err{font-size:12px;line-height:18px;color:#c93c37;word-break:break-word;}
.adp-pre{margin:6px 0 0;padding:8px 10px;border-radius:6px;background:var(--dsw-alias-bg-l2,rgba(127,127,127,.08));
  font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;line-height:16px;white-space:pre-wrap;
  word-break:break-all;max-height:240px;overflow:auto;}
.adp-form{max-width:640px;}
.adp-form-row{display:flex;flex-direction:column;gap:4px;margin-bottom:14px;}
.adp-form-label{font-size:12px;font-weight:600;line-height:18px;}
.adp-form-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption,#888);}
.adp-form-input{width:100%;box-sizing:border-box;border:0.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.35));
  border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:12px;line-height:18px;padding:5px 8px;}
.adp-form-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px;}
.adp-chip{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;line-height:17px;
  border:0.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.35));color:var(--dsw-alias-label-caption,#888);}
.adp-chip-ok{color:#1a7f37;border-color:rgba(26,127,55,.5);}
.adp-chip-bad{color:#c93c37;border-color:rgba(201,60,55,.5);}
.adp-hr{border:none;border-top:0.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.2));margin:20px 0;}
.adp-check{display:inline-flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;}
.adp-textarea{width:100%;min-height:96px;box-sizing:border-box;border:0.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.35));
  border-radius:6px;background:transparent;color:inherit;font-family:ui-monospace,Menlo,Consolas,monospace;
  font-size:11px;line-height:16px;padding:7px 9px;resize:vertical;}
.adp-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;
  z-index:50;padding:24px;}
.adp-modal{background:var(--dsw-alias-bg-base,#fff);color:inherit;border-radius:12px;max-width:min(760px,92vw);
  max-height:88vh;overflow:auto;padding:14px 16px;box-shadow:0 12px 40px rgba(0,0,0,.35);min-width:280px;}
.adp-modal-head{display:flex;align-items:center;gap:10px;margin-bottom:10px;}
.adp-modal-title{font-size:13px;font-weight:600;flex:1;min-width:0;word-break:break-word;}
.adp-modal img,.adp-modal video{max-width:100%;max-height:66vh;display:block;border-radius:8px;background:#000;}
.adp-flash{font-size:12px;line-height:18px;}
.adp-ai{display:flex;flex-direction:column;gap:10px;}
.adp-ai-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
.adp-ai-select{border:0.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.35));border-radius:6px;
  background:transparent;color:inherit;font:inherit;font-size:12px;line-height:18px;padding:4px 8px;max-width:220px;}
.adp-ai-data{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption,#888);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px;}
.adp-ai-chat{display:flex;flex-direction:column;gap:8px;max-height:420px;overflow:auto;padding:2px;}
.adp-ai-msg{display:flex;flex-direction:column;gap:2px;max-width:85%;}
.adp-ai-msg-user{align-self:flex-end;align-items:flex-end;}
.adp-ai-msg-assist{align-self:flex-start;}
.adp-ai-who{font-size:10px;line-height:14px;color:var(--dsw-alias-label-caption,#888);padding:0 2px;}
.adp-ai-bubble{padding:7px 10px;border-radius:10px;font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-word;
  border:0.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.35));background:var(--dsw-alias-bg-l2,rgba(127,127,127,.08));}
.adp-ai-msg-user .adp-ai-bubble{border-bottom-right-radius:3px;}
.adp-ai-msg-assist .adp-ai-bubble{border-bottom-left-radius:3px;}
.adp-ai-thinking{color:var(--dsw-alias-label-caption,#888);font-size:12px;line-height:18px;}
.adp-ai-input{display:flex;gap:8px;align-items:flex-start;}
.adp-ai-textarea{flex:1;min-height:64px;max-height:180px;box-sizing:border-box;border:0.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.35));
  border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:12px;line-height:18px;padding:7px 9px;resize:vertical;}
`

    /* ------------------------------------------------------------------ *
     * 图标
     * ------------------------------------------------------------------ */
    function AdsIcon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M3.75 9.5v5a1.5 1.5 0 0 0 1.5 1.5h1.9l4.1 3.3a.9.9 0 0 0 1.5-.7V5.4a.9.9 0 0 0-1.5-.7L7.15 8H5.25a1.5 1.5 0 0 0-1.5 1.5Z',
          stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M16.6 8.6a4.8 4.8 0 0 1 0 6.8M19.2 6.2a8.3 8.3 0 0 1 0 11.6',
          stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round',
        }))
    }

    /* ------------------------------------------------------------------ *
     * 通信
     * ------------------------------------------------------------------ */
    function msgOf(err) {
      return err instanceof Error ? err.message : String(err)
    }

    async function post(route, body) {
      const res = await fetch(route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      let data = null
      try { data = await res.json() } catch { data = null }
      if (!data) throw new Error(`服务返回了非 JSON 内容（HTTP ${res.status}）`)
      return data
    }

    /* ------------------------------------------------------------------ *
     * 报告渲染（只认 Host 给的那一份模型）
     * ------------------------------------------------------------------ */
    const TONE_CLASS = {
      good: 'tone-good', ok: 'tone-ok', bad: 'tone-bad', warn: 'tone-warn',
      info: 'tone-info', dim: 'tone-dim', flat: 'tone-flat',
    }
    const toneClass = (tone) => (tone ? TONE_CLASS[tone] || '' : '')
    const cellText = (c) => (c == null ? '' : typeof c === 'object' ? String(c.t ?? '') : String(c))

    function Cell({ value, onAsset }) {
      if (value == null || value === '') return h('td', null, '')
      const c = typeof value === 'object' ? value : { t: String(value) }
      const cls = [toneClass(c.tone)]
      if (c.mono) cls.push('adp-mono-cell')
      if (c.strong) cls.push('adp-strong')
      const inner = []
      if (typeof c.bar === 'number') {
        inner.push(h('span', { key: 'bar', className: 'adp-cellbar', style: { width: `${Math.max(0, Math.min(1, c.bar)) * 100}%` } }))
      }
      if (c.link) {
        inner.push(h('button', {
          key: 't', type: 'button', className: 'adp-link', title: c.t, onClick: () => onAsset && onAsset(c.link),
        }, c.t))
      } else if (c.tag) {
        inner.push(h('span', { key: 't', className: 'adp-tag' }, c.t))
      } else {
        inner.push(h('span', { key: 't', className: 'adp-cellin' }, c.t))
      }
      if (c.sub) inner.push(h('span', { key: 's', className: 'adp-cellsub' }, c.sub))
      return h('td', { className: cls.filter(Boolean).join(' ') || undefined, title: c.title || undefined }, inner)
    }

    function tableTsv(sec) {
      const lines = [sec.columns.map((c) => c.label).join('\t')]
      const line = (row) => row.map(cellText).join('\t')
      if (sec.groups && sec.groups.length) {
        for (const g of sec.groups) {
          lines.push(`${g.label}${g.note ? ' ' + g.note : ''}`)
          for (const row of g.rows) lines.push(line(row))
        }
      } else {
        for (const row of sec.rows) lines.push(line(row))
      }
      if (sec.footer) lines.push(line(sec.footer))
      return lines.join('\n')
    }

    function CopyButton({ sec, t }) {
      const [state, setState] = React.useState('')
      const onClick = React.useCallback(() => {
        const done = (ok) => {
          setState(ok ? t('copied') : t('copyFailed'))
          setTimeout(() => setState(''), 1800)
        }
        try {
          const text = tableTsv(sec)
          if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => done(true), () => done(false))
          } else {
            done(false)
          }
        } catch {
          done(false)
        }
      }, [sec, t])
      return h('button', { type: 'button', className: 'adp-btn', onClick }, state || t('copy'))
    }

    function TableSection({ sec, t, onAsset }) {
      const body = []
      if (sec.groups && sec.groups.length) {
        for (const g of sec.groups) {
          body.push(h('tr', { key: `g:${g.label}`, className: 'adp-group' },
            h('td', { colSpan: sec.columns.length },
              g.label,
              g.note ? h('span', { className: 'adp-group-note' }, g.note) : null)))
          for (let i = 0; i < g.rows.length; i += 1) {
            body.push(h('tr', { key: `g:${g.label}:${i}` }, g.rows[i].map((c, j) => h(Cell, { key: j, value: c, onAsset }))))
          }
        }
      } else if (sec.rows && sec.rows.length) {
        for (let i = 0; i < sec.rows.length; i += 1) {
          body.push(h('tr', { key: i }, sec.rows[i].map((c, j) => h(Cell, { key: j, value: c, onAsset }))))
        }
      } else if (sec.empty) {
        body.push(h('tr', { key: 'empty' }, h('td', { colSpan: sec.columns.length, className: 'adp-emptyrow' }, sec.empty)))
      }

      return h('div', { className: 'adp-section' },
        h('div', { className: 'adp-sec-head' },
          h('h3', null, sec.title),
          sec.tip ? h('span', { className: 'adp-sec-tip' }, sec.tip) : null,
          h('span', { className: 'adp-sec-actions' }, h(CopyButton, { sec, t }))),
        h('div', { className: 'adp-tablewrap' },
          h('table', { className: 'adp-table' },
            h('thead', null, h('tr', null, sec.columns.map((c, i) => h('th', { key: i }, c.label)))),
            h('tbody', null, body),
            sec.footer ? h('tfoot', null, h('tr', null, sec.footer.map((c, i) => h(Cell, { key: i, value: c, onAsset })))) : null)),
        sec.note ? h('div', { className: 'adp-note' }, sec.note) : null)
    }

    function Section({ sec, t, onAsset }) {
      if (sec.kind === 'table') return h(TableSection, { sec, t, onAsset })
      if (sec.kind === 'kpis') {
        return h('div', { className: 'adp-section' },
          h('div', { className: 'adp-sec-head' }, h('h3', null, sec.title)),
          h('div', { className: 'adp-kpis' }, sec.items.map((k, i) => h(Kpi, { key: i, item: k }))))
      }
      if (sec.kind === 'notes') {
        return h('div', { className: 'adp-section' },
          h('div', { className: 'adp-sec-head' }, h('h3', null, sec.title)),
          h('ul', { className: 'adp-notes' }, sec.items.map((x, i) => h('li', { key: i }, x))))
      }
      if (sec.kind === 'list') {
        return h('div', { className: 'adp-section' },
          h('div', { className: 'adp-sec-head' },
            h('h3', null, sec.title),
            sec.tip ? h('span', { className: 'adp-sec-tip' }, sec.tip) : null),
          h('ul', { className: 'adp-list' }, sec.items.map((it, i) => h('li', { key: i },
            h('span', { className: 'adp-list-no' }, it.no),
            h('div', { className: 'adp-list-main' },
              h('div', { className: 'adp-list-label' },
                it.label,
                it.tag ? h('span', { className: 'adp-chip', style: { marginLeft: 6 } }, it.tag) : null),
              it.sub ? h('div', { className: 'adp-list-sub' }, it.sub) : null,
              typeof it.ratio === 'number' && it.ratio > 0
                ? h('div', {
                    className: toneClass(it.tone) || 'adp-rail',
                    style: { width: `${Math.max(2, Math.min(100, it.ratio * 100))}%`, height: 3, borderRadius: 2, marginTop: 5, background: 'currentColor', opacity: .35 },
                  })
                : null),
            h('span', { className: `adp-list-value ${toneClass(it.tone)}` }, it.value)))),
          sec.foot ? h('div', { className: 'adp-note' }, sec.foot) : null)
      }
      if (sec.kind === 'configs') {
        return h('div', { className: 'adp-section' },
          h('div', { className: 'adp-sec-head' },
            h('h3', null, sec.title),
            sec.tip ? h('span', { className: 'adp-sec-tip' }, sec.tip) : null),
          sec.items.map((it, i) => h('div', { key: i, className: 'adp-cfg' },
            h('div', { className: 'adp-cfg-head' },
              h('span', { className: 'adp-cfg-name' }, it.name || '—'),
              h('span', { className: 'adp-cfg-id' }, it.id),
              it.tag ? h('span', { className: 'adp-chip' }, it.tag) : null,
              it.expired ? h('span', { className: 'adp-chip adp-chip-bad' }, '已到期') : null),
            it.lines.map((ln, j) => h('div', { key: j, className: 'adp-cfg-line' }, ln)))))
      }
      return null
    }

    function Kpi({ item }) {
      return h('div', { className: `adp-kpi ${toneClass(item.tone)}`.trim() },
        h('div', { className: 'adp-kpi-k' }, item.k),
        h('div', { className: 'adp-kpi-v' }, item.v),
        item.b ? h('div', { className: 'adp-kpi-b' }, item.b) : null)
    }

    function Report({ res, t, onAsset, onExportMd }) {
      const model = res.model || {}
      const kpis = model.kpis || []
      const sections = model.sections || []
      return h('div', null,
        kpis.length ? h('div', { className: 'adp-kpis' }, kpis.map((k, i) => h(Kpi, { key: i, item: k }))) : null,

        model.alerts && model.alerts.length
          ? h('div', { className: 'adp-box adp-box-alert' },
              h('b', null, `⚠️ ${t('alerts')}`),
              h('div', null, model.alerts.map((a, i) => h('div', { key: i }, a))))
          : null,

        model.warnings && model.warnings.length
          ? h('div', { className: 'adp-box adp-box-warn' }, model.warnings.map((w, i) => h('div', { key: i }, w)))
          : null,

        sections.map((sec, i) => h(Section, { key: i, sec, t, onAsset })),

        h('div', { className: 'adp-meta' },
          res.account ? h('span', null, `${t('account')} ${res.account}`) : null,
          res.model?.subtitle ? h('span', null, res.model.subtitle) : null,
          res.ms != null ? h('span', null, `${t('elapsed')} ${res.ms} ms`) : null,
          res.at ? h('span', null, new Date(res.at).toLocaleString()) : null,
          model.actions?.weeklyMd
            ? h('button', { type: 'button', className: 'adp-btn', onClick: () => onExportMd(model.actions.weeklyMd) }, t('weeklyMd'))
            : null))
    }

    /* ------------------------------------------------------------------ *
     * 格里芬
     * ------------------------------------------------------------------ */
    function RawTable({ columns, rows }) {
      return h('div', { className: 'adp-tablewrap' },
        h('table', { className: 'adp-table' },
          h('thead', null, h('tr', null, (columns || []).map((c, i) => h('th', { key: i }, String(c))))),
          h('tbody', null, (rows || []).map((r, i) => h('tr', { key: i },
            r.map((v, j) => h('td', { key: j }, v == null ? '' : String(v))))))))
    }

    // 切走插件会卸载组件，状态放在模块里，回来时接着用（不重新查询）
    const SESSION = {
      cfg: null,
      tab: 'monitor',
      view: 'tools',
      params: null,
      results: {},
      accounts: [],
      seq: 0,
      latest: {},
      cfgPromise: null,
      listener: null,
      ready: false,
    }
    const AI = {
      kind: 'report',
      msgs: [], // [{ role: 'user'|'assistant', content }]
      seq: 0,
    }
    const GRIFFIN = {
      start: '',
      end: '',
      picked: null,
      res: null,
      err: '',
      sql: '',
      ds: 'main',
      sqlRes: null,
      seqReport: 0,
      seqSql: 0,
      listenerRes: null,
    }

    function GriffinView({ cfg, t, onOpenSettings }) {
      const range = cfg?.range || { start: '', end: '' }
      const modules = cfg?.griffinModules || []
      const [start, setStart] = React.useState(GRIFFIN.start || range.start)
      const [end, setEnd] = React.useState(GRIFFIN.end || range.end)
      const [picked, setPicked] = React.useState(() => GRIFFIN.picked || modules.slice(0, 1).map((m) => m.key))
      const [busy, setBusy] = React.useState(false)
      const [res, setRes] = React.useState(GRIFFIN.res)
      const [err, setErr] = React.useState(GRIFFIN.err)
      const [sql, setSql] = React.useState(GRIFFIN.sql)
      const [ds, setDs] = React.useState(GRIFFIN.ds)
      const [sqlBusy, setSqlBusy] = React.useState(false)
      const [sqlRes, setSqlRes] = React.useState(GRIFFIN.sqlRes)
      const missing = cfg?.config?.grafanaMissing || []

      React.useEffect(() => {
        GRIFFIN.start = start
        GRIFFIN.end = end
        GRIFFIN.picked = picked
        GRIFFIN.res = res
        GRIFFIN.err = err
        GRIFFIN.sql = sql
        GRIFFIN.ds = ds
        GRIFFIN.sqlRes = sqlRes
      }, [start, end, picked, res, err, sql, ds, sqlRes])

      React.useEffect(() => {
        GRIFFIN.listenerRes = setRes
        return () => { if (GRIFFIN.listenerRes === setRes) GRIFFIN.listenerRes = null }
      }, [])

      const publishRes = React.useCallback((v) => {
        GRIFFIN.res = v
        setRes(v)
        if (GRIFFIN.listenerRes && GRIFFIN.listenerRes !== setRes) GRIFFIN.listenerRes(v)
      }, [])

      React.useEffect(() => {
        setStart((v) => v || range.start)
        setEnd((v) => v || range.end)
      }, [range.start, range.end])

      React.useEffect(() => {
        if (!picked.length && modules.length) setPicked([modules[0].key])
      }, [modules, picked.length])

      const toggle = (key) => setPicked((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))

      const runReport = React.useCallback(async () => {
        const id = ++GRIFFIN.seqReport
        setBusy(true)
        setErr('')
        try {
          const r = await post('api/ad-tools/griffin/report', { start, end, modules: picked })
          if (GRIFFIN.seqReport !== id) return // 有更新的一次查询，丢弃这次结果
          GRIFFIN.err = r.ok ? '' : (r.error || 'failed')
          setErr(GRIFFIN.err)
          publishRes(r.ok ? r : null)
        } catch (e) {
          if (GRIFFIN.seqReport !== id) return
          GRIFFIN.err = msgOf(e)
          setErr(GRIFFIN.err)
        } finally {
          if (GRIFFIN.seqReport === id) setBusy(false)
        }
      }, [start, end, picked, publishRes])

      const runSql = React.useCallback(async () => {
        const id = ++GRIFFIN.seqSql
        setSqlBusy(true)
        try {
          const r = await post('api/ad-tools/griffin/sql', { sql, ds })
          if (GRIFFIN.seqSql !== id) return
          GRIFFIN.sqlRes = r
          setSqlRes(r)
        } catch (e) {
          if (GRIFFIN.seqSql !== id) return
          GRIFFIN.sqlRes = { ok: false, error: msgOf(e) }
          setSqlRes(GRIFFIN.sqlRes)
        } finally {
          if (GRIFFIN.seqSql === id) setSqlBusy(false)
        }
      }, [sql, ds])

      if (missing.length) {
        return h('div', { className: 'adp-center' },
          h('div', { className: 'adp-center-title' }, t('settings')),
          h('div', { className: 'adp-center-hint' },
            `${t('missing')}：${missing.map((k) => ({ GRAFANA_URL: 'URL', GRAFANA_USER: t('grafanaUser'), GRAFANA_PASS: t('grafanaPass') }[k] || k)).join('、')}`),
          h('button', { type: 'button', className: 'adp-primary', onClick: onOpenSettings }, t('settings')))
      }

      return h('div', null,
        h('div', { className: 'adp-params', style: { padding: 0, border: 'none', marginBottom: 14 } },
          h('label', { className: 'adp-field' }, t('dateStart'),
            h('input', { className: 'adp-input', type: 'date', value: start, onChange: (e) => setStart(e.target.value) })),
          h('label', { className: 'adp-field' }, t('dateEnd'),
            h('input', { className: 'adp-input', type: 'date', value: end, onChange: (e) => setEnd(e.target.value) })),
          h('button', { type: 'button', className: 'adp-primary', disabled: busy || !picked.length, onClick: runReport },
            busy ? t('running') : t('queryGriffin'))),

        h('div', { className: 'adp-section' },
          h('div', { className: 'adp-sec-head' }, h('h3', null, t('modules'))),
          h('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap' } },
            modules.map((m) => h('label', { key: m.key, className: 'adp-check' },
              h('input', { type: 'checkbox', checked: picked.includes(m.key), onChange: () => toggle(m.key) }),
              `${m.title}${m.ds === 'x7' ? ' · x7' : ''}`)))),

        err ? h('div', { className: 'adp-box adp-box-err' }, err) : null,

        res ? h('div', null, res.results.map((r) => h('div', { key: r.key, className: 'adp-section' },
          h('div', { className: 'adp-sec-head' },
            h('h3', null, r.title),
            h('span', { className: 'adp-sec-tip' },
              r.ok ? `${r.rows.length} ${t('rows')} · ${r.ms} ms` : t('queryFailed'))),
          r.ok
            ? h(RawTable, { columns: r.columns, rows: r.rows })
            : h('div', { className: 'adp-box adp-box-err' }, r.error),
          r.sql ? h('details', null,
            h('summary', { className: 'adp-sec-tip', style: { cursor: 'pointer' } }, t('sqlShow')),
            h('pre', { className: 'adp-pre' }, r.sql)) : null))) : null,

        h('hr', { className: 'adp-hr' }),

        h('div', { className: 'adp-section' },
          h('div', { className: 'adp-sec-head' },
            h('h3', null, t('customSql')),
            h('label', { className: 'adp-field' },
              h('select', { className: 'adp-select', value: ds, onChange: (e) => setDs(e.target.value) },
                h('option', { value: 'main' }, 'main'),
                h('option', { value: 'x7' }, 'x7'))),
            h('span', { className: 'adp-sec-actions' },
              h('button', { type: 'button', className: 'adp-btn', disabled: sqlBusy || !sql.trim(), onClick: runSql },
                sqlBusy ? t('running') : t('execute')))),
          h('textarea', {
            className: 'adp-textarea', value: sql, placeholder: t('sqlPlaceholder'),
            onChange: (e) => setSql(e.target.value),
          }),
          sqlRes
            ? (sqlRes.ok
                ? h('div', { style: { marginTop: 8 } }, h(RawTable, { columns: sqlRes.columns, rows: sqlRes.rows }))
                : h('div', { className: 'adp-box adp-box-err', style: { marginTop: 8 } }, sqlRes.error))
            : null))
    }

    /* ------------------------------------------------------------------ *
     * AI 分析
     * ------------------------------------------------------------------ */
    function AiView({ cfg, t, onOpenSettings }) {
      const c = cfg?.config || {}
      const dshAi = !!cfg?.dshAiReady
      // 可用的数据源：当前页签报告 / 格里芬报表 / 自定义 SQL 结果
      const reportRes = SESSION.results[SESSION.tab]
      const griffinRes = GRIFFIN.res
      const sqlRes = GRIFFIN.sqlRes
      const sources = []
      if (reportRes?.ok && reportRes.model) sources.push({ kind: 'report', label: t('aiSourceReport') })
      if (griffinRes?.ok && Array.isArray(griffinRes.results)) sources.push({ kind: 'griffin', label: t('aiSourceGriffin') })
      if (sqlRes?.ok) sources.push({ kind: 'sql', label: t('aiSourceSql') })

      const validKind = sources.some((s) => s.kind === AI.kind) ? AI.kind : (sources[0]?.kind || 'report')
      const [kind, setKind] = React.useState(validKind)
      const [msgs, setMsgs] = React.useState(AI.msgs)
      const [q, setQ] = React.useState('')
      const [busy, setBusy] = React.useState(false)

      React.useEffect(() => {
        // 数据源变化时落到模块缓存（切换插件后回来还记得选了哪个源）
        AI.kind = kind
      }, [kind])
      const noData = !sources.length

      const snap = React.useMemo(() => {
        try {
          if (kind === 'griffin' && griffinRes?.ok && Array.isArray(griffinRes.results)) {
            const n = griffinRes.results.reduce((sum, r) => sum + (r.ok ? (r.rows?.length || 0) : 0), 0)
            return `${griffinRes.results.length} ${t('modules')} · ${n} ${t('rows')}`
          }
          if (kind === 'sql' && sqlRes?.ok) {
            return `${sqlRes.columns?.length || 0} 列 · ${sqlRes.rows?.length || 0} ${t('rows')}`
          }
          if (reportRes?.model) {
            return `${reportRes.model.title || ''}${reportRes.model.kpis?.length ? ` · ${reportRes.model.kpis.length} ${t('kpi')}` : ''}`
          }
        } catch { /* 落空也给出兜底 */ }
        return ''
      }, [kind, reportRes, griffinRes, sqlRes, t])

      const send = React.useCallback(async () => {
        const question = q.trim()
        if (!question || busy) return
        let data = null
        if (kind === 'griffin' && griffinRes?.ok) data = griffinRes.results
        else if (kind === 'sql' && sqlRes?.ok) data = sqlRes
        else if (reportRes?.model) data = reportRes.model
        if (data == null) return
        const id = ++AI.seq
        const history = AI.msgs.slice(-20).map((m) => ({ role: m.role, content: m.content }))
        AI.msgs = [...AI.msgs, { role: 'user', content: question }]
        setMsgs(AI.msgs)
        setQ('')
        setBusy(true)
        try {
          const r = await post('api/ad-tools/ai/chat', { kind, question, history, data })
          if (AI.seq !== id) return
          const content = r.ok ? r.reply : `⚠️ ${r.error || '分析失败'}`
          AI.msgs = [...AI.msgs, { role: 'assistant', content }]
          setMsgs(AI.msgs)
        } catch (e) {
          if (AI.seq !== id) return
          AI.msgs = [...AI.msgs, { role: 'assistant', content: `⚠️ ${msgOf(e)}` }]
          setMsgs(AI.msgs)
        } finally {
          if (AI.seq === id) setBusy(false)
        }
      }, [q, busy, kind, reportRes, griffinRes, sqlRes])

      return h('div', { className: 'adp-ai' },
        // 数据源
        h('div', { className: 'adp-ai-toolbar' },
          h('label', { className: 'adp-field' }, t('aiSource'),
            h('select', { className: 'adp-ai-select', value: kind, onChange: (e) => setKind(e.target.value) },
              sources.map((s) => h('option', { key: s.kind, value: s.kind }, s.label)),
              !sources.length ? h('option', { value: 'report' }, t('aiSourceReport')) : null)),
          sources.length ? h('span', { className: 'adp-ai-data', title: snap }, `${t('aiDataSnap')}：${snap}`) : null),

        noData
          ? h('div', { className: 'adp-box adp-note' }, t('aiDataNone'))
          : !c.hasDeepseekKey && !dshAi
            ? h('div', { className: 'adp-box adp-box-err' },
                t('aiNoKeyHint'),
                onOpenSettings ? h('button', {
                  type: 'button', className: 'adp-btn', style: { marginLeft: 8 },
                  onClick: (e) => { e.stopPropagation(); onOpenSettings() },
                }, t('settings')) : null)
            : !c.hasDeepseekKey
              ? h('div', { className: 'adp-box adp-note' }, t('aiDshReadyNote'))
              : null,

        // 对话
        h('div', { className: 'adp-ai-chat', ref: (el) => { if (el) el.scrollTop = el.scrollHeight } },
          msgs.map((m, i) => h('div', { key: i, className: `adp-ai-msg adp-ai-msg-${m.role === 'user' ? 'user' : 'assist'}` },
            h('span', { className: 'adp-ai-who' }, m.role === 'user' ? '你' : deepseekLabel()),
            h('div', { className: 'adp-ai-bubble' }, m.content))),
          busy ? h('div', { className: 'adp-ai-msg adp-ai-msg-assist' },
            h('div', { className: 'adp-ai-thinking' }, t('aiThinking'))) : null,
          !msgs.length && !busy && sources.length
            ? h('div', { className: 'adp-ai-msg adp-ai-msg-assist' },
                h('div', { className: 'adp-ai-bubble adp-ai-thinking' }, t('aiHistoryHint')))
            : null),

        // 输入
        h('div', { className: 'adp-ai-input' },
          h('textarea', {
            className: 'adp-ai-textarea', value: q, placeholder: t('aiAskPlaceholder'),
            onChange: (e) => setQ(e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
            },
            disabled: !sources.length || (!c.hasDeepseekKey && !dshAi) || busy,
          }),
          h('button', { type: 'button', className: 'adp-primary', disabled: busy || !q.trim(), onClick: () => send() },
            busy ? t('aiThinking') : t('aiSend')))
      )
    }
    const deepseekLabel = () => 'DeepSeek'

    /* ------------------------------------------------------------------ *
     * 设置
     * ------------------------------------------------------------------ */
    function Field({ label, hint, children }) {
      return h('div', { className: 'adp-form-row' },
        h('div', { className: 'adp-form-label' }, label),
        children,
        hint ? h('div', { className: 'adp-form-hint' }, hint) : null)
    }

    // 账户列表在设置里按「一行一个」编辑，保存时解析成 [{ id, name }]
    const listToText = (list) => (Array.isArray(list) ? list : [])
      .map((a) => (a && typeof a === 'object' ? `${a.id}${a.name ? ` ${a.name}` : ''}` : String(a || '')))
      .filter(Boolean)
      .join('\n')
    const textToList = (text) => String(text || '').split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const m = l.match(/^(\d{5,12})\s+(.+)$/)
        // 认不出来的行也原样提交，让后端报「第几项不对」，而不是在界面上悄悄吞掉
        return m ? { id: m[1], name: m[2].trim() } : { id: l }
      })

    function Settings({ cfg, t, onSaved, onBack }) {
      const c = cfg?.config || {}
      const [form, setForm] = React.useState({
        adToolsDir: c.adToolsDir || '',
        grafanaUrl: c.grafanaUrl || '',
        grafanaUser: c.grafanaUser || '',
        grafanaPass: '',
        tencentToken: '',
        accountId: c.accountId || '',
        accountListText: listToText(c.accountList),
        dsMain: c.dsMain || '',
        dsX7: c.dsX7 || '',
        deepseekKey: '',
        deepseekApiBase: c.deepseekApiBase || 'https://api.deepseek.com',
        deepseekModel: c.deepseekModel || 'deepseek-chat',
      })
      const [clear, setClear] = React.useState([])
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState('')
      const [err, setErr] = React.useState('')
      const [test, setTest] = React.useState(null)
      const [testing, setTesting] = React.useState(false)

      const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

      /* 从平台拉账户：用的是已保存的 token / 默认账户，所以改完先保存再拉 */
      const [acct, setAcct] = React.useState(null)
      const [acctBusy, setAcctBusy] = React.useState(false)
      const [lookupId, setLookupId] = React.useState('')
      // 不传 id = 拉默认账户并补全手动列表；传 id = 单独查这个账户
      const pullAccounts = React.useCallback(async (id) => {
        const acctId = typeof id === 'string' ? id.trim() : ''
        setAcctBusy(true)
        try {
          const r = await post('api/ad-tools/accounts', acctId ? { account_id: acctId } : { enrich: true })
          setAcct(r && typeof r === 'object' ? r : { ok: false, error: 'no response' })
        } catch (e) {
          setAcct({ ok: false, error: msgOf(e) })
        } finally {
          setAcctBusy(false)
        }
      }, [])
      const inList = (id) => form.accountListText.split(/\r?\n/).some((l) => l.trim().split(/\s+/)[0] === id)
      const addToList = (a) => setForm((f) => {
        const lines = f.accountListText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
        if (lines.some((l) => l.split(/\s+/)[0] === a.id)) return f
        const label = a.name && !a.name.startsWith('(') ? ` ${a.name}` : ''
        return { ...f, accountListText: [...lines, `${a.id}${label}`].join('\n') }
      })

      const save = React.useCallback(async () => {
        setBusy(true)
        setErr('')
        setMsg('')
        try {
          const { accountListText, ...rest } = form
          const body = { ...rest, accountList: textToList(accountListText), clear }
          if (!body.grafanaPass) delete body.grafanaPass
          if (!body.tencentToken) delete body.tencentToken
          if (!body.deepseekKey) delete body.deepseekKey
          const r = await post('api/ad-tools/config/save', body)
          if (!r.ok) {
            setErr(r.error || 'failed')
          } else {
            setMsg(t('saved'))
            // 服务端会去重并归一，回填一次让界面上看到最终存的列表
            setForm((f) => ({
              ...f, grafanaPass: '', tencentToken: '', deepseekKey: '',
              accountListText: listToText(r.config?.accountList),
            }))
            setClear([])
            onSaved(r.config)
          }
        } catch (e) {
          setErr(msgOf(e))
        } finally {
          setBusy(false)
        }
      }, [form, clear, t, onSaved])

      const runTest = React.useCallback(async () => {
        setTesting(true)
        setTest(null)
        try {
          setTest(await post('api/ad-tools/griffin/test', {}))
        } catch (e) {
          setTest({ ok: false, error: msgOf(e) })
        } finally {
          setTesting(false)
        }
      }, [])

      const markClear = (key) => setClear((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
      const src = (key) => t(SOURCE_LABEL[key] || 'sourceNone')

      return h('div', { className: 'adp-form' },
        h('div', { className: 'adp-form-actions' },
          h('h3', { style: { margin: 0, fontSize: 13 } }, t('settings')),
          h('span', { className: 'adp-spacer' }),
          h('button', { type: 'button', className: 'adp-btn', onClick: onBack }, t('back'))),

        h('div', { className: 'adp-box adp-box-ok', style: { color: 'inherit', background: 'transparent', borderColor: 'rgba(127,127,127,.3)' } },
          t('settingsHint')),

        h(Field, { label: t('toolsDir'), hint: t('toolsDirHint') },
          h('input', { className: 'adp-form-input', value: form.adToolsDir, readOnly: true, title: t('toolsDirHint') })),

        h(Field, {
          label: t('tencentToken'),
          hint: `${t('tencentTokenHint')} · ${t('source')}：${src(c.tencentSource)}`,
        },
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            h('input', {
              className: 'adp-form-input', type: 'password', value: form.tencentToken,
              placeholder: c.hasTencentToken ? '••••••••' : '', onChange: set('tencentToken'), autoComplete: 'off',
            }),
            c.hasTencentToken
              ? h('button', {
                  type: 'button',
                  className: `adp-btn ${clear.includes('tencentToken') ? 'adp-chip-bad' : ''}`,
                  onClick: () => markClear('tencentToken'),
                  title: clear.includes('tencentToken') ? t('pendingClear') : undefined,
                }, clear.includes('tencentToken') ? `${t('clearToken')} · ${t('pendingClear')}` : t('clearToken'))
              : h('span', { className: 'adp-chip' }, t('noToken')))),

        h(Field, { label: t('accountId'), hint: t('accountIdHint') },
          h('input', { className: 'adp-form-input', value: form.accountId, onChange: set('accountId'), inputMode: 'numeric' })),
        h(Field, { label: t('accountList'), hint: t('accountListHint') },
          h('textarea', {
            className: 'adp-form-input', rows: 4, value: form.accountListText, onChange: set('accountListText'),
            spellCheck: false, autoComplete: 'off',
            style: { height: 84, resize: 'vertical', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: 1.5 },
          })),
        h(Field, { label: t('platformAccounts'), hint: t('platformAccountsHint') },
          h('div', null,
            h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' } },
              h('button', { type: 'button', className: 'adp-btn', disabled: acctBusy, onClick: () => pullAccounts() },
                acctBusy ? t('pulling') : t('pullAccounts')),
              h('input', {
                className: 'adp-form-input',
                value: lookupId,
                placeholder: t('lookupPlaceholder'),
                inputMode: 'numeric',
                autoComplete: 'off',
                style: { maxWidth: 180 },
                onChange: (e) => setLookupId(e.target.value),
                onKeyDown: (e) => {
                  if (e.key === 'Enter') { e.preventDefault(); pullAccounts(lookupId) }
                },
              }),
              h('button', {
                type: 'button',
                className: 'adp-btn',
                disabled: acctBusy || !/^\d{5,12}$/.test(lookupId.trim()),
                onClick: () => pullAccounts(lookupId),
              }, t('lookupAccount')),
              acct?.ok && Array.isArray(acct.accounts)
                ? h('span', { className: 'adp-chip' }, `${acct.accounts.length} ${t('accountsUnit')}`)
                : null),
            acct && acct.ok === false
              ? h('div', { className: 'adp-box adp-box-err' }, acct.error || t('queryFailed'))
              : null,
            acct?.apiError
              ? h('div', { className: 'adp-box adp-box-warn' }, `${t('platformError')}：${acct.apiError}`)
              : null,
            acct?.ok && Array.isArray(acct.accounts)
              ? (acct.accounts.length
                  ? h('div', { style: { borderTop: '1px solid rgba(127,127,127,.2)' } },
                      acct.accounts.map((a) => h('div', {
                        key: a.id,
                        style: { display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', borderBottom: '1px solid rgba(127,127,127,.15)', fontSize: 12 },
                      },
                        h('code', { style: { minWidth: 92 } }, a.id),
                        h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, a.name || '—'),
                        a.status ? h('span', { className: 'adp-chip' }, a.status) : null,
                        ACCOUNT_SOURCE_LABEL[a.source]
                          ? h('span', { className: 'adp-chip' }, t(ACCOUNT_SOURCE_LABEL[a.source]))
                          : null,
                        h('button', {
                          type: 'button',
                          className: 'adp-btn',
                          disabled: inList(a.id),
                          onClick: () => addToList(a),
                        }, inList(a.id) ? t('added') : t('addToList')))))
                  : h('div', { className: 'adp-form-hint' }, t('accountsEmpty')))
              : null,
          )),

        h('hr', { className: 'adp-hr' }),

        h(Field, { label: t('grafanaUrl'), hint: `${t('source')}：${src(c.grafanaSource)}` },
          h('input', { className: 'adp-form-input', value: form.grafanaUrl, onChange: set('grafanaUrl'), placeholder: 'http://host:3000' })),
        h(Field, { label: t('grafanaUser') },
          h('input', { className: 'adp-form-input', value: form.grafanaUser, onChange: set('grafanaUser'), autoComplete: 'off' })),
        h(Field, { label: t('grafanaPass'), hint: t('grafanaPassHint') },
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            h('input', {
              className: 'adp-form-input', type: 'password', value: form.grafanaPass,
              placeholder: c.hasGrafanaPass ? '••••••••' : '', onChange: set('grafanaPass'), autoComplete: 'off',
            }),
            c.hasGrafanaPass
              ? h('button', {
                  type: 'button',
                  className: `adp-btn ${clear.includes('grafanaPass') ? 'adp-chip-bad' : ''}`,
                  onClick: () => markClear('grafanaPass'),
                  title: clear.includes('grafanaPass') ? t('pendingClear') : undefined,
                }, clear.includes('grafanaPass') ? `${t('clearPass')} · ${t('pendingClear')}` : t('clearPass'))
              : null)),
        h(Field, { label: `${t('dsMain')} / ${t('dsX7')}` },
          h('div', { style: { display: 'flex', gap: 8 } },
            h('input', { className: 'adp-form-input', value: form.dsMain, onChange: set('dsMain') }),
            h('input', { className: 'adp-form-input', value: form.dsX7, onChange: set('dsX7') }))),

        h('hr', { className: 'adp-hr' }),

        h(Field, { label: t('aiKey'), hint: `${t('aiKeyHint')} · ${t('deepseekBase')}` },
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            h('input', {
              className: 'adp-form-input', type: 'password', value: form.deepseekKey,
              placeholder: c.hasDeepseekKey ? '••••••••' : '', onChange: set('deepseekKey'), autoComplete: 'off',
            }),
            c.hasDeepseekKey
              ? h('button', {
                  type: 'button',
                  className: `adp-btn ${clear.includes('deepseekKey') ? 'adp-chip-bad' : ''}`,
                  onClick: () => markClear('deepseekKey'),
                  title: clear.includes('deepseekKey') ? t('pendingClear') : undefined,
                }, clear.includes('deepseekKey') ? `${t('clearToken')} · ${t('pendingClear')}` : t('clearToken'))
              : null)),
        h(Field, { label: t('aiApiBase'), hint: t('aiApiBaseHint') },
          h('input', { className: 'adp-form-input', value: form.deepseekApiBase, onChange: set('deepseekApiBase'), placeholder: 'https://api.deepseek.com', autoComplete: 'off' })),
        h(Field, { label: t('aiModel'), hint: t('aiModelHint') },
          h('input', { className: 'adp-form-input', value: form.deepseekModel, onChange: set('deepseekModel'), autoComplete: 'off' })),

        h('div', { className: 'adp-form-actions' },
          h('button', { type: 'button', className: 'adp-primary', disabled: busy, onClick: save }, busy ? t('saving') : t('save')),
          h('button', { type: 'button', className: 'adp-btn', disabled: testing, onClick: runTest }, testing ? t('testing') : t('test')),
          msg ? h('span', { className: 'adp-flash tone-good' }, `✓ ${msg}`) : null,
          err ? h('span', { className: 'adp-flash adp-err' }, err) : null),

        test
          ? h('div', { className: `adp-box ${test.ok ? 'adp-box-ok' : 'adp-box-err'}` },
              test.ok
                ? `${t('testOk')} · ${test.url} · ${test.user}`
                : `${t('testFail')}：${test.error || ''}`)
          : null,

        h('div', { className: 'adp-note' },
          `${t('configFile')}：${c.configFile || ''}`,
          c.grafanaMissing && c.grafanaMissing.length
            ? `\n${t('missing')}：${c.grafanaMissing.join('、')}`
            : ''))
    }

    /* ------------------------------------------------------------------ *
     * 素材预览弹窗
     * ------------------------------------------------------------------ */
    function AssetModal({ state, t, onClose }) {
      const asset = state.asset || {}
      return h('div', { className: 'adp-overlay', onClick: onClose, role: 'presentation' },
        h('div', { className: 'adp-modal', onClick: (e) => e.stopPropagation(), role: 'dialog', 'aria-modal': 'true' },
          h('div', { className: 'adp-modal-head' },
            h('span', { className: 'adp-modal-title' }, state.name || t('asset')),
            h('button', { type: 'button', className: 'adp-btn', onClick: onClose }, t('close'))),
          state.loading ? h('div', { className: 'adp-flash' }, t('running')) : null,
          state.error ? h('div', { className: 'adp-box adp-box-err' }, `${t('assetError')}：${state.error}`) : null,
          asset.url && asset.type === '视频'
            ? h('video', { src: asset.url, poster: asset.cover || undefined, controls: true, autoPlay: true, playsInline: true })
            : null,
          asset.url && asset.type !== '视频'
            ? h('img', { src: asset.url, alt: asset.name || '' })
            : null,
          asset.url
            ? h('div', { className: 'adp-meta' },
                h('span', null, asset.type || ''),
                asset.width ? h('span', null, `${asset.width}×${asset.height || '?'}`) : null,
                h('a', { className: 'adp-btn', href: asset.url, target: '_blank', rel: 'noreferrer' }, '在新窗口打开'))
            : null))
    }

    /* ------------------------------------------------------------------ *
     * 主面板
     * ------------------------------------------------------------------ */
    function Panel() {
      const t = tRef.t
      const [cfg, setCfg] = React.useState(SESSION.cfg)
      const [bootErr, setBootErr] = React.useState('')
      const [tab, setTab] = React.useState(SESSION.tab)
      const [view, setView] = React.useState(SESSION.view)
      const [params, setParams] = React.useState(SESSION.params || { start: '', end: '', dim: 'date', all: false, account: '' })
      const [results, setResults] = React.useState(SESSION.results)
      const [busy, setBusy] = React.useState(false)
      const [accounts, setAccounts] = React.useState(SESSION.accounts)
      const [asset, setAsset] = React.useState(null)
      const booted = React.useRef(false)
      const paramsRef = React.useRef(params)
      paramsRef.current = params
      const inflight = React.useRef(0)

      // 切走插件、面板卸载后这些状态也留着，回来直接接着看
      // （日期参数只在启动拿到真实窗口后才存，免得把空壳参数当成"已初始化"）
      React.useEffect(() => {
        SESSION.tab = tab
        SESSION.view = view
        SESSION.accounts = accounts
        if (SESSION.ready) SESSION.params = params
      }, [tab, view, params, accounts])

      // 面板重新挂载后接管结果通知：请求回来时就算上一次的实例已卸载，数据也会显示出来
      React.useEffect(() => {
        SESSION.listener = setResults
        return () => { if (SESSION.listener === setResults) SESSION.listener = null }
      }, [])

      // 结果直接写进模块缓存：就算请求回来时面板已被卸载，数据也不会丢
      const commitResult = React.useCallback((key, val) => {
        SESSION.results = { ...SESSION.results, [key]: val }
        setResults(SESSION.results)
        if (SESSION.listener && SESSION.listener !== setResults) SESSION.listener(SESSION.results)
      }, [])

      const run = React.useCallback(async (key, override) => {
        const p = override || paramsRef.current
        const id = (SESSION.seq += 1)
        SESSION.latest[key] = id
        inflight.current += 1
        setBusy(true)
        const commit = (val) => {
          if (SESSION.latest[key] !== id) return // 同一工具有更新的请求，丢弃旧结果
          commitResult(key, val)
        }
        try {
          const r = await post('api/ad-tools/run', {
            tool: key,
            start: p.start,
            end: p.end,
            dim: p.dim,
            all: p.all ? 1 : 0,
            account_id: p.account,
          })
          commit({ ...r, tool: key, at: Date.now() })
        } catch (e) {
          commit({ ok: false, tool: key, error: msgOf(e), at: Date.now() })
        } finally {
          inflight.current = Math.max(0, inflight.current - 1)
          if (inflight.current === 0) setBusy(false)
        }
      }, [commitResult])

      // 账户下拉：设置里保存后重新拉一次；如果当前选中的账户已不在列表里，回落到默认账户
      const refreshAccounts = React.useCallback(() => {
        post('api/ad-tools/accounts').then((a) => {
          if (!a || !a.ok || !Array.isArray(a.accounts)) return
          SESSION.accounts = a.accounts
          setAccounts(a.accounts)
          setParams((p) => {
            if (!a.accounts.length || a.accounts.some((x) => x.id === p.account)) return p
            const pick = a.accounts.find((x) => x.id === (a.default || '')) || a.accounts[0]
            const next = { ...p, account: pick.id }
            SESSION.params = next
            return next
          })
        }).catch(() => {})
      }, [])

      React.useEffect(() => {
        if (booted.current) return
        booted.current = true
        // 配置请求在模块里共享：切换插件时新旧两次挂载不会各查一遍
        if (!SESSION.cfgPromise) SESSION.cfgPromise = post('api/ad-tools/config')
        SESSION.cfgPromise.then((r) => {
          if (!r.ok) { SESSION.cfgPromise = null; setBootErr(r.error || 'failed'); return }
          setBootErr('')
          SESSION.cfg = r
          setCfg(r)
          // 只有第一次（还没有参数）才自动拉盯盘；切回插件时恢复上次的结果，不重新查询
          if (!SESSION.params) {
            const p = {
              start: r.range?.start || '',
              end: r.range?.end || '',
              dim: 'date',
              all: false,
              // 没有默认账户时先用手动列表的第一个，别让首次自动查询空跑
              account: r.config?.accountId || r.config?.accountList?.[0]?.id || '',
            }
            SESSION.ready = true
            SESSION.params = p
            setParams(p)
            run('monitor', p)
          }
          refreshAccounts()
        }).catch((e) => {
          SESSION.cfgPromise = null // 失败就允许下次挂载重试
          setBootErr(msgOf(e))
        })
      }, [run, refreshAccounts])

      const openAsset = React.useCallback(async (link) => {
        setAsset({ name: link.name, loading: true })
        try {
          const r = await post('api/ad-tools/asset', { creative_id: link.creativeId, account_id: paramsRef.current.account })
          setAsset(r.ok ? { name: link.name, asset: r.asset } : { name: link.name, error: r.error })
        } catch (e) {
          setAsset({ name: link.name, error: msgOf(e) })
        }
      }, [])

      const exportMd = React.useCallback(async (payload) => {
        try {
          const r = await post('api/ad-tools/weekly-md', payload)
          if (!r.ok) { setBootErr(r.error || t('mdFailed')); return }
          const blob = new Blob([r.text || ''], { type: 'text/markdown;charset=utf-8' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `周报_${payload.start}_${payload.end}.md`
          a.click()
          setTimeout(() => URL.revokeObjectURL(url), 1000)
        } catch (e) {
          setBootErr(msgOf(e))
        }
      }, [t])

      const tools = cfg?.tools || []
      const toolLabel = (key) => {
        const meta = tools.find((x) => x.key === key)
        return meta ? meta.label : key
      }
      const res = results[tab] || null
      const hasDates = tab !== 'monitor'
      const setParam = (key) => (e) => setParams((p) => ({ ...p, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

      const tabs = h('div', { className: 'adp-tabs', role: 'tablist' },
        tools.map((x) => h('button', {
          key: x.key,
          role: 'tab',
          type: 'button',
          'aria-selected': tab === x.key && view === 'tools' ? 'true' : 'false',
          className: 'adp-tab',
          'data-active': tab === x.key && view === 'tools' ? 'true' : 'false',
          title: x.desc,
          onClick: () => { setView('tools'); setTab(x.key) },
        }, x.label)),
        h('button', {
          type: 'button',
          role: 'tab',
          'aria-selected': view === 'griffin' ? 'true' : 'false',
          className: 'adp-tab',
          'data-active': view === 'griffin' ? 'true' : 'false',
          onClick: () => setView('griffin'),
        }, t('tabGriffin')),
        h('button', {
          type: 'button',
          role: 'tab',
          'aria-selected': view === 'ai' ? 'true' : 'false',
          className: 'adp-tab',
          'data-active': view === 'ai' ? 'true' : 'false',
          onClick: () => setView('ai'),
        }, t('tabAi')))

      const paramsBar = view === 'tools'
        ? h('div', { className: 'adp-params' },
            hasDates ? h(React.Fragment, null,
              h('label', { className: 'adp-field' }, t('dateStart'),
                h('input', { className: 'adp-input', type: 'date', value: params.start, onChange: setParam('start') })),
              h('label', { className: 'adp-field' }, t('dateEnd'),
                h('input', { className: 'adp-input', type: 'date', value: params.end, onChange: setParam('end') }))) : null,
            tab === 'retention'
              ? h('label', { className: 'adp-field' }, t('dim'),
                  h('select', { className: 'adp-select', value: params.dim, onChange: setParam('dim') },
                    h('option', { value: 'date' }, t('dimDate')),
                    h('option', { value: 'site_set' }, t('dimSite')),
                    h('option', { value: 'dynamic_creative_id' }, t('dimCreative'))))
              : null,
            tab === 'targeting'
              ? h('label', { className: 'adp-check' },
                  h('input', { type: 'checkbox', checked: params.all, onChange: setParam('all') }),
                  t('onlyActive'))
              : null,
            h('div', { className: 'adp-field' }, t('account'),
              accounts.length
                ? h('select', { className: 'adp-select', value: params.account, onChange: setParam('account') },
                    accounts.map((a) => h('option', { key: a.id, value: a.id },
                      `${a.id}${a.name ? ` ${a.name}` : ''}`)))
                : h('span', { className: 'adp-chip' }, t('accountNone')),
              h('button', {
                type: 'button',
                className: 'adp-btn',
                title: t('refreshAccounts'),
                'aria-label': t('refreshAccounts'),
                disabled: busy,
                onClick: refreshAccounts,
              }, '↻')),
            h('button', { type: 'button', className: 'adp-primary', disabled: busy, onClick: () => run(tab) },
              busy ? t('running') : t('run')),
            busy ? h('span', { className: 'adp-sec-tip' }, t('running')) : null)
        : null

      let body = null
      if (bootErr) {
        body = h('div', { className: 'adp-box adp-box-err' }, bootErr)
      } else if (!cfg) {
        body = h('div', { className: 'adp-center' }, h('div', { className: 'adp-center-title' }, t('running')))
      } else if (view === 'settings') {
        body = h(Settings, {
          cfg,
          t,
          onBack: () => setView('tools'),
          onSaved: (next) => {
            setCfg((prev) => ({ ...(prev || {}), config: next }))
            setParams((p) => ({ ...p, account: next.accountId || next.accountList?.[0]?.id || p.account }))
            refreshAccounts()
          },
        })
      } else if (view === 'griffin') {
        body = h(GriffinView, { cfg, t, onOpenSettings: () => setView('settings') })
      } else if (view === 'ai') {
        body = h(AiView, { cfg, t, onOpenSettings: () => setView('settings') })
      } else if (res === null) {
        body = h('div', { className: 'adp-center' },
          h('div', { className: 'adp-center-title' }, toolLabel(tab)),
          h('div', { className: 'adp-center-hint' }, t('emptyTool')),
          h('button', { type: 'button', className: 'adp-primary', disabled: busy, onClick: () => run(tab) },
            busy ? t('running') : t('run')))
      } else if (res.ok === false) {
        body = h('div', null,
          h('div', { className: 'adp-box adp-box-err' },
            h('b', null, `${t('queryFailed')}：`),
            res.error || ''),
          res.detail ? h('pre', { className: 'adp-pre' }, res.detail) : null)
      } else {
        body = h(Report, { res, t, onAsset: openAsset, onExportMd: exportMd })
      }

      return h('div', { className: 'adp-page' },
        h('style', null, CSS),
        h('div', { className: 'adp-bar' },
          h('span', { className: 'adp-title' }, t('title')),
          h('span', { className: 'adp-subtitle' }, t('subtitle')),
          h('span', { className: 'adp-spacer' }),
          h('button', {
            type: 'button',
            className: 'adp-btn',
            onClick: () => setView(view === 'settings' ? 'tools' : 'settings'),
            'data-active': view === 'settings' ? 'true' : 'false',
          }, view === 'settings' ? t('back') : t('settings'))),
        h('div', { className: 'adp-bar' }, tabs),
        paramsBar,
        h('div', { className: 'adp-body' }, body),
        asset ? h(AssetModal, { state: asset, t, onClose: () => setAsset(null) }) : null)
    }

    /* ------------------------------------------------------------------ *
     * 左侧栏入口
     * ------------------------------------------------------------------ */
    function RailEntry(props) {
      const size = typeof props?.size === 'number' ? props.size : 16
      return h(AdsIcon, { size })
    }

    const tRef = { t: (key) => key, openRight: () => false, rightReady: () => false }

    /* 选中左侧入口时：面板开在右侧栏，主内容区只留一句提示和一个按钮。 */
    function Launcher(props) {
      const t = tRef.t
      const [fallback, setFallback] = React.useState(false)
      React.useEffect(() => { if (!tRef.openRight()) setFallback(true) }, [])
      if (fallback) return h(Panel, props)
      return h('div', { className: 'adp-center' },
        h('div', { className: 'adp-center-title' }, t('entry')),
        h('div', { className: 'adp-center-hint' }, t('movedRight')),
        h('button', {
          type: 'button', className: 'adp-primary',
          onClick: () => { if (!tRef.openRight()) setFallback(true) },
        }, t('openRight')))
    }

    function MainScreen(props) {
      return tRef.rightReady() ? h(Launcher, props) : h(Panel, props)
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICT), 'ad-tools: dictionaries')
        tRef.t = ctx.locale.bind(NS)

        let rightReady = false
        tRef.rightReady = () => rightReady
        tRef.openRight = () => {
          try {
            const sr = typeof ctx.get === 'function' ? ctx.get('sidebarRight') : undefined
            if (sr && typeof sr.openTab === 'function') { sr.openTab(TAB_KIND); return true }
          } catch { /* 旧版 DSH 没有右侧栏 */ }
          return false
        }

        // 右侧栏：一个 tab 类型（带 guide 卡片，出现在「开始」页）+ 正文席位。
        if (typeof ctx.inject === 'function') {
          ctx.inject([TAB_REGISTRY], (scope) => {
            const tabs = scope[TAB_REGISTRY] || (typeof scope.get === 'function' ? scope.get(TAB_REGISTRY) : undefined)
            if (!tabs || typeof tabs.register !== 'function') return
            rightReady = true
            scope.effect(() => tabs.register({
              id: TAB_ID,
              kind: TAB_KIND,
              title: () => tRef.t('entry'),
              guide: [{
                id: 'open',
                order: 45,
                title: () => tRef.t('entry'),
                description: () => tRef.t('subtitle'),
                icon: AdsIcon,
              }],
            }), 'ad-tools: right sidebar tab type')
          })
        }

        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
          { name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS },
          Panel,
        ))

        // 左侧入口保留；右侧栏可用时选中即开在右侧，旧版 DSH 直接在主区显示。
        ctx.slots.inject('main', () => ctx.slots.register(
          { name: 'main', key: PANEL_ID, locale: NS },
          MainScreen,
        ))

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
          { name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: () => tRef.t('entry'), locale: NS },
          RailEntry,
        ))
      },
    }
  },
})
