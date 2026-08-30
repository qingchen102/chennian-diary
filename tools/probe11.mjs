// probe11.mjs — 验证本轮修复：翻页后回车 / 页高一致 / 批注不遮字 / 滚动
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9354;
const PROFILE = "D:/dairy/.edge-probe11";
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
// 1) 页高：编辑页 vs 阅读页口径
console.log("== 页高 ==");
console.log(await ev(`JSON.stringify({
  vh: innerHeight,
  spread: document.querySelector('.editor-frame .spread').getBoundingClientRect().height,
  zoneWithHead: document.querySelector('.ed-body-zone').getBoundingClientRect().height,
  frameScrollH: document.querySelector('.editor-frame').scrollHeight,
  frameClientH: document.querySelector('.editor-frame').clientHeight
})`));
// 2) 输入两页后翻页，真实回车
await ev(`document.querySelector('input[placeholder*="今天"]').focus(); 'ok'`);
await send("Input.insertText", { text: "回车验证" });
await sleep(200);
await ev(`${B}.focus(); 'ok'`);
for (let i = 0; i < 15; i++) {
  await send("Input.insertText", { text: `这是第${i}段内容用来测试写满一页之后自动续到下一页并可以翻页。` });
  await realEnter();
  await sleep(25);
}
await sleep(900);
console.log("== 填满后 ==");
console.log("pagenum:", await ev(`document.querySelector('.ed-pagenum').textContent`));
// 翻回上一页
c = await center('.ed-flip.left');
await clickAt(c.x, c.y);
await sleep(500);
console.log("翻回后 pagenum:", await ev(`document.querySelector('.ed-pagenum').textContent`));
const pBefore = await ev(`${B}.querySelectorAll('p').length`);
await realEnter();
await sleep(700);
const pAfter = await ev(`${B}.querySelectorAll('p').length`);
console.log(`翻页后真实回车: p ${pBefore} → ${pAfter}`, pAfter > pBefore ? "PASS" : "FAIL");
console.log("回车后 pagenum:", await ev(`document.querySelector('.ed-pagenum').textContent`));
console.log("回车后 body 尾部:", await ev(`${B}.innerHTML.slice(-60)`));
// 保存 → 对比阅读页数
c = await center('.ed-acts .btn.primary');
await clickAt(c.x, c.y);
await sleep(1600);
console.log("阅读 page-num:", await ev(`document.querySelector('.page-num')?.textContent`));
ws.close(); try { edge.kill(); } catch { }
process.exit(0);
