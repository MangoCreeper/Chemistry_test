import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { database } from "./helpers/api-database.mjs";

const databaseUrl = new URL("../db/index.ts", import.meta.url).href;
const fixtureUrl = new URL("./helpers/api-database.mjs", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    return result.url === databaseUrl ? { url: fixtureUrl, shortCircuit: true } : result;
  },
});
let { handleApi } = await import("../lib/server.ts");
const origin = "https://example.test";

function client() {
  const cookies = new Map();
  return async (path, method = "GET", body, expected = 200, extraHeaders = {}) => {
    const headers = { Origin: origin, ...extraHeaders };
    if (cookies.size) headers.Cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await handleApi(new Request(`${origin}/api/${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    }));
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0], separator = pair.indexOf("=");
      cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
      assert.match(cookie, /HttpOnly; SameSite=Strict/);
      assert.match(cookie, /Secure/);
    }
    const value = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(value)}`);
    assert.equal(response.headers.get("cache-control"), "no-store");
    return value;
  };
}

test("Netlify Postgres API 完整流程和重新加载后的会话", async (context) => {
  context.after(async () => { hooks.deregister(); await database.close(); });
  const admin = client(), anonymous = client(), password = "integration-test-password";
  assert.deepEqual(await admin("admin/session"), { initialized: false, loggedIn: false });
  await anonymous("admin/quizzes", "GET", undefined, 401);
  await anonymous("admin/setup", "POST", { username: "admin", password }, 403, { Origin: "https://elsewhere.test" });
  await admin("admin/setup", "POST", { username: "admin", password });
  await anonymous("admin/setup", "POST", { username: "admin", password }, 409);
  assert.deepEqual(await admin("admin/session"), { initialized: true, loggedIn: true });

  let quiz = (await admin("admin/quizzes", "POST", { title: "测试试卷", owner: "小林" }, 201)).quiz;
  const base = `admin/quizzes/${quiz.id}`, playerBase = `quizzes/${quiz.id}`;
  await anonymous(playerBase, "GET", undefined, 404);
  await admin(`${base}/status`, "POST", { status: "published", version: quiz.version }, 400);
  const content = {
    questions: Array.from({ length: 10 }, (_, index) => ({ id: `question-${index}`, text: `题目${index}`, options: ["错误", "正确"], correct: 1, explanation: "测试解析" })),
    rewards: [{ threshold: 80, name: "奶茶券", description: "测试奖励" }, { threshold: 100, name: "电影券", description: "测试奖励" }],
  };
  quiz = (await admin(base, "PUT", { ...quiz, content })).quiz;
  await admin(base, "PUT", { ...quiz, version: quiz.version - 1 }, 409);
  await admin(`${base}/participants`, "POST", { names: "阿月\n小满\n朋友\nAlice\n阿月" });
  assert.equal((await admin(base)).participants.length, 4);
  quiz = (await admin(`${base}/status`, "POST", { status: "published", version: quiz.version })).quiz;

  await anonymous(`${playerBase}/login`, "POST", { username: "陌生人" }, 403);
  await anonymous(`${playerBase}/login`, "POST", { username: "alice" }, 403);
  await anonymous(`${playerBase}/questions`, "GET", undefined, 401);
  const first = client(), second = client(), third = client(), late = client();
  await first(`${playerBase}/login`, "POST", { username: " 阿月 " });
  const publicQuiz = (await first(playerBase)).quiz;
  assert.equal(publicQuiz.username, "阿月");
  assert.equal(JSON.stringify(publicQuiz).includes('"correct"'), false);
  assert.equal(JSON.stringify(publicQuiz).includes('"explanation"'), false);
  await first("admin/quizzes", "GET", undefined, 401);
  await first(`${playerBase}/result`, "GET", undefined, 404);
  const answers = (correct) => Object.fromEntries(content.questions.map((question, index) => [question.id, index < correct ? 1 : 0]));
  await first(`${playerBase}/submit`, "POST", { version: quiz.version - 1, answers: answers(10) }, 409);
  await first(`${playerBase}/submit`, "POST", { version: quiz.version, answers: {} }, 400);
  const duplicates = await Promise.all([
    first(`${playerBase}/submit`, "POST", { version: quiz.version, answers: answers(8), score: 100 }),
    first(`${playerBase}/submit`, "POST", { version: quiz.version, answers: answers(8), score: 100 }),
  ]);
  assert.equal(duplicates[0].result.id, duplicates[1].result.id);
  assert.equal(duplicates[0].result.score, 80);
  assert.equal(duplicates[0].result.reward.name, "奶茶券");
  assert.equal((await admin(base)).rankings.length, 1);
  assert.equal((await admin(base)).quiz.locked, true);
  await admin(base, "PUT", quiz, 409);

  await second(`${playerBase}/login`, "POST", { username: "小满" });
  const full = (await second(`${playerBase}/submit`, "POST", { version: quiz.version, answers: answers(10) })).result;
  assert.equal(full.reward.name, "电影券");
  await third(`${playerBase}/login`, "POST", { username: "朋友" });
  await third(`${playerBase}/submit`, "POST", { version: quiz.version, answers: answers(10) });
  assert.deepEqual((await first(`${playerBase}/ranking`)).rankings.map((entry) => entry.rank), [1, 1, 3]);
  assert.equal((await first(`${playerBase}/result`)).result.rank, 3);
  assert.equal((await first(`${playerBase}/result`)).result.answers[0].correct, 1);
  await admin(`${base}/results/${full.id}/redeem`, "POST", {});
  assert.ok((await second(`${playerBase}/result`)).result.redeemedAt);

  const entry = (await admin(base)).participants.find((participant) => participant.username === "Alice");
  await late(`${playerBase}/login`, "POST", { username: "Alice" });
  await admin(`${base}/participants/${entry.id}`, "PATCH", { enabled: false });
  await late(`${playerBase}/submit`, "POST", { answers: answers(10) }, 403);
  await admin(`${base}/participants`, "POST", { names: "Alice" });
  quiz = (await admin(`${base}/status`, "POST", { status: "closed", version: quiz.version })).quiz;
  await late(`${playerBase}/submit`, "POST", { answers: answers(10) }, 403);
  assert.equal((await first(`${playerBase}/result`)).result.score, 80);

  const copy = (await admin(`${base}/copy`, "POST", {}, 201)).quiz;
  const copied = await admin(`admin/quizzes/${copy.id}`);
  assert.equal(copy.locked, false);
  assert.equal(copy.status, "draft");
  assert.equal(copied.participants.length, 0);
  assert.equal(copied.rankings.length, 0);
  await admin(`${base}/results/${full.id}`, "DELETE");
  assert.equal((await admin(base)).quiz.locked, true);
  quiz = (await admin(`${base}/status`, "POST", { status: "published", version: quiz.version })).quiz;
  const zero = (await second(`${playerBase}/submit`, "POST", { version: quiz.version, answers: answers(0) })).result;
  assert.equal(zero.score, 0);
  assert.equal(zero.reward, null);

  ({ handleApi } = await import("../lib/server.ts?reload"));
  assert.equal((await admin("admin/session")).loggedIn, true);
  assert.equal((await second(`${playerBase}/result`)).result.score, 0);
  const freshAdmin = client();
  await freshAdmin("admin/login", "POST", { username: "admin", password });
  await freshAdmin("admin/logout", "POST", {});
  await freshAdmin("admin/quizzes", "GET", undefined, 401);
  for (let attempt = 0; attempt < 10; attempt++) {
    await anonymous("admin/login", "POST", { username: "admin", password: "wrong-password" }, 401);
  }
  ({ handleApi } = await import("../lib/server.ts?rate-limit-reload"));
  await anonymous("admin/login", "POST", { username: "admin", password }, 429);
  await database.exec("UPDATE login_attempts SET since=0");
  await anonymous("admin/login", "POST", { username: "admin", password });
});
