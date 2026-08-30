// probe15.mjs — 调试批注保存流程
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9358;
const PROFILE = "D:/dairy/.edge-probe15";
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
async function drag(x1, y1, x2, y2) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x1, y: y1 });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x1, y: y1, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x2, y: y2, button: "left" });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x2, y: y2, button: "left", clickCount: 1 });
}
const center = (sel) => ev(`(() => { const el = document.querySelector('${sel}'); if (!el) return null; const r = el.getBoundingClientRect(); return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height, left: r.x, top: r.y}); })()`).then((s) => (s ? JSON.parse(s) : null));
await send("Runtime.enable");
await sleep(3000);
await ev(`(() => {
  window.__FLIPLOG = [];
  const tag = (n) => (n && n.className ? String(n.className).split(' ')[0] : (n?.tagName || '?'));
  window.addEventListener('pointerdown', (e) => window.__LOG.push('pd:' + Math.round(e.clientX) + ',' + Math.round(e.clientY) + ':' + tag(e.target)), true);
  window.addEventListener('click', (e) => window.__LOG.push('cl:' + Math.round(e.clientX) + ',' + Math.round(e.clientY) + ':' + tag(e.target)), true);
  'ok';
})()`);
let c = await center('.books .book');
await clickAt(c.x, c.y);
await sleep(900);
// 建一篇（标题+正文）并保存
c = await center('.flip-zone.right');
await clickAt(c.x, c.y);
await sleep(1000);
c = await center('.new-page-btn');
await clickAt(c.x, c.y);
await sleep(700);
await ev(`document.querySelector('input[placeholder*="今天"]').focus(); 'ok'`);
await send("Input.insertText", { text: "批注测试" });
await sleep(200);
await ev(`document.querySelector('.editor-body').focus(); 'ok'`);
for (let i = 0; i < 15; i++) {
  await send("Input.insertText", { text: `这是第${i}段内容用来测试写满一页之后自动续到下一页并可以翻页。` });
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, commands: ["InsertParagraph"] });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await sleep(30);
}
await sleep(800);
c = await center('.ed-acts .btn.primary');
await clickAt(c.x, c.y);
await sleep(1500);
console.log("已保存，page-num:", await ev(`document.querySelector('.page-num')?.textContent`));
// 目录 → 点第一项
c = await center('.toc-btn');
await clickAt(c.x, c.y);
await sleep(500);
c = await center('.toc-item');
await clickAt(c.x, c.y);
await sleep(600);
// 复刻测试流程：翻右→翻左→在右列拖选
const pn2 = () => ev(`document.querySelector('.page-num')?.textContent`);
console.log("step1 toc-item 后:", await pn2());
c = await center('.flip-zone.right');
await clickAt(c.x, c.y);
await sleep(1200);
console.log("step2 翻右后:", await pn2());
c = await center('.flip-zone.left');
await clickAt(c.x, c.y);
await sleep(1200);
console.log("step3 翻左后:", await pn2());
const p0 = await center('.pcol.right .entry-html p');
console.log("右列 p:", JSON.stringify(p0));
await drag(p0.left + 30, p0.top + 8, p0.left + 150, p0.top + 8);
await sleep(500);
console.log("step4 拖选后:", await pn2());
c = await center('.anno-btn');
await clickAt(c.x, c.y);
await sleep(500);
console.log("step5 批注按钮后:", await pn2());
console.log("compose:", await ev(`!!document.querySelector('.anno-compose')`));
await ev(`document.querySelector('.anno-compose textarea').focus(); 'ok'`);
await send("Input.insertText", { text: "这是批注内容" });
await sleep(200);
c = await center('.anno-compose .acts .btn.primary');
await clickAt(c.x, c.y);
await sleep(1500);
console.log("step6 保存后:", await pn2());
console.log("mark:", await ev(`!!document.querySelector('mark.anno-hl')`));
console.log("compose 仍开:", await ev(`!!document.querySelector('.anno-compose')`));
console.log("page-num:", await ev(`document.querySelector('.page-num')?.textContent`));
console.log("点击日志:", await ev(`window.__LOG.slice(-14).join(' | ')`));
console.log("翻页日志:", await ev(`window.__FLIPLOG.join(' | ')`));
console.log("db:", await ev(`(async () => {
  try {
    const dbs = await indexedDB.databases();
    const db = await new Promise((res, rej) => { const r = indexedDB.open(dbs[0].name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const tx = db.transaction('entries', 'readonly');
    const all = await new Promise((res, rej) => { const q = tx.objectStore('entries').getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    return JSON.stringify(all.map(e => ({t: e.title, annos: (e.annotations || []).length, html: (e.html || '').slice(0, 60)})));
  } catch (err) { return 'DBERR:' + err; }
})()`));
ws.close(); try { edge.kill(); } catch { }
process.exit(0);
