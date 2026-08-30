// probe2.mjs — 快速诊断：保存长文后的分页情况
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9345;
const URL = process.argv[2] || "http://127.0.0.1:38777/";
const PROFILE = "D:/dairy/.edge-probe2";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { rmSync(PROFILE, { recursive: true, force: true }); } catch { }
const edge = spawn(EDGE, ["--headless=new", "--no-sandbox", "--disable-gpu", "--window-size=1400,1000", `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, URL], { stdio: "ignore" });
async function getTarget() {
  for (let i = 0; i < 60; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); const page = list.find((t) => t.type === "page"); if (page) return page; } catch { }
    await sleep(250);
  }
  return null;
}
const target = await getTarget();
if (!target) { console.log("FATAL"); edge.kill(); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws")); });
let id = 0;
const pending = new Map();
const errs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Runtime.exceptionThrown") errs.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 400));
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { __err: String(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 300) };
  return r.result?.result?.value;
};
async function clickAt(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await sleep(40);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
const center = (sel) => ev(`(() => { const el = document.querySelector('${sel}'); if (!el) return null; const r = el.getBoundingClientRect(); return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height}); })()`).then((s) => (s ? JSON.parse(s) : null));
await send("Runtime.enable");
await sleep(3000);

let c = await center('.books .book');
await clickAt(c.x, c.y); await sleep(900);
c = await center('.flip-zone.right'); await clickAt(c.x, c.y); await sleep(1200);
c = await center('.new-page-btn'); await clickAt(c.x, c.y); await sleep(700);
await ev(`document.querySelector('input[placeholder*="今天"]').focus(); 'ok'`);
await send("Input.insertText", { text: "探测标题" });
await ev(`document.querySelector('.editor-body').focus(); 'ok'`);
const longText = Array.from({ length: 10 }, (_, i) => `第${i + 1}段文字内容测试分页。`).join("\n");
await send("Input.insertText", { text: longText });
await sleep(300);
let r = await ev(`(() => { const b = document.querySelector('.editor-body'); return JSON.stringify({html: b.innerHTML.slice(0, 300), pCount: b.querySelectorAll('p').length}); })()`);
console.log("EDITOR BEFORE SAVE:", r);
c = await center('.ed-acts .btn.primary'); await clickAt(c.x, c.y); await sleep(1400);
r = await ev(`(() => { const el = document.querySelector('.pcol.right .entry-html'); const title = document.querySelector('.pcol.right .page-title'); return JSON.stringify({pageNum: document.querySelector('.page-num')?.textContent, title: title?.textContent, pCount: el?.querySelectorAll('p').length, text0: el?.textContent.slice(0, 40)}); })()`);
console.log("AFTER SAVE:", r);
// 检查存储的 html
r = await ev(`(async () => { const db = await new Promise((res, rej) => { const rq = indexedDB.open('chennian-diary'); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }); return new Promise((res) => { const tx = db.transaction('entries', 'readonly'); const all = tx.objectStore('entries').getAll(); all.onsuccess = () => res(JSON.stringify(all.result.map(e => ({t: e.title, html0: (e.html||'').slice(0,120), len: (e.html||'').length})))); }); })()`);
console.log("STORED:", r);
if (errs.length) console.log("EXCEPTIONS:", errs);
ws.close(); try { edge.kill(); } catch { }
process.exit(0);
