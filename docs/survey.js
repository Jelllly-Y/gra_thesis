import { materials as m } from "./assets/data.js";
import { workerOrigin } from "./config.js";

const key = "gra_thesis:supplement:v1";
const content = document.querySelector("#content");
const progress = document.querySelector(".progress-bar");
const progressFill = document.querySelector(".progress-fill");
const savedPages = ["intro", "task", "practice", "feedback", "setup", "check", "done", "stop"];
const apiOrigin = location.hostname.endsWith(".github.io") ? workerOrigin : location.origin;
let submitting = false;

function loadDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(key));
    if (draft && typeof draft.id === "string" && savedPages.includes(draft.page) && draft.answers) return draft;
  } catch { /* 新浏览器或损坏的草稿从首页开始。 */ }
  return { id: crypto.randomUUID(), page: "intro", attempts: 0, passed: false, roll: null, answers: {} };
}

let state = loadDraft();
function persist() {
  try { localStorage.setItem(key, JSON.stringify(state)); }
  catch {
    document.querySelector("#storage-warning").hidden = false;
  }
}
function go(page) {
  state.page = page;
  persist();
  render();
  window.scrollTo(0, 0);
  content.focus({ preventScroll: true });
}

async function request(action, payload) {
  if (!apiOrigin) throw new Error("问卷暂未开放。");
  const response = await fetch(new URL("/api/" + action, apiOrigin), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload), cache: "no-store", signal: AbortSignal.timeout(15000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "暂时无法连接，请重试。");
  return data;
}

// 材料均来自随程序发布的静态题库。表单值只用于比较，不拼入页面。
function paragraphs(lines) {
  return '<div class="intro-content">' + lines.map(line => '<p>' + line + '</p>').join("") + '</div>';
}
function button(text) {
  return '<div class="err-msg" role="alert"></div><div class="btn-row"><button type="button" class="btn btn-primary" id="next">' + text + '</button></div>';
}
function show(html, next) {
  content.innerHTML = html;
  if (next) content.querySelector("#next").onclick = next;
}
function message(title, detail, retry) {
  show('<h2>' + title + '</h2><p class="intro-content" id="detail"></p>' + (retry ? button("重试") : ""), retry);
  document.querySelector("#detail").textContent = detail;
}
function showStatus(status) {
  if (status === "saved") {
    if (state.page === "done") {
      message("您已填写过本问卷", "感谢您的参与。");
    } else {
      complete();
    }
    return true;
  }
  if (status === "duplicate" || status === "full") {
    message(status === "full" ? "问卷已收满" : "您已填写过本问卷", "感谢您的参与。");
    return true;
  }
  return false;
}
async function enter() {
  persist();
  show('<p class="intro-content">正在打开问卷…</p>');
  try {
    const result = await request("status", { id: state.id });
    if (!showStatus(result.status)) {
      if (state.page === "done") {
        state = { id: crypto.randomUUID(), page: "intro", attempts: 0, passed: false, roll: null, answers: {} };
        persist();
      }
      render();
    }
  } catch (error) {
    message("暂时无法打开问卷", readable(error, "请检查网络连接后重试。"), enter);
  }
}
function readable(error, fallback) {
  return error.name === "TimeoutError" || error instanceof TypeError || error instanceof SyntaxError ? fallback : error.message;
}
function choices(q, beforeOptions = "", disabled = false) {
  const options = q.options.map((option, i) => {
    const selected = state.answers[q.qid] === option;
    return '<li><label class="option-label' + (selected ? ' selected' : '') + (disabled ? ' disabled' : '') + '">' +
      '<input type="radio" name="' + q.qid + '" value="' + i + '"' + (selected ? ' checked' : '') +
      (disabled ? ' disabled' : '') + '><span>' + option + '</span></label></li>';
  }).join("");
  return '<fieldset class="question-block" id="group-' + q.qid + '"><legend class="question-title">' +
    q.question + '</legend>' + beforeOptions + '<ul class="option-list">' + options + '</ul></fieldset>';
}
function listen(questions) {
  for (const q of questions) {
    const group = document.querySelector("#group-" + q.qid);
    group.onchange = event => {
      if (event.target.name !== q.qid) return;
      state.answers[q.qid] = q.options[Number(event.target.value)];
      group.querySelectorAll(".option-label").forEach(label => label.classList.toggle("selected", label.querySelector("input").checked));
      content.querySelector(".err-msg").textContent = "";
      if (q.qid === "LX0") document.querySelector("#diceTip").textContent = "已选择押注面";
      persist();
    };
  }
}
function fail(text, focusTarget) {
  content.querySelector(".err-msg").textContent = text;
  focusTarget?.focus();
  return false;
}
function answered(questions) {
  for (const q of questions) {
    if (!q.options.includes(state.answers[q.qid])) {
      return fail("请先选择答案", document.querySelector("#group-" + q.qid + " input"));
    }
  }
  return true;
}

