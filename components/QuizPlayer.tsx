"use client";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, Gift, Heart, LockKeyhole, Send, Trophy, LogOut, Sparkles, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/client";
import type { PublicQuiz, Ranking, Result } from "@/lib/types";
import { Avatar, Brand, ErrorBox, Modal, Spinner } from "./common";
import { Leaderboard, ResultView } from "./ResultView";

export default function QuizPlayer({ token }: { token: string }) {
  const [quiz, setQuiz] = useState<PublicQuiz | null>(null), [result, setResult] = useState<Result | null>(null), [rankings, setRankings] = useState<Ranking[]>([]);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [answers, setAnswers] = useState<Record<string, number>>({}), [index, setIndex] = useState(0);
  const [review, setReview] = useState(false), [showRanking, setShowRanking] = useState(false), [completed, setCompleted] = useState(false);
  const base = `quizzes/${token}`;
  const storageKey = (username: string) => `moqi-draft:${token}:${username}`;
  async function refreshRanking() { try { const data = await api<{ rankings: Ranking[] }>(`${base}/ranking`); setRankings(data.rankings); } catch (e) { setError((e as Error).message); } }
  async function load() {
    const { quiz: loaded } = await api<{ quiz: PublicQuiz }>(base); setQuiz(loaded); setError("");
    if (loaded.submitted) {
      const data = await api<{ result: Result }>(`${base}/result`); setResult(data.result); await refreshRanking();
      try { localStorage.removeItem(storageKey(loaded.username!)); } catch { /* Browser storage may be disabled. */ }
    } else {
      setResult(null);
      if (loaded.username && loaded.questions) {
        try {
          const stored = JSON.parse(localStorage.getItem(storageKey(loaded.username)) || "{}") as { version?: number; answers?: Record<string, number> };
          const saved = stored.version === loaded.version ? stored.answers ?? {} : {};
          const valid: Record<string, number> = {};
          for (const q of loaded.questions) if (Number.isInteger(saved[q.id]) && saved[q.id] >= 0 && saved[q.id] < q.options.length) valid[q.id] = saved[q.id];
          setAnswers(valid); const first = loaded.questions.findIndex((q) => valid[q.id] === undefined); setIndex(first === -1 ? 0 : first);
        } catch { setAnswers({}); setIndex(0); }
      }
    }
  }
  useEffect(() => { load().catch((e) => setError(e.message)); }, [token]);
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); setError("");
    try { await api(`${base}/login`, "POST", { username: form.get("username") }); setCompleted(false); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError("");
    try { await api(`${base}/logout`, "POST", {}); setAnswers({}); setResult(null); setShowRanking(false); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function choose(questionId: string, selected: number) {
    const updated = { ...answers, [questionId]: selected }; setAnswers(updated);
    if (quiz?.username) { try { localStorage.setItem(storageKey(quiz.username), JSON.stringify({ version: quiz.version, answers: updated })); } catch { /* Continue even if storage is unavailable. */ } }
  }
  async function submit() {
    setBusy(true); setError("");
    try {
      const data = await api<{ result: Result }>(`${base}/submit`, "POST", { answers, version: quiz?.version }); setResult(data.result); setQuiz((q) => q ? { ...q, submitted: true, questions: undefined } : q); setReview(false); setCompleted(true);
      if (quiz?.username) { try { localStorage.removeItem(storageKey(quiz.username)); } catch { /* Optional storage. */ } }
      await refreshRanking(); window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const questions = quiz?.questions ?? [], question = questions[index];
  const answered = questions.filter((q) => answers[q.id] !== undefined).length;
  return <div className="player-page"><Brand>{quiz?.username ? <><span className="player-name"><Avatar name={quiz.username}/>{quiz.username}</span><button className="text-button" disabled={busy} onClick={logout} aria-label="切换答题用户名"><LogOut size={16}/><span>切换</span></button></> : <span className="local-badge"><i/> 好友专属测试</span>}</Brand>
    {!quiz ? <main className="player-main"><ErrorBox message={error}/>{!error && <Spinner/>}{error && <a className="button secondary" href="/">返回首页</a>}</main> : !quiz.username ? <main className="quiz-login"><div className="invite-top"><span className="eyebrow"><Sparkles size={15}/> 来自 {quiz.owner} 的小邀请</span><h1>{quiz.title}</h1><p>{quiz.description || "那些关于我的小事，你是不是都记得？"}</p></div><section className="invite-card panel"><div className="invite-avatar"><Avatar name={quiz.owner} blue/><Heart size={24} fill="currentColor"/></div><h2>你有多了解{quiz.owner}？</h2><p className="muted">{quiz.questionCount} 道单选题，一份专属的默契答案。</p><div className="invite-facts"><span><CheckCircle2 size={16}/> 每人一次机会</span><span><Trophy size={16}/> 好友默契排名</span></div><div className="ticket-divider"/><form onSubmit={login}><label className="field">你的名字<input name="username" required maxLength={40} autoComplete="nickname" placeholder="输入出题人邀请的用户名" autoFocus/></label><ErrorBox message={error}/><button className="button primary full" disabled={busy}>{busy ? "确认名字中…" : quiz.status === "closed" ? "查看我的结果" : "开始默契测试"}<ArrowRight size={18}/></button></form><p className="form-hint"><LockKeyhole size={13}/> 仅白名单好友可参与，无需密码。{quiz.status === "closed" && "试卷已关闭，仅已提交的好友可查看结果。"}</p></section>{quiz.rewards.length > 0 && <section className="invite-rewards"><span className="tiny-label">A LITTLE SURPRISE</span><h3><Gift size={18}/> 还有一点小惊喜</h3>{quiz.rewards.map((reward) => <div key={reward.threshold}><span>默契度 ≥ {reward.threshold}%</span><strong>{reward.name}</strong></div>)}<p>达到多个档位时，只获得最高一档奖励。</p></section>}</main>
      : result ? <main className="result-main"><div className="result-page-heading"><span className="eyebrow">{completed ? "答题完成 · 默契已揭晓" : "欢迎回来 · 你的默契记录"}</span><p>每一份了解，都值得被看见。</p></div><ErrorBox message={error}/><ResultView result={result} owner={quiz.owner} title={quiz.title} rankings={rankings} onRefresh={() => { api<{ result: Result }>(`${base}/result`).then((data) => setResult(data.result)).catch((e) => setError(e.message)); refreshRanking(); }}/><div className="result-footer"><Heart size={16}/> 和朋友聊聊答案背后的故事吧。</div></main>
      : quiz.status !== "published" ? <main className="player-main"><section className="panel closed-card"><LockKeyhole size={32}/><h1>这份试卷已关闭答题</h1><p>请联系出题人重新开放。</p><button className="button secondary" onClick={() => load().catch((e) => setError(e.message))}>刷新状态</button></section><ErrorBox message={error}/></main>
      : !question ? <main className="player-main"><ErrorBox message={error || "题目暂时无法加载，请刷新页面。"}/></main>
      : <main className="answer-main"><div className="answer-heading"><span className="eyebrow">{quiz.owner}的默契测试</span><h1>{quiz.title}</h1><p>慢慢想，答案就藏在我们的日常里。</p></div><div className="answer-progress"><div><span>第 <strong>{index + 1}</strong> / {questions.length} 题</span><span>已答 {answered} 题</span></div><div className="progress-track"><i style={{ width: `${answered / questions.length * 100}%` }}/></div></div><ErrorBox message={error}/><section className="question-card panel"><div className="question-title"><span className="question-title-heart"><Heart size={24}/></span><span className="tiny-label">QUESTION {String(index + 1).padStart(2, "0")}</span><h2>{question.text}</h2></div><div className="player-options" role="radiogroup" aria-label={question.text}>{question.options.map((option, i) => <button key={i} role="radio" aria-checked={answers[question.id] === i} className={`player-option ${answers[question.id] === i ? "chosen" : ""}`} onClick={() => choose(question.id, i)} disabled={busy}><span className="option-letter">{String.fromCharCode(65 + i)}</span><span>{option}</span><span className="option-check">{answers[question.id] === i && <Check size={18}/>}</span></button>)}</div><div className="answer-navigation"><button className="button secondary" disabled={index === 0 || busy} onClick={() => setIndex(index - 1)}><ArrowLeft size={16}/> 上一题</button>{index < questions.length - 1 ? <button className="button primary" disabled={busy} onClick={() => setIndex(index + 1)}>下一题 <ArrowRight size={16}/></button> : <button className="button primary" disabled={busy} onClick={() => { setError(""); setReview(true); }}>检查并提交 <Send size={16}/></button>}</div></section><div className="question-dots" aria-label="题目导航">{questions.map((q, i) => <button key={q.id} className={`${answers[q.id] !== undefined ? "answered" : ""} ${index === i ? "current" : ""}`} onClick={() => setIndex(i)} aria-label={`跳到第 ${i + 1} 题${answers[q.id] !== undefined ? "，已作答" : "，未作答"}`} aria-current={index === i ? "step" : undefined}>{i + 1}</button>)}</div><div className="answer-bottom-note"><span><LockKeyhole size={13}/> 已选答案在当前浏览器自动保存</span><button className="text-button" onClick={async () => { await refreshRanking(); setShowRanking(true); }}><Trophy size={15}/> 看看默契榜</button></div></main>}
    {review && quiz && <Modal title="准备好揭晓默契了吗？" onClose={() => { if (!busy) setReview(false); }}><p className="muted">已回答 {answered} / {questions.length} 道题。提交后无法修改答案，每人只有一次机会。</p><div className="submission-review">{questions.map((q, i) => <button key={q.id} className={answers[q.id] === undefined ? "unanswered" : ""} disabled={busy} onClick={() => { setIndex(i); setReview(false); }}><span className="review-index">{i + 1}</span><span><strong>{q.text}</strong><small>{answers[q.id] === undefined ? "还未作答 · 点击返回" : `${String.fromCharCode(65 + answers[q.id])}. ${q.options[answers[q.id]]}`}</small></span>{answers[q.id] !== undefined && <CheckCircle2 size={17}/>}</button>)}</div><ErrorBox message={error}/>{answered < questions.length && <div className="error-box">还有 {questions.length - answered} 道题未作答，请先完成。</div>}<div className="modal-actions"><button className="button secondary" disabled={busy} onClick={() => setReview(false)}>继续检查</button><button className="button primary" disabled={busy || answered !== questions.length} onClick={submit}>{busy ? "正在揭晓…" : "确认提交"}<Heart size={17}/></button></div></Modal>}
    {showRanking && <Modal title="好友默契榜" onClose={() => setShowRanking(false)} wide><Leaderboard rows={rankings} username={quiz?.username ?? undefined} onRefresh={refreshRanking}/></Modal>}
  </div>;
}
