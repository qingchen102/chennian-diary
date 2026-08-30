// probe13.mjs — 复现：自动换页后光标行位置 + 第一行输入莫名换页
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9356;
const PROFILE = "D:/dairy/.edge-probe13";
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
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) return "EXC:" + String(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 200); return r.result?.result?.value; };
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
const caretState = () => ev(`(() => {
  const sel = window.getSelection();
  const body = document.querySelector('.editor-body');
  if (!sel || !sel.rangeCount) return 'no-sel';
  const r = sel.getRangeAt(0);
  const cr = r.getBoundingClientRect();
  const z = document.querySelector('.ed-body-zone').getBoundingClientRect();
  const frEl = document.querySelector('.editor-frame');
  const fr = frEl.getBoundingClientRect();
  const lineH = 34;
  const line = Math.floor((cr.top - z.top) / lineH) + 1;
  const anchor = sel.anchorNode;
  const inBody = body.contains(anchor);
  const textLen = (anchor && anchor.nodeType === 3) ? anchor.textContent.length : -1;
  return JSON.stringify({line, relTop: Math.round(cr.top - z.top), frameScroll: Math.round(frEl.scrollTop), frameClientH: Math.round(fr.height), zoneTop: Math.round(z.top), caretTop: Math.round(cr.top), off: r.startOffset, anchorTag: anchor && anchor.nodeType === 3 ? anchor.parentElement?.tagName : (anchor?.tagName || anchor?.nodeName || 'NODE'), inBody, textLen, pn: document.querySelector('.ed-pagenum').textContent});
})()`);
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
await ev(`document.querySelector('input[placeholder*="今天"]').focus(); 'ok'`);
await send("Input.insertText", { text: "光标测试" });
await sleep(200);
const B = `document.querySelector('.editor-body')`;
await ev(`${B}.focus(); 'ok'`);
// 填满到换页
for (let i = 0; i < 14; i++) {
  await send("Input.insertText", { text: `这是第${i}段内容用来测试写满自动续页换页之后的光标位置在哪里。` });
  await realEnter();
  await sleep(30);
}
await sleep(1000);
console.log("自动换页后:", await caretState());
console.log("body 尾部:", await ev(`${B}.innerHTML.slice(-70)`));
// 翻回上一页再看
c = await center('.ed-flip.left');
await clickAt(c.x, c.y);
await sleep(600);
console.log("翻回上一页:", await caretState());
// 再翻到最后一页
c = await center('.ed-flip.right');
await clickAt(c.x, c.y);
await sleep(600);
console.log("翻到最后一页:", await caretState());
// 手动点第一行
const z = JSON.parse(await ev(`JSON.stringify((() => { const r = document.querySelector('.ed-body-zone').getBoundingClientRect(); return {x: r.x + 60, y: r.y + 17}; })())`));
await clickAt(z.x, z.y);
await sleep(400);
console.log("手动点第一行后:", await caretState());
// 输入几个字
await send("Input.insertText", { text: "几个字" });
await sleep(800);
console.log("第一行输入几个字后:", await caretState());
ws.close(); try { edge.kill(); } catch { }
process.exit(0);
