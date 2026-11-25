import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { materials } from "../docs/assets/data.js";
import worker from "../worker/index.js";

function migrate(sqlite, file) {
  sqlite.exec(readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"));
}
function setup(extra = {}) {
  const sqlite = new DatabaseSync(":memory:");
  migrate(sqlite, "0001_supplement.sql");
  migrate(sqlite, "0002_response_metrics.sql");
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
  const answers = { SL1: 0, P_A6: materials.check.options[0], duration_seconds: 92, practice_retry_count: 2 };
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
  for (const invalid of [{ SL1: null }, { SL1: 4 }, { P_A6: 1 }, { practice_retry_count: 5 },
    { practice_retry_count: -1 }, { practice_retry_count: 1.5 }, { duration_seconds: -1 }, { duration_seconds: undefined }]) {
    assert.equal((await call("submit", { id, answers: { ...answers, ...invalid } })).status, 400);
  }
  assert.equal((await call("status", { id }, "", { "X-Forwarded-For": "192.0.2.1" })).status, 503);
  assert.equal((await call("status", { id }, "192.0.2.1", { Origin: "https://unauthorized.test" })).status, 403);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM supplement_responses").get().n, 0);
  sqlite.close();
});
test("Excel 导出两项指标、指令和理解答案，排除五轮选择与 IP", async () => {
  const { sqlite, submit, call } = setup();
  await submit();
  assert.equal((await call("export.xlsx")).status, 401);
  const exportFile = await call("export.xlsx", null, "192.0.2.2", { Authorization: "Basic " + btoa("admin:only-tests") });
  assert.equal(exportFile.status, 200);
  const parts = unzipSync(new Uint8Array(await exportFile.arrayBuffer()));
  const sheet = strFromU8(parts["xl/worksheets/sheet1.xml"]);
  assert.match(sheet, /直接汇报预输入/);
  assert.match(sheet, /<c r="C2"><v>0<\/v>/);
  assert.match(sheet, /<c r="E2"><v>92<\/v>/);
  assert.match(sheet, /<c r="F2"><v>2<\/v>/);
  assert.doesNotMatch(sheet, /ip_key|192\.0\.2|LX0|<t>A[1-5]<\/t>|上面（U）|下面（D）/);
  sqlite.close();
});
test("旧页面提示刷新，旧草稿保留未知耗时；重复提交不会改写指标", async () => {
  const { sqlite, call, id, submit } = setup();
  assert.equal((await call("submit", { id, answers: { A1: "上面（U）", SL1: 0, P_A6: materials.check.options[0] } })).status, 409);
  assert.equal((await submit(id, undefined, { duration_seconds: null })).status, "saved");
  assert.equal((await submit(id, undefined, { duration_seconds: 120, practice_retry_count: 0 })).status, "saved");
  const row = sqlite.prepare("SELECT * FROM supplement_responses").get();
  assert.equal(row.duration_seconds, null);
  assert.equal(row.practice_retry_count, 2);
  assert.ok(!("a1" in row));
  sqlite.close();
});
test("迁移保留旧库的答卷编号、判重和已有指标，缺失值留空", () => {
  for (const manual of [false, true]) {
    const db = new DatabaseSync(":memory:");
    if (manual) {
      db.exec("CREATE TABLE supplement_responses (response_id, ip_key, submitted_at, sl1, p_a6, duration_seconds, practice_retry_count)");
      db.exec("INSERT INTO supplement_responses VALUES ('id','ip','time',0,'answer',60,0)");
    } else {
      migrate(db, "0001_supplement.sql");
      db.exec("INSERT INTO supplement_responses VALUES ('id','ip','time','U','D','U','D','U',0,'answer')");
    }
    migrate(db, "0002_response_metrics.sql");
    const row = db.prepare("SELECT * FROM supplement_responses").get();
    assert.deepEqual({ ...row }, { response_id: "id", ip_key: "ip", submitted_at: "time", sl1: 0,
      p_a6: "answer", duration_seconds: manual ? 60 : null, practice_retry_count: manual ? 0 : null });
    db.close();
  }
});
