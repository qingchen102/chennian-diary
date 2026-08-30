// functest2.mjs — 补充测试：事件模式 Day 自动递增 / 图片插图 / 页脚附件 / 检索 / 统计
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9340;
const URL = "http://127.0.0.1:38613/";
const PROFILE = "D:/dairy/.edge-functest3";
const IMG = "D:/dairy/.edge-test-img/t.png";
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
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
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
/** 给某个 file input（表达式定位）注入文件 */
async function setFiles(selectorExpr, filePath) {
  const r = await send("Runtime.evaluate", { expression: selectorExpr, returnByValue: false });
  const objectId = r.result?.result?.objectId;
  if (!objectId) return false;
  await send("DOM.setFileInputFiles", { files: [filePath], objectId });
  return true;
}

const results = [];
let r;
function check(name, ok, extra = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
}

await send("Runtime.enable");
await send("DOM.enable");
await sleep(2500);

// 准备：进入第一篇（事件模式 Day1）
await ev(`document.querySelectorAll('.book')[0].click(); 'ok'`); await sleep(700);
await ev(`document.querySelector('.flip-zone.right').click(); 'ok'`); await sleep(1200);
await ev(`document.querySelector('.new-page-btn').click(); 'ok'`); await sleep(500);

// 事件模式
await ev(`document.querySelectorAll('.mode-switch button')[1].click(); 'ok'`); // 事件
await sleep(200);
r = await ev(`document.querySelector('.meta-grid input[placeholder^="如"]') !== null`);
check("事件模式显示事件名输入", r === true);
await ev(`
  (() => { const i = document.querySelector('.meta-grid input[placeholder^="如"]');
  i.value = '放假';
  i.dispatchEvent(new Event('input')); return 'ok'; })()
  'ok'
`);
await sleep(200);
r = await ev(`[...document.querySelectorAll('.meta-grid span')].find(s => s.textContent.startsWith('Day'))?.textContent`);
check("新建「放假」事件 Day 自动 = 1", r === "Day 1", String(r));
await ev(`
  document.querySelector('input[placeholder*="今天"]').value = '放假第一天';
  document.querySelector('.editor-body').innerHTML = '<p>假期开始！</p>';
  [...document.querySelectorAll('.ed-acts button')].find(b => b.textContent.includes('保存')).click();
  'ok'
`);
await sleep(900);
r = await ev(`document.querySelector('.face.front .page-head .date')?.textContent`);
check("阅读页显示「放假 Day1」", r === "放假 Day1", String(r));

// 第二篇：Day 自动递增 = 2
await ev(`document.querySelector('.flip-zone.right').click(); 'ok'`); await sleep(1200);
await ev(`document.querySelector('.new-page-btn').click(); 'ok'`); await sleep(500);
await ev(`document.querySelectorAll('.mode-switch button')[1].click(); 'ok'`); await sleep(200);
await ev(`
  (() => { const i = document.querySelector('.meta-grid input[placeholder^="如"]');
  i.value = '放假';
  i.dispatchEvent(new Event('input')); return 'ok'; })()
  'ok'
`);
await sleep(200);
r = await ev(`[...document.querySelectorAll('.meta-grid span')].find(s => s.textContent.startsWith('Day'))?.textContent`);
check("再写一篇「放假」Day 自动递增 = 2", r === "Day 2", String(r));
await ev(`
  document.querySelector('input[placeholder*="今天"]').value = '放假第二天';
  document.querySelector('.editor-body').innerHTML = '<p>继续记录。</p>';
  [...document.querySelectorAll('.ed-acts button')].find(b => b.textContent.includes('保存')).click();
  'ok'
`);
await sleep(900);
r = await ev(`document.querySelector('.face.front .page-head .date')?.textContent`);
check("阅读页显示「放假 Day2」", r === "放假 Day2", String(r));

