import "./sites-env.mjs";
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import path from "node:path";

const port = 5173, root = process.cwd();
const config = "dist/server/wrangler.json", state = ".wrangler/state";
const cli = "node_modules/wrangler/bin/wrangler.js";
async function run(args) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit", windowsHide: true, env: process.env });
  await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`执行失败（${code}）`))); });
}
function sourceHash() {
  const hash = createHash("sha256");
  function visit(entry) { if (!existsSync(entry)) return; if (statSync(entry).isDirectory()) { for (const file of readdirSync(entry).sort()) visit(path.join(entry, file)); } else { hash.update(entry); hash.update(readFileSync(entry)); } }
  for (const entry of ["app", "components", "lib", "public", "db", "drizzle", "build", "vite.config.ts", ".openai/hosting.json", "package-lock.json"]) visit(entry);
  return hash.digest("hex");
}
async function checkPort() {
  await new Promise((resolve, reject) => { const socket = createServer(); socket.on("error", () => reject(new Error(`端口 ${port} 已被占用。请先关闭已启动的网站，或使用现有窗口访问 http://127.0.0.1:${port}`))); socket.listen(port, "127.0.0.1", () => socket.close(resolve)); });
}
try {
  await checkPort();
  if (!existsSync(cli)) throw new Error("依赖尚未安装。请在项目文件夹运行 npm run install:ci 后重试。");
  const fingerprint = sourceHash(), stamp = ".sites-runtime/local-build.txt";
  if (!existsSync(config) || !existsSync(stamp) || readFileSync(stamp, "utf8") !== fingerprint) {
    console.log("正在准备网站，首次启动需要稍等片刻…");
    await run(["scripts/run-framework.mjs", "build"]);
    mkdirSync(".sites-runtime", { recursive: true }); writeFileSync(stamp, fingerprint);
  }
  // This marker identifies the initial schema; later migrations use new marker names.
  const marker = path.join(state, "moqi-0000-applied");
  if (!existsSync(marker)) {
    const initial = readdirSync("drizzle").find((name) => name.startsWith("0000_") && name.endsWith(".sql"));
    if (!initial) throw new Error("缺少数据库初始化文件。");
    await run(["--import", "./scripts/sites-env.mjs", cli, "d1", "execute", "DB", "--local", "--config", config, "--persist-to", state, "--file", `drizzle/${initial}`]);
    mkdirSync(state, { recursive: true }); writeFileSync(marker, "1");
  }
  console.log(`\n默契好友已准备好： http://127.0.0.1:${port}\n管理员入口： http://127.0.0.1:${port}/admin\n保持此窗口开启；关闭窗口或按 Ctrl+C 停止服务。\n`);
  const child = spawn(process.execPath, ["--import", "./scripts/sites-env.mjs", cli, "dev", "--config", config, "--local", "--persist-to", state, "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0"], { cwd: root, stdio: "inherit", windowsHide: true, env: process.env });
  process.on("SIGINT", () => child.kill()); process.on("SIGTERM", () => child.kill());
  child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
  child.on("exit", (code) => { process.exitCode = code ?? 0; });
} catch (error) { console.error(`\n无法启动：${error.message}`); process.exitCode = 1; }
