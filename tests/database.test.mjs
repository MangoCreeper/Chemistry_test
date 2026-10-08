import { test } from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { parameterizedQuery } from "../db/query.ts";
import { createDatabase } from "./helpers/postgres.mjs";

async function quizDatabase() {
  const database = await createDatabase();
  await database.exec("INSERT INTO quizzes (id,title,owner,description,content,created_at,updated_at,status) VALUES ('test','测试','小林','','{}',1791457200000,1791457200000,'published')");
  return database;
}

test("Postgres 唯一约束阻止重复名字和重复提交，时间戳支持毫秒", async () => {
  const database = await quizDatabase();
  try {
    await database.exec("INSERT INTO participants(id,quiz_id,username) VALUES('p','test','阿月')");
    await assert.rejects(database.exec("INSERT INTO participants(id,quiz_id,username) VALUES('p2','test','阿月')"));
    await database.exec("INSERT INTO submissions (id,quiz_id,username,correct,total,score,answers,submitted_at) VALUES ('s','test','阿月',1,1,100,'{}',1791457200000)");
    await assert.rejects(database.exec("INSERT INTO submissions (id,quiz_id,username,correct,total,score,answers,submitted_at) VALUES ('s2','test','阿月',0,1,0,'{}',1791457200001)"));
    assert.equal((await database.query("SELECT count(*) AS count FROM submissions")).rows[0].count, 1);
    assert.equal(Number((await database.query("SELECT created_at FROM quizzes")).rows[0].created_at), 1791457200000);
  } finally { await database.close(); }
});

test("Postgres 首次提交原子锁定规则，重置不能解除锁定", async () => {
  const database = await quizDatabase();
  try {
    assert.equal((await database.query("SELECT locked FROM quizzes")).rows[0].locked, 0);
    await database.exec("INSERT INTO submissions (id,quiz_id,username,correct,total,score,answers,submitted_at) VALUES ('s','test','阿月',1,1,100,'{}',1)");
    assert.equal((await database.query("SELECT locked FROM quizzes")).rows[0].locked, 1);
    await assert.rejects(database.exec("UPDATE quizzes SET content='changed' WHERE id='test'"));
    await assert.rejects(database.exec("UPDATE quizzes SET locked=0 WHERE id='test'"));
    await database.exec("DELETE FROM submissions WHERE id='s'");
    assert.equal((await database.query("SELECT locked FROM quizzes")).rows[0].locked, 1);
    await database.exec("UPDATE quizzes SET status='closed' WHERE id='test'");
    assert.equal((await database.query("SELECT status FROM quizzes")).rows[0].status, "closed");
  } finally { await database.close(); }
});

test("SQL 参数保留引号和问号，不拼接用户输入", () => {
  const value = "O'Brien?'; DROP TABLE quizzes; --";
  const query = new PgDialect().sqlToQuery(parameterizedQuery("SELECT * FROM quizzes WHERE title=? AND locked=?", [value, 0]));
  assert.equal(query.sql, "SELECT * FROM quizzes WHERE title=$1 AND locked=$2");
  assert.deepEqual(query.params, [value, 0]);
  assert.throws(() => parameterizedQuery("SELECT ?", []));
});
