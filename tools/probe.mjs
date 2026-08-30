// probe.mjs — 无头 Edge 冒烟测试：真实等待页面启动后，通过 CDP 读取 DOM 状态
// 用法: node tools/probe.mjs [url] [waitMs]
import { spawn } from "node:child_process";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9333;
const URL = process.argv[2] || "http://127.0.0.1:38777/";
const WAIT = Number(process.argv[3] || 4000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const edge = spawn(EDGE, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run",
  "--disable-extensions",
  `--user-data-dir=D:/dairy/.edge-probe`,
  `--remote-debugging-port=${PORT}`,
  URL
], { stdio: "ignore" });

async function getTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page");
      if (page) return page;
    } catch { /* 还没起好 */ }
    await sleep(250);
  }
  return null;
}

let target = null;
try { target = await getTarget(); } catch { }
if (!target) { console.log("PROBE: NO TARGET"); edge.kill(); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws error")); });
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params }));
});

await send("Runtime.enable");
const consoleLines = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === "Runtime.consoleAPICalled") {
    const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
    if (/error|exception/i.test(text)) consoleLines.push("CONSOLE: " + text);
  }
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};

await sleep(WAIT);

const expr = `JSON.stringify({
  title: document.title,
  shelf: !!document.querySelector('#view-bookshelf'),
  books: !!document.querySelector('.books .book'),
  diaryName: document.querySelector('.book-cover .name')?.textContent || '',
  quote: !!document.querySelector('.quote-card'),
  buttons: document.querySelectorAll('.brass-btn').length,
  appHtmlLen: document.getElementById('app') ? document.getElementById('app').innerHTML.length : -1
})`;
const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
console.log("PROBE RESULT:", r.result?.result?.value ?? JSON.stringify(r));
if (consoleLines.length) console.log(consoleLines.join("\n"));
ws.close();
try { edge.kill(); } catch { }
process.exit(0);
