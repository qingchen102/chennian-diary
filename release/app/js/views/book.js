/* ==========================================================================
   book.js — 书本阅读视图（左右双面开本 + 流式分页 + 角标批注）
   - 每篇日记按内容分页，超出一页自动流到下一页（翻页可见）
   - 选中文字即可加批注：正文只加高亮与小角标（不改变排版），点击角标弹批注卡片
   - 整页横线：文字基线落在横线上（相位按页眉高度逐页算好）
   ========================================================================== */
import * as store from "../store.js";
import * as nav from "../nav.js";
import * as quotes from "../quotes.js";
import { el, clear, imageUrlOf, lightbox, toast } from "../ui.js";
import { flipSound, penTap } from "../sound.js";
import { paginateEntry, applyMarks, paraTextOf } from "../pageflow.js";

const BLOCK_SEL = "p, blockquote, li, h1, h2, h3, div[id]";
const S = {
  bookId: null, pages: [], leaf: -1, flipping: false,
  lastLeaf: { diary: -1, essay: -1 }, pendingRebuild: false
};

let cleanup = null;
let host = null;
let bookView = null;
let annoBtn = null;   // 选区后的“批注”小按钮
let annoCard = null;  // 角标弹出的批注卡片
let rebuildTimer = null;
let flipTimer = null; // 翻页动画收尾定时器（离开页面前要清掉）

const isPageTag = (p) => p && p.kind === "entry";

