/* ==========================================================================
   ui.js — 通用 UI 助手：元素构建、抽屉、灯箱、提示、确认框
   ========================================================================== */

/** 便捷创建元素 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined) continue;
    if (k === "class") node.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const c of (children || []).flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

const overlayRoot = () => document.getElementById("overlay-root");

/** 右侧抽屉：{title, content(元素或函数), onClose?} → {close} */
export function openDrawer({ title, content, width }) {
  const body = el("div", { class: "body" });
  const drawer = el("div", { class: "drawer", style: width ? { width } : null },
    el("div", { class: "head" },
      el("span", { class: "t" }, title),
      el("button", { class: "close", onclick: close }, "✕")),
    body);
  const mask = el("div", { class: "drawer-mask" });
  function close() { mask.remove(); drawer.remove(); }
  mask.addEventListener("click", (e) => { if (e.target === mask) close(); });
  overlayRoot().append(mask, drawer);
  if (typeof content === "function") content(body, { close });
  else body.append(content);
  return { close, mask, drawer, body };
}

/** 灯箱查看图片 */
export function lightbox(src, caption) {
  const lb = el("div", { class: "lightbox" },
    el("img", { src }),
    el("button", { class: "lb-close", onclick: close }, "✕"),
    caption ? el("div", { class: "lb-cap" }, caption) : null);
  function close() { lb.remove(); }
  lb.addEventListener("click", (e) => { if (e.target === lb || e.target.tagName === "IMG") close(); });
  overlayRoot().append(lb);
}

/** 底部轻提示 */
export function toast(msg, ms = 2200) {
  const box = el("div", {
    style: {
      position: "fixed", left: "50%", bottom: "34px", transform: "translateX(-50%)",
      background: "rgba(30,20,10,.88)", color: "#f3e6c8", padding: "10px 22px",
      borderRadius: "20px", fontSize: "14px", letterSpacing: "2px", zIndex: 200,
      boxShadow: "0 6px 20px rgba(0,0,0,.4)", transition: "opacity .4s"
    }
  }, msg);
  overlayRoot().append(box);
  setTimeout(() => { box.style.opacity = "0"; setTimeout(() => box.remove(), 450); }, ms);
}

/** 确认框 → Promise<boolean> */
export function confirmDialog({ title, text, okText = "确定", danger = false }) {
  return new Promise((resolve) => {
    const mask = el("div", { class: "drawer-mask", style: { zIndex: 300 } });
    const box = el("div", {
      class: "anno-compose", style: { width: "360px", zIndex: 310 }
    },
      el("div", { class: "t" }, title),
      el("div", { style: { fontSize: "14px", lineHeight: "1.8", color: "var(--panel-ink)", marginBottom: "6px" } }, text),
      el("div", { class: "acts" },
        el("button", { class: "btn ghost", onclick: () => done(false) }, "取消"),
        el("button", { class: "btn primary", style: danger ? { background: "linear-gradient(#9c3b2e,#6e241a)" } : null, onclick: () => done(true) }, okText)));
    function done(v) { mask.remove(); box.remove(); resolve(v); }
    overlayRoot().append(mask, box);
  });
}

/** 解析 data-imgid 图片 → objectURL（缓存） */
const urlCache = new Map();
export async function imageUrlOf(store, imgId) {
  if (urlCache.has(imgId)) return urlCache.get(imgId);
  const blob = await store.getImageBlob(imgId);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(imgId, url);
  return url;
}
export function revokeImageUrls() {
  for (const u of urlCache.values()) URL.revokeObjectURL(u);
  urlCache.clear();
}
