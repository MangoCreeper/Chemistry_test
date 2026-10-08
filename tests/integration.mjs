import "../scripts/sites-env.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";

const isRunner = process.env.MOQI_TEST_RUNNER === "1";
const state = process.env.MOQI_TEST_STATE || `work/integration-${randomUUID()}`, port = 5174, origin = process.env.MOQI_TEST_ORIGIN || `http://127.0.0.1:${port}`;
const cli = "node_modules/wrangler/bin/wrangler.js", config = "dist/server/wrangler.json";
let server, log = "";
function http(path, method = "GET", headers = {}, body) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${origin}${path}`, { method, headers, agent: false }, (res) => {
      const chunks = []; res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, cookies: res.headers["set-cookie"] ?? [], text: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.setTimeout(20000, () => req.destroy(new Error(`${method} ${path} timed out`)));
    req.on("error", reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
function launch(args) {
  const child = spawn(process.execPath, ["--import", "./scripts/sites-env.mjs", cli, ...args], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    env: { ...process.env, WRANGLER_REGISTRY_PATH: `${process.cwd()}/${state}/dev-registry`, MINIFLARE_REGISTRY_PATH: `${process.cwd()}/${state}/registry` } });
  child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
  return child;
}
async function execute(args) {
  const child = launch(args);
  await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(log))); });
}
async function start() {
  log = "";
  server = launch(["dev", "--local", "--config", config, "--persist-to", state, "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0"]);
  let startupError;
  server.on("error", (e) => { startupError = e; });
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (startupError || server.exitCode !== null) throw startupError || new Error(log);
    try { const response = await http("/api/admin/session"); if (response.status === 200) return; } catch { /* Wait for the worker. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`测试服务启动超时\n${log}`);
}
async function stop() { if (!server || server.exitCode !== null) return; const child = server; await new Promise((resolve) => { child.once("exit", resolve); child.kill(); }); server = null; await new Promise((r) => setTimeout(r, 600)); }
function client() {
  const cookies = new Map();
  return async (path, method = "GET", body, expected = 200, extraHeaders = {}) => {
    const response = await http(`/api/${path}`, method, { Origin: origin, ...(cookies.size ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...extraHeaders }, body);
    for (const cookie of response.cookies) { const pair = cookie.split(";")[0], at = pair.indexOf("="); cookies.set(pair.slice(0, at), pair.slice(at + 1)); }
    const text = response.text;
    assert.equal(response.status, expected, `${method} ${path}: ${text}`);
    const value = JSON.parse(text); return value;
  };
}
let assertions = 0;
function passed(label) { assertions++; console.log(`✓ ${label}`); }
if (!isRunner) {
try {
  const migration = readdirSync("drizzle").find((name) => name.startsWith("0000_") && name.endsWith(".sql"));
  await execute(["d1", "execute", "DB", "--local", "--config", config, "--persist-to", state, "--file", `drizzle/${migration}`]);
  await start();
  const runner = spawn(process.execPath, ["tests/integration.mjs"], { stdio: ["ignore", "inherit", "inherit", "ipc"], windowsHide: true, env: { ...process.env, MOQI_TEST_RUNNER: "1", MOQI_TEST_STATE: state, MOQI_TEST_ORIGIN: origin } });
  runner.on("message", async (message) => { if (message === "restart") { try { await stop(); await start(); runner.send("ready"); } catch (e) { console.error(e); runner.send("failed"); } } });
  await new Promise((resolve, reject) => { runner.on("error", reject); runner.on("exit", (code) => { process.exitCode = code ?? 1; resolve(); }); });
} catch (error) { console.error(error); console.error(log.slice(-5000)); process.exitCode = 1; }
finally { await stop(); }
} else {
try {
  const admin = client(), anonymous = client();
  await anonymous("admin/quizzes", "GET", undefined, 401);
  await anonymous("admin/setup", "POST", { username: "admin", password: "Test-only-2026" }, 403, { Origin: "http://elsewhere.invalid" });
  const initialized = (await admin("admin/session")).initialized;
  await admin(`admin/${initialized ? "login" : "setup"}`, "POST", { username: "admin", password: "Test-only-2026" });
  await anonymous("admin/setup", "POST", { username: "admin", password: "Other-test-2026" }, 409);
  await anonymous("admin/login", "POST", { username: "admin", password: "incorrect" }, 401);
  passed("首次设置、管理员权限和请求来源校验");

  let { quiz } = await admin("admin/quizzes", "POST", { title: "测试专用 · 关于小林", owner: "小林" }, 201);
  const id = quiz.id, base = `admin/quizzes/${id}`, playerBase = `quizzes/${id}`;
  await anonymous(playerBase, "GET", undefined, 404);
  await admin(`${base}/status`, "POST", { status: "published", version: quiz.version }, 400);
  quiz.content = { questions: Array.from({ length: 10 }, (_, i) => ({ id: `question-${i}`, text: `小林的第 ${i + 1} 个偏爱？`, options: ["A", "B", "C", "D"], correct: 1, explanation: "这是答案背后的小故事。" })), rewards: [{ threshold: 80, name: "奶茶券", description: "一起喝奶茶" }, { threshold: 100, name: "电影券", description: "一起看电影" }] };
  quiz = (await admin(base, "PUT", quiz)).quiz;
  await admin(base, "PUT", { ...quiz, version: quiz.version - 1 }, 409);
  await admin(`${base}/participants`, "POST", { names: " 阿月 \n小满\n朋友\nAlice\n阿月" });
  assert.equal((await admin(base)).participants.length, 4);
  quiz = (await admin(`${base}/status`, "POST", { status: "published", version: quiz.version })).quiz;
  passed("草稿、发布验证、版本冲突及逐试卷白名单");

  await anonymous(`${playerBase}/login`, "POST", { username: "陌生人" }, 403);
  await anonymous(`${playerBase}/login`, "POST", { username: "alice" }, 403);
  await anonymous(`${playerBase}/questions`, "GET", undefined, 401);
  await anonymous(`${playerBase}/result`, "GET", undefined, 401);
  const a = client(), b = client(), c = client(), late = client();
  await a(`${playerBase}/login`, "POST", { username: " 阿月 " });
  const publicQuiz = (await a(playerBase)).quiz;
  assert.equal(publicQuiz.username, "阿月");
  assert.equal(JSON.stringify(publicQuiz).includes('"correct"'), false);
  assert.equal(JSON.stringify(publicQuiz).includes('"explanation"'), false);
  await a("admin/quizzes", "GET", undefined, 401);
  await a(`${playerBase}/result`, "GET", undefined, 404);
  const answers = (correct) => Object.fromEntries(quiz.content.questions.map((q, i) => [q.id, i < correct ? 1 : 0]));
  await a(`${playerBase}/submit`, "POST", { version: quiz.version - 1, answers: answers(10) }, 409);
  await a(`${playerBase}/submit`, "POST", { version: quiz.version, answers: {} }, 400);
  await a(`${playerBase}/submit`, "POST", { version: quiz.version, answers: { ...answers(10), "question-0": 99 } }, 400);
  passed("白名单拒绝、普通用户隔离、答案保密及漏答检查");

  const duplicated = await Promise.all([a(`${playerBase}/submit`, "POST", { version: quiz.version, answers: answers(8), score: 100 }), a(`${playerBase}/submit`, "POST", { version: quiz.version, answers: answers(8), score: 100 })]);
  assert.equal(duplicated[0].result.id, duplicated[1].result.id);
  assert.equal(duplicated[0].result.score, 80);
  assert.equal(duplicated[0].result.reward.name, "奶茶券");
  assert.equal((await a(`${playerBase}/submit`, "POST", { answers: answers(10) })).result.score, 80);
  assert.equal((await admin(base)).rankings.length, 1);
  assert.equal((await admin(base)).quiz.locked, true);
  await admin(base, "PUT", quiz, 409);
  passed("服务端评分、并发重复提交、奖励原子保存和规则锁定");

  await b(`${playerBase}/login`, "POST", { username: "小满" });
  const full = (await b(`${playerBase}/submit`, "POST", { version: quiz.version, answers: answers(10) })).result;
  assert.equal(full.reward.name, "电影券");
  await c(`${playerBase}/login`, "POST", { username: "朋友" });
  await c(`${playerBase}/submit`, "POST", { version: quiz.version, answers: answers(10) });
  const ranks = (await a(`${playerBase}/ranking`)).rankings;
  assert.deepEqual(ranks.map((r) => r.rank), [1, 1, 3]);
  assert.equal((await a(`${playerBase}/result`)).result.rank, 3);
  assert.equal((await a(`${playerBase}/result`)).result.answers[0].correct, 1);
  await admin(`${base}/results/${full.id}/redeem`, "POST", {});
  assert.ok((await b(`${playerBase}/result`)).result.redeemedAt);
  passed("满分最高档、同分并列、逐题解析和奖励兑现");

  const entry = (await admin(base)).participants.find((p) => p.username === "Alice");
  await late(`${playerBase}/login`, "POST", { username: "Alice" });
  await admin(`${base}/participants/${entry.id}`, "PATCH", { enabled: false });
  await late(`${playerBase}/submit`, "POST", { answers: answers(10) }, 403);
  await late(`${playerBase}/login`, "POST", { username: "Alice" }, 403);
  await admin(`${base}/participants`, "POST", { names: "Alice" });
  quiz = (await admin(base)).quiz;
  quiz = (await admin(`${base}/status`, "POST", { status: "closed", version: quiz.version })).quiz;
  await late(`${playerBase}/submit`, "POST", { answers: answers(10) }, 403);
  assert.equal((await a(`${playerBase}/result`)).result.score, 80);
  const sameUser = client(); await sameUser(`${playerBase}/login`, "POST", { username: "阿月" });
  passed("停用即时生效、重新启用及关闭后保留结果");

  const copy = (await admin(`${base}/copy`, "POST", {}, 201)).quiz;
  const copyDetail = await admin(`admin/quizzes/${copy.id}`);
  assert.equal(copy.locked, false); assert.equal(copy.status, "draft"); assert.equal(copyDetail.participants.length, 0); assert.equal(copyDetail.rankings.length, 0);
  await admin(`${base}/results/${full.id}`, "DELETE");
  assert.equal((await admin(base)).quiz.locked, true);
  quiz = (await admin(`${base}/status`, "POST", { status: "published", version: quiz.version })).quiz;
  const zero = (await b(`${playerBase}/submit`, "POST", { version: quiz.version, answers: answers(0) })).result;
  assert.equal(zero.score, 0); assert.equal(zero.reward, null); assert.notEqual(zero.id, full.id);
  passed("复制不带名单与成绩、重置后重新作答、零分无奖励");

  if (process.send) { await new Promise((resolve, reject) => { process.once("message", (message) => message === "ready" ? resolve() : reject(new Error("重启失败"))); process.send("restart"); }); }
  assert.equal((await admin("admin/session")).loggedIn, true);
  assert.equal((await b(`${playerBase}/result`)).result.score, 0);
  assert.equal((await admin(base)).rankings.length, 3);
  const newAdmin = client(); await newAdmin("admin/login", "POST", { username: "admin", password: "Test-only-2026" });
  await newAdmin("admin/logout", "POST", {}); await newAdmin("admin/quizzes", "GET", undefined, 401);
  passed(process.send ? "真实服务重启后密码、会话、成绩与奖励持久化" : "管理员退出、记录持久保存（外部服务模式未执行重启）");
  mkdirSync("outputs", { recursive: true });
  writeFileSync("outputs/integration-report.json", JSON.stringify({ passed: assertions, state, origin, quizId: id, result: "pass" }, null, 2));
  console.log(`\n${assertions} 组实际流程验证通过；测试数据保存在独立的 ${state}`);
} catch (error) { console.error(error); console.error(log.slice(-5000)); process.exitCode = 1; }
}
