import { AppError } from "./rules.ts";

export function checkOrigin(request: Request) {
  const url = new URL(request.url);
  const local = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
  if (!local && url.protocol !== "https:") throw new AppError("请通过安全的网站链接访问", 403);
  if (!["GET", "HEAD"].includes(request.method) && request.headers.get("origin") !== url.origin) {
    throw new AppError("请求来源无效，请从网站内操作", 403);
  }
}
export function cookieAttributes(request: Request, duration: number) {
  return `HttpOnly; SameSite=Strict; Path=/; Max-Age=${duration}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
