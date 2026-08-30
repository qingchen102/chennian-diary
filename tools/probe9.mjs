// probe9.mjs — 隔离“翻页后回车失效”：对比 live 内容 vs 重渲染内容
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9352;
const PROFILE = "D:/dairy/.edge-probe9";
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
async function realEnter() {
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, commands: ["InsertParagraph"] });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
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
// 直接塞入重渲染形态的内容（两个 p），光标放结尾，回车
await ev(`${B}.innerHTML = '<p>第一段文字内容</p><p>第二段文字内容</p>'; ${B}.focus(); 'ok'`);
await ev(`(() => { const s = window.getSelection(); const r = document.createRange(); const last = ${B}.querySelectorAll('p')[1]; r.selectNodeContents(last); r.collapse(false); s.removeAllRanges(); s.addRange(r); 'ok'; })()`);
console.log("重渲染形态(手动innerHTML) 回车前 p:", await ev(`${B}.querySelectorAll('p').length`));
await realEnter();
await sleep(500);
console.log("重渲染形态 回车后 p:", await ev(`${B}.querySelectorAll('p').length`), "html:", await ev(`${B}.innerHTML.slice(0,80)`));
// 光标放第一段中间
await ev(`(() => { const s = window.getSelection(); const r = document.createRange(); const tn = ${B}.querySelector('p').firstChild; r.setStart(tn, 2); r.collapse(true); s.removeAllRanges(); s.addRange(r); 'ok'; })()`);
console.log("光标中段 回车前 p:", await ev(`${B}.querySelectorAll('p').length`));
await realEnter();
await sleep(500);
console.log("光标中段 回车后 p:", await ev(`${B}.querySelectorAll('p').length`), "html:", await ev(`${B}.innerHTML.slice(0,80)`));
// 清空后先打字再回车（live 形态）
await ev(`${B}.innerHTML = ''; ${B}.focus(); 'ok'`);
await send("Input.insertText", { text: "实时输入的文字" });
await realEnter();
await sleep(500);
console.log("live 形态 回车后 p:", await ev(`${B}.querySelectorAll('p').length`), "html:", await ev(`${B}.innerHTML.slice(0,80)`));
// 翻页一次（产生重渲染）后，在“实时输入”状态下回车
for (let i = 0; i < 14; i++) {
  await send("Input.insertText", { text: `这是第${i}段测试文字用来填满整页。` });
  await realEnter();
  await sleep(15);
}
await sleep(900);
console.log("填满后 pagenum:", await ev(`document.querySelector('.ed-pagenum').textContent`));
c = await center('.ed-flip.left');
await clickAt(c.x, c.y);
await sleep(500);
console.log("翻页后 pagenum:", await ev(`document.querySelector('.ed-pagenum').textContent`));
console.log("翻页后 body html 尾部:", await ev(`${B}.innerHTML.slice(-120)`));
console.log("翻页后 caret 容器 outerHTML:", await ev(`(() => { const s = window.getSelection(); if (!s.rangeCount) return 'none'; const n = s.getRangeAt(0).startContainer; return n.nodeType === 3 ? n.parentElement.outerHTML.slice(0,100) : n.outerHTML.slice(0,100); })()`));
console.log("caret off:", await ev(`window.getSelection().getRangeAt(0).startOffset`));
await realEnter();
await sleep(600);
console.log("翻页后回车 p:", await ev(`${B}.querySelectorAll('p').length`), "pagenum:", await ev(`document.querySelector('.ed-pagenum').textContent`));
ws.close(); try { edge.kill(); } catch { }
process.exit(0);
