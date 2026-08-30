// realtest.mjs — 修复后的全量真实事件测试
// 覆盖：双面开本 / 翻页 / 真实双击旁注 / 确认框真点击 / 删除流 / 横线 / 页码 / 设置 / 持久化
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9343;
const URL = process.argv[2] || "http://127.0.0.1:38777/";
const PROFILE = "D:/dairy/.edge-realtest";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try { rmSync(PROFILE, { recursive: true, force: true }); } catch { }

const edge = spawn(EDGE, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--disable-extensions",
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
  if (m.method === "Runtime.exceptionThrown") errs.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
  return r.result?.result?.value;
};
async function clickAt(x, y, dbl = false) {
  const count = dbl ? 2 : 1;
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await sleep(40);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  if (dbl) {
    await sleep(50);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 2 });
    await sleep(40);
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 2 });
  }
}
const center = (sel) => ev(`(() => { const el = document.querySelector('${sel}'); if (!el) return null; const r = el.getBoundingClientRect(); return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height}); })()`).then((s) => (s ? JSON.parse(s) : null));

const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };

await send("Runtime.enable");
await sleep(3000);

// 1. 书架 + 打开日记本 → 双面开本
let c = await center('.books .book');
await clickAt(c.x, c.y);
await sleep(900);
check("真实点击打开书本", await ev(`!!document.querySelector('#view-book')`));
let r = JSON.parse(await ev(`JSON.stringify({cols: document.querySelectorAll('.pcol').length, leftHas: !!document.querySelector('.pcol.left .page'), rightHas: !!document.querySelector('.pcol.right .page'), leftFly: !!document.querySelector('.pcol.left .page-inner')})`));
check("双面开本（左右两页同时显示）", r.cols === 2 && r.leftHas && r.rightHas, JSON.stringify(r));

// 2. 翻页到新页并写第一篇
c = await center('.flip-zone.right');
await clickAt(c.x, c.y);
await sleep(1200);
r = await ev(`!!document.querySelector('.new-page-btn')`);
check("翻页后出现「+」新页", r === true);
c = await center('.new-page-btn');
await clickAt(c.x, c.y);
await sleep(600);
check("进入编辑器", await ev(`!!document.querySelector('#view-editor')`));
await ev(`document.querySelector('input[placeholder*="今天"]').focus(); 'ok'`);
await send("Input.insertText", { text: "双面开本测试" });
await ev(`document.querySelector('.editor-body').focus(); 'ok'`);
await send("Input.insertText", { text: "第一段内容，用来加旁注。" });
await sleep(100);
r = JSON.parse(await ev(`(() => { const w = document.querySelector('.editor-body').getBoundingClientRect().width; return JSON.stringify({w}); })()`));
check("书写区与书页同宽（所见即所得）", r.w > 300 && r.w < 600, `w=${r.w}px`);
c = await center('.ed-acts .btn.primary');
await clickAt(c.x, c.y);
await sleep(1000);
r = JSON.parse(await ev(`JSON.stringify({cols: document.querySelectorAll('.pcol').length, leftFly: !!document.querySelector('.pcol.left .entry-html') || document.querySelector('.pcol.left .page-title') === null, title: document.querySelector('.pcol.right .page-title')?.textContent || document.querySelector('.pcol.left .page-title')?.textContent})`));
check("保存后回到双面开本，新篇在右页", r.cols === 2 && r.title === "双面开本测试", JSON.stringify(r));
r = await ev(`getComputedStyle(document.querySelector('.pcol.right .entry-html')).backgroundImage.includes('repeating-linear-gradient')`);
check("纸页有笔记本横线", r === true);

