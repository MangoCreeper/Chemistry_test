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

function withNetlifyEnvironment(run) {
  const values = {
    NETLIFY: "true", NETLIFY_DEV: undefined, SITE_ID: undefined,
    MOQI_NETLIFY_SITE_ORIGIN: undefined, MOQI_NETLIFY_DEPLOY_ORIGIN: undefined, MOQI_NETLIFY_DEPLOY_URL: undefined,
    URL: "https://moqi-test.netlify.app",
    DEPLOY_PRIME_URL: "https://moqi-test.netlify.app",
    DEPLOY_URL: "https://deploy-id--moqi-test.netlify.app",
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("Netlify 内部 URL 使用公开部署地址校验来源，并设置 Secure Cookie", () => {
  withNetlifyEnvironment(() => {
    const request = new Request("http://localhost:3000/api/admin/setup", {
      method: "POST", headers: { origin: process.env.URL, host: "moqi-test.netlify.app" },
    });
    assert.doesNotThrow(() => checkOrigin(request));
    assert.match(cookieAttributes(request, 86400), /HttpOnly; SameSite=Strict;.*Secure/);
    assert.match(cookieAttributes(request, 0), /Max-Age=0; Secure/);
    assert.doesNotThrow(() => checkOrigin(new Request("http://localhost:3000/api/admin/setup", {
      method: "POST", headers: { origin: process.env.URL },
    })));
  });
});

test("Netlify 预览和部署永久链接按实际访问域名保持同源", () => {
  withNetlifyEnvironment(() => {
    process.env.DEPLOY_PRIME_URL = "https://deploy-preview-2--moqi-test.netlify.app";
    for (const origin of [process.env.URL, process.env.DEPLOY_PRIME_URL, process.env.DEPLOY_URL]) {
      const request = new Request("https://localhost/api/admin/setup", {
        method: "POST", headers: { origin, host: new URL(origin).host },
      });
      assert.doesNotThrow(() => checkOrigin(request));
    }
    assert.throws(() => checkOrigin(new Request("https://localhost/api/admin/setup", {
      method: "POST", headers: { origin: process.env.URL, host: new URL(process.env.DEPLOY_PRIME_URL).host },
    })));
  });
});

test("Netlify 不接受外站、缺失来源或伪造的转发地址", () => {
  withNetlifyEnvironment(() => {
    for (const headers of [
      { origin: "https://attacker.test", host: "moqi-test.netlify.app" },
      { host: "moqi-test.netlify.app" },
      { origin: "null", host: "moqi-test.netlify.app" },
      { origin: "http://moqi-test.netlify.app", host: "moqi-test.netlify.app" },
      { origin: "https://attacker.test", "x-forwarded-host": "attacker.test" },
      { origin: "https://attacker.test", host: "attacker.test" },
      { origin: "https://attacker.test", "x-forwarded-host": "moqi-test.netlify.app, attacker.test" },
    ]) {
      assert.throws(() => checkOrigin(new Request("http://localhost:3000/api/admin/setup", { method: "POST", headers })));
    }
    delete process.env.NETLIFY;
    assert.throws(() => checkOrigin(new Request("http://localhost:3000/api/admin/setup", {
      method: "POST", headers: { origin: "https://moqi-test.netlify.app", "x-forwarded-host": "moqi-test.netlify.app" },
    })));
  });
});

test("Netlify 本地开发仍支持原来的 HTTP 地址", () => {
  withNetlifyEnvironment(() => {
    process.env.NETLIFY_DEV = "true";
    const request = new Request("http://localhost:8889/api/admin/setup", {
      method: "POST", headers: { origin: "http://localhost:8889" },
    });
    assert.doesNotThrow(() => checkOrigin(request));
    assert.equal(cookieAttributes(request, 86400).includes("Secure"), false);
  });
});

test("Netlify 函数缺少构建变量时仍使用打包时保存的公开地址", () => {
  withNetlifyEnvironment(() => {
    process.env.MOQI_NETLIFY_SITE_ORIGIN = process.env.URL;
    process.env.MOQI_NETLIFY_DEPLOY_ORIGIN = "https://deploy-preview-2--moqi-test.netlify.app";
    process.env.MOQI_NETLIFY_DEPLOY_URL = process.env.DEPLOY_URL;
    delete process.env.NETLIFY;
    delete process.env.DEPLOY_PRIME_URL;
    delete process.env.DEPLOY_URL;
    const request = new Request("http://localhost:3000/api/admin/setup", {
      method: "POST", headers: { origin: process.env.MOQI_NETLIFY_DEPLOY_ORIGIN, host: "deploy-preview-2--moqi-test.netlify.app" },
    });
    assert.doesNotThrow(() => checkOrigin(request));
    assert.match(cookieAttributes(request, 86400), /Secure/);
    delete process.env.MOQI_NETLIFY_SITE_ORIGIN;
    delete process.env.MOQI_NETLIFY_DEPLOY_ORIGIN;
    delete process.env.MOQI_NETLIFY_DEPLOY_URL;
    process.env.SITE_ID = "test-site-id";
    assert.doesNotThrow(() => checkOrigin(new Request("http://localhost:3000/api/admin/setup", {
      method: "POST", headers: { origin: process.env.URL },
    })));
  });
});
