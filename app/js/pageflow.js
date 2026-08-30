/* ==========================================================================
   pageflow.js — 书页排版引擎
   1. paginateEntry：把一篇日记的 HTML 按页拆成多“片”（每片是一个段落块），
      超出一页的内容自动流到下一页（段落级换页；超长段落按行拆分）。
   2. applyMarks：把批注的选中区间在片内高亮（<mark>，纯底色，不改变排版），
      选区末尾附上序号角标（CSS ::after，不产生文本节点，不影响偏移）。
   3. refreshLineBaseline：用 Canvas 测量当前书写字体的基线高度，
      让横线与字底对齐（字正好坐在横线上）。
   本模块不依赖任何其他模块（纯 DOM 工具）。
   ========================================================================== */

/** 把整篇 html 分页。返回 [{ pieces: [{paraId, shift, html}] }]，每页一片或多片。
 *  opts: { bodyW, bodyHFirst, bodyHNext } — 首页正文高（含日期/标题行）与续页正文高
 *  每片 html 的块元素上带 data-pid（原始段落 id）与 data-shift（该段此前已被消费的字符数）。 */
export function paginateEntry(entry, opts) {
  const { bodyW, bodyHFirst, bodyHNext } = opts;
  const meas = document.createElement("div");
  meas.className = "pageflow-meas entry-html";
  // 继承当前书写字体设置（与阅读页一致才能测得准）
  const rs = getComputedStyle(document.documentElement);
  meas.style.cssText = `position:fixed; left:-9999px; top:0; width:${bodyW}px; visibility:hidden;` +
    `font-family:${rs.getPropertyValue("--writing-font")}; font-size:${rs.getPropertyValue("--writing-size") || "16px"}; line-height:2;`;
  document.body.append(meas);

  const consumed = new Map(); // paraId -> 已消费字符数
  const pages = [];
  const content = document.createElement("div");
  content.innerHTML = wrapBareText(entry.html || "");
  meas.append(content);
  let cur = document.createElement("div");
  cur.style.cssText = `width:${bodyW}px;`;
  meas.append(cur);

  const lineH = parseFloat(getComputedStyle(meas).lineHeight) || 32;
  const flush = () => {
    if (!cur.childNodes.length) return;
    const pieces = [];
    for (const node of cur.childNodes) {
      if (node.nodeType === 1) {
        pieces.push({
          paraId: node.dataset.pid || "",
          shift: Number(node.dataset.shift || 0),
          html: node.outerHTML
        });
      }
    }
    cur.innerHTML = "";
    pages.push({ pieces });
  };
  const place = (block, paraId, shift) => {
    const clone = block.cloneNode(true);
    clone.dataset.pid = paraId;
    clone.dataset.shift = String(shift);
    cur.appendChild(clone);
  };
  const fits = () => cur.scrollHeight <= (pages.length === 0 ? bodyHFirst : bodyHNext) + 1;
  /** 当前页放不下时：先按“本页剩余行数”拆分，能放下的留在本页；剩余部分换页继续。
   *  这样上一页不会被掏空，最后一段能填满剩余空行，而不是整段被推到下一页。 */
  const placeBlock = (block) => {
    const paraId = block.dataset.pid || block.id || "";
    let shift = consumed.get(paraId) || 0;
    for (;;) {
      place(block, paraId, shift);
      if (fits()) {
        shift += block.textContent.length;
        consumed.set(paraId, shift);
        return;
      }
      cur.removeChild(cur.lastChild);
      const bodyH = pages.length === 0 ? bodyHFirst : bodyHNext;
      if (!block.textContent.length) {
        // 无文字但超高（如大图）：整块放一页兜底
        flush();
        place(block, paraId, shift);
        consumed.set(paraId, shift);
        return;
      }
      // 本页还剩至少一行：按剩余行数拆，能放下的留在本页
      const remainH = bodyH - cur.scrollHeight;
      if (remainH >= lineH) {
        const maxLines = Math.max(1, Math.floor((remainH - 2) / lineH));
        const { firstEl, firstLen } = splitBlockAtLines(block, maxLines);
        if (firstLen > 0) {
          firstEl.dataset.pid = paraId;
          firstEl.dataset.shift = String(shift);
          cur.appendChild(firstEl);
          shift += firstLen;
          consumed.set(paraId, shift);
          if (!block.textContent.length) return;
          block.classList.add("pg-cont"); // 剩余部分是续文：首行不再缩进，段落看起来不断
          continue; // 剩余部分继续循环：下一页放不下 → 换页
        }
      }
      // 本页已满：整块换到下一页
      flush();
      place(block, paraId, shift);
      if (fits()) {
        shift += block.textContent.length;
        consumed.set(paraId, shift);
        return;
      }
      // 仍放不下（比整页还高）：按整页行数拆，剩余部分进入下一轮循环继续放
      const maxLines = Math.max(1, Math.floor((bodyH - 4) / lineH));
      const { firstEl, firstLen } = splitBlockAtLines(block, maxLines);
      flush();
      firstEl.dataset.pid = paraId;
      firstEl.dataset.shift = String(shift);
      cur.appendChild(firstEl);
      shift += firstLen;
      consumed.set(paraId, shift);
      if (!block.textContent.length) return;
      block.classList.add("pg-cont"); // 剩余部分是续文：首行不再缩进
    }
  };

  try {
    const blocks = [...content.childNodes];
    for (const node of blocks) {
      if (node.nodeType === 1 && node.tagName !== "BR") placeBlock(node);
    }
    flush();
  } finally {
    meas.remove();
  }
  return pages.length ? pages : [{ pieces: [] }];
}

