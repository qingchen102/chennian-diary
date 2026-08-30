// probe10.mjs — 保存后阅读页逐页检查（找空白页来源）
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9353;
const PROFILE = "D:/dairy/.edge-probe10";
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
// 输入足够内容（编辑器页短 → 会产生多页）
await ev(`document.querySelector('input[placeholder*="今天"]').focus(); 'ok'`);
await send("Input.insertText", { text: "空白页排查" });
await sleep(200);
await ev(`document.querySelector('.editor-body').focus(); 'ok'`);
for (let i = 0; i < 15; i++) {
  await send("Input.insertText", { text: `这是第${i}段内容用来测试写满一页之后自动续到下一页并可以翻页。` });
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await sleep(25);
}
await sleep(900);
console.log("编辑页数:", await ev(`document.querySelector('.ed-pagenum').textContent`));
// 保存
c = await center('.ed-acts .btn.primary');
await clickAt(c.x, c.y);
await sleep(1600);
console.log("阅读 page-num:", await ev(`document.querySelector('.page-num')?.textContent`));
// 逐页翻查内容
const dump = async (label) => {
  const d = await ev(`JSON.stringify({
    lk: document.querySelector('.pcol.left .page') ? (document.querySelector('.pcol.left .page').classList.contains('plain') ? 'plain' : document.querySelector('.pcol.left .page').innerHTML.length) : null,
    lt: document.querySelector('.pcol.left .entry-html')?.textContent.trim().slice(0, 20) || '',
    rk: document.querySelector('.pcol.right .page') ? (document.querySelector('.pcol.right .page').classList.contains('plain') ? 'plain' : document.querySelector('.pcol.right .page').innerHTML.length) : null,
    rt: document.querySelector('.pcol.right .entry-html')?.textContent.trim().slice(0, 20) || '',
    pn: document.querySelector('.page-num')?.textContent
  })`);
  console.log(label, d);
};
await dump("spread0:");
for (let i = 0; i < 6; i++) {
  c = await center('.flip-zone.right');
  await clickAt(c.x, c.y);
  await sleep(1100);
  await dump(`spread${i + 1}:`);
}
ws.close(); try { edge.kill(); } catch { }
process.exit(0);
