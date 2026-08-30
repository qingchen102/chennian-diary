// probe18.mjs — 表情章回归 + 删除自选印章
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9361;
const PROFILE = "D:/dairy/.edge-probe18";
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
const center = (sel) => ev(`(() => { const el = document.querySelector('${sel}'); if (!el) return null; const r = el.getBoundingClientRect(); return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2}); })()`).then((s) => (s ? JSON.parse(s) : null));
await send("Runtime.enable");
await sleep(3000);
let c = await center('.books .book');
await clickAt(c.x, c.y);
await sleep(900);
c = await center('.flip-zone.right');
await clickAt(c.x, c.y);
await sleep(1000);
c = await center('.new-page-btn');
await clickAt(c.x, c.y);
await sleep(700);
await ev(`document.querySelector('input[placeholder*="今天"]').focus(); 'ok'`);
await send("Input.insertText", { text: "表情章测试" });
await ev(`document.querySelector('.editor-body').focus(); 'ok'`);
await send("Input.insertText", { text: "测试表情章。", });
await sleep(400);
// 点第一个表情章
c = await center('.mood-row button[data-mood]');
await clickAt(c.x, c.y);
await sleep(200);
console.log("表情章选中:", await ev(`document.querySelector('.mood-row button[data-mood].on')?.dataset.mood`));
// 保存 → 阅读页表情章
c = await center('.ed-acts .btn.primary');
await clickAt(c.x, c.y);
await sleep(1600);
console.log("阅读页表情章:", await ev(`document.querySelector('.mood-stamp')?.textContent || 'none'`));
// 编辑该篇 → 加一个自选印章 → 删除它
c = await center('.edit-peek');
await clickAt(c.x, c.y);
await sleep(700);
const files = await send("DOM.getDocument");
const r1 = await send("DOM.querySelector", { nodeId: files.result.root.nodeId, selector: 'input.stamp-file' });
await send("DOM.setFileInputFiles", { nodeId: r1.result.nodeId, files: ["D:/dairy/tools/test-stamp.png"] });
await sleep(900);
console.log("自选章数量:", await ev(`document.querySelectorAll('.mood-row button.custom').length`));
// 悬停露出删除 → 直接触发删除
await ev(`document.querySelector('.mood-row button.custom .del').click(); 'ok'`);
await sleep(800);
console.log("删除后自选章数量:", await ev(`document.querySelectorAll('.mood-row button.custom').length`));
console.log("删除后选中态:", await ev(`(() => { const b = document.querySelector('.mood-row button.on'); return b ? (b.dataset.mood || b.dataset.moodImg) : 'none'; })()`));
ws.close(); try { edge.kill(); } catch { }
process.exit(0);
