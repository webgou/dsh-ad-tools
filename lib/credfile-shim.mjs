/**
 * 凭证重定向（以 `node --import` 注入到子进程，脚本本身一行不改）。
 *
 * 八个工具都从 `<仓库>/tmp/tencentads_credentials.json` 里读 access_token，
 * 没有环境变量兜底。面板里配的 token 要生效，就只能在这一层把读取拦下来：
 *   · 只在设置了 MKT_ACCESS_TOKEN 时生效（否则完全透明，走原文件）；
 *   · 只拦这个文件名，其余读文件原样放行；
 *   · 只改内存里的返回值，不写任何文件 —— 仓库里的凭证文件不会被插件碰。
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'

const TOKEN = process.env.MKT_ACCESS_TOKEN || ''
const ACCOUNT = process.env.MKT_ACCOUNT_ID || ''
const FILE_RE = /tencentads_credentials\.json$/i

if (TOKEN) {
  const require = createRequire(import.meta.url)
  const realFs = require('node:fs')
  const original = realFs.readFileSync

  realFs.readFileSync = function patched(file, ...rest) {
    if (typeof file !== 'string' || !FILE_RE.test(file)) return original.call(this, file, ...rest)
    let base = {}
    try {
      const raw = original.call(this, file, 'utf8')
      const parsed = JSON.parse(String(raw).replace(/^﻿/, ''))
      if (parsed && typeof parsed === 'object') base = parsed
    } catch { /* 文件不存在也能用面板里的 token */ }
    return JSON.stringify({
      ...base,
      access_token: TOKEN,
      ...(ACCOUNT ? { account_id: ACCOUNT } : {}),
    })
  }

  // ESM 的 `import fs from 'node:fs'` 拿到的是同一个 CJS 对象；这里再兜一层，
  // 以防运行时的默认导出是快照而不是活引用。
  try {
    if (fs.readFileSync !== realFs.readFileSync) fs.readFileSync = realFs.readFileSync
  } catch { /* 冻结的命名空间就靠上面那层 */ }
}
