import test from "node:test";
import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";
import { hashPassword, verifyPassword } from "../lib/password.ts";
import { checkOrigin, cookieAttributes } from "../lib/security.ts";

test("密码摘要支持云端运行，并兼容原有本地密码", async () => {
  const password = "测试密码-2026!", stored = await hashPassword(password);
  assert.ok(stored.startsWith("scrypt-v1:"));
  assert.notEqual(await hashPassword(password), stored);
  assert.equal(await verifyPassword(password, stored), true);
  assert.equal(await verifyPassword("wrong", stored), false);
  const salt = "ab".repeat(16), legacy = `${salt}:${pbkdf2Sync(password, salt, 210000, 32, "sha256").toString("hex")}`;
  assert.equal(await verifyPassword(password, legacy), true);
  assert.equal(await verifyPassword(password, "invalid"), false);
});
test("云端必须 HTTPS，写操作保持同源检查", () => {
  const request = (url, origin) => new Request(url, { method: "POST", headers: origin ? { origin } : {} });
  assert.doesNotThrow(() => checkOrigin(request("https://example.test/api/admin/setup", "https://example.test")));
  assert.doesNotThrow(() => checkOrigin(request("http://127.0.0.1:5173/api/admin/setup", "http://127.0.0.1:5173")));
  assert.throws(() => checkOrigin(request("https://example.test/api/admin/setup", "https://elsewhere.test")));
  assert.throws(() => checkOrigin(request("https://example.test/api/admin/setup")));
  assert.throws(() => checkOrigin(request("http://example.test/api/admin/setup", "http://example.test")));
});
test("云端会话和退出 Cookie 设置 Secure，保留本地 HTTP 兼容", () => {
  const cloud = new Request("https://example.test/"), local = new Request("http://127.0.0.1:5173/");
  assert.match(cookieAttributes(cloud, 86400), /HttpOnly; SameSite=Strict;.*Secure/);
  assert.match(cookieAttributes(cloud, 0), /Max-Age=0; Secure/);
  assert.equal(cookieAttributes(local, 86400).includes("Secure"), false);
});
