import { getDb } from "../db/index.ts";
import { parameterizedQuery } from "../db/query.ts";
import { AppError, grade, ranked, requireText, usernameOf, validateContent } from "./rules.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import { checkOrigin, cookieAttributes } from "./security.ts";
import type { Quiz, QuizContent, Ranking, Result } from "./types.ts";

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
function statement(query: string, ...args: (string | number | null)[]) {
  return { run: async () => {
    const result = await getDb().execute(parameterizedQuery(query, args));
    return { rows: result.rows as Row[], changes: result.rowCount ?? 0 };
  } };
}
async function one(query: string, ...args: (string | number | null)[]) { return (await statement(query, ...args).run()).rows[0] ?? null; }
async function all(query: string, ...args: (string | number | null)[]) { return (await statement(query, ...args).run()).rows; }
const uid = () => crypto.randomUUID().replaceAll("-", "");
const hex = (array: ArrayBuffer) => Array.from(new Uint8Array(array), (b) => b.toString(16).padStart(2, "0")).join("");
async function digest(value: string) { return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))); }
function cookieName(quizId?: string) { return quizId ? `moqi_q_${quizId}` : "moqi_admin"; }
function cookieValue(request: Request, name: string) { return request.headers.get("cookie")?.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1); }
async function session(request: Request, quizId?: string) {
  const token = cookieValue(request, cookieName(quizId));
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const s = await one("SELECT * FROM sessions WHERE id=? AND expires_at>?", await digest(token), Date.now());
  if (!s || (quizId ? s.role !== "player" || s.quiz_id !== quizId : s.role !== "admin")) return null;
  return s;
}
async function createSession(request: Request, role: "admin" | "player", quizId?: string, username?: string) {
  const token = uid() + uid(), duration = role === "admin" ? 86400 : 604800;
  await statement("DELETE FROM sessions WHERE expires_at <= ?", Date.now()).run();
  await statement("INSERT INTO sessions (id,role,quiz_id,username,expires_at) VALUES (?,?,?,?,?)", await digest(token), role, quizId ?? null, username ?? null, Date.now() + duration * 1000).run();
  return `${cookieName(quizId)}=${token}; ${cookieAttributes(request, duration)}`;
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
      const inserted = await statement("INSERT INTO administrators (id,password) VALUES (1,?) ON CONFLICT(id) DO NOTHING", await hashPassword(password)).run();
      if (!inserted.changes) throw new AppError("管理员已初始化，请直接登录", 409);
    } else {
      const key = "admin", now = Date.now(), failure = await one("SELECT count,since FROM login_attempts WHERE id=?", key);
      if (failure && now - Number(failure.since) < 60000 && Number(failure.count) >= 10) throw new AppError("尝试次数较多，请一分钟后重试", 429);
      const stored = String(admin?.password ?? "");
      if (!admin || !await verifyPassword(password, stored)) {
        await statement("INSERT INTO login_attempts (id,count,since) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN login_attempts.since>? THEN login_attempts.count+1 ELSE 1 END,since=CASE WHEN login_attempts.since>? THEN login_attempts.since ELSE EXCLUDED.since END", key, now, now - 60000, now - 60000).run();
        throw new AppError("账号或密码不正确", 401);
      }
      await statement("DELETE FROM login_attempts WHERE id=?", key).run();
    }
    return json({ ok: true }, 200, await createSession(request, "admin"));
  }
  const admin = await session(request);
  if (!admin) throw new AppError("请先登录管理员账号", 401);
  if (parts[0] === "logout" && method === "POST") {
    await statement("DELETE FROM sessions WHERE id=?", String(admin.id)).run();
    return json({ ok: true }, 200, `${cookieName()}=; ${cookieAttributes(request, 0)}`);
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
    if (method === "GET") return json({ quiz, participants: await all('SELECT id,username,enabled FROM participants WHERE quiz_id=? ORDER BY username COLLATE "C"', id), rankings: await rankings(id) });
    if (method === "PUT") {
      const body = await input(request);
      if (quiz.locked) throw new AppError("已有答题记录，题目和奖励规则已锁定，请复制为新试卷", 409);
      const content = validateContent(body.content, quiz.status !== "draft");
      const updated = await statement("UPDATE quizzes SET title=?,owner=?,description=?,content=?,version=version+1,updated_at=? WHERE id=? AND locked=0 AND version=?", requireText(body.title, "试卷标题", 100), requireText(body.owner, "出题人", 40), typeof body.description === "string" ? body.description.slice(0, 1000) : "", JSON.stringify(content), Date.now(), id, Number(body.version)).run();
      if (!updated.changes) throw new AppError("试卷已发生变化，请刷新后重试", 409);
      return json({ quiz: await quizBy(id) });
    }
  }
  if (parts[2] === "status" && method === "POST") {
    const body = await input(request);
    if (body.status !== "published" && body.status !== "closed") throw new AppError("状态无效");
    if (body.status === "published") validateContent(quiz.content, true);
    if (body.status === "closed" && quiz.status === "draft") throw new AppError("草稿尚未发布");
    const changed = await statement("UPDATE quizzes SET status=?,version=version+1,updated_at=? WHERE id=? AND version=?", body.status, Date.now(), id, Number(body.version)).run();
    if (!changed.changes) throw new AppError("试卷已发生变化，请刷新后重试", 409);
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
      await statement(`INSERT INTO participants (id,quiz_id,username,enabled) VALUES ${names.map(() => "(?,?,?,1)").join(",")} ON CONFLICT(quiz_id,username) DO UPDATE SET enabled=1`, ...names.flatMap((name) => [uid(), id, name])).run();
      return json({ ok: true, count: names.length });
    }
    if (method === "PATCH" && parts.length === 4) {
      const body = await input(request);
      if (typeof body.enabled !== "boolean") throw new AppError("状态无效");
      const changed = await statement("UPDATE participants SET enabled=? WHERE id=? AND quiz_id=?", body.enabled ? 1 : 0, parts[3], id).run();
      if (!changed.changes) throw new AppError("用户名不存在", 404);
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
    return json({ ok: true }, 200, await createSession(request, "player", id, username));
  }
  if (action === "logout" && method === "POST") {
    const s = await session(request, id);
    if (s) await statement("DELETE FROM sessions WHERE id=?", String(s.id)).run();
    return json({ ok: true }, 200, `${cookieName(id)}=; ${cookieAttributes(request, 0)}`);
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
    const inserted = await statement("WITH locked_quiz AS (UPDATE quizzes SET locked=1 WHERE id=? AND status='published' AND version=? AND EXISTS (SELECT 1 FROM participants WHERE quiz_id=? AND username=? AND enabled=1) RETURNING id) INSERT INTO submissions (id,quiz_id,username,correct,total,score,answers,reward,redeemed_at,submitted_at) SELECT ?,?,?,?,?,?,?,?,NULL,? FROM locked_quiz ON CONFLICT(quiz_id,username) DO NOTHING", id, quiz.version, id, username, uid(), id, username, marked.correct, marked.total, marked.score, JSON.stringify(marked.answers), marked.reward ? JSON.stringify(marked.reward) : null, Date.now()).run();
    const result = await resultFor(await quizBy(id), username);
    if (!result) throw new AppError("试卷状态或白名单已变化，请刷新后重试", 409);
    return json({ result, alreadySubmitted: !inserted.changes });
  }
  throw new AppError("接口不存在", 404);
}

export async function handleApi(request: Request) {
  try {
    // Consume rejected and idempotent write bodies as well: an unread body can
    // leave the local Worker HTTP proxy waiting on its upstream request stream.
    if (!["GET", "HEAD"].includes(request.method)) requestBodies.set(request, await readBody(request));
    const url = new URL(request.url);
    checkOrigin(request);
    const parts = url.pathname.slice(5).split("/").filter(Boolean).map(decodeURIComponent);
    if (parts[0] === "admin") return await adminApi(request, parts.slice(1));
    if (parts[0] === "quizzes" && /^[a-f0-9]{32}$/.test(parts[1] ?? "")) return await publicApi(request, parts.slice(1));
    throw new AppError("接口不存在", 404);
  } catch (error) {
    if (error instanceof AppError) return json({ error: error.message }, error.status);
    console.error("API request failed", error instanceof Error ? error.name : "UnknownError");
    return json({ error: "服务暂时遇到问题，请稍后重试" }, 500);
  }
}
