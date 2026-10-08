import { AppError } from "./rules.ts";

function httpsOrigin(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.origin : undefined;
  } catch { return undefined; }
}

function requestOrigin(request: Request) {
  const url = new URL(request.url);
  const netlify = process.env.NETLIFY === "true" || !!process.env.SITE_ID || !!process.env.MOQI_NETLIFY_SITE_ORIGIN;
  if (!netlify || process.env.NETLIFY_DEV === "true") return url.origin;

  // Next.js may expose the internal server URL after Netlify's proxy forwards a request.
  // Only server-provided deploy URLs can establish a trusted public origin.
  const origins = [
    process.env.MOQI_NETLIFY_DEPLOY_ORIGIN ?? process.env.DEPLOY_PRIME_URL,
    process.env.MOQI_NETLIFY_SITE_ORIGIN ?? process.env.URL,
    process.env.MOQI_NETLIFY_DEPLOY_URL ?? process.env.DEPLOY_URL,
  ]
    .map(httpsOrigin).filter((origin): origin is string => !!origin);
  for (const header of ["host", "x-forwarded-host"]) {
    const host = request.headers.get(header);
    const candidate = host ? httpsOrigin(`https://${host}`) : undefined;
    if (candidate && origins.includes(candidate)) return candidate;
  }
  if (origins.includes(url.origin)) return url.origin;
  return origins[0] ?? url.origin;
}

export function checkOrigin(request: Request) {
  const url = new URL(requestOrigin(request));
  const local = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
  if (!local && url.protocol !== "https:") throw new AppError("请通过安全的网站链接访问", 403);
  if (!["GET", "HEAD"].includes(request.method) && request.headers.get("origin") !== url.origin) {
    throw new AppError("请求来源无效，请从网站内操作", 403);
  }
}
export function cookieAttributes(request: Request, duration: number) {
  return `HttpOnly; SameSite=Strict; Path=/; Max-Age=${duration}${new URL(requestOrigin(request)).protocol === "https:" ? "; Secure" : ""}`;
}
