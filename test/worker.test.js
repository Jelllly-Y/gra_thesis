import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { materials } from "../docs/assets/data.js";
import worker from "../worker/index.js";

function setup(extra = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../migrations/0001_supplement.sql", import.meta.url), "utf8"));
  const session = {
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      function bound(...values) {
        return { first: () => stmt.get(...values), run: () => stmt.run(...values), all: () => ({ results: stmt.all(...values) }) };
      }
      return { ...bound(), bind: bound };
    }
  };
  const env = { DB: { withSession: () => session }, IP_HASH_KEY: "test-key", EXPORT_PASSWORD: "only-tests", ...extra };
  const id = crypto.randomUUID();
  const answers = Object.fromEntries(materials.bets.map(q => [q.qid, q.options[0]]));
  answers.SL1 = 0;
  answers.P_A6 = materials.check.options[0];
  function call(path, body, ip = "192.0.2.1", otherHeaders = {}) {
    return worker.fetch(new Request("https://survey.test/api/" + path, {
      method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip, ...otherHeaders },
      body: body ? JSON.stringify(body) : undefined
    }), env);
  }
  const submit = async (respondent = id, ip, update = {}) => (await call("submit", { id: respondent, answers: { ...answers, ...update } }, ip)).json();
  return { sqlite, id, answers, call, submit };
}
test("首份提交、回执重试、入口判重和并发使用同一写入规则", async () => {
  const { sqlite, id, call, submit } = setup();
  assert.equal((await (await call("status", { id })).json()).status, "open");
  const other = crypto.randomUUID();
  const concurrent = await Promise.all([submit(), submit(other)]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), ["duplicate", "saved"]);
  const winner = concurrent[0].status === "saved" ? id : other;
  assert.equal((await submit(winner, "192.0.2.2")).status, "saved");
  assert.equal((await (await call("status", { id: crypto.randomUUID() }, "192.0.2.1", { "X-Forwarded-For": "192.0.2.250" })).json()).status, "duplicate");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM supplement_responses").get().n, 1);
  assert.match(sqlite.prepare("SELECT ip_key FROM supplement_responses").get().ip_key, /^[a-f0-9]{64}$/);
  sqlite.close();
});
test("配额收满仍承认已成功的重试", async () => {
  const { sqlite, call, submit } = setup({ RESPONSE_QUOTA: "1" });
  assert.equal((await submit()).status, "saved");
  const other = crypto.randomUUID();
  assert.equal((await submit(other, "192.0.2.2")).status, "full");
  assert.equal((await (await call("status", { id: other }, "192.0.2.2")).json()).status, "full");
  assert.equal((await submit()).status, "saved");
  sqlite.close();
});
test("入口和提交在缺少可信 IP 时关闭，错误选项不写入", async () => {
  const { sqlite, call, id, answers } = setup();
  for (const invalid of [{ SL1: null }, { SL1: 4 }, { P_A6: 1 }, { A5: "" }]) {
    assert.equal((await call("submit", { id, answers: { ...answers, ...invalid } })).status, 400);
  }
  assert.equal((await call("status", { id }, "", { "X-Forwarded-For": "192.0.2.1" })).status, 503);
  assert.equal((await call("status", { id }, "192.0.2.1", { Origin: "https://unauthorized.test" })).status, 403);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM supplement_responses").get().n, 0);
  sqlite.close();
});
test("私有 Excel 下载保留原答案，排除 IP 与练习数据", async () => {
  const { sqlite, submit, call } = setup();
  await submit();
  assert.equal((await call("export.xlsx")).status, 401);
  const exportFile = await call("export.xlsx", null, "192.0.2.2", { Authorization: "Basic " + btoa("admin:only-tests") });
  assert.equal(exportFile.status, 200);
  const parts = unzipSync(new Uint8Array(await exportFile.arrayBuffer()));
  const sheet = strFromU8(parts["xl/worksheets/sheet1.xml"]);
  assert.match(sheet, /直接汇报预输入/);
  assert.match(sheet, /<c r="H2"><v>0<\/v>/);
  assert.doesNotMatch(sheet, /ip_key|192\.0\.2|LX0|L1 正确答案/);
  sqlite.close();
});
