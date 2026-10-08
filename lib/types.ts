export type Question = { id: string; text: string; options: string[]; correct: number; explanation: string };
export type Reward = { threshold: number; name: string; description: string };
export type QuizContent = { questions: Question[]; rewards: Reward[] };
export type Quiz = { id: string; title: string; owner: string; description: string; content: QuizContent; status: "draft" | "published" | "closed"; locked: boolean; version: number; createdAt: number; updatedAt: number; participants?: number; submissions?: number };
export type Participant = { id: string; username: string; enabled: number };
export type Ranking = { id: string; username: string; correct: number; total: number; score: number; rank: number; reward: Reward | null; redeemedAt: number | null; submittedAt: number };
export type Result = Ranking & { answers: { question: string; options: string[]; selected: number; correct: number; explanation: string }[] };
export type PublicQuiz = { id: string; title: string; owner: string; description: string; status: string; version: number; questionCount: number; rewards: Reward[]; username: string | null; submitted: boolean; questions?: Omit<Question, "correct" | "explanation">[] };
