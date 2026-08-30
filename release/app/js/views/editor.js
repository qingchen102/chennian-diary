/* ==========================================================================
   editor.js — 书写视图（双面开本 + 流式分页）
   - 右页书写：内容按页流动，写满自动续页；← → / 边缘点击翻页
   - 左页上下文：本篇上一页（翻页时）/ 前一篇末页（第一篇时）
   - 回车 = 新段落（段距为零，不再空一行）；文字基线压线（横线只在书写区）
   - 日期双模式、天气、地点、标题、富文本工具栏、插图、页脚相册、心情、保存/删除
   ========================================================================== */
import * as store from "../store.js";
import * as nav from "../nav.js";
import { el, clear, imageUrlOf, toast, confirmDialog } from "../ui.js";
import { penTap } from "../sound.js";
import { sanitizeHtml, ensureParaIds, countWords } from "../sanitize.js";
import { paginateEntry, reanchorAnnos } from "../pageflow.js";

let cleanup = null;
let host = null;

export function openEditor(appHost, { bookId, entryId }) {
  host = appHost;
  if (cleanup) cleanup();
  clear(host);

  const book = store.getBook(bookId);
  const existing = entryId ? store.getState().entries.get(entryId) : null;
  const isNew = !existing;

  /* ---- 状态 ---- */
  const st = {
    bookId,
    entryId: existing ? existing.id : null,
    dateMode: existing?.dateMode || "gregorian",
    attachments: existing?.attachments ? [...existing.attachments] : [],
    mood: existing?.mood || null,
    eventName: existing?.eventName || "",
    eventDay: existing?.eventDay || store.nextEventDay(bookId, existing?.eventName || ""),
    pages: [{ shift: 0, html: existing?.html || "" }], // 分页结果
    curPage: 0,
    composing: false,
    repaintTimer: null,
    pendingIds: [], // 新草稿里插入的图片（库里暂记 entryId="pending"），保存时收编、取消时清理
    nextHtml: null // 下一篇首页（只读上下文，右页显示）
  };

  document.execCommand("defaultParagraphSeparator", false, "p"); // 回车产生 <p>，保证批注定位、不空行

  /* ---- 表单 ---- */
  const dateInput = el("input", { type: "date", value: existing?.date || store.todayStr() });
  const weatherInput = el("input", { list: "weather-list", placeholder: "晴 / 多云 / 雨……", value: existing?.weather || "", oninput: () => { renderHead(); scheduleRepaint(300); } });
  const weatherList = el("datalist", { id: "weather-list" }, store.WEATHERS.map((w) => el("option", { value: w })));
  const placeInput = el("input", { placeholder: "哪里？", value: existing?.place || "", oninput: () => { renderHead(); scheduleRepaint(300); } });
  const titleInput = el("input", { placeholder: "今天发生了什么？（必填）", value: existing?.title || "", oninput: () => { renderHead(); scheduleRepaint(300); } });

  const eventNameInput = el("input", {
    placeholder: "如：放假 / 备考 / 旅行",
    value: st.eventName,
    oninput: () => {
      st.eventName = eventNameInput.value.trim();
      st.eventDay = existing ? (existing.eventDay || 1) : store.nextEventDay(bookId, st.eventName);
      dayLabel.textContent = `Day ${st.eventDay}`;
      renderHead();
      scheduleRepaint(300);
    }
  });
  const dayLabel = el("span", { style: { fontSize: "14px", color: "var(--ink-soft)", whiteSpace: "nowrap" } }, `Day ${st.eventDay}`);

  const modeG = el("button", { class: "on", onclick: () => setMode("gregorian") }, "公历");
  const modeE = el("button", { onclick: () => setMode("event") }, "事件");
  const modeSwitch = el("div", { class: "mode-switch" }, modeG, modeE);
  const gDateCell = el("label", { style: { display: st.dateMode === "gregorian" ? "flex" : "none" } }, "日期", dateInput);
  const eDateCell = el("label", { style: { display: st.dateMode === "event" ? "flex" : "none" } }, "事件计时", el("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, eventNameInput, dayLabel));

  function setMode(m) {
    st.dateMode = m;
    modeG.classList.toggle("on", m === "gregorian");
    modeE.classList.toggle("on", m === "event");
    gDateCell.style.display = m === "gregorian" ? "flex" : "none";
    eDateCell.style.display = m === "event" ? "flex" : "none";
    renderHead();
    scheduleRepaint(300);
  }

  /* ---- 双面开本：左页书写、右页显示“下一页/下一篇” ---- */
  const body = el("div", { class: "editor-body", contenteditable: "true", spellcheck: "false" });
  const dateEl = el("span", { class: "hd-date" });
  const weatherEl = el("span", { class: "hd-wx" });
  const placeEl = el("span", { class: "hd-place" });
  const titleEl = el("span", { class: "hd-title" });
  const contHint = el("div", { class: "cont-hint", style: { display: "none" } }, "· 续 ·");
  const bodyZone = el("div", { class: "ed-body-zone" }, body);
  const headEl = el("div", { class: "hd-row" }, dateEl, weatherEl, placeEl, titleEl);
  const writePage = el("div", { class: "page plain" },
    el("div", { class: "page-inner" },
      headEl,
      contHint,
      bodyZone));
  const ctxFace = el("div", { class: "face" });
  const ctxLbl = el("div", { class: "ctx-lbl" }, "下一篇");
  const writeCol = el("div", { class: "pcol left" }, writePage);
  const ctxCol = el("div", { class: "pcol right" }, ctxFace, ctxLbl);

  const spread = el("div", { class: "spread" }, writeCol, ctxCol);
  const pagenumEl = el("div", { class: "ed-pagenum" });
  const flipL = el("div", { class: "ed-flip left", title: "翻到上一页", onclick: () => flipPage(-1) });
  const flipR = el("div", { class: "ed-flip right", title: "翻到下一页", onclick: () => flipPage(1) });
  const frame = el("div", { class: "editor-frame" }, spread, pagenumEl, flipL, flipR);

  /* ---- 工具栏 ---- */
  const toolbar = el("div", { class: "toolbar" });
  function tb(label, cmd, val, cls, title) {
    const b = el("button", {
      class: `tb-btn ${cls || ""}`, title: title || label,
      onmousedown: (e) => e.preventDefault(),
      onclick: () => { body.focus(); if (cmd) document.execCommand(cmd, false, val); }
    }, label);
    toolbar.append(b);
    return b;
  }
  function tbSep() { toolbar.append(el("span", { class: "tb-sep" })); }

  tb("B", "bold", null, "b", "加粗");
  tb("I", "italic", null, "i", "斜体");
  tb("U", "underline", null, "u", "下划线");
  tb("S", "strikeThrough", null, "s", "删除线");
  tbSep();
  tb("标题", "formatBlock", "h2", null, "标题");
  tb("引", "formatBlock", "blockquote", null, "引用");
  tb("• 列表", "insertUnorderedList", null, null, "项目列表");
  tb("1. 列表", "insertOrderedList", null, null, "编号列表");
  tbSep();

  // 字体
  const fontSel = el("select", {
    class: "tb-select", title: "字体",
    onmousedown: (e) => e.stopPropagation(),
    onchange: () => {
      const f = store.FONTS.find((x) => x.name === fontSel.value);
      body.focus();
      document.execCommand("fontName", false, f ? f.css : "inherit");
    }
  }, store.FONTS.map((f) => el("option", { value: f.name }, f.name)));
  fontSel.value = store.getState().settings.font;
  toolbar.append(fontSel);
  toolbar.append(el("span", { class: "tb-sep" }));

  // 颜色
  const colorRow = el("span", { style: { display: "inline-flex", gap: "3px", alignItems: "center" } });
  store.COLORS.forEach((c) => {
    const sw = el("button", {
      class: "tb-color",
      style: { background: c.value },
      title: `${c.name}（新文字颜色，已写文字不受影响）`,
      onmousedown: (e) => e.preventDefault(),
      onclick: () => { body.focus(); document.execCommand("styleWithCSS", false, true); document.execCommand("foreColor", false, c.value); }
    });
    if (c.value === store.getState().settings.color) sw.classList.add("on");
    colorRow.append(sw);
  });
  toolbar.append(colorRow);
  toolbar.append(el("span", { class: "tb-sep" }));

  // 插图（正文内联）
  const inlineFile = el("input", { type: "file", accept: "image/*", style: { display: "none" } });
  inlineFile.addEventListener("change", async () => {
    const f = inlineFile.files && inlineFile.files[0];
    if (!f) return;
    const imgId = store.uid("img");
    await store.putImage({ id: imgId, blob: f, mime: f.type, entryId: st.entryId || "pending", addedAt: Date.now() });
    if (!st.entryId) st.pendingIds.push(imgId);
    body.focus();
    document.execCommand("insertHTML", false, `<img data-imgid="${imgId}" class="diary-img" alt="">`);
    const u = await imageUrlOf(store, imgId);
    const im = body.querySelector(`img[data-imgid="${imgId}"]`);
    if (im && u) im.src = u;
    toast("图片已插入正文");
    scheduleRepaint(120);
    setTimeout(() => scheduleRepaint(60), 250); // 图片加载后尺寸变化，再排一次版
  });
  const imgBtn = tb("🖼 插图", null, null, null, "插入图片到正文");
  imgBtn.addEventListener("click", () => inlineFile.click());
  toolbar.append(inlineFile);
  tbSep();
  tb("清除格式", "removeFormat", null, null, "清除选中文字的格式");
  tbSep();
  const clearAllBtn = tb("清空", null, null, null, "清空正文");
  clearAllBtn.addEventListener("click", () => {
    st.pages = [{ shift: 0, html: "" }];
    st.curPage = 0;
    renderPages();
    body.focus();
  });

  /* ---- 附件相册（页脚） ---- */
  const attachStrip = el("div", { class: "strip" });
  const attachAdd = el("button", { class: "add", title: "添加到页脚相册", onclick: () => attachFile.click() }, "+");
  const attachFile = el("input", { type: "file", accept: "image/*", style: { display: "none" }, multiple: true });
  attachFile.addEventListener("change", async () => {
    for (const f of attachFile.files) {
      const imgId = store.uid("img");
      await store.putImage({ id: imgId, blob: f, mime: f.type, entryId: st.entryId || "pending", addedAt: Date.now() });
      if (!st.entryId) st.pendingIds.push(imgId);
      st.attachments.push(imgId);
    }
    renderAttaches();
  });
  function renderAttaches() {
    clear(attachStrip);
    for (const id of st.attachments) {
      const cell = el("div", { class: "attach" },
        el("img", { alt: "" }),
        el("button", { class: "del", onclick: () => {
          st.attachments = st.attachments.filter((x) => x !== id);
          if (st.entryId) {
            // 已保存的日记：记录等保存时统一清理（取消编辑则原样保留）
          } else {
            // 新草稿：图片记录一并删掉，不留孤儿数据
            st.pendingIds = st.pendingIds.filter((x) => x !== id);
            store.deleteImages([id]);
          }
          renderAttaches();
        } }, "✕"));
      imageUrlOf(store, id).then((u) => { if (u && cell.isConnected) cell.querySelector("img").src = u; });
      attachStrip.append(cell);
    }
    attachStrip.append(attachAdd);
  }
  renderAttaches();

  /* ---- 心情（表情章 + 自选图片印章） ---- */
  const moodRow = el("div", { class: "mood-row" });
  function highlightMood() {
    moodRow.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
    const cur = st.mood;
    moodRow.querySelectorAll("button").forEach((x) => {
      if ((x.dataset.mood === cur) || (x.dataset.moodImg && cur === "img:" + x.dataset.moodImg)) x.classList.add("on");
    });
  }
  store.MOODS.forEach((m) => {
    moodRow.append(el("button", {
      text: m, "data-mood": m, title: "盖个心情章（再点一次取消）",
      onclick: () => { st.mood = st.mood === m ? null : m; highlightMood(); }
    }));
  });
  // 自选图片印章：保存于图片库（entryId="stamp"），全局复用
  const stampFile = el("input", { type: "file", accept: "image/*", class: "stamp-file", style: { display: "none" } });
  stampFile.addEventListener("change", async () => {
    const f = stampFile.files && stampFile.files[0];
    if (!f) return;
    const id = store.uid("img");
    await store.putImage({ id, blob: f, mime: f.type, entryId: "stamp", addedAt: Date.now() });
    st.mood = "img:" + id;
    renderMoodRow();
    toast("印章已加入，可点它取消/换回表情");
  });
  const moodAdd = el("button", { class: "mood-add", title: "自选图片做印章（PNG 带透明底效果最好）", onclick: () => stampFile.click() }, "🖼");
  function renderMoodRow() {
    for (const b of moodRow.querySelectorAll("button.custom")) b.remove();
    moodRow.append(moodAdd);
    store.stampImages().then(async (imgs) => {
      if (!moodRow.isConnected) return;
      for (const rec of imgs) {
        const url = await imageUrlOf(store, rec.id);
        if (!url) continue;
        const b = el("button", {
          class: "custom", "data-mood-img": rec.id,
          title: "自选印章（再点一次取消）",
          onclick: () => { st.mood = st.mood === "img:" + rec.id ? null : "img:" + rec.id; highlightMood(); }
        },
          el("img", { alt: "" }),
          el("span", { class: "del", title: "删除这枚印章", onclick: (e) => {
            e.stopPropagation();
            store.deleteStampImage(rec.id).then(() => {
              if (st.mood === "img:" + rec.id) st.mood = null;
              renderMoodRow();
            });
          } }, "✕"));
        const im = b.querySelector("img"); im.src = url; im.dataset.src = url;
        moodRow.insertBefore(b, moodAdd);
      }
      highlightMood();
    });
  }
  renderMoodRow();
  highlightMood();

  const attachPanel = el("div", { class: "editor-attach" },
    el("div", { class: "lbl", style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
      el("span", { text: "页脚相册（阅读时以小图展示，点击放大）" }),
      el("span", { style: { display: "inline-flex", alignItems: "center", gap: "10px" } },
        el("span", { text: "心情：" }), moodRow)),
    attachStrip, attachFile, stampFile);

  /* ---- 顶部操作 ---- */
  const acts = el("div", { class: "ed-acts" },
    existing ? el("button", { class: "btn", style: { color: "var(--danger)", borderColor: "rgba(156,59,46,.4)" }, onclick: onDelete }, "删除") : null,
    el("button", { class: "btn ghost", onclick: onCancel }, "取消"),
    el("button", { class: "btn primary", onclick: onSave }, "保存"));

  const v = el("div", { class: "view fade-view", id: "view-editor" },
    el("div", { class: "editor-wrap" },
      el("div", { class: "editor-top" },
        el("span", { class: "ed-title" }, `${isNew ? "新写一篇 · " : "修改 · "}${book.name}`),
        acts),
      el("div", { class: "meta-grid" },
        el("label", {}, "日期模式", el("div", { class: "date-mode" }, modeSwitch)),
        gDateCell, eDateCell,
        el("label", {}, "天气", el("div", { style: { position: "relative" } }, weatherInput, weatherList)),
        el("label", {}, "地点", placeInput),
        el("label", {}, "标题", titleInput)),
      toolbar,
      frame,
      attachPanel));
  host.append(v);

  /* ---- 分页 / 重排 ---- */
  /** 首页（页眉行可见）与续页（仅 · 续 ·）的书写区高度 —— 与阅读页的测量口径一致 */
  function measureZone() {
    const ph = headEl.style.display, pc = contHint.style.display;
    headEl.style.display = "";
    contHint.style.display = "none";
    const h1 = bodyZone.clientHeight;
    headEl.style.display = "none";
    contHint.style.display = "";
    const h2 = bodyZone.clientHeight;
    headEl.style.display = ph;
    contHint.style.display = pc;
    return { first: h1, next: h2 };
  }

  function paginateNow() {
    const z = measureZone();
    const joined = st.pages.map((p) => p.html).join("");
    const parts = paginateEntry({ html: joined }, { bodyW: bodyZone.clientWidth, bodyHFirst: z.first, bodyHNext: z.next });
    st.pages = parts.map((p, i) => ({
      shift: p.pieces[0]?.shift || 0,
      // 剥离分页定位用的 data 属性：编辑器内不需要，避免“属性不同”导致无谓重绘
      html: p.pieces.map((x) => x.html).join("").replace(/\sdata-(pid|shift)="[^"]*"/g, "")
    }));
    if (st.pages.length === 0) st.pages = [{ shift: 0, html: "" }];
  }

  function scheduleRepaint(delay) {
    clearTimeout(st.repaintTimer);
    st.repaintTimer = setTimeout(repaintFromInput, delay);
  }

  /** 第 i 页内容的全局起始字符偏移（前 i 页文字长度之和）。
   *  注意不能用 st.pages[i].shift：那是“段内已消费字符数”，只有整篇段落共用
   *  一个空 id 时才碰巧等于全局偏移；保存过的条目每段有独立 id，用 shift 算
   *  光标会把第二页的输入误判到第一页（跳页）。 */
  function pageGlobalStart(i) {
    let acc = 0;
    for (let k = 0; k < i; k++) acc += textLenOf(k);
    return acc;
  }

  function repaintFromInput() {
    // 保存当前页编辑结果
    const liveHtml = body.innerHTML;
    st.pages[st.curPage] = { shift: st.pages[st.curPage]?.shift || 0, html: liveHtml };
    const focusedBody = document.activeElement === body;
    // 光标全局偏移 = 当前页全局起点 + 页内偏移
    const oldStart = pageGlobalStart(st.curPage);
    const gOff = focusedBody ? (oldStart + caretOffsetIn(body)) : null;
    const oldLen = st.pages.length;
    const oldCur = st.curPage;
    paginateNow();
    // 光标定位：页尾归下一页（内容跟手）
    let idx = null;
    if (gOff != null) {
      idx = st.pages.length - 1;
      let acc = 0;
      for (let i = 0; i < st.pages.length; i++) {
        const len = textLenOf(i);
        if (gOff >= acc && gOff < acc + len) { idx = i; break; }
        acc += len;
      }
    }
    const o = Math.min(oldCur, st.pages.length - 1);
    // 当前页内容是否被重排走（有内容溢到下一页）
    const curLost = st.pages[o]?.html !== liveHtml;
    // 光标恰在旧页末尾、且旧页内容原样保留（没溢出）：留在当前页，避免“无输入却跳页”
    const oEnd = pageGlobalStart(o) + textLenOf(o);
    if (idx != null && idx === o + 1 && !curLost && gOff === oEnd) idx = o;
    const newCur = idx != null ? idx : Math.min(oldCur, st.pages.length - 1);
    // 没溢页、没跨页、分页结果与当前 DOM 一致：绝不动 DOM（避免打断正在进行的输入）
    if (focusedBody && st.pages.length === oldLen && newCur === oldCur && st.pages[newCur].html === liveHtml) {
      updatePagenum();
      return;
    }
    st.curPage = newCur;
    renderPages();
    if (gOff != null) {
      const local = Math.max(0, Math.min(gOff - pageGlobalStart(st.curPage), textLenOf(st.curPage)));
      setCaretAt(body, local);
      body.focus();
      scrollCaretIntoView();
    }
  }

  /** 让书页在编辑器框内滚动，保证光标可见（页面比框高时） */
  function scrollCaretIntoView() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !frame.contains(sel.anchorNode)) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const fr = frame.getBoundingClientRect();
    if (rect.bottom > fr.bottom - 10) frame.scrollTop += rect.bottom - fr.bottom + 10;
    else if (rect.top < fr.top + 10) frame.scrollTop -= fr.top + 10 - rect.top;
  }

  function updatePagenum() {
    pagenumEl.textContent = st.pages.length > 1
      ? `第 ${st.curPage + 1} / ${st.pages.length} 页 · ← → 翻页`
      : "第 1 页 · ← → 翻页";
  }

  function textLenOf(i) {
    return (st.pages[i]?.html || "").replace(/<[^>]*>/g, "").length;
  }

  function caretOffsetIn(container) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return 0;
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return textLenOf(st.curPage);
    const pre = document.createRange();
    pre.selectNodeContents(container);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString().length;
  }

  function setCaretAt(container, offset) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let acc = 0, n;
    while ((n = walker.nextNode())) {
      const len = n.textContent.length;
      if (offset <= acc + len) {
        const range = document.createRange();
        range.setStart(n, Math.min(offset - acc, len));
        range.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      acc += len;
    }
    // 空页/无文本节点：小偏移落在开头（第一行），超出则落末尾
    const range = document.createRange();
    range.selectNodeContents(container);
    range.collapse(offset <= acc);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /* ---- 绘制 ---- */
  function renderPages() {
    body.innerHTML = st.pages[st.curPage]?.html || "";
    // 首页显示页眉行；续页只显示 · 续 ·（与阅读页一致，续页正文更高）
    const isFirst = st.curPage === 0;
    headEl.style.display = isFirst ? "" : "none";
    contHint.style.display = isFirst ? "none" : "";
    renderRight();
    updatePagenum();
    frame.scrollTop = 0;
  }

  function renderRight() {
    if (st.curPage < st.pages.length - 1) {
      ctxFace.innerHTML = `<div class="page"><div class="page-inner"><div class="cont-hint">· 续 ·</div><div class="page-body" style="flex:1"><div class="entry-html">${st.pages[st.curPage + 1].html}</div></div></div></div>`;
      ctxLbl.textContent = `本篇 · 第 ${st.curPage + 2} 页`;
    } else if (st.nextHtml) {
      ctxFace.innerHTML = st.nextHtml;
      ctxLbl.textContent = "下一篇 · 首页";
    } else {
      ctxFace.innerHTML = `<div class="page"><div class="page-inner"><div class="page-body" style="flex:1"><div class="entry-html" style="min-height:100%"></div></div></div></div>`;
      ctxLbl.textContent = "空白页";
    }
    const pg = ctxFace.querySelector(".page");
    if (pg && !pg.classList.contains("plain")) {
      const cs = getComputedStyle(pg);
      const L = (parseFloat(cs.getPropertyValue("--writing-size")) || 17) * 2;
      const base = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--line-baseline")) || 0;
      const top = (pg.querySelector(".page-body")?.getBoundingClientRect().top || pg.getBoundingClientRect().top) - pg.getBoundingClientRect().top;
      let pos = top + base - L + 1;
      pos = ((pos % L) + L) % L;
      pg.style.backgroundPosition = `0 ${pos.toFixed(2)}px`;
    }
    resolveImages(ctxFace);
  }

  function renderHead() {
    const d = dateInput.value || store.todayStr();
    dateEl.textContent = st.dateMode === "event"
      ? `${st.eventName || "事件"} Day${st.eventDay || 1}`
      : store.fmtDate(d);
    const w = weatherInput.value.trim();
    weatherEl.textContent = w ? `☁ ${w}` : "";
    weatherEl.style.display = w ? "" : "none";
    const p = placeInput.value.trim();
    placeEl.textContent = p ? `📍 ${p}` : "";
    placeEl.style.display = p ? "" : "none";
    const t = titleInput.value.trim();
    titleEl.textContent = t;
    titleEl.style.display = t ? "" : "none";
  }

  function resolveImages(node) {
    for (const img of node.querySelectorAll("img[data-imgid]")) {
      const id = img.dataset.imgid;
      if (!id) continue;
      imageUrlOf(store, id).then((u) => { if (u && img.isConnected) img.src = u; });
    }
  }

  /* ---- 翻页 ---- */
  function flipPage(dir) {
    // 清除待执行的重绘，并先提交当前页、重排一次：保证页数与内容最新，翻页不会跳错页
    clearTimeout(st.repaintTimer);
    st.pages[st.curPage] = { shift: st.pages[st.curPage]?.shift || 0, html: body.innerHTML };
    paginateNow();
    const target = st.curPage + dir;
    if (target < 0) { toast("已是本篇第一页"); return; }
    if (target >= st.pages.length) { toast("已是最后一页，写满会自动续页"); return; }
    st.curPage = target;
    renderPages();
    setCaretAt(body, 0);
    body.focus();
    scrollCaretIntoView();
  }

  // 键盘：正文/输入框编辑时方向键用于光标，不翻页；焦点在别处时 ← → 翻页
  const onKey = (e) => {
    const ae = document.activeElement;
    const editing = ae && (ae.isContentEditable || ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT");
    if (e.key === "ArrowLeft" && !editing) { flipPage(-1); e.preventDefault(); }
    else if (e.key === "ArrowRight" && !editing) { flipPage(1); e.preventDefault(); }
  };
  window.addEventListener("keydown", onKey);

  // 输入 → 重排（写满自动续页）
  body.addEventListener("input", () => { if (!st.composing) scheduleRepaint(120); });
  body.addEventListener("compositionstart", () => { st.composing = true; });
  body.addEventListener("compositionend", () => { st.composing = false; scheduleRepaint(160); });

  /* ---- 下一篇首页（右页上下文） ---- */
  function buildNextContext() {
    const entries = store.entriesOf(bookId);
    let next = null;
    if (existing) {
      const idx = entries.findIndex((e) => e.id === existing.id);
      if (idx >= 0 && idx < entries.length - 1) next = entries[idx + 1];
    }
    // 新篇追加在末尾，没有下一篇
    if (!next) { st.nextHtml = null; return; }
    const z = measureZone();
    const atts = (next.attachments || []).map((imgId) =>
      `<span class="attach" data-imgid="${imgId}"><img alt=""></span>`).join("");
    const parts = paginateEntry({ html: (next.html || "") + (atts ? `<div class="attach-strip">${atts}</div>` : "") },
      { bodyW: bodyZone.clientWidth, bodyHFirst: z.first, bodyHNext: z.next });
    const first = parts[0];
    const bits = [];
    bits.push(`<span class="hd-date">${nextHead(next)}</span>`);
    if (next.weather) bits.push(`<span class="hd-wx">☁ ${esc(next.weather)}</span>`);
    if (next.place) bits.push(`<span class="hd-place">📍 ${esc(next.place)}</span>`);
    if (next.title) bits.push(`<span class="hd-title">${esc(next.title)}</span>`);
    const head = `<div class="hd-row">${bits.join("")}</div>`;
    st.nextHtml = `<div class="page"><div class="page-inner">${head}<div class="page-body" style="flex:1"><div class="entry-html">${first.pieces.map((p) => p.html).join("")}</div></div></div></div>`;
  }

  function nextHead(entry) {
    return entry.dateMode === "event"
      ? `${esc(entry.eventName || "事件")} Day${entry.eventDay || 1}`
      : `${store.fmtDate(entry.date)}`;
  }

  /* ---- 保存 ---- */
  async function onSave() {
    const title = titleInput.value.trim();
    if (!title) { toast("请先填写标题（必填）"); titleInput.focus(); return; }
    st.pages[st.curPage] = { shift: st.pages[st.curPage].shift, html: body.innerHTML };
    // 跨页续文（class="pg-cont"）并回原段：分页只是视图表现，保存的数据里段落保持完整，
    // 这样重新打开/阅读时不会再出现“续行带缩进、段落断开”的问题。
    const joined = mergeContinuations(st.pages.map((p) => p.html).join(""));
    // 把裸文本包成 <p>，保证批注可定位、排版一致
    const tmp = document.createElement("div");
    tmp.innerHTML = joined;
    for (const n of [...tmp.childNodes]) {
      if (n.nodeType === Node.TEXT_NODE && n.textContent.trim()) {
        const p = document.createElement("p");
        p.textContent = n.textContent;
        tmp.replaceChild(p, n);
      }
    }
    const html = ensureParaIds(sanitizeHtml(tmp.innerHTML));
    const now = Date.now();
    // 编辑过正文时按段落重锚定批注偏移，避免高亮错位（失败则原样保留，绝不丢批注）
    let annotations = existing?.annotations || [];
    if (existing && annotations.length) {
      annotations = reanchorAnnos(existing.html || "", html, annotations);
    }
    const entry = {
      id: st.entryId || store.uid("e"),
      bookId,
      dateMode: st.dateMode,
      date: st.dateMode === "gregorian" ? dateInput.value : (existing?.date || store.todayStr()),
      eventName: st.dateMode === "event" ? st.eventName : "",
      eventDay: st.dateMode === "event" ? (st.eventDay || store.nextEventDay(bookId, st.eventName)) : 0,
      weather: weatherInput.value.trim(),
      place: placeInput.value.trim(),
      title,
      html,
      mood: st.mood,
      attachments: st.attachments,
      annotations,
      wordCount: countWords(html),
      createdAt: existing?.createdAt || now
    };
    if (!st.entryId) entry._pendingImageIds = [...st.pendingIds]; // 保存时收编新插入的图
    await store.saveEntry(entry);
    // 清理本次编辑中移除的附件图，避免数据库里留下无引用的孤儿图片
    const removed = (existing?.attachments || []).filter((id) => !st.attachments.includes(id));
    await store.deleteImages(removed);
    penTap();
    toast("已保存");
    nav.go("book", { bookId, entryId: entry.id });
  }

  function discardAndGo() {
    // 新草稿里插入的图片随草稿一起清理
    if (st.pendingIds.length) store.deleteImages([...st.pendingIds]);
    nav.go("book", { bookId, entryId: existing ? existing.id : undefined });
  }

  function onCancel() {
    st.pages[st.curPage] = { shift: st.pages[st.curPage].shift, html: body.innerHTML };
    const joined = mergeContinuations(st.pages.map((p) => p.html).join(""));
    if (existing && joined !== (existing.html || "")) {
      confirmDialog({ title: "放弃修改？", text: "这次改动还没有保存，确定返回吗？", okText: "放弃" }).then((ok) => {
        if (ok) discardAndGo();
      });
    } else if (!existing && (joined || st.attachments.length || st.pendingIds.length)) {
      // 新草稿有内容却没保存：提示一下再丢，避免误触直接丢失
      confirmDialog({ title: "放弃这篇？", text: "还没有保存，返回后这篇内容不会保留。", okText: "放弃" }).then((ok) => {
        if (ok) discardAndGo();
      });
    } else {
      discardAndGo();
    }
  }

  function onDelete() {
    if (!existing) return;
    confirmDialog({ title: "删除这一篇？", text: `「${existing.title}」将被永久删除，无法恢复。`, okText: "删除", danger: true }).then(async (ok) => {
      if (!ok) return;
      await store.deleteEntry(existing.id);
      toast("已删除");
      nav.go("book", { bookId });
    });
  }

  /* ---- 初始 ---- */
  renderHead();
  paginateNow();
  buildNextContext();
  st.curPage = 0;
  renderPages();
  setTimeout(() => { body.focus(); setCaretAt(body, 0); scrollCaretIntoView(); }, 60);

  cleanup = () => {
    clearTimeout(st.repaintTimer);
    window.removeEventListener("keydown", onKey);
  };
  return cleanup;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** 把跨页拆分出的“续文”块（class="pg-cont"）并入其前面的块，恢复完整段落。
 *  分页是视图层的表现，保存的数据里段落应保持完整，重开/阅读才不出现“断段+缩进”。 */
function mergeContinuations(html) {
  const root = document.createElement("div");
  root.innerHTML = html;
  let prev = null;
  for (const node of [...root.childNodes]) {
    if (node.nodeType !== 1) continue;
    if (node.classList && node.classList.contains("pg-cont") && prev) {
      while (node.firstChild) prev.appendChild(node.firstChild);
      node.remove();
    } else {
      prev = node;
    }
  }
  return root.innerHTML;
}
