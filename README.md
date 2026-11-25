# AI 委托指令理解问卷

实验一补充问卷。网页位于 `docs/`，可从 GitHub Pages 发布，也可直接由 Worker 提供。七个页面包含指导语、任务说明、练习、练习反馈、五轮预输入与四档 AI 指令、P_A6 和提交成功。参与者完成 P_A6 后提交，D1 确认写入才显示最后一页。

## 本地试填

使用 Node.js 22.13 或更高版本，在项目目录运行以下 PowerShell 命令。

```powershell
npm ci
Copy-Item .dev.vars.example .dev.vars
npm run db:local
npm run dev
```

打开终端显示的本地地址。默认端口 8787。本地 SQLite 与正式 D1 分开，同一 IP 也只限一份。本地研究者下载入口为 `http://localhost:8787/api/export.xlsx`，用户名为 `admin`，密码见本机 `.dev.vars`。运行 `npm test` 可验证写入、判重、名额和私有 Excel 下载。

## Cloudflare 构建与收集

Worker 名称为 `gra-thesis`。Workers Builds 使用仓库 `Jelllly-Y/gra_thesis` 的 `main` 分支和根目录 `/`。根目录下的 `wrangler.jsonc` 配置了网页资源、Worker 入口和 D1 绑定 `DB`。从 Worker 的 HTTPS 根地址发放问卷时，网页直接使用同源接口。

- 构建命令可以留空，也可以使用 `npm run build` 检查打包。部署命令使用 `npx wrangler deploy`。
- 首次收集前，在已授权的本机或部署环境运行一次 `npm run db:remote`。如果在本机运行，先执行 `npx wrangler login`。迁移在 D1 中创建本问卷专用的表。
- 在 Worker 的 **Settings → Variables and Secrets** 中设置两个 Secret。将 `IP_HASH_KEY` 设为随机密钥，收集期间保持一致。将 `EXPORT_PASSWORD` 设为研究者使用的随机 ASCII 密码。
- 访问 Worker 地址下的 `/api/export.xlsx`，以 `admin` 和导出密码登录即可下载。每份答卷一行，含编号、UTC 提交时间、SL1（0–3）、P_A6 原答案、作答耗时（秒）和练习重试次数。
- 需要配额时，可在 `wrangler.jsonc` 的 `vars` 中添加 `RESPONSE_QUOTA`。省略表示不限份数，设为 `"0"` 表示停止收集。
- 如另行启用 GitHub Pages，将 `docs/config.js` 中的 `workerOrigin` 填为 Worker 的 HTTPS 源地址，并选择 `main` 分支的 `/docs` 目录作为 Pages 发布源。

## 续答与限答

同一浏览器与站点地址下保存当前页、已选答案、练习掷骰结果和失败次数。五轮预输入仍需全部选择，进入指令理解检验时即从草稿移除，提交请求只发送研究所需指标与答案。发放时统一使用一个地址以便续答。

首页首次点击“开始作答”时开始计时，完成最后一题后首次点击“提交问卷”时停止，记录完整秒数。中途离开到续答之间的时间计入，网络重试沿用首次提交的耗时。升级前已开始的草稿保留原有答案和练习重试次数，耗时留空。练习首次通过记 0，每次未通过后重做加 1；第五次未通过仍按原规则结束，不生成完成答卷。

正式入口和提交均按 Cloudflare 提供的访客 IP 检查。数据库保存带密钥的 IP 摘要，以唯一约束拦截同 IP 的第二份答卷。共享同一公网出口的设备也受此限制。断网重试沿用同一答卷编号；写入成功但回执丢失时可恢复确认。Excel 仅导出研究所需字段。