export function openBook(appHost, { bookId, entryId }) {
  host = appHost;
  if (cleanup) cleanup();
  clear(host);

  const book = store.getBook(bookId);
  S.bookId = bookId;
  S.leaf = -1;
  S.pendingFlash = null;

  bookView = el("div", { class: "view fade-view", id: "view-book" });
  const stage = el("div", { class: "stage" },
    el("div", { class: "sheet" },
      el("div", { class: "spread" },
        el("div", { class: "pcol left" }),
        el("div", { class: "pcol right" }),
        el("div", { class: "spine-shadow" }),
        el("div", { class: "turner turner-l" },
          el("div", { class: "face front" }),
          el("div", { class: "face back" })),
        el("div", { class: "turner turner-r" },
          el("div", { class: "face front" }),
          el("div", { class: "face back" })))),
    el("div", { class: "flip-shine" }));

  const backBtn = el("button", { class: "back-shelf", onclick: () => nav.go("bookshelf") }, "‹ 书架");
  const tocBtn = el("button", { class: "toc-btn", title: "回目录", onclick: () => { penTap(); jumpToToc(); } }, "☰ 目录");
  const editPeek = el("button", { class: "edit-peek", title: "编辑左侧这一篇", onclick: () => { penTap(); const id = currentEntryId(); if (id) nav.go("editor", { bookId, entryId: id }); } }, "✎");
  const zoneL = flipZone("left", () => flip(-1));
  const zoneR = flipZone("right", () => flip(1));
  const pageNum = el("div", { class: "page-num" });
  const readHint = el("div", { class: "read-hint" }, "选中文字即可批注 · 点角标看批注 · 翻页可看续页 · 点铅笔修改本篇");

  bookView.append(stage, backBtn, tocBtn, editPeek, zoneL, zoneR, pageNum, readHint);
  host.append(bookView);

  const sheet = bookView.querySelector(".sheet");
  const turnerL = bookView.querySelector(".turner-l");
  const turnerR = bookView.querySelector(".turner-r");
  const colL = bookView.querySelector(".pcol.left");
  const colR = bookView.querySelector(".pcol.right");

  // 打开位置：指定篇 → 该篇首页所在叶；否则上次所在叶（须有日记）→ 否则最后一篇
  buildPages();
  if (entryId) {
    const idx = S.pages.findIndex((p) => p.kind === "entry" && p.entryId === entryId);
    if (idx >= 0) S.leaf = Math.floor(idx / 2);
  }
  if (S.leaf < 0) S.leaf = S.lastLeaf[bookId] ?? -1;
  if (S.leaf < 0 || !hasEntry(S.leaf)) {
    const last = lastEntryLeaf();
    S.leaf = last >= 0 ? last : 0;
  }
  if (S.leaf >= leafCount()) S.leaf = leafCount() - 1;
  if (S.leaf < 0) S.leaf = 0;

  paintSpread();
  updateChrome();

  /* ---- 翻页 ---- */
  function flip(dir) {
    if (S.flipping) return;
    const target = S.leaf + dir;
    if (target < 0) { toast("已是扉页"); return; }
    if (target >= leafCount()) { toast("已是最后一页"); return; }
    closeCard();
    S.flipping = true;
    if (hasEntry(target)) S.lastLeaf[bookId] = target;

    const turner = dir === 1 ? turnerR : turnerL;
    const front = turner.querySelector(".front");
    const back = turner.querySelector(".back");
    const frontTag = S.pages[2 * S.leaf + (dir === 1 ? 1 : 0)];
    const backTag = S.pages[2 * target + (dir === 1 ? 0 : 1)];
    front.innerHTML = pageHtml(frontTag);
    back.innerHTML = pageHtml(backTag);
    resolveImages(front);
    resolveImages(back);

    turner.classList.add("active");
    turner.classList.add(dir === 1 ? "turn-fwd" : "turn-back");
    sheet.classList.add(dir === 1 ? "flipping-fwd" : "flipping-back");
    flipSound();

    clearTimeout(flipTimer);
    flipTimer = setTimeout(() => {
      S.leaf = target;
      turner.style.transition = "none";
      turner.style.transform = "rotateY(0deg)";
      turner.classList.remove("active", "turn-fwd", "turn-back");
      sheet.classList.remove("flipping-fwd", "flipping-back");
      void turner.offsetWidth;
      paintSpread();
      S.flipping = false;
      updateChrome();
      if (S.pendingRebuild) { S.pendingRebuild = false; doRebuild(); }
    }, 880);
  }

  // 滑动翻页（从正文文字上拖拽是“选字批注”，不翻页）
  // 任何 pointerdown 都重置滑动起点，避免残留的 drag 被后续拖拽误判为翻页
  let drag = null;
  const resetDrag = () => { drag = null; };
  document.addEventListener("pointerdown", resetDrag, true);
  stage.addEventListener("pointerdown", (e) => {
    drag = e.target.closest(".entry-html") ? null : { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
  });
  stage.addEventListener("pointermove", (e) => {
    if (drag && e.pointerId === drag.id && Date.now() - drag.t < 900 && Math.abs(e.clientX - drag.x) > 40) {
      const dx = e.clientX - drag.x;
      const dt = Date.now() - drag.t;
      drag = null;
      if (Math.abs(dx) > 60 || dt < 500) flip(dx < 0 ? 1 : -1);
    }
  });

  // 键盘
  const onKey = (e) => {
    if (e.key === "ArrowLeft") flip(-1);
    else if (e.key === "ArrowRight") flip(1);
    else if (e.key === "Escape") nav.go("bookshelf");
  };
  window.addEventListener("keydown", onKey);

  // 图片 / 附件 / 关闭批注按钮
  stage.addEventListener("click", (e) => {
    const img = e.target.closest("img.diary-img");
    if (img) { lightbox(img.src, null); return; }
    const att = e.target.closest(".attach");
    if (att) { lightbox(att.dataset.url || "", null); return; }
    // 目录项 → 跳到对应篇
    const item = e.target.closest(".toc-item");
    if (item) {
      const leaf = Number(item.dataset.leaf);
      if (leaf >= 0 && leaf < leafCount()) { S.leaf = leaf; paintSpread(); updateChrome(); }
    }
  });

  // 批注高亮 / 角标点击 → 弹出批注卡片
  stage.addEventListener("click", (e) => {
    const mark = e.target.closest("mark.anno-hl");
    if (mark) {
      const entry = store.getState().entries.get(mark.closest(".pcol")?.dataset.entry);
      if (entry) {
        const ann = (entry.annotations || []).find((a) => a.id === mark.dataset.a);
        if (ann) showCard(mark, ann, entry);
      }
      return;
    }
  });

  // 选中文字 → 显示“批注”按钮
  const onSel = () => onSelectionChange();
  document.addEventListener("selectionchange", onSel);
  const onDocDown = (e) => {
    if (annoBtn && !annoBtn.contains(e.target)) hideAnnoBtn();
    if (annoCard && !annoCard.contains(e.target) && !e.target.closest("mark.anno-hl")) closeCard();
  };
  document.addEventListener("mousedown", onDocDown);

  // 窗口尺寸变化 → 重排
  const onResize = () => {
    if (S.flipping) { S.pendingRebuild = true; return; }
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(doRebuild, 250);
  };
  window.addEventListener("resize", onResize);

  cleanup = () => {
    window.removeEventListener("keydown", onKey);
    document.removeEventListener("selectionchange", onSel);
    document.removeEventListener("mousedown", onDocDown);
    window.removeEventListener("resize", onResize);
    document.removeEventListener("pointerdown", resetDrag, true);
    clearTimeout(rebuildTimer);
    clearTimeout(flipTimer);
    hideAnnoBtn();
    closeCard();
  };

  return cleanup;
}

/* ---------- 分页构建 ---------- */

function leafCount() { return Math.ceil(S.pages.length / 2); }
function hasEntry(leaf) { return isPageTag(S.pages[2 * leaf]) || isPageTag(S.pages[2 * leaf + 1]); }
function lastEntryLeaf() {
  let last = -1;
  S.pages.forEach((p, i) => { if (p.kind === "entry") last = Math.floor(i / 2); });
  return last;
}

function buildPages() {
  const sheet = bookView.querySelector(".sheet");
  const tpl = document.createElement("div");
  tpl.className = "pcol";
  tpl.style.cssText = "position:absolute; left:-9999px; top:0;";
  tpl.innerHTML = `<div class="page"><div class="page-inner"><div class="page-body"></div></div></div>`;
  sheet.append(tpl);
  const tplBody = tpl.querySelector(".page-body");
  const bodyW = tplBody.clientWidth;
  tpl.remove();

  const entries = store.entriesOf(S.bookId);
  const pages = [{ kind: "flyleaf" }, { kind: "toc" }];
  for (const entry of entries) {
    // 用真实页眉行测量首页正文高；续页（无页眉，但带 · 续 · 标）正文更高
    tpl.innerHTML = `<div class="page"><div class="page-inner">${headHtml(entry)}<div class="page-body"></div></div></div>`;
    sheet.append(tpl);
    const bodyHFirst = tpl.querySelector(".page-body").clientHeight;
    tpl.innerHTML = `<div class="page"><div class="page-inner"><div class="cont-hint">· 续 ·</div><div class="page-body"></div></div></div>`;
    const bodyHNext = tpl.querySelector(".page-body").clientHeight;
    tpl.remove();
    const bodyHtml = (entry.html || "") + attachStripHtml(entry);
    const parts = paginateEntry({ html: bodyHtml }, { bodyW, bodyHFirst, bodyHNext });
    parts.forEach((p, i) => pages.push({ kind: "entry", entryId: entry.id, part: i + 1, total: parts.length, pieces: p.pieces }));
  }
  pages.push({ kind: "new" });
  S.pages = pages;
}

function attachStripHtml(entry) {
  const atts = entry.attachments || [];
  if (!atts.length) return "";
  const inner = atts.map((imgId) =>
    `<span class="attach" data-imgid="${imgId}" title="查看图片"><img alt=""></span>`).join("");
  return `<div class="attach-strip">${inner}</div>`;
}

/* ---------- 绘制 ---------- */

function paintSpread() {
  if (!bookView) return;
  const left = S.pages[2 * S.leaf];
  const right = S.pages[2 * S.leaf + 1];
  paintColumn(bookView.querySelector(".pcol.left"), left);
  paintColumn(bookView.querySelector(".pcol.right"), right);
}

function paintColumn(col, page) {
  col.innerHTML = pageHtml(page);
  col.dataset.entry = page?.kind === "entry" ? page.entryId : "";
  if (page && page.kind !== "blank") {
    const idx = S.pages.indexOf(page);
    if (idx >= 0) col.append(el("span", { class: "pg-no" }, String(idx + 1)));
  }
  // 整页横线相位：文字基线必须压线（相位随页眉高度变化）
  const pg = col.querySelector(".page");
  if (pg && !pg.classList.contains("plain")) {
    const cs = getComputedStyle(pg);
    const L = (parseFloat(cs.getPropertyValue("--writing-size")) || 17) * 2;
    const base = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--line-baseline")) || 0;
    const top = (pg.querySelector(".page-body")?.getBoundingClientRect().top || pg.getBoundingClientRect().top) - pg.getBoundingClientRect().top;
    let pos = top + base - L + 1;
    pos = ((pos % L) + L) % L;
    pg.style.backgroundPosition = `0 ${pos.toFixed(2)}px`;
  }
  resolveImages(col);
  const plus = col.querySelector(".new-page-btn");
  if (plus) plus.addEventListener("click", () => { penTap(); nav.go("editor", { bookId: S.bookId }); });
}

function pageHtml(page) {
  if (!page) return blankPageHtml();
  if (page.kind === "flyleaf") return flyleafHtml();
  if (page.kind === "toc") return tocHtml();
  if (page.kind === "new") return newPageHtml();
  if (page.kind === "blank") return blankPageHtml();
  return entryPageHtml(page);
}

function entryPageHtml(page) {
  const entry = store.getState().entries.get(page.entryId);
  if (!entry) return blankPageHtml();
  const annos = normalizedAnnos(entry);
  const numOf = numberMap(annos);
  const bodyHtml = page.pieces.map((pc) => applyMarks(pc.html, annos, numOf)).join("");
  const mood = page.part === 1 && entry.mood
    ? (entry.mood.startsWith("img:")
      ? `<div class="mood-stamp img" data-stamp="${esc(entry.mood.slice(4))}"></div>`
      : `<div class="mood-stamp">${esc(entry.mood)}</div>`)
    : "";
  const head = page.part === 1 ? headHtml(entry) : `<div class="cont-hint">· 续 ·</div>`;
  return `<div class="page">${mood}
    <div class="page-inner">${head}
      <div class="page-body"><div class="entry-html">${bodyHtml}</div></div>
    </div>
  </div>`;
}

function headHtml(entry) {
  const bits = [];
  if (entry.dateMode === "event") bits.push(`<span class="hd-date">${esc(entry.eventName || "事件")} Day${entry.eventDay || 1}</span>`);
  else bits.push(`<span class="hd-date">${esc(store.fmtDate(entry.date))}</span>`);
  if (entry.weather) bits.push(`<span class="hd-wx">☁ ${esc(entry.weather)}</span>`);
  if (entry.place) bits.push(`<span class="hd-place">📍 ${esc(entry.place)}</span>`);
  if (entry.title) bits.push(`<span class="hd-title">${esc(entry.title)}</span>`);
  return `<div class="hd-row">${bits.join("")}</div>`;
}

function blankPageHtml() {
  return `<div class="page"><div class="page-inner"><div class="page-body" style="flex:1"><div class="entry-html" style="min-height:100%"></div></div></div></div>`;
}

function flyleafHtml() {
  const book = store.getBook(S.bookId);
  const entries = store.entriesOf(S.bookId);
  const words = entries.reduce((m, e) => m + (e.wordCount || 0), 0);
  const q = quotes.todayQuote();
  const first = entries[0];
  const dateLine = entries.length ? `${store.fmtDate(first.date || "0000-00-00")} 起笔` : "尚未落笔";
  return `<div class="page plain">
    <div class="page-inner" style="align-items:center; justify-content:center; text-align:center; gap:14px;">
      <div style="font-size:13px; letter-spacing:5px; color:var(--ink-faint);">尘年往事 · 手札</div>
      <div style="font-size:38px; letter-spacing:8px; color:var(--ink); font-family:'华文行楷','STXingkai','楷体',serif; padding-left:8px;">${esc(book.name)}</div>
      <div style="font-size:12px; color:var(--ink-soft); letter-spacing:2px;">${dateLine}</div>
      <div style="width:60px; height:1px; background:var(--paper-line); margin:4px 0;"></div>
      <div style="max-width:80%; font-size:14px; line-height:1.9; color:var(--ink-soft);">${q ? esc(q.t) : ""}</div>
      <div style="font-size:11px; color:var(--ink-faint);">${q ? esc(q.s) + (q.d ? " · " + esc(q.d) : "") : ""}</div>
      <div style="font-size:12px; color:var(--ink-faint); letter-spacing:2px; margin-top:12px;">共 ${entries.length} 篇 · ${words} 字</div>
    </div>
  </div>`;
}

function tocHtml() {
  const entries = store.entriesOf(S.bookId);
  const items = entries.map((e) => {
    const idx = S.pages.findIndex((p) => p.kind === "entry" && p.entryId === e.id);
    const leaf = idx >= 0 ? Math.floor(idx / 2) : -1;
    return `<div class="toc-item" data-leaf="${leaf}">${esc(e.title || "（无题）")}<span class="toc-no">${idx >= 0 ? `第 ${idx + 1} 页` : ""}</span></div>`;
  }).join("");
  return `<div class="page plain">
    <div class="page-inner toc">
      <div class="toc-title">目 录</div>
      <div class="toc-list">${items || `<div class="toc-empty">还没有日记，翻到最后一页写一篇吧</div>`}</div>
    </div>
  </div>`;
}

function newPageHtml() {
  return `<div class="page plain">
    <div style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:22px;">
      <div style="font-size:14px; letter-spacing:3px; color:var(--ink-faint);">这已是最后一篇</div>
      <button class="new-page-btn" title="写一篇新的">+</button>
      <div style="font-size:12px; letter-spacing:2px; color:var(--ink-soft);">点「+」写一篇新日记</div>
    </div>
  </div>`;
}

function resolveImages(node) {
  for (const img of node.querySelectorAll("img[data-imgid]")) {
    const id = img.dataset.imgid;
    if (!id) continue;
    imageUrlOf(store, id).then((u) => { if (u && img.isConnected) img.src = u; });
  }
  for (const att of node.querySelectorAll(".attach[data-imgid]")) {
    const id = att.dataset.imgid;
    if (!id) continue;
    imageUrlOf(store, id).then((u) => { if (u && att.isConnected) { att.dataset.url = u; const im = att.querySelector("img"); if (im) im.src = u; } });
  }
  for (const st of node.querySelectorAll(".mood-stamp.img[data-stamp]")) {
    imageUrlOf(store, st.dataset.stamp).then((u) => {
      if (u && st.isConnected && !st.querySelector("img")) {
        const im = document.createElement("img"); im.src = u; im.alt = ""; st.append(im);
      }
    });
  }
}

/* ---------- 批注 ---------- */

function normalizedAnnos(entry) {
  const src = entry.annotations || [];
  return src.map((a) => {
    if (Number.isFinite(a.start) && Number.isFinite(a.end)) return a;
    return { ...a, start: 0, end: paraTextOf(entry.html || "", a.paraId).length };
  });
}

function numberMap(annos) {
  const sorted = [...annos].sort((a, b) => (a.paraId < b.paraId ? -1 : a.paraId > b.paraId ? 1 : a.start - b.start));
  const m = new Map();
  sorted.forEach((a, i) => m.set(a.id, i + 1));
  return (id) => m.get(id) || 0;
}

function currentEntryId() {
  const left = S.pages[2 * S.leaf];
  const right = S.pages[2 * S.leaf + 1];
  return (left?.kind === "entry" ? left.entryId : null) || (right?.kind === "entry" ? right.entryId : null);
}

/** 选区处理：同一段落内的非空选区 → 显示“批注”按钮 */
function onSelectionChange() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !bookView || !bookView.isConnected) { hideAnnoBtn(); return; }
  const anchorEl = sel.anchorNode?.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
  const focusEl = sel.focusNode?.nodeType === 3 ? sel.focusNode.parentElement : sel.focusNode;
  if (!anchorEl || !focusEl) { hideAnnoBtn(); return; }
  if (!bookView.contains(anchorEl) || !bookView.contains(focusEl)) { hideAnnoBtn(); return; }
  const aP = anchorEl.closest(BLOCK_SEL);
  const fP = focusEl.closest(BLOCK_SEL);
  if (!aP || aP !== fP || !aP.closest(".entry-html")) { hideAnnoBtn(); return; }
  const col = aP.closest(".pcol");
  const page = S.pages[2 * S.leaf + (col?.classList.contains("left") ? 0 : 1)];
  if (!page || page.kind !== "entry") { hideAnnoBtn(); return; }
  const paraId = aP.dataset.pid || aP.id || "";
  const shift = Number(aP.dataset.shift || 0);
  const start = shift + localOffsetOf(aP, sel.anchorNode, sel.anchorOffset);
  const end = shift + localOffsetOf(aP, sel.focusNode, sel.focusOffset);
  if (Math.abs(end - start) < 1) { hideAnnoBtn(); return; }
  const range = sel.getRangeAt(0);
  const rects = range.getClientRects();
  const last = rects[rects.length - 1];
  if (!last) { hideAnnoBtn(); return; }
  showAnnoBtn(last.right + 4, last.top - 8, { entryId: page.entryId, paraId, start: Math.min(start, end), end: Math.max(start, end) });
}

