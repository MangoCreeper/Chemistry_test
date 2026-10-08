import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const child = spawn("netlify", ["dev", "--port", "8889"], {
  cwd: root, stdio: "inherit", shell: process.platform === "win32", windowsHide: true,
});
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("error", () => {
  console.error("无法启动 Netlify Dev。请先安装 Netlify CLI，并在项目目录运行 netlify link 关联站点。");
  process.exitCode = 1;
});
child.on("exit", (code) => { process.exitCode = code ?? 1; });