// 第三篇：插图 + 页脚附件
await ev(`document.querySelector('.flip-zone.right').click(); 'ok'`); await sleep(1200);
await ev(`document.querySelector('.new-page-btn').click(); 'ok'`); await sleep(500);
await ev(`document.querySelector('input[placeholder*="今天"]').value = '图片日记'; 'ok'`);
// 插图（内联）
let ok = await setFiles(`[...document.querySelectorAll('input[type=file]')].find(i => !i.multiple && i.accept.includes('image'))`, IMG);
await sleep(800);
r = await ev(`!!document.querySelector('.editor-body img.diary-img[data-imgid]')`);
check("正文插图注入成功", ok && r === true, "fileSet=" + ok);
r = await ev(`document.querySelector('.editor-body img.diary-img')?.src?.startsWith('blob:')`);
check("插图在编辑器中立即可见", r === true);
// 附件（页脚相册）
ok = await setFiles(`[...document.querySelectorAll('input[type=file]')].find(i => i.multiple && i.accept.includes('image'))`, IMG);
await sleep(800);
r = await ev(`document.querySelectorAll('.editor-attach .attach img').length`);
check("页脚附件缩略图出现", ok && r === 1, "n=" + r);
await ev(`[...document.querySelectorAll('.ed-acts button')].find(b => b.textContent.includes('保存')).click(); 'ok'`);
await sleep(900);
r = JSON.parse(await ev(`JSON.stringify({img: !!document.querySelector('.face.front img.diary-img[data-imgid]'), src: document.querySelector('.face.front img.diary-img')?.src?.startsWith('blob:') === true, foot: document.querySelectorAll('.face.front .page-foot .attach').length})`));
check("阅读页内联图片显示", r.img && r.src, JSON.stringify(r));
check("阅读页页脚相册显示", r.foot === 1, "n=" + r.foot);

// 检索
await ev(`document.querySelector('.back-shelf').click(); 'ok'`); await sleep(600);
await ev(`document.querySelectorAll('.brass-btn')[0].click(); 'ok'`); await sleep(500);
await ev(`
  (() => { const i = document.querySelector('.search-box input');
  i.value = '放假';
  i.dispatchEvent(new Event('input')); return 'ok'; })()
  'ok'
`);
await sleep(600);
r = JSON.parse(await ev(`JSON.stringify({items: document.querySelectorAll('.sr-item').length, first: document.querySelector('.sr-item .sr-title')?.textContent})`));
check("全文检索命中「放假」", r.items >= 2, JSON.stringify(r));
await ev(`document.querySelector('.drawer .head .close').click(); 'ok'`); await sleep(300);

// 统计
await ev(`document.querySelectorAll('.brass-btn')[1].click(); 'ok'`); await sleep(500);
r = JSON.parse(await ev(`JSON.stringify({grid: document.querySelectorAll('.stat-cell').length, books: document.querySelectorAll('.stat-book').length, nums: [...document.querySelectorAll('.stat-cell .num')].map(x => x.textContent)})`));
check("统计抽屉：指标卡 + 双本明细", r.grid >= 4 && r.books === 2, JSON.stringify(r));
r = await ev(`document.querySelectorAll('.stat-cell .num')[0]?.textContent`);
check("总篇数 = 3", r === "3", String(r));
await ev(`document.querySelector('.drawer .head .close').click(); 'ok'`); await sleep(300);

// 深夜模式（已知在设置里）
await ev(`document.querySelectorAll('.brass-btn')[2].click(); 'ok'`); await sleep(400);
await ev(`[...document.querySelectorAll('.switch-row')].find(x => x.textContent.includes('深夜')).querySelector('.switch').click(); 'ok'`);
await sleep(300);
r = await ev(`document.documentElement.dataset.night`);
check("深夜纸色仍生效", r === "true", String(r));

const failed = results.filter((x) => !x.ok);
console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
ws.close();
try { edge.kill(); } catch { }
process.exit(failed.length ? 1 : 0);


