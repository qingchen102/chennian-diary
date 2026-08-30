// probe4.mjs — 编辑器分页诊断：输入后检查 pages 状态与 paginateEntry 行为
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9347;
const PROFILE = "D:/dairy/.edge-probe4";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { rmSync(PROFILE, { recursive: true, force: true }); } catch { }
const edge = spawn(EDGE, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--disable-extensions",
  "--window-size=1400,1000", `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`,
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
let id = 0; const pending = new Map(); const errs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Runtime.exceptionThrown") errs.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
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
const center = (sel) => ev(`(() => { const el = document.querySelector('${sel}'); if (!el) return null; const r = el.getBoundingClientRect(); return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height, left: r.x, top: r.y, right: r.right, bottom: r.bottom}); })()`).then((s) => (s ? JSON.parse(s) : null));
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
console.log("spreadCols:", await ev(`document.querySelectorAll('.editor-frame .spread .pcol').length`));
// 直接看测量与分页
console.log("layout:", await ev(`JSON.stringify({
  zoneW: document.querySelector('.ed-body-zone').clientWidth,
  zoneH: document.querySelector('.ed-body-zone').clientHeight,
  editorBodyH: document.querySelector('.editor-body').getBoundingClientRect().height,
  writingSize: getComputedStyle(document.querySelector('.editor-body')).getPropertyValue('--writing-size'),
  lineBaseline: getComputedStyle(document.documentElement).getPropertyValue('--line-baseline')
})`));
// 输入 5 段
await ev(`document.querySelector('.editor-body').focus(); 'ok'`);
for (let i = 0; i < 5; i++) {
  await send("Input.insertText", { text: `这是第${i}段内容用来测试写满一页之后自动续到下一页并可以翻页。` });
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await sleep(30);
}
await sleep(1200);
console.log("after typing:");
console.log("  pagenum:", await ev(`document.querySelector('.ed-pagenum')?.textContent`));
console.log("  bodyPs:", await ev(`document.querySelectorAll('.editor-body p').length`));
console.log("  bodyChars:", await ev(`document.querySelector('.editor-body')?.textContent.length`));
console.log("  bodyTail:", await ev(`document.querySelector('.editor-body')?.textContent.slice(-40)`));
console.log("  innerHTML:", await ev(`document.querySelector('.editor-body')?.innerHTML.slice(0, 120)`));
console.log("  bgPos:", await ev(`getComputedStyle(document.querySelector('.editor-body')).backgroundPosition`));
console.log("  bgPosY:", await ev(`parseFloat(getComputedStyle(document.querySelector('.editor-body')).backgroundPosition.split(' ')[1])`));
console.log("  direct paginate:", await ev(`(async () => {
  const m = await import('./js/pageflow.js');
  const zone = document.querySelector('.ed-body-zone');
  const bw = zone.clientWidth, bh = zone.clientHeight;
  const parts = m.paginateEntry({html: document.querySelector('.editor-body').innerHTML}, {bodyW: bw, bodyHFirst: bh, bodyHNext: bh});
  return JSON.stringify({bw, bh, n: parts.length, lineH: getComputedStyle(document.querySelector('.editor-body')).lineHeight});
})()`));
// 再补 15 段（共 20 段 ≈ 600 字）
for (let i = 5; i < 20; i++) {
  await send("Input.insertText", { text: `这是第${i}段内容用来测试写满一页之后自动续到下一页并可以翻页。` });
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await sleep(30);
}
await sleep(1500);
console.log("after 20 paras:");
console.log("  pagenum:", await ev(`document.querySelector('.ed-pagenum')?.textContent`));
console.log("  bodyChars:", await ev(`document.querySelector('.editor-body')?.textContent.length`));
console.log("  bodyTail:", await ev(`document.querySelector('.editor-body')?.textContent.slice(-40)`));
console.log("  direct paginate:", await ev(`(async () => {
  const m = await import('./js/pageflow.js');
  const zone = document.querySelector('.ed-body-zone');
  const bw = zone.clientWidth, bh = zone.clientHeight;
  const parts = m.paginateEntry({html: document.querySelector('.editor-body').innerHTML}, {bodyW: bw, bodyHFirst: bh, bodyHNext: bh});
  return JSON.stringify({n: parts.length});
})()`));
console.log("errs:", JSON.stringify(errs));
ws.close(); try { edge.kill(); } catch { }
process.exit(0);
