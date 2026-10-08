import QuizPlayer from "@/components/QuizPlayer";
export default async function QuizPage({ params }: { params: Promise<{ token: string }> }) { const { token } = await params; return <QuizPlayer token={token}/>; }
