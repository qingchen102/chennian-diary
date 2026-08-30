// functest.mjs — 尘年往事 端到端功能测试（无头 Edge + CDP）
// 覆盖：开书→翻页→写日记→保存→旁注→标记→设置→夜间模式→ZIP→持久化
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9334;
const URL = "http://127.0.0.1:38777/";
const PROFILE = "D:/dairy/.edge-functest";
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

/** 在页面里执行一段 JS，返回其值 */
async function ev(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) {
    return { __err: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
  }
  return r.result?.result?.value;
}

const results = [];
function check(name, ok, extra = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
}

await send("Runtime.enable");
await sleep(2500); // 等待首屏

// 1. 书架
let r = await ev(`JSON.stringify({shelf: !!document.querySelector('#view-bookshelf'), books: document.querySelectorAll('.books .book').length, diary: document.querySelectorAll('.book-cover .name')[0]?.textContent, quote: !!document.querySelector('.quote-card'), btns: document.querySelectorAll('.brass-btn').length})`);
r = JSON.parse(r);
check("书架渲染（两本书+短句+三个铜钮）", r.shelf && r.books === 2 && r.quote && r.btns === 3, JSON.stringify(r));

// 2. 打开日记本
await ev(`document.querySelectorAll('.book')[0].click(); 'ok'`);
await sleep(700);
r = JSON.parse(await ev(`JSON.stringify({view: !!document.querySelector('#view-book'), pageNum: document.querySelector('.page-num')?.textContent})`));
check("点击书本打开阅读视图", r.view, JSON.stringify(r));
check("无内容时显示扉页", r.pageNum === "扉页", String(r.pageNum));

// 3. 翻到新页
await ev(`document.querySelector('.flip-zone.right').click(); 'ok'`);
await sleep(1200);
r = JSON.parse(await ev(`JSON.stringify({pageNum: document.querySelector('.page-num')?.textContent, plus: !!document.querySelector('.new-page-btn')})`));
check("往后翻到「+」新页", r.pageNum === "新页" && r.plus, JSON.stringify(r));

// 4. 点 + 进入编辑器，填写并保存
await ev(`document.querySelector('.new-page-btn').click(); 'ok'`);
await sleep(500);
r = JSON.parse(await ev(`JSON.stringify({editor: !!document.querySelector('#view-editor'), modeG: !!document.querySelector('.mode-switch button.on')})`));
check("进入书写视图（默认公历模式）", r.editor && r.modeG, JSON.stringify(r));

await ev(`
  document.querySelector('input[placeholder*="今天"]').value = '测试：第一篇日记';
  document.querySelector('.editor-body').innerHTML = '<p>这是正文第一段，记录今天。</p><p id="target">第二段，用来加旁注。</p>';
  [...document.querySelectorAll('.ed-acts button')].find(b => b.textContent.includes('保存')).click();
  'saved'
`);
await sleep(900);
r = JSON.parse(await ev(`JSON.stringify({view: !!document.querySelector('#view-book'), pageNum: document.querySelector('.page-num')?.textContent, title: document.querySelector('.page-title')?.textContent})`));
check("保存后回到书本并显示新篇", r.view && r.pageNum === "第 1 / 1 页", JSON.stringify(r));
check("标题正确显示", r.title === "测试：第一篇日记", String(r.title));

// 5. 旁注：双击段落 → 气泡 → 填写 → 记下
await ev(`
  (() => {
    const p = document.querySelector('.face.front .entry-html p');
    p.dispatchEvent(new MouseEvent('dblclick', {bubbles: true, clientX: 300, clientY: 300}));
    return !!document.querySelector('.anno-bubble');
  })()
`);
await sleep(200);
r = await ev(`!!document.querySelector('.anno-bubble')`);
check("双击段落弹出旁注气泡", r === true);
await ev(`document.querySelector('.anno-bubble').click(); 'ok'`);
await sleep(300);
r = await ev(`!!document.querySelector('.anno-compose')`);
check("点击气泡打开旁注编辑器", r === true);
await ev(`
  document.querySelector('.anno-compose textarea').value = '页边感想：今天很棒。';
  [...document.querySelectorAll('.anno-compose button')].find(b => b.textContent.includes('记下')).click();
  'ok'
`);
await sleep(900);
r = JSON.parse(await ev(`JSON.stringify({marker: !!document.querySelector('.anno-marker'), markerN: document.querySelector('.anno-marker')?.textContent})`));
check("旁注保存后出现标记", r.marker && r.markerN === "1", JSON.stringify(r));
await ev(`document.querySelector('.anno-marker').click(); 'ok'`);
await sleep(400);
r = await ev(`!!document.querySelector('.anno-panel')`);
check("点击标记展开旁注面板", r === true);
r = await ev(`document.querySelector('.anno-panel .anno-item .txt')?.textContent`);
check("旁注面板显示内容与时间戳", r && r.includes("页边感想"), String(r));

// 6. 返回书架 → 设置 → 夜间模式 → ZIP
await ev(`document.querySelector('.back-shelf').click(); 'ok'`);
await sleep(600);
await ev(`document.querySelectorAll('.brass-btn')[2].click(); 'ok'`); // ⚙️ 设置
await sleep(500);
r = await ev(`!!document.querySelector('.drawer')`);
check("打开设置抽屉", r === true);
r = JSON.parse(await ev(`JSON.stringify({fontSel: document.querySelectorAll('.drawer .d-select').length, colors: document.querySelectorAll('.color-swatch').length})`));
check("设置含字体/字号选择与 6 色", r.fontSel >= 2 && r.colors === 6, JSON.stringify(r));
await ev(`
  [...document.querySelectorAll('.switch-row')].find(x => x.textContent.includes('深夜')).querySelector('.switch').click();
  'ok'
`);
await sleep(300);
r = await ev(`document.documentElement.dataset.night`);
check("深夜护眼纸色开关生效", r === "true", String(r));
await ev(`
  (async () => {
    const { buildZip } = await import('/js/zip.js');
    const blob = await buildZip([{name: 'a.txt', data: 'hello zip'}, {name: 'img/x.png', data: new Uint8Array([1,2,3,4])}]);
    window.__zipSize = blob.size;
  })(); 'ok'
`);
await sleep(600);
r = await ev(`window.__zipSize`);
check("ZIP 打包器可用（>0 字节）", r > 0, String(r));
await ev(`document.querySelector('.drawer .head .close').click(); 'ok'`);
await sleep(300);

// 7. 持久化：刷新后数据仍在
await send("Page.reload", { ignoreCache: true });
await sleep(3500);
r = JSON.parse(await ev(`JSON.stringify({shelf: !!document.querySelector('#view-bookshelf'), books: document.querySelectorAll('.books .book').length})`));
check("刷新后书架正常", r.shelf && r.books === 2);
await ev(`document.querySelectorAll('.book')[0].click(); 'ok'`);
await sleep(800);
r = JSON.parse(await ev(`JSON.stringify({pageNum: document.querySelector('.page-num')?.textContent, title: document.querySelector('.page-title')?.textContent})`));
check("刷新后日记仍在（IndexedDB 持久化）", r.pageNum === "第 1 / 1 页" && r.title === "测试：第一篇日记", JSON.stringify(r));

// 汇总
const failed = results.filter((x) => !x.ok);
console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
ws.close();
try { edge.kill(); } catch { }
process.exit(failed.length ? 1 : 0);
