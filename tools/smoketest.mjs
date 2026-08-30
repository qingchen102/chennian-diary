// smoketest.mjs — 本次改动的端到端冒烟测试（真实 Edge + 一次性临时 profile，不碰真实数据）
// 覆盖：应用启动 / hash 路由跳转与刷新恢复 / 写入并保存一篇日记 /
//      store.exportAllData → importAllData 往返（含图片）/ 批注重锚定
// 用法：node tools/smoketest.mjs
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, rmSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "app");
const PORT = 39777;
const PROFILE = join(dirname(fileURLToPath(import.meta.url)), "..", ".edge-smoke");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 静态服务器 ── */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".ttf": "font/ttf" };
const server = createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/") path = "/index.html";
  const p = join(ROOT, path);
  readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": MIME[extname(p)] || "application/octet-stream" });
    res.end(data);
  });
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

/* ── headless Edge ── */
try { rmSync(PROFILE, { recursive: true, force: true }); } catch { }
const edge = spawn(EDGE, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--disable-extensions",
  `--user-data-dir=${PROFILE}`, `--remote-debugging-port=39778`,
  `http://127.0.0.1:${PORT}/`
], { stdio: "ignore" });

let target = null;
for (let i = 0; i < 60 && !target; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:39778/json`)).json();
    target = list.find((t) => t.type === "page" && !t.url.startsWith("about:"));
  } catch { }
  if (!target) await sleep(250);
}
if (!target) { console.error("no target"); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws")); });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error("页面异常: " + String(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 400));
  return r.result?.result?.value;
};
await send("Runtime.enable");

let failed = 0;
const check = (name, cond, detail = "") => {
  if (cond) console.log(`  ok  ${name}`);
  else { failed++; console.error(`FAIL  ${name} ${detail}`); }
};

await sleep(2500); // 等应用 boot

/* 1. 启动 → 书架 */
check("应用启动渲染书架", await ev(`!!document.querySelector('#view-bookshelf')`));
check("默认 hash 为 #/bookshelf", await ev(`location.hash === '#/bookshelf' || location.hash === ''`));

/* 2. hash 路由：直接改 hash 打开日记本 */
await ev(`location.hash = '#/book/diary'; 'ok'`);
await sleep(600);
check("hash → 打开日记本", await ev(`!!document.querySelector('#view-book')`));

/* 3. 写一篇日记并保存 */
await ev(`location.hash = '#/editor/diary'; 'ok'`);
await sleep(600);
check("hash → 打开编辑器", await ev(`!!document.querySelector('#view-editor')`));
await ev(`(() => {
  const t = document.querySelector('input[placeholder*="今天"]');
  t.value = '冒烟测试篇'; t.dispatchEvent(new Event('input', { bubbles: true }));
  const body = document.querySelector('.editor-body');
  body.innerHTML = '<p id="p_0">批注锚定的测试段落，这一句是引文所在。</p>';
  body.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);
await sleep(700);
await ev(`[...document.querySelectorAll('.ed-acts .btn.primary')].find(b => b.textContent.includes('保存')).click(); 'ok'`);
await sleep(900);
check("保存后回到阅读页", await ev(`!!document.querySelector('#view-book')`));
check("保存后 hash 指向本篇", await ev(`location.hash.startsWith('#/book/diary/')`));
const entryId = await ev(`location.hash.split('/')[3]`);

/* 4. 刷新 → hash 恢复 + 数据仍在 */
await ev(`location.reload(); 'ok'`);
await sleep(2500);
check("刷新后 hash 保持", await ev(`location.hash === '#/book/diary/${entryId}'`), await ev(`location.hash`));
check("刷新后日记还在（IndexedDB 持久化）", await ev(`document.querySelector('#view-book .hd-title')?.textContent === '冒烟测试篇'`));

/* 5. 导出 → 导入 往返（同一模块实例，真 IndexedDB） */
const round = await ev(`(async () => {
  const store = await import('./js/store.js');
  const before = await store.exportAllData();
  await store.importAllData({ books: before.books, entries: before.entries, images: before.images, settings: before.settings });
  const after = await store.exportAllData();
  return JSON.stringify({
    entries: before.entries.length === after.entries.length,
    images: before.images.length === after.images.length,
    books: before.books.length === after.books.length,
    settingsEq: JSON.stringify(before.settings.bookNames) === JSON.stringify(after.settings.bookNames),
    htmlEq: before.entries[0].html === after.entries[0].html
  });
})()`);
const roundRes = JSON.parse(round);
check("导入恢复：条目数一致", roundRes.entries);
check("导入恢复：图片数一致", roundRes.images);
check("导入恢复：书本一致", roundRes.books);
check("导入恢复：设置（书名）一致", roundRes.settingsEq);
check("导入恢复：正文逐字一致", roundRes.htmlEq);

/* 6. 批注重锚定 */
const re = await ev(`(async () => {
  const pf = await import('./js/pageflow.js');
  const oldHtml = '<p id="p_0">批注锚定的测试段落，这一句是引文所在。</p>';
  const newHtml = '<p id="p_0">批注锚定的测试段落，前面插了一句，这一句是引文所在。</p>';
  // "这一句是引文所在" 在旧段落是 [10,18)，新段落是 [17,25)
  const r1 = pf.reanchorAnnos(oldHtml, newHtml, [{ id: 'a1', paraId: 'p_0', start: 10, end: 18 }]);
  const r2 = pf.reanchorAnnos(oldHtml, '<p id="p_0">整段被改写成一个新句子。</p>', [{ id: 'a2', paraId: 'p_0', start: 10, end: 18 }]);
  const r3 = pf.reanchorAnnos(oldHtml, newHtml, [{ id: 'a3', paraId: 'p_99', start: 0, end: 5 }]);
  return JSON.stringify({
    moved: r1[0].start === 17 && r1[0].end === 25,
    lostQuoteNulled: r2[0].start === null && r2[0].end === null,
    deletedParaKept: r3[0].start === 0 && r3[0].end === 5
  });
})()`);
const reRes = JSON.parse(re);
check("批注平移到新位置", reRes.moved, re);
check("引文被改写 → 整段高亮兜底", reRes.lostQuoteNulled);
check("段落被删 → 原样保留不丢", reRes.deletedParaKept);

/* 收尾 */
edge.kill();
server.close();
try { rmSync(PROFILE, { recursive: true, force: true }); } catch { }
if (failed) { console.error(`\n${failed} 项失败`); process.exit(1); }
console.log("\n冒烟测试全部通过");