function diceControl() {
  const sides = [["U", "上面（U）"], ["D", "下面（D）"]].map(([side, label]) => {
    const dots = '<div class="cell"><div class="dot"></div></div>'.repeat(9);
    return '<div class="dual-col"><div aria-hidden="true" class="die" id="die' + side + '"><div class="die-grid" id="dieGrid' + side + '">' + dots +
      '</div></div><div class="dice-label">' + label + '</div></div>';
  }).join("");
  return '<div class="dice-zone"><button type="button" class="dice-btn" id="diceBtn">已确认押注，点击掷骰</button>' +
    '<div class="dual-dice">' + sides + '</div><div class="dice-result" role="status">上面（U）：<span id="dieNumU" class="point">—</span>　下面（D）：<span id="dieNumD" class="point">—</span></div>' +
    '<div class="dice-lock-tip" id="diceTip">请先在心中默念押注，再点击骰子查看结果</div></div>';
}
function showPractice() {
  const groups = m.practice.map(q => q.qid === "LX0" ? choices(q, diceControl(), !state.roll) : choices(q)).join("");
  show('<h2>练习阶段</h2>' + paragraphs([m.practiceIntro]) + groups + button("提交练习"), () => {
    if (!state.roll) return fail("请先点击骰子查看结果", document.querySelector("#diceBtn"));
    if (!answered(m.practice)) return;
    state.passed = m.practice.every(q => !q.correct || state.answers[q.qid] === q.correct);
    if (!state.passed) state.attempts++;
    go(state.attempts >= 5 ? "stop" : "feedback");
  });
  listen(m.practice);
  const dice = window.initDicePair({ onRolled(u, d) {
    state.roll = [u, d];
    persist();
    document.querySelectorAll("#group-LX0 input").forEach(input => { input.disabled = false; });
    document.querySelectorAll("#group-LX0 label").forEach(label => label.classList.remove("disabled"));
    document.querySelector("#diceTip").textContent = "请汇报您先前的押注面";
  } });
  if (state.roll) {
    dice.show(...state.roll);
    dice.lock();
    document.querySelector("#diceTip").textContent = state.answers.LX0 ? "已选择押注面" : "请汇报您先前的押注面";
  } else {
    document.querySelector("#dieNumU").textContent = "—";
    document.querySelector("#dieNumD").textContent = "—";
  }
}
function presetCard(index) {
  const preset = m.slider.presets[index];
  if (!preset) return '<div class="preset-empty">' + m.slider.emptyText + '</div>';
  const rows = preset.rows.map((row, i) => '<tr>' + row.map((cell, col) =>
    '<td' + (col === 3 && preset.highlights.includes(i) ? ' class="hl"' : '') + '>' + cell + '</td>').join("") + '</tr>').join("");
  return '<div class="preset-desc"><div class="preset-title">指令描述</div><div class="preset-text">「' + preset.instruction + '」</div></div>' +
    '<table class="preset-table"><thead><tr><th>试次</th><th>骰子结果</th><th>预输入</th><th>AI 汇报</th></tr></thead><tbody>' + rows +
    '<tr class="total"><td colspan="3">五轮总分</td><td>' + preset.total + '</td></tr></tbody></table><div class="preset-note">' + m.slider.note + '</div>';
}
function showSetup() {
  const selected = state.answers.SL1;
  const dots = m.slider.presets.map((p, i) => '<button type="button" class="slider-dot' + (selected === i ? ' active' : '') +
    '" data-slot="' + i + '" aria-label="指令 ' + (i + 1) + (p.label ? '，' + p.label : '') + '" aria-pressed="' + (selected === i) +
    '" style="left:' + (5 + i * 30) + '%"></button>').join("");
  const slider = '<fieldset class="question-block"><legend class="question-title">' + m.slider.question + '</legend>' +
    '<div class="slider-zone"><div class="slider-labels"><span class="label-left">' + m.slider.minLabel + '</span><span class="label-right">' + m.slider.maxLabel + '</span></div>' +
    '<div class="slider-wrap"><div class="slider-track"></div><div class="slider-dots">' + dots + '</div></div><div class="slider-preset" aria-live="polite">' +
    presetCard(selected) + '</div></div></fieldset>';
  show('<h2>任务设置</h2>' + paragraphs([m.setupIntro]) + m.bets.map(q => choices(q)).join("") + slider + button("下一页"), () => {
    if (!answered(m.bets)) return;
    if (!Number.isInteger(state.answers.SL1)) return fail("请点击选择你的指令", content.querySelector(".slider-dot"));
    go("check");
  });
  listen(m.bets);
  const buttons = [...content.querySelectorAll(".slider-dot")];
  for (const dot of buttons) dot.onclick = () => {
    state.answers.SL1 = Number(dot.dataset.slot);
    buttons.forEach(item => {
      item.classList.toggle("active", item === dot);
      item.setAttribute("aria-pressed", String(item === dot));
    });
    content.querySelector(".slider-preset").innerHTML = presetCard(state.answers.SL1);
    content.querySelector(".err-msg").textContent = "";
    persist();
  };
}
function complete() {
  state.answers = {};
  state.roll = null;
  delete state.pending;
  go("done");
}
async function submit() {
  if (submitting || !answered([m.check])) return;
  const next = document.querySelector("#next");
  next.disabled = true;
  next.textContent = "提交中…";
  content.querySelector("fieldset").disabled = true;
  submitting = true;
  try {
    state.pending ??= Object.fromEntries([...m.bets.map(q => q.qid), "SL1", "P_A6"].map(k => [k, state.answers[k]]));
    persist();
    const result = await request("submit", { id: state.id, answers: state.pending });
    if (!showStatus(result.status)) throw new Error("答卷尚未确认保存，请重试。");
  } catch (error) {
    content.querySelector(".err-msg").textContent = readable(error, "暂未收到保存确认。请检查网络后再次提交。");
    next.disabled = false;
    next.textContent = "提交问卷";
  } finally { submitting = false; }
}
function render() {
  const percent = Math.min(100, (savedPages.indexOf(state.page) + 1) * 100 / 6);
  progressFill.style.width = percent + "%";
  progress.setAttribute("aria-valuenow", Math.round(percent));
  switch (state.page) {
    case "intro":
      show('<h2>首页指导语</h2>' + paragraphs(m.intro) + button("开始作答"), () => go("task"));
      break;
    case "task":
      show('<h2>任务说明</h2>' + paragraphs([m.taskIntro]) + '<div class="intro-content">' +
        m.steps.map(step => '<p><strong>' + step.label + '</strong>　' +
          step.text.replace(/心中选择|报酬金额/g, "<strong>$&</strong>") + '</p>').join("") +
        '<img class="intro-img" src="./assets/process.jpg" alt="心中押注，掷骰，报告押注面，再按点数计分"></div>' + button("开始作答"), () => go("practice"));
      break;
    case "practice": showPractice(); break;
    case "feedback": {
      const material = state.passed ? m.feedback.pass : m.feedback.fail;
      show('<h2>' + material.title + '</h2>' + paragraphs([material.text]) + button(state.passed ? "下一页" : "再来一次"), () => {
        if (state.passed) return go("setup");
        state.roll = null;
        for (const q of m.practice) delete state.answers[q.qid];
        go("task");
      });
      break;
    }
    case "setup": showSetup(); break;
    case "check":
      show(choices(m.check) + button("提交问卷"), submit);
      if (state.pending) {
        content.querySelector("fieldset").disabled = true;
        content.querySelector(".err-msg").textContent = "暂未收到保存确认，请再次提交。";
      }
      listen([m.check]);
      break;
    case "done": show('<div class="thanks-page"><h1>' + m.thanks[0] + '</h1>' + paragraphs(m.thanks.slice(1)) + '</div>'); break;
    case "stop": message(m.feedback.stop.title, m.feedback.stop.text); break;
  }
}
window.addEventListener("pageshow", e => { if (e.persisted && !submitting) { state = loadDraft(); enter(); } });
enter();
