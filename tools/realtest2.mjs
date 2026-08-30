// realtest2.mjs — 第二轮修复全量真实事件测试
// 覆盖：流式分页（超一页续排）/ 横线基线对齐 / 选中文字批注（不改排版）/ 批注栏 / 删除流回归 / 持久化
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9344;
const URL = process.argv[2] || "http://127.0.0.1:38777/";
const PROFILE = "D:/dairy/.edge-rt2";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try { rmSync(PROFILE, { recursive: true, force: true }); } catch { }

const edge = spawn(EDGE, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--disable-extensions",
  "--window-size=1400,1000",
  `--user-data-dir=${PROFILE}`,
  `--remote-debugging-port=${PORT}`,
  URL
], { stdio: "ignore" });

async function getTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page;
    } catch { }
    await sleep(250);
  }
  return null;
}
const target = await getTarget();
if (!target) { console.log("FATAL: no target"); edge.kill(); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws")); });
let id = 0;
const pending = new Map();
const errs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Runtime.exceptionThrown") errs.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 400));
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { __err: String(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 300) };
  return r.result?.result?.value;
};
async function clickAt(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await sleep(40);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
async function dragSelect(x1, y1, x2, y2) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x1, y: y1 });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x1, y: y1, button: "left", clickCount: 1 });
  await sleep(60);
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved", button: "left", buttons: 1,
      x: x1 + ((x2 - x1) * i) / steps, y: y1 + ((y2 - y1) * i) / steps
    });
    await sleep(30);
  }
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x2, y: y2, button: "left", clickCount: 1 });
}
const center = (sel) => ev(`(() => { const el = document.querySelector('${sel}'); if (!el) return null; const r = el.getBoundingClientRect(); return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height, left: r.x, top: r.y, right: r.right, bottom: r.bottom}); })()`).then((s) => (s ? JSON.parse(s) : null));

const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };

await send("Runtime.enable");
await sleep(3000);

// 0. 双面开本
let c = await center('.books .book');
await clickAt(c.x, c.y);
await sleep(900);
check("打开书本双面开本", await ev(`document.querySelectorAll('.pcol').length === 2`));

// 1. 写一篇超长日记（60 段）
c = await center('.flip-zone.right');
await clickAt(c.x, c.y);
await sleep(1200);
c = await center('.new-page-btn');
await clickAt(c.x, c.y);
await sleep(600);
await ev(`document.querySelector('input[placeholder*="今天"]').focus(); 'ok'`);
await send("Input.insertText", { text: "长文测试" });
await ev(`document.querySelector('.editor-body').focus(); 'ok'`);
const longText = Array.from({ length: 60 }, (_, i) => `这是第${i + 1}段内容，用来验证超出一页之后能翻页看到，字要落在横线上。`).join("\n");
await send("Input.insertText", { text: longText });
await sleep(200);
c = await center('.ed-acts .btn.primary');
await clickAt(c.x, c.y);
await sleep(1200);

// 2. 多页续排
let r = JSON.parse(await ev(`JSON.stringify({pg: document.querySelector('.page-num')?.textContent, cont: !!document.querySelector('.cont-hint'), pgNo: [...document.querySelectorAll('.pg-no')].map(n=>n.textContent)})`));
check("超长内容被分到多页", r.pg && /\d+–\d+ \/ \d+/.test(r.pg) && parseInt(r.pg.split("/")[1]) > 3, JSON.stringify(r));
// 翻到第二页应有续页标记
c = await center('.flip-zone.right');
await clickAt(c.x, c.y);
await sleep(1200);
r = await ev(`!!document.querySelector('.cont-hint')`);
check("翻到下一页看到续页内容", r === true);
// 记录续页是否有正文
r = await ev(`document.querySelector('.pcol.right .entry-html')?.textContent.length > 0 || document.querySelector('.pcol.left .entry-html')?.textContent.length > 0`);
check("续页有正文内容", r === true);
// 翻回第一页
c = await center('.flip-zone.left');
await clickAt(c.x, c.y);
await sleep(1200);

