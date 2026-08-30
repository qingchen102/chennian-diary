// probe16.mjs — 页眉压线 + 正文从页眉下一行开始
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9359;
const PROFILE = "D:/dairy/.edge-probe16";
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
// 建一篇：填标题+天气+地点+正文两段
c = await center('.flip-zone.right');
await clickAt(c.x, c.y);
await sleep(1000);
c = await center('.new-page-btn');
await clickAt(c.x, c.y);
await sleep(700);
await ev(`document.querySelector('input[placeholder*="今天"]').focus(); 'ok'`);
await send("Input.insertText", { text: "压线测试" });
await ev(`document.querySelector('input[placeholder*="晴"]').focus(); 'ok'`);
await send("Input.insertText", { text: "晴" });
await ev(`document.querySelector('input[placeholder*="哪里"]').focus(); 'ok'`);
await send("Input.insertText", { text: "阳台" });
await sleep(300);
await ev(`document.querySelector('.editor-body').focus(); 'ok'`);
await send("Input.insertText", { text: "这是正文第一行的内容，应该紧跟在页眉下一行。第二行继续。第三行继续。" });
await sleep(700);
// 编辑器：页眉行高 34 的倍数？页眉文字基线 vs 正文区第一条线
const ed = JSON.parse(await ev(`(() => {
  const row = document.querySelector('.editor-frame .hd-row');
  const headR = row.getBoundingClientRect();
  const zone = document.querySelector('.ed-body-zone').getBoundingClientRect();
  const cs = getComputedStyle(row);
  const L = parseFloat(cs.getPropertyValue('--writing-size')) * 2;
  return JSON.stringify({headH: headR.height, L, rowInGrid: Math.abs(headR.height / L - Math.round(headR.height / L)) < 0.05,
    bodyGap: Math.round(zone.top - headR.bottom)});
})()`));
console.log("编辑页页眉:", JSON.stringify(ed));
// 保存 → 阅读页：页眉行 + 正文第一行紧接
c = await center('.ed-acts .btn.primary');
await clickAt(c.x, c.y);
await sleep(1500);
const rd = JSON.parse(await ev(`(() => {
  const row = document.querySelector('.pcol .hd-row');
  const firstP = document.querySelector('.pcol .entry-html p');
  const pg = document.querySelector('.pcol .page');
  if (!row || !firstP) return JSON.stringify({err: 'missing'});
  const rr = row.getBoundingClientRect(), pr = firstP.getBoundingClientRect(), gr = pg.getBoundingClientRect();
  const cs = getComputedStyle(pg);
  const L = (parseFloat(cs.getPropertyValue('--writing-size')) || 17) * 2;
  const base = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--line-baseline'));
  const bgy = parseFloat(cs.backgroundPosition.split(' ')[1]);
  const bodyTop = pg.querySelector('.page-body').getBoundingClientRect().top - gr.top;
  // 页眉基线应在某条网格线上：页眉行盒 [rr.top-gr.top, +34] 内基线 ≈ top+base
  const headTop = rr.top - gr.top;
  const linePos = (p) => (((p - (bgy + L - 1)) % L) + L) % L; // 相对第一条线的偏移
  const headBaseLine = linePos(headTop + base);
  const rowH = rr.height;
  return JSON.stringify({rowH, L, rowInGrid: Math.abs(rowH / L - Math.round(rowH / L)) < 0.05,
    headBaseOnLine: headBaseLine < 1.5 || headBaseLine > L - 1.5,
    firstPOnLine: linePos(bodyTop + base) < 1.5 || linePos(bodyTop + base) > L - 1.5,
    bodyGap: Math.round(pr.top - rr.bottom),
    headText: row.textContent.slice(0, 40)});
})()`));
console.log("阅读页页眉:", JSON.stringify(rd));
ws.close(); try { edge.kill(); } catch { }
process.exit(0);
