import { materials } from "../docs/assets/data.js";
import { workbook } from "./xlsx.js";

const uuid = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const encoder = new TextEncoder();

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
function validAnswers(answers) {
  return answers && materials.bets.every(q => q.options.includes(answers[q.qid])) &&
    Number.isInteger(answers.SL1) && answers.SL1 >= 0 && answers.SL1 < materials.slider.presets.length &&
    materials.check.options.includes(answers.P_A6);
}
async function ipKey(request, secret) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip || !secret) return null;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(ip));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
async function statusFor(db, id, ip, quota) {
  const own = await db.prepare("SELECT 1 AS found FROM supplement_responses WHERE response_id = ?").bind(id).first();
  if (own) return "saved";
  const used = await db.prepare("SELECT 1 AS found FROM supplement_responses WHERE ip_key = ?").bind(ip).first();
  if (used) return "duplicate";
  if (quota !== null) {
    const row = await db.prepare("SELECT COUNT(*) AS n FROM supplement_responses").first();
    if (row.n >= quota) return "full";
  }
  return "open";
}
async function surveyRequest(request, env, path) {
  const ip = await ipKey(request, env.IP_HASH_KEY);
  if (!ip || !env.DB) return json({ error: "问卷服务尚未准备好，请稍后重试。" }, 503);
  const quota = env.RESPONSE_QUOTA === undefined || env.RESPONSE_QUOTA === "" ? null : Number(env.RESPONSE_QUOTA);
  if (quota !== null && (!Number.isSafeInteger(quota) || quota < 0)) return json({ error: "问卷名额配置异常。" }, 503);
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) return json({ error: "提交格式有误。" }, 415);
  let data;
  try { data = await request.json(); } catch { return json({ error: "提交格式有误。" }, 400); }
  if (!data || typeof data.id !== "string" || !uuid.test(data.id)) return json({ error: "答卷编号无效。" }, 400);
  // 同一次请求的写入与后续读取保持顺序一致，包括启用了 D1 读副本的数据库。
  const db = env.DB.withSession("first-primary");
  if (path === "/api/submit") {
    if (!validAnswers(data.answers)) return json({ error: "答卷不完整，请检查选项。" }, 400);
    const a = data.answers;
    // 一条 SQL 原子执行名额检查和写入；两种 UNIQUE 约束同时处理重试与同 IP 并发。
    await db.prepare(`INSERT INTO supplement_responses (response_id, ip_key, a1,a2,a3,a4,a5, sl1, p_a6)
      SELECT ?,?,?,?,?,?,?,?,?
      WHERE ? IS NULL OR (SELECT COUNT(*) FROM supplement_responses) < ?
      ON CONFLICT DO NOTHING`)
      .bind(data.id, ip, ...materials.bets.map(q => a[q.qid]), a.SL1, a.P_A6, quota, quota).run();
  }
  return json({ status: await statusFor(db, data.id, ip, quota) });
}
async function exportAnswers(request, env) {
  if (!env.EXPORT_PASSWORD) return json({ error: "尚未配置导出权限。" }, 503);
  const expected = "Basic " + btoa("admin:" + env.EXPORT_PASSWORD);
  if (request.headers.get("Authorization") !== expected) {
    return new Response("请使用研究者账号登录。", { status: 401, headers: {
      "WWW-Authenticate": 'Basic realm="Survey export"', "Cache-Control": "no-store"
    } });
  }
  const db = env.DB.withSession("first-primary");
  const { last } = await db.prepare("SELECT COALESCE(MAX(rowid), 0) AS last FROM supplement_responses").first();
  let after = 0;
  const rows = [];
  while (after < last) {
    const { results } = await db.prepare(`SELECT rowid AS sequence, response_id, submitted_at, a1,a2,a3,a4,a5,sl1,p_a6
      FROM supplement_responses WHERE rowid > ? AND rowid <= ? ORDER BY rowid LIMIT 500`).bind(after, last).all();
    if (!results.length) break;
    for (const r of results) rows.push([r.response_id, r.submitted_at, r.a1, r.a2, r.a3, r.a4, r.a5, r.sl1, r.p_a6]);
    after = results.at(-1).sequence;
  }
  return new Response(workbook(rows), { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": 'attachment; filename="survey-responses.xlsx"', "Cache-Control": "no-store"
  } });
}
export default {
  async fetch(request, env) {
    const { pathname, origin } = new URL(request.url);
    if (!pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    const caller = request.headers.get("Origin");
    if (caller && caller !== origin && caller !== env.SURVEY_ORIGIN) return json({ error: "来源无效。" }, 403);
    let result;
    try {
      if (pathname === "/api/export.xlsx" && request.method === "GET") return await exportAnswers(request, env);
      if (!["/api/status", "/api/submit"].includes(pathname)) return json({ error: "地址无效。" }, 404);
      if (request.method === "OPTIONS") result = new Response(null, { status: 204 });
      else if (request.method === "POST") result = await surveyRequest(request, env, pathname);
      else result = json({ error: "请求方法无效。" }, 405);
    } catch {
      result = json({ error: "暂未收到保存确认，请稍后重试。" }, 503);
    }
    result.headers.set("Vary", "Origin");
    if (caller) {
      result.headers.set("Access-Control-Allow-Origin", caller);
      result.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      result.headers.set("Access-Control-Allow-Headers", "Content-Type");
    }
    return result;
  }
};
