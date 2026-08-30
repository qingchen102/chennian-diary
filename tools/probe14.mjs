// probe14.mjs — 调试目录按钮
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9357;
const PROFILE = "D:/dairy/.edge-probe14";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { rmSync(PROFILE, { recursive: true, force: true }); } catch { }
const edge = spawn(EDGE, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--disable-extensions",
  "--window-size=1500,950", `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`,
  "http://127.0.0.1:38777/"
], { stdio: "ignore" });
let target = null;
for (let i = 0; i < 60 && !target; i++) {
  try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = list.find((t) => t.type === "page" && !t.url.startsWith("about:")); } catch { }
  if (!target) await sleep(250);
}
if (!target) { console.log("no target"); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws")); });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) return "EXC:" + String(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 300); return r.result?.result?.value; };
async function clickAt(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await sleep(40);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
await send("Runtime.enable");
await sleep(3000);
let c = JSON.parse(await ev(`(() => { const el = document.querySelector('.books .book'); const r = el.getBoundingClientRect(); return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2}); })()`));
await clickAt(c.x, c.y);
await sleep(900);
console.log("打开后 page-num:", await ev(`document.querySelector('.page-num')?.textContent`));
console.log("toc-btn rect:", await ev(`(() => { const el = document.querySelector('.toc-btn'); if (!el) return 'NULL'; const r = el.getBoundingClientRect(); return JSON.stringify({x: r.x, y: r.y, w: r.width, h: r.height, vis: getComputedStyle(el).visibility, disp: getComputedStyle(el).display}); })()`));
c = JSON.parse(await ev(`(() => { const el = document.querySelector('.toc-btn'); const r = el.getBoundingClientRect(); return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2}); })()`));
await clickAt(c.x, c.y);
await sleep(600);
console.log("点击后 page-num:", await ev(`document.querySelector('.page-num')?.textContent`));
console.log("toc-item 数:", await ev(`document.querySelectorAll('.toc-item').length`));
console.log("toc 页 html 前 120:", await ev(`document.querySelector('.pcol .toc-title')?.parentElement?.parentElement?.outerHTML?.slice(0,120)`));
// 直接调 jumpToToc（无法访问闭包）→ 模拟：点目录项
c = JSON.parse(await ev(`(() => { const el = document.querySelector('.toc-item'); const r = el.getBoundingClientRect(); return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2}); })()`).catch(() => "null"));
console.log("toc-item rect:", c);
ws.close(); try { edge.kill(); } catch { }
process.exit(0);
