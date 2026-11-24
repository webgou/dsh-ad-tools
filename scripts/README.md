# 内置脚本

这八个 `.mjs` 是投放分析工具的运行体，随插件安装，**不再从外部工具目录读取**。

| 文件 | 面板页签 |
| --- | --- |
| `盯盘.mjs` | 盯盘 |
| `创角次留.mjs` | 创角次留 |
| `注册留存.mjs` | 注册留存 |
| `创意数据.mjs` | 创意数据 |
| `周报生成器.mjs` | 周报 |
| `保本出价.mjs` | 保本出价 |
| `单元LTV判定.mjs` | 单元LTV判定 |
| `定向监控.mjs` | 定向监控 |

## 与来源的唯一差异

每份脚本只改了一行，让运行产物写到插件自己的数据目录：

```js
const TMP = process.env.AD_TOOLS_TMP || <原来的仓库 tmp>
```

插件启动子进程时会设置 `AD_TOOLS_TMP`（默认 `~/.dsh/storages/ad-tools/run`），
所以凭证缓存、快照、留痕都落在那里，不会写进插件目录，也不碰原仓库。

## 更新口径时

这些文件就是运行体，改这里即可。若另有上游副本，同步时记得保留上面那一行
`AD_TOOLS_TMP`，或者重新套一遍同样的改动。

凭证仍由 Host 侧注入：`--import lib/credfile-shim.mjs` 把
`tencentads_credentials.json` 的读取重定向到面板里配置的 token，脚本本身不存 token。
