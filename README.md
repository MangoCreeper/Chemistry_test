# 默契好友

部署在 Netlify 的中文默契测试网站，提供管理员出题、多份试卷、独立白名单、单次答题、自动评分、多档奖励和排行榜。

管理员账号是 **admin**，首次访问 `/admin` 自行设置至少 8 位的密码。首次部署后请立即完成初始化。详细步骤见 [使用说明](./使用说明.md)。

## 开发

- Node.js ≥ 22.13，React / TypeScript / Next.js，数据使用 Netlify Database（Postgres）持久化。
- `npm ci` 安装依赖，`npm run check` 类型检查，`npm test` 验证评分、安全规则和 Postgres 数据库约束。
- 本地安装 Netlify CLI 并运行 `netlify link` 关联站点后，使用 `npm run dev:netlify`，打开 http://localhost:8889；Windows 也可以双击 **启动网站.bat**。Netlify Dev 提供数据库连接，单独运行 `npm run dev` 仅启动 Next.js，不提供平台数据库配置。
- `npm run build` 使用 Next.js 标准构建流程，Netlify 自动适配页面和 API；`npm start` 用于在已构建且具有数据库配置的环境中启动 Next.js。
- `npm run test:integration` 在隔离的内存 Postgres 测试数据库中验证实际 API 处理函数，覆盖管理员初始化、出题、白名单、并发提交、评分、奖励、排行榜和模块重新加载后的会话与登录限流；不会访问站点数据库，也不会创建构建产物。
- `app` 为页面和 API 入口，`components` 为交互组件，`lib` 为权限与评分逻辑，`db/schema.ts` 为数据库结构。修改结构后运行 `npm run db:generate -- --name add_descriptive_change`，迁移生成在 `netlify/database/migrations`，部署时自动应用。已应用的迁移不可修改。

管理员密码使用加盐 scrypt 摘要，兼容此前的 PBKDF2 密码；会话使用随机令牌摘要和 HttpOnly Cookie，HTTPS 下同时设置 Secure。管理员密码、会话、试卷、白名单、成绩与登录限流记录均保存在数据库中。评分和奖励由服务端计算，数据库约束防止重复提交。首次提交永久锁定题目与奖励规则，答题版本过期时拒绝提交。

## Netlify 部署

站点的后台路径为 `/admin`。分享链接使用当前站点域名，不依赖 ChatGPT 登录或 Cloudflare Workers。若在 Netlify 开启了站点访问保护，参与者也需要先通过该保护。

Netlify 自动提供数据库连接并应用 Postgres 迁移，无需在代码中填写数据库凭据。这是全新的 Netlify 数据库；原 Cloudflare D1 或 `.wrangler/state` 中的数据不会自动迁移。旧的 `drizzle` 目录保留为 SQLite 历史记录，不参与 Netlify 部署。不要将本地数据目录或环境变量文件上传到仓库。

奖励由管理员线下兑现，无支付或外部兑换。