function localOffsetOf(block, node, offset) {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let acc = 0, n;
  while ((n = walker.nextNode())) {
    if (n === node) return acc + offset;
    acc += n.textContent.length;
  }
  return acc;
}

function showAnnoBtn(x, y, anchor) {
  hideAnnoBtn();
  annoBtn = el("div", { class: "anno-btn", onclick: () => { openAnnoCompose(anchor); } }, "✎ 批注");
  annoBtn.style.left = `${Math.min(Math.max(x - 10, 8), window.innerWidth - 90)}px`;
  annoBtn.style.top = `${Math.max(y, 8)}px`;
  bookView.append(annoBtn);
}

function hideAnnoBtn() {
  annoBtn?.remove();
  annoBtn = null;
}

async function openAnnoCompose(anchor) {
  hideAnnoBtn();
  const entry = store.getState().entries.get(anchor.entryId);
  if (!entry) return;
  const paraText = paraTextOf(entry.html || "", anchor.paraId);
  const quote = paraText.slice(anchor.start, anchor.end).replace(/\s+/g, " ").trim().slice(0, 60);
  let imgId = null;

  const fileInput = el("input", { type: "file", accept: "image/*", style: { display: "none" } });
  const imgPrev = el("img", { class: "img-prev", style: { display: "none" } });
  const ta = el("textarea", { placeholder: "在批注里写下你的想法……" });

  const box = el("div", { class: "anno-compose" },
    el("div", { class: "t" }, "添加批注",
      el("small", { text: "自动记录日期时间" })),
    el("div", { style: { fontSize: "12px", color: "var(--ink-faint)", marginBottom: "8px", lineHeight: "1.6" } }, `「${quote || "选中内容"}」`),
    ta,
    el("div", { class: "row" },
      imgPrev,
      el("button", { class: "btn ghost", onclick: () => fileInput.click() }, "附一张图"),
      fileInput),
    el("div", { class: "acts" },
      el("button", { class: "btn ghost", onclick: () => box.remove() }, "取消"),
      el("button", {
        class: "btn primary",
        onclick: async () => {
          const text = ta.value.trim();
          if (!text && !imgId) { toast("批注内容不能为空"); return; }
          const ann = {
            id: store.uid("a"), paraId: anchor.paraId, start: anchor.start, end: anchor.end,
            text, imgId: imgId || null, createdAt: store.nowStamp()
          };
          entry.annotations = entry.annotations || [];
          entry.annotations.push(ann);
          await store.saveEntry(entry);
          box.remove();
          penTap();
          paintSpread();
          updateChrome();
          toast("批注已记下");
        }
      }, "记下")));

  fileInput.addEventListener("change", async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    imgId = store.uid("img");
    await store.putImage({ id: imgId, blob: f, mime: f.type, entryId: entry.id, addedAt: Date.now() });
    const u = await imageUrlOf(store, imgId); // 走统一缓存，避免游离的 objectURL 泄漏
    if (u) { imgPrev.src = u; imgPrev.style.display = ""; }
  });

  host.append(box);
  ta.focus();
}