/** 顶层裸文本包成 <p>（老数据可能有） */
function wrapBareText(html) {
  const root = document.createElement("div");
  root.innerHTML = html;
  for (const node of [...root.childNodes]) {
    if (node.nodeType === 3 && node.textContent.trim()) {
      const p = document.createElement("p");
      p.textContent = node.textContent;
      root.replaceChild(p, node);
    }
  }
  return root.innerHTML;
}

/** 把块按“最多 maxLines 行”拆成两半（就地改 block 为剩余部分） */
function splitBlockAtLines(block, maxLines) {
  const textNodes = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) textNodes.push(n);
  const total = textNodes.reduce((m, t) => m + t.textContent.length, 0);
  if (!total) return { firstEl: block.cloneNode(true), firstLen: 0 };

  // 找最大的 cut，使 [0, cut) 恰好不超过 maxLines 行
  let lo = 0, hi = total;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (lineCountOf(block, textNodes, mid) <= maxLines) lo = mid;
    else hi = mid - 1;
  }
  const cut = lo;
  if (cut <= 0 || cut >= total) {
    // 拆不出（极短但超高的块，比如大图）：整块放一页兜底
    return { firstEl: block.cloneNode(true), firstLen: total };
  }
  const range = document.createRange();
  range.selectNodeContents(block);
  setRangeEnd(range, textNodes, cut);
  const frag = range.extractContents();
  const firstEl = document.createElement(block.tagName);
  for (const a of block.attributes) {
    if (a.name !== "id") firstEl.setAttribute(a.name, a.value);
  }
  if (block.id) { firstEl.id = block.id; block.removeAttribute("id"); }
  firstEl.append(frag);
  return { firstEl, firstLen: cut };
}

function lineCountOf(block, textNodes, offset) {
  const range = document.createRange();
  range.selectNodeContents(block);
  setRangeEnd(range, textNodes, offset);
  return range.getClientRects().length;
}

function setRangeEnd(range, textNodes, offset) {
  let remaining = offset;
  for (const tn of textNodes) {
    const len = tn.textContent.length;
    if (remaining <= len) { range.setEnd(tn, remaining); return; }
    remaining -= len;
  }
  range.setEnd(textNodes[textNodes.length - 1], textNodes[textNodes.length - 1].textContent.length);
}

/** 在“片”内按批注区间加高亮标记（纯底色，不改变排版、不产生换行）。
 *  annos: 该篇全部批注（须含数字化的 start/end）；numOf: (annoId) => 序号
 *  选中起始处所在片的高亮带 data-n 角标序号（角标为绝对定位，不占排版）。
 *  返回带标记的 html；块的 data-shift 保留（供点击时换算绝对偏移）。 */
export function applyMarks(pieceHtml, annos, numOf) {
  if (!annos.length) return pieceHtml;
  const temp = document.createElement("div");
  temp.innerHTML = pieceHtml;
  const total = temp.textContent.length;
  for (const a of annos) {
    if (!Number.isFinite(a.start) || !Number.isFinite(a.end)) continue;
    if (!a.paraId || a.paraId !== (temp.firstElementChild?.dataset?.pid || temp.firstElementChild?.id)) continue;
    const shift = Number(temp.firstElementChild?.dataset?.shift) || 0;
    const s = a.start - shift;
    const e = a.end - shift;
    if (e <= 0 || s >= total) continue;
    const range = rangeFromOffsets(temp, Math.max(0, s), Math.min(total, e));
    if (!range) continue;
    const mark = document.createElement("mark");
    mark.className = "anno-hl";
    mark.dataset.a = a.id;
    if (s >= 0 && s < total) mark.dataset.n = String(numOf(a.id)); // 选中起始处所在片带角标
    try { range.surroundContents(mark); }
    catch {
      const frag = range.extractContents();
      mark.append(frag);
      range.insertNode(mark);
    }
  }
  return temp.innerHTML;
}

