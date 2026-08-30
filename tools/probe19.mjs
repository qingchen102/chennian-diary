// probe19.mjs — 复现跨页边界问题：上一页末尾内容是否被整体推到下一页
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9362;
const PROFILE = "D:/dairy/.edge-probe19";
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
await send("Input.insertText", { text: "跨页测试" });
await sleep(300);
// 直接注入真实的多段内容（绕过 CDP 打字并段问题）：13 段短段 + 1 段长段，长段应部分留在第 1 页
await ev(`(() => {
  const body = document.querySelector('.editor-body');
  const html = [];
  for (let i = 1; i <= 13; i++) html.push('<p>这是第 ' + i + ' 段，用来把第一页填满到接近底部。</p>');
  html.push('<p>第十四段是长段落，内容会超过一页，用来观察它应该按行拆开：前几行留在第一页剩余空行里，其余流到下一页继续。这一段的文字要足够长，长到超过一整页的高度，这样才能验证行级拆分是否生效以及第一页的剩余空间是否被利用。</p>');
  body.innerHTML = html.join('');
  body.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  'ok';
})()`);
await sleep(1500);
console.log("页数:", await ev(`document.querySelector('.editor-frame .ed-pagenum')?.textContent`));
console.log("左页(第1页)末尾块:", await ev(`(() => { const ps = [...document.querySelectorAll('.editor-frame .ed-body-zone p')]; const last = ps[ps.length-1]; return JSON.stringify({blocks: ps.length, lastText: last ? last.textContent.slice(0, 40) : 'none', lastBottom: last ? Math.round(last.getBoundingClientRect().bottom) : -1}); })()`));
console.log("右页(第2页)首块:", await ev(`(() => { const ps = [...document.querySelectorAll('.editor-frame .pcol.right .entry-html p')]; const first = ps[0]; return JSON.stringify({blocks: ps.length, firstText: first ? first.textContent.slice(0, 60) : 'none'}); })()`));
// 左页最后一块的底 vs 书写区底：看是否有空行
console.log("左页空隙:", await ev(`(() => {
  const zone = document.querySelector('.ed-body-zone').getBoundingClientRect();
  const ps = [...document.querySelectorAll('.editor-frame .ed-body-zone p')];
  const last = ps[ps.length-1];
  return JSON.stringify({zoneBottom: Math.round(zone.bottom), lastBottom: last ? Math.round(last.getBoundingClientRect().bottom) : -1, gapLines: last ? Math.round((zone.bottom - last.getBoundingClientRect().bottom) / 32) : -1});
})()`));
ws.close(); try { edge.kill(); } catch { }
process.exit(0);
