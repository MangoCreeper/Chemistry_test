import { test } from "node:test";
import assert from "node:assert/strict";
import { grade, ranked, usernameOf, validateContent } from "../lib/rules.ts";
const content = { questions: Array.from({ length: 10 }, (_, i) => ({ id: `q${i}`, text: `问题${i}`, options: ["是", "否"], correct: 0, explanation: "" })), rewards: [{ threshold: 100, name: "电影券", description: "" }, { threshold: 80, name: "奶茶券", description: "" }] };
function answers(count) { return Object.fromEntries(content.questions.map((q, i) => [q.id, i < count ? 0 : 1])); }
test("评分、门槛及最高档奖励", () => {
  assert.deepEqual([grade(content, answers(0)).score, grade(content, answers(7)).reward, grade(content, answers(8)).reward.name, grade(content, answers(10)).reward.name], [0, null, "奶茶券", "电影券"]);
  assert.equal(grade(content, answers(8)).correct, 8);
  assert.equal(grade({ ...content, rewards: [] }, answers(10)).reward, null);
  assert.equal(grade({ ...content, questions: content.questions.slice(0, 3) }, { q0: 0, q1: 0, q2: 1 }).score, 67);
});
test("缺失答案、越界答案和额外题目被拒绝", () => {
  assert.throws(() => grade(content, {})); assert.throws(() => grade(content, { ...answers(10), q0: 2 }));
  assert.throws(() => grade(content, { ...answers(10), extra: 0 })); assert.throws(() => grade(content, { ...answers(10), q1: "0" }));
  assert.throws(() => grade({ ...content, questions: [] }, {}));
});
test("白名单用户名精确匹配规则", () => { assert.equal(usernameOf("  小林  "), "小林"); assert.notEqual(usernameOf("Alice"), usernameOf("alice")); assert.throws(() => usernameOf("admin")); assert.throws(() => usernameOf("  ")); assert.throws(() => usernameOf("a\nb")); });
test("发布验证和草稿保存", () => {
  assert.equal(validateContent({ questions: [], rewards: [] }, false).questions.length, 0); assert.throws(() => validateContent({ questions: [], rewards: [] }, true));
  assert.throws(() => validateContent({ ...content, rewards: [{ threshold: 80, name: "A" }, { threshold: 80, name: "B" }] }, true));
  assert.throws(() => validateContent({ ...content, questions: [{ ...content.questions[0], correct: 2 }] }, true));
  assert.throws(() => validateContent({ ...content, questions: [{ ...content.questions[0], text: "" }] }, true));
  assert.throws(() => validateContent({ ...content, questions: [content.questions[0], content.questions[0]] }, true));
  assert.throws(() => validateContent({ ...content, rewards: [{ threshold: -1, name: "A" }] }, true));
});
test("同分采用 1、1、3 排名", () => { assert.deepEqual(ranked([{ correct: 10 }, { correct: 10 }, { correct: 8 }, { correct: 0 }]).map((r) => r.rank), [1, 1, 3, 4]); });
