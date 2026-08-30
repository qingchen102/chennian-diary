// probe12.mjs — 对比编辑页/阅读页的“首页正文高”与“续页正文高”
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9355;
const PROFILE = "D:/dairy/.edge-probe12";
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
// 先建一篇（含标题），保存
let c = await center('.books .book');
await clickAt(c.x, c.y);
await sleep(900);
c = await center('.flip-zone.right');
await clickAt(c.x, c.y);
await sleep(1200);
c = await center('.new-page-btn');
await clickAt(c.x, c.y);
await sleep(700);
await ev(`document.querySelector('input[placeholder*="今天"]').focus(); 'ok'`);
await send("Input.insertText", { text: "口径对比" });
await sleep(200);
await ev(`document.querySelector('.editor-body').focus(); 'ok'`);
await send("Input.insertText", { text: "一段正文内容。" });
await sleep(500);
// 编辑器里测量
const ed = JSON.parse(await ev(`(() => {
  const z = document.querySelector('.ed-body-zone');
  const h = document.querySelector('.ed-write-head').getBoundingClientRect().height;
  const t = document.querySelector('.ed-write-title').getBoundingClientRect().height;
  const sheetH = document.querySelector('.editor-frame .spread').getBoundingClientRect().height;
  return JSON.stringify({sheetH, zoneWithHead: z.clientHeight, head: h, title: t});
})()`));
console.log("编辑页:", JSON.stringify(ed));
// 保存
c = await center('.ed-acts .btn.primary');
await clickAt(c.x, c.y);
await sleep(1500);
// 阅读端测量同口径
const rd = JSON.parse(await ev(`(() => {
  const sheet = document.querySelector('#view-book .sheet');
  const tpl = document.createElement('div'); tpl.className = 'pcol';
  tpl.style.cssText = 'position:absolute; left:-9999px; top:0;';
  tpl.innerHTML = '<div class=\"page\"><div class=\"page-inner\"><div class=\"page-head\"><div class=\"date\">x</div><div class=\"meta\"></div></div><div class=\"page-title\">口径对比</div><div class=\"page-body\"></div></div></div>';
  sheet.append(tpl);
  const h1 = tpl.querySelector('.page-body').clientHeight;
  tpl.innerHTML = '<div class=\"page\"><div class=\"page-inner\"><div class=\"cont-hint\">· 续 ·</div><div class=\"page-body\"></div></div></div>';
  const h2 = tpl.querySelector('.page-body').clientHeight;
  const sheetH = tpl.querySelector('.page').getBoundingClientRect().height;
  tpl.remove();
  return JSON.stringify({sheetH, bodyHFirst: h1, bodyHNext: h2});
})()`));
console.log("阅读页:", JSON.stringify(rd));
const ok1 = Math.abs(ed.zoneWithHead - rd.bodyHFirst) < 3;
console.log("首页正文高一致:", ok1, `(${ed.zoneWithHead} vs ${rd.bodyHFirst})`);
ws.close(); try { edge.kill(); } catch { }
process.exit(0);
