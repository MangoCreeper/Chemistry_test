"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Heart, X, ArrowUpRight, LoaderCircle } from "lucide-react";

export function Brand({ children }: { children?: ReactNode }) {
  return <header className="site-header"><a className="brand" href="/" aria-label="默契好友首页"><span className="brand-mark"><Heart size={23} fill="currentColor" /></span><span>默契好友<span className="brand-sub">MOQI CLUB</span></span></a><div className="header-right">{children ?? <><span className="local-badge"><i /> <RuntimeText local="本地运行" cloud="云端运行"/></span><a className="text-link" href="/admin">管理后台 <ArrowUpRight size={16}/></a></>}</div></header>;
}
export function RuntimeText({ local, cloud }: { local: string; cloud: string }) {
  const [isLocal, setLocal] = useState<boolean | null>(null);
  useEffect(() => { setLocal(/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)); }, []);
  return <>{isLocal === null ? "专属默契空间" : isLocal ? local : cloud}</>;
}
export function Spinner({ label = "正在加载…" }: { label?: string }) { return <div className="loading"><LoaderCircle className="spin" size={24}/><span>{label}</span></div>; }
export function ErrorBox({ message }: { message: string }) { return message ? <div className="error-box" role="alert">{message}</div> : null; }
export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); const cancel = (e: Event) => { e.preventDefault(); closeRef.current(); }; dialog?.addEventListener("cancel", cancel); return () => { dialog?.removeEventListener("cancel", cancel); dialog?.close(); }; }, []);
  return <dialog ref={ref} className={`modal ${wide ? "wide" : ""}`}><div className="modal-title"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭弹窗"><X size={20}/></button></div>{children}</dialog>;
}
export function Notice({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => { if (message) { const id = setTimeout(onClose, 4000); return () => clearTimeout(id); } }, [message, onClose]);
  return message ? <div className="toast" role="status">{message}<button onClick={onClose} aria-label="关闭提示"><X size={16}/></button></div> : null;
}
export function Avatar({ name, blue = false }: { name: string; blue?: boolean }) { return <span className={`avatar ${blue ? "blue" : ""}`}>{Array.from(name)[0] ?? "友"}</span>; }
export const statusLabel = (status: string) => ({ draft: "草稿", published: "答题中", closed: "已关闭" })[status] ?? status;
