/* ==========================================================================
   nav.js — hash 路由（避免模块循环依赖）
   视图写入 location.hash：#/bookshelf · #/book/<bookId>[/<entryId>] · #/editor/<bookId>[/<entryId>]
   好处：刷新/重开应用回到原视图；浏览器后退（Alt+←）可在视图间回退。
   ========================================================================== */

const handlers = new Map();
export function register(name, fn) { handlers.set(name, fn); }

function hashOf(name, params = {}) {
  const segs = [name, params.bookId, params.entryId]
    .filter((x) => x !== undefined && x !== null && x !== "");
  return "#/" + segs.map(encodeURIComponent).join("/");
}

function dispatch(name, params) {
  const h = handlers.get(name);
  if (h) h(params || {});
  else if (location.hash !== "#/bookshelf") location.hash = "#/bookshelf";
}

export function go(name, params) {
  const h = hashOf(name, params);
  if (location.hash === h) dispatch(name, params); // 同视图：显式重刷（如删除日记后回到本书）
  else location.hash = h;                          // 变更 hash → hashchange → route
}

/** 解析当前 hash 并渲染对应视图。无 hash 或未知视图 → 书架。 */
export function route() {
  const segs = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent).filter(Boolean);
  dispatch(segs[0] || "bookshelf", { bookId: segs[1], entryId: segs[2] });
}

export function start() {
  window.addEventListener("hashchange", route);
  route();
}
