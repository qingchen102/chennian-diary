// realtest3.mjs — 第三轮全量真实事件测试
// 覆盖：编辑器双面开本 / 编辑页横线仅书写区且基线压线 / 回车不空行 /
//      写满自动续页+光标跟随 / 编辑器翻页 / 阅读页整页横线相位 /
//      批注角标+点角标弹卡片（无全局按钮）/ 高亮不改排版 / 删除流回归 / 持久化
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9345;
const URL = process.argv[2] || "http://127.0.0.1:38777/";
const PROFILE = "D:/dairy/.edge-rt3";
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
      const page = list.find((t) => t.type === "page" && !t.url.startsWith("about:"));
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
  if (r.result?.exceptionDetails) {
    const e = String(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 300);
    console.log("EVAL-ERR:", e);
    return { __err: e };
  }
  return r.result?.result?.value;
};
async function clickAt(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await sleep(40);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
async function pressEnter() {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
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

// 0. 打开书本
let c = await center('.books .book');
await clickAt(c.x, c.y);
await sleep(900);
check("打开书本双面开本", await ev(`document.querySelectorAll('.pcol').length === 2`));

// 0b. 书本居中且完整可见（曾误设 left:30%/top:20% 导致整体偏左上角）
const r0 = JSON.parse(await ev(`(() => {
  const s = document.querySelector('.sheet').getBoundingClientRect();
  const cx = s.left + s.width / 2, cy = s.top + s.height / 2;
  return JSON.stringify({cx, cy, vw: innerWidth, vh: innerHeight, left: s.left, top: s.top, right: s.right, bottom: s.bottom,
    ok: Math.abs(cx - innerWidth / 2) < 40 && Math.abs(cy - innerHeight / 2) < 40 && s.left >= 0 && s.top >= 0 && s.right <= innerWidth && s.bottom <= innerHeight});
})()`));
check("书本居中且完整可见", r0.ok === true, JSON.stringify(r0));

// 1. 新建一篇 → 编辑器双面
c = await center('.flip-zone.right');
await clickAt(c.x, c.y);
await sleep(1200);
c = await center('.new-page-btn');
await clickAt(c.x, c.y);
await sleep(700);
let r = JSON.parse(await ev(`JSON.stringify({
  cols: document.querySelectorAll('.editor-frame .spread .pcol').length,
  page: !!document.querySelector('.editor-frame .pcol.left .page.plain'),
  ctxLines: getComputedStyle(document.querySelector('.editor-frame .pcol.right .page')).backgroundImage.includes('linear-gradient'),
  zoneLines: getComputedStyle(document.querySelector('.editor-body')).backgroundImage.includes('linear-gradient'),
  origin: getComputedStyle(document.querySelector('.editor-body')).backgroundOrigin
})`));
check("编辑器呈双面开本（左书写右看页）", r.cols === 2, JSON.stringify(r));
check("编辑页横线只在书写区（右页整页铺线）", r.page === true && r.ctxLines === true && r.zoneLines === true && r.origin === "content-box", JSON.stringify(r));

// 1b. 编辑器翻页区在书页外缘（点边缘翻页，不会盖住文字误触）
r = JSON.parse(await ev(`(() => {
  const fl = document.querySelector('.ed-flip.left').getBoundingClientRect();
  const fr = document.querySelector('.ed-flip.right').getBoundingClientRect();
  const pl = document.querySelector('.editor-frame .pcol.left').getBoundingClientRect();
  const pr = document.querySelector('.editor-frame .pcol.right').getBoundingClientRect();
  return JSON.stringify({flRight: fl.right, plLeft: pl.left, frLeft: fr.left, prRight: pr.right,
    ok: fl.right <= pl.left + 1 && fr.left >= pr.right - 1});
})()`));
check("编辑页翻页区不盖书页", r.ok === true, JSON.stringify(r));

// 2. 编辑页基线压线（background-position = base - L + 1）
r = JSON.parse(await ev(`(() => {
  const b = document.querySelector('.editor-body');
  const cs = getComputedStyle(b);
  const L = parseFloat(cs.getPropertyValue('--writing-size')) * 2;
  const base = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--line-baseline'));
  const bgy = parseFloat(cs.backgroundPosition.split(' ')[1]);
  // 线在 bgy+(L-1)+kL，文字基线在 base+kL → bgy ≡ base-L+1 (mod L)
  const diff = (((bgy - (base - L + 1)) % L) + L) % L;
  return JSON.stringify({bgy, base, L, diff, ok: diff < 0.5 || diff > L - 0.5});
})()`));
check("编辑页文字基线压线", r.ok === true, JSON.stringify(r));

// 3. 回车不空行：两段相邻（p2.top - p1.top == 一行高）——用 insertParagraph 模拟真实回车
await ev(`document.querySelector('.editor-body').focus(); 'ok'`);
await send("Input.insertText", { text: "第一行文字" });
await ev(`document.execCommand('insertParagraph'); 'ok'`);
await sleep(200);
await send("Input.insertText", { text: "第二行文字" });
await sleep(500);
r = JSON.parse(await ev(`(() => {
  const ps = document.querySelectorAll('.editor-body p');
  if (ps.length < 2) return JSON.stringify({n: ps.length, html: document.querySelector('.editor-body').innerHTML.slice(0,80)});
  const cs = getComputedStyle(document.querySelector('.editor-body'));
  const L = parseFloat(cs.getPropertyValue('--writing-size')) * 2;
  const a = ps[0].getBoundingClientRect(), b = ps[1].getBoundingClientRect();
  const gap = b.top - a.top;
  return JSON.stringify({n: ps.length, gap, L, ok: Math.abs(gap - L) < 2});
})()`));
check("回车只换一行（不再空一行）", r.ok === true, JSON.stringify(r));

// 4. 标题实时预览到页眉（日期/天气/地点/标题一行，无星期，标题略大）
await ev(`document.querySelector('input[placeholder*="今天"]').focus(); 'ok'`);
await send("Input.insertText", { text: "双面测试" });
await sleep(300);
r = JSON.parse(await ev(`(() => {
  const row = document.querySelector('.editor-frame .hd-row');
  const t = document.querySelector('.editor-frame .hd-title');
  const d = document.querySelector('.editor-frame .hd-date');
  const cs = t ? getComputedStyle(t) : null;
  return JSON.stringify({
    title: t?.textContent, inRow: row ? row.contains(t) : false,
    noWeekday: d ? !d.textContent.includes('周') : true,
    titleFs: cs ? cs.fontSize : '',
    dateFs: d ? getComputedStyle(d).fontSize : ''
  });
})()`));
check("页眉一行：标题在页眉行内、无星期、标题略大于正文", r.title === "双面测试" && r.inRow === true && r.noWeekday === true && parseFloat(r.titleFs) > parseFloat(r.dateFs), JSON.stringify(r));

// 5. 写满自动续页 + 光标跟随 + 编辑器翻页
await ev(`document.querySelector('.editor-body').focus(); 'ok'`);
for (let i = 0; i < 15; i++) {
  await send("Input.insertText", { text: `这是第${i}段内容用来测试写满一页之后自动续到下一页并可以翻页。` });
  await pressEnter();
  await sleep(25);
}
await sleep(800);
const parsePN = () => ev(`(() => { const t = document.querySelector('.ed-pagenum')?.textContent || ''; const m = t.match(/第 (\\d+) \\/ (\\d+) 页/); return m ? JSON.stringify({cur: +m[1], total: +m[2]}) : 'null'; })()`).then((s) => JSON.parse(s));
let pn = await parsePN();
check("写满自动续页（≥2 页，光标跟到末页）", pn && pn.total >= 2 && pn.cur === pn.total, JSON.stringify(pn));
{
  const ctx = String(await ev(`document.querySelector('.ctx-lbl')?.textContent`));
  check("右页显示本篇下一页/下一篇", ["本篇 · 第", "下一篇", "空白页"].some((s) => ctx.includes(s)), ctx);
}
// 翻回上一页
c = await center('.ed-flip.left');
await clickAt(c.x, c.y);
await sleep(500);
pn = await parsePN();
check("编辑器翻到上一页", pn && pn.cur === pn.total - 1, JSON.stringify(pn));
// 翻回下一页
c = await center('.ed-flip.right');
await clickAt(c.x, c.y);
await sleep(500);
pn = await parsePN();
check("编辑器翻到下一页", pn && pn.cur === pn.total, JSON.stringify(pn));
// 5c. 翻页后待执行重绘不跳页：输入后立刻（防抖窗口内）翻页，等待重绘触发后仍在目标页
await ev(`document.querySelector('.editor-body').focus(); 'ok'`);
await send("Input.insertText", { text: "急" });
await sleep(5);
c = await center('.ed-flip.left');
await clickAt(c.x, c.y);
await sleep(600);
pn = await parsePN();
check("翻页后待执行重绘不跳页", pn && pn.cur === pn.total - 1, JSON.stringify(pn));
// 翻回末页
c = await center('.ed-flip.right');
await clickAt(c.x, c.y);
await sleep(500);
// 在末页末尾补一句话，翻回第 1 页再翻回确认还在
await ev(`document.querySelector('.editor-body').focus(); 'ok'`);
await send("Input.insertText", { text: "（第末页补写）" });
await sleep(400);
for (let k = 0; k < 5; k++) {
  c = await center('.ed-flip.left');
  await clickAt(c.x, c.y);
  await sleep(400);
  pn = await parsePN();
  if (pn && pn.cur === 1) break;
}
check("翻回第 1 页", pn && pn.cur === 1, JSON.stringify(pn));
for (let k = 0; k < 5; k++) {
  c = await center('.ed-flip.right');
  await clickAt(c.x, c.y);
  await sleep(400);
  pn = await parsePN();
  if (pn && pn.cur === pn.total) break;
}
r = await ev(`document.querySelector('.editor-body')?.textContent.includes('（第末页补写）')`);
check("末页补写保留", r === true);

// 5d. 跨页边界：上一页最后的内容按行留在本页（不整段被推到下一页）
await ev(`(() => {
  const btn = [...document.querySelectorAll('.toolbar button')].find(b => b.textContent.trim() === '清空');
  if (btn) btn.click();
  'ok';
})()`);
await sleep(400);
await ev(`(() => {
  const body = document.querySelector('.editor-body');
  const html = [];
  for (let i = 1; i <= 13; i++) html.push('<p>这是第 ' + i + ' 段，用来把第一页填满到接近底部。</p>');
  html.push('<p>第十四段是长段落，内容会超过一页，用来观察它应该按行拆开：前几行留在第一页剩余空行里，其余流到下一页继续。这一段的文字要足够长，长到超过一整页的高度，这样才能验证行级拆分是否生效以及第一页的剩余空间是否被利用。</p>');
  body.innerHTML = html.join('');
  body.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  'ok';
})()`);
await sleep(1200);
r = JSON.parse(await ev(`(() => {
  const zone = document.querySelector('.ed-body-zone').getBoundingClientRect();
  const ps = [...document.querySelectorAll('.editor-frame .ed-body-zone p')];
  const last = ps[ps.length - 1];
  const ctxPs = [...document.querySelectorAll('.editor-frame .pcol.right .entry-html p')];
  const L = (parseFloat(getComputedStyle(document.querySelector('.editor-body')).getPropertyValue('--writing-size')) || 16) * 2;
  return JSON.stringify({
    lastOnPage1: last ? last.textContent.startsWith('第十四段') : false,
    gapLines: last ? (zone.bottom - last.getBoundingClientRect().bottom) / L : 99,
    page2Continues: ctxPs.length ? ctxPs[0].textContent.includes('继续') : false,
    blocks1: ps.length
  });
})()`));
check("跨页时上一页末尾按行拆、不整段下移", r.lastOnPage1 === true && r.page2Continues === true && r.gapLines < 1.5, JSON.stringify(r));

// 6. 保存 → 回到书本
c = await center('.ed-acts .btn.primary');
await clickAt(c.x, c.y);
await sleep(1400);
r = JSON.parse(await ev(`JSON.stringify({pg: document.querySelector('.page-num')?.textContent, cont: !!document.querySelector('.cont-hint')})`));
check("保存后多页续排", r.pg && /\d+–\d+ \/ \d+/.test(r.pg) && parseInt(r.pg.split("/")[1]) > 3, JSON.stringify(r));

// 6b. 目录：按钮跳目录 → 有标题列表 → 点第一条跳到对应篇
c = await center('.toc-btn');
await clickAt(c.x, c.y);
await sleep(500);
const rt = JSON.parse(await ev(`JSON.stringify({
  toc: !!document.querySelector('.toc-item'),
  items: document.querySelectorAll('.toc-item').length,
  first: document.querySelector('.toc-item')?.textContent || ""
})`));
check("目录页展示标题列表", rt.toc === true && rt.items >= 1, JSON.stringify(rt));
c = await center('.toc-item');
await clickAt(c.x, c.y);
await sleep(500);
const rj = JSON.parse(await ev(`JSON.stringify({
  entry: !!document.querySelector('.pcol .entry-html p'),
  pg: document.querySelector('.page-num')?.textContent || ""
})`));
check("点目录项跳到对应篇", rj.entry === true, JSON.stringify(rj));

// 6b. 跨页续文不带首行缩进（pg-cont），段落视觉连续
r = JSON.parse(await ev(`(() => {
  const ps = [...document.querySelectorAll('.pcol.right .entry-html p')];
  const p = ps[0];
  return JSON.stringify({cls: p ? p.className : "none", ti: p ? getComputedStyle(p).textIndent : ""});
})()`));
check("跨页续文无首行缩进", r.cls.includes("pg-cont") === true && r.ti === "0px", JSON.stringify(r));


// 7. 阅读页整页横线 + 相位压线
r = JSON.parse(await ev(`(() => {
  const pg = document.querySelector('.pcol.right .page');
  const cs = getComputedStyle(pg);
  const L = (parseFloat(cs.getPropertyValue('--writing-size')) || 17) * 2;
  const bgy = parseFloat(cs.backgroundPosition.split(' ')[1]);
  const bodyTop = pg.querySelector('.page-body').getBoundingClientRect().top - pg.getBoundingClientRect().top;
  const base = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--line-baseline'));
  const diff = (((bgy + L - 1 - bodyTop - base) % L) + L) % L;
  return JSON.stringify({bgy, bodyTop, base, L, diff, hasImg: cs.backgroundImage.includes('linear-gradient'), ok: (diff < 1.5 || diff > L - 1.5) && cs.backgroundImage.includes('linear-gradient')});
})()`));
check("阅读页整页横线且相位压线", r.ok === true, JSON.stringify(r));

// 8. 批注：角标 + 点角标弹卡片（无全局批注栏按钮）
c = await center('.flip-zone.right');
await clickAt(c.x, c.y);
await sleep(1200);
c = await center('.flip-zone.left');
await clickAt(c.x, c.y);
await sleep(1200);
const p0 = await center('.pcol.right .entry-html p');
const hBefore = p0.h;
await dragSelect(p0.left + 30, p0.top + 8, p0.left + 150, p0.top + 8);
await sleep(400);
r = await ev(`!!document.querySelector('.anno-btn')`);
check("拖选文字出现批注按钮", r === true);
c = await center('.anno-btn');
await clickAt(c.x, c.y);
await sleep(400);
await ev(`document.querySelector('.anno-compose textarea').focus(); 'ok'`);
await send("Input.insertText", { text: "这是批注内容" });
await sleep(100);
c = await center('.anno-compose .acts .btn.primary');
await clickAt(c.x, c.y);
await sleep(1200);

r = JSON.parse(await ev(`JSON.stringify({
  mark: !!document.querySelector('mark.anno-hl'),
  badge: !!document.querySelector('mark.anno-hl[data-n]'),
  n: document.querySelector('mark.anno-hl')?.dataset.n,
  toggle: !!document.querySelector('.anno-toggle'),
  pane: !!document.querySelector('.anno-pane')
})`));
check("正文出现带角标的高亮", r.mark && r.badge && r.n === "1", JSON.stringify(r));
check("没有全局批注栏/开关按钮", r.toggle === false && r.pane === false, JSON.stringify(r));
// 点击高亮 → 批注卡片
c = await center('mark.anno-hl');
await clickAt(c.x, c.y);
await sleep(500);
r = JSON.parse(await ev(`JSON.stringify({card: !!document.querySelector('.anno-card'), txt: document.querySelector('.anno-card .ac-t')?.textContent})`));
check("点击角标弹出批注卡片", r.card === true && r.txt === "这是批注内容", JSON.stringify(r));
// 点别处 → 卡片关闭
c = await center('.sheet');
await clickAt(c.x, c.y);
await sleep(400);
r = await ev(`!document.querySelector('.anno-card')`);
check("点别处批注卡片关闭", r === true);
// 高亮不改排版（角标绝对定位）
const p1 = await center('.pcol.right .entry-html p');
check("批注不改变正文排版", Math.abs(p1.h - hBefore) < 1, `before=${hBefore} after=${p1.h}`);
// 批注样式：透明底 + 下划线标记 + 角标悬浮行上方（不遮文字）
r = JSON.parse(await ev(`(() => {
  const m = document.querySelector('mark.anno-hl');
  const cs = getComputedStyle(m);
  const af = getComputedStyle(m, '::after');
  return JSON.stringify({
    bg: cs.backgroundColor,
    border: cs.borderBottomWidth + ' ' + cs.borderBottomStyle,
    badgeTop: af.top,
    ok: cs.backgroundColor === 'rgba(0, 0, 0, 0)' && parseFloat(cs.borderBottomWidth) > 0 && parseFloat(af.top) < 0
  });
})()`));
check("批注为下划线标记、角标不压字", r.ok === true, JSON.stringify(r));

// 8b. 重开已保存条目，在第二页输入不跳回第一页（带 id 段落的回归）
c = await center('.edit-peek');
await clickAt(c.x, c.y);
await sleep(1200);
r = JSON.parse(await ev(`(() => {
  const t = document.querySelector('.ed-pagenum')?.textContent || '';
  const m = t.match(/第 (\\d+) \\/ (\\d+) 页/);
  return JSON.stringify({cur: m ? +m[1] : -1, total: m ? +m[2] : -1});
})()`));
if (r.total >= 2) {
  for (let k = 0; k < 3; k++) {
    const cc = await center('.ed-flip.right');
    if (!cc) break;
    await clickAt(cc.x, cc.y);
    await sleep(500);
  }
  await ev(`(() => {
    const body = document.querySelector('.editor-body');
    body.focus();
    const tn = [...body.querySelectorAll('p')].map(p => p.firstChild).find(n => n && n.nodeType === 3);
    const sel = window.getSelection();
    const range = document.createRange();
    if (tn) { range.setStart(tn, Math.min(6, tn.textContent.length)); range.collapse(true); }
    else { range.selectNodeContents(body); range.collapse(true); }
    sel.removeAllRanges();
    sel.addRange(range);
    'ok';
  })()`);
  await send("Input.insertText", { text: "回" });
  await sleep(700);
  r = JSON.parse(await ev(`(() => {
    const t = document.querySelector('.ed-pagenum')?.textContent || '';
    const m = t.match(/第 (\\d+) \\/ (\\d+) 页/);
    return JSON.stringify({cur: m ? +m[1] : -1, total: m ? +m[2] : -1});
  })()`));
  check("重开条目第二页输入不跳回第一页", r.cur === 2 && r.total >= 2, JSON.stringify(r));
} else {
  check("重开条目第二页输入不跳回第一页", true, "（条目只有一页，跳过）");
}
// 取消编辑，回阅读视图（有改动 → 确认放弃）
c = await center('.ed-acts .btn.ghost');
await clickAt(c.x, c.y);
await sleep(500);
r = await ev(`!!document.querySelector('.anno-compose') && !!document.querySelector('.drawer-mask')`);
if (r === true) {
  c = await center('.anno-compose .btn.primary');
  await clickAt(c.x, c.y);
  await sleep(900);
}

// 9. 删除流回归
c = await center('.edit-peek');
await clickAt(c.x, c.y);
await sleep(700);
c = await center('.ed-acts .btn');
await clickAt(c.x, c.y);
await sleep(500);
r = await ev(`!!document.querySelector('.anno-compose') && !!document.querySelector('.drawer-mask')`);
check("确认对话框出现", r === true);
c = await center('.anno-compose .btn.primary');
await clickAt(c.x, c.y);
await sleep(1400);
r = await ev(`!!document.querySelector('#view-book') && !document.querySelector('.pcol .page-title')`);
check("确认删除完成", r === true);

// 10. 刷新持久化
await send("Page.reload", { ignoreCache: true });
await sleep(3500);
c = await center('.books .book');
await clickAt(c.x, c.y);
await sleep(1000);
for (let i = 0; i < 10 && !(await ev(`!!document.querySelector('.new-page-btn')`)); i++) {
  const cc = await center('.flip-zone.right');
  if (!cc) break;
  await clickAt(cc.x, cc.y);
  await sleep(950);
}
r = JSON.parse(await ev(`JSON.stringify({cols: document.querySelectorAll('.pcol').length, plus: !!document.querySelector('.new-page-btn'), pg: document.querySelector('.page-num')?.textContent})`));
check("刷新后正常且回到末页", r.cols === 2 && r.plus === true && /\/ \d+/.test(r.pg || ""), JSON.stringify(r));


const failed = results.filter((x) => !x);
console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
if (errs.length) { console.log("EXCEPTIONS:"); errs.forEach((e) => console.log("  " + e)); }
ws.close();
try { edge.kill(); } catch { }
process.exit(failed.length ? 1 : 0);
