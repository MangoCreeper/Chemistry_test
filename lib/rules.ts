import type { QuizContent, Reward } from "./types";

export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export function requireText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new AppError(`${label}不能为空，且最多 ${max} 个字符`);
  return value.trim();
}
export function usernameOf(value: unknown): string {
  const name = requireText(value, "用户名", 40);
  if (name === "admin" || /[\r\n\x00-\x1f]/.test(name)) throw new AppError("用户名不能是 admin，也不能包含控制字符");
  return name;
}
export function validateContent(value: unknown, publishing: boolean): QuizContent {
  if (!value || typeof value !== "object") throw new AppError("试卷内容格式不正确");
  const source = value as QuizContent;
  if (!Array.isArray(source.questions) || !Array.isArray(source.rewards) || source.questions.length > 100 || source.rewards.length > 20) throw new AppError("最多支持 100 道题目和 20 档奖励");
  if (publishing && source.questions.length === 0) throw new AppError("请至少添加一道题目后再发布");
  const ids = new Set<string>();
  const questions = source.questions.map((q) => {
    if (!q || typeof q !== "object" || !Array.isArray(q.options) || q.options.length < 2 || q.options.length > 8) throw new AppError("每道题需要 2–8 个选项");
    const id = requireText(q.id, "题目标识", 80);
    if (ids.has(id)) throw new AppError("题目标识不能重复");
    ids.add(id);
    if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.options.length) throw new AppError("请为每道题选择一个正确答案");
    const text = publishing ? requireText(q.text, "题干", 1000) : String(q.text ?? "").slice(0, 1000);
    const options = q.options.map((o) => publishing ? requireText(o, "选项", 300) : String(o ?? "").slice(0, 300));
    return { id, text, options, correct: q.correct, explanation: typeof q.explanation === "string" ? q.explanation.slice(0, 2000) : "" };
  });
  const thresholds = new Set<number>();
  const rewards = source.rewards.map((r) => {
    if (!r || !Number.isInteger(r.threshold) || r.threshold < 0 || r.threshold > 100 || thresholds.has(r.threshold)) throw new AppError("奖励门槛须为 0–100 的整数，且不能重复");
    thresholds.add(r.threshold);
    return { threshold: r.threshold, name: requireText(r.name, "奖励名称", 80), description: typeof r.description === "string" ? r.description.slice(0, 500) : "" };
  }).sort((a, b) => b.threshold - a.threshold);
  return { questions, rewards };
}
export function grade(content: QuizContent, answers: unknown) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) throw new AppError("请回答所有题目后提交");
  const selected = answers as Record<string, number>;
  if (Object.keys(selected).length !== content.questions.length || !content.questions.length) throw new AppError("请回答所有题目后提交");
  let correct = 0;
  for (const q of content.questions) {
    const choice = selected[q.id];
    if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) throw new AppError("有题目未作答或选项无效");
    if (choice === q.correct) correct++;
  }
  const score = Math.round(correct / content.questions.length * 100);
  const reward: Reward | null = [...content.rewards].sort((a, b) => b.threshold - a.threshold).find((r) => score >= r.threshold) ?? null;
  return { correct, total: content.questions.length, score, reward, answers: selected };
}
export function ranked<T extends { correct: number }>(rows: T[]): (T & { rank: number })[] {
  let last = -1, rank = 0;
  return rows.map((row, index) => { if (row.correct !== last) rank = index + 1; last = row.correct; return { ...row, rank }; });
}
