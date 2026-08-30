// probe17.mjs — 翻页区缩小 + 自定义印章
import { spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9360;
const PROFILE = "D:/dairy/.edge-probe17";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { rmSync(PROFILE, { recursive: true, force: true }); } catch { }
// 一张 1x1 红色 PNG 作为自定义印章
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
writeFileSync("D:/dairy/tools/test-stamp.png", PNG);
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
const center = (sel) => ev(`(() => { const el = document.querySelector('${sel}'); if (!el) return null; const r = el.getBoundingClientRect(); return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height, left: r.x, top: r.y, right: r.right}); })()`).then((s) => (s ? JSON.parse(s) : null));
await send("Runtime.enable");
await sleep(3000);
// 打开书
let c = await center('.books .book');
await clickAt(c.x, c.y);
await sleep(900);
// 1) 翻页区尺寸
const zl = await center('.flip-zone.left');
const zr = await center('.flip-zone.right');
const pg = await center('.pcol.left .page');
console.log("翻页区左宽:", zl.w, "右宽:", zr.w, "| 左页:", JSON.stringify({ left: pg.left, right: pg.right }));
console.log("左翻页区是否压到正文:", await ev(`(() => { const z = document.querySelector('.flip-zone.left').getBoundingClientRect(); const p = document.querySelector('.pcol.left .entry-html').getBoundingClientRect(); return JSON.stringify({zoneRight: z.right, textLeft: p.left, overlap: z.right > p.left}); })()`));
// 2) 打开编辑器 → 添加自定义印章
c = await center('.flip-zone.right');
await clickAt(c.x, c.y);
await sleep(1000);
c = await center('.new-page-btn');
await clickAt(c.x, c.y);
await sleep(700);
await ev(`document.querySelector('input[placeholder*="今天"]').focus(); 'ok'`);
await send("Input.insertText", { text: "印章测试" });
await ev(`document.querySelector('.editor-body').focus(); 'ok'`);
await send("Input.insertText", { text: "这是一篇测试自定义印章的日记。" });
await sleep(500);
// 选一个表情章
console.log("mood-add 存在:", await ev(`!!document.querySelector('.mood-add')`));
// 用 CDP 给印章 file input 塞图片并触发
const files = await send("DOM.getDocument");
const r1 = await send("DOM.querySelector", { nodeId: files.result.root.nodeId, selector: 'input.stamp-file' });
console.log("stamp input node:", r1.result.nodeId);
await send("DOM.setFileInputFiles", { nodeId: r1.result.nodeId, files: ["D:/dairy/tools/test-stamp.png"] });
await sleep(900);
console.log("添加后 custom 章数量:", await ev(`document.querySelectorAll('.mood-row button.custom').length`));
console.log("选中状态:", await ev(`(() => { const b = document.querySelector('.mood-row button.custom.on'); return b ? 'on:' + b.dataset.moodImg : 'no-on'; })()`));
// 保存
c = await center('.ed-acts .btn.primary');
await clickAt(c.x, c.y);
await sleep(1600);
// 3) 阅读页显示图片印章
console.log("阅读页图片印章:", await ev(`(() => { const m = document.querySelector('.mood-stamp.img img'); return m ? JSON.stringify({has: true, w: m.naturalWidth}) : 'none'; })()`));
// 4) 刷新持久化
await send("Page.reload", { ignoreCache: true });
await sleep(3500);
c = await center('.books .book');
await clickAt(c.x, c.y);
await sleep(900);
c = await center('.toc-btn');
await clickAt(c.x, c.y);
await sleep(500);
c = await center('.toc-item');
await clickAt(c.x, c.y);
await sleep(600);
console.log("刷新后图片印章:", await ev(`(() => { const m = document.querySelector('.mood-stamp.img img'); return m ? 'ok' : 'none'; })()`));
ws.close(); try { edge.kill(); } catch { }
process.exit(0);
