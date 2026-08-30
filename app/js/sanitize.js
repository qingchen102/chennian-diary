/* ==========================================================================
   sanitize.js — HTML 白名单消毒 + 段落定位 + 文本工具
   ========================================================================== */

const ALLOWED = new Set(["p", "br", "div", "span", "strong", "b", "em", "i", "u", "s",
  "blockquote", "h1", "h2", "h3", "ul", "ol", "li", "img", "hr"]);
const ALLOWED_STYLE = /^(color|background-color|font-family|font-size|font-weight|font-style|text-decoration|text-align|text-indent|line-height)$/i;

function wrap(html) {
  const doc = new DOMParser().parseFromString(`<div id="__root__">${html}</div>`, "text/html");
  return doc.getElementById("__root__");
}

/** 保存/渲染前的白名单消毒 */
export function sanitizeHtml(html) {
  const root = wrap(html || "");
  walk(root);
  return root.innerHTML;
}

function walk(node) {
  for (const el of [...node.children]) {
    const tag = el.tagName.toLowerCase();
    if (!ALLOWED.has(tag)) {
      el.replaceWith(...el.childNodes);
      continue;
    }
    if (tag === "img") {
      for (const attr of [...el.attributes]) {
        const n = attr.name.toLowerCase();
        if (n !== "data-imgid" && n !== "alt" && n !== "class") el.removeAttribute(attr.name);
      }
    } else {
      for (const attr of [...el.attributes]) {
        const n = attr.name.toLowerCase();
        if (n === "style") {
          const keep = {};
          for (const decl of attr.value.split(";")) {
            const idx = decl.indexOf(":");
            if (idx < 0) continue;
            const k = decl.slice(0, idx).trim();
            if (ALLOWED_STYLE.test(k)) keep[k] = decl.slice(idx + 1).trim();
          }
          const out = Object.entries(keep).map(([k, v]) => `${k}: ${v}`).join("; ");
          if (out) el.setAttribute("style", out); else el.removeAttribute("style");
        } else if (n === "id") {
          // 保留 id：段落定位（旁注）用，安全
        } else {
          el.removeAttribute(attr.name);
        }
      }
    }
    walk(el);
  }
}

/** 给块级元素补 id，供旁注定位（p_0, p_1 …） */
export function ensureParaIds(html) {
  const root = wrap(html || "");
  let n = 0;
  for (const b of root.querySelectorAll("p, blockquote, li, h1, h2, h3, div")) {
    if (b.textContent.trim()) b.id = b.id || `p_${n++}`;
  }
  return root.innerHTML;
}

/** 纯文本提取（搜索/统计） */
export function htmlToText(html) {
  const root = wrap(html || "");
  return root.textContent.replace(/\s+/g, " ").trim();
}

/** 字数统计（不含空白） */
export function countWords(html) {
  return htmlToText(html).replace(/\s/g, "").length;
}
