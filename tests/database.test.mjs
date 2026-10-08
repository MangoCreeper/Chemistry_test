import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
const migration = readdirSync(new URL("../drizzle/", import.meta.url)).find((name) => name.startsWith("0000_") && name.endsWith(".sql"));
function createDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), "utf8"));
  db.prepare("INSERT INTO quizzes (id,title,owner,description,content,created_at,updated_at,status) VALUES ('test','测试','小林','','{}',1,1,'published')").run();
  return db;
}
test("数据库唯一约束阻止重复名字和重复提交", () => {
  const db = createDatabase();
  db.prepare("INSERT INTO participants(id,quiz_id,username) VALUES('p','test','阿月')").run();
  assert.throws(() => db.prepare("INSERT INTO participants(id,quiz_id,username) VALUES('p2','test','阿月')").run());
  db.prepare("INSERT INTO submissions (id,quiz_id,username,correct,total,score,answers,reward,submitted_at) VALUES ('s','test','阿月',1,1,100,'{}','奖券',1)").run();
  assert.throws(() => db.prepare("INSERT INTO submissions (id,quiz_id,username,correct,total,score,answers,submitted_at) VALUES ('s2','test','阿月',0,1,0,'{}',2)").run());
  assert.equal(db.prepare("SELECT count(*) AS n FROM submissions").get().n, 1); db.close();
});
test("首次提交原子锁定规则，重置不会解除锁定", () => {
  const db = createDatabase(); assert.equal(db.prepare("SELECT locked FROM quizzes").get().locked, 0);
  db.prepare("INSERT INTO submissions (id,quiz_id,username,correct,total,score,answers,submitted_at) VALUES ('s','test','阿月',1,1,100,'{}',1)").run();
  assert.equal(db.prepare("SELECT locked FROM quizzes").get().locked, 1);
  assert.throws(() => db.prepare("UPDATE quizzes SET content='changed' WHERE id='test'").run());
  db.prepare("DELETE FROM submissions WHERE id='s'").run();
  assert.equal(db.prepare("SELECT locked FROM quizzes").get().locked, 1);
  db.prepare("UPDATE quizzes SET status='closed' WHERE id='test'").run();
  assert.equal(db.prepare("SELECT status FROM quizzes").get().status, "closed"); db.close();
});
