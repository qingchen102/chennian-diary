// probe7.mjs — 定位“翻页后回车失效”
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9350;
const PROFILE = "D:/dairy/.edge-probe7";
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
await sleep(1200);
c = await center('.new-page-btn');
await clickAt(c.x, c.y);
await sleep(700);
const B = `document.querySelector('.editor-body')`;
// 直接键入两行（用 insertParagraph 模拟回车）→ 确认基础可用
await ev(`${B}.focus(); 'ok'`);
await send("Input.insertText", { text: "第一行内容" });
await ev(`document.execCommand('insertParagraph'); 'ok'`);
await sleep(150);
await send("Input.insertText", { text: "第二行内容" });
await sleep(500);
console.log("基础键入后 p 数:", await ev(`${B}.querySelectorAll('p').length`), "html:", await ev(`${B}.innerHTML.slice(0,60)`));
// 再输入足够内容制造多页
await ev(`${B}.focus(); 'ok'`);
for (let i = 0; i < 12; i++) {
  await send("Input.insertText", { text: `这是第${i}段测试文字，用来填满整页并产生翻页。` });
  await ev(`document.execCommand('insertParagraph'); 'ok'`);
  await sleep(20);
}
await sleep(900);
console.log("多页后 pagenum:", await ev(`document.querySelector('.ed-pagenum').textContent`));
// 翻到上一页
c = await center('.ed-flip.left');
await clickAt(c.x, c.y);
await sleep(500);
console.log("翻页后 pagenum:", await ev(`document.querySelector('.ed-pagenum').textContent`));
console.log("翻页后 body html:", await ev(`${B}.innerHTML.slice(0,120)`));
console.log("翻页后 body p 数:", await ev(`${B}.querySelectorAll('p').length`));
console.log("selection:", await ev(`(() => { const s = window.getSelection(); if (!s.rangeCount) return 'none'; const r = s.getRangeAt(0); return JSON.stringify({start: r.startOffset, nodeType: r.startContainer.nodeType, tag: r.startContainer.nodeType===3 ? 'TEXT' : r.startContainer.tagName, parent: r.startContainer.parentElement?.tagName, collapsed: r.collapsed}); })()`));
// 尝试 insertParagraph
await ev(`${B}.focus(); 'ok'`);
console.log("insertParagraph 返回:", await ev(`document.execCommand('insertParagraph')`));
await sleep(600);
console.log("之后 p 数:", await ev(`${B}.querySelectorAll('p').length`), "pagenum:", await ev(`document.querySelector('.ed-pagenum').textContent`));
// 再试：先选中全部再 insertParagraph
console.log("selectAll+insertParagraph:", await ev(`(() => { const s = window.getSelection(); const r = document.createRange(); r.selectNodeContents(${B}); s.removeAllRanges(); s.addRange(r); const ok = document.execCommand('insertParagraph'); return JSON.stringify({ok, ps: ${B}.querySelectorAll('p').length}); })()`));
await sleep(600);
console.log("selectAll 后 p 数:", await ev(`${B}.querySelectorAll('p').length`), "pagenum:", await ev(`document.querySelector('.ed-pagenum').textContent`));
// 再试：把光标移到中间再回车
console.log("中段回车:", await ev(`(() => { const s = window.getSelection(); const r = document.createRange(); const tn = ${B}.querySelector('p')?.firstChild; if (!tn) return 'no text node'; r.setStart(tn, 3); r.collapse(true); s.removeAllRanges(); s.addRange(r); const ok = document.execCommand('insertParagraph'); return JSON.stringify({ok, ps: ${B}.querySelectorAll('p').length}); })()`));
await sleep(600);
console.log("中段回车后 p 数:", await ev(`${B}.querySelectorAll('p').length`), "pagenum:", await ev(`document.querySelector('.ed-pagenum').textContent`));
ws.close(); try { edge.kill(); } catch { }
process.exit(0);
