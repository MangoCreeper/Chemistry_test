import { env } from "cloudflare:workers";
import { AppError, grade, ranked, requireText, usernameOf, validateContent } from "./rules";
import type { Quiz, QuizContent, Ranking, Result } from "./types";

type Row = Record<string, string | number | null>;
const requestBodies = new WeakMap<Request, string>();
async function readBody(request: Request) {
  if (!request.body) return "";
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1600000) { await reader.cancel(); throw new AppError("提交内容过大", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const decoder = new TextDecoder();
  return chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join("") + decoder.decode();
}
function db() { if (!env.DB) throw new Error("本地数据库尚未配置"); return env.DB; }
function statement(sql: string, ...args: (string | number | null)[]) { return db().prepare(sql).bind(...args); }
async function one(sql: string, ...args: (string | number | null)[]) { return statement(sql, ...args).first<Row>(); }
async function all(sql: string, ...args: (string | number | null)[]) { return (await statement(sql, ...args).all<Row>()).results; }
const uid = () => crypto.randomUUID().replaceAll("-", "");
const hex = (array: ArrayBuffer) => Array.from(new Uint8Array(array), (b) => b.toString(16).padStart(2, "0")).join("");
async function digest(value: string) { return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))); }
async function passwordHash(password: string, salt = uid()) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const hash = hex(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 210000, hash: "SHA-256" }, key, 256));
  return `${salt}:${hash}`;
}
function safeEqual(a: string, b: string) { let different = a.length ^ b.length; for (let i = 0; i < a.length; i++) different |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0); return different === 0; }
function cookieName(quizId?: string) { return quizId ? `moqi_q_${quizId}` : "moqi_admin"; }
function cookieValue(request: Request, name: string) { return request.headers.get("cookie")?.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1); }
async function session(request: Request, quizId?: string) {
  const token = cookieValue(request, cookieName(quizId));
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const s = await one("SELECT * FROM sessions WHERE id=? AND expires_at>?", await digest(token), Date.now());
  if (!s || (quizId ? s.role !== "player" || s.quiz_id !== quizId : s.role !== "admin")) return null;
  return s;
}
async function createSession(role: "admin" | "player", quizId?: string, username?: string) {
  const token = uid() + uid(), duration = role === "admin" ? 86400 : 604800;
  await db().batch([
    statement("DELETE FROM sessions WHERE expires_at <= ?", Date.now()),
    statement("INSERT INTO sessions (id,role,quiz_id,username,expires_at) VALUES (?,?,?,?,?)", await digest(token), role, quizId ?? null, username ?? null, Date.now() + duration * 1000),
  ]);
  return `${cookieName(quizId)}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${duration}`;
}
function json(value: unknown, status = 200, cookie?: string) {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  if (cookie) headers.set("Set-Cookie", cookie);
  return new Response(JSON.stringify(value), { status, headers });
}
async function input(request: Request): Promise<Record<string, unknown>> {
  const raw = requestBodies.get(request) ?? await readBody(request);
  if (raw.length > 500000) throw new AppError("提交内容过大", 413);
  try { const value = JSON.parse(raw); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new AppError("请求内容格式不正确"); }
}
function quizFrom(row: Row): Quiz {
  return { id: String(row.id), title: String(row.title), owner: String(row.owner), description: String(row.description), content: JSON.parse(String(row.content)) as QuizContent,
    status: row.status as Quiz["status"], locked: !!row.locked, version: Number(row.version), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    ...(row.participants !== undefined ? { participants: Number(row.participants), submissions: Number(row.submissions) } : {}) };
}
async function quizBy(id: string, publicOnly = false) {
  const row = await one("SELECT * FROM quizzes WHERE id=?", id);
  if (!row || (publicOnly && row.status === "draft")) throw new AppError("这份试卷不存在或尚未发布", 404);
  return quizFrom(row);
}
async function player(request: Request, quizId: string) {
  const s = await session(request, quizId);
  if (!s) throw new AppError("请先输入白名单用户名登录", 401);
  if (!await one("SELECT id FROM participants WHERE quiz_id=? AND username=? AND enabled=1", quizId, String(s.username))) throw new AppError("该用户名已停用，请联系出题人", 403);
  return String(s.username);
}
function rankingRow(row: Row): Omit<Ranking, "rank"> {
  return { id: String(row.id), username: String(row.username), correct: Number(row.correct), total: Number(row.total), score: Number(row.score),
    reward: row.reward ? JSON.parse(String(row.reward)) : null, redeemedAt: row.redeemed_at === null ? null : Number(row.redeemed_at), submittedAt: Number(row.submitted_at) };
}
async function rankings(id: string) { return ranked((await all("SELECT * FROM submissions WHERE quiz_id=? ORDER BY correct DESC,submitted_at ASC,id ASC", id)).map(rankingRow)); }
async function resultFor(quiz: Quiz, username: string): Promise<Result | null> {
  const row = await one("SELECT * FROM submissions WHERE quiz_id=? AND username=?", quiz.id, username);
  if (!row) return null;
  const answers = JSON.parse(String(row.answers)) as Record<string, number>;
  const rank = (await rankings(quiz.id)).find((s) => s.id === row.id)?.rank ?? 1;
  return { ...rankingRow(row), rank, answers: quiz.content.questions.map((q) => ({ question: q.text, options: q.options, correct: q.correct, selected: answers[q.id], explanation: q.explanation })) };
}
const loginFailures = new Map<string, { count: number; since: number }>();
async function adminApi(request: Request, parts: string[]): Promise<Response> {
  const method = request.method;
  if (parts[0] === "session" && method === "GET") return json({ initialized: !!await one("SELECT id FROM administrators WHERE id=1"), loggedIn: !!await session(request) });
  if ((parts[0] === "setup" || parts[0] === "login") && method === "POST") {
    const body = await input(request);
    if (body.username !== "admin") throw new AppError("管理员账号为 admin", 401);
    const password = requireText(body.password, "密码", 128);
    const admin = await one("SELECT * FROM administrators WHERE id=1");
    if (parts[0] === "setup") {
      if (admin) throw new AppError("管理员已初始化，请直接登录", 409);
      if (password.length < 8) throw new AppError("密码至少需要 8 个字符");
      const inserted = await statement("INSERT INTO administrators (id,password) VALUES (1,?) ON CONFLICT(id) DO NOTHING", await passwordHash(password)).run();
      if (!inserted.meta.changes) throw new AppError("管理员已初始化，请直接登录", 409);
    } else {
      const key = "local", failure = loginFailures.get(key);
      if (failure && Date.now() - failure.since < 60000 && failure.count >= 10) throw new AppError("尝试次数较多，请一分钟后重试", 429);
      const stored = String(admin?.password ?? "");
      if (!admin || !safeEqual(await passwordHash(password, stored.split(":")[0]), stored)) {
        loginFailures.set(key, { count: failure && Date.now() - failure.since < 60000 ? failure.count + 1 : 1, since: failure && Date.now() - failure.since < 60000 ? failure.since : Date.now() });
        throw new AppError("账号或密码不正确", 401);
      }
      loginFailures.delete(key);
    }
    return json({ ok: true }, 200, await createSession("admin"));
  }
  const admin = await session(request);
  if (!admin) throw new AppError("请先登录管理员账号", 401);
  if (parts[0] === "logout" && method === "POST") {
    await statement("DELETE FROM sessions WHERE id=?", String(admin.id)).run();
    return json({ ok: true }, 200, `${cookieName()}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  }
  if (parts[0] !== "quizzes") throw new AppError("接口不存在", 404);
  if (parts.length === 1) {
    if (method === "GET") return json({ quizzes: (await all("SELECT q.*, (SELECT COUNT(*) FROM participants p WHERE p.quiz_id=q.id AND p.enabled=1) participants, (SELECT COUNT(*) FROM submissions s WHERE s.quiz_id=q.id) submissions FROM quizzes q ORDER BY created_at DESC,id DESC")).map(quizFrom) });
    if (method === "POST") {
      const body = await input(request), id = uid(), now = Date.now();
      await statement("INSERT INTO quizzes (id,title,owner,description,content,status,locked,version,created_at,updated_at) VALUES (?,?,?,?,?,'draft',0,1,?,?)", id, requireText(body.title, "试卷标题", 100), requireText(body.owner, "出题人", 40), "", JSON.stringify({ questions: [], rewards: [] }), now, now).run();
      return json({ quiz: await quizBy(id) }, 201);
    }
  }
  const id = parts[1], quiz = await quizBy(id);
  if (parts.length === 2) {
    if (method === "GET") return json({ quiz, participants: await all("SELECT id,username,enabled FROM participants WHERE quiz_id=? ORDER BY username COLLATE BINARY", id), rankings: await rankings(id) });
    if (method === "PUT") {
      const body = await input(request);
      if (quiz.locked) throw new AppError("已有答题记录，题目和奖励规则已锁定，请复制为新试卷", 409);
      const content = validateContent(body.content, quiz.status !== "draft");
      const updated = await statement("UPDATE quizzes SET title=?,owner=?,description=?,content=?,version=version+1,updated_at=? WHERE id=? AND locked=0 AND version=?", requireText(body.title, "试卷标题", 100), requireText(body.owner, "出题人", 40), typeof body.description === "string" ? body.description.slice(0, 1000) : "", JSON.stringify(content), Date.now(), id, Number(body.version)).run();
      if (!updated.meta.changes) throw new AppError("试卷已发生变化，请刷新后重试", 409);
      return json({ quiz: await quizBy(id) });
    }
  }
  if (parts[2] === "status" && method === "POST") {
    const body = await input(request);
    if (body.status !== "published" && body.status !== "closed") throw new AppError("状态无效");
    if (body.status === "published") validateContent(quiz.content, true);
    if (body.status === "closed" && quiz.status === "draft") throw new AppError("草稿尚未发布");
    const changed = await statement("UPDATE quizzes SET status=?,version=version+1,updated_at=? WHERE id=? AND version=?", body.status, Date.now(), id, Number(body.version)).run();
    if (!changed.meta.changes) throw new AppError("试卷已发生变化，请刷新后重试", 409);
    return json({ quiz: await quizBy(id) });
  }
  if (parts[2] === "copy" && method === "POST") {
    const copyId = uid(), now = Date.now();
    await statement("INSERT INTO quizzes (id,title,owner,description,content,status,locked,version,created_at,updated_at) VALUES (?,?,?,?,?,'draft',0,1,?,?)", copyId, `${quiz.title.slice(0, 95)} · 副本`, quiz.owner, quiz.description, JSON.stringify(quiz.content), now, now).run();
    return json({ quiz: await quizBy(copyId) }, 201);
  }
  if (parts[2] === "participants") {
    if (method === "POST" && parts.length === 3) {
      const body = await input(request);
      if (typeof body.names !== "string" || body.names.length > 50000) throw new AppError("请输入用户名，每行一个");
      const names = [...new Set(body.names.split(/\r?\n/).filter((n) => n.trim()).map(usernameOf))];
      if (!names.length || names.length > 500) throw new AppError("每次请添加 1–500 个用户名");
      const results = await db().batch(names.map((name) => statement("INSERT INTO participants (id,quiz_id,username,enabled) VALUES (?,?,?,1) ON CONFLICT(quiz_id,username) DO UPDATE SET enabled=1", uid(), id, name)));
      return json({ ok: true, count: results.length });
    }
    if (method === "PATCH" && parts.length === 4) {
      const body = await input(request);
      if (typeof body.enabled !== "boolean") throw new AppError("状态无效");
      const changed = await statement("UPDATE participants SET enabled=? WHERE id=? AND quiz_id=?", body.enabled ? 1 : 0, parts[3], id).run();
      if (!changed.meta.changes) throw new AppError("用户名不存在", 404);
      return json({ ok: true });
    }
  }
  if (parts[2] === "results" && parts[3]) {
    const submission = await one("SELECT * FROM submissions WHERE id=? AND quiz_id=?", parts[3], id);
    if (!submission) throw new AppError("答题记录不存在", 404);
    if (method === "GET") return json({ result: await resultFor(quiz, String(submission.username)) });
    if (method === "DELETE") { await statement("DELETE FROM submissions WHERE id=? AND quiz_id=?", parts[3], id).run(); return json({ ok: true }); }
    if (method === "POST" && parts[4] === "redeem") {
      if (!submission.reward) throw new AppError("该用户没有获得奖励");
      await statement("UPDATE submissions SET redeemed_at=COALESCE(redeemed_at,?) WHERE id=? AND quiz_id=?", Date.now(), parts[3], id).run();
      return json({ ok: true });
    }
  }
  throw new AppError("接口不存在", 404);
}

async function publicApi(request: Request, parts: string[]): Promise<Response> {
  const id = parts[0], quiz = await quizBy(id, true), action = parts[1], method = request.method;
  if (action === "login" && method === "POST") {
    const body = await input(request), username = usernameOf(body.username);
    if (!await one("SELECT id FROM participants WHERE quiz_id=? AND username=? AND enabled=1", id, username)) throw new AppError("你不在这份试卷的白名单中，请联系出题人", 403);
    if (quiz.status === "closed" && !await one("SELECT id FROM submissions WHERE quiz_id=? AND username=?", id, username)) throw new AppError("这份试卷已关闭答题", 403);
    return json({ ok: true }, 200, await createSession("player", id, username));
  }
  if (action === "logout" && method === "POST") {
    const s = await session(request, id);
    if (s) await statement("DELETE FROM sessions WHERE id=?", String(s.id)).run();
    return json({ ok: true }, 200, `${cookieName(id)}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  }
  if (!action && method === "GET") {
    const s = await session(request, id);
    let username: string | null = null;
    if (s && await one("SELECT id FROM participants WHERE quiz_id=? AND username=? AND enabled=1", id, String(s.username))) username = String(s.username);
    const submitted = !!username && !!await one("SELECT id FROM submissions WHERE quiz_id=? AND username=?", id, username);
    return json({ quiz: { id, title: quiz.title, owner: quiz.owner, description: quiz.description, status: quiz.status, version: quiz.version, questionCount: quiz.content.questions.length, rewards: quiz.content.rewards,
      username, submitted, ...(username && !submitted && quiz.status === "published" ? { questions: quiz.content.questions.map(({ id, text, options }) => ({ id, text, options })) } : {}) } });
  }
  const username = await player(request, id);
  if (action === "questions" && method === "GET") {
    if (quiz.status !== "published") throw new AppError("这份试卷已关闭答题", 403);
    return json({ questions: quiz.content.questions.map(({ id, text, options }) => ({ id, text, options })) });
  }
  if (action === "ranking" && method === "GET") {
    return json({ rankings: (await rankings(id)).map(({ rank, username, correct, total, score, submittedAt }) => ({ rank, username, correct, total, score, submittedAt })) });
  }
  if (action === "result" && method === "GET") {
    const result = await resultFor(quiz, username);
    if (!result) throw new AppError("你还没有提交这份试卷", 404);
    return json({ result });
  }
  if (action === "submit" && method === "POST") {
    const previous = await resultFor(quiz, username);
    if (previous) return json({ result: previous, alreadySubmitted: true });
    if (quiz.status !== "published") throw new AppError("这份试卷已关闭答题", 403);
    const body = await input(request);
    if (body.version !== quiz.version) throw new AppError("试卷内容已更新，请刷新页面重新确认答案", 409);
    const marked = grade(quiz.content, body.answers);
    const inserted = await statement("INSERT INTO submissions (id,quiz_id,username,correct,total,score,answers,reward,redeemed_at,submitted_at) SELECT ?,?,?,?,?,?,?,?,NULL,? WHERE EXISTS (SELECT 1 FROM quizzes WHERE id=? AND status='published' AND version=?) AND EXISTS (SELECT 1 FROM participants WHERE quiz_id=? AND username=? AND enabled=1) ON CONFLICT(quiz_id,username) DO NOTHING", uid(), id, username, marked.correct, marked.total, marked.score, JSON.stringify(marked.answers), marked.reward ? JSON.stringify(marked.reward) : null, Date.now(), id, quiz.version, id, username).run();
    const result = await resultFor(await quizBy(id), username);
    if (!result) throw new AppError("试卷状态或白名单已变化，请刷新后重试", 409);
    return json({ result, alreadySubmitted: !inserted.meta.changes });
  }
  throw new AppError("接口不存在", 404);
}

export async function handleApi(request: Request) {
  try {
    // Consume rejected and idempotent write bodies as well: an unread body can
    // leave the local Worker HTTP proxy waiting on its upstream request stream.
    if (!["GET", "HEAD"].includes(request.method)) requestBodies.set(request, await readBody(request));
    const url = new URL(request.url);
    if (!/^(localhost|127\.0\.0\.1)$/.test(url.hostname)) throw new AppError("本地服务只接受本机访问", 403);
    if (!["GET", "HEAD"].includes(request.method) && request.headers.get("origin") !== url.origin) throw new AppError("请求来源无效，请从本地网站操作", 403);
    const parts = url.pathname.slice(5).split("/").filter(Boolean).map(decodeURIComponent);
    if (parts[0] === "admin") return await adminApi(request, parts.slice(1));
    if (parts[0] === "quizzes" && /^[a-f0-9]{32}$/.test(parts[1] ?? "")) return await publicApi(request, parts.slice(1));
    throw new AppError("接口不存在", 404);
  } catch (error) {
    if (error instanceof AppError) return json({ error: error.message }, error.status);
    console.error("API error", error);
    return json({ error: "服务暂时遇到问题，请稍后重试" }, 500);
  }
}
