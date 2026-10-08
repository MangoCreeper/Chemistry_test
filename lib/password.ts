import { scrypt } from "node:crypto";

const hex = (value: ArrayBuffer) => Array.from(new Uint8Array(value), (b) => b.toString(16).padStart(2, "0")).join("");
function derive(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, { N: 32768, r: 8, p: 3, maxmem: 48 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error); else resolve(key.toString("hex"));
    });
  });
}
function safeEqual(a: string, b: string) {
  let different = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) different |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0);
  return different === 0;
}
export async function hashPassword(password: string) {
  const salt = crypto.randomUUID().replaceAll("-", "");
  return `scrypt-v1:${salt}:${await derive(password, salt)}`;
}
export async function verifyPassword(password: string, stored: string) {
  if (/^scrypt-v1:[a-f0-9]{32}:[a-f0-9]{64}$/.test(stored)) {
    const [, salt, hash] = stored.split(":");
    return safeEqual(await derive(password, salt), hash);
  }
  // Existing local passwords remain valid; local databases are never uploaded.
  if (/^[a-f0-9]{32}:[a-f0-9]{64}$/.test(stored)) {
    const [salt, hash] = stored.split(":");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const derived = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 210000, hash: "SHA-256" }, key, 256);
    return safeEqual(hex(derived), hash);
  }
  return false;
}
