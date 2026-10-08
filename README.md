# 默契好友

支持本地运行及 Sites 云端部署的中文默契测试网站，提供管理员出题、多份试卷、独立白名单、单次答题、自动评分、多档奖励和排行榜。

双击 **启动网站.bat**，打开 http://127.0.0.1:5173 。管理员账号是 **admin**，首次访问 `/admin` 自行设置密码。详细步骤见 [使用说明](./使用说明.md)。

## 开发

- Node.js ≥ 22.13，React / TypeScript / Vinext，SQLite 通过本地 D1 运行。
- `npm run install:ci` 安装依赖，`npm run check` 类型检查，`npm test` 规则和数据库测试。
- `npm run build` 构建，`npm start` 初始化数据库并启动在 127.0.0.1:5173。
- `npm run test:integration` 使用独立数据库运行端到端接口验证，包含服务重启；结果保存在 `outputs/integration-report.json`，不会写入正式数据库。
- `app` 为页面和 API 入口，`components` 为交互组件，`lib` 为权限与评分逻辑，`db/schema.ts` 为数据库结构，`drizzle` 为版本迁移。
- 正式数据库位于 `.wrangler/state`，开发时也使用这一目录。生成新迁移后按顺序应用，首次迁移不可重放。备份须停止服务后复制整个目录。

管理员密码使用加盐 scrypt 摘要，兼容此前本地 PBKDF2 密码；会话使用随机令牌摘要和 HttpOnly Cookie，HTTPS 下同时设置 Secure。评分和奖励由服务端计算，数据库约束防止重复提交。首次提交永久锁定题目与奖励规则，答题版本过期时拒绝提交。

## 云端私密测试

站点：https://mango-moqi-test.redbow1.chatgpt.site ，后台路径 `/admin`。当前站点只有所有者能访问，需登录部署站点所用的 ChatGPT 账号，再首次设置 `admin` 密码。分享页同样受私密访问限制。

Sites 使用独立云端 D1 数据库，本地 `.wrangler/state`、管理员密码、试卷与答题记录不会随代码上传。云端和本地的数据不自动同步。Sites 在发布时应用 `drizzle` 中的数据库迁移；不要上传本地运行目录。站点发布通过 Sites 工作流完成，GitHub 推送仅同步源码。

奖励由管理员线下兑现，无支付或外部兑换。
