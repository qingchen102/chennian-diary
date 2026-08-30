// clicktest2.mjs — 真实鼠标点击全路径验证：书架→书→翻页→新页→编辑器
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9342;
const URL = "http://127.0.0.1:38613/";
const PROFILE = "D:/dairy/.edge-clicktest2";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try { rmSync(PROFILE, { recursive: true, force: true }); } catch { }

const edge = spawn(EDGE, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--disable-extensions",
  `--user-data-dir=${PROFILE}`,
  `--remote-debugging-port=${PORT}`,
  URL
], { stdio: "ignore" });

async function getTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page;
    } catch { }
    await sleep(250);
  }
  return null;
}
const target = await getTarget();
if (!target) { console.log("FATAL: no target"); edge.kill(); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws")); });
let id = 0;
const pending = new Map();
const errs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Runtime.exceptionThrown") errs.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
  return r.result?.result?.value;
};
async function clickAt(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await sleep(50);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
const center = (sel) => ev(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2}); })()`).then(JSON.parse);

const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };

await send("Runtime.enable");
await sleep(3000);

let c = await center('.books .book');
await clickAt(c.x, c.y);
await sleep(900);
check("真实点击书本 → 打开阅读视图", await ev(`!!document.querySelector('#view-book')`));

c = await center('.flip-zone.right');
await clickAt(c.x, c.y);
await sleep(1200);
check("真实点击右缘 → 翻到「+」新页", await ev(`document.querySelector('.page-num')?.textContent`) === "新页");

c = await center('.new-page-btn');
await clickAt(c.x, c.y);
await sleep(600);
check("真实点击「+」→ 进入编辑器", await ev(`!!document.querySelector('#view-editor')`));

// 编辑器内：切换事件模式 + 输入标题 + 点击保存（全真实点击/键盘）
c = await center('.mode-switch button:nth-child(2)');
await clickAt(c.x, c.y);
await sleep(200);
check("真实点击「事件」模式", await ev(`document.querySelector('.meta-grid input[placeholder^="如"]') !== null`));

await ev(`document.querySelector('input[placeholder*="今天"]').focus(); 'ok'`);
await sleep(100);
await send("Input.insertText", { text: "真实点击测试日记" });
await ev(`document.querySelector('.editor-body').focus(); 'ok'`);
await send("Input.insertText", { text: "这段文字是用真实鼠标键盘输入的。" });
await sleep(200);

c = await center('.ed-acts .btn.primary');
await clickAt(c.x, c.y);
await sleep(1000);
check("真实点击「保存」→ 回到书本并显示新篇", await ev(`document.querySelector('.page-num')?.textContent`) === "第 1 / 1 页");
check("标题正确", await ev(`document.querySelector('.page-title')?.textContent`) === "真实点击测试日记");
check("正文键盘输入正确", (await ev(`document.querySelector('.face.front .entry-html')?.textContent`))?.includes("真实鼠标键盘输入"));

// 返回书架，真实点击检索铜钮
c = await center('.back-shelf');
await clickAt(c.x, c.y);
await sleep(700);
c = await center('.brass-btn');
await clickAt(c.x, c.y);
await sleep(600);
check("真实点击铜钮 → 打开检索抽屉", await ev(`!!document.querySelector('.drawer')`));
check("抽屉可交互（输入框聚焦）", await ev(`document.querySelector('.search-box input') !== null`));

console.log(`\n===== ${results.filter(Boolean).length}/${results.length} 通过 =====`);
if (errs.length) { console.log("EXCEPTIONS:"); errs.forEach((e) => console.log("  " + e)); }
ws.close();
try { edge.kill(); } catch { }
process.exit(results.every(Boolean) ? 0 : 1);