/* ---------- 批注卡片（点角标弹出，不点不显示） ---------- */

function showCard(mark, ann, entry) {  closeCard();
  const numOf = numberMap(normalizedAnnos(entry));
  const paraText = paraTextOf(entry.html || "", ann.paraId);
  const quote = paraText.slice(ann.start, ann.end).replace(/\s+/g, " ").trim();
  const card = el("div", { class: "anno-card" },
    el("div", { class: "ac-head" },
      el("span", {}, el("span", { class: "no" }, String(numOf(ann.id) || "·")), `📅 ${ann.createdAt}`),
      el("button", { class: "close", onclick: closeCard }, "✕")),
    el("div", { class: "ac-q" }, quote || "（选中内容）"),
    ann.text ? el("div", { class: "ac-t" }, ann.text) : null);
  if (ann.imgId) {
    const im = el("img", { style: { display: "none" } });
    card.append(im);
    imageUrlOf(store, ann.imgId).then((u) => { if (u && im.isConnected) { im.src = u; im.style.display = ""; } });
  }
  const mr = mark.getBoundingClientRect();
  const vr = bookView.getBoundingClientRect();
  let left = mr.left - vr.left + mr.width + 8;
  if (left + 270 > vr.width - 8) left = mr.left - vr.left - 270 - 8;
  left = Math.max(8, left);
  card.style.left = `${left}px`;
  card.style.top = `${Math.max(8, mr.top - vr.top - 24)}px`;
  bookView.append(card);
  annoCard = card;
}