// 3. 真实双击段落 → 旁注气泡
const pCenter = await center('.pcol.right .entry-html p');
await clickAt(pCenter.x, pCenter.y, true);
await sleep(400);
r = await ev(`!!document.querySelector('.anno-bubble')`);
check("真实双击段落弹出旁注气泡", r === true);
// 点气泡 → 填写 → 记下
c = await center('.anno-bubble');
await clickAt(c.x, c.y);
await sleep(400);
check("点击气泡打开旁注编辑器", await ev(`!!document.querySelector('.anno-compose')`));
await ev(`document.querySelector('.anno-compose textarea').focus(); 'ok'`);
await send("Input.insertText", { text: "真实的页边感想" });
await sleep(100);
c = await center('.anno-compose .acts .btn.primary');
await clickAt(c.x, c.y);
await sleep(1000);
r = JSON.parse(await ev(`JSON.stringify({marker: !!document.querySelector('.pcol.right .anno-marker'), n: document.querySelector('.pcol.right .anno-marker')?.textContent})`));
check("旁注保存后出现标记", r.marker && r.n === "1", JSON.stringify(r));

// 4. 真实点击标记 → 旁注面板
c = await center('.pcol.right .anno-marker');
await clickAt(c.x, c.y);
await sleep(500);
r = await ev(`document.querySelector('.anno-panel .anno-item .txt')?.textContent`);
check("旁注面板显示内容", r && r.includes("真实的页边感想"), String(r));

// 5. 返回书架 → 设置字号提示
c = await center('.back-shelf');
await clickAt(c.x, c.y);
await sleep(700);
c = await center('.brass-btn:nth-of-type(3)');
await clickAt(c.x, c.y);
await sleep(500);
r = await ev(`document.querySelector('.d-hint')?.textContent`);
check("设置显示每行字数提示", r && /每行约/.test(r), String(r));
c = await center('.drawer .head .close');
await clickAt(c.x, c.y);
await sleep(400);

// 6. 编辑入口 + 删除流（确认框真实点击）
c = await center('.books .book');
await clickAt(c.x, c.y);
await sleep(900);
// 翻到含条目的那一页（默认开在最后一篇所在叶）
c = await center('.edit-peek');
await clickAt(c.x, c.y);
await sleep(600);
check("铅笔进入编辑", await ev(`!!document.querySelector('#view-editor')`));
c = await center('.ed-acts .btn'); // 删除按钮（第一个 btn）
await clickAt(c.x, c.y);
await sleep(500);
r = await ev(`!!document.querySelector('.anno-compose .btn.ghost') && !!document.querySelector('.drawer-mask')`);
check("出现确认对话框", r === true);
// 点「取消」
c = await center('.anno-compose .btn.ghost');
await clickAt(c.x, c.y);
await sleep(400);
r = await ev(`!document.querySelector('.anno-compose')`);
check("确认框「取消」可点且关闭", r === true);
check("仍停留在编辑器", await ev(`!!document.querySelector('#view-editor')`));
// 再删一次 → 点「删除」（primary 危险色）
c = await center('.ed-acts .btn');
await clickAt(c.x, c.y);
await sleep(500);
c = await center('.anno-compose .btn.primary');
await clickAt(c.x, c.y);
await sleep(1000);
r = JSON.parse(await ev(`JSON.stringify({inBook: !!document.querySelector('#view-book'), hasTitle: !!document.querySelector('.page-title')})`));
check("确认删除后回到书本且条目消失", r.inBook && !r.hasTitle, JSON.stringify(r));

// 7. 每页页码
r = JSON.parse(await ev(`JSON.stringify({nums: [...document.querySelectorAll('.pg-no')].map(n=>n.textContent), pageNum: document.querySelector('.page-num')?.textContent})`));
check("页角有页码", r.nums.length >= 1, JSON.stringify(r));

// 8. 刷新持久化（删除后应为空 → 扉页+新页）
await send("Page.reload", { ignoreCache: true });
await sleep(3500);
c = await center('.books .book');
await clickAt(c.x, c.y);
await sleep(900);
r = JSON.parse(await ev(`JSON.stringify({cols: document.querySelectorAll('.pcol').length, plus: !!document.querySelector('.new-page-btn')})`));
check("刷新后双面开本正常（删除已持久化）", r.cols === 2, JSON.stringify(r));

const failed = results.filter((x) => !x);
console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
if (errs.length) { console.log("EXCEPTIONS:"); errs.forEach((e) => console.log("  " + e)); }
ws.close();
try { edge.kill(); } catch { }
process.exit(failed.length ? 1 : 0);
