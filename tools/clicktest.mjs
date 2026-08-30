// clicktest.mjs — 用真实鼠标事件点击 release 应用，验证可交互性
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9341;
const URL = "http://127.0.0.1:38613/";
const PROFILE = "D:/dairy/.edge-clicktest";
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
const consoleMsgs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Runtime.consoleAPICalled") {
    const text = (m.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
    consoleMsgs.push(`[${m.params.type}] ${text}`);
  }
  if (m.method === "Runtime.exceptionThrown") {
    consoleMsgs.push("[exception] " + String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
  }
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

/** 在页面坐标上做真实鼠标点击 */
async function clickAt(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await sleep(60);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

await send("Runtime.enable");
await sleep(3000);

console.log("boot state:", await ev(`JSON.stringify({shelf: !!document.querySelector('#view-bookshelf'), books: document.querySelectorAll('.books .book').length})`));

// 获取第一本书的中心坐标
const bookRect = JSON.parse(await ev(`(() => { const r = document.querySelectorAll('.books .book')[0].getBoundingClientRect(); return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2}); })()`));
console.log("book1 center:", JSON.stringify(bookRect));
await clickAt(bookRect.x, bookRect.y);
await sleep(900);
console.log("after book click → book view:", await ev(`!!document.querySelector('#view-book')`));
console.log("pageNum:", await ev(`document.querySelector('.page-num')?.textContent`));

// 返回书架
await clickAt(40, 40);
await sleep(700);
console.log("back → shelf:", await ev(`!!document.querySelector('#view-bookshelf')`));

// 点击铜钮（检索）
const btn = JSON.parse(await ev(`(() => { const r = document.querySelectorAll('.brass-btn')[0].getBoundingClientRect(); return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2}); })()`));
await clickAt(btn.x, btn.y);
await sleep(600);
console.log("after brass click → drawer:", await ev(`!!document.querySelector('.drawer')`));

console.log("\n--- console ---");
consoleMsgs.forEach((m) => console.log(m));
console.log(`(${consoleMsgs.length} messages)`);

ws.close();
try { edge.kill(); } catch { }
process.exit(0);
