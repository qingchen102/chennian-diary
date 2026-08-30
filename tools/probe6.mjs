// probe6.mjs — 诊断：编辑/阅读页高差、翻页后回车、保存后空白页
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9349;
const PROFILE = "D:/dairy/.edge-probe6";
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
// ===== 1. 尺寸测量 =====
console.log("== 尺寸 ==");
console.log(await ev(`JSON.stringify({
  vh: innerHeight, vw: innerWidth,
  frame: document.querySelector('.editor-frame').getBoundingClientRect().height,
  spread: document.querySelector('.editor-frame .spread').getBoundingClientRect().height,
  page: document.querySelector('.editor-frame .page').getBoundingClientRect().height,
  head: document.querySelector('.ed-write-head').getBoundingClientRect().height,
  title: document.querySelector('.ed-write-title').getBoundingClientRect().height,
  zone: document.querySelector('.ed-body-zone').getBoundingClientRect().height
})`));
console.log("reading tpl:", await ev(`(() => {
  const sheet = document.querySelector('#view-book .sheet');
  const tpl = document.createElement('div'); tpl.className = 'pcol';
  tpl.style.cssText = 'position:absolute; left:-9999px; top:0;';
  tpl.innerHTML = '<div class=\"page\"><div class=\"page-inner\"><div class=\"page-head\"></div><div class=\"page-title\"></div><div class=\"page-body\"></div></div></div>';
  sheet.append(tpl);
  const h1 = tpl.querySelector('.page-body').clientHeight;
  tpl.querySelector('.page-head').remove(); tpl.querySelector('.page-title').remove();
  const h2 = tpl.querySelector('.page-body').clientHeight;
  const sh = tpl.querySelector('.page').getBoundingClientRect().height;
  tpl.remove();
  return JSON.stringify({sheetH: sh, h1, h2});
})()`));
// ===== 2. 输入 3 页内容 =====
await ev(`document.querySelector('.editor-body').focus(); 'ok'`);
for (let i = 0; i < 15; i++) {
  await send("Input.insertText", { text: `这是第${i}段内容用来测试写满一页之后自动续到下一页并可以翻页。` });
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await sleep(25);
}
await sleep(800);
console.log("== 输入后 ==");
console.log("pagenum:", await ev(`document.querySelector('.ed-pagenum').textContent`));
console.log("body chars:", await ev(`document.querySelector('.editor-body').textContent.length`));
// ===== 3. 翻到上一页后回车 =====
c = await center('.ed-flip.left');
await clickAt(c.x, c.y);
await sleep(500);
console.log("== 翻到上一页后 ==");
console.log("pagenum:", await ev(`document.querySelector('.ed-pagenum').textContent`));
const before = await ev(`document.querySelectorAll('.editor-body p').length`);
const beforeText = await ev(`document.querySelector('.editor-body').textContent.length`);
await ev(`document.querySelector('.editor-body').focus(); document.execCommand('insertParagraph'); 'ok'`);
await sleep(500);
const after = await ev(`document.querySelectorAll('.editor-body p').length`);
const afterText = await ev(`document.querySelector('.editor-body').textContent.length`);
console.log(`insertParagraph: before p=${before} len=${beforeText} → after p=${after} len=${afterText}`);
console.log("pagenum after enter:", await ev(`document.querySelector('.ed-pagenum').textContent`));
console.log("activeElement:", await ev(`document.activeElement === document.querySelector('.editor-body')`));
console.log("caret:", await ev(`(() => { const s = window.getSelection(); return s.rangeCount ? s.getRangeAt(0).startOffset : -1; })()`));
// ===== 4. 保存 → 阅读页结构 =====
c = await center('.ed-acts .btn.primary');
await clickAt(c.x, c.y);
await sleep(1600);
console.log("== 保存后阅读页 ==");
console.log(await ev(`JSON.stringify({
  pg: document.querySelector('.page-num')?.textContent,
  pages: S.pages.map(p => ({k: p.kind, parts: p.kind==='entry' ? p.part + '/' + p.total : null, len: p.kind==='entry' ? (p.pieces||[]).reduce((m,x)=>m+x.html.length,0) : null, empty: p.kind==='entry' && p.pieces.every(x => !x.html.replace(/<[^>]*>/g,'').trim())}))
})`));
console.log("saved entry html len:", await ev(`(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('chennian-diary'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = db.transaction('entries', 'readonly');
  const all = await new Promise((res) => { const q = tx.objectStore('entries').getAll(); q.onsuccess = () => res(q.result); });
  return JSON.stringify(all.map(e => ({htmlLen: (e.html||'').length})));
})()`));
console.log("errs:", JSON.stringify(errs));
ws.close(); try { edge.kill(); } catch { }
process.exit(0);