/** 从根元素内按字符偏移取 Range（偏移按 textContent 累计） */
function rangeFromOffsets(root, s, e) {
  const textNodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) textNodes.push(n);
  let acc = 0, startNode = null, startOff = 0, endNode = null, endOff = 0;
  for (const tn of textNodes) {
    const len = tn.textContent.length;
    if (startNode === null && acc + len >= s) { startNode = tn; startOff = s - acc; }
    if (acc + len >= e) { endNode = tn; endOff = e - acc; break; }
    acc += len;
  }
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, startOff);
  range.setEnd(endNode, endOff);
  return range;
}

/** 取某段落在原 html 里的文本（用于批注面板引用） */
export function paraTextOf(html, paraId) {
  if (!paraId) return "";
  const root = document.createElement("div");
  root.innerHTML = html;
  let node = null;
  try { node = root.querySelector(`#${CSS.escape(paraId)}`); } catch { node = null; }
  return node ? node.textContent : "";
}

/** 编辑保存后重锚定批注：文字改了，批注的 start/end 偏移也要跟着改，否则高亮错位。
 *  规则（保守优先，宁可高亮不准也不丢批注）：
 *  - 段落 id 不存在（被删）→ 原样保留（阅读端不会渲染它，数据仍在）
 *  - 引文仍能在新段落里找到 → 平移到新位置（多处命中取离原比例位置最近的一处）
 *  - 引文找不到（该段被改写）→ 偏移夹到新段落长度内；夹完为空置 null（阅读端退化为整段高亮）
 *  - 任何异常 → 返回原批注数组 */
export function reanchorAnnos(oldHtml, newHtml, annos) {
  if (!annos || !annos.length) return annos || [];
  try {
    const oldParas = paraTextMap(oldHtml);
    const newParas = paraTextMap(newHtml);
    return annos.map((a) => {
      if (a.paraId == null || a.paraId === "") return a;
      if (!Number.isFinite(a.start) || !Number.isFinite(a.end)) return a; // 整段高亮型，无需修正
      const newText = newParas.get(a.paraId);
      if (newText == null) return a; // 段落被删：保留原样
      const oldText = oldParas.get(a.paraId) || "";
      const quote = oldText.slice(Math.max(0, a.start), Math.max(0, a.end));
      if (!quote || newText === oldText) return a; // 没引用内容，或段落没变
      const idx = occurrenceNearest(newText, quote, oldText.length ? a.start / oldText.length : 0);
      if (idx >= 0) return { ...a, start: idx, end: idx + quote.length };
      // 引文没了：偏移仍落在新段落范围内则夹紧保留，否则退化为整段高亮
      if (a.start < newText.length && a.end <= newText.length) {
        return { ...a, start: Math.max(0, a.start), end: a.end };
      }
      return { ...a, start: null, end: null };
    });
  } catch {
    return annos;
  }
}

function paraTextMap(html) {
  const root = document.createElement("div");
  root.innerHTML = html || "";
  const m = new Map();
  for (const b of root.querySelectorAll("p, blockquote, li, h1, h2, h3, div")) {
    if (b.id) m.set(b.id, b.textContent);
  }
  return m;
}

/** 找 quote 在 text 中的出现位置；多处命中时取比例位置最接近 rel 的那一处 */
function occurrenceNearest(text, quote, rel) {
  const positions = [];
  let i = text.indexOf(quote);
  while (i >= 0 && positions.length < 50) {
    positions.push(i);
    i = text.indexOf(quote, i + 1);
  }
  if (!positions.length) return -1;
  if (positions.length === 1 || text.length === 0) return positions[0];
  return positions.reduce((best, p) =>
    Math.abs(p / text.length - rel) < Math.abs(best / text.length - rel) ? p : best);
}

/** 测量当前书写字体的基线位置（字底与横线对齐），写入 --line-baseline */
export function refreshLineBaseline() {
  try {
    const rootStyle = getComputedStyle(document.documentElement);
    const fs = parseFloat(rootStyle.getPropertyValue("--writing-size")) || 16;
    const ff = (rootStyle.getPropertyValue("--writing-font") || "楷体").trim();
    const c = document.createElement("canvas").getContext("2d");
    c.font = `${fs}px ${ff}`;
    const m = c.measureText("永");
    const asc = m.actualBoundingBoxAscent || fs * 0.86;
    const desc = m.actualBoundingBoxDescent || fs * 0.14;
    const L = fs * 2;
    const base = (L - (asc + desc)) / 2 + asc; // 基线距行盒顶
    document.documentElement.style.setProperty("--line-baseline", `${base.toFixed(2)}px`);
  } catch {
    document.documentElement.style.setProperty("--line-baseline", "1.2em");
  }
}
