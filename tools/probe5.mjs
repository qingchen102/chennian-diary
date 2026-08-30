// probe5.mjs — 保存后阅读页数 vs 编辑器页数诊断
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9348;
const PROFILE = "D:/dairy/.edge-probe5";
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
// 填标题 + 输入 20 段
await ev(`document.querySelector('input[placeholder*="今天"]').focus(); 'ok'`);
await send("Input.insertText", { text: "双面测试" });
await sleep(300);
await ev(`document.querySelector('.editor-body').focus(); 'ok'`);
await ev(`window.__ED_LOG = []; 'ok'`);
// 监听正文 DOM 变化
await ev(`(() => {
  window.__log = [];
  const b = document.querySelector('.editor-body');
  window.__focused = true;
  window.__obs = new MutationObserver((muts) => {
    window.__log.push({ t: Date.now(), len: b.textContent.length, kids: b.children.length, type: muts[0].type, first: b.firstChild ? b.firstChild.tagName : null });
  });
  window.__obs.observe(b, { childList: true, subtree: true, characterData: true });
  document.addEventListener('selectionchange', () => {
    if (window.__log.length) window.__log[window.__log.length - 1].sel = document.getSelection() ? String(document.getSelection().anchorOffset) : '?';
  });
  'ok';
})()`);
for (let i = 0; i < 20; i++) {
  await send("Input.insertText", { text: `这是第${i}段内容用来测试写满一页之后自动续到下一页并可以翻页。` });
  await sleep(40);
}
await sleep(1500);
console.log("editor pagenum:", await ev(`document.querySelector('.ed-pagenum')?.textContent`));
console.log("editor bodyChars:", await ev(`document.querySelector('.editor-body')?.textContent.length`));
console.log("ED_LOG:", await ev(`JSON.stringify(window.__ED_LOG || [])`));
console.log("log:", await ev(`JSON.stringify(window.__log.slice(0, 40))`));
console.log("zoneH:", await ev(`document.querySelector('.ed-body-zone').clientHeight`));
// 保存
c = await center('.ed-acts .btn.primary');
await clickAt(c.x, c.y);
await sleep(1600);
console.log("reading pg:", await ev(`document.querySelector('.page-num')?.textContent`));
console.log("saved entry chars:", await ev(`(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('chennian-diary'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = db.transaction('entries', 'readonly');
  const st = tx.objectStore('entries');
  const all = await new Promise((res) => { const q = st.getAll(); q.onsuccess = () => res(q.result); });
  return JSON.stringify(all.map(e => ({id: e.id, htmlLen: (e.html||'').length, title: e.title})));
})()`));
// 阅读端模板测量的 bodyHFirst
console.log("reading meas:", await ev(`(() => {
  const sheet = document.querySelector('#view-book .sheet');
  const tpl = document.createElement('div');
  tpl.className = 'pcol'; tpl.style.cssText = 'position:absolute; left:-9999px; top:0;';
  tpl.innerHTML = '<div class=\"page\"><div class=\"page-inner\"><div class=\"page-head\"><div class=\"date\">x</div><div class=\"meta\"></div></div><div class=\"page-title\">双面测试</div><div class=\"page-body\"></div></div></div>';
  sheet.append(tpl);
  const h1 = tpl.querySelector('.page-body').clientHeight;
  tpl.querySelector('.page-head').remove(); tpl.querySelector('.page-title').remove();
  const h2 = tpl.querySelector('.page-body').clientHeight;
  tpl.remove();
  const sheetH = sheet.getBoundingClientRect().height;
  return JSON.stringify({sheetH, h1, h2});
})()`));
console.log("errs:", JSON.stringify(errs));
ws.close(); try { edge.kill(); } catch { }
process.exit(0);