function closeCard() {
  annoCard?.remove();
  annoCard = null;
}

/* ---------- 其他 ---------- */

function flipZone(side, fn) {
  return el("div", {
    class: `flip-zone ${side}`,
    onclick: fn,
    title: side === "left" ? "向前翻（更早）" : "向后翻（更新）"
  }, el("span", { class: "chev" }, side === "left" ? "‹" : "›"));
}

function jumpToToc() {
  const idx = S.pages.findIndex((p) => p.kind === "toc");
  if (idx >= 0) { S.leaf = Math.floor(idx / 2); paintSpread(); updateChrome(); }
}

function updateChrome() {
  if (!bookView) return;
  const pageNum = bookView.querySelector(".page-num");
  const editPeek = bookView.querySelector(".edit-peek");
  const l = S.pages[2 * S.leaf];
  const r = S.pages[2 * S.leaf + 1];
  const li = S.pages.indexOf(l) + 1;
  const ri = S.pages.indexOf(r) + 1;
  const parts = [];
  if (l && li > 0) parts.push(li);
  if (r && ri > 0 && ri !== li) parts.push(ri);
  pageNum.textContent = parts.length ? `${parts.join("–")} / ${S.pages.length}` : "";
  editPeek.style.visibility = currentEntryId() ? "visible" : "hidden";
}

function scheduleRebuild(delay = 60) {
  if (S.flipping) { S.pendingRebuild = true; return; }
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(doRebuild, delay);
}

function doRebuild() {
  buildPages();
  if (S.leaf >= leafCount()) S.leaf = Math.max(0, leafCount() - 1);
  if (S.leaf < 0) S.leaf = 0;
  closeCard();
  paintSpread();
  updateChrome();
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