// 3. 横线基线对齐
r = await ev(`getComputedStyle(document.documentElement).getPropertyValue('--line-baseline')`);
check("基线偏移已实测", /px/.test(r), String(r));
const baseVal = r;
r = await ev(`(() => { const bg = getComputedStyle(document.querySelector('.pcol.right .entry-html')).backgroundPosition; const base = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--line-baseline')); const bgy = parseFloat(bg.split(' ')[1]); return JSON.stringify({bg, bgy, base, ok: Math.abs(bgy - base) < 0.01}); })()`);
check("横线背景按基线定位", JSON.parse(r).ok === true, String(r));

// 4. 选中文字 → 批注（不改排版）
const p0 = await center('.pcol.right .entry-html p');
const hBefore = p0.h;
await dragSelect(p0.left + 30, p0.top + 8, p0.left + 130, p0.top + 8);
await sleep(400);
r = await ev(`!!document.querySelector('.anno-btn')`);
check("拖选文字出现批注按钮", r === true);
c = await center('.anno-btn');
await clickAt(c.x, c.y);
await sleep(400);
check("打开批注编辑框", await ev(`!!document.querySelector('.anno-compose')`));
await ev(`document.querySelector('.anno-compose textarea').focus(); 'ok'`);
await send("Input.insertText", { text: "这是批注内容" });
await sleep(100);
c = await center('.anno-compose .acts .btn.primary');
await clickAt(c.x, c.y);
await sleep(1200);

r = JSON.parse(await ev(`JSON.stringify({mark: !!document.querySelector('mark.anno-hl'), pane: !!document.querySelector('.anno-pane'), item: document.querySelector('.anno-item .txt')?.textContent})`));
check("正文出现高亮标记", r.mark === true, JSON.stringify(r));
check("批注栏打开且有内容", r.pane && r.item === "这是批注内容", JSON.stringify(r));
// 关闭批注栏、等书本恢复原宽并重排后再验证“高亮不影响排版”
c = await center('.anno-pane .head .close');
await clickAt(c.x, c.y);
await sleep(1000);
const p1 = await center('.pcol.right .entry-html p');
check("批注不改变正文排版（段落高度一致）", Math.abs(p1.h - hBefore) < 1, `before=${hBefore} after=${p1.h}`);

// 5. 点击高亮 → 批注栏重新打开
c = await center('mark.anno-hl');
await clickAt(c.x, c.y);
await sleep(800);
r = await ev(`!!document.querySelector('.anno-pane')`);
check("点击高亮打开批注栏", r === true);
c = await center('.anno-pane .head .close');
await clickAt(c.x, c.y);
await sleep(800);

// 6. 删除流回归（确认框可点）
c = await center('.edit-peek');
await clickAt(c.x, c.y);
await sleep(700);
c = await center('.ed-acts .btn');
await clickAt(c.x, c.y);
await sleep(500);
r = await ev(`!!document.querySelector('.anno-compose') && !!document.querySelector('.drawer-mask')`);
check("确认对话框出现", r === true);
c = await center('.anno-compose .btn.ghost');
await clickAt(c.x, c.y);
await sleep(400);
check("取消可点并关闭", await ev(`!document.querySelector('.anno-compose')`));
c = await center('.ed-acts .btn');
await clickAt(c.x, c.y);
await sleep(500);
c = await center('.anno-compose .btn.primary');
await clickAt(c.x, c.y);
await sleep(1200);
r = await ev(`!!document.querySelector('#view-book') && !document.querySelector('.pcol .page-title')`);
check("确认删除完成", r === true);

// 7. 刷新持久化（python 服务器不会死）
await send("Page.reload", { ignoreCache: true });
await sleep(3500);
c = await center('.books .book');
await clickAt(c.x, c.y);
await sleep(1000);
r = JSON.parse(await ev(`JSON.stringify({cols: document.querySelectorAll('.pcol').length, plus: !!document.querySelector('.new-page-btn')})`));
check("刷新后双面开本正常", r.cols === 2, JSON.stringify(r));

const failed = results.filter((x) => !x);
console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
if (errs.length) { console.log("EXCEPTIONS:"); errs.forEach((e) => console.log("  " + e)); }
ws.close();
try { edge.kill(); } catch { }
process.exit(failed.length ? 1 : 0);
